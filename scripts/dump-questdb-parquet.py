"""
One-time QuestDB -> Parquet export for batch analytics.

Dumps entire tables (or symbol subsets) to parquet files for fast local reads.
Eliminates PG wire bottleneck for repeat analytics runs.

Output: data/.cache/{table}_{symbol}.parquet

Usage:
    python scripts/dump-questdb-parquet.py                          # Dump ohlcv (default)
    python scripts/dump-questdb-parquet.py --tables ohlcv            # Single table
    python scripts/dump-questdb-parquet.py --tables ohlcv --symbols MNQ,ES
"""

import argparse
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
import psycopg2

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / ".cache"


def connect():
    return psycopg2.connect(
        host=os.environ.get("QUESTDB_HOST", "127.0.0.1"),
        port=int(os.environ.get("QUESTDB_PG_PORT", "8812")),
        user=os.environ.get("QUESTDB_USER", "admin"),
        password=os.environ.get("QUESTDB_PASSWORD", "quest"),
        database="qdb",
    )


def get_symbols(conn, table):
    """Get distinct symbols from a table."""
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT DISTINCT symbol FROM {table}")
        symbols = [r[0] for r in cur.fetchall()]
    except Exception:
        symbols = []
    cur.close()
    return symbols


def get_timestamp_range(conn, table, symbol):
    """Get min/max timestamp for a symbol."""
    cur = conn.cursor()
    cur.execute(f"SELECT min(timestamp), max(timestamp) FROM {table} WHERE symbol = '{symbol}'")
    result = cur.fetchone()
    cur.close()
    return result


def dump_symbol(conn, table, symbol, output_path, chunk_size=100_000):
    """Dump one symbol from a table to parquet using monthly partition fetching."""
    t0 = time.time()

    ts_min, ts_max = get_timestamp_range(conn, table, symbol)
    if ts_min is None:
        print(f"  [{symbol}] No data")
        return 0

    # Build monthly boundaries
    month_starts = []
    current = datetime(ts_min.year, ts_min.month, 1)
    end = datetime(ts_max.year, ts_max.month, 1)
    if ts_max.month == 12:
        end = datetime(ts_max.year + 1, 1, 1)
    else:
        end = datetime(ts_max.year, ts_max.month + 1, 1)

    while current <= end:
        month_starts.append(current)
        if current.month == 12:
            current = datetime(current.year + 1, 1, 1)
        else:
            current = datetime(current.year, current.month + 1, 1)

    cur = conn.cursor()
    col_names = None
    all_chunks = []
    total = 0

    for i in range(len(month_starts) - 1):
        m_start = month_starts[i].strftime("%Y-%m-%dT%H:%M:%S.000000Z")
        m_end = month_starts[i + 1].strftime("%Y-%m-%dT%H:%M:%S.000000Z")

        query = (
            f"SELECT * FROM {table} "
            f"WHERE symbol = '{symbol}' "
            f"AND timestamp >= '{m_start}' AND timestamp < '{m_end}' "
            f"ORDER BY timestamp"
        )
        cur.execute(query)

        if col_names is None:
            col_names = [d[0] for d in cur.description]

        while True:
            rows = cur.fetchmany(chunk_size)
            if not rows:
                break
            all_chunks.append(rows)
            total += len(rows)

        elapsed = time.time() - t0
        label = month_starts[i].strftime("%Y-%m")
        print(f"\r  [{symbol}] {total:,} rows through {label} ({elapsed:.0f}s)", end="", flush=True)

    cur.close()
    print()

    if not all_chunks or col_names is None:
        print(f"  [{symbol}] No data fetched")
        return 0

    import itertools
    all_rows = list(itertools.chain.from_iterable(all_chunks))
    df = pd.DataFrame(all_rows, columns=col_names)
    del all_rows, all_chunks

    # Save as parquet
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(str(output_path), compression="zstd", compression_level=3)

    file_mb = output_path.stat().st_size / (1024 * 1024)
    elapsed = time.time() - t0
    print(f"  [{symbol}] {total:,} rows -> {output_path.name} ({file_mb:.1f} MB, {elapsed:.0f}s)")

    return total


def main():
    parser = argparse.ArgumentParser(description="Dump QuestDB tables to parquet")
    parser.add_argument("--tables", type=str, default="ohlcv",
                        help="Comma-separated table names (default: ohlcv)")
    parser.add_argument("--symbols", type=str, default=None,
                        help="Comma-separated symbols (default: all)")
    parser.add_argument("--output-dir", type=str, default=str(CACHE_DIR),
                        help=f"Output directory (default: {CACHE_DIR})")
    args = parser.parse_args()

    tables = [t.strip() for t in args.tables.split(",")]
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    conn = connect()

    for table in tables:
        print(f"\n{'=' * 60}")
        print(f"Dumping: {table}")
        print(f"{'=' * 60}")

        if args.symbols:
            symbols = [s.strip().upper() for s in args.symbols.split(",")]
        else:
            symbols = get_symbols(conn, table)
            if not symbols:
                print(f"  No symbols found in {table}")
                continue

        print(f"  Symbols: {', '.join(symbols)}")

        total_rows = 0
        for symbol in symbols:
            output_path = output_dir / f"{table}_{symbol}.parquet"
            rows = dump_symbol(conn, table, symbol, output_path)
            total_rows += rows

        print(f"\n  Total: {total_rows:,} rows dumped for {table}")

    conn.close()
    print(f"\nDone. Output: {output_dir}")


if __name__ == "__main__":
    main()
