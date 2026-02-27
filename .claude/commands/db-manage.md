# Database Management

Manage the ML Dashboard's 3-database stack: PostgreSQL, QuestDB, and DuckDB.

## Usage: /db-manage [action]

Actions: start, stop, status, reset, migrate

## Paths
- PostgreSQL: `E:\source\databases\PostgreSQL\pgsql\bin\pg_ctl.exe`
- PG Data: `E:\source\databases\PostgreSQL\pgsql\data`
- QuestDB: `E:\source\databases\questdb-9.3.1-rt-windows-x86-64\bin\java.exe`
- QuestDB Root: `E:\source\databases\questdb-9.3.1-rt-windows-x86-64`
- DuckDB: Embedded (data/market.duckdb) — no external process needed

## Data Volumes
| Database | Content | Rows/Size |
|----------|---------|-----------|
| DuckDB market.duckdb | OHLCV (1s bars) | 782M rows |
| DuckDB market.duckdb | Tick trades | 14.5M rows |
| DuckDB market.duckdb | MBP-10 book | 408.8M rows |
| DuckDB market.duckdb | Rollovers | 353 events (8 roots) |
| QuestDB ohlcv_1s | OHLCV (synced from DuckDB) | 759.5M rows (903 symbols) |
| PostgreSQL | 21 Drizzle tables | 25 instruments, 353 rollovers |
| Indicator parquets | pandas-ta (data/{futures,forex}/) | 200 files, ~350 cols each |

## Actions

### start
1. Check if PostgreSQL is running: `"E:\source\databases\PostgreSQL\pgsql\bin\pg_ctl.exe" status -D "E:\source\databases\PostgreSQL\pgsql\data"`
2. If not running: `"E:\source\databases\PostgreSQL\pgsql\bin\pg_ctl.exe" start -D "E:\source\databases\PostgreSQL\pgsql\data" -l "E:\source\databases\PostgreSQL\pgsql\data\pg.log"`
3. Verify PG on port 5432
4. Check if QuestDB HTTP responds on port 9000: `curl http://localhost:9000/exec?query=SELECT%201`
5. If not running, start QuestDB: `"E:\source\databases\questdb-9.3.1-rt-windows-x86-64\bin\java.exe" -m io.questdb/io.questdb.ServerMain -d "E:\source\databases\questdb-9.3.1-rt-windows-x86-64"`
6. Wait for QuestDB HTTP port 9000 to respond
7. DuckDB: no action needed (embedded, initializes on server startup via `initMarketDB()` in market.ts)

### stop
1. Stop PostgreSQL: `"E:\source\databases\PostgreSQL\pgsql\bin\pg_ctl.exe" stop -D "E:\source\databases\PostgreSQL\pgsql\data" -m fast`
2. Stop QuestDB: Find java.exe process for QuestDB and kill it. Check for PID file at `electron/.questdb.pid`
3. DuckDB: no action needed
4. **Important**: Kill node processes before running DuckDB write scripts (file lock)

### status
Check and report:
- PostgreSQL: `pg_ctl status` + test connection on port 5432
- QuestDB: HTTP health check on port 9000, ILP port 9009, PG wire port 8812
- DuckDB: Check if data/market.duckdb exists and report file size
- DuckDB tables: Query row counts for ohlcv, trades, mbp10, rollovers
- Indicator parquets: Count files in data/{futures,forex}/ and total size

### reset
1. Stop PostgreSQL if running
2. Drop and recreate database: `dropdb ml_dashboard && createdb ml_dashboard`
3. Start PostgreSQL
4. Run schema push: `npm run db:push`
5. Create TimescaleDB extension if available
6. Seed instruments: `npx tsx scripts/seed-instruments.ts`
7. Re-sync rollovers: `npx tsx scripts/compute-rollovers.ts`

### migrate
1. Run Drizzle schema push: `npm run db:push`
2. Set up partitioned tables (handled by server startup)
3. Seed instruments if table is empty: `npx tsx scripts/seed-instruments.ts`

## Port Reference
| Database | Port | Protocol |
|----------|------|----------|
| PostgreSQL | 5432 | PostgreSQL wire |
| QuestDB HTTP | 9000 | REST API |
| QuestDB ILP | 9009 | InfluxDB Line Protocol |
| QuestDB PG | 8812 | PostgreSQL wire |
| DuckDB | N/A | Embedded |

## DuckDB File Lock
DuckDB file-backed databases (`market.duckdb`) only allow one writer at a time. The dev server holds this lock while running.

- **Before running write scripts**: Kill the dev server (`taskkill /F /IM node.exe`)
- **Python scripts**: Use `read_only=True` when possible (still fails if another process holds write lock)
- **Access serialization**: Server uses Mutex class in `server/duckdb/market.ts`

## Sync Pipelines
| Pipeline | Command | Speed |
|----------|---------|-------|
| DuckDB → QuestDB | `npx tsx scripts/fast-questdb-sync.ts` | 754K rows/sec via /imp CSV |
| DuckDB → PG rollovers | `npx tsx scripts/compute-rollovers.ts` | 353 events in ~7s |
| DuckDB → Indicator parquets | `python scripts/compute-indicators.py` | ~20s per symbol/timeframe |
