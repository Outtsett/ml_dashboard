// Barrel export - re-exports used functions from sub-modules.

// Core infrastructure
export { initDuckDB, runQuery } from "./duckdb/analyticsCore";

// File I/O operations
export { convertCSVToParquet, convertZstCSVToParquet, listParquetFiles } from "./duckdb/fileOps";

// Data querying and aggregation
export {
  getParquetStats,
  queryParquetOHLCV,
  queryParquetOHLCVAggregated,
  queryOHLCVCursor,
  queryParquet,
  executeDuckDBQuery,
  computeOHLCVStats,
} from "./duckdb/queries";

// ML feature generation
export {
  generateMLFeatures,
  getMLFeaturesPreview,
  getAvailableParquetFiles,
} from "./duckdb/mlFeatures";
export type { MLFeatureConfig, TechnicalIndicatorConfig } from "./duckdb/mlFeatures";

// Database metadata and admin
export { exportPostgresToParquet, getDuckDBStats } from "./duckdb/introspection";
