/**
 * Training Types — The contract between server and client.
 *
 * These types define how any model type communicates during training:
 * what the client sends to start training, what SSE events look like,
 * and what the training state shape is on the client.
 *
 * JSON config files (config/models.json etc.) are the source of truth
 * for model definitions. These types describe the runtime protocol.
 */

// ─── Runner Types ────────────────────────────────────────────────────────────

export type TrainerRunner = 'python';

// ─── Config File Shapes (mirrors config/*.json) ─────────────────────────────

export interface HyperparameterDef {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  /** Parameter data type (default inferred from step: step>=1 → int, else float) */
  type?: 'int' | 'float' | 'categorical' | 'bool';
  /** Whether to sample in log space during HPO */
  logScale?: boolean;
  /** Valid choices for categorical parameters */
  choices?: (string | number | boolean)[];
  /** Tooltip / help text */
  description?: string;
  /** UI grouping (e.g. "Architecture", "Training", "Regularization") */
  group?: string;
  /** Only show this param when another param has a specific value */
  conditionalOn?: { param: string; value: string | number | boolean };
  /** HPO-specific search range (may differ from manual slider range) */
  searchSpace?: {
    min?: number;
    max?: number;
    step?: number;
    logScale?: boolean;
    distribution?: 'uniform' | 'loguniform' | 'normal' | 'choice';
  };
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
  defaultHyperparameters: Record<string, HyperparameterDef>;
  featureCategories?: string[] | null;  // feature category filter (null = all)
  includeIndicators?: boolean;    // default for including pre-computed indicators
  allFeatures?: boolean;          // default for using all available features
  cliFlags?: Record<string, string>;  // hyperparameter name → CLI flag mapping (OCP)
  /** Links to model catalog spec file */
  catalogId?: string;
  /** Model description */
  description?: string;
  /** Reference paper URL */
  paperUrl?: string;
  /** Searchable tags (e.g. ["bayesian", "regime-detection", "unsupervised"]) */
  tags?: string[];
  /** Model family for template matching */
  family?: 'sklearn' | 'pytorch' | 'xgboost' | 'lightgbm' | 'catboost' | 'transformer' | 'custom';
  /** Whether model requires GPU */
  gpuRequired?: boolean;
  /** Estimated training time (e.g. "5-30 min per trial") */
  estimatedTrainingTime?: string;
  /** Supported optimization objectives (e.g. ["log_likelihood", "silhouette_score"]) */
  supportedObjectives?: string[];
  /** Reference to model-templates.json */
  templateId?: string;
}

export interface ModelRegistry {
  version: number;
  models: Record<string, ModelRegistryEntry>;
}

export interface TrainingConfig {
  paths: {
    pythonExe: string;
    modelsDir: string;
  };
  limits: {
    maxConcurrentJobs: number;
    maxBarsDefault: number;
    maxTrainingDurationSec?: number;
    jobRetentionSec: number;
  };
  timeframes: Record<string, number>;
  /** Stderr substrings to suppress from training log output (OCP: extend via training.json) */
  stderrSuppressPatterns?: string[];
}

// ─── Training Request (client → server) ──────────────────────────────────────

export interface TrainingRequest {
  modelType: string;             // key in models.json
  symbol: string;                // required — comes from dashboard chart selection
  timeframe?: string;            // optional — server uses registry default if omitted
  dateRange?: {
    start: string;               // ISO date string
    end: string;
  };
  hyperparameters?: Record<string, number | string | boolean>;
  maxBars?: number;              // 0 = use all available data, undefined = use config default
  featureCategories?: string[];  // override model's default feature categories
  includeIndicators?: boolean;
  allFeatures?: boolean;
  indicatorGroups?: string;
  walkForward?: {
    trainMonths: number;
    testMonths: number;
    stepMonths?: number;
  };
  /** Training optimization mode (defaults to 'manual') */
  optimizationMode?: 'manual' | 'hpo';
}

// ─── Standardized SSE Event Types ────────────────────────────────────────────

export type TrainingEventType =
  | 'started'
  | 'progress'
  | 'metric'
  | 'overlay'
  | 'log'
  | 'done'
  | 'error'
  | 'walk-forward-window-start'
  | 'walk-forward-window-done'
  | 'walk-forward-summary'
  | 'hpo-trial-start'
  | 'hpo-trial-done'
  | 'hpo-trial-pruned'
  | 'hpo-best-update'
  | 'hpo-complete'
  | 'model_state'
  | 'sampler_diagnostics';

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
  phase: string;        // 'features' | 'training' | 'validation' | 'saving'
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

// ── hpo:trial-start — HPO trial began
export interface HPOTrialStartPayload {
  trialId: number;
  params: Record<string, number | string | boolean>;
}

// ── hpo:trial-done — HPO trial finished (or pruned)
export interface HPOTrialDonePayload {
  trialId: number;
  params: Record<string, number | string | boolean>;
  score: number;
  metrics: Record<string, number>;
  duration: number;
  pruned: boolean;
}

// ── hpo:best-update — new best trial found
export interface HPOBestUpdatePayload {
  trialId: number;
  bestScore: number;
  bestParams: Record<string, number | string | boolean>;
}

// ── hpo:complete — HPO study finished
export interface HPOCompletePayload {
  totalTrials: number;
  bestTrialId: number;
  bestScore: number;
  bestParams: Record<string, number | string | boolean>;
  elapsedSec: number;
}

