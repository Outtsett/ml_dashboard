"""
Compute ALL pandas-ta indicators for every symbol × timeframe.

Reads OHLCV from DuckDB market.duckdb (read-only), computes ~344 indicator
columns via pandas-ta AllStudy + custom extras, writes parquet to data/indicators/.

For futures: builds continuous contract using rollover schedule + Panama adjustment.
For forex: reads directly from ohlcv table.

Run: python scripts/compute-indicators.py
  or: python scripts/compute-indicators.py --symbols ES,MNQ --timeframes 1d,1h
  or: python scripts/compute-indicators.py --skip-1m --workers 4

Requires: pandas-ta>=0.4.71b0, duckdb>=1.2.0, pyarrow
"""

import argparse
import os
import sys
import time
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed

import duckdb
import pandas as pd
import pandas_ta as ta

# Project root
ROOT = Path(__file__).resolve().parent.parent
DB_PATH = str(ROOT / "data" / "market.duckdb")
OUT_DIR = ROOT / "data" / "indicators"

# Ordered largest-to-smallest so we process fast timeframes first (reversed below)
TIMEFRAMES = {
    "1w": 604800,
    "1d": 86400,
    "4h": 14400,
    "1h": 3600,
    "30m": 1800,
    "15m": 900,
    "5m": 300,
    "1m": 60,
}

FUTURES_ROOTS = ["ES", "NQ", "YM", "RTY", "MNQ", "MES", "MYM", "M2K"]


def get_instruments(con: duckdb.DuckDBPyConnection) -> list[dict]:
    """Get all symbols from ohlcv, grouped by type."""
    futures_roots = con.sql(
        "SELECT DISTINCT root FROM rollovers ORDER BY root"
    ).fetchall()
    futures_set = {r[0] for r in futures_roots}

    all_symbols = con.sql(
        "SELECT DISTINCT symbol FROM ohlcv ORDER BY symbol"
    ).fetchall()

    forex = []
    for (sym,) in all_symbols:
        is_futures_contract = False
        for root in futures_set:
            if sym.startswith(root) and len(sym) > len(root):
                is_futures_contract = True
                break
        if not is_futures_contract and sym not in futures_set:
            forex.append(sym)

    instruments = []
    for root in sorted(futures_set):
        instruments.append({"symbol": root, "type": "futures"})
    for sym in sorted(forex):
        instruments.append({"symbol": sym, "type": "forex"})

    return instruments


def build_continuous_ohlcv(
    con: duckdb.DuckDBPyConnection, root: str, tf_seconds: int
) -> pd.DataFrame:
    """Build continuous contract OHLCV with Panama adjustment."""
    interval = f"{tf_seconds} seconds"

    df = con.sql(f"""
        WITH schedule AS (
            SELECT
                to_contract as contract,
                rollover_date as start_date,
                LEAD(rollover_date) OVER (PARTITION BY root ORDER BY rollover_date) as end_date,
                cumulative_adjustment as adj
            FROM rollovers
            WHERE root = '{root}'

            UNION ALL

            SELECT
                from_contract as contract,
                DATE '1900-01-01' as start_date,
                rollover_date as end_date,
                cumulative_adjustment + price_gap as adj
            FROM rollovers
            WHERE root = '{root}'
              AND rollover_date = (SELECT MIN(rollover_date) FROM rollovers WHERE root = '{root}')
        ),
        stitched AS (
            SELECT
                o.ts,
                o.open + s.adj as open,
                o.high + s.adj as high,
                o.low + s.adj as low,
                o.close + s.adj as close,
                o.volume
            FROM ohlcv o
            JOIN schedule s ON o.symbol = s.contract
                AND CAST(o.ts AS DATE) >= s.start_date
                AND (s.end_date IS NULL OR CAST(o.ts AS DATE) < s.end_date)
        )
        SELECT
            time_bucket(INTERVAL '{interval}', ts) as timestamp,
            first(open ORDER BY ts) as open,
            max(high) as high,
            min(low) as low,
            last(close ORDER BY ts) as close,
            CAST(sum(volume) AS DOUBLE) as volume
        FROM stitched
        GROUP BY time_bucket(INTERVAL '{interval}', ts)
        ORDER BY timestamp
    """).df()

    return df


