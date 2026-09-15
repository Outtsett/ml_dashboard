# Database — Data Access Layer

Connections, health monitoring, and NestJS DI modules for SQLite and market data.

> **Port in flight.** The market-data half of this directory is being moved off
> the retired time-series server and onto DuckDB over the Iceberg lake at
> `E:\lake` — the same `lake.serving` path `src/ml/shared/data.py` already uses.
> The table below describes the modules as they stand on disk; the file names
> and the protocol table at the bottom still carry the old store's naming.
> Treat anything here that names a host, port or wire protocol as stale until
> the port lands.

## Files

| File | Purpose |
|---|---|
| `db.ts` | Drizzle ORM SQLite connection (better-sqlite3, WAL mode) |
| `health.ts` | Cross-store health monitoring with circuit breaker integration |
| `database.module.ts` | NestJS DI module: provides the market-data service and SQLiteService |
| `questdb.service.ts` | NestJS market-data facade (injectable service) |
| `sqlite.service.ts` | NestJS SQLite facade (injectable service) |

## Market-data submodule (`questdb/`)

Low-level market-data operations, split into focused modules (plus `index.ts`
re-exporting them and `automation.service.ts`):

| Module | Responsibility |
|---|---|
| `connection.ts` | Client management, `insertOHLCVBatch`. Auto-derives `asset_class`/`root` from symbol via `deriveAssetFields()`. |
| `marketData.ts` | Unified OHLCV queries (single `ohlcv` table), front-month stitching via volume detection |
| `httpQuery.ts` | Query/export helpers — the layer being repointed at DuckDB |
| `introspection.ts` | Schema metadata: table list, columns, partitions, row counts |
| `tables.ts` | DDL: `createOHLCVTable` (unified schema with `asset_class`/`root`) |
| `lifecycle.ts` | Store lifecycle (start, stop, status). The lake has no process to manage, so this collapses to a status probe. |
| `ohlcvQuery.ts` | OHLCV query orchestration: health check, time-window estimation, caching |
| `integration.ts` | Circuit-breaker-wrapped insert/query + pipeline metrics |

## Connection details

| Store | Endpoint | Usage |
|---|---|---|
| Iceberg lake | `E:\lake`, read in-process by DuckDB | All market-data queries — no host, no port |
| Iceberg catalog (AIStor) | `http://127.0.0.1:9100/_iceberg`, warehouse `lakehouse` | Table metadata resolution |
| SQLite | `data/ml_dashboard.db` | App metadata, embedded |
