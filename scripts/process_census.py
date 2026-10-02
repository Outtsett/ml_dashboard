"""Snapshot every OS process into DuckDB, classified by which application owns it.

Answers "why are there so many node processes?" with data rather than impression.
The distinction that matters is LAUNCHER plumbing (a shell wrapper that starts
something and then idles) versus RUNTIME (a process actually doing work). A
`npm run dev` on Windows costs five node processes, only the last of which
serves anything.

Writes table `process_census` into data/diagnostics.duckdb, appending one
snapshot per run so counts can be compared across time.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import pathlib
import re

import duckdb
import psutil

REPOSITORY_ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_PATH = REPOSITORY_ROOT / "data" / "diagnostics.duckdb"

# Every classification rule, in priority order: (owner_category, is_launcher, pattern)
CLASSIFICATION_RULES: list[tuple[str, bool, re.Pattern[str]]] = [
    ("claude_code_model_context_protocol_server", True,
     re.compile(r"npx-cli\.js", re.IGNORECASE)),
    ("claude_code_model_context_protocol_server", False,
     re.compile(r"_npx|modelcontextprotocol|mcp-server|/mcp/|chrome-devtools-mcp|"
                r"desktop-commander|firebase-tools|mongodb-mcp|@playwright/mcp|aikidosec|"
                r"notebooklm-mcp", re.IGNORECASE)),
    ("dashboard_launcher_npm", True,
     re.compile(r"npm-cli\.js.*run\s+dev", re.IGNORECASE)),
    ("dashboard_launcher_cross_env", True,
     re.compile(r"cross-env/src/bin/cross-env\.js", re.IGNORECASE)),
    ("dashboard_launcher_tsx_command_line", True,
     re.compile(r"tsx/dist/cli\.mjs", re.IGNORECASE)),
    ("dashboard_launcher_node_watch_supervisor", True,
     re.compile(r"--watch.*--import\s+tsx.*apps/api/main\.ts", re.IGNORECASE)),
    ("dashboard_server_runtime", False,
     re.compile(r"ml_dashboard.*tsx/dist/preflight", re.IGNORECASE)),
    ("dashboard_server_runtime", False,
     re.compile(r"--import\s+tsx.*apps/api/main\.ts", re.IGNORECASE)),
    ("dashboard_production_runtime", False,
     re.compile(r"ml_dashboard.*dist/index\.cjs", re.IGNORECASE)),
    ("dashboard_hardware_telemetry_node", False,
     re.compile(r"hardware_node\.py", re.IGNORECASE)),
    ("dashboard_esbuild_service", False,
     re.compile(r"esbuild.*--service=", re.IGNORECASE)),
    ("dashboard_marimo_notebook_server", False,
     re.compile(r"marimo\s+(run|edit)", re.IGNORECASE)),
]

TABLE_DEFINITION = """
CREATE TABLE IF NOT EXISTS process_census (
    snapshot_timestamp            TIMESTAMP,
    process_identifier            BIGINT,
    parent_process_identifier     BIGINT,
    process_name                  VARCHAR,
    owner_category                VARCHAR,
    is_launcher_plumbing          BOOLEAN,
    resident_memory_megabytes     DOUBLE,
    listening_port_count          BIGINT,
    listening_ports               VARCHAR,
    launcher_chain_depth          BIGINT,
    command_line                  VARCHAR
)
"""


def normalize(command_line: str) -> str:
    """Backslashes to forward slashes so one pattern matches either spelling."""
    return command_line.replace("\\", "/")


def classify(command_line: str, process_name: str) -> tuple[str, bool]:
    """Return (owner_category, is_launcher_plumbing) for one process."""
    normalized = normalize(command_line)
    for category, is_launcher, pattern in CLASSIFICATION_RULES:
        if pattern.search(normalized):
            return category, is_launcher
    if process_name.lower() in {"cmd.exe", "conhost.exe"}:
        return "shell_wrapper", True
    return "other_application", False


def collect_snapshot() -> list[dict]:
    """Walk every visible process once and classify it."""
    snapshot_timestamp = _dt.datetime.now()

    listening_by_process: dict[int, list[int]] = {}
    for _connection in psutil.net_connections(kind="inet"):
        if _connection.status == psutil.CONN_LISTEN and _connection.pid:
            listening_by_process.setdefault(_connection.pid, []).append(
                _connection.laddr.port)

    raw: dict[int, dict] = {}
    for _process in psutil.process_iter(
            ["pid", "ppid", "name", "cmdline", "memory_info"]):
        try:
            _info = _process.info
            _command_line = " ".join(_info.get("cmdline") or [])
            _memory = _info.get("memory_info")
            _ports = sorted(set(listening_by_process.get(_info["pid"], [])))
            _category, _is_launcher = classify(_command_line, _info.get("name") or "")
            raw[_info["pid"]] = {
                "snapshot_timestamp": snapshot_timestamp,
                "process_identifier": _info["pid"],
                "parent_process_identifier": _info.get("ppid") or 0,
                "process_name": _info.get("name") or "",
                "owner_category": _category,
                "is_launcher_plumbing": _is_launcher,
                "resident_memory_megabytes": round(
                    (_memory.rss if _memory else 0) / (1024 * 1024), 1),
                "listening_port_count": len(_ports),
                "listening_ports": ",".join(str(_p) for _p in _ports),
                "launcher_chain_depth": 0,
                "command_line": _command_line[:2000],
            }
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    # Depth = how many ancestors share the dashboard/MCP launch chain. Measures
    # exactly the plumbing this census exists to expose.
    for _pid, _row in raw.items():
        _depth, _cursor, _guard = 0, _row["parent_process_identifier"], 0
        while _cursor in raw and _guard < 25:
            _parent = raw[_cursor]
            if not (_parent["is_launcher_plumbing"]
                    or _parent["owner_category"].startswith("dashboard")):
                break
            _depth += 1
            _cursor = _parent["parent_process_identifier"]
            _guard += 1
        _row["launcher_chain_depth"] = _depth

    # `tsx --watch` runs the app in a forked child, so BOTH the supervisor and
    # the app carry the same preflight command line. The child of a preflight
    # process is the one actually serving; its parent only watches and restarts.
    _runtime_parents = {
        _r["parent_process_identifier"]
        for _r in raw.values()
        if _r["owner_category"] == "dashboard_server_runtime"
    }
    for _pid, _row in raw.items():
        if _row["owner_category"] != "dashboard_server_runtime":
            continue
        if _pid in _runtime_parents:
            _row["owner_category"] = "dashboard_launcher_tsx_watch_supervisor"
            _row["is_launcher_plumbing"] = True

    return list(raw.values())


def write_snapshot(rows: list[dict], database_path: pathlib.Path) -> int:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    _connection = duckdb.connect(str(database_path))
    try:
        _connection.execute(TABLE_DEFINITION)
        _connection.executemany(
            "INSERT INTO process_census VALUES ("
            "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [tuple(_r.values()) for _r in rows],
        )
        return _connection.execute(
            "SELECT count(*) FROM process_census").fetchone()[0]
    finally:
        _connection.close()


def main() -> None:
    _parser = argparse.ArgumentParser(description=__doc__)
    _parser.add_argument("--database-path", default=str(DEFAULT_DATABASE_PATH))
    _arguments = _parser.parse_args()

    _rows = collect_snapshot()
    _total = write_snapshot(_rows, pathlib.Path(_arguments.database_path))

    print(f"snapshot rows written : {len(_rows)}")
    print(f"total rows in table   : {_total}")
    _node = [_r for _r in _rows if _r["process_name"].lower() == "node.exe"]
    print(f"node.exe processes    : {len(_node)}")
    for _category in sorted({_r['owner_category'] for _r in _node}):
        _group = [_r for _r in _node if _r["owner_category"] == _category]
        _megabytes = sum(_r["resident_memory_megabytes"] for _r in _group)
        print(f"  {_category:<46} {len(_group):>3}  {_megabytes:>8.0f} MB")


if __name__ == "__main__":
    main()
