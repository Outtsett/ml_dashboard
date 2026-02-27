"""
Ingest pre-computed indicator parquets into market.duckdb tables.

Reads all.parquet files from data/{futures,forex}/{symbol}/{tf}/
and inserts them into per-timeframe tables in market.duckdb:
    indicators_1m, indicators_5m, indicators_15m, indicators_30m,
    indicators_1h, indicators_4h, indicators_1d, indicators_1w

Each table has: ts (TIMESTAMP), symbol (VARCHAR), asset_class (VARCHAR),
plus ~344 indicator columns.

After ingestion, parquet files can be moved to D: drive to free E: space.

Usage:
    python scripts/ingest-indicators-to-duckdb.py              # Full run
    python scripts/ingest-indicators-to-duckdb.py --dry-run    # Preview only
    python scripts/ingest-indicators-to-duckdb.py --tf 1d 1h   # Specific timeframes
"""
import argparse
import os
import shutil
import time
from pathlib import Path

import duckdb

ROOT_DIR = Path(__file__).parent.parent
MARKET_DB = ROOT_DIR / "data" / "market.duckdb"
DATA_DIR = ROOT_DIR / "data"
ASSET_CLASSES = ["futures", "forex"]
ALL_TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]


def discover_indicator_dirs() -> list[dict]:
    """Find all directories with computed indicator parquets."""
    combos = []
    for ac in ASSET_CLASSES:
        ac_dir = DATA_DIR / ac
        if not ac_dir.exists():
            continue
        for sym in sorted(os.listdir(ac_dir)):
            sym_dir = ac_dir / sym
            if not sym_dir.is_dir():
                continue
            for tf in sorted(os.listdir(sym_dir)):
                tf_dir = sym_dir / tf
                if not tf_dir.is_dir():
                    continue

                all_pq = tf_dir / "all.parquet"
                meta = tf_dir / "_meta.json"
                has_categories = any(
                    (tf_dir / f"{cat}.parquet").exists()
                    for cat in ["candle", "momentum", "overlap"]
                )

                if all_pq.exists():
                    combos.append({
                        "asset_class": ac,
                        "symbol": sym,
                        "timeframe": tf,
                        "path": str(all_pq),
                        "mode": "all",
                        "size_mb": all_pq.stat().st_size / (1024 ** 2),
                    })
                elif has_categories and meta.exists():
                    # Category-split only (e.g. MNQ/1m, EURUSD/1m) — skip for now,
                    # these need all.parquet generated first via compute-indicators.py
                    print(f"  SKIP {ac}/{sym}/{tf}: category-only (no all.parquet)")
    return combos


def get_create_table_sql(table_name: str, sample_parquet: str, conn) -> str:
    """Generate CREATE TABLE DDL from a sample parquet's schema."""
    cols = conn.execute(
        f"DESCRIBE SELECT * FROM read_parquet('{sample_parquet}')"
    ).fetchall()

    col_defs = ["ts TIMESTAMP NOT NULL", "symbol VARCHAR NOT NULL", "asset_class VARCHAR NOT NULL"]
    for col_name, col_type, *_ in cols:
        if col_name == "timestamp":
            continue  # replaced by ts
        col_defs.append(f'"{col_name}" {col_type}')

    return f"CREATE TABLE IF NOT EXISTS {table_name} (\n  {','.join(chr(10) + '  ' + c for c in col_defs)}\n)"


def ingest_combo(conn, combo: dict, table_name: str) -> int:
    """Insert one symbol/timeframe combo into its indicator table."""
    sym = combo["symbol"]
    ac = combo["asset_class"]
    pq_path = combo["path"].replace("\\", "/")

    insert_sql = f"""
    INSERT INTO {table_name}
    SELECT
        to_timestamp("timestamp") AS ts,
        '{sym}' AS symbol,
        '{ac}' AS asset_class,
        * EXCLUDE ("timestamp")
    FROM read_parquet('{pq_path}')
    """

    conn.execute(insert_sql)
    count = conn.execute(
        f"SELECT COUNT(*) FROM {table_name} WHERE symbol = '{sym}'"
    ).fetchone()[0]
    return count


