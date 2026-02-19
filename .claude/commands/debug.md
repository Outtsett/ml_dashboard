# Debug & Health

Troubleshoot the ML Dashboard's databases, APIs, and pipeline.

## Usage: /debug [action]

Actions: health, circuits, rates, logs, inspect

### health
Check all database connections:
- GET `/api/databases/health` — PostgreSQL pool, QuestDB HTTP, DuckDB status
- GET `/api/databases/postgres/stats` — PG table stats and row counts
- GET `/api/databases/questdb/stats` — QuestDB table stats
- GET `/api/databases/duckdb/stats` — DuckDB parquet stats

### circuits
Check circuit breaker states:
- GET `/api/databases/metrics` — all circuit breaker states
- POST `/api/databases/circuit-breaker/reset/:name` — reset specific breaker
- POST `/api/databases/circuit-breaker/reset-all` — reset all

Circuit breakers protect: PostgreSQL, QuestDB, DuckDB connections.

### rates
Check rate limiter status:
- GET `/api/databases/rate-limits`
- Limits: API 100/min, ML 50/min, upload 10/min
- Config in `server/lib/rateLimiter.ts`

### logs
Check server logs for errors:
- PostgreSQL log: `E:\source\databases\PostgreSQL\pgsql\data\pg.log`
- Express logs: stdout (formatted with timestamps)
- QuestDB: check `E:\source\databases\questdb-9.3.1-rt-windows-x86-64\log\` directory

### inspect
Inspect data files:
```bash
npx tsx scripts/inspect-sources.ts
```
Reports schema, row counts, and column types for all source data files.

## Common Issues
- **QuestDB not responding**: Check if java.exe is running. Restart via `/db-manage start`
- **DuckDB mutex timeout**: Only one connection at a time. Check for stuck queries.
- **BigInt errors**: DuckDB COUNT returns BigInt. Wrap with Number() for JSON.
- **Windows paths**: Use forward slashes in Node.js, backslashes in shell.
- **npx tsx failures**: Use full path `npx tsx` not just `tsx`.
- **Port conflicts**: PG 5432, QuestDB 9000/9009/8812, App 5000.
