"""QuestDB MCP tools — read-only query and introspection for time-series data.

7 tools:
  questdb_query          — Arbitrary read-only SQL (QuestDB dialect)
  questdb_tables         — List all tables/views with row counts
  questdb_columns        — Column schema for a specific table
  questdb_sample_data    — Preview rows from a table
  questdb_ohlcv          — Domain-specific OHLCV candle retrieval
  questdb_symbol_list    — Distinct symbols in a table
  questdb_data_inventory — Per-symbol date ranges and row counts
"""

from __future__ import annotations

import json
from typing import Annotated

from fastmcp import FastMCP

from ..db import questdb_conn
from ..db.validation import (
    enforce_row_limit,
    get_row_limit,
    validate_questdb_table,
    validate_readonly_sql,
    validate_table_name,
)

# SAMPLE BY intervals for OHLCV timeframe aggregation (no materialized views)
_SAMPLE_BY_MAP: dict[str, str] = {
    "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "4h": "4h", "1d": "1d", "1w": "7d",
}


def _serialize(rows: list[dict], total_count: int | None = None) -> str:
    """Serialize query results to JSON with optional truncation metadata."""
    result: dict = {"rows": rows, "count": len(rows)}
    if total_count is not None and total_count > len(rows):
        result["total_count"] = total_count
        result["truncated"] = True
    return json.dumps(result, default=str, ensure_ascii=False)


def register(mcp: FastMCP) -> None:
    """Register all QuestDB tools on the given FastMCP server."""

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"questdb", "query"},
    )
    def questdb_query(
        sql: Annotated[str, "Read-only SQL query (QuestDB dialect). Supports SAMPLE BY, LATEST ON, ASOF JOIN, WHERE IN, LIMIT."],
        row_limit: Annotated[int, "Max rows to return (1-100000, default 10000)"] = 10_000,
    ) -> str:
        """Execute an arbitrary read-only SQL query against QuestDB.

        QuestDB uses a SQL dialect with extensions:
        - SAMPLE BY for time-based aggregation
        - LATEST ON for latest row per symbol
        - ASOF JOIN / LT JOIN for time-aligned joins
        - LIMIT with negative offset for last N rows

        Unified schema: single ohlcv table (895M+ rows) for all asset classes
        (futures, forex, equities, crypto) with asset_class and root columns.
        Also: symbols table for instrument metadata.
        """
        is_safe, error = validate_readonly_sql(sql)
        if not is_safe:
            return json.dumps({"error": error})

        row_limit = max(1, min(row_limit, 100_000))
        limited_sql = enforce_row_limit(sql, row_limit)
        rows = questdb_conn.query(limited_sql)
        return _serialize(rows)

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"questdb", "schema"},
    )
    def questdb_tables() -> str:
        """List all QuestDB tables with row counts.

        Returns type classification for each table object found.
        """
        objects = questdb_conn.query(
            "SELECT table_name, table_type FROM information_schema.tables "
            "WHERE table_schema = 'public';"
        )

        results = []
        for obj in objects:
            name = obj["table_name"]
            try:
                safe_name = validate_table_name(name)
                count_result = questdb_conn.query(
                    f"SELECT count() as cnt FROM {safe_name};"
                )
                row_count = int(count_result[0]["cnt"]) if count_result else 0
            except Exception:
                row_count = 0

            results.append({
                "name": name,
                "type": obj.get("table_type", "UNKNOWN"),
                "row_count": row_count,
            })

        results.sort(key=lambda x: x["name"])
        return json.dumps(results, default=str)

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"questdb", "schema"},
    )
    def questdb_columns(
        table: Annotated[str, "Table name (must be in allowlist)"],
    ) -> str:
        """Get column names and types for a specific QuestDB table."""
        safe_table = validate_questdb_table(table)
        rows = questdb_conn.query(f"SHOW COLUMNS FROM {safe_table};")
        return json.dumps(rows, default=str)

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"questdb", "data"},
    )
    def questdb_sample_data(
        table: Annotated[str, "Table name (must be in allowlist)"],
        limit: Annotated[int, "Number of rows to preview (1-1000, default 100)"] = 100,
    ) -> str:
        """Preview sample rows from a QuestDB table."""
        safe_table = validate_questdb_table(table)
        limit = max(1, min(limit, 1000))
        rows = questdb_conn.query(f"SELECT * FROM {safe_table} LIMIT {limit};")
        return _serialize(rows)

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"questdb", "market-data"},
    )
    def questdb_ohlcv(
        symbol: Annotated[str, "Trading symbol (e.g., ESH5, MNQH5, EURUSD, AAPL)"],
        timeframe: Annotated[str, "Candle timeframe: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w"] = "1d",
        start_date: Annotated[str | None, "Start date in YYYY-MM-DD format (optional)"] = None,
        end_date: Annotated[str | None, "End date in YYYY-MM-DD format (optional)"] = None,
        asset_class: Annotated[str | None, "Filter by asset class: futures, forex, equity, crypto (optional)"] = None,
        limit: Annotated[int, "Max rows to return (1-50000, default 5000)"] = 5000,
    ) -> str:
        """Get OHLCV candlestick data for a symbol at a specific timeframe.

        Uses SAMPLE BY aggregation on the unified ohlcv table.

        Available timeframes: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w
        All asset classes in one table: futures (ESH5), forex (EURUSD), equities, crypto.
        """
        limit = max(1, min(limit, 50_000))
        tf = timeframe.lower().strip()

        where_parts = [f"symbol = '{symbol}'"]
        if asset_class:
            where_parts.append(f"asset_class = '{asset_class}'")
        if start_date:
            where_parts.append(f"timestamp >= '{start_date}'")
        if end_date:
            where_parts.append(f"timestamp <= '{end_date}'")
        where_clause = " AND ".join(where_parts)

        sample_interval = _SAMPLE_BY_MAP.get(tf, "1d")
        sql = (
            f"SELECT timestamp, symbol, "
            f"first(open) as open, max(high) as high, "
            f"min(low) as low, last(close) as close, "
            f"sum(volume) as volume "
            f"FROM ohlcv "
            f"WHERE {where_clause} "
            f"SAMPLE BY {sample_interval} "
            f"LIMIT {limit};"
        )

        rows = questdb_conn.query(sql)
        return _serialize(rows)

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"questdb", "market-data"},
    )
    def questdb_symbol_list(
        table: Annotated[str, "Table to query symbols from (default: ohlcv)"] = "ohlcv",
    ) -> str:
        """Get distinct trading symbols available in a QuestDB table.

        Queries DISTINCT symbol directly from the base table.
        """
        safe_table = validate_questdb_table(table)
        rows = questdb_conn.query(f"SELECT DISTINCT symbol FROM {safe_table};")
        symbols = sorted([row["symbol"] for row in rows])
        return json.dumps({"symbols": symbols, "count": len(symbols)})

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"questdb", "market-data"},
    )
    def questdb_data_inventory(
        table: Annotated[str, "Table to inventory (default: ohlcv)"] = "ohlcv",
    ) -> str:
        """Get per-symbol data coverage: date ranges and row counts.

        Useful for understanding what data is available before querying.
        Uses SAMPLE BY 1d to aggregate before GROUP BY for performance on large tables.
        """
        safe_table = validate_questdb_table(table)

        rows = questdb_conn.query(
            f"SELECT symbol, count() as rows, "
            f"min(timestamp) as first_ts, max(timestamp) as last_ts "
            f"FROM {safe_table} "
            f"GROUP BY symbol ORDER BY symbol;"
        )
        return json.dumps({"table": safe_table, "inventory": rows}, default=str)
