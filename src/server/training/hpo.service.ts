/**
 * HPO Service — Hyperparameter Optimisation orchestrator.
 *
 * Manages the full lifecycle of HPO sessions:
 *  1. Validate incoming HPORequest via Zod schema
 *  2. Persist session to SQLite (hpoSessions)
 *  3. Spawn the Python HPO runner as a child process
 *  4. Parse per-trial JSON events from stdout
 *  5. Update DB on every trial start/done/pruned event
 *  6. Stream SSE events to connected clients + buffer for reconnection
 *  7. Enforce concurrency limits and overall timeout
 *
 * DIP: All DB access flows through narrow function calls — never raw queries.
 * OCP: Event dispatch table is extensible without modifying core loop.
 * SRP: This module handles HPO orchestration only — schema lives in @shared.
 *
 * Exports both a NestJS Injectable service (for DI in controllers) and
 * standalone functions (for framework-agnostic usage / testing).
 */

import { Injectable } from "@nestjs/common";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import crypto from "crypto";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../database/db";
import {
  hpoSessions,
  hpoTrials,
  type HpoSession,
  type HpoTrial,
} from "@shared/schema";
import {
  hpoRequestSchema,
  type HPORequest,
  type OptimizerType,
} from "@shared/hpoTypes";
import { getTrainingConfig } from "./registry";

// ─── Configuration ───────────────────────────────────────────────────────────

/** Maximum number of concurrent HPO sessions. */
const MAX_CONCURRENT_HPO_SESSIONS = 1;

/** Grace period (ms) between SIGTERM and SIGKILL when stopping a session. */
const KILL_GRACE_MS = 30_000;

/** How long (ms) to keep finished sessions in-memory for SSE reconnection. */
const SESSION_RETENTION_MS = 120_000;

/** Default overall timeout (seconds) if the request doesn't specify one. */
const DEFAULT_TIMEOUT_SEC = 7200;

// ─── Key Conversion (camelCase → snake_case for Python) ──────────────────────

function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function normalizeKeysToSnakeCase(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[camelToSnakeCase(key)] = value;
  }
  return result;
}

// ─── In-memory Session State ─────────────────────────────────────────────────

/** Runtime state for a single HPO session. */
interface HPOSessionState {
  sessionId: string;
  dbId: number;
  child: ChildProcess | null;
  status: "pending" | "running" | "completed" | "failed" | "stopped";
  events: Array<{ type: string; data: any; ts: number }>;
  listeners: Set<(evt: any) => void>;
  finished: boolean;
  bestScore: number | null;
  bestParams: Record<string, any> | null;
  completedTrials: number;
  prunedTrials: number;
  failedTrials: number;
  startedAt: number;
  modelType: string;
  optimizerType: OptimizerType;
}

/** Module-level registry of active / recently-finished HPO sessions. */
const activeSessions = new Map<string, HPOSessionState>();

// ─── SSE Event Helpers ───────────────────────────────────────────────────────

/**
 * Emit an event to a session's connected SSE listeners and append to the
 * in-memory buffer so late-joining clients can replay history.
 */
function emitHPOEvent(
  session: HPOSessionState,
  type: string,
  data: Record<string, unknown>,
): void {
  const evt = { type, data, ts: Date.now() };
  session.events.push(evt);
  for (const listener of Array.from(session.listeners)) {
    try {
      listener(evt);
    } catch {
      /* dead listener — client disconnected */
    }
  }
}

// ─── DB Persistence Helpers ──────────────────────────────────────────────────

