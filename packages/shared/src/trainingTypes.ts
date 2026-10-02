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
  /** Default value for this hyperparameter */
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  /** Parameter data type */
  type: 'int' | 'float' | 'categorical' | 'bool' | 'string';
  /**
   * The Model Cycle's Optuna space for this parameter (`search` in
   * `packages/config/cycle_models/`): present exactly when the tuner searches it.
   * `kind` int/float carry low/high (log = sampled on a log scale); categorical carries choices.
   */
  search?:
    | { kind: 'int' | 'float'; low: number; high: number; log?: boolean }
    | { kind: 'categorical'; choices: (string | number | boolean)[] };
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
  /**
   * False when the model's script cannot possibly run on this machine — the
   * entry is kept as a record of intent, with `unavailableReason` naming what
   * is missing. The Train picker reads this to stop offering dead models.
   */
  available?: boolean;
  /** Why this entry is unavailable, shown next to the disabled option. */
  unavailableReason?: string;
  /** Reference to model-templates.json (null when no template matched). */
  templateId?: string | null;
  /** Self-describing metric declarations — defines what metrics this model produces */
  metricDeclarations?: Record<string, {
    renderer: string;
    mission: string;
    context: Record<string, unknown>;
    group?: string;
    order?: number;
  }>;
  /**
   * Extra CLI args pushed onto the runner's argv right after the script path,
   * before the standard `--symbol`/`--timeframe`/... flags (e.g. Model Cycle's
   * `["--model-family", "xgboost"]`). Composed from `RunnerEntry.scriptArgs`.
   */
  scriptArgs?: string[];
  /**
   * Overrides `TrainingConfig.limits.maxTrainingDurationSec` for this runner —
   * a paced bar-by-bar replay can legitimately run far longer than a normal
   * training job. Composed from `RunnerEntry.maxDurationSeconds`.
   */
  maxDurationSeconds?: number;
}

export interface ModelRegistry {
  version: number;
  models: Record<string, ModelRegistryEntry>;
}

// ─── Algorithm / Task / Runner Decomposition ─────────────────────────────────
//
// As of 2026-05-09, model definitions split into three orthogonal files:
//   - algorithms.json: pure architecture metadata (XGBoost, Two-Stream Transformer, …)
//   - tasks.json:      what the model is for (direction_classifier, range_classifier, …)
//   - runners.json:    the (algorithm, task) → script + hyperparameters wiring
//
// Composite key convention:  ${algorithm}+${task}   e.g. "xgboost+direction_classifier"
// `ModelRegistryEntry` is now a *derived* view composed at registry-load time.

export type AlgorithmId = string;   // e.g. "xgboost", "transformer_2s"
export type TaskId = string;        // e.g. "direction_classifier"
export type CompositeRunnerId = string; // `${AlgorithmId}+${TaskId}`

export interface AlgorithmEntry {
  name: string;
  family: 'sklearn' | 'pytorch' | 'xgboost' | 'lightgbm' | 'catboost' | 'transformer' | 'gradient_boosting' | 'hybrid' | 'custom';
  category: string;
  subcategory: string;
  /** Which task heads this algorithm can drive */
  supports: Array<'classification' | 'regression' | 'multi-head'>;
  gpuRequired?: boolean;
  catalogSpec?: string;
  description?: string;
  tags?: string[];
}

export interface TaskEntry {
  name: string;
  /** Output head shape — binary | k-class | regression | multi */
  head: 'binary' | 'k-class' | 'regression' | 'multi';
  headKind: 'classification' | 'regression' | 'multi';
  /** For k-class heads */
  nClasses?: number;
  /** Compatible label-strategy keys from LabelsStage / LABEL_SQL_GENERATORS */
  labelStrategies: string[];
  supportedObjectives?: string[];
  chartOverlay?: string;
  description?: string;
}

