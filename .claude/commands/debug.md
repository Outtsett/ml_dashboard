# Debug & Health

Troubleshoot the ML Dashboard's databases, APIs, and pipeline.

## Usage: /debug [action]

Actions: health, circuits, rates, logs, inspect

### health
Check all database connections:
- GET `/api/databases/health` — SQLite status, QuestDB HTTP health
- GET `/api/databases/questdb/stats` — QuestDB table stats and row counts

### circuits
Check circuit breaker states:
- GET `/api/databases/metrics` — all circuit breaker states
- POST `/api/databases/circuit-breaker/reset/:name` — reset specific breaker
- POST `/api/databases/circuit-breaker/reset-all` — reset all

Circuit breakers protect: SQLite and QuestDB connections.

### rates
Check rate limiter status:
- GET `/api/databases/rate-limits`
- Limits: API 100/min, ML 50/min, upload 10/min
- Config in `server/lib/rateLimiter.ts`

### logs
Check server logs for errors:
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
- **QuestDB LIMIT syntax**: `LIMIT offset, count` (NOT `LIMIT count OFFSET offset`)
- **QuestDB /imp timestamps**: Require `T` separator, no timezone offset like `+00`
- **Windows paths**: Use forward slashes in Node.js, backslashes in shell.
- **npx tsx failures**: Use full path `npx tsx` not just `tsx`.
- **Port conflicts**: QuestDB 9000/9009/8812, App 5000.
