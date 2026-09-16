"""End-to-end verification of multi-TF mat views + parquet exports.

Runs all 5 checks from the plan:
  1. Mat view existence + status
  2. Row counts sanity (per symbol per TF)
  3. Aggregation correctness spot-check (1d bar matches manual aggregation)
  4. Parquet readability (load each file, assert non-empty + schema)
  5. Live integration check (row count parity DB <-> parquet)
"""

import os
import sys
import urllib.parse
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
PARQUET_DIR = ROOT / "data" / "parquet"
HOST = os.environ.get("QUESTDB_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("QUESTDB_HTTP_PORT", "9000"))
BASE = f"http://{HOST}:{HTTP_PORT}"

SYMBOLS = ["MNQ", "EURUSD"]
TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]
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
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    return r.json()


def check_1_mat_view_status() -> bool:
    print("\n[1/5] Mat view status check")
    name_list = ",".join(repr(v) for v in EXPECTED_VIEWS)
    res = exec_sql(
        "SELECT view_name, view_status, invalidation_reason, "
        "refresh_base_table_txn, base_table_txn "
        f"FROM materialized_views() WHERE view_name IN ({name_list}) "
        "ORDER BY view_name"
    )
    rows = res["dataset"]
    if len(rows) != 8:
        print(f"  FAIL: expected 8 mat views, found {len(rows)}")
        return False
    ok = True
    for name, status, inv_reason, refresh_txn, base_txn in rows:
        caught_up = (refresh_txn or 0) == (base_txn or 0)
        marker = "OK" if status == "valid" and caught_up else "FAIL"
        print(
            f"  {marker:4s} {name:14s} status={status} "
            f"refresh={refresh_txn}/{base_txn} inv={inv_reason or '-'}"
        )
        if marker == "FAIL":
            ok = False
    return ok


def check_2_row_counts() -> bool:
    print("\n[2/5] Row counts per symbol per TF")
    print(f"  {'symbol':8s} {'tf':4s} {'rows':>15s}")
    ok = True
    for sym in SYMBOLS:
        for tf in TIMEFRAMES:
            view = "ohlcv_1h_v" if tf == "1h" else f"ohlcv_{tf}"
            res = exec_sql(f"SELECT count() FROM {view} WHERE symbol = '{sym}'")
            rows = res["dataset"][0][0]
            print(f"  {sym:8s} {tf:4s} {rows:>15,}")
            if rows == 0:
                print(f"     ^ FAIL: zero rows for {sym}/{tf}")
                ok = False
    return ok


def check_3_aggregation_correctness() -> bool:
    """Pick a known trading day; compare manual 1m aggregation to ohlcv_1d bar."""
    print("\n[3/5] Aggregation correctness (MNQ 2024-06-03 1d vs manual)")
    day = "2024-06-03"
    res = exec_sql(
        f"SELECT first(open), max(high), min(low), last(close), sum(volume) "
        f"FROM ohlcv_1m WHERE symbol = 'MNQ' AND timestamp IN '{day}'"
    )
    if not res["dataset"] or res["dataset"][0][0] is None:
        print(f"  SKIP: no ohlcv_1m data for MNQ on {day}")
        return True
    manual_open, manual_high, manual_low, manual_close, manual_vol = res["dataset"][0]
    res = exec_sql(
        f"SELECT open, high, low, close, volume FROM ohlcv_1d "
        f"WHERE symbol = 'MNQ' AND timestamp = '{day}T00:00:00.000000Z'"
    )
    if not res["dataset"]:
        print(f"  FAIL: no ohlcv_1d row for MNQ on {day}")
        return False
    view_open, view_high, view_low, view_close, view_vol = res["dataset"][0]
    fields = [
        ("open", manual_open, view_open),
        ("high", manual_high, view_high),
        ("low", manual_low, view_low),
        ("close", manual_close, view_close),
        ("volume", manual_vol, view_vol),
    ]
    ok = True
    for name, manual, view in fields:
        match = abs((manual or 0) - (view or 0)) < 1e-6
        marker = "OK" if match else "FAIL"
        print(f"  {marker:4s} {name:6s} manual={manual} view={view}")
        if not match:
            ok = False
    return ok


def check_4_parquet_readable() -> bool:
    print("\n[4/5] Parquet readability + schema check")
    ok = True
    print(f"  {'file':30s} {'rows':>12s}  ts_min  ts_max")
    for sym in SYMBOLS:
        for tf in TIMEFRAMES:
            path = PARQUET_DIR / sym / f"{tf}.parquet"
            if not path.exists():
                print(f"  FAIL: {path.relative_to(PARQUET_DIR)} not found")
                ok = False
                continue
            try:
                df = pd.read_parquet(path)
            except Exception as e:
                print(f"  FAIL: {path.relative_to(PARQUET_DIR)} read error: {e}")
                ok = False
                continue
            req = {"timestamp", "symbol", "open", "high", "low", "close", "volume"}
            missing = req - set(df.columns)
            if missing:
                print(f"  FAIL: {path.relative_to(PARQUET_DIR)} missing cols {missing}")
                ok = False
                continue
            if len(df) == 0:
                print(f"  FAIL: {path.relative_to(PARQUET_DIR)} empty")
                ok = False
                continue
            print(
                f"  {sym:8s}/{tf:4s} {len(df):>12,}  {df['timestamp'].min()}  {df['timestamp'].max()}"
            )
    return ok


def check_5_db_parquet_parity() -> bool:
    print("\n[5/5] DB <-> Parquet row parity (per symbol per TF)")
    ok = True
    print(f"  {'symbol':8s} {'tf':4s} {'db':>12s} {'parquet':>12s}")
    for sym in SYMBOLS:
        for tf in TIMEFRAMES:
            view = "ohlcv_1h_v" if tf == "1h" else f"ohlcv_{tf}"
            res = exec_sql(f"SELECT count() FROM {view} WHERE symbol = '{sym}'")
            db_rows = res["dataset"][0][0]
            path = PARQUET_DIR / sym / f"{tf}.parquet"
            pq_rows = len(pd.read_parquet(path)) if path.exists() else -1
            match = "OK" if db_rows == pq_rows else "FAIL"
            print(f"  {match:4s} {sym:8s} {tf:4s} {db_rows:>12,} {pq_rows:>12,}")
            if match != "OK":
                ok = False
    return ok


def main() -> int:
    results = [
        ("Mat view status", check_1_mat_view_status()),
        ("Row counts", check_2_row_counts()),
        ("Aggregation correctness", check_3_aggregation_correctness()),
        ("Parquet readability", check_4_parquet_readable()),
        ("DB/Parquet parity", check_5_db_parquet_parity()),
    ]
    print("\n" + "=" * 60)
    print("VERIFICATION SUMMARY")
    print("=" * 60)
    all_ok = True
    for name, ok in results:
        marker = "PASS" if ok else "FAIL"
        print(f"  [{marker}] {name}")
        if not ok:
            all_ok = False
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
