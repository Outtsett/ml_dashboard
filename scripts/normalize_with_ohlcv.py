"""Rebuild normalized indicator parquets with OHLCV included."""
import sys, time
sys.path.insert(0, ".")
import duckdb
import pandas as pd
from ml.hdp_hmm.indicators import load_indicator_data, normalize_indicators
from ml.hdp_hmm.config import INDICATORS_DIR, DB_PATH

con = duckdb.connect(str(DB_PATH), read_only=True)


def load_continuous_ohlcv(con, root, tf_seconds=60):
    interval = f"{tf_seconds} seconds"
    return con.sql(f"""
        WITH schedule AS (
            SELECT to_contract as contract,
                   rollover_date as start_date,
                   LEAD(rollover_date) OVER (
                       PARTITION BY root ORDER BY rollover_date
                   ) as end_date,
                   cumulative_adjustment as adj
            FROM rollovers WHERE root = '{root}'
            UNION ALL
            SELECT from_contract as contract,
                   DATE '1900-01-01' as start_date,
                   rollover_date as end_date,
                   cumulative_adjustment + price_gap as adj
            FROM rollovers
            WHERE root = '{root}'
              AND rollover_date = (
                  SELECT MIN(rollover_date) FROM rollovers WHERE root = '{root}'
              )
        ),
        stitched AS (
            SELECT o.ts,
                   o.open + s.adj as open,
                   o.high + s.adj as high,
                   o.low  + s.adj as low,
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


def load_forex_ohlcv(con, symbol, tf_seconds=60):
    interval = f"{tf_seconds} seconds"
    return con.sql(f"""
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


for symbol, sym_type in [("MNQ", "futures"), ("EURUSD", "forex")]:
    print(f"=== {symbol} 1m ===", flush=True)
    t0 = time.time()

    # Load OHLCV using same logic as compute-indicators.py
    if sym_type == "futures":
        ohlcv = load_continuous_ohlcv(con, symbol)
    else:
        ohlcv = load_forex_ohlcv(con, symbol)

    ts_first = ohlcv["timestamp"].iloc[0]
    ts_last = ohlcv["timestamp"].iloc[-1]
    print(f"  OHLCV: {len(ohlcv)} rows ({ts_first} to {ts_last})", flush=True)

    # Load & normalize indicators
    raw = load_indicator_data(symbol, "1m")
    normed = normalize_indicators(raw)
    print(f"  Indicators: {len(normed)} rows, {len(normed.columns)} cols", flush=True)

    # Align timestamps: OHLCV has datetime64, indicator ts comes from epoch ms
    ohlcv["ts"] = pd.to_datetime(ohlcv["timestamp"])
    ohlcv = ohlcv.drop(columns=["timestamp"])

    # Merge on ts
    merged = pd.merge(ohlcv, normed, on="ts", how="inner")
    print(f"  Merged: {len(merged)} rows, {len(merged.columns)} cols", flush=True)

    if len(merged) == 0:
        # Debug: show sample timestamps from each side
        print(f"  DEBUG ohlcv ts sample: {ohlcv['ts'].iloc[:3].tolist()}", flush=True)
        print(f"  DEBUG normed ts sample: {normed['ts'].iloc[:3].tolist()}", flush=True)
        print(f"  DEBUG ohlcv ts dtype: {ohlcv['ts'].dtype}", flush=True)
        print(f"  DEBUG normed ts dtype: {normed['ts'].dtype}", flush=True)
        continue

    out_path = INDICATORS_DIR / "1m" / symbol / "normalized.parquet"
    merged.to_parquet(str(out_path), compression="zstd", index=False)
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"  Saved: {size_mb:.1f}MB ({time.time()-t0:.1f}s)", flush=True)
    print(flush=True)

con.close()
