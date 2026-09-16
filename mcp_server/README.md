# MCP Server — FastMCP for Claude Integration

Python FastMCP server that exposes the dashboard's databases to Claude Code and Claude.ai for natural language queries against trading data.

## Architecture

```
Claude Code / Claude.ai
    |
    v
FastMCP Server (run.py)
    |
    +---> Market data tools (7) ---> psycopg2 pool  [BROKEN — see below]
    |
    +---> SQLite Tools (6)      ---> sqlite3 read-only connection
    |
    +---> Validation Layer      ---> SQL injection protection, table allowlists, row limits
```

> **The 7 market-data tools read the Iceberg lake** (ported 2026-09-16). They
> used to open a PG-wire connection to the time-series server retired on
> 2026-09-10 and failed at connect. They now go through
> `from lake.serving import connect` — in-process DuckDB over `E:\lake`, the same
> path `src/ml/shared/data.py` uses. Tool names are unchanged, so the MCP
> contract held across the port. Three things the port had to get right:
> the connection is pinned to `SET TimeZone='UTC'` (the lake stores UTC and
> DuckDB otherwise renders the machine's local zone); queries run on the
> connection rather than a `.cursor()`, because a DuckDB cursor is a fresh
> connection that does not inherit that setting; and `questdb_ohlcv` reads the
> pre-aggregated view for the timeframe instead of rolling up the 863M-row
> one-second base table, which took 116.7 s for three bars.

## Files

| File | Purpose |
|---|---|
| `server.py` | FastMCP instance, lifespan management, auth, health check |
| `run.py` | Entry point (streamable HTTP or stdio transport) |
| `db/questdb_conn.py` | DuckDB connection over the Iceberg lake via `lake.serving.connect()`, pinned to UTC. Name kept as a shim. |
| `db/sqlite_conn.py` | sqlite3 read-only connection to `data/ml_dashboard.db` |
| `db/validation.py` | SQL injection protection, row limits, and a table allowlist READ FROM THE LAKE — the hardcoded QuestDB-era list rejected 12 of the 42 objects, `bars` included |
| `db/oauth_store.py` | OAuth token storage |
| `tools/questdb_tools.py` | 7 market-data tools: query, tables, columns, sample, ohlcv, symbols, inventory — DuckDB dialect |
| `tools/sqlite_tools.py` | 6 SQLite tools: query, tables, columns, sample, training_sessions, models |
| `requirements.txt` | Python dependencies |

## Tools

### Market data tools (all 7 working against the lake)
Tool names are unchanged so the MCP contract stays stable through the port:
- `questdb_query` — Execute arbitrary SELECT against market data
- `questdb_tables` — List all market-data tables with row counts
- `questdb_columns` — Show columns for a specific table
- `questdb_sample` — Sample rows from a table
- `questdb_ohlcv` — Query OHLCV data at a timeframe
- `questdb_symbols` — List available symbols
- `questdb_inventory` — Full market-data inventory

### SQLite Tools
- `sqlite_query` — Execute arbitrary SELECT on SQLite
- `sqlite_tables` — List all tables
- `sqlite_columns` — Show columns for a table
- `sqlite_sample` — Sample rows
- `sqlite_training_sessions` — List training sessions
- `sqlite_models` — List registered models

## Running

Configured in `.mcp.json` at project root. Supports both stdio (Claude Code) and HTTP (Claude.ai) transports.
