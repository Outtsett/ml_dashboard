"""
Upload pre-computed indicator parquets into QuestDB.

Reads all.parquet files from data/{futures,forex}/{symbol}/{tf}/
and uploads them into per-timeframe QuestDB tables:
    indicators_5m, indicators_15m, indicators_30m,
    indicators_1h, indicators_4h, indicators_1d, indicators_1w

Pipeline (no CSV intermediate):
    1. DuckDB reads source parquet
    2. DuckDB writes clean parquet to QuestDB import dir
       (sanitized column names, proper TIMESTAMP type, ZSTD compressed)
    3. QuestDB INSERT INTO ... SELECT FROM read_parquet()
    4. Clean up temp parquet

Each table has: timestamp (TIMESTAMP designated), symbol (SYMBOL),
asset_class (SYMBOL), OHLCV (DOUBLE), 344 indicator columns (FLOAT).

Usage:
    python scripts/upload-indicators-questdb.py              # Full run
    python scripts/upload-indicators-questdb.py --dry-run    # Preview only
    python scripts/upload-indicators-questdb.py --tf 1d 1h   # Specific timeframes
    python scripts/upload-indicators-questdb.py --drop       # Drop + recreate first
"""
import argparse
import os
import shutil
import sys
import time
from pathlib import Path

import duckdb
import psycopg2
import requests

ROOT_DIR = Path(__file__).parent.parent
DATA_DIR = ROOT_DIR / "data"
ASSET_CLASSES = ["futures", "forex"]
ALL_TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "1d", "1w"]
QUESTDB_URL = os.environ.get("QUESTDB_URL", "http://localhost:9000")
QUESTDB_IMPORT_DIR = Path(
    os.environ.get(
        "QUESTDB_IMPORT_DIR",
        str(Path.home() / "questdb" / "import"),
    )
)
OHLCV_COLS = {"open", "high", "low", "close", "volume"}

PARTITION_MAP = {
    "5m": "MONTH",
    "15m": "MONTH",
    "30m": "YEAR",
    "1h": "YEAR",
    "4h": "YEAR",
    "1d": "YEAR",
    "1w": "YEAR",
}


def sanitize_col_name(name: str) -> str:
    """Replace dots and percent signs for QuestDB column name compatibility."""
    return name.replace(".", "_").replace("%", "pct")


def questdb_http(sql: str, timeout: int = 300) -> dict:
    """Execute SQL on QuestDB via HTTP /exec (GET, for short queries)."""
    resp = requests.get(
        f"{QUESTDB_URL}/exec", params={"query": sql}, timeout=timeout
    )
    resp.raise_for_status()
    return resp.json()


