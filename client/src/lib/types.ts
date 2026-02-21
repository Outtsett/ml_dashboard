/**
 * Shared TypeScript interfaces for ML dashboard entities.
 * Single source of truth - import from here instead of defining per-page.
 */

export interface MlModel {
  id: number;
  name: string;
  version: string;
  architecture: string;
  description?: string;
  hyperparameters?: string;
  status: string;
  metrics?: string;
  created_at?: string;
}

export interface Trade {
  id: number;
  symbol: string;
  side: string;
  entry_price: number;
  exit_price?: number;
  exit_timestamp?: string;
  pnl?: number;
  pnl_pct?: number;
  status: string;
  entry_timestamp?: string;
}

export interface MarketRegime {
  id: number;
  name: string;
  description?: string;
}

export interface EnsembleConfig {
  id: number;
  name: string;
  model_ids: string;
  aggregation_method: string;
  status: string;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
  category: string;
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
} as const;
