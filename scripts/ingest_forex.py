"""
Ingest forex parquet files (1-minute OHLCV) into PostgreSQL TimescaleDB.

Handles pip size differences:
  - JPY pairs (USDJPY, EURJPY, GBPJPY, AUDJPY, CADJPY): pip = 0.01, 3 decimal places
  - All others: pip = 0.0001, 5 decimal places

Usage:
    python scripts/ingest_forex.py [--dry-run]
"""

import io
import sys
import time
from pathlib import Path

import polars as pl
import psycopg2

DB_CONN = "postgresql://postgres:postgres@localhost:5432/ml_dashboard"

PARQUET_DIR = Path(r"C:\Users\tyler\OneDrive\Documents")

# Map filename pattern to normalized symbol and pip size
# Filename format: GBP_AUD_M1_6Y.parquet -> GBPAUD
FOREX_FILES = [
    ("GBP_AUD_M1_6Y.parquet", "GBPAUD", 0.0001),
    ("GBP_JPY_M1_6Y.parquet", "GBPJPY", 0.01),
    ("GBP_USD_M1_6Y.parquet", "GBPUSD", 0.0001),
    ("USD_CAD_M1_6Y.parquet", "USDCAD", 0.0001),
    ("GBP_CHF_M1_6Y.parquet", "GBPCHF", 0.0001),
    ("EUR_JPY_M1_6Y.parquet", "EURJPY", 0.01),
    ("EUR_USD_M1_6Y.parquet", "EURUSD", 0.0001),
    ("USD_JPY_M1_6Y.parquet", "USDJPY", 0.01),
    ("AUD_JPY_M1_6Y.parquet", "AUDJPY", 0.01),
    ("CAD_JPY_M1_6Y.parquet", "CADJPY", 0.01),
    ("NZD_USD_M1_6Y.parquet", "NZDUSD", 0.0001),
    ("AUD_USD_M1_6Y.parquet", "AUDUSD", 0.0001),
    ("USD_CHF_M1_6Y.parquet", "USDCHF", 0.0001),
    ("EUR_CHF_M1_6Y.parquet", "EURCHF", 0.0001),
    ("EUR_GBP_M1_6Y.parquet", "EURGBP", 0.0001),
]


def ingest_pair(conn, filepath: Path, symbol: str, pip_size: float, dry_run: bool = False):
    """Ingest a single forex pair parquet file."""
    print(f"  Reading {filepath.name}...")
    df = pl.read_parquet(str(filepath))
    rows = len(df)
    print(f"    {rows:,} rows | {symbol} | pip={pip_size}")

    if dry_run:
        # Show sample with proper decimal formatting
        decimals = 3 if pip_size == 0.01 else 5
        fmt = f"%.{decimals}f"
        for i in range(min(5, rows)):
            row = df.row(i)
            print(f"    {row[0]} | O={fmt % row[1]} H={fmt % row[2]} L={fmt % row[3]} C={fmt % row[4]} V={row[5]}")
        return 0

    cur = conn.cursor()

    # Parse timestamps and build COPY buffer
    # Time format: "2020-01-05T22:01:00.000000000Z"
    batch_size = 100_000
    buf = io.StringIO()
    count = 0

    for i in range(rows):
        row = df.row(i)
        ts_str = row[0]
        # Convert "2020-01-05T22:01:00.000000000Z" to PostgreSQL timestamptz
        # Just replace T and trim nanosecond Z format
        ts_pg = ts_str.replace("T", " ").replace("Z", "+00")

        buf.write("%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" % (
            ts_pg, symbol, row[1], row[2], row[3], row[4], row[5], pip_size
        ))
        count += 1

        if count % batch_size == 0:
            buf.seek(0)
            cur.copy_from(
                buf,
                'forex_1m',
                columns=('ts', 'symbol', 'open', 'high', 'low', 'close', 'volume', 'pip_size'),
            )
            conn.commit()
            buf = io.StringIO()
            sys.stdout.write(f"\r    {count:>10,} / {rows:,}")
            sys.stdout.flush()

    # Final batch
    if buf.tell() > 0:
        buf.seek(0)
        cur.copy_from(
            buf,
            'forex_1m',
            columns=('ts', 'symbol', 'open', 'high', 'low', 'close', 'volume', 'pip_size'),
        )
        conn.commit()

    print(f"\r    {count:>10,} / {rows:,} -- done")
    cur.close()
    return count


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Ingest forex parquet -> TimescaleDB")
    parser.add_argument("--dry-run", action="store_true", help="Preview without inserting")
    args = parser.parse_args()

    print("=== Forex Parquet Ingestion ===")
    print(f"  Pip sizes: JPY pairs = 0.01 (3 decimals), others = 0.0001 (5 decimals)")
    print()

    conn = None
    if not args.dry_run:
        conn = psycopg2.connect(DB_CONN)
        conn.autocommit = False
        # Check existing rows
        cur = conn.cursor()
        cur.execute("SELECT count(*) FROM forex_1m")
        existing = cur.fetchone()[0]
        print(f"  Existing rows in forex_1m: {existing:,}")
        cur.close()

    total = 0
    t_start = time.time()
    jpy_count = 0
    non_jpy_count = 0

    for filename, symbol, pip_size in FOREX_FILES:
        filepath = PARQUET_DIR / filename
        if not filepath.exists():
            print(f"  SKIP: {filename} not found")
            continue

        inserted = ingest_pair(conn, filepath, symbol, pip_size, dry_run=args.dry_run)
        total += inserted
        if pip_size == 0.01:
            jpy_count += inserted
        else:
            non_jpy_count += inserted

    elapsed = time.time() - t_start

    if not args.dry_run:
        rate = total / elapsed if elapsed > 0 else 0
        print(f"\n=== Ingestion Complete ===")
        print(f"  Total inserted: {total:,}")
        print(f"    JPY pairs (pip=0.01): {jpy_count:,}")
        print(f"    Standard (pip=0.0001): {non_jpy_count:,}")
        print(f"  Time: {elapsed:.1f}s ({rate:,.0f} rows/s)")

        # Verify
        cur = conn.cursor()
        cur.execute("SELECT symbol, count(*), min(ts)::date, max(ts)::date FROM forex_1m GROUP BY symbol ORDER BY symbol")
        print(f"\n  Summary:")
        for row in cur.fetchall():
            print(f"    {row[0]}: {row[1]:>10,} rows  ({row[2]} to {row[3]})")
        cur.close()
        conn.close()
    else:
        print(f"\n  DRY RUN complete ({elapsed:.1f}s)")


if __name__ == "__main__":
    main()
