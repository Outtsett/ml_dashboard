"""
Rebuild every MNQ timeframe parquet from the base ``ohlcv`` table (1-second
granularity, continuous-stitched ``symbol='MNQ'``) so all timeframes share
the full available history (2019-05-05 -> present).

The pre-existing materialized views (``ohlcv_1m``, ``ohlcv_5m``, ...) only
backfilled the recent window (1m/5m/15m start at 2024-03-01 etc.). The base
``ohlcv`` table has continuous MNQ rolls back to 2019-05-05 with ~96.7M rows.
This script SAMPLE BYs the base table directly into bar timeframes and writes
canonical parquet files at::

    <PARQUET_DIR>/MNQ/<tf>.parquet

Output schema matches the existing parquets:

    timestamp, symbol, asset_class, root, open, high, low, close,
    volume, trades, vol_at_bid, vol_at_ask, trades_at_bid, trades_at_ask

Usage:
    python scripts/rebuild_mnq_parquets_from_base.py            # all 8 TFs
    python scripts/rebuild_mnq_parquets_from_base.py --tfs 1m,5m
    python scripts/rebuild_mnq_parquets_from_base.py --dry-run  # show row counts only
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
PARQUET_DIR = ROOT / "data" / "parquet"

TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w")
SYMBOL = "MNQ"
ROOT_COL = "MNQ"
ASSET_CLASS = "futures"

# QuestDB SAMPLE BY uses lowercase tf strings; 1w isn't directly supported in older
# versions, so we use 7d (matches data.py behavior).
TF_TO_INTERVAL = {tf: ("7d" if tf == "1w" else tf) for tf in TIMEFRAMES}


def _http_csv(sql: str, host: str, http_port: int) -> pd.DataFrame:
    """Stream a QuestDB SQL result via HTTP /exp into a pandas DataFrame.
    Faster than PG wire for multi-million-row results.
    """
    url = f"http://{host}:{http_port}/exp?query={urllib.parse.quote(sql)}"
    print(f"  HTTP /exp: {sql.strip()[:120]}...", flush=True)
    t0 = time.time()
    with urllib.request.urlopen(url, timeout=900) as resp:
        csv_bytes = resp.read()
    print(f"  fetched {len(csv_bytes) / 1e6:.1f} MB in {time.time() - t0:.1f}s", flush=True)
    df = pd.read_csv(io.BytesIO(csv_bytes))
    return df


def build_tf(tf: str, host: str, http_port: int) -> pd.DataFrame:
    """Aggregate the base ``ohlcv`` table to one bar timeframe for MNQ."""
    interval = TF_TO_INTERVAL[tf]
    sql = f"""
        SELECT
            '{SYMBOL}' AS symbol,
            '{ASSET_CLASS}' AS asset_class,
            '{ROOT_COL}' AS root,
            timestamp,
            first(open) AS open,
            max(high)  AS high,
            min(low)   AS low,
            last(close) AS close,
            sum(volume) AS volume,
            sum(trades) AS trades,
            sum(vol_at_bid) AS vol_at_bid,
            sum(vol_at_ask) AS vol_at_ask,
            sum(trades_at_bid) AS trades_at_bid,
            sum(trades_at_ask) AS trades_at_ask
        FROM ohlcv
        WHERE symbol = '{SYMBOL}'
        SAMPLE BY {interval} ALIGN TO CALENDAR
        ORDER BY timestamp
    """
    df = _http_csv(sql, host, http_port)
    # Coerce dtypes to match existing parquet schema
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    for col in (
        "open",
        "high",
        "low",
        "close",
        "volume",
        "trades",
        "vol_at_bid",
        "vol_at_ask",
        "trades_at_bid",
        "trades_at_ask",
    ):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    # Drop rows where every OHLC is NaN (SAMPLE BY can emit empty slots in
    # weekend gaps for higher TFs)
    ohlc_cols = ["open", "high", "low", "close"]
    df = df.dropna(subset=ohlc_cols, how="all").reset_index(drop=True)
    return df


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--tfs", default=",".join(TIMEFRAMES), help="Comma-separated timeframes (default: all 8)"
    )
    p.add_argument(
        "--out-dir",
        default=str(PARQUET_DIR / SYMBOL),
        help="Output directory (default: %(default)s)",
    )
    p.add_argument("--host", default=os.environ.get("QUESTDB_HOST", "127.0.0.1"))
    p.add_argument(
        "--http-port", type=int, default=int(os.environ.get("QUESTDB_HTTP_PORT", "9000"))
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print row counts and span only; do not write parquets",
    )
    args = p.parse_args()

    tfs = [tf.strip() for tf in args.tfs.split(",") if tf.strip()]
    bad = [tf for tf in tfs if tf not in TIMEFRAMES]
    if bad:
        print(f"ERROR: unknown timeframes {bad}; valid set is {TIMEFRAMES}", file=sys.stderr)
        return 2

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Source:    QuestDB http://{args.host}:{args.http_port}  table=ohlcv  symbol={SYMBOL}")
    print(f"Output:    {out_dir}")
    print(f"Timeframes: {', '.join(tfs)}")
    print()

    summary: list[tuple[str, int, str, str, float]] = []
    for tf in tfs:
        print(f"=== {SYMBOL} / {tf} ===")
        t0 = time.time()
        df = build_tf(tf, args.host, args.http_port)
        n = len(df)
        if n == 0:
            print(f"  WARN: empty result for {tf}", flush=True)
            summary.append((tf, 0, "", "", 0.0))
            continue
        first_ts = str(df["timestamp"].iloc[0])
        last_ts = str(df["timestamp"].iloc[-1])
        elapsed = time.time() - t0

        if args.dry_run:
            print(f"  [dry-run] {n:,} rows  span={first_ts} .. {last_ts}  elapsed={elapsed:.1f}s")
        else:
            out_path = out_dir / f"{tf}.parquet"
            df.to_parquet(str(out_path), compression="zstd", compression_level=3, index=False)
            size_mb = out_path.stat().st_size / (1024 * 1024)
            print(
                f"  wrote {out_path.name}  rows={n:,}  span={first_ts} .. {last_ts}  "
                f"size={size_mb:.1f} MB  elapsed={elapsed:.1f}s"
            )
        summary.append((tf, n, first_ts, last_ts, elapsed))
        print()

    print("=" * 78)
    print(f"{'tf':>4} | {'rows':>11} | first_ts            | last_ts             | sec")
    print("-" * 78)
    for tf, n, fts, lts, e in summary:
        print(f"{tf:>4} | {n:>11,} | {fts:<19} | {lts:<19} | {e:>5.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
