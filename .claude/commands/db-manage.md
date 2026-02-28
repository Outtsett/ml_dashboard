# Database Management

Manage the ML Dashboard's 2-database stack: SQLite and QuestDB.

## Usage: /db-manage [action]

Actions: start, stop, status, reset, migrate

## Paths
- SQLite: `data/ml_dashboard.db` (embedded, WAL mode, Drizzle ORM)
- QuestDB: `E:\source\databases\questdb-9.3.1-rt-windows-x86-64\bin\java.exe`
- QuestDB Root: `E:\source\databases\questdb-9.3.1-rt-windows-x86-64`

## Data Volumes
| Database | Content | Rows/Size |
|----------|---------|-----------|
| QuestDB ohlcv | OHLCV (1s bars) | 759.5M rows |
| QuestDB trades | Tick trades | 12.9M rows |
| QuestDB mbp10 | MBP-10 book | 408.8M rows |
| QuestDB indicators_{tf} | Pre-computed pandas-ta (7 tables) | 344 columns each |
| QuestDB model_regimes | HDP-HMM regime assignments | Var. |
| QuestDB model_shap | Per-bar SHAP values | Var. |
| SQLite | 22 Drizzle tables | 25 instruments |

## Actions

### start
1. Check if QuestDB HTTP responds on port 9000: `curl http://localhost:9000/exec?query=SELECT%201`
2. If not running, start QuestDB: `"E:\source\databases\questdb-9.3.1-rt-windows-x86-64\bin\java.exe" -m io.questdb/io.questdb.ServerMain -d "E:\source\databases\questdb-9.3.1-rt-windows-x86-64"`
3. Wait for QuestDB HTTP port 9000 to respond
4. SQLite: no action needed (embedded, initializes on server startup)

### stop
1. Stop QuestDB: Find java.exe process and kill it. Check for PID file at `electron/.questdb.pid`
2. SQLite: no action needed (embedded)

### status
Check and report:
- QuestDB: HTTP health check on port 9000, ILP port 9009, PG wire port 8812
- QuestDB tables: Query row counts for ohlcv, trades, mbp10, indicators_* tables
- SQLite: Check if data/ml_dashboard.db exists and report file size

### reset
1. Run schema push: `npm run db:push`
2. Seed instruments: `npx tsx scripts/seed-instruments.ts`

### migrate
1. Run Drizzle schema push: `npm run db:push`
2. Seed instruments if table is empty: `npx tsx scripts/seed-instruments.ts`

## Port Reference
| Database | Port | Protocol |
|----------|------|----------|
| QuestDB HTTP | 9000 | REST API |
| QuestDB ILP | 9009 | InfluxDB Line Protocol |
| QuestDB PG | 8812 | PostgreSQL wire |
| SQLite | N/A | Embedded |

## QuestDB Gotchas
- `/imp` requires `T` separator in timestamps, NOT space separator
- Timestamps with timezone offset like `+00` are rejected
- `LIMIT offset, count` (NOT `LIMIT count OFFSET offset`)
- `count()` (NOT `COUNT(*)`)
- `CAST(x AS INT)` (NOT `CAST(x AS INTEGER)`)
- `nm=true` param strips `columns` metadata from `/exec` response — do NOT use if code needs column names
