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
    validate_questdb_table,
    validate_readonly_sql,
    validate_table_name,
)

# Each timeframe already has a pre-aggregated view in the serving snapshot.
# Reading it is the difference between a second and two minutes: `ohlcv` holds
# 863 million ONE-SECOND rows, and rolling those up per request grouped the
# whole table before the LIMIT could apply — measured at 116.7 s for three bars.
_TIMEFRAME_VIEW: dict[str, str] = {
    "1m": "ohlcv_1m", "5m": "ohlcv_5m", "15m": "ohlcv_15m", "30m": "ohlcv_30m",
    "1h": "ohlcv_1h_v", "4h": "ohlcv_4h", "1d": "ohlcv_1d", "1w": "ohlcv_1w",
}

# Anything without a view is bucketed off the base table, which is why an
# unknown timeframe is refused rather than silently resampled.
_BUCKET_INTERVAL: dict[str, str] = {
    "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "30m": "30 minutes",
    "1h": "1 hour", "4h": "4 hours", "1d": "1 day", "1w": "7 days",
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
        sql: Annotated[str, "Read-only SQL (DuckDB dialect). Supports time_bucket, ASOF JOIN, window functions, QUALIFY, LIMIT."],
        row_limit: Annotated[int, "Max rows to return (1-100000, default 10000)"] = 10_000,
    ) -> str:
        """Execute an arbitrary read-only SQL query against QuestDB.

        QuestDB uses a SQL dialect with extensions:
        - time_bucket(INTERVAL '5 minutes', timestamp) for time-based aggregation
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
            "WHERE table_schema = 'main' ORDER BY table_name;"
        )

        results = []
        for obj in objects:
            name = obj["table_name"]
            try:
                safe_name = validate_table_name(name)
                count_result = questdb_conn.query(
                    f"SELECT count(*) as cnt FROM {safe_name};"
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
        rows = questdb_conn.query(f"DESCRIBE {safe_table};")
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

        Reads the pre-aggregated view for the timeframe, newest bars first.

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

        view = _TIMEFRAME_VIEW.get(tf)
        if view is None:
            return json.dumps({
                "error": f"unknown timeframe '{timeframe}'",
                "available": sorted(_TIMEFRAME_VIEW),
            })

        # The view is already at this timeframe, so this is a filtered read, not
        # an aggregation. Newest first, because a bare request for N bars of a
        # multi-year series means the most recent N.
        sql = (
            f"SELECT timestamp, symbol, open, high, low, close, volume "
            f"FROM {view} "
            f"WHERE {where_clause} "
            f"ORDER BY timestamp DESC "
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
        Grouped per symbol straight off the lake.
        """
        safe_table = validate_questdb_table(table)

        rows = questdb_conn.query(
            f"SELECT symbol, count(*) as rows, "
            f"min(timestamp) as first_ts, max(timestamp) as last_ts "
            f"FROM {safe_table} "
            f"GROUP BY symbol ORDER BY symbol;"
        )
        return json.dumps({"table": safe_table, "inventory": rows}, default=str)
