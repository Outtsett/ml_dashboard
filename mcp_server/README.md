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

> **The 7 market-data tools do not work.** They open a PG-wire connection to the
> local time-series server that was emptied and retired on 2026-09-10; nothing
> listens on that socket, so every one of them fails at connect. Market data now
> lives in the Iceberg lake at `E:\lake` and is read in-process with DuckDB
> (`from lake.serving import connect`) — the same path `src/ml/shared/data.py`
> already uses. Porting `db/questdb_conn.py` and `tools/questdb_tools.py` onto
> that connection is outstanding work. The 6 SQLite tools are unaffected.

## Files

| File | Purpose |
|---|---|
| `server.py` | FastMCP instance, lifespan management, auth, health check |
| `run.py` | Entry point (streamable HTTP or stdio transport) |
| `db/questdb_conn.py` | psycopg2 connection pool to the retired PG-wire endpoint — dead, pending port to `lake.serving` |
| `db/sqlite_conn.py` | sqlite3 read-only connection to `data/ml_dashboard.db` |
| `db/validation.py` | SQL injection protection, table allowlists, row limits |
| `db/oauth_store.py` | OAuth token storage |
| `tools/questdb_tools.py` | 7 market-data tools: query, tables, columns, sample, ohlcv, symbols, inventory — dead, pending port to `lake.serving` |
| `tools/sqlite_tools.py` | 6 SQLite tools: query, tables, columns, sample, training_sessions, models |
| `requirements.txt` | Python dependencies |

## Tools

### Market data tools (all 7 currently fail — see Architecture)
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
