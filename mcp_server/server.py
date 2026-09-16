"""FastMCP server definition for ml_dashboard databases.

Exposes read-only tools for QuestDB (time-series) and SQLite (app metadata)
via streamable HTTP transport with optional bearer token auth.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from .db import questdb_conn, sqlite_conn
from .tools import questdb_tools, sqlite_tools

logger = logging.getLogger("mcp_server")


@asynccontextmanager
async def lifespan(server: FastMCP) -> AsyncIterator[dict]:
    """Initialize database connections on startup, close on shutdown."""
    logger.info("Starting MCP server lifespan — initializing database connections")
    pool = questdb_conn.get_pool()
    conn = sqlite_conn.get_conn()
    # Pre-cache SQLite table list
    sqlite_conn.get_tables()
    logger.info("Database connections ready")
    try:
        yield {"questdb_pool": pool, "sqlite_conn": conn}
    finally:
        questdb_conn.close_pool()
        sqlite_conn.close_conn()
        logger.info("Database connections closed")


def create_server() -> FastMCP:
    """Create and configure the FastMCP server with all tools."""
    auth = None
    base_url = os.environ.get("MCP_BASE_URL", "").strip()

    if base_url:
        # Full OAuth provider for Claude.ai web (requires public base URL)
        from .db.oauth_store import AutoApproveOAuthProvider

        auth = AutoApproveOAuthProvider(base_url=base_url)
        logger.info("OAuth auth enabled (base_url=%s)", base_url)
    else:
        logger.info("No MCP_BASE_URL set — running without auth (stdio/local mode)")

    mcp = FastMCP(
        name="ml_dashboard",
        instructions=(
            "ML Dashboard database server providing read-only access to two databases:\n\n"
            "1. **QuestDB** (time-series): 856M+ OHLCV candlestick rows across futures and forex "
            "in a unified `ohlcv` table, plus a `symbols` table for instrument metadata. "
            "Use questdb_* tools. QuestDB SQL supports SAMPLE BY, LATEST ON, ASOF JOIN.\n\n"
            "2. **SQLite** (app metadata): ML model registry, training sessions with epoch-level metrics, "
            "feature sets, feature importance rankings, backtest runs and trades, "
            "ensemble configs, instruments, news articles, HPO sessions/trials, "
            "and user preferences. ~30 tables. Use sqlite_* tools.\n\n"
            "Start with questdb_tables() or sqlite_tables() to discover available data. "
            "Use questdb_ohlcv() for market data and questdb_data_inventory() to see what symbols/dates are available."
        ),
        version="1.0.0",
        auth=auth,
        lifespan=lifespan,
    )

    # Register tool modules
    questdb_tools.register(mcp)
    sqlite_tools.register(mcp)

    # Health check endpoint
    @mcp.custom_route("/health", methods=["GET"])
    async def health_check(request: Request) -> JSONResponse:
        qdb_ok = questdb_conn.health_check()
        sqlite_ok = sqlite_conn.health_check()
        status = "ok" if (qdb_ok and sqlite_ok) else "degraded"
        return JSONResponse(
            {
                "status": status,
                "server": "ml_dashboard_mcp",
                "databases": {
                    "questdb": "connected" if qdb_ok else "disconnected",
                    "sqlite": "connected" if sqlite_ok else "disconnected",
                },
            },
            status_code=200 if status == "ok" else 503,
        )

    return mcp
