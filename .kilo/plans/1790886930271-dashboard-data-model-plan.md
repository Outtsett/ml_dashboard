# Dashboard Data Model & QuestDB Rename Plan

Status: implementation-ready. Three workstreams execute in order; each is a
separate commit so a failure rolls back cleanly.

## 0. Ground truth

- `src/server/infrastructure/database/questdb/` is the retired QuestDB layer.
  It is an in-process DuckDB over `E:\lake`; the directory name is legacy only.
- 44 files under `src/` import from a `questdb` path. 29 client files use the
  string only (labels, UI). `scripts/` has ~25 questdb references.
- SQLite schema (`src/shared/schema.ts`) is 54 tables. It already has an
  "Entity-Centric Graph System" section at line 1557 and a live
  `src/server/entities/entities.router.ts` with full CRUD plus a graph endpoint.
  EEIP is scaffolded, not absent.
- `src/server/data/ingestion.router.ts` is the last live caller of
  `@questdb/nodejs-client`. It always 503s; deleting it removes the dependency.
- The serving snapshot `derived/recipe=questdb_full_2026-09-09/` has no ingest
  manifest and is the one dataset the dashboard serves that is invisible to
  manifest-driven tooling.

## 1. QuestDB rename

Directory rename: `questdb/` -> `lake/`. Update every import path.

Function/class rename table (source -> target):

- queryQuestDB -> queryLake
- queryQuestDBFast -> queryLakeFast
- questdbHttpQuery -> lakeHttpQuery
- questdbExportCSV -> lakeExportCSV
- questdbImportCSV -> lakeImportCSV (keep, raises)
- checkQuestDBHealth -> checkLakeHealth
- getQuestDBSender -> lakeSender
- getQuestDBQueryPool -> lakePool
- initQueryPool -> initLakePool
- insertOHLCVBatch -> insertLakeBatch
- insertOHLCVStream -> insertLakeStream
- closeQuestDB -> closeLake
- startQuestDB -> startLake
- stopQuestDB -> stopLake
- isQuestDBRunning -> isLakeRunning
- getQuestDBProcessStatus -> getLakeProcessStatus
- getQuestDBTables -> getLakeTables
- getQuestDBTableInfo -> getLakeTableInfo
- getQuestDBPartitions -> getLakePartitions
- getQuestDBTableRowCount -> getLakeTableRowCount
- getQuestDBTablePreview -> getLakeTablePreview
- getQuestDBStats -> getLakeStats
- getQuestDBIntegrationStatus -> getLakeIntegrationStatus
- getQuestDBRowCount -> getLakeRowCount
- setQuestDBConfig -> setLakeConfig
- getQuestDBConfig -> getLakeConfig
- initializeQuestDB -> initializeLake
- insertOHLCVToQuestDB -> insertOHLCVToLake
- queryOHLCVFromQuestDB -> queryOHLCVFromLake
- createOHLCVTable -> createOHLCVTable (keep, raises)
- createPredictionLogTable -> createPredictionLogTable (keep, raises)
- initQuestDBTables -> initLakeTables
- QuestDBService -> LakeService
- QuestDBAutomationService -> LakeAutomationService
- QuestDBHealthIndicator -> LakeHealthIndicator
- QuestDBIntegrationConfig -> LakeIntegrationConfig
- OHLCVRowSchema -> LakeOHLCVRowSchema
- ValidatedOHLCVRow -> ValidatedLakeOHLCVRow
- QuestDBOHLCVRow -> LakeOHLCVRow (shared/ohlcv.ts)

Env vars QUESTDB_HOST/PG_PORT/HTTP_PORT/USER/PASSWORD -> LAKE_*.
Circuit breaker key 'questdb' -> 'lake'. Metric names questdb_* -> lake_*.
State 'syncing_questdb' -> 'syncing_lake'.
Snapshot recipe questdb_full_2026-09-09 -> lake_snapshot_2026-09-09.

Client files: rename components QuestDBControls.tsx, QuestDBConfigTab.tsx,
and every "questdb" string label to "Lake". Update route paths
/api/databases/questdb/* -> /api/databases/lake/*.

## 2. OHLCV consolidation

Single canonical Iceberg table `market.ohlcv` with columns symbol, timestamp,
open, high, low, close, volume, asset_class, root. All other entities derive
from it: timeframe views, candle anatomy, front-month stitching, orderflow.
Retire the 41 snapshot views over `lake_snapshot_2026-09-09` progressively;
keep `bars` as the live Iceberg read.

## 3. EEIP per-page tables

Five tables in SQLite: dashboard_pages, dashboard_tabs, dashboard_components,
dashboard_metrics, dashboard_metric_readings. One dashboard.service.ts owns
all writes. Readings keyed by metric_id with denormalized page_id/tab_id
context so moving a metric preserves history.

## 4. Validation

npm run check, npm test, npm run verify. Confirm no questdb/QuestDB/QUESTDB
remain in src/ or scripts/ (case-insensitive) except intentional retired-message
strings.