/**
 * Training Orchestrator — Model-agnostic dispatch center.
 *
 * The server's only job: resolve config, spawn the runner, stream events back.
 * Each model's script handles its own data loading — no server-side export blocking.
 */

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
  const modelId = `${sym}_${tf}_${request.modelType}`;
  const timeframeSec = timeframeToSeconds(tf);
  const hyperparameters = resolveHyperparameters(
    registry.defaultHyperparameters,
    request.hyperparameters,
  );

  // Check if already training this model
  const existing = activeSessions.get(modelId);
  if (existing && !existing.session.finished) {
    throw new Error(`Already training ${modelId}. Stop it first.`);
  }
  if (existing) {
    activeSessions.delete(modelId);
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

  // 5. Launch background pipeline: export (if needed) → spawn runner
  //    The API returns NOW — progress streams over SSE.
  launchTrainingPipeline(session, runner, resolved, registry, trainingCfg, request).catch(err => {
    console.error(`[training] Pipeline failed for ${modelId}:`, err);
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

  // Start runner, passing existing session so it reuses our listeners/events
  console.log(`[training] Starting ${request.modelType} for ${modelId} via ${registry.runner} runner`);
  await runner.start(resolved, session);
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
