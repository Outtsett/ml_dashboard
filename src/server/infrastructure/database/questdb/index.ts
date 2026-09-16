// QuestDB module barrel — re-exports all sub-modules
// Canonical import point: from '../database/questdb' or '../../database/questdb'

export {
  QUESTDB_HOST,
  QUESTDB_PG_PORT,
  QUESTDB_HTTP_PORT,
  QUESTDB_USER,
  QUESTDB_PASSWORD,
  getQuestDBSender,
  getQuestDBQueryPool,
  initQueryPool,
  queryQuestDB,
  queryQuestDBFast,
  queryQuestDBStream,
  queryQuestDBValidated,
  OHLCVRowSchema,
  insertOHLCVBatch,
  insertOHLCVStream,
  closeQuestDB,
  checkQuestDBHealth,
  fetchIcebergTable,
  listIcebergTables,
} from "./connection";

export type { OHLCVRow, ValidatedOHLCVRow } from "./connection";

export {
  createOHLCVTable,
  initQuestDBTables,
} from "./tables";

// Market data queries (was re-exported via queries.ts)
export {
  getOHLCVSampleBy,
  getFrontMonthRanges,
  getFrontMonthOHLCV,
  getStitchedOHLCV,
  getSymbolsInQuestDB,
  getSymbolStats,
} from "./marketData";

// Introspection queries (was re-exported via queries.ts)
export {
  getQuestDBTables,
  getQuestDBTableInfo,
  getQuestDBPartitions,
  getQuestDBTableRowCount,
  getQuestDBTablePreview,
  getQuestDBStats,
} from "./introspection";

export {
  questdbHttpQuery,
  questdbExportCSV,
  questdbImportCSV,
} from "./httpQuery";

// Lifecycle management (moved from lib/questdbProcess.ts)
export {
  startQuestDB,
  stopQuestDB,
  isQuestDBRunning,
  getQuestDBProcessStatus,
} from "./lifecycle";

// Circuit-breaker-wrapped operations (moved from lib/questdbIntegration.ts)
export {
  insertOHLCVToQuestDB,
  queryOHLCVFromQuestDB,
  initializeQuestDB,
  getQuestDBIntegrationStatus,
  getQuestDBRowCount,
  setQuestDBConfig,
  getQuestDBConfig,
} from "./integration";

// OHLCV query orchestration (moved from lib/databaseManager.ts)
export {
  queryOHLCV,
  estimateTimeWindow,
  parseTimeframeMinutes,
} from "./ohlcvQuery";

export type { OHLCVQueryParams, NormalizedOHLCVRow } from "./ohlcvQuery";
export type { QuestDBIntegrationConfig } from "./integration";