export interface RunnerEntry {
  /** Pre-2026-05-09 modelType key (e.g. "xgb_classifier") for backwards compat */
  legacyId?: string;
  /**
   * Catalog spec id this runner was generated from. Written by
   * `scripts/generate_model.py --register`; absent on hand-curated runners,
   * whose spec comes from their algorithm's `catalogSpec` instead.
   */
  catalogId?: string;
  displayName?: string;
  runner: TrainerRunner;
  script: string;
  outputDir: string;
  outputs: string[];
  featurePipeline: string;
  chartOverlay?: string;
  estimatedTrainingTime?: string;
  tags?: string[];
  supportedObjectives?: string[];
  /** Restrict this runner to specific timeframe labels (e.g. ["1d"]) */
  timeframes?: string[];
  featureCategories?: string[];
  includeIndicators?: boolean;
  allFeatures?: boolean;
  defaultHyperparameters: Record<string, HyperparameterDef>;
  cliFlags?: Record<string, string>;
  defaultSearchSpace?: Record<string, unknown>;
  /**
   * False when the model's script cannot possibly run on this machine — the
   * entry is kept as a record of intent, with `unavailableReason` naming what
   * is missing. The Train picker reads this to stop offering dead models.
   */
  available?: boolean;
  /** Why this entry is unavailable, shown next to the disabled option. */
  unavailableReason?: string;
  /**
   * Extra CLI args pushed onto argv right after the script path, before the
   * standard flags. `pythonRunner.ts` reads this directly off the composed
   * `ModelRegistryEntry` (see there for the exact insertion point).
   */
  scriptArgs?: string[];
  /**
   * Replaces `TrainingConfig.limits.maxTrainingDurationSec` for runs of this
   * runner. Model Cycle sets 43200 (12h) — a paced replay can legitimately
   * run long.
   */
  maxDurationSeconds?: number;
}

export interface AlgorithmRegistry {
  version: string;
  metadata?: Record<string, unknown>;
  algorithms: Record<AlgorithmId, AlgorithmEntry>;
}

export interface TaskRegistry {
  version: string;
  metadata?: Record<string, unknown>;
  tasks: Record<TaskId, TaskEntry>;
}

export interface RunnerRegistry {
  version: string;
  metadata?: Record<string, unknown>;
  runners: Record<CompositeRunnerId, RunnerEntry>;
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
  /**
   * A persisted label set (generated_labels.id) to train on, instead of the
   * runner computing its own labels. Resolved to its lake parquet path and
   * passed to the runner as `--label-set-parquet`.
   */
  labelSetId?: number;
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
  | 'sampler_diagnostics'
  | 'metric_declarations'
  | 'epoch_metric'
  | 'hpo_trial_start'
  | 'hpo_trial_done'
  | 'fold_start'
  | 'fold_done'
  | 'fold_complete'
  | 'config'
  | 'checkpoint_registered';

export interface TrainingEvent {
  type: TrainingEventType;
  data: Record<string, unknown>;
  ts: number;
}

// ─── Surface3D Types (loss-landscape visualization) ─────────────────────────

/** 3D trajectory point from PCA-projected weight space */
export interface Surface3DTrajectoryPoint {
  pc1: number;
  pc2: number;
  loss: number;
  epoch: number;
}

/** Live trajectory data emitted per epoch during training */
export interface Surface3DTrajectoryData {
  points: Surface3DTrajectoryPoint[];
  explained_variance: number[];
}

/** Surface diagnostics computed from the loss grid */
export interface Surface3DDiagnostics {
  sharpness: number;
  condition_number: number;
  valley_width: number;
  locally_convex: boolean;
}

/** Post-training loss surface grid data (Li et al. 2018) */
export interface Surface3DGridData {
  alphas: number[];
  betas: number[];
  losses: number[][];
  resolution: number;
  range: [number, number];
  trajectory_3d?: [number, number, number][];
  diagnostics: Surface3DDiagnostics;
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
  labelSetId?: number;
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
  /** Set by parser when it handles a 'done' event — prevents pythonRunner from emitting a duplicate */
  parserHandledDone?: boolean;
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
  /** Self-describing metric declarations emitted at training start (renderer hints) */
  metricDeclarations: Record<string, unknown> | null;
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
  /** SSE connection error (reconnect failures, connection lost) */
  sseError: string | null;
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
  metricDeclarations: Record<string, unknown> | null;
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
  /** Self-describing metric declarations emitted at training start (renderer hints) */
  metricDeclarations: Record<string, unknown> | null;
}

/** Model state sub-slice — full model snapshots. Updates every 25-50 iterations. */
export interface TrainingModelStateSlice {
  modelState: ModelStatePayload | null;
  modelStateHistory: Array<{ iteration: number; state: ModelStatePayload }>;
}
