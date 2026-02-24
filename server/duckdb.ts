// Barrel export - re-exports everything from sub-modules for backward compatibility
// All imports like `import { ... } from "./duckdb"` continue to work unchanged.

// Core infrastructure (analyticsCore.ts)
export {
  initDuckDB, closeDuckDB, runQuery, runQueryUnlocked, withMutex, validateFilePath, PARQUET_DIR
} from "./duckdb/analyticsCore";

// Statistical analysis & volatility (analyticsStatistics.ts)
export {
  calculateRollingStats,
  correlationMatrix,
  calculateReturns,
  realizedVolatility,
  parkinsonVolatility,
  garmanKlassVolatility,
  calculateDrawdown
} from "./duckdb/analyticsStatistics";

// Performance metrics & feature engineering (analyticsPerformance.ts)
export {
  calculatePerformanceRatios,
  calculateTradeMetrics,
  createLaggedFeatures,
  calculateTechnicalIndicators
} from "./duckdb/analyticsPerformance";

// File I/O operations
export { loadParquetSafe, loadCSVSafe, convertCSVToParquet, convertZstCSVToParquet, getParquetRowCount, listParquetFiles } from "./duckdb/fileOps";

// Data querying and aggregation
export {
  loadParquetForAnalytics,
  getParquetStats,
  queryParquetOHLCV,
  queryParquetOHLCVAggregated,
  bulkLoadOHLCVUnlocked,
  bulkLoadOHLCV,
  aggregateOHLCV,
  queryOHLCVCursor,
  queryParquet,
  queryParquetWithPagination,
  executeDuckDBQuery,
  computeOHLCVStats
} from "./duckdb/queries";

// ML feature generation
export {
  generateMLFeatures,
  getMLFeaturesPreview,
  getAvailableParquetFiles,
  validateMLConfig,
  validateTimeframe,
  generateIndicatorSQLColumns,
  getIndicatorFeatureNames,
  DEFAULT_ML_CONFIG,
  VALID_INDICATORS,
  VALID_TIMEFRAMES
} from "./duckdb/mlFeatures";
export type { MLFeatureConfig, TechnicalIndicatorConfig } from "./duckdb/mlFeatures";

// Database metadata and admin
export { exportPostgresToParquet, getDuckDBStats } from "./duckdb/introspection";