/** Insert a new HPO session row and return the generated row. */
function dbCreateSession(data: {
  sessionId: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  optimizerType: string;
  optimizerConfig: string;
  objectiveMetric: string;
  objectiveDirection: string;
  searchSpace: string;
  fixedHyperparameters: string | null;
  totalTrials: number;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  maxBars: number | null;
  featureCategories: string | null;
}) {
  return db
    .insert(hpoSessions)
    .values({
      sessionId: data.sessionId,
      modelType: data.modelType,
      symbol: data.symbol,
      timeframe: data.timeframe,
      status: "pending",
      optimizerType: data.optimizerType,
      optimizerConfig: data.optimizerConfig,
      objectiveMetric: data.objectiveMetric,
      objectiveDirection: data.objectiveDirection,
      searchSpace: data.searchSpace,
      fixedHyperparameters: data.fixedHyperparameters,
      totalTrials: data.totalTrials,
      dateRangeStart: data.dateRangeStart,
      dateRangeEnd: data.dateRangeEnd,
      maxBars: data.maxBars,
      featureCategories: data.featureCategories,
    })
    .returning()
    .get();
}

/** Update session-level fields (status, best score, counts, etc.). */
function dbUpdateSession(
  sessionId: string,
  data: Partial<{
    status: string;
    completedTrials: number;
    prunedTrials: number;
    failedTrials: number;
    bestTrialId: number;
    bestScore: number;
    bestParams: string;
    errorMessage: string;
    elapsedSec: number;
    completedAt: Date;
  }>,
) {
  db.update(hpoSessions)
    .set({ ...data, updatedAt: sql`(unixepoch() * 1000)` })
    .where(eq(hpoSessions.sessionId, sessionId))
    .run();
}

/** Insert a new trial row for a session. */
function dbInsertTrial(data: {
  sessionId: string;
  trialId: number;
  status: string;
  params: string;
}) {
  return db.insert(hpoTrials).values(data).returning().get();
}

/** Update an existing trial row by sessionId + trialId. */
function dbUpdateTrial(
  sessionId: string,
  trialId: number,
  data: Partial<{
    status: string;
    score: number;
    metrics: string;
    pruned: number;
    prunedAtStep: number;
    error: string;
    durationSec: number;
    iterationHistory: string;
    modelPath: string;
    trainedModelId: string;
    completedAt: Date;
  }>,
) {
  db.update(hpoTrials)
    .set(data)
    .where(
      and(
        eq(hpoTrials.sessionId, sessionId),
        eq(hpoTrials.trialId, trialId),
      ),
    )
    .run();
}

// ─── Python Process Spawning ─────────────────────────────────────────────────

/**
 * Build the Python command-line config object and spawn the HPO runner.
 * Returns the ChildProcess handle for lifecycle management.
 */
