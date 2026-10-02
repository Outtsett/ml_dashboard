"""MCP server entry point.

Usage:
  stdio (Claude Code, the dashboard's Claude panel):  python -m mcp_server.run
  HTTP  (Claude.ai web, via a tunnel):                 python -m mcp_server.run --http
                                                       (or MCP_TRANSPORT=http)

stdio is the default because that is what every local client launches: Claude
Code's `.mcp.json` entry runs the bare module and speaks JSON-RPC over the
child's stdin/stdout. Nothing may print to stdout in stdio mode — logging goes
to stderr (logging.basicConfig's default stream).
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

# Configure logging (stderr — stdout carries the stdio protocol)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stderr,
)

from .server import create_server

mcp = create_server()


def _wants_http(argv: list[str]) -> bool:
    return "--http" in argv or os.environ.get("MCP_TRANSPORT", "").strip().lower() == "http"


if __name__ == "__main__":
    if _wants_http(sys.argv[1:]):
        host = os.environ.get("MCP_HOST", "0.0.0.0")
        port = int(os.environ.get("MCP_PORT", "8080"))
        print(f"Starting ml_dashboard MCP server on {host}:{port}", file=sys.stderr)
        print(f"Health check: http://{host}:{port}/health", file=sys.stderr)
        print(f"MCP endpoint: http://{host}:{port}/mcp/", file=sys.stderr)
        mcp.run(transport="streamable-http", host=host, port=port)
    else:
        mcp.run(transport="stdio")
