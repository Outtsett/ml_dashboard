// QuestDB module barrel — re-exports all sub-modules
// Existing imports from '../questdb' auto-resolve to '../questdb/index.ts'

export {
  QUESTDB_HOST,
  QUESTDB_ILP_PORT,
  QUESTDB_PG_PORT,
  QUESTDB_HTTP_PORT,
  getQuestDBSender,
  getQuestDBQueryPool,
  queryQuestDB,
  insertOHLCVBatch,
  insertOHLCVStream,
  closeQuestDB,
  checkQuestDBHealth,
} from "./connection";

export type { OHLCVRow } from "./connection";

export {
  createOHLCVTable,
  createTradesTable,
  createMBP10Table,
  initQuestDBTables,
} from "./tables";

export {
  getOHLCVSampleBy,
  getFrontMonthRanges,
  getFrontMonthOHLCV,
  getQuestDBTables,
  getQuestDBTableInfo,
  getQuestDBPartitions,
  getQuestDBTableRowCount,
  getQuestDBTablePreview,
  getQuestDBStats,
  getSymbolsInQuestDB,
  getSymbolStats,
} from "./queries";

export { exportQuestDBToParquet } from "./export";

export {
  questdbHttpQuery,
  questdbExportParquet,
  questdbExportCSV,
  questdbImportCSV,
} from "./httpQuery";
