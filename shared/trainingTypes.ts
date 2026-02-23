/**
 * Universal Training Types — The contract between server and client.
 *
 * These types define how any model type communicates during training:
 * what the client sends to start training, what SSE events look like,
 * and what the training state shape is on the client.
 *
 * JSON config files (config/models.json etc.) are the source of truth
 * for model definitions. These types describe the runtime protocol.
 */

// ─── Runner Types ────────────────────────────────────────────────────────────

export type TrainerRunner = 'python' | 'tfjs';

// ─── Config File Shapes (mirrors config/*.json) ─────────────────────────────

export interface HyperparameterDef {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
}

export interface ModelRegistryEntry {
  name: string;
  category: string;
  subcategory: string;
  runner: TrainerRunner;
  script?: string;                // Python runner: path to training script
  featurePipeline: string;        // key in features.json
  outputs: string[];              // what this model produces
  chartOverlay: string;           // how it paints on the chart
  outputDir: string;              // where results are saved
  requiresDataExport: boolean;    // Python models need parquet export
  defaultHyperparameters: Record<string, HyperparameterDef>;
}

export interface ModelRegistry {
  version: number;
  models: Record<string, ModelRegistryEntry>;
}

export interface TrainingConfig {
  paths: {
    pythonExe: string;
    modelsDir: string;
    indicatorsDir: string;
    marketDb: string;
  };
  limits: {
    maxConcurrentJobs: number;
    maxBarsDefault: number;
    maxTrainingDurationSec?: number;
    jobRetentionSec: number;
  };
  timeframes: Record<string, number>;
}

// ─── Training Request (client → server) ──────────────────────────────────────

export interface TrainingRequest {
  modelType: string;             // key in models.json: "hdp-hmm", "cnn-universal"
  symbol: string;                // from chart context
  timeframe: string;             // from chart context: "30m", "1h"
  dateRange?: {
    start: string;               // ISO date string
    end: string;
  };
  hyperparameters?: Record<string, number | string | boolean>;
  includeIndicators?: boolean;
  indicatorGroups?: string;
}

// ─── Standardized SSE Event Types ────────────────────────────────────────────

export type TrainingEventType =
  | 'started'
  | 'progress'
  | 'metric'
  | 'overlay'
  | 'log'
  | 'done'
  | 'error';

export interface TrainingEvent {
  type: TrainingEventType;
  data: Record<string, unknown>;
  ts: number;
}

// ── training:started — chart alignment info
export interface StartedPayload {
  sessionId: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  dateRange: { start: string; end: string };
  totalBars: number;
}

// ── training:progress — phase-level progress
export interface ProgressPayload {
  phase: string;        // 'exporting' | 'features' | 'training' | 'validation' | 'saving'
  step: number;
  totalSteps: number;
  pct: number;          // 0-100
  message: string;
}

// ── training:metric — per-iteration model metrics
export interface MetricPayload {
  iteration: number;
  totalIterations: number;
  metrics: Record<string, number>;
}

// ── training:overlay — chart overlay updates
export interface OverlayPayload {
  overlayType: string;  // 'regime_colors' | 'prediction_markers' | 'anomaly_scores'
  timestamps?: number[];
  assignments?: number[];
  payload?: unknown;
}

// ── training:done
export interface DonePayload {
  modelId: string;
  elapsedSec: number;
  diagnostics?: unknown;
}

// ── training:error
export interface ErrorPayload {
  message: string;
  details?: string;
}

// ─── Resolved Config (after merging defaults + overrides + chart context) ────

export interface ResolvedTrainingConfig {
  modelType: string;
  registry: ModelRegistryEntry;
  symbol: string;
  timeframe: string;
  timeframeSec: number;
  dateRange?: { start: string; end: string };
  hyperparameters: Record<string, number | string | boolean>;
  featurePipeline: string;
  outputDir: string;
  modelId: string;              // e.g. "ES_30m"
  dataFile?: string;            // path to exported parquet (Python runners)
  includeIndicators?: boolean;
  indicatorGroups?: string;
}

// ─── Training Session (server-side state per active job) ─────────────────────

export interface TrainingSession {
  sessionId: string;
  modelType: string;
  modelId: string;
  symbol: string;
  timeframe: string;
  startedAt: number;
  events: TrainingEvent[];
  listeners: Set<(event: TrainingEvent) => void>;
  finished: boolean;
  exitCode: number | null;
}

// ─── Client-Side Training State ──────────────────────────────────────────────

export interface UniversalTrainingState {
  // What's being trained
  modelType: string | null;
  sessionId: string | null;
  modelId: string | null;

  // Status
  isTraining: boolean;
  phase: string;
  progress: number;             // 0-100

  // Config
  config: TrainingRequest | null;

  // Live data
  logs: string[];
  metrics: Record<string, number>;
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;

  // Chart alignment
  dataRange: { start: string; end: string } | null;
  totalBars: number;
  overlayType: string | null;
  overlayData: OverlayPayload | null;

  // Live regime overlay (populated during HDP-HMM or any regime-producing model)
  liveRegimeTimestamps: number[];
  liveRegimeAssignments: number[];

  // Results
  error: string | null;
  completedModelId: string | null;
  diagnostics: unknown | null;
  elapsedSec: number;

  // Actions
  startTraining: (request: TrainingRequest) => Promise<void>;
  stopTraining: () => void;
}
