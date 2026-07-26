"""
QuestDB Cleanup: Drop all feature/indicator/model-output tables.
Keeps only raw OHLCV data (ohlcv, rollovers, symbols, trades, mbp10)
and materialized views (ohlcv_5m through ohlcv_1w).

Usage:
    python scripts/cleanup_questdb.py [--dry-run]
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request

QUESTDB_URL = "http://localhost:9000"

TABLES_TO_DROP = [
    "indicators_5m",
    "indicators_15m",
    "indicators_30m",
    "indicators_1h",
    "indicators_4h",
    "indicators_1d",
    "indicators_1w",
    "talib_features",
    "vpoc",
    "model_regimes",
    "model_shap",
    "labels",
    "swing_labels",
    "triple_barrier_labels",
    "training_metrics",
    "rollovers",
]


def questdb_exec(sql: str) -> dict:
    """Execute SQL via QuestDB HTTP /exec endpoint."""
    url = f"{QUESTDB_URL}/exec?query={urllib.parse.quote(sql)}"
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def list_tables() -> list[str]:
    """List all tables and views in QuestDB."""
    result = questdb_exec(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    )
    return [row[0] for row in result.get("dataset", [])]


def get_row_count(table: str) -> int:
    """Get row count for a table (returns 0 on error)."""
    try:
        result = questdb_exec(f"SELECT count() FROM {table}")
        return int(result["dataset"][0][0])
    except Exception:
        return 0


def main():
    parser = argparse.ArgumentParser(description="Drop feature tables from QuestDB")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be dropped without executing")
    args = parser.parse_args()

    # 1. List current tables
    print("=== Current QuestDB Tables ===")
    try:
        tables = list_tables()
    except Exception as e:
        print(f"ERROR: Cannot connect to QuestDB at {QUESTDB_URL}: {e}")
        sys.exit(1)

    for t in sorted(tables):
        count = get_row_count(t)
        marker = " [DROP]" if t in TABLES_TO_DROP else ""
        print(f"  {t:40s} {count:>15,} rows{marker}")

    # 2. Drop target tables
    print(f"\n=== {'DRY RUN: ' if args.dry_run else ''}Dropping {len(TABLES_TO_DROP)} tables ===")
    dropped = 0
    skipped = 0
    errors = 0

    for table in TABLES_TO_DROP:
        sql = f"DROP TABLE IF EXISTS {table}"
        if args.dry_run:
            exists = table in tables
            print(f"  [DRY RUN] {sql}  {'(exists)' if exists else '(not found)'}")
            if exists:
                dropped += 1
            else:
                skipped += 1
        else:
            try:
                questdb_exec(sql)
                if table in tables:
                    print(f"  DROPPED: {table}")
                    dropped += 1
                else:
                    print(f"  SKIPPED: {table} (did not exist)")
                    skipped += 1
            except Exception as e:
                print(f"  ERROR dropping {table}: {e}")
                errors += 1

    print(f"\nDropped: {dropped}, Skipped: {skipped}, Errors: {errors}")

    if args.dry_run:
        print("\n(Dry run — no tables were actually dropped)")
        return

    # 3. Verify remaining tables
    print("\n=== Remaining QuestDB Tables ===")
    remaining = list_tables()
    for t in sorted(remaining):
        count = get_row_count(t)
        print(f"  {t:40s} {count:>15,} rows")

    print(f"\nTotal remaining: {len(remaining)} tables/views")


if __name__ == "__main__":
    main()
