# Database — Data Access Layer

Database connections, health monitoring, and NestJS DI modules for both SQLite and QuestDB.

## Files

| File | Purpose |
|---|---|
| `db.ts` | Drizzle ORM SQLite connection (better-sqlite3, WAL mode) |
| `health.ts` | Cross-database health monitoring with circuit breaker integration |
| `database.module.ts` | NestJS DI module: provides QuestDBService and SQLiteService |
| `questdb.service.ts` | NestJS QuestDB facade (injectable service) |
| `sqlite.service.ts` | NestJS SQLite facade (injectable service) |

## QuestDB Submodule (`questdb/`)

Low-level QuestDB operations split into 7 focused modules:

| Module | Responsibility |
|---|---|
| `connection.ts` | Client management: Sender (ILP), pg.Pool (PG wire), `queryQuestDB`, `insertOHLCVBatch`. Auto-derives `asset_class`/`root` from symbol via `deriveAssetFields()`. |
| `marketData.ts` | Unified OHLCV queries (single `ohlcv` table), front-month stitching via volume detection |
| `httpQuery.ts` | QuestDB HTTP API: `questdbHttpQuery`, `questdbExportParquet`, `questdbImportCSV` |
| `introspection.ts` | Schema metadata: `SHOW TABLES`, columns, partitions, row counts |
| `tables.ts` | DDL: `createOHLCVTable` (unified schema with `asset_class`/`root` SYMBOL INDEX) |
| `lifecycle.ts` | QuestDB process lifecycle (start, stop, status) |
| `ohlcvQuery.ts` | OHLCV query orchestration: health check, time-window estimation, caching |
| `integration.ts` | Circuit-breaker-wrapped insert/query + pipeline metrics |

## Connection Details

| Protocol | Port | Usage |
|---|---|---|
| HTTP REST | 9000 | Fast queries, CSV import, parquet export |
| ILP TCP | 9009 | High-throughput ingestion (MotiveWave plugin, Node.js Sender) |
| PG Wire | 8812 | SQL queries (Python psycopg2, Node.js pg.Pool) |