def build_forex_ohlcv(
    con: duckdb.DuckDBPyConnection, symbol: str, tf_seconds: int
) -> pd.DataFrame:
    """Read forex OHLCV aggregated to timeframe."""
    interval = f"{tf_seconds} seconds"

    df = con.sql(f"""
        SELECT
            time_bucket(INTERVAL '{interval}', ts) as timestamp,
            first(open ORDER BY ts) as open,
            max(high) as high,
            min(low) as low,
            last(close ORDER BY ts) as close,
            CAST(sum(volume) AS DOUBLE) as volume
        FROM ohlcv
        WHERE symbol = '{symbol}'
        GROUP BY time_bucket(INTERVAL '{interval}', ts)
        ORDER BY timestamp
    """).df()

    return df


def compute_indicators(df: pd.DataFrame, symbol: str, tf_name: str) -> pd.DataFrame:
    """Compute ALL pandas-ta indicators on a DataFrame."""
    if df.empty or len(df) < 30:
        print(f"  [{symbol}/{tf_name}] Skip: only {len(df)} bars (need >= 30)")
        return df

    df.columns = [c.lower() for c in df.columns]

    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df.set_index("timestamp", inplace=True)

    for col in ["open", "high", "low", "close", "volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df.dropna(subset=["open", "high", "low", "close"], inplace=True)

    if len(df) < 30:
        print(f"  [{symbol}/{tf_name}] Skip after cleanup: only {len(df)} bars")
        return df

    # Use 2 cores for moderate parallelism within pandas-ta
    df.ta.cores = 2
    cols_before = len(df.columns)

    # 1) Run AllStudy
    try:
        df.ta.study(ta.AllStudy, verbose=False)
    except Exception as e:
        print(f"  [{symbol}/{tf_name}] AllStudy error: {e}")
        for cat_name, cat_fn in [
            ("candle", ta.candle_all),
            ("cycle", ta.cycle_all),
            ("momentum", ta.momentum_all),
            ("overlap", ta.overlap_all),
            ("performance", ta.performance_all),
            ("statistics", ta.statistics_all),
            ("trend", ta.trend_all),
            ("volatility", ta.volatility_all),
            ("volume", ta.volume_all),
        ]:
            try:
                cat_fn(df)
            except Exception as cat_e:
                print(f"  [{symbol}/{tf_name}] {cat_name} error: {cat_e}")

    # 2) Extra multi-length variants
    extras = ta.Study(
        name="extras",
        ta=[
            {"kind": "sma", "length": 5},
            {"kind": "sma", "length": 10},
            {"kind": "sma", "length": 50},
            {"kind": "sma", "length": 100},
            {"kind": "sma", "length": 200},
            {"kind": "ema", "length": 5},
            {"kind": "ema", "length": 10},
            {"kind": "ema", "length": 50},
            {"kind": "ema", "length": 100},
            {"kind": "ema", "length": 200},
            {"kind": "rsi", "length": 7},
            {"kind": "rsi", "length": 21},
            {"kind": "cci", "length": 14},
            {"kind": "mom", "length": 20},
            {"kind": "roc", "length": 20},
        ],
    )
    try:
        df.ta.study(extras, verbose=False)
    except Exception as e:
        print(f"  [{symbol}/{tf_name}] Extras error: {e}")

    new_cols = len(df.columns) - cols_before
    print(f"  [{symbol}/{tf_name}] {len(df)} bars, +{new_cols} indicators", flush=True)

    return df


def process_symbol(symbol: str, sym_type: str, tf_list: list, force: bool) -> dict:
    """Process all timeframes for one symbol. Runs in a worker process."""
    # Each worker opens its own read-only DuckDB connection
    con = duckdb.connect(DB_PATH, read_only=True)
    results = {"symbol": symbol, "completed": 0, "skipped": 0, "errors": 0}

    for tf_name, tf_sec in tf_list:
        out_path = OUT_DIR / f"{symbol}_{tf_name}.parquet"

        if out_path.exists() and not force:
            results["skipped"] += 1
            continue

        combo_start = time.time()
        try:
            if sym_type == "futures":
                df = build_continuous_ohlcv(con, symbol, tf_sec)
            else:
                df = build_forex_ohlcv(con, symbol, tf_sec)

            if df.empty:
                print(f"  [{symbol}/{tf_name}] No data", flush=True)
                results["completed"] += 1
                continue

            df = compute_indicators(df, symbol, tf_name)

            if df.index.name == "timestamp":
                df.reset_index(inplace=True)

            if "timestamp" in df.columns:
                df["timestamp"] = df["timestamp"].astype("int64") // 10**6

            df.to_parquet(str(out_path), index=False, engine="pyarrow")

            elapsed = time.time() - combo_start
            size_mb = out_path.stat().st_size / (1024 * 1024)
            results["completed"] += 1
            print(
                f"  [{symbol}/{tf_name}] Done ({elapsed:.1f}s, {size_mb:.0f}MB)",
                flush=True,
            )

        except Exception as e:
            results["errors"] += 1
            print(f"  [{symbol}/{tf_name}] ERROR: {e}", flush=True)

    con.close()
    return results


def main():
    parser = argparse.ArgumentParser(description="Compute all technical indicators")
    parser.add_argument("--symbols", type=str, help="Comma-separated symbols (default: all)")
    parser.add_argument("--timeframes", type=str, help="Comma-separated timeframes (default: all)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing parquet files")
    parser.add_argument("--skip-1m", action="store_true", help="Skip 1-minute timeframe (huge files)")
    parser.add_argument("--workers", type=int, default=3, help="Parallel workers (default: 3)")
    args = parser.parse_args()

    total_start = time.time()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Open DuckDB read-only to get instruments list
    con = duckdb.connect(DB_PATH, read_only=True)
    instruments = get_instruments(con)
    con.close()

    print(f"[indicators] Found {len(instruments)} instruments "
          f"({sum(1 for i in instruments if i['type'] == 'futures')} futures, "
          f"{sum(1 for i in instruments if i['type'] == 'forex')} forex)")

    if args.symbols:
        selected = set(args.symbols.upper().split(","))
        instruments = [i for i in instruments if i["symbol"] in selected]
        print(f"[indicators] Filtered to: {[i['symbol'] for i in instruments]}")

    # Build timeframe list (already ordered fast-first: 1w, 1d, 4h, ...)
    tf_list = list(TIMEFRAMES.items())
    if args.timeframes:
        selected_tfs = set(args.timeframes.lower().split(","))
        tf_list = [(k, v) for k, v in tf_list if k in selected_tfs]
    if args.skip_1m:
        tf_list = [(k, v) for k, v in tf_list if k != "1m"]
        print("[indicators] Skipping 1m timeframe")

    print(f"[indicators] Timeframes: {[t[0] for t in tf_list]}")
    print(f"[indicators] Workers: {args.workers}")

    total_combos = len(instruments) * len(tf_list)
    total_completed = 0
    total_skipped = 0
    total_errors = 0

    # Process symbols in parallel using ProcessPoolExecutor
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {}
        for inst in instruments:
            future = executor.submit(
                process_symbol,
                inst["symbol"],
                inst["type"],
                tf_list,
                args.force,
            )
            futures[future] = inst["symbol"]

        for future in as_completed(futures):
            symbol = futures[future]
            try:
                result = future.result()
                total_completed += result["completed"]
                total_skipped += result["skipped"]
                total_errors += result["errors"]
                done = total_completed + total_skipped
                print(
                    f"[indicators] {symbol} done "
                    f"({result['completed']} computed, {result['skipped']} skipped, "
                    f"{result['errors']} errors) "
                    f"[{done}/{total_combos} total]",
                    flush=True,
                )
            except Exception as e:
                print(f"[indicators] {symbol} WORKER ERROR: {e}", flush=True)
                total_errors += len(tf_list)

    total_time = time.time() - total_start
    print(f"\n[indicators] Done: {total_completed} computed, {total_skipped} skipped, "
          f"{total_errors} errors, {total_time:.0f}s total")

    parquet_files = list(OUT_DIR.glob("*.parquet"))
    total_size_mb = sum(f.stat().st_size for f in parquet_files) / (1024 * 1024)
    print(f"[indicators] {len(parquet_files)} parquet files, {total_size_mb:.0f} MB total")


if __name__ == "__main__":
    main()
