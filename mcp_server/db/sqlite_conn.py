"""SQLite read-only connection manager.

Opens the database in read-only mode via URI (?mode=ro) to enforce
no-write at the engine level. Mirrors patterns from:
  src/server/database/db.ts (read-only connection)
"""

from __future__ import annotations

import logging
import os
import sqlite3
import time
from pathlib import Path

logger = logging.getLogger("mcp_server.db.sqlite")

_conn: sqlite3.Connection | None = None
_table_cache: set[str] | None = None


def _get_db_path() -> str:
    """Resolve the SQLite database path from env or default."""
    path = os.environ.get(
        "SQLITE_PATH",
        r"E:\source\repos\ml_dashboard\data\ml_dashboard.db",
    )
    # Verify file exists
    if not Path(path).exists():
        raise FileNotFoundError(f"SQLite database not found: {path}")
    return path


def get_conn() -> sqlite3.Connection:
    """Get or create the read-only SQLite connection singleton."""
    global _conn
    if _conn is None:
        db_path = _get_db_path()
        # Forward-slash the path for URI format, escape special chars
        uri_path = Path(db_path).as_posix()
        uri = f"file:{uri_path}?mode=ro"

        _conn = sqlite3.connect(uri, uri=True, check_same_thread=False)
        _conn.execute("PRAGMA busy_timeout = 5000;")
        # Read journal_mode but don't try to set it (read-only)
        logger.info("SQLite connection opened (read-only): %s", db_path)
    return _conn


def close_conn() -> None:
    """Close the SQLite connection."""
    global _conn, _table_cache
    if _conn is not None:
        _conn.close()
        _conn = None
        _table_cache = None
        logger.info("SQLite connection closed")


def get_tables() -> set[str]:
    """Get cached set of table names from sqlite_master."""
    global _table_cache
    if _table_cache is None:
        conn = get_conn()
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
        )
        _table_cache = {row[0] for row in cursor.fetchall()}
        logger.info("SQLite table cache populated: %d tables", len(_table_cache))
    return _table_cache


def query(sql: str) -> list[dict]:
    """Execute a read-only SQL query and return results as list of dicts."""
    conn = get_conn()
    start = time.perf_counter()
    cursor = conn.execute(sql)
    duration_ms = (time.perf_counter() - start) * 1000

    if cursor.description is None:
        return []

    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()

    preview = sql[:120] + "..." if len(sql) > 120 else sql
    if duration_ms > 1000:
        logger.warning(
            "SLOW QUERY (%.0fms, %d rows): %s",
            duration_ms, len(rows), preview,
        )
    else:
        logger.debug(
            "query (%.0fms, %d rows): %s",
            duration_ms, len(rows), preview,
        )

    return [dict(zip(columns, row)) for row in rows]


def health_check() -> bool:
    """Quick connectivity test."""
    try:
        conn = get_conn()
        conn.execute("SELECT 1;")
        return True
    except Exception as e:
        logger.warning("SQLite health check failed: %s", e)
        return False