// ── training:model_state — full model snapshot (emission params, transitions, regime profiles, SHAP, quality)
export interface ModelStatePayload {
  iteration: number;
  total: number;
  snapshot: {
    emission_heatmap: number[][];
    transition_matrix: number[][];
    beta_weights: number[];
    regime_profiles: Array<{
      regime_id: number;
      label: string;
      mean_return: number;
      volatility: number;
      sharpe: number;
      bar_count: number;
      bar_pct: number;
      mean_dwell: number;
      max_dwell: number;
      transition_targets: Array<{ to: number; prob: number }>;
    }>;
    assignment_confidence: number[];  // 10-bin histogram
    feature_names: string[];
    feature_attribution: {
      per_regime: Array<{
        regime_id: number;
        features: Array<{ feature: string; importance: number }>;
      }>;
      global: Array<{ feature: string; importance: number }>;
      interactions: Array<{ f1: string; f2: string; score: number }>;
      dead_features: string[];
    };
    cluster_quality: {
      silhouette: number;
      calinski_harabasz: number;
      davies_bouldin: number;
      ari_vs_previous: number | null;
      return_separation_pvalues: Array<{ pair: string; p_value: number }>;
      bhattacharyya_distances: number[][];
    };
    quality_gates: Array<{
      metric: string;
      value: number;
      status: 'pass' | 'fail' | 'warn';
      recommendation: string | null;
    }>;
  };
}

// ── training:sampler_diagnostics — ESS, autocorrelation, step timing
export interface SamplerDiagnosticsPayload {
  iteration: number;
  total: number;
  diagnostics: {
    ess: number;
    autocorrelation_lag1: number;
    step_timing: {
      ffbs_ms: number;
      emission_ms: number;
      transition_ms: number;
    };
  };
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
  maxBars?: number;             // 0 = use all available data, undefined = use config default
  featureCategories?: string[];  // feature category filter (undefined = all)
  featurePipeline: string;
  outputDir: string;
  modelId: string;              // e.g. "ES_30m"
  includeIndicators?: boolean;
  allFeatures?: boolean;
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
  /** SQLite row ID for metric persistence and session finalization */
  dbSessionId?: number;
}

/** Shape of the diagnostics JSON written by Python training scripts */
export interface TrainingDiagnostics {
  quality_score?: number;
  evaluation?: {
    grade?: string;
    tests?: Array<{ name: string; passed: boolean; pValue?: number }>;
  };
  num_regimes?: number;
  log_likelihood?: number;
  convergence?: Record<string, number[]>;
  [key: string]: unknown;
}

// ─── Client-Side Training State ──────────────────────────────────────────────

export interface TrainingState {
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

  // Model state snapshots (every 25-50 iterations)
  modelState: ModelStatePayload | null;
  modelStateHistory: Array<{ iteration: number; state: ModelStatePayload }>;

  // Chart alignment
  dataRange: { start: string; end: string } | null;
  totalBars: number;
  overlayType: string | null;
  overlayData: OverlayPayload | null;

  // Live regime overlay (populated during any regime-producing model)
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

/** Control plane — user actions + session status. Changes ~10x per run. */
export interface TrainingControl {
  isTraining: boolean;
  isPending: boolean;
  phase: string;
  progress: number;
  error: string | null;
  startTraining: (request: TrainingRequest) => Promise<void>;
  stopTraining: () => void;
  selectedModelType: string;
  setSelectedModelType: (type: string) => void;
  availableModels: Record<string, ModelRegistryEntry>;
  completedModelId: string | null;
  config: TrainingRequest | null;
  timeframeLabel: string;
  modelType: string | null;
  sessionId: string | null;
  modelId: string | null;
}

/** Live data plane — metrics, overlays, logs. Changes ~500x per run. */
export interface TrainingLive {
  metrics: Record<string, number>;
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;
  logs: string[];
  liveRegimeTimestamps: number[];
  liveRegimeAssignments: number[];
  overlayData: OverlayPayload | null;
  overlayType: string | null;
  elapsedSec: number;
  totalBars: number;
  dataRange: { start: string; end: string } | null;
  diagnostics: unknown | null;
  modelState: ModelStatePayload | null;
  modelStateHistory: Array<{ iteration: number; state: ModelStatePayload }>;
}

// ── Granular sub-slices of TrainingLive ───────────────────────────────────────
// Split by consumer need so components only re-render for the data they read.

/** Metrics sub-slice — per-iteration numeric data. Updates every iteration. */
export interface TrainingMetricsSlice {
  metrics: Record<string, number>;
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;
}

/** Logs sub-slice — append-only log lines. Updates on every log event. */
export interface TrainingLogsSlice {
  logs: string[];
}

/** Overlays sub-slice — chart overlays + session metadata. Updates sporadically. */
export interface TrainingOverlaysSlice {
  liveRegimeTimestamps: number[];
  liveRegimeAssignments: number[];
  overlayData: OverlayPayload | null;
  overlayType: string | null;
  elapsedSec: number;
  totalBars: number;
  dataRange: { start: string; end: string } | null;
  diagnostics: unknown | null;
}

/** Model state sub-slice — full model snapshots. Updates every 25-50 iterations. */
export interface TrainingModelStateSlice {
  modelState: ModelStatePayload | null;
  modelStateHistory: Array<{ iteration: number; state: ModelStatePayload }>;
}
