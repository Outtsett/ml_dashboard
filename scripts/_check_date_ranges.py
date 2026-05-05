"""Check date range and years of data per symbol."""
import os
from datetime import datetime

import duckdb

conn = duckdb.connect(":memory:")

for ac in ["futures", "forex"]:
    ac_dir = f"data/{ac}"
    if not os.path.isdir(ac_dir):
        continue
    for sym in sorted(os.listdir(ac_dir)):
        sym_dir = os.path.join(ac_dir, sym)
        if not os.path.isdir(sym_dir):
            continue
        # Pick the largest timeframe available (1d preferred)
        for tf in ["1d", "4h", "1h", "15m", "5m"]:
            tf_dir = os.path.join(sym_dir, tf)
            meta = os.path.join(tf_dir, "_meta.json")
            if os.path.exists(meta):
                parquets = [f for f in os.listdir(tf_dir) if f.endswith(".parquet")]
                if parquets:
                    p = os.path.join(tf_dir, parquets[0]).replace("\\", "/")
                    try:
                        r = conn.execute(f"""
                            SELECT MIN(timestamp), MAX(timestamp), COUNT(*)
                            FROM read_parquet('{p}')
                        """).fetchone()
                        min_ts, max_ts, rows = r
                        # Timestamps may be epoch seconds or ms
                        if min_ts > 1e12:
                            d1 = datetime.fromtimestamp(min_ts / 1000)
                            d2 = datetime.fromtimestamp(max_ts / 1000)
                        else:
                            d1 = datetime.fromtimestamp(min_ts)
                            d2 = datetime.fromtimestamp(max_ts)
                        years = (d2 - d1).days / 365.25
                        print(
                            f"{ac:7s} {sym:10s} {tf:3s}  "
                            f"{d1.strftime('%Y-%m-%d')} -> {d2.strftime('%Y-%m-%d')}  "
                            f"({years:.1f} yrs, {rows:>10,} rows)"
                        )
                    except Exception as e:
                        print(f"{ac:7s} {sym:10s} {tf:3s}  ERROR: {e}")
                break

conn.close()
