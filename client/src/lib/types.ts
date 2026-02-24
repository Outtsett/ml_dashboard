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
  regimeModels: ["/api/regime/models"] as const,
  regimeDiagnostics: (id: string) => ["/api/regime/diagnostics", id] as const,
  regimeAssignments: (id: string) => ["/api/regime/assignments", id] as const,
  instruments: ["/api/instruments"] as const,
  featureImportance: (modelName: string) => ["/api/ml/feature-importance", modelName] as const,
  trainingStatus: ["/api/ml/train/status"] as const,
  lastTrainingSession: (symbol: string) => ["/api/ml/train/last-session", symbol] as const,
  chartOhlcv: (symbol: string, timeframe: string) => ["/api/charts/ohlcv", symbol, timeframe] as const,
  chartSymbols: ["/api/charts/symbols"] as const,
} as const;
