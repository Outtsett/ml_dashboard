# MCP Server — FastMCP for Claude Integration

Python FastMCP server that exposes the dashboard's databases to Claude Code and Claude.ai for natural language queries against trading data.

## Architecture

```
Claude Code / Claude.ai
    |
    v
FastMCP Server (run.py)
    |
    +---> QuestDB Tools (7)  ---> psycopg2 pool (PGWire :8812)
    |
    +---> SQLite Tools (6)   ---> sqlite3 read-only connection
    |
    +---> Validation Layer   ---> SQL injection protection, table allowlists, row limits
```

## Files

| File | Purpose |
|---|---|
| `server.py` | FastMCP instance, lifespan management, auth, health check |
| `run.py` | Entry point (streamable HTTP or stdio transport) |
| `db/questdb_conn.py` | psycopg2 connection pool for QuestDB PG wire |
| `db/sqlite_conn.py` | sqlite3 read-only connection to `data/ml_dashboard.db` |
| `db/validation.py` | SQL injection protection, table allowlists, row limits |
| `db/oauth_store.py` | OAuth token storage |
| `tools/questdb_tools.py` | 7 QuestDB tools: query, tables, columns, sample, ohlcv, symbols, inventory |
| `tools/sqlite_tools.py` | 6 SQLite tools: query, tables, columns, sample, training_sessions, models |
| `requirements.txt` | Python dependencies |

## Tools

### QuestDB Tools
- `questdb_query` — Execute arbitrary SELECT on QuestDB
- `questdb_tables` — List all QuestDB tables with row counts
- `questdb_columns` — Show columns for a specific table
- `questdb_sample` — Sample rows from a table
- `questdb_ohlcv` — Query OHLCV data with SAMPLE BY
- `questdb_symbols` — List available symbols
- `questdb_inventory` — Full database inventory

### SQLite Tools
- `sqlite_query` — Execute arbitrary SELECT on SQLite
- `sqlite_tables` — List all tables
- `sqlite_columns` — Show columns for a table
- `sqlite_sample` — Sample rows
- `sqlite_training_sessions` — List training sessions
- `sqlite_models` — List registered models

## Running

Configured in `.mcp.json` at project root. Supports both stdio (Claude Code) and HTTP (Claude.ai) transports.