function spawnHPORunner(
  session: HPOSessionState,
  request: HPORequest,
): ChildProcess {
  const trainingCfg = getTrainingConfig();
  const pythonExe = path.isAbsolute(trainingCfg.paths.pythonExe)
    ? trainingCfg.paths.pythonExe
    : path.join(process.cwd(), trainingCfg.paths.pythonExe);

  const configPayload = JSON.stringify({
    session_id: session.sessionId,
    model_type: request.modelType,
    symbol: request.symbol,
    timeframe: request.timeframe ?? "1h",
    optimizer: request.optimizer.type,
    optimizer_config: normalizeKeysToSnakeCase(request.optimizer.config as Record<string, any>),
    objective_metric: request.objectiveMetric,
    direction: getDirection(request),
    search_space: request.searchSpace,
    n_trials: getNTrials(request),
    timeout: getTimeout(request),
    fixed_hyperparameters: request.fixedHyperparameters ?? {},
    date_range: request.dateRange ?? null,
    max_bars: request.maxBars ?? 0,
    feature_categories: request.featureCategories ?? null,
  });

  const args = ["-m", "src.ml.shared.hpo_runner", "--config", configPayload];

  console.log(
    `[hpo] Spawning Python HPO runner: ${pythonExe} ${args.slice(0, 3).join(" ")} --config <${configPayload.length} bytes>`,
  );

  const child = spawn(pythonExe, args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  return child;
}

/** Extract objective direction from the optimizer config or default to 'minimize'. */
function getDirection(request: HPORequest): string {
  const cfg = request.optimizer.config as unknown as Record<string, unknown>;
  return (cfg.direction as string) ?? "minimize";
}

/** Extract n_trials from the optimizer config. */
function getNTrials(request: HPORequest): number {
  const cfg = request.optimizer.config as unknown as Record<string, unknown>;
  return (cfg.nTrials as number) ?? (cfg.nCalls as number) ?? 50;
}

/** Extract timeout from the optimizer config or use default. */
function getTimeout(request: HPORequest): number {
  const cfg = request.optimizer.config as unknown as Record<string, unknown>;
  return (cfg.timeout as number) ?? DEFAULT_TIMEOUT_SEC;
}

// ─── Stdout Event Dispatch ───────────────────────────────────────────────────

/**
 * Event dispatch table — maps Python event types to handler functions.
 * OCP: add new event types without modifying the core parsing loop.
 */
const EVENT_HANDLERS: Record<
  string,
  (session: HPOSessionState, data: any) => void
> = {
  "hpo-started": handleHPOStarted,
  "hpo-trial-start": handleTrialStart,
  "hpo-trial-done": handleTrialDone,
  "hpo-trial-pruned": handleTrialPruned,
  "hpo-best-update": handleBestUpdate,
  "hpo-complete": handleHPOComplete,
  "hpo-error": handleHPOError,
  "hpo-log": handleHPOLog,
};

function handleHPOStarted(session: HPOSessionState, data: any): void {
  session.status = "running";
  dbUpdateSession(session.sessionId, { status: "running" });


  console.log(
    `[hpo] Session ${session.sessionId} started — optimizer=${data.optimizer}, nTrials=${data.nTrials}`,
  );
}

function handleTrialStart(session: HPOSessionState, data: any): void {
  dbInsertTrial({
    sessionId: session.sessionId,
    trialId: data.trialId,
    status: "running",
    params: JSON.stringify(data.params ?? {}),
  });

  console.log(
    `[hpo] Session ${session.sessionId} trial ${data.trialId} started — params=${JSON.stringify(data.params)}`,
  );
}

function handleTrialDone(session: HPOSessionState, data: any): void {
  session.completedTrials += 1;

  dbUpdateTrial(session.sessionId, data.trialId, {
    status: "completed",
    score: data.score ?? undefined,
    metrics: data.metrics ? JSON.stringify(data.metrics) : undefined,
    durationSec: data.durationSec ?? undefined,
    iterationHistory: data.iterationHistory
      ? JSON.stringify(data.iterationHistory)
      : undefined,
    modelPath: data.modelPath ?? undefined,
    trainedModelId: data.trainedModelId ?? undefined,
    completedAt: new Date(),
  });

  dbUpdateSession(session.sessionId, {
    completedTrials: session.completedTrials,
  });

  console.log(
    `[hpo] Session ${session.sessionId} trial ${data.trialId} done — score=${data.score}, elapsed=${data.durationSec}s`,
  );
}

function handleTrialPruned(session: HPOSessionState, data: any): void {
  session.prunedTrials += 1;

  dbUpdateTrial(session.sessionId, data.trialId, {
    status: "pruned",
    score: data.score ?? undefined,
    pruned: 1,
    prunedAtStep: data.prunedAtStep ?? undefined,
    completedAt: new Date(),
  });

  dbUpdateSession(session.sessionId, {
    prunedTrials: session.prunedTrials,
  });

  console.log(
    `[hpo] Session ${session.sessionId} trial ${data.trialId} pruned at step ${data.prunedAtStep} — score=${data.score}`,
  );
}

function handleBestUpdate(session: HPOSessionState, data: any): void {
  session.bestScore = data.bestScore ?? null;
  session.bestParams = data.bestParams ?? null;

  dbUpdateSession(session.sessionId, {
    bestTrialId: data.trialId,
    bestScore: data.bestScore,
    bestParams: JSON.stringify(data.bestParams ?? {}),
  });

  console.log(
    `[hpo] Session ${session.sessionId} new best — trial=${data.trialId}, score=${data.bestScore}`,
  );
}

function handleHPOComplete(session: HPOSessionState, data: any): void {
  session.status = "completed";
  session.finished = true;

  const elapsedSec = parseFloat(
    ((Date.now() - session.startedAt) / 1000).toFixed(1),
  );

  dbUpdateSession(session.sessionId, {
    status: "completed",
    elapsedSec,
    completedAt: new Date(),
    completedTrials: data.completedTrials ?? session.completedTrials,
    prunedTrials: data.prunedTrials ?? session.prunedTrials,
    bestScore: data.bestScore ?? session.bestScore ?? undefined,
    bestParams: data.bestParams
      ? JSON.stringify(data.bestParams)
      : undefined,
  });

  console.log(
    `[hpo] Session ${session.sessionId} completed — bestScore=${data.bestScore}, totalTrials=${data.totalTrials}, elapsed=${elapsedSec}s`,
  );
}

function handleHPOError(session: HPOSessionState, data: any): void {
  const message = data.message ?? "Unknown HPO error";
  console.error(`[hpo] Session ${session.sessionId} error — ${message}`);
}

function handleHPOLog(session: HPOSessionState, data: any): void {
  // Log messages are emitted to SSE but not persisted to DB
  const msg = data.message ?? data;
  console.log(`[hpo] Session ${session.sessionId} log — ${msg}`);
}

/**
 * Parse a single stdout line as JSON and dispatch to the appropriate handler.
 * Non-JSON lines are silently ignored (Python may emit warnings to stdout).
 */
function parseAndDispatch(session: HPOSessionState, line: string): void {
  let parsed: { type?: string; data?: any };
  try {
    parsed = JSON.parse(line);
  } catch {
    // Not JSON — skip (Python warning, import message, etc.)
    return;
  }

  const { type, data } = parsed;
  if (!type) return;

  // Dispatch to handler if registered, otherwise treat as generic log
  const handler = EVENT_HANDLERS[type];
  if (handler) {
    handler(session, data ?? {});
  }

  // All events → SSE broadcast + buffer (including unrecognised types)
  emitHPOEvent(session, type, data ?? {});
}

// ─── Process Lifecycle ───────────────────────────────────────────────────────

/**
 * Wire up stdout/stderr/close handlers on the spawned Python child process.
 * Manages timeout, error recovery, and session finalisation.
 */
function attachProcessHandlers(
  session: HPOSessionState,
  child: ChildProcess,
  request: HPORequest,
): void {
  const timeoutSec = getTimeout(request);

  // ── Stdout: line-by-line JSON parsing ──
  let stdoutBuffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    // Keep the last incomplete line in the buffer
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        parseAndDispatch(session, trimmed);
      }
    }
  });

  // ── Stderr: emit as warning log events ──
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (!text) return;

    const trainingCfg = getTrainingConfig();
    const suppressPatterns = trainingCfg.stderrSuppressPatterns ?? [];
    if (suppressPatterns.some((p: string) => text.includes(p))) return;

    emitHPOEvent(session, "hpo-log", {
      message: text.slice(0, 500),
      level: "warning",
    });
  });

  // ── Overall timeout: SIGTERM → grace → SIGKILL ──
  const timeoutHandle = setTimeout(() => {
    if (!session.finished) {
      console.warn(
        `[hpo] Session ${session.sessionId} exceeded ${timeoutSec}s timeout, sending SIGTERM`,
      );
      child.kill("SIGTERM");
      emitHPOEvent(session, "hpo-timeout", {
        message: `HPO timed out after ${timeoutSec}s`,
        timeoutSec,
      });

      setTimeout(() => {
        if (!session.finished) {
          console.warn(
            `[hpo] Session ${session.sessionId} did not exit after SIGTERM, sending SIGKILL`,
          );
          child.kill("SIGKILL");
        }
      }, KILL_GRACE_MS);
    }
  }, timeoutSec * 1000);

  // ── Process exit ──
  child.on("close", (code: number | null) => {
    clearTimeout(timeoutHandle);

    if (session.finished) {
      // Already finalised via hpo-complete event — just clean up
      scheduleCleanup(session);
      return;
    }

    session.finished = true;
    const elapsedSec = parseFloat(
      ((Date.now() - session.startedAt) / 1000).toFixed(1),
    );

    if (code !== 0) {
      session.status = "failed";
      const errorMessage = `HPO process exited with code ${code}`;
      console.error(`[hpo] ${errorMessage} — session=${session.sessionId}`);

      dbUpdateSession(session.sessionId, {
        status: "failed",
        elapsedSec,
        errorMessage,
        completedAt: new Date(),
      });

      emitHPOEvent(session, "hpo-error", {
        message: errorMessage,
        exitCode: code,
      });
    } else {
      // Exited cleanly but hpo-complete wasn't emitted — mark completed anyway
      session.status = "completed";

      dbUpdateSession(session.sessionId, {
        status: "completed",
        elapsedSec,
        completedAt: new Date(),
      });

      console.log(
        `[hpo] Session ${session.sessionId} process exited cleanly (code 0), elapsed=${elapsedSec}s`,
      );
    }

    scheduleCleanup(session);
  });

  // ── Process spawn error (e.g. Python not found) ──
  child.on("error", (err: Error) => {
    if (session.finished) return;
    session.finished = true;
    session.status = "failed";

    const errorMessage = `Failed to spawn HPO process: ${err.message}`;
    console.error(`[hpo] ${errorMessage}`);

    dbUpdateSession(session.sessionId, {
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    });

    emitHPOEvent(session, "hpo-error", { message: errorMessage });
    scheduleCleanup(session);
  });
}

