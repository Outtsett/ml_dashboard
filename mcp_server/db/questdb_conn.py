"""QuestDB connection pool via psycopg2 PGWire protocol.

Mirrors the connection pattern from:
  src/server/database/questdb/connection.ts
"""

from __future__ import annotations

import logging
import os
import time

import psycopg2
import psycopg2.extras
import psycopg2.pool

logger = logging.getLogger("mcp_server.db.questdb")

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    """Get or create the QuestDB connection pool singleton."""
    global _pool
    if _pool is None:
        host = os.environ.get("QUESTDB_HOST", "localhost")
        port = int(os.environ.get("QUESTDB_PG_PORT", "8812"))
        user = os.environ.get("QUESTDB_USER", "admin")
        password = os.environ.get("QUESTDB_PASSWORD", "quest")

        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=5,
            host=host,
            port=port,
            database="qdb",
            user=user,
            password=password,
            options="-c statement_timeout=60000",
        )
        logger.info("QuestDB pool initialized (host=%s, port=%d, max=5)", host, port)
    return _pool


def close_pool() -> None:
    """Close the connection pool."""
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None
        logger.info("QuestDB pool closed")


def query(sql: str) -> list[dict]:
    """Execute a read-only SQL query and return results as list of dicts.

    Uses cursor.description for column names. Logs slow queries (>1s).
    """
    pool = get_pool()
    conn = pool.getconn()
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            start = time.perf_counter()
            cur.execute(sql)
            duration_ms = (time.perf_counter() - start) * 1000

            if cur.description is None:
                return []

            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()

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
    finally:
        pool.putconn(conn)


def health_check() -> bool:
    """Quick connectivity test with 3s timeout."""
    try:
        pool = get_pool()
        conn = pool.getconn()
        try:
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
            return True
        finally:
            pool.putconn(conn)
    except Exception as e:
        logger.warning("QuestDB health check failed: %s", e)
        return False
