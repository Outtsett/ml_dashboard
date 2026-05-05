/**
 * Training Orchestrator — Model-agnostic dispatch center.
 *
 * The server's only job: resolve config, spawn the runner, stream events back.
 * Each model's script handles its own data loading — no server-side export blocking.
 */

import { Logger } from "@nestjs/common";
import type {
  TrainingRequest,
  TrainingSession,
  ResolvedTrainingConfig,
} from "@shared/trainingTypes";
import {
  getModelConfig,
  getTrainingConfig,
  resolveHyperparameters,
  timeframeToSeconds,
} from "./registry";
import { createSession, emitSessionEvent } from "./runners/types";
import { getRunner } from "./runnerFactory";
import type { ITrainerRunner } from "./runners/types";
import { generateVersionedModelId, getBaseModelId, appendWindowIndex } from "./versioning";
import * as trainingStorage from "../storage/trainingStorage";
import { computeWindows, generateGroupId } from "./walkforward";

const logger = new Logger("Training");

// ─── Active sessions index ───────────────────────────────────────────────────

const activeSessions = new Map<string, { session: TrainingSession; runner: ITrainerRunner; config: ResolvedTrainingConfig }>();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start training for any model type.
 * Returns immediately with session ID + model ID for SSE stream connection.
 * Data export (if needed) runs in the background, streaming progress via SSE.
 */
export async function startTraining(request: TrainingRequest): Promise<{
  sessionId: string;
  modelId: string;
}> {
  // 1. Look up model in registry
  const registry = getModelConfig(request.modelType);
  if (!registry) {
    throw new Error(`Unknown model type: ${request.modelType}. Check config/models.json.`);
  }

  const trainingCfg = getTrainingConfig();

  // 2. Check concurrent job limit
  let activeCount = 0;
  for (const entry of Array.from(activeSessions.values())) {
    if (!entry.session.finished) activeCount++;
  }
  if (activeCount >= trainingCfg.limits.maxConcurrentJobs) {
    throw new Error(`Maximum concurrent training jobs (${trainingCfg.limits.maxConcurrentJobs}) reached.`);
  }

  // 3. Resolve config: merge defaults + overrides + chart context
  if (!request.symbol) {
    throw new Error("Symbol is required. Select a symbol on the chart before training.");
  }
  const sym = request.symbol.toUpperCase();
  const tf = request.timeframe ?? "1m";
  const baseModelId = `${sym}_${tf}_${request.modelType}`;
  const modelId = generateVersionedModelId(sym, tf, request.modelType);
  const timeframeSec = timeframeToSeconds(tf);
  const hyperparameters = resolveHyperparameters(
    registry.defaultHyperparameters,
    request.hyperparameters,
  );

  // Check if already training this base model (prevents concurrent duplicate training)
  for (const [existingId, entry] of Array.from(activeSessions.entries())) {
    if (!entry.session.finished && getBaseModelId(existingId) === baseModelId) {
      throw new Error(`Already training ${baseModelId}. Stop it first.`);
    }
  }

  // Validate runner exists before creating session
  const runner = getRunner(registry.runner);
  if (!runner) {
    throw new Error(`No runner registered for type: "${registry.runner}". Register it in server startup.`);
  }

  const resolved: ResolvedTrainingConfig = {
    modelType: request.modelType,
    registry,
    symbol: sym,
    timeframe: tf,
    timeframeSec,
    dateRange: request.dateRange,
    hyperparameters,
    maxBars: request.maxBars,
    featureCategories: request.featureCategories ?? registry.featureCategories ?? undefined,
    featurePipeline: registry.featurePipeline,
    outputDir: registry.outputDir,
    modelId,
    includeIndicators: request.includeIndicators ?? registry.includeIndicators ?? false,
    allFeatures: request.allFeatures ?? registry.allFeatures ?? false,
    indicatorGroups: request.indicatorGroups,
  };

  // 4. Create session immediately so SSE clients can connect right away
  const session = createSession(modelId, resolved);
  activeSessions.set(modelId, { session, runner, config: resolved });

  // Persist session to SQLite for crash recovery (DIP — storage abstraction)
  try {
    const dbSession = trainingStorage.createTrainingSession({
      modelName: baseModelId,
      modelType: request.modelType,
      symbol: sym,
      timeframe: tf,
      versionedModelId: modelId,
      maxEpochs: Number(hyperparameters.gibbsIter ?? hyperparameters.emIter ?? 100),
      learningRate: 0, // Not applicable for HMM models
      hyperparameters: hyperparameters as Record<string, unknown>,
      featureCategories: resolved.featureCategories,
    });
    session.dbSessionId = dbSession.id;
  } catch (err) {
    logger.error(`Failed to persist session to SQLite: ${err}`);
  }

  // 5. Launch background pipeline: export (if needed) → spawn runner
  //    The API returns NOW — progress streams over SSE.
  launchTrainingPipeline(session, runner, resolved, registry, trainingCfg, request).catch(err => {
    logger.error(`Pipeline failed for ${modelId}: ${err}`);
    if (!session.finished) {
      emitSessionEvent(session, "error", { message: err.message ?? "Training pipeline failed" });
      session.finished = true;
      session.exitCode = -1;
    }
  });

  return { sessionId: session.sessionId, modelId };
}

