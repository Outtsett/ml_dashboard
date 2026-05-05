import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { Logger } from "@nestjs/common";
import type { HPORequest } from "@shared/hpoTypes";
import { getTrainingConfig } from "../registry";
import { HPOSessionState, HPOEvent } from "./types";
import { normalizeKeysToSnakeCase } from "./utils";
import { dbUpdateSession, dbInsertTrial, dbUpdateTrial } from "./storage";

const logger = new Logger("HPO-Runner");

/** Default HPO timeout (2h). */
const DEFAULT_TIMEOUT_SEC = 7200;

/** Extract objective direction from the optimizer config or default to 'minimize'. */
export function getDirection(request: HPORequest): string {
  const cfg = request.optimizer.config as unknown as Record<string, unknown>;
  return (cfg.direction as string) ?? "minimize";
}

/** Extract n_trials from the optimizer config. */
export function getNTrials(request: HPORequest): number {
  const cfg = request.optimizer.config as unknown as Record<string, unknown>;
  return (cfg.nTrials as number) ?? (cfg.nCalls as number) ?? 50;
}

/** Extract timeout from the optimizer config or use default. */
export function getTimeout(request: HPORequest): number {
  const cfg = request.optimizer.config as unknown as Record<string, unknown>;
  return (cfg.timeout as number) ?? DEFAULT_TIMEOUT_SEC;
}

/**
 * Emit an event to a session's connected SSE listeners and append to the
 * in-memory buffer so late-joining clients can replay history.
 */
export function emitHPOEvent(
  session: HPOSessionState,
  type: string,
  data: Record<string, unknown>,
): void {
  const evt: HPOEvent = { type, data, ts: Date.now() };
  session.events.push(evt);
  session.listeners.forEach((fn) => fn(evt));
}

/**
 * Build the Python command-line config object and spawn the HPO runner.
 * Returns the ChildProcess handle for lifecycle management.
 */
export function spawnHPORunner(
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
    optimizer_config: normalizeKeysToSnakeCase(request.optimizer.config as unknown as Record<string, unknown>),
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

  logger.log(
    `Spawning Python HPO runner: ${pythonExe} ${args.slice(0, 3).join(" ")} --config <${configPayload.length} bytes>`,
  );

  const child = spawn(pythonExe, args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  return child;
}

/**
 * Event dispatch table — maps Python event types to handler functions.
 */
const EVENT_HANDLERS: Record<
  string,
  (session: HPOSessionState, data: Record<string, unknown>) => void
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

function handleHPOStarted(session: HPOSessionState, data: Record<string, unknown>): void {
  session.status = "running";
  dbUpdateSession(session.sessionId, { status: "running" });

  logger.log(
    `Session ${session.sessionId} started — optimizer=${data.optimizer}, nTrials=${data.nTrials}`,
  );
}

function handleTrialStart(session: HPOSessionState, data: Record<string, unknown>): void {
  dbInsertTrial({
    sessionId: session.sessionId,
    trialId: data.trialId as number,
    status: "running",
    params: JSON.stringify(data.params ?? {}),
  });

  logger.log(
    `Session ${session.sessionId} trial ${data.trialId} started — params=${JSON.stringify(data.params)}`,
  );
}

function handleTrialDone(session: HPOSessionState, data: Record<string, unknown>): void {
  session.completedTrials += 1;

  dbUpdateTrial(session.sessionId, data.trialId as number, {
    status: "completed",
    score: (data.score as number) ?? undefined,
    metrics: data.metrics ? JSON.stringify(data.metrics) : undefined,
    durationSec: (data.durationSec as number) ?? undefined,
    iterationHistory: data.iterationHistory
      ? JSON.stringify(data.iterationHistory)
      : undefined,
    modelPath: (data.modelPath as string) ?? undefined,
    trainedModelId: (data.trainedModelId as string) ?? undefined,
    completedAt: new Date(),
  });

  dbUpdateSession(session.sessionId, {
    completedTrials: session.completedTrials,
  });

  logger.log(
    `Session ${session.sessionId} trial ${data.trialId} done — score=${data.score}, elapsed=${data.durationSec}s`,
  );
}

function handleTrialPruned(session: HPOSessionState, data: Record<string, unknown>): void {
  session.prunedTrials += 1;

  dbUpdateTrial(session.sessionId, data.trialId as number, {
    status: "pruned",
    score: (data.score as number) ?? undefined,
    pruned: 1,
    prunedAtStep: (data.prunedAtStep as number) ?? undefined,
    completedAt: new Date(),
  });

  dbUpdateSession(session.sessionId, {
    prunedTrials: session.prunedTrials,
  });

  logger.log(
    `Session ${session.sessionId} trial ${data.trialId} pruned at step ${data.prunedAtStep} — score=${data.score}`,
  );
}

function handleBestUpdate(session: HPOSessionState, data: Record<string, unknown>): void {
  session.bestScore = (data.bestScore as number) ?? null;
  session.bestParams = (data.bestParams as Record<string, unknown>) ?? null;

  dbUpdateSession(session.sessionId, {
    bestTrialId: data.trialId as number | undefined,
    bestScore: data.bestScore as number | undefined,
    bestParams: JSON.stringify(data.bestParams ?? {}),
  });

  logger.log(
    `Session ${session.sessionId} new best — trial=${data.trialId}, score=${data.bestScore}`,
  );
}

function handleHPOComplete(session: HPOSessionState, data: Record<string, unknown>): void {
  session.status = "completed";
  session.finished = true;

  const elapsedSec = parseFloat(
    ((Date.now() - session.startedAt) / 1000).toFixed(1),
  );

  dbUpdateSession(session.sessionId, {
    status: "completed",
    elapsedSec,
    completedAt: new Date(),
    completedTrials: (data.completedTrials as number) ?? session.completedTrials,
    prunedTrials: (data.prunedTrials as number) ?? session.prunedTrials,
    bestScore: (data.bestScore as number) ?? session.bestScore ?? undefined,
    bestParams: data.bestParams
      ? JSON.stringify(data.bestParams)
      : undefined,
  });

  logger.log(
    `Session ${session.sessionId} completed — bestScore=${data.bestScore}, totalTrials=${data.totalTrials}, elapsed=${elapsedSec}s`,
  );
}

function handleHPOError(session: HPOSessionState, data: Record<string, unknown>): void {
  const message = data.message ?? "Unknown HPO error";
  logger.error(`Session ${session.sessionId} error — ${message}`);
}

function handleHPOLog(session: HPOSessionState, data: Record<string, unknown>): void {
  const msg = data.message ?? data;
  logger.log(`Session ${session.sessionId} log — ${msg}`);
}

/**
 * Parse a single stdout line as JSON and dispatch to the appropriate handler.
 */
export function parseAndDispatch(session: HPOSessionState, line: string): void {
  let parsed: { type?: string; data?: Record<string, unknown> };
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }

  const { type, data } = parsed;
  if (!type) return;

  const payload = data ?? {};
  const handler = EVENT_HANDLERS[type];
  if (handler) {
    handler(session, payload);
  }

  emitHPOEvent(session, type, payload);
}
