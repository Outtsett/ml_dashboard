"""Apply create-multi-tf-mat-views.sql to lake and wait for backfill.

Splits the SQL file on `;` boundaries, POSTs each CREATE MATERIALIZED VIEW
to /exec, then polls materialized_views() until every view reports
view_status='valid' AND refresh_base_table_txn == base_table_txn.
"""

import os
import sys
import time
import urllib.parse
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
SQL_FILE = ROOT / "scripts" / "create-multi-tf-mat-views.sql"
HOST = os.environ.get("lake_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("lake_HTTP_PORT", "9000"))
BASE = f"http://{HOST}:{HTTP_PORT}"

EXPECTED_VIEWS = [
    "ohlcv_1m",
    "ohlcv_5m",
    "ohlcv_15m",
    "ohlcv_30m",
    "ohlcv_1h_v",
    "ohlcv_4h",
    "ohlcv_1d",
    "ohlcv_1w",
]


def exec_sql(sql: str) -> dict:
    url = f"{BASE}/exec?query={urllib.parse.quote(sql)}"
    r = requests.get(url, timeout=600)
    r.raise_for_status()
    return r.json()


def split_statements(sql_text: str) -> list[str]:
    parts = []
    buf = []
    for line in sql_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("--") or not stripped:
            continue
        buf.append(line)
        if stripped.endswith(";"):
            parts.append("\n".join(buf).rstrip(";").strip())
            buf = []
    if buf:
        parts.append("\n".join(buf).strip())
    return [p for p in parts if p]


def main() -> int:
    sql_text = SQL_FILE.read_text(encoding="utf-8")
    statements = split_statements(sql_text)
    print(f"Loaded {len(statements)} statements from {SQL_FILE.name}")

    for i, stmt in enumerate(statements, 1):
        head = stmt.splitlines()[0][:80]
        print(f"\n[{i}/{len(statements)}] {head}...")
        t0 = time.time()
        try:
            res = exec_sql(stmt)
        except requests.HTTPError as e:
            print(f"  HTTP {e.response.status_code}: {e.response.text[:500]}")
            return 1
        elapsed = time.time() - t0
        if "ddl" in res and res["ddl"] == "OK":
            print(f"  OK ({elapsed:.1f}s)")
        else:
            print(f"  Response: {res}")

    print("\nPolling materialized_views() until all views are valid + caught up...")
    name_list = ",".join(repr(v) for v in EXPECTED_VIEWS)
    poll_query = (
        "SELECT view_name, view_status, invalidation_reason, "
        "refresh_base_table_txn, base_table_txn "
        "FROM materialized_views() "
        f"WHERE view_name IN ({name_list}) "
        "ORDER BY view_name"
    )
    deadline = time.time() + 60 * 60
    while time.time() < deadline:
        res = exec_sql(poll_query)
        rows = res.get("dataset", [])
        if not rows:
            print("  No matching views yet; waiting...")
            time.sleep(5)
            continue

        all_valid = True
        print()
        for row in rows:
            name, status, inv_reason, refresh_txn, base_txn = row
            refresh_txn = refresh_txn if refresh_txn is not None else -1
            base_txn = base_txn if base_txn is not None else 0
            lag = base_txn - refresh_txn
            print(
                f"  {name:14s} status={status:12s} "
                f"refresh_txn={refresh_txn:>6d}/{base_txn:<6d} lag={lag:>6d} "
                f"inv={inv_reason or '-'}"
            )
            if status != "valid" or refresh_txn != base_txn:
                all_valid = False

        if all_valid and len(rows) == len(EXPECTED_VIEWS):
            print("\nAll views valid and caught up to base table.")
            return 0

        time.sleep(30)

    print("\nTimeout: views did not all reach valid+caught-up state within 1h")
    return 2


if __name__ == "__main__":
    sys.exit(main())

