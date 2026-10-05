// lake module barrel — re-exports all sub-modules
// Canonical import point: from '../database/lake' or '../../database/lake'

export {
  lake_HOST,
  lake_PG_PORT,
  lake_HTTP_PORT,
  lake_USER,
  lake_PASSWORD,
  queryLake,
  queryLakeFast,
  querylakeStream,
  querylakeValidated,
  LakeOHLCVRowSchema,
  closeLake,
  checkLakeHealth,
  servingSnapshot,
  getServingLocation,
  fetchIcebergTable,
  listIcebergTables,
  refreshDerivedViews,
  derivedViews,
  servedRecipes,
} from "./connection";

export type { OHLCVRow, ValidatedLakeOHLCVRow } from "./connection";

export {
  createOHLCVTable,
  initLakeTables,
} from "./tables";

// Market data queries (was re-exported via queries.ts)
export {
  getOHLCVSampleBy,
  getFrontMonthRanges,
  getFrontMonthAnchor,
  getFrontMonthOHLCV,
  getStitchedOHLCV,
  getSymbolsInlake,
  getSymbolStats,
} from "./marketData";

// Introspection queries (was re-exported via queries.ts)
export {
  getLakeTables,
  getLakeTableInfo,
  getLakePartitions,
  getLakeTableRowCount,
  getLakeTablePreview,
  getLakeStats,
} from "./introspection";

export {
  lakeHttpQuery,
  lakeExportCSV,
  lakeImportCSV,
} from "./httpQuery";

// Lifecycle management (moved from lib/lakeProcess.ts)
export {
  startLake,
  stopLake,
  isLakeRunning,
  getLakeProcessStatus,
} from "./lifecycle";

// Circuit-breaker-wrapped operations (moved from lib/lakeIntegration.ts)
export {
  insertOHLCVToLake,
  queryOHLCVFromLake,
  initializeLake,
  getLakeIntegrationStatus,
  getLakeRowCount,
  setLakeConfig,
  getLakeConfig,
} from "./integration";

// OHLCV query orchestration (moved from lib/databaseManager.ts)
export {
  queryOHLCV,
  estimateTimeWindow,
  parseTimeframeMinutes,
} from "./ohlcvQuery";

export type { OHLCVQueryParams, NormalizedOHLCVRow } from "./ohlcvQuery";
export type { LakeIntegrationConfig } from "./integration";

// Object registry — one stable identity per thing the serving layer exposes.
export {
  buildObjectRegistry,
  lakeObjects,
  lakeObjectsByKind,
  findLakeObject,
  resolveViewName,
} from "./objectRegistry";

export type { LakeObject, LakeObjectKind } from "./objectRegistry";

