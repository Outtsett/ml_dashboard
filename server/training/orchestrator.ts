/**
 * Training Orchestrator — Universal entry point for all model training.
 *
 * Think of it as: a dispatch center. You tell it "train model X on symbol Y"
 * and it figures out which runner to use, exports the data if needed,
 * merges configs, and streams standardized events back.
 *
 * Replaces the model-specific training logic spread across regime.ts and ml.ts
 * with a single, model-agnostic coordinator.
 */

import type {
  TrainingRequest,
  TrainingSession,
  TrainingEvent,
  ResolvedTrainingConfig,
} from "@shared/trainingTypes";
import {
  getModelConfig,
  getTrainingConfig,
  resolveHyperparameters,
  timeframeToSeconds,
} from "./registry";
import { exportTrainingData, cleanupDataFile } from "./dataExporter";
import { emitSessionEvent } from "./runners/types";
import { PythonRunner } from "./runners/pythonRunner";
import { TfjsRunner } from "./runners/tfjsRunner";
import type { ITrainerRunner } from "./runners/types";

// ─── Runner instances (singletons) ───────────────────────────────────────────

const runners: Record<string, ITrainerRunner> = {
  python: new PythonRunner(),
  tfjs: new TfjsRunner(),
};

// ─── Active sessions index ───────────────────────────────────────────────────

const activeSessions = new Map<string, { session: TrainingSession; runner: ITrainerRunner; config: ResolvedTrainingConfig }>();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start training for any model type.
 * Returns the session ID + model ID for SSE stream connection.
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
  const sym = request.symbol.toUpperCase();
  const modelId = `${sym}_${request.timeframe}`;
  const timeframeSec = timeframeToSeconds(request.timeframe);
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

  const resolved: ResolvedTrainingConfig = {
    modelType: request.modelType,
    registry,
    symbol: sym,
    timeframe: request.timeframe,
    timeframeSec,
    dateRange: request.dateRange,
    hyperparameters,
    featurePipeline: registry.featurePipeline,
    outputDir: registry.outputDir,
    modelId,
    includeIndicators: request.includeIndicators,
    indicatorGroups: request.indicatorGroups,
  };

  // 4. Export data if needed (Python runners need a parquet file)
  if (registry.requiresDataExport) {
    console.log(`[training] Exporting data for ${modelId}...`);
    try {
      const exportResult = await exportTrainingData(sym, request.timeframe, request.dateRange);
      resolved.dataFile = exportResult.dataFile;

      // Update date range from actual export (may differ from request)
      if (!resolved.dateRange) {
        resolved.dateRange = exportResult.dateRange;
      }

      console.log(`[training] Exported ${exportResult.totalBars} bars to ${exportResult.dataFile}`);
    } catch (err: any) {
      throw new Error(`Data export failed: ${err.message}`);
    }
  }

  // 5. Select runner
  const runner = runners[registry.runner];
  if (!runner) {
    throw new Error(`No runner available for type: ${registry.runner}`);
  }

  // 6. Start training
  console.log(`[training] Starting ${request.modelType} training for ${modelId} via ${registry.runner} runner`);
  const session = await runner.start(resolved);

  // Emit started event with chart alignment info
  emitSessionEvent(session, "started", {
    sessionId: session.sessionId,
    modelType: request.modelType,
    symbol: sym,
    timeframe: request.timeframe,
    dateRange: resolved.dateRange ?? null,
    modelId,
  });

  // 7. Track session
  activeSessions.set(modelId, { session, runner, config: resolved });

  // Clean up data file when training finishes
  if (resolved.dataFile) {
    const dataFile = resolved.dataFile;
    const checkCleanup = () => {
      if (session.finished) {
        cleanupDataFile(dataFile);
      } else {
        setTimeout(checkCleanup, 5000);
      }
    };
    setTimeout(checkCleanup, 5000);
  }

  return { sessionId: session.sessionId, modelId };
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