/** Remove a session from the in-memory map after the retention window. */
function scheduleCleanup(session: HPOSessionState): void {
  setTimeout(() => {
    activeSessions.delete(session.sessionId);
    console.log(
      `[hpo] Session ${session.sessionId} removed from memory after retention period`,
    );
  }, SESSION_RETENTION_MS);
}

// ─── Public API (standalone functions) ───────────────────────────────────────

/**
 * Start a new HPO session.
 *
 * Validates the request, persists to SQLite, spawns the Python HPO runner,
 * and returns immediately with the session ID for SSE streaming.
 *
 * @throws {Error} If validation fails, concurrency limit reached, or spawn fails.
 */
export async function startHPO(
  request: HPORequest,
): Promise<{ sessionId: string }> {
  // ── Validate request via Zod ──
  const parsed = hpoRequestSchema.safeParse(request);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid HPO request: ${issues}`);
  }

  // ── Enforce concurrency limit ──
  const runningCount = Array.from(activeSessions.values()).filter(
    (s) => s.status === "running" || s.status === "pending",
  ).length;

  if (runningCount >= MAX_CONCURRENT_HPO_SESSIONS) {
    throw new Error(
      `HPO concurrency limit reached (${MAX_CONCURRENT_HPO_SESSIONS}). ` +
        `Stop an active session before starting a new one.`,
    );
  }

  // ── Generate session ID ──
  const sessionId = crypto.randomUUID();
  const nTrials = getNTrials(request);
  const direction = getDirection(request);

  console.log(
    `[hpo] Starting HPO session ${sessionId} — model=${request.modelType}, symbol=${request.symbol}, ` +
      `optimizer=${request.optimizer.type}, nTrials=${nTrials}, metric=${request.objectiveMetric}`,
  );

  // ── Persist to SQLite ──
  const dbRow = dbCreateSession({
    sessionId,
    modelType: request.modelType,
    symbol: request.symbol,
    timeframe: request.timeframe ?? "1h",
    optimizerType: request.optimizer.type,
    optimizerConfig: JSON.stringify(request.optimizer.config),
    objectiveMetric: request.objectiveMetric,
    objectiveDirection: direction,
    searchSpace: JSON.stringify(request.searchSpace),
    fixedHyperparameters: request.fixedHyperparameters
      ? JSON.stringify(request.fixedHyperparameters)
      : null,
    totalTrials: nTrials,
    dateRangeStart: request.dateRange?.start ?? null,
    dateRangeEnd: request.dateRange?.end ?? null,
    maxBars: request.maxBars ?? null,
    featureCategories: request.featureCategories
      ? JSON.stringify(request.featureCategories)
      : null,
  });

  // ── Create in-memory session state ──
  const session: HPOSessionState = {
    sessionId,
    dbId: dbRow.id,
    child: null,
    status: "pending",
    events: [],
    listeners: new Set(),
    finished: false,
    bestScore: null,
    bestParams: null,
    completedTrials: 0,
    prunedTrials: 0,
    failedTrials: 0,
    startedAt: Date.now(),
    modelType: request.modelType,
    optimizerType: request.optimizer.type,
  };

  activeSessions.set(sessionId, session);

  // ── Spawn Python process (async — returns immediately) ──
  try {
    const child = spawnHPORunner(session, request);
    session.child = child;
    attachProcessHandlers(session, child, request);
  } catch (err: any) {
    session.status = "failed";
    session.finished = true;
    dbUpdateSession(sessionId, {
      status: "failed",
      errorMessage: `Spawn error: ${err.message}`,
    });
    throw new Error(`Failed to start HPO session: ${err.message}`);
  }

  return { sessionId };
}

/**
 * Stop an active HPO session.
 *
 * Sends SIGTERM, then SIGKILL after a grace period. Updates DB and emits
 * a stop event to connected clients.
 *
 * @returns true if the session was found and stop was initiated.
 */
export function stopHPO(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) {
    console.warn(`[hpo] stopHPO: session ${sessionId} not found`);
    return false;
  }

  if (session.finished) {
    console.warn(`[hpo] stopHPO: session ${sessionId} already finished`);
    return false;
  }

  console.log(`[hpo] Stopping session ${sessionId}, sending SIGTERM`);
  session.child?.kill("SIGTERM");

  // Grace period → SIGKILL
  setTimeout(() => {
    if (!session.finished) {
      console.warn(
        `[hpo] Session ${sessionId} did not exit after SIGTERM, sending SIGKILL`,
      );
      session.child?.kill("SIGKILL");
    }
  }, KILL_GRACE_MS);

  // Mark stopped immediately for SSE clients
  session.status = "stopped";
  session.finished = true;

  const elapsedSec = parseFloat(
    ((Date.now() - session.startedAt) / 1000).toFixed(1),
  );

  dbUpdateSession(sessionId, {
    status: "stopped",
    elapsedSec,
    completedAt: new Date(),
  });

  emitHPOEvent(session, "hpo-stopped", {
    message: "HPO session stopped by user",
    elapsedSec,
    completedTrials: session.completedTrials,
  });

  return true;
}

/**
 * Get an active or recently-finished HPO session by ID.
 * Returns the in-memory state (events, listeners, process handle).
 */
export function getSession(
  sessionId: string,
): HPOSessionState | undefined {
  return activeSessions.get(sessionId);
}

/** List all active (running/pending) HPO sessions. */
export function listActiveSessions(): HPOSessionState[] {
  return Array.from(activeSessions.values()).filter(
    (s) => !s.finished,
  );
}

/**
 * Retrieve full session + trial data from SQLite for a given session ID.
 * Useful for historical queries and the session detail page.
 */
export function getSessionResults(
  sessionId: string,
): { session: HpoSession; trials: HpoTrial[] } | null {
  const session = db
    .select()
    .from(hpoSessions)
    .where(eq(hpoSessions.sessionId, sessionId))
    .get();

  if (!session) return null;

  const trials = db
    .select()
    .from(hpoTrials)
    .where(eq(hpoTrials.sessionId, sessionId))
    .orderBy(hpoTrials.trialId)
    .all();

  return { session, trials };
}

/**
 * List past HPO sessions from the database with optional filters.
 * Returns rows ordered by most recent first.
 */
export function listPastSessions(opts?: {
  modelType?: string;
  symbol?: string;
  limit?: number;
}): HpoSession[] {
  const conditions = [];
  if (opts?.modelType)
    conditions.push(eq(hpoSessions.modelType, opts.modelType));
  if (opts?.symbol) conditions.push(eq(hpoSessions.symbol, opts.symbol));

  let query = db
    .select()
    .from(hpoSessions)
    .orderBy(desc(hpoSessions.startedAt));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  if (opts?.limit) {
    query = query.limit(opts.limit) as typeof query;
  }

  return query.all();
}

/**
 * Extract the best hyperparameters from a completed HPO session.
 *
 * Returns the model type and merged hyperparameters (fixed + best found)
 * ready to feed into a new training run.
 *
 * @throws {Error} If session not found or has no best params.
 */
export function applyBestParams(
  sessionId: string,
): { modelType: string; hyperparameters: Record<string, any> } {
  const row = db
    .select()
    .from(hpoSessions)
    .where(eq(hpoSessions.sessionId, sessionId))
    .get();

  if (!row) {
    throw new Error(`HPO session ${sessionId} not found`);
  }

  if (!row.bestParams) {
    throw new Error(
      `HPO session ${sessionId} has no best params (status=${row.status})`,
    );
  }

  const bestParams = JSON.parse(row.bestParams) as Record<string, any>;
  const fixed = row.fixedHyperparameters
    ? (JSON.parse(row.fixedHyperparameters) as Record<string, any>)
    : {};

  // Merge: fixed params as base, best (optimised) params override
  const merged = { ...fixed, ...bestParams };

  console.log(
    `[hpo] applyBestParams for session ${sessionId} — modelType=${row.modelType}, ` +
      `bestScore=${row.bestScore}, paramCount=${Object.keys(merged).length}`,
  );

  return {
    modelType: row.modelType,
    hyperparameters: merged,
  };
}

// ─── NestJS Injectable Service ───────────────────────────────────────────────

/**
 * NestJS Injectable facade for the HPO service.
 *
 * Thin wrapper that delegates to the standalone functions above,
 * allowing controllers to inject via NestJS DI while keeping the
 * business logic framework-agnostic.
 */
@Injectable()
export class HpoService {
  /** Start a new HPO session. Returns immediately with session ID. */
  startHPO(request: HPORequest): Promise<{ sessionId: string }> {
    return startHPO(request);
  }

  /** Stop an active HPO session by ID. */
  stopHPO(sessionId: string): boolean {
    return stopHPO(sessionId);
  }

  /** Get an active/recent HPO session's in-memory state. */
  getSession(sessionId: string): HPOSessionState | undefined {
    return getSession(sessionId);
  }

  /** List all currently running HPO sessions. */
  listActiveSessions(): HPOSessionState[] {
    return listActiveSessions();
  }

  /** Get full session + trial results from the database. */
  getSessionResults(
    sessionId: string,
  ): { session: HpoSession; trials: HpoTrial[] } | null {
    return getSessionResults(sessionId);
  }

  /** List past HPO sessions from the database with optional filters. */
  listPastSessions(opts?: {
    modelType?: string;
    symbol?: string;
    limit?: number;
  }): HpoSession[] {
    return listPastSessions(opts);
  }

  /** Extract best params from a completed session for a new training run. */
  applyBestParams(
    sessionId: string,
  ): { modelType: string; hyperparameters: Record<string, any> } {
    return applyBestParams(sessionId);
  }
}
