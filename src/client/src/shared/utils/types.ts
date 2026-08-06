/**
 * Shared TypeScript interfaces for ML dashboard entities.
 * Single source of truth — import from here instead of defining per-page.
 *
 * Field names use camelCase to match what Drizzle ORM returns.
 * The SQLite column names (snake_case) are internal to DB — Drizzle maps
 * them to the camelCase property names defined in shared/schema.ts.
 */

// Re-export OHLCV types from the shared canonical definition
export type { OHLCVBar, SymbolOHLCVBar, StitchedOHLCVBar, SymbolStats } from "@shared/ohlcv";

export interface MlModel {
  id: number;
  name: string;
  version: string;
  architecture: string;
  category?: string;
  subcategory?: string;
  description?: string;
  hyperparameters?: string;        // JSON string
  featureSetId?: number;
  trainingDataStart?: number;
  trainingDataEnd?: number;
  validationSplit?: number;
  targetColumn?: string;
  targetHorizon?: number;
  metrics?: string;                // JSON string
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Trade {
  id: number;
  symbol: string;
  side: string;
  entryTimestamp: number;          // epoch-ms
  exitTimestamp?: number;          // epoch-ms
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  pnl?: number;
  pnlPct?: number;
  commission?: number;
  slippage?: number;
  modelId?: number;
  ensembleId?: number;
  signalConfidence?: number;
  regimeId?: number;
  notes?: string;
  status: string;
  createdAt?: string;
}

export interface MarketRegime {
  id: number;
  name: string;
  description?: string;
  volatilityLevel?: string;
  trendDirection?: string;
  characteristics?: string;       // JSON string
  detectionRules?: string;        // JSON string
  createdAt?: string;
}

export interface EnsembleConfig {
  id: number;
  name: string;
  description?: string;
  modelIds: string;                // JSON string of number[]
  weights?: string;                // JSON string
  aggregationMethod: string;
  confidenceThreshold?: number;
  unanimityRequired?: number;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Model checkpoint from /api/models — includes self-describing diagnostics. */
export interface ModelCheckpoint {
  id: number;
  modelId: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  diagnosticsJson: string | null;   // JSON string of self-describing metrics
  primaryMetric: number | null;
  primaryMetricName: string | null;
  paramCount: number | null;
  trainingDurationSec: number | null;
  nBarsTrain: number | null;
  nBarsVal: number | null;
  isActive: number;                 // 0 or 1
  sessionId: number | null;
  createdAt: number;                // epoch-ms
}

/** Parsed key performance metrics extracted from diagnosticsJson. */
export interface CheckpointPerformance {
  profitFactor: number | null;
  sharpeRatio: number | null;
  winRate: number | null;
  nTrades: number | null;
  maxDrawdown: number | null;
  accuracy: number | null;
  valLoss: number | null;
  trainLoss: number | null;
  rocAuc: number | null;
  codebookUtilization: number | null;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
  category: string;
}

export interface SavedModel {
  name: string;
  symbol: string;
  path: string;
  savedAt: string;
  pgModelId?: number;
  metrics?: {
    finalLoss?: number;
    finalValLoss?: number;
    finalAccuracy?: number;
    trainingTime?: number;
    epochs?: number;
    pipeline?: string;
    labelType?: string;
  };
}

// ─── Training Domain Types ──────────────────────────────────────────────────

export interface TrainingProgress {
  step: number;
  totalSteps: number;
  phase: string;
  message: string;
  pct: number;
}

export interface LiveMetrics {
  gibbsIter: number;
  gibbsTotal: number;
  logLikelihood: number;
  activeStates: number;
  delta: number;
  fitPerBar: number;
  entropy: number;
  switchRate: number;
  selfTransition: number;
  maxRegimePct: number;
  avgDwell: number;
  nBarsTotal: number;
  regimesDiscovered: number;
  stability: number;
  oosSimilarity: number;
  oosCorrelation: number;
  qualityScore: number;
  elapsed: number;
}

export interface RegimeModel {
  id: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  n_regimes: number;
  n_bars: number;
  n_bars_total?: number;
  n_bars_train_val?: number;
  n_bars_test?: number;
  quality_score?: number;
  date_range: { start: string; end: string; train_end?: string; test_start?: string };
  training_config?: {
    gibbs_iter: number; burn_in: number; test_split: number;
    walk_forward_windows: number; alpha: number; gamma: number; kappa: number;
  };
  training_time_sec: number;
  trained_at: string;
}

export interface RegimeStat {
  regime_id: number;
  count: number;
  pct: number;
  avg_return: number;
  avg_return_pct?: number;
  avg_volatility: number;
  avg_range: number;
  avg_atr_ratio: number;
  avg_duration: number;
  max_duration: number;
  label: string;
  nickname?: string;
  volatility_state?: string;
  bar_character?: string;
  characteristics: Record<string, number>;
}

export interface ShapFeature {
  feature: string;
  mean_abs_shap: number;
  mean_shap: number;
}

export interface ShapRegimeSummary {
  regime_id: number;
  top_features: ShapFeature[];
}

export interface Transition {
  from: number;
  to: number;
  probability: number;
}

export interface WalkForwardWindow {
  window: number;
  train_size: number;
  test_size: number;
  regime_distribution?: number[];
  switch_rate?: number;
  avg_confidence?: number;
  failed: boolean;
}

export interface OOSResult {
  distribution_similarity: number;
  train_distribution: number[];
  test_distribution: number[];
  profile_consistency: Array<{
    regime: number;
    correlation: number | null;
    insufficient_data: boolean;
  }>;
  avg_profile_correlation: number;
  avg_test_confidence: number;
  train_switch_rate: number;
  test_switch_rate: number;
  switch_rate_ratio: number;
}

export interface EvaluationTestResult {
  value: number | null;
  passed: boolean;
  p_value: number | null;
  details?: Record<string, unknown>;
}

export interface EvaluationResults {
  stage1: Record<string, EvaluationTestResult>;
  stage2: Record<string, EvaluationTestResult>;
  stage3: Record<string, EvaluationTestResult>;
  stage4: Record<string, EvaluationTestResult>;
  stage5: Record<string, EvaluationTestResult>;
  grade: string;
}

export interface BenchmarkResult {
  buyAndHold: { cumulative?: number[]; totalReturn: number; totalReturnPct?: number; maxDrawdown?: number; maxDrawdownPct?: number; sharpeRatio?: number; equityCurve?: { timestamp: number; equity: number }[]; };
  smaCrossover?: { cumulative: number[]; totalReturn: number; signals: number[] };
  comparison?: { alpha: number; beta: number; informationRatio: number; trackingError: number; upCaptureRatio: number; downCaptureRatio: number; };
  rollingMetrics?: { timestamp: number; strategySharpe: number; benchmarkSharpe: number; rollingAlpha: number; }[];
  dates?: string[];
}

export interface Diagnostics {
  symbol: string;
  timeframe: string;
  n_regimes: number;
  n_bars_total?: number;
  n_bars_train_val?: number;
  n_bars_test?: number;
  n_features: number;
  feature_names: string[];
  date_range: { start: string; end: string; train_end?: string; test_start?: string };
  quality_score?: number;
  evaluation?: EvaluationResults;
  convergence_summary?: {
    n_iterations: number;
    final_log_likelihood: number;
    final_active_states?: number;
  };
  walk_forward?: {
    n_windows: number;
    window_results: WalkForwardWindow[];
    stability_score: number;
    avg_oos_confidence: number;
    avg_switch_rate: number;
  };
  out_of_sample?: OOSResult;
  regime_stats: RegimeStat[];
  transitions: Transition[];
  transition_matrix: number[][];
  training_config?: {
    gibbs_iter: number; burn_in: number; test_split: number;
    walk_forward_windows: number; alpha: number; gamma: number; kappa: number;
  };
  training_time_sec: number;
  trained_at: string;
  shap_summary?: ShapRegimeSummary[];
}

export interface ConvergencePoint {
  iter: number;
  log_likelihood: number;
  n_active_states?: number;
  delta?: number;
  entropy?: number;
  switch_rate?: number;
  self_transition?: number;
  max_regime_pct?: number;
  avg_dwell?: number;
}

// ─── Data Domain Types ──────────────────────────────────────────────────────

export interface TableInfo {
  name: string;
  rowCount: number;
  type?: string;
  partitions?: number;
  columns?: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface DatabaseStats {
  connected: boolean;
  tables: number;
  tableDetails: TableInfo[];
  error?: string;
}

export interface FileUploadItem {
  file: File;
  symbol: string;
  assetType: "futures" | "forex";
  status: "pending" | "uploading" | "completed" | "failed";
  progress: number;
}

// ─── Verdict System & Palette ───────────────────────────────────────────────

export const REGIME_COLORS = [
  { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', fill: '#10b981' },
  { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', fill: '#3b82f6' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', fill: '#f59e0b' },
  { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30', fill: '#E91E63' },
  { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', fill: '#9C27B0' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', fill: '#00BCD4' },
];

export const VOL_COLORS: Record<string, string> = {
  extreme: 'bg-red-500/20 text-red-400',
  high: 'bg-orange-500/20 text-orange-400',
  normal: 'bg-slate-500/20 text-slate-400',
  low: 'bg-blue-500/20 text-blue-400',
  quiet: 'bg-indigo-500/20 text-indigo-400',
};

export const CANDLE_LABELS: Record<string, string> = {
  wide_impulse: '⚡ Impulse',
  hammer: '🔨 Hammer',
  shooting_star: '⭐ Star',
  doji: '✚ Doji',
  wide_range: '↔ Wide',
  narrow_range: '│ Narrow',
};

export const CHART_GRID = { strokeDasharray: '3 3', stroke: 'hsla(220, 20%, 30%, 0.15)' } as const;
export const CHART_AXIS = { stroke: 'hsla(220, 10%, 60%, 0.8)', fontSize: 10, tickLine: false } as const;
export const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: 'hsla(220, 20%, 10%, 0.95)',
    backdropFilter: 'blur(12px)',
    borderRadius: '6px',
    fontSize: '11px',
    border: '1px solid hsla(220, 15%, 25%, 0.4)',
    color: 'hsla(220, 10%, 90%, 0.9)',
  },
} as const;

/**
 * Standardized React Query keys.
 * Use these constants to ensure cache sharing across pages.
 */
export const QUERY_KEYS = {
  modelCheckpoints: ["/api/models"] as const,
  mlModels: ["/api/ml/models"] as const,
  mlTrades: ["/api/ml/trades"] as const,
  mlRegimes: ["/api/ml/regimes"] as const,
  regimeModels: ["/api/training/models"] as const,
  regimeDiagnostics: (id: string | number) => ["/api/training/models", String(id), "diagnostics"] as const,
  regimeConvergence: (id: string | number) => ["/api/training/models", String(id), "convergence"] as const,
  regimeAssignments: (id: string) => ["/api/training/models", id, "assignments"] as const,
  regimeTrainStatus: ["/api/training/status"] as const,
  instruments: ["/api/instruments"] as const,
  featureImportance: (modelName: string) => ["/api/ml/feature-importance", modelName] as const,
  trainingConfig: ["/api/training/config"] as const,
  chartOhlcv: (symbol: string, timeframe: string) => ["/api/charts/ohlcv", symbol, timeframe] as const,
  chartSymbols: ["/api/charts/symbols"] as const,
  xaiMethods: ["/api/xai/methods"] as const,
  labels: (symbol: string) => ["/api/labels", symbol] as const,
  backtestTrades: (params: string) => ["/api/backtest/trades", params] as const,
  uploads: ["/api/databases/uploads"] as const,
  mlForecastsList: ["/api/ml/forecasts"] as const,
  mlForecasts: (params: string) => ["/api/ml/forecasts", params] as const,
} as const;

// ── Slim projection types (ISP) ─────────────────────────────────────────────
// Use these minimal interfaces when a component only needs a few fields.

/** Minimal model reference — use when only id+name are needed (badges, lists). */
export interface ModelSummary { id: number; name: string; type?: string; }

/** Minimal trade reference for table rows that don't need full Trade fields. */
export interface TradeSummary { id: number; symbol: string; side: string; pnl: number | null; }

/** Minimal feature reference for importance displays. */
export interface FeatureInfo { name: string; importance: number; }

/** Minimal training status for progress indicators. */
export interface TrainStatus { modelId: number; status: string; progress?: number; epoch?: number; }

export function formatNumber(num: number | undefined | null): string {
  if (num === undefined || num === null || isNaN(num)) return "0";
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}
