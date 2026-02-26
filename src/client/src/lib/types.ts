/**
 * Shared TypeScript interfaces for ML dashboard entities.
 * Single source of truth — import from here instead of defining per-page.
 *
 * Field names use camelCase to match what Drizzle ORM returns.
 * The SQLite column names (snake_case) are internal to DB — Drizzle maps
 * them to the camelCase property names defined in shared/schema.ts.
 */

// Re-export OHLCV types from the shared canonical definition
export type { OHLCVBar, SymbolOHLCVBar, ContinuousOHLCVBar, SymbolStats } from "@shared/ohlcv";

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

/**
 * Standardized React Query keys.
 * Use these constants to ensure cache sharing across pages.
 */
export const QUERY_KEYS = {
  mlModels: ["/api/ml/models"] as const,
  mlTrades: ["/api/ml/trades"] as const,
  mlRegimes: ["/api/ml/regimes"] as const,
  mlSavedModels: ["/api/ml/saved-models"] as const,
  mlTrainStatus: ["/api/ml/train/status"] as const,
  mlFeatures: ["/api/ml/universal/features"] as const,
  regimeModels: ["/api/training/models"] as const,
  regimeDiagnostics: (id: string | number) => ["/api/training/models", String(id), "diagnostics"] as const,
  regimeConvergence: (id: string | number) => ["/api/training/models", String(id), "convergence"] as const,
  regimeAssignments: (id: string) => ["/api/training/models", id, "assignments"] as const,
  regimeTrainStatus: ["/api/training/status"] as const,
  instruments: ["/api/instruments"] as const,
  featureImportance: (modelName: string) => ["/api/ml/feature-importance", modelName] as const,
  trainingStatus: ["/api/ml/train/status"] as const,
  trainingConfig: ["/api/training/config"] as const,
  lastTrainingSession: (symbol: string) => ["/api/ml/train/last-session", symbol] as const,
  chartOhlcv: (symbol: string, timeframe: string) => ["/api/charts/ohlcv", symbol, timeframe] as const,
  chartSymbols: ["/api/charts/symbols"] as const,
  indicatorCatalog: (symbol: string) => ["/api/indicators/catalog", symbol] as const,
  indicatorData: (symbol: string, tf: string) => ["/api/indicators/data", symbol, tf] as const,
  indicatorPatterns: (symbol: string, tf: string) => ["/api/indicators/patterns", symbol, tf] as const,
  xaiMethods: ["/api/xai/methods"] as const,
  labels: (symbol: string) => ["/api/labels", symbol] as const,
  backtestTrades: (params: string) => ["/api/backtest/trades", params] as const,
  uploads: ["/api/databases/uploads"] as const,
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