def main():
    parser = argparse.ArgumentParser(description="Ingest indicator parquets into market.duckdb")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--tf", nargs="*", choices=ALL_TIMEFRAMES,
                        help="Specific timeframes (default: all)")
    args = parser.parse_args()

    target_tfs = set(args.tf) if args.tf else set(ALL_TIMEFRAMES)

    # Check disk space
    _, _, free = shutil.disk_usage(str(MARKET_DB.parent))
    free_gb = free / (1024 ** 3)
    db_size_gb = MARKET_DB.stat().st_size / (1024 ** 3) if MARKET_DB.exists() else 0
    print(f"market.duckdb: {db_size_gb:.1f} GB")
    print(f"E: drive free: {free_gb:.1f} GB")

    # Discover indicator directories
    combos = discover_indicator_dirs()
    combos = [c for c in combos if c["timeframe"] in target_tfs]

    # Group by timeframe
    by_tf: dict[str, list[dict]] = {}
    for c in combos:
        by_tf.setdefault(c["timeframe"], []).append(c)

    total_source_mb = sum(c["size_mb"] for c in combos)
    print(f"\nFound {len(combos)} symbol/timeframe combos ({total_source_mb / 1024:.1f} GB)")
    for tf in ALL_TIMEFRAMES:
        if tf in by_tf:
            tf_mb = sum(c["size_mb"] for c in by_tf[tf])
            syms = [c["symbol"] for c in by_tf[tf]]
            print(f"  {tf:4s}: {len(by_tf[tf]):3d} symbols ({tf_mb / 1024:.2f} GB) — {', '.join(syms[:8])}"
                  + (f" +{len(syms) - 8}" if len(syms) > 8 else ""))

    if args.dry_run:
        print("\nDry run — no changes made.")
        return

    if free_gb < total_source_mb / 1024 + 5:
        print(f"\nWARNING: Only {free_gb:.1f} GB free, need ~{total_source_mb / 1024:.1f} GB + headroom")
        print("Consider freeing space first.")
        return

    # Connect to market.duckdb (read-write)
    conn = duckdb.connect(str(MARKET_DB))

    # Find a sample all.parquet for schema
    sample = next(c for c in combos if c["mode"] == "all")
    sample_path = sample["path"].replace("\\", "/")

    t_start = time.time()
    grand_total = 0

    for tf in ALL_TIMEFRAMES:
        if tf not in by_tf:
            continue

        table_name = f"indicators_{tf}"
        tf_combos = by_tf[tf]

        # Check if table already exists
        existing = conn.execute(
            f"SELECT COUNT(*) FROM information_schema.tables WHERE table_name = '{table_name}'"
        ).fetchone()[0]

        if existing:
            existing_rows = conn.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
            existing_syms = conn.execute(
                f"SELECT DISTINCT symbol FROM {table_name} ORDER BY symbol"
            ).fetchall()
            print(f"\n{table_name}: already exists ({existing_rows:,} rows, {len(existing_syms)} symbols)")

            # Skip symbols already ingested
            existing_sym_set = {s[0] for s in existing_syms}
            tf_combos = [c for c in tf_combos if c["symbol"] not in existing_sym_set]
            if not tf_combos:
                print(f"  All symbols already ingested, skipping")
                continue
            print(f"  {len(tf_combos)} new symbols to ingest")
        else:
            # Create table
            create_sql = get_create_table_sql(table_name, sample_path, conn)
            conn.execute(create_sql)
            print(f"\n{table_name}: created")

        tf_total = 0
        for i, combo in enumerate(tf_combos, 1):
            t0 = time.time()
            rows = ingest_combo(conn, combo, table_name)
            elapsed = time.time() - t0
            tf_total += rows
            print(f"  [{i}/{len(tf_combos)}] {combo['asset_class']}/{combo['symbol']}: "
                  f"{rows:,} rows ({elapsed:.1f}s)")

        # Checkpoint to flush WAL and reclaim space
        conn.execute("CHECKPOINT")

        grand_total += tf_total
        current_db_gb = MARKET_DB.stat().st_size / (1024 ** 3)
        _, _, current_free = shutil.disk_usage(str(MARKET_DB.parent))
        print(f"  {table_name} done: {tf_total:,} rows | DB: {current_db_gb:.1f} GB | Free: {current_free / (1024 ** 3):.1f} GB")

    conn.close()
    elapsed = time.time() - t_start
    print(f"\nDone: {grand_total:,} total rows ingested in {elapsed:.0f}s")
    print(f"market.duckdb: {MARKET_DB.stat().st_size / (1024 ** 3):.1f} GB")


if __name__ == "__main__":
    main()
