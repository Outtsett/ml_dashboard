"""SQLite MCP tools — read-only query and introspection for app metadata.

6 tools:
  sqlite_query              — Arbitrary read-only SQL
  sqlite_tables             — List all tables with row counts and column info
  sqlite_columns            — Column schema for a specific table
  sqlite_sample_data        — Preview rows from a table
  sqlite_training_sessions  — Domain-specific: training session history
  sqlite_models             — Domain-specific: ML model registry
"""

from __future__ import annotations

import json
from typing import Annotated

from fastmcp import FastMCP

from ..db import sqlite_conn
from ..db.validation import (
    enforce_row_limit,
    validate_readonly_sql,
    validate_sqlite_table,
)


def _serialize(rows: list[dict], total_count: int | None = None) -> str:
    """Serialize query results to JSON with optional truncation metadata."""
    result: dict = {"rows": rows, "count": len(rows)}
    if total_count is not None and total_count > len(rows):
        result["total_count"] = total_count
        result["truncated"] = True
    return json.dumps(result, default=str, ensure_ascii=False)


def register(mcp: FastMCP) -> None:
    """Register all SQLite tools on the given FastMCP server."""

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"sqlite", "query"},
    )
    def sqlite_query(
        sql: Annotated[str, "Read-only SQL query (SQLite dialect). Standard SQL with SQLite extensions."],
        row_limit: Annotated[int, "Max rows to return (1-50000, default 10000)"] = 10_000,
    ) -> str:
        """Execute an arbitrary read-only SQL query against SQLite.

        The SQLite database contains ML model metadata, training sessions,
        feature sets, backtest results, instruments, news articles, HPO trials,
        and user preferences. ~30 tables total.
        """
        is_safe, error = validate_readonly_sql(sql)
        if not is_safe:
            return json.dumps({"error": error})

        row_limit = max(1, min(row_limit, 50_000))
        limited_sql = enforce_row_limit(sql, row_limit)
        rows = sqlite_conn.query(limited_sql)
        return _serialize(rows)

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"sqlite", "schema"},
    )
    def sqlite_tables() -> str:
        """List all SQLite tables with row counts and column definitions.

        Returns table name, row count, and column list (name, type, nullable, pk).
        """
        tables = sorted(sqlite_conn.get_tables())
        results = []

        for table_name in tables:
            try:
                # Get row count
                count_rows = sqlite_conn.query(
                    f"SELECT count(*) as cnt FROM [{table_name}];"
                )
                row_count = count_rows[0]["cnt"] if count_rows else 0

                # Get column info
                col_rows = sqlite_conn.query(
                    f"PRAGMA table_info([{table_name}]);"
                )
                columns = [
                    {
                        "name": c["name"],
                        "type": c["type"],
                        "nullable": c["notnull"] == 0,
                        "pk": c["pk"] == 1,
                    }
                    for c in col_rows
                ]
            except Exception:
                row_count = 0
                columns = []

            results.append({
                "name": table_name,
                "row_count": row_count,
                "columns": columns,
            })

        return json.dumps(results, default=str)

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"sqlite", "schema"},
    )
    def sqlite_columns(
        table: Annotated[str, "Table name"],
    ) -> str:
        """Get detailed column schema for a specific SQLite table.

        Returns column name, type, nullable flag, default value, and primary key status.
        """
        allowlist = sqlite_conn.get_tables()
        safe_table = validate_sqlite_table(table, allowlist)
        rows = sqlite_conn.query(f"PRAGMA table_info([{safe_table}]);")
        columns = [
            {
                "cid": r["cid"],
                "name": r["name"],
                "type": r["type"],
                "notnull": bool(r["notnull"]),
                "default_value": r["dflt_value"],
                "pk": bool(r["pk"]),
            }
            for r in rows
        ]
        return json.dumps(columns, default=str)

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"sqlite", "data"},
    )
    def sqlite_sample_data(
        table: Annotated[str, "Table name"],
        limit: Annotated[int, "Number of rows to preview (1-1000, default 100)"] = 100,
    ) -> str:
        """Preview sample rows from a SQLite table."""
        allowlist = sqlite_conn.get_tables()
        safe_table = validate_sqlite_table(table, allowlist)
        limit = max(1, min(limit, 1000))
        rows = sqlite_conn.query(f"SELECT * FROM [{safe_table}] LIMIT {limit};")
        return _serialize(rows)

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"sqlite", "ml"},
    )
    def sqlite_training_sessions(
        status: Annotated[str | None, "Filter by status: running, completed, failed, stopped (optional)"] = None,
        model_type: Annotated[str | None, "Filter by model name/type (optional)"] = None,
        limit: Annotated[int, "Max rows to return (1-1000, default 50)"] = 50,
    ) -> str:
        """Get training session history from the ML dashboard.

        Returns session ID, model name, status, epoch progress, loss metrics,
        and walk-forward group info. Useful for tracking experiment progress.
        """
        limit = max(1, min(limit, 1000))
        where_parts: list[str] = []
        if status:
            # Sanitize status value
            allowed_statuses = {"running", "completed", "failed", "stopped", "queued"}
            if status.lower() not in allowed_statuses:
                return json.dumps({"error": f"Invalid status. Must be one of: {', '.join(sorted(allowed_statuses))}"})
            where_parts.append(f"status = '{status.lower()}'")

        if model_type:
            # Escape single quotes in model_type
            safe_model = model_type.replace("'", "''")
            where_parts.append(f"model_name LIKE '%{safe_model}%'")

        where_clause = " WHERE " + " AND ".join(where_parts) if where_parts else ""
        sql = (
            f"SELECT id, model_name, status, current_epoch, max_epochs, "
            f"current_loss, current_val_loss, learning_rate, "
            f"model_type, symbol, timeframe, quality_score, evaluation_grade, "
            f"started_at, updated_at "
            f"FROM training_sessions{where_clause} "
            f"ORDER BY started_at DESC LIMIT {limit};"
        )
        rows = sqlite_conn.query(sql)
        return _serialize(rows)

    @mcp.tool(
        annotations={"readOnlyHint": True},
        tags={"sqlite", "ml"},
    )
    def sqlite_models(
        status: Annotated[str | None, "Filter by status: draft, training, trained, deployed (optional)"] = None,
        architecture: Annotated[str | None, "Filter by architecture type (optional)"] = None,
        limit: Annotated[int, "Max rows to return (1-1000, default 50)"] = 50,
    ) -> str:
        """Get ML model registry from the dashboard.

        Returns model name, version, architecture, training data range,
        performance metrics, and deployment status.
        """
        limit = max(1, min(limit, 1000))
        where_parts: list[str] = []

        if status:
            allowed_statuses = {"draft", "training", "trained", "deployed", "archived"}
            if status.lower() not in allowed_statuses:
                return json.dumps({"error": f"Invalid status. Must be one of: {', '.join(sorted(allowed_statuses))}"})
            where_parts.append(f"status = '{status.lower()}'")

        if architecture:
            safe_arch = architecture.replace("'", "''")
            where_parts.append(f"architecture LIKE '%{safe_arch}%'")

        where_clause = " WHERE " + " AND ".join(where_parts) if where_parts else ""
        sql = (
            f"SELECT id, name, version, architecture, category, status, "
            f"training_data_start, training_data_end, metrics, created_at, updated_at "
            f"FROM ml_models{where_clause} "
            f"ORDER BY updated_at DESC LIMIT {limit};"
        )
        rows = sqlite_conn.query(sql)
        return _serialize(rows)
