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

## Actions

### start
1. Check if PostgreSQL is running: `"E:\source\databases\PostgreSQL\pgsql\bin\pg_ctl.exe" status -D "E:\source\databases\PostgreSQL\pgsql\data"`
2. If not running: `"E:\source\databases\PostgreSQL\pgsql\bin\pg_ctl.exe" start -D "E:\source\databases\PostgreSQL\pgsql\data" -l "E:\source\databases\PostgreSQL\pgsql\data\pg.log"`
3. Verify PG on port 5432
4. Check if QuestDB HTTP responds on port 9000: `curl http://localhost:9000/exec?query=SELECT%201`
5. If not running, start QuestDB: `"E:\source\databases\questdb-9.3.1-rt-windows-x86-64\bin\java.exe" -m io.questdb/io.questdb.ServerMain -d "E:\source\databases\questdb-9.3.1-rt-windows-x86-64"`
6. Wait for QuestDB HTTP port 9000 to respond
7. DuckDB: no action needed (embedded, initializes on server startup)

### stop
1. Stop PostgreSQL: `"E:\source\databases\PostgreSQL\pgsql\bin\pg_ctl.exe" stop -D "E:\source\databases\PostgreSQL\pgsql\data" -m fast`
2. Stop QuestDB: Find java.exe process for QuestDB and kill it. Check for PID file at `electron/.questdb.pid`
3. DuckDB: no action needed

### status
Check and report:
- PostgreSQL: `pg_ctl status` + test connection on port 5432
- QuestDB: HTTP health check on port 9000, ILP port 9009, PG wire port 8812
- DuckDB: Check if data/market.duckdb exists and report file size

### reset
1. Stop PostgreSQL if running
2. Drop and recreate database: `dropdb ml_dashboard && createdb ml_dashboard`
3. Start PostgreSQL
4. Run schema push: `npm run db:push`
5. Create TimescaleDB extension if available
6. Seed instruments: `npx tsx scripts/seed-instruments.ts`

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
