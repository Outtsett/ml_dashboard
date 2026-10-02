import { Injectable, Logger } from "@nestjs/common";
import crypto from "crypto";
import type { ChildProcess } from "child_process";
import { eq, desc } from "drizzle-orm";
import { db } from "../../infrastructure/database/db";
import {
  hpoSessions,
  type HpoSession,
} from "@shared/schema";
import {
  hpoRequestSchema,
  type HPORequest,
} from "@shared/hpoTypes";
import { HPOSessionState } from "./types";
import { 
  dbCreateSession, 
  dbUpdateSession, 
  dbGetSessionResults 
} from "./storage";
import { 
  spawnHPORunner, 
  parseAndDispatch, 
  emitHPOEvent,
  getNTrials,
  getDirection,
  getTimeout
} from "./runner";
import { getTrainingConfig } from "../registry";

const logger = new Logger("HPO");

/** Maximum number of concurrent HPO sessions. */
const MAX_CONCURRENT_HPO_SESSIONS = 1;

/** Grace period (ms) between SIGTERM and SIGKILL when stopping a session. */
const KILL_GRACE_MS = 30_000;

/** How long (ms) to keep finished sessions in-memory for SSE reconnection. */
const SESSION_RETENTION_MS = 3_600_000; // 1 hour

/** Module-level registry of active / recently-finished HPO sessions. */
const activeSessions = new Map<string, HPOSessionState>();

/**
 * Start a new HPO session.
 */
