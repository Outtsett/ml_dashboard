"""MCP server entry point.

Usage:
  HTTP (for Claude.ai web):  python -m mcp_server.run
  stdio (for Claude Code):   Invoked automatically when configured as stdio MCP server

The transport is determined by how the server is started:
  - Direct execution (python -m mcp_server.run) -> streamable HTTP on MCP_HOST:MCP_PORT
  - FastMCP stdio invocation -> stdio transport (default when no args)
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load .env from mcp_server directory
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)

from .server import create_server

mcp = create_server()

if __name__ == "__main__":
    host = os.environ.get("MCP_HOST", "0.0.0.0")
    port = int(os.environ.get("MCP_PORT", "8080"))

    print(f"Starting ml_dashboard MCP server on {host}:{port}")
    print(f"Health check: http://{host}:{port}/health")
    print(f"MCP endpoint: http://{host}:{port}/mcp/")

    mcp.run(transport="streamable-http", host=host, port=port)