/** Background pipeline: export data → start runner. Progress is streamed via SSE. */
async function launchTrainingPipeline(
  session: TrainingSession,
  runner: ITrainerRunner,
  resolved: ResolvedTrainingConfig,
  registry: ResolvedTrainingConfig["registry"],
  trainingCfg: ReturnType<typeof getTrainingConfig>,
  request: TrainingRequest,
) {
  const { modelId, symbol: sym, timeframe: tf } = resolved;

  // If session was stopped before launch, bail
  if (session.finished) return;

  // Emit started event (runner is about to spawn — Python reads QuestDB directly)
  emitSessionEvent(session, "started", {
    sessionId: session.sessionId,
    modelType: request.modelType,
    symbol: sym,
    timeframe: tf,
    dateRange: resolved.dateRange ?? null,
    modelId,
  });

  if (request.walkForward && resolved.dateRange) {
    // Walk-forward mode: N sequential windows
    await launchWalkForwardPipeline(session, runner, resolved, request);
  } else {
    // Single-run mode (original path)
    logger.log(`Starting ${request.modelType} for ${modelId} via ${registry.runner} runner`);
    await runner.start(resolved, session);
  }
}

/** Stop a training session by model ID */
export function stopTraining(modelId: string): boolean {
  const entry = activeSessions.get(modelId);
  if (!entry || entry.session.finished) return false;

  entry.runner.stop(entry.session.sessionId);
  setTimeout(() => activeSessions.delete(modelId), 10000);
  return true;
}

/** Get a training session by model ID */
export function getTrainingSession(modelId: string): TrainingSession | undefined {
  return activeSessions.get(modelId)?.session;
}

/** List all active/recent training sessions */
export function listTrainingSessions(): Array<{
  modelId: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  elapsed: number;
  finished: boolean;
  eventCount: number;
}> {
  const result: Array<{
    modelId: string;
    modelType: string;
    symbol: string;
    timeframe: string;
    elapsed: number;
    finished: boolean;
    eventCount: number;
  }> = [];

  for (const [modelId, entry] of Array.from(activeSessions.entries())) {
    result.push({
      modelId,
      modelType: entry.session.modelType,
      symbol: entry.session.symbol,
      timeframe: entry.session.timeframe,
      elapsed: (Date.now() - entry.session.startedAt) / 1000,
      finished: entry.session.finished,
      eventCount: entry.session.events.length,
    });
  }

  return result;
}

/** Walk-forward pipeline: spawn N sequential training windows. */
async function launchWalkForwardPipeline(
  session: TrainingSession,
  runner: ITrainerRunner,
  resolved: ResolvedTrainingConfig,
  request: TrainingRequest,
) {
  const { start: dateStart, end: dateEnd } = resolved.dateRange!;
  const windows = computeWindows(dateStart, dateEnd, request.walkForward!);
  const groupId = generateGroupId();

  emitSessionEvent(session, "log", {
    message: `Walk-forward: ${windows.length} windows (${request.walkForward!.trainMonths}m train / ${request.walkForward!.testMonths}m test)`,
    level: "info",
  });

  for (const window of windows) {
    if (session.finished) break; // User stopped training

    const windowModelId = appendWindowIndex(resolved.modelId, window.index);

    emitSessionEvent(session, "walk-forward-window-start", {
      window: window.index,
      totalWindows: windows.length,
      trainRange: { start: window.trainStart, end: window.trainEnd },
      testRange: { start: window.testStart, end: window.testEnd },
    });

    // Persist walk-forward window session to SQLite
    try {
      trainingStorage.createTrainingSession({
        modelName: resolved.modelId,
        modelType: request.modelType,
        symbol: resolved.symbol,
        timeframe: resolved.timeframe,
        versionedModelId: windowModelId,
        maxEpochs: Number(resolved.hyperparameters.gibbsIter ?? resolved.hyperparameters.emIter ?? 100),
        learningRate: 0,
        hyperparameters: resolved.hyperparameters as Record<string, unknown>,
        featureCategories: resolved.featureCategories,
        walkForwardGroupId: groupId,
        windowIndex: window.index,
      });
    } catch (err) {
      logger.error(`Failed to persist WF window session: ${err}`);
    }

    // Per-window config with window-specific date range
    const windowConfig: ResolvedTrainingConfig = {
      ...resolved,
      modelId: windowModelId,
      dateRange: { start: window.trainStart, end: window.testEnd },
    };

    logger.log(`WF window ${window.index}/${windows.length}: ${window.trainStart}->${window.testEnd}`);
    await runner.start(windowConfig, session);

    emitSessionEvent(session, "walk-forward-window-done", {
      window: window.index,
      totalWindows: windows.length,
    });
  }

  // Emit walk-forward summary
  emitSessionEvent(session, "walk-forward-summary", {
    groupId,
    totalWindows: windows.length,
    windows: windows.map(w => ({
      index: w.index,
      trainRange: { start: w.trainStart, end: w.trainEnd },
      testRange: { start: w.testStart, end: w.testEnd },
    })),
  });
}