def questdb_pg(sql: str):
    """Execute SQL on QuestDB via Postgres wire (port 8812). No size limit."""
    conn = psycopg2.connect(
        host=os.environ.get("QUESTDB_HOST", "localhost"),
        port=int(os.environ.get("QUESTDB_PG_PORT", "8812")),
        user=os.environ.get("QUESTDB_USER", "admin"),
        password=os.environ.get("QUESTDB_PASSWORD", "quest"),
        database="qdb",
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(sql)
    cur.close()
    conn.close()


# ── Discovery ─────────────────────────────────────────────────────────


def discover_parquets(target_tfs: set[str]) -> list[dict]:
    """Find all directories with computed indicator all.parquet files."""
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
                if tf not in target_tfs:
                    continue
                all_pq = sym_dir / tf / "all.parquet"
                if all_pq.exists():
                    combos.append({
                        "asset_class": ac,
                        "symbol": sym,
                        "timeframe": tf,
                        "path": str(all_pq),
                        "size_mb": all_pq.stat().st_size / (1024 ** 2),
                    })
    return combos


def get_parquet_columns(pq_path: str) -> list[tuple[str, str]]:
    """Get (name, type) pairs from a parquet file, excluding timestamp."""
    conn = duckdb.connect()
    cols = conn.execute(
        f"DESCRIBE SELECT * FROM read_parquet('{pq_path.replace(chr(92), '/')}')"
    ).fetchall()
    conn.close()
    return [(n, t) for n, t, *_ in cols if n != "timestamp"]


# ── DDL ───────────────────────────────────────────────────────────────


def build_ddl(table_name: str, columns: list[tuple[str, str]], partition: str) -> str:
    """Generate CREATE TABLE DDL for a QuestDB indicator table."""
    col_defs = [
        "symbol SYMBOL CAPACITY 50 CACHE INDEX",
        "asset_class SYMBOL CAPACITY 5 CACHE",
        "timestamp TIMESTAMP",
    ]
    for col_name, _ in columns:
        safe = sanitize_col_name(col_name)
        qdb_type = "DOUBLE" if col_name in OHLCV_COLS else "FLOAT"
        col_defs.append(f'"{safe}" {qdb_type}')

    return (
        f"CREATE TABLE IF NOT EXISTS {table_name} (\n"
        + ",\n".join(f"  {c}" for c in col_defs)
        + f"\n) timestamp(timestamp) PARTITION BY {partition} WAL\n"
        + "DEDUP UPSERT KEYS(symbol, timestamp);"
    )


# ── Upload via read_parquet() ─────────────────────────────────────────


def prepare_clean_parquet(
    source_path: str, dest_name: str, expected_cols: list[str] | None = None
) -> Path:
    """Use DuckDB to create a clean parquet with sanitized column names
    and proper TIMESTAMP type in the QuestDB import directory.

    If expected_cols is provided, any missing columns in the source parquet
    will be added as NULL::FLOAT (handles schema variations like 1w missing VHM_610).
    """
    conn = duckdb.connect()
    conn.execute("SET TimeZone = 'UTC'")

    src = source_path.replace("\\", "/")
    cols = conn.execute(f"DESCRIBE SELECT * FROM read_parquet('{src}')").fetchall()
    source_col_names = {sanitize_col_name(cn) for cn, *_ in cols}

    renames = []
    for cn, ct, *_ in cols:
        safe = sanitize_col_name(cn)
        if cn == "timestamp":
            renames.append('to_timestamp("timestamp") AS timestamp')
        elif safe != cn:
            renames.append(f'"{cn}" AS "{safe}"')
        else:
            renames.append(f'"{cn}"')

    # Add NULL for any expected columns missing from this parquet
    if expected_cols:
        for ecol in expected_cols:
            if ecol not in source_col_names:
                renames.append(f'NULL::FLOAT AS "{ecol}"')

    dest = QUESTDB_IMPORT_DIR / dest_name
    select = ", ".join(renames)
    conn.execute(
        f"COPY (SELECT {select} FROM read_parquet('{src}')) "
        f"TO '{str(dest).replace(chr(92), '/')}' "
        f"(FORMAT PARQUET, COMPRESSION ZSTD)"
    )
    conn.close()
    return dest


def get_table_indicator_cols(table_name: str) -> list[str]:
    """Get the indicator column names from a QuestDB table (excludes symbol, asset_class, timestamp, OHLCV)."""
    r = questdb_http(f"SHOW COLUMNS FROM {table_name}")
    skip = {"symbol", "asset_class", "timestamp"} | OHLCV_COLS
    return [row[0] for row in r["dataset"] if row[0] not in skip]


def upload_combo(combo: dict, table_name: str, expected_cols: list[str] | None = None) -> tuple[int, float]:
    """Upload one symbol/timeframe parquet to QuestDB via read_parquet().

    Returns (row_count, elapsed_seconds).
    """
    t0 = time.time()
    sym = combo["symbol"]
    ac = combo["asset_class"]
    pq_name = f"{table_name}_{sym}.parquet"

    # Step 1: Create clean parquet in QuestDB import dir
    dest = prepare_clean_parquet(combo["path"], pq_name, expected_cols)

    try:
        # Step 2: INSERT INTO via PGWire (handles long SQL)
        insert_sql = (
            f"INSERT INTO {table_name} "
            f"SELECT '{sym}' AS symbol, '{ac}' AS asset_class, * "
            f"FROM read_parquet('{pq_name}')"
        )
        questdb_pg(insert_sql)
    finally:
        # Step 3: Clean up temp parquet
        if dest.exists():
            dest.unlink()

    elapsed = time.time() - t0
    return -1, elapsed  # row count verified after WAL commit


def verify_table(table_name: str) -> tuple[int, int]:
    """Get (row_count, distinct_symbols) from a QuestDB table."""
    try:
        r = questdb_http(
            f"SELECT COUNT(*), COUNT(DISTINCT symbol) FROM {table_name}"
        )
        row = r["dataset"][0]
        return int(row[0]), int(row[1])
    except Exception:
        return 0, 0


# ── Main ──────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Upload indicator parquets to QuestDB"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument(
        "--tf", nargs="*", choices=ALL_TIMEFRAMES,
        help="Specific timeframes (default: all)",
    )
    parser.add_argument(
        "--drop", action="store_true",
        help="Drop and recreate tables before ingestion",
    )
    args = parser.parse_args()

    target_tfs = set(args.tf) if args.tf else set(ALL_TIMEFRAMES)

    # Connectivity check
    try:
        questdb_http("SELECT 1")
    except Exception as e:
        print(f"Cannot connect to QuestDB at {QUESTDB_URL}: {e}")
        sys.exit(1)

    # Verify import dir
    if not QUESTDB_IMPORT_DIR.exists():
        print(f"QuestDB import dir not found: {QUESTDB_IMPORT_DIR}")
        sys.exit(1)

    # Disk space
    _, _, free = shutil.disk_usage(str(DATA_DIR))
    print(f"E: drive free: {free / (1024 ** 3):.1f} GB")

    # Discover parquets
    combos = discover_parquets(target_tfs)
    if not combos:
        print("No indicator parquets found.")
        return

    by_tf: dict[str, list[dict]] = {}
    for c in combos:
        by_tf.setdefault(c["timeframe"], []).append(c)

    total_mb = sum(c["size_mb"] for c in combos)
    print(f"\nFound {len(combos)} combos ({total_mb / 1024:.1f} GB)")
    for tf in ALL_TIMEFRAMES:
        if tf not in by_tf:
            continue
        tf_mb = sum(c["size_mb"] for c in by_tf[tf])
        syms = [c["symbol"] for c in by_tf[tf]]
        sym_list = ", ".join(syms[:8])
        extra = f" +{len(syms) - 8}" if len(syms) > 8 else ""
        print(f"  {tf:4s}: {len(syms):3d} symbols "
              f"({tf_mb / 1024:.2f} GB) -- {sym_list}{extra}")

    if args.dry_run:
        print("\nDry run -- no changes made.")
        return

    # Get superset column schema (use the 350-col sample, not a 349-col one)
    sample_350 = next(
        (c for c in combos if c["timeframe"] != "1w"), combos[0]
    )
    columns = get_parquet_columns(sample_350["path"])
    print(f"\nSchema: {len(columns) + 1} columns "
          f"(timestamp + 5 OHLCV DOUBLE + {len(columns) - 5} indicators FLOAT)")

    t_start = time.time()
    grand_total = 0

    for tf in ALL_TIMEFRAMES:
        if tf not in by_tf:
            continue

        table_name = f"indicators_{tf}"
        partition = PARTITION_MAP[tf]
        tf_combos = by_tf[tf]

        # Drop if requested
        if args.drop:
            try:
                questdb_http(f"DROP TABLE IF EXISTS {table_name}")
                print(f"\n{table_name}: dropped")
            except Exception:
                pass

        # Check existing data
        existing_rows, existing_syms = verify_table(table_name)
        if existing_rows > 0:
            print(f"\n{table_name}: {existing_rows:,} rows "
                  f"({existing_syms} symbols) already exist")
            try:
                r = questdb_http(
                    f"SELECT DISTINCT symbol FROM {table_name}"
                )
                existing_set = {row[0] for row in r["dataset"]}
                tf_combos = [
                    c for c in tf_combos if c["symbol"] not in existing_set
                ]
                if not tf_combos:
                    print("  All symbols ingested, skipping")
                    grand_total += existing_rows
                    continue
                print(f"  {len(tf_combos)} new symbols to ingest")
            except Exception:
                pass
        else:
            # Create table via PGWire (handles long DDL)
            ddl = build_ddl(table_name, columns, partition)
            try:
                questdb_pg(ddl)
                print(f"\n{table_name}: created "
                      f"(PARTITION BY {partition}, 352 cols)")
            except Exception as e:
                print(f"\n{table_name}: DDL error: {e}")
                continue

        # Get expected columns from table schema (for handling parquets with fewer cols)
        try:
            expected_cols = get_table_indicator_cols(table_name)
        except Exception:
            expected_cols = None

        # Upload each symbol
        for i, combo in enumerate(tf_combos, 1):
            try:
                _, elapsed = upload_combo(combo, table_name, expected_cols)
                print(f"  [{i}/{len(tf_combos)}] "
                      f"{combo['asset_class']}/{combo['symbol']}: "
                      f"{combo['size_mb']:.1f} MB ({elapsed:.1f}s)")
            except Exception as e:
                print(f"  [{i}/{len(tf_combos)}] "
                      f"{combo['asset_class']}/{combo['symbol']}: "
                      f"ERROR {e}")

        # Wait for WAL commit then verify
        time.sleep(2)
        final_rows, final_syms = verify_table(table_name)
        grand_total += final_rows
        _, _, cur_free = shutil.disk_usage(str(DATA_DIR))
        print(f"  {table_name}: {final_rows:,} rows, {final_syms} symbols "
              f"| E: free: {cur_free / (1024 ** 3):.1f} GB")

    elapsed_total = time.time() - t_start
    print(f"\nDone in {elapsed_total:.0f}s")
    print(f"Total rows: {grand_total:,}")
    _, _, final_free = shutil.disk_usage(str(DATA_DIR))
    print(f"E: drive free: {final_free / (1024 ** 3):.1f} GB")


if __name__ == "__main__":
    main()
