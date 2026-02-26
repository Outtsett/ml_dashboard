// Barrel export - re-exports used functions from sub-modules.

// Core infrastructure
export { initDuckDB, runQuery } from "./analyticsCore";

// File I/O operations
export { convertCSVToParquet, convertZstCSVToParquet, listParquetFiles } from "./fileOps";

// Data querying and aggregation
export {
  getParquetStats,
  queryParquetOHLCV,
  queryParquetOHLCVAggregated,
  queryOHLCVCursor,
  queryParquet,
  executeDuckDBQuery,
  computeOHLCVStats,
} from "./queries";

// ML feature generation
export {
  generateMLFeatures,
  getMLFeaturesPreview,
  getAvailableParquetFiles,
} from "./mlFeatures";
export type { MLFeatureConfig, TechnicalIndicatorConfig } from "./mlFeatures";

// Database metadata and admin
export { exportPostgresToParquet, getDuckDBStats } from "./introspection";