export async function startHPO(
  request: HPORequest,
): Promise<{ sessionId: string }> {
  // Validate request
  const parsed = hpoRequestSchema.safeParse(request);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid HPO request: ${issues}`);
  }

  // Enforce concurrency limit
  const runningCount = Array.from(activeSessions.values()).filter(
    (s) => s.status === "running" || s.status === "pending",
  ).length;

  if (runningCount >= MAX_CONCURRENT_HPO_SESSIONS) {
    throw new Error(
      `HPO concurrency limit reached (${MAX_CONCURRENT_HPO_SESSIONS}). ` +
        `Stop an active session before starting a new one.`,
    );
  }

  const sessionId = crypto.randomUUID();
  const nTrials = getNTrials(request);
  
  logger.log(
    `Starting HPO session ${sessionId} � model=${request.modelType}, symbol=${request.symbol}, ` +
      `optimizer=${request.optimizer.type}, nTrials=${nTrials}, metric=${request.objectiveMetric}`,
  );

  // Persist to SQLite
  const dbRow = dbCreateSession({
    sessionId,
    modelType: request.modelType,
    symbol: request.symbol,
    timeframe: request.timeframe ?? "1h",
    optimizerType: request.optimizer.type,
    optimizerConfig: JSON.stringify(request.optimizer.config),
    objectiveMetric: request.objectiveMetric,
    objectiveDirection: getDirection(request),
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

  // Create in-memory state
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

  try {
    const child = spawnHPORunner(session, request);
    session.child = child;
    attachProcessHandlers(session, child, request);
  } catch (err) {
    session.status = "failed";
    session.finished = true;
    const msg = err instanceof Error ? err.message : String(err);
    dbUpdateSession(sessionId, { status: "failed", errorMessage: msg });
    activeSessions.delete(sessionId);
    throw err;
  }

  return { sessionId };
}

/** Stop an active HPO session. */
export function stopHPO(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session || session.finished || !session.child) return false;

  logger.log(`Stopping HPO session ${sessionId}`);
  session.status = "stopped";
  session.finished = true;

  // SIGTERM -> grace -> SIGKILL
  session.child.kill("SIGTERM");
  setTimeout(() => {
    if (session.child && !session.child.killed) {
      session.child.kill("SIGKILL");
    }
  }, KILL_GRACE_MS);

  dbUpdateSession(sessionId, {
    status: "stopped",
    completedAt: new Date(),
  });

  emitHPOEvent(session, "hpo-stopped", { message: "User stopped the session" });
  scheduleCleanup(session);

  return true;
}

export function getSession(sessionId: string): HPOSessionState | undefined {
  return activeSessions.get(sessionId);
}

export function listActiveSessions(): HPOSessionState[] {
  return Array.from(activeSessions.values());
}

export function getSessionResults(sessionId: string) {
  return dbGetSessionResults(sessionId);
}

export function listPastSessions(opts?: {
  modelType?: string;
  symbol?: string;
  limit?: number;
}): HpoSession[] {
  let query = db.select().from(hpoSessions).$dynamic();

  if (opts?.modelType) {
    query = query.where(eq(hpoSessions.modelType, opts.modelType));
  }
  if (opts?.symbol) {
    query = query.where(eq(hpoSessions.symbol, opts.symbol));
  }

  return query
    .orderBy(desc(hpoSessions.startedAt))
    .limit(opts?.limit ?? 50)
    .all();
}

export function applyBestParams(sessionId: string) {
  const results = dbGetSessionResults(sessionId);
  if (!results || !results.session.bestParams) {
    throw new Error(`No best parameters found for session ${sessionId}`);
  }

  return {
    modelType: results.session.modelType,
    hyperparameters: JSON.parse(results.session.bestParams),
  };
}

function attachProcessHandlers(
  session: HPOSessionState,
  child: ChildProcess,
  request: HPORequest,
): void {
  const timeoutSec = getTimeout(request);
  let stdoutBuffer = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) parseAndDispatch(session, trimmed);
    }
  });

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

  const timeoutHandle = setTimeout(() => {
    if (!session.finished) {
      logger.warn(`Session ${session.sessionId} timeout, sending SIGTERM`);
      child.kill("SIGTERM");
      emitHPOEvent(session, "hpo-timeout", {
        message: `HPO timed out after ${timeoutSec}s`,
        timeoutSec,
      });
      setTimeout(() => {
        if (!session.finished) child.kill("SIGKILL");
      }, KILL_GRACE_MS);
    }
  }, timeoutSec * 1000);

  child.on("close", (code: number | null) => {
    clearTimeout(timeoutHandle);
    if (session.finished) {
      scheduleCleanup(session);
      return;
    }
    session.finished = true;
    const elapsedSec = parseFloat(((Date.now() - session.startedAt) / 1000).toFixed(1));

    if (code !== 0) {
      session.status = "failed";
      dbUpdateSession(session.sessionId, {
        status: "failed",
        elapsedSec,
        errorMessage: `HPO process exited with code ${code}`,
        completedAt: new Date(),
      });
      emitHPOEvent(session, "hpo-error", { message: `HPO process exited with code ${code}` });
    } else {
      session.status = "completed";
      dbUpdateSession(session.sessionId, { status: "completed", elapsedSec, completedAt: new Date() });
    }
    scheduleCleanup(session);
  });

  child.on("error", (err: Error) => {
    if (session.finished) return;
    session.finished = true;
    session.status = "failed";
    dbUpdateSession(session.sessionId, {
      status: "failed",
      errorMessage: err.message,
      completedAt: new Date(),
    });
    emitHPOEvent(session, "hpo-error", { message: err.message });
    scheduleCleanup(session);
  });
}

function scheduleCleanup(session: HPOSessionState): void {
  setTimeout(() => {
    activeSessions.delete(session.sessionId);
    logger.log(`Session ${session.sessionId} removed from memory`);
  }, SESSION_RETENTION_MS);
}

@Injectable()
export class HpoService {
  startHPO(request: HPORequest) { return startHPO(request); }
  stopHPO(sessionId: string) { return stopHPO(sessionId); }
  getSession(sessionId: string) { return getSession(sessionId); }
  listActiveSessions() { return listActiveSessions(); }
  getSessionResults(sessionId: string) { return getSessionResults(sessionId); }
  listPastSessions(opts?: Parameters<typeof listPastSessions>[0]) { return listPastSessions(opts); }
  applyBestParams(sessionId: string) { return applyBestParams(sessionId); }
}


