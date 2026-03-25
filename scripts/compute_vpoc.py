"""
Compute Volume Point of Control (VPOC) from QuestDB OHLCV data.

Reads OHLCV from QuestDB materialized views, computes rolling VPOC using
pandas-ta ta.vp(), writes results back to QuestDB via ILP.

Output table: vpoc
    symbol      SYMBOL
    timeframe   SYMBOL
    timestamp   TIMESTAMP
    vpoc_20     FLOAT   — VPOC price level, 20-bar window
    vpoc_50     FLOAT   — VPOC price level, 50-bar window
    vpoc_dist_20 FLOAT  — (close - VPOC_20) / ATR_14
    vpoc_dist_50 FLOAT  — (close - VPOC_50) / ATR_14

Usage:
    python scripts/compute_vpoc.py
    python scripts/compute_vpoc.py --symbols NQH6,ESH6 --timeframes 1d,1h
    python scripts/compute_vpoc.py --timeframes 5m --symbols MNQ
"""

import argparse
import os
import time

import numpy as np
import pandas as pd
import pandas_ta as ta
import psycopg2
from questdb.ingress import Sender, TimestampNanos

QUESTDB_HOST = os.environ.get("QUESTDB_HOST", "localhost")
QUESTDB_PG_PORT = int(os.environ.get("QUESTDB_PG_PORT", "8812"))
QUESTDB_HTTP_PORT = os.environ.get("QUESTDB_HTTP_PORT", "9000")

TIMEFRAMES = ("5m", "15m", "30m", "1h", "4h", "1d", "1w")

# Map timeframe to QuestDB materialized view name
VIEW_MAP = {tf: f"ohlcv_{tf}" for tf in TIMEFRAMES}

VPOC_WINDOWS = (20, 50)


def get_connection():
    return psycopg2.connect(
        host=QUESTDB_HOST,
        port=QUESTDB_PG_PORT,
        user=os.environ.get("QUESTDB_USER", "admin"),
        password=os.environ.get("QUESTDB_PASSWORD", "quest"),
        database="qdb",
    )


def get_symbols(conn, view: str) -> list[str]:
    """Get distinct symbols from a materialized view."""
    cur = conn.cursor()
    cur.execute(f"SELECT DISTINCT symbol FROM {view} ORDER BY symbol")
    symbols = [r[0] for r in cur.fetchall()]
    cur.close()
    return symbols


def load_ohlcv(conn, view: str, symbol: str) -> pd.DataFrame:
    """Load OHLCV data for a symbol from QuestDB."""
    cur = conn.cursor()
    cur.execute(
        f"SELECT timestamp, open, high, low, close, volume "
        f"FROM {view} WHERE symbol = '{symbol}' ORDER BY timestamp"
    )
    rows = cur.fetchall()
    cur.close()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = df[c].astype(np.float64)
    return df


def compute_vpoc(df: pd.DataFrame) -> pd.DataFrame:
    """Compute VPOC columns using pandas-ta ta.vp()."""
    close_s = df["close"]
    volume_s = df["volume"]
    close_arr = df["close"].values
    n_bars = len(df)

    # ATR(14) for distance normalization
    atr = ta.atr(df["high"], df["low"], close_s, length=14).values

    results = {}

    for window in VPOC_WINDOWS:
        vpoc_prices = np.full(n_bars, np.nan)
        vpoc_dist = np.full(n_bars, np.nan)

        for i in range(window - 1, n_bars):
            start = i - window + 1
            w_close = close_s.iloc[start : i + 1].reset_index(drop=True)
            w_vol = volume_s.iloc[start : i + 1].reset_index(drop=True)

            try:
                profile = ta.vp(w_close, w_vol, width=10)
            except Exception:
                continue

            if profile is None or profile.empty:
                continue

            # Column names vary by pandas-ta version
            total_col = "total_volume" if "total_volume" in profile.columns else "total_1"
            mean_col = "mean_close" if "mean_close" in profile.columns else "mean_0"
            poc_row = profile.loc[profile[total_col].idxmax()]
            poc_price = poc_row[mean_col]

            vpoc_prices[i] = poc_price
            a = atr[i]
            if a > 0 and not np.isnan(a):
                vpoc_dist[i] = (close_arr[i] - poc_price) / a

        results[f"vpoc_{window}"] = vpoc_prices.astype(np.float32)
        results[f"vpoc_dist_{window}"] = vpoc_dist.astype(np.float32)

    for col, vals in results.items():
        df[col] = vals

    return df


def upload_vpoc(df: pd.DataFrame, symbol: str, timeframe: str) -> int:
    """Write VPOC rows to QuestDB via ILP."""
    # Drop rows where all VPOC values are NaN
    vpoc_cols = [c for c in df.columns if c.startswith("vpoc_")]
    mask = df[vpoc_cols].notna().any(axis=1)
    valid = df[mask]

    if valid.empty:
        return 0

    with Sender.from_conf(f"http::addr={QUESTDB_HOST}:{QUESTDB_HTTP_PORT};") as sender:
        for _, row in valid.iterrows():
            ts_ns = int(row["timestamp"].timestamp() * 1e9)
            cols = {}
            for c in vpoc_cols:
                v = row[c]
                if not np.isnan(v):
                    cols[c] = float(v)

            if cols:
                sender.row(
                    "vpoc",
                    symbols={"symbol": symbol, "timeframe": timeframe},
                    columns=cols,
                    at=TimestampNanos(ts_ns),
                )
        sender.flush()

    return len(valid)


def process_symbol(conn, view: str, timeframe: str, symbol: str) -> int:
    """Load, compute, upload VPOC for one symbol/timeframe."""
    df = load_ohlcv(conn, view, symbol)
    if df.empty or len(df) < 30:
        return 0

    df = compute_vpoc(df)
    return upload_vpoc(df, symbol, timeframe)


def main():
    parser = argparse.ArgumentParser(description="Compute VPOC from QuestDB OHLCV")
    parser.add_argument("--symbols", type=str, default=None,
                        help="Comma-separated symbols (default: all)")
    parser.add_argument("--timeframes", type=str, default="1d,1h,5m",
                        help="Comma-separated timeframes (default: 1d,1h,5m)")
    args = parser.parse_args()

    timeframes = [tf.strip() for tf in args.timeframes.split(",")]
    for tf in timeframes:
        if tf not in VIEW_MAP:
            print(f"Unknown timeframe: {tf}. Available: {', '.join(TIMEFRAMES)}")
            return

    conn = get_connection()
    print(f"[vpoc] Connected to QuestDB {QUESTDB_HOST}:{QUESTDB_PG_PORT}")

    total_rows = 0
    total_symbols = 0
    t0 = time.time()

    for tf in timeframes:
        view = VIEW_MAP[tf]
        symbols = args.symbols.split(",") if args.symbols else get_symbols(conn, view)
        # Filter out spreads (contain '-')
        symbols = [s for s in symbols if "-" not in s]

        print(f"[vpoc] {tf}: {len(symbols)} symbols from {view}")

        for sym in symbols:
            try:
                n = process_symbol(conn, view, tf, sym)
                if n > 0:
                    total_rows += n
                    total_symbols += 1
                    print(f"  {sym}/{tf}: {n:,} rows", flush=True)
            except Exception as e:
                print(f"  {sym}/{tf}: ERROR — {e}", flush=True)

    conn.close()
    elapsed = time.time() - t0
    print(f"[vpoc] Done: {total_rows:,} rows, {total_symbols} symbol/tf combos, {elapsed:.1f}s")


if __name__ == "__main__":
    main()
