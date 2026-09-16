"""Market-data connection for the MCP server — DuckDB over the Iceberg lake.

The name is a shim. This used to be a psycopg2 pool against QuestDB's PG-wire
port; QuestDB was retired on 2026-09-10 and every one of the seven market-data
tools had been failing at connect since. The lake is the system of record now
and DuckDB serves it in-process, so there is no server to pool connections to —
`lake.serving.connect()` hands back a connection carrying `bars` plus one view
per table of the frozen serving snapshot.

Thirty-odd call sites and the tool names are kept stable on purpose, so the
public surface here is unchanged: `get_pool`, `query`, `health_check`,
`close_pool`.

DuckDB's Python connection is not safe to use from several threads at once, so
every query runs under a lock. The queries here are read-only metadata and
sample reads; the lock is not a throughput concern.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

logger = logging.getLogger("mcp_server.db.market")

_connection: Any | None = None
_lock = threading.Lock()


def get_pool() -> Any:
    """The shared DuckDB connection over the lake, opened on first use.

    Named `get_pool` because `server.py` and the tools call it that; there is no
    pool any more, because there is no server to pool against.
    """
    global _connection
    with _lock:
        if _connection is None:
            # Imported lazily: the MCP server can start and serve its SQLite
            # tools even when the lake package is not importable.
            from lake.serving import connect

            _connection = connect()
            # The lake stores UTC. Without this DuckDB renders every timestamp in
            # the machine's local zone, so a market-data tool answers in Pacific
            # time about data recorded in UTC.
            _connection.execute("SET TimeZone='UTC'")
            logger.info("DuckDB serving connection opened over the Iceberg lake (UTC)")
        return _connection


def close_pool() -> None:
    """Close the connection."""
    global _connection
    with _lock:
        if _connection is not None:
            try:
                _connection.close()
            except Exception as error:  # noqa: BLE001 - shutdown must not raise
                logger.warning("closing the DuckDB connection failed: %s", error)
            _connection = None
            logger.info("DuckDB serving connection closed")


def query(sql: str) -> list[dict]:
    """Run a read-only query and return rows as dicts. Logs anything over a second."""
    connection = get_pool()
    with _lock:
        # Run on the connection itself, not `connection.cursor()`: a DuckDB
        # cursor is a fresh connection over the same database and does NOT
        # inherit settings, so queries through one came back rendered in the
        # machine's local zone despite the UTC pin above. The lock already
        # serializes access, which is the only thing the cursor was buying.
        start = time.perf_counter()
        result = connection.execute(sql)
        if result.description is None:
            return []
        columns = [description[0] for description in result.description]
        rows = result.fetchall()
    duration_ms = (time.perf_counter() - start) * 1000

    preview = sql[:120] + "..." if len(sql) > 120 else sql
    if duration_ms > 1000:
        logger.warning("SLOW QUERY (%.0fms, %d rows): %s", duration_ms, len(rows), preview)
    else:
        logger.debug("query (%.0fms, %d rows): %s", duration_ms, len(rows), preview)

    return [dict(zip(columns, row)) for row in rows]


def health_check() -> bool:
    """Can the lake actually be read right now?"""
    try:
        query("SELECT 1")
        return True
    except Exception as error:  # noqa: BLE001 - a failed probe is a False, not a crash
        logger.warning("lake health check failed: %s", error)
        return False
