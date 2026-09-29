"""Order-flow proxies for MNQ (and NQ / ES history) from the 1-second bars (the lake has no real order flow before 2026-03).

The lake's `vol_at_bid` / `vol_at_ask` columns are empty outside one 2026
session, but its 1-second MNQ bars (2019-05 → 2025-12) carry enough to classify
volume: each second's volume is signed by the tick rule (its close against the
previous second's close in the same contract; an unchanged close keeps the last
non-zero sign). Per contract and minute:

    volume, buy_volume, sell_volume, signed_volume (buy - sell), active_seconds
    (seconds with a trade), largest_second_volume, up_seconds, down_seconds

    s3://derived/multimodal_orderflow/recipe=tick_rule_1s_v1/table=minutes/

Timestamps are the lake's futures clock (Pacific wall clock as UTC), minute
start. The front contract per session is chosen later, by the feature builder,
from the same rule the minutes use. Built month by month; the first second of a
month has no previous second and counts as unsigned.

    .venv/Scripts/python.exe scripts/multimodal/build_orderflow.py --start 2019-05-01 --end 2026-01-01
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import date
from pathlib import Path

import pyarrow as pa

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from multimodal.lake_io import write_table  # noqa: E402

DATASET = "multimodal_orderflow"
RECIPE = "tick_rule_1s_v1"   # MNQ; other roots land under tick_rule_1s_v1_<root lower>

MONTH_SQL = """
WITH seconds AS (
    SELECT symbol, timestamp, volume,
           close - lag(close) OVER (PARTITION BY symbol ORDER BY timestamp) AS change
    FROM ohlcv
    WHERE regexp_full_match(symbol, '{root}[FGHJKMNQUVXZ][0-9]{{1,2}}')
      AND timestamp >= CAST(? AS TIMESTAMP) AND timestamp < CAST(? AS TIMESTAMP)
      AND volume > 0
),
signed AS (
    SELECT symbol, timestamp, volume,
           last_value(CASE WHEN change > 0 THEN 1 WHEN change < 0 THEN -1 END IGNORE NULLS)
               OVER (PARTITION BY symbol ORDER BY timestamp ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS side,
           change
    FROM seconds
)
SELECT symbol,
       time_bucket(INTERVAL 1 MINUTE, timestamp) AS minute,
       sum(volume) AS volume,
       sum(CASE WHEN side = 1 THEN volume ELSE 0 END) AS buy_volume,
       sum(CASE WHEN side = -1 THEN volume ELSE 0 END) AS sell_volume,
       sum(coalesce(side, 0) * volume) AS signed_volume,
       count(*) AS active_seconds,
       max(volume) AS largest_second_volume,
       sum(CASE WHEN change > 0 THEN 1 ELSE 0 END) AS up_seconds,
       sum(CASE WHEN change < 0 THEN 1 ELSE 0 END) AS down_seconds
FROM signed
GROUP BY 1, 2
ORDER BY 1, 2
"""


def months(start: date, end: date):
    current = date(start.year, start.month, 1)
    while current < end:
        following = date(current.year + (current.month == 12), current.month % 12 + 1, 1)
        yield current, following
        current = following


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--root", default="MNQ", choices=("MNQ", "NQ", "ES"))
    args = parser.parse_args()
    recipe = RECIPE if args.root == "MNQ" else f"{RECIPE}_{args.root.lower()}"
    month_sql = MONTH_SQL.replace("{root}", args.root).replace("{{1,2}}", "{1,2}")
    from lake.serving import connect

    connection = connect(with_bars=False, with_derived=False)
    connection.execute("SET TimeZone='UTC'")
    tables = []
    began = time.time()
    for first, following in months(date.fromisoformat(args.start), date.fromisoformat(args.end)):
        table = connection.execute(month_sql, [first.isoformat(), following.isoformat()]).to_arrow_table()
        tables.append(table)
        print(f"{first:%Y-%m}: {table.num_rows:,} contract-minutes ({time.time() - began:.0f} s)", flush=True)
    combined = pa.concat_tables(tables)
    entry = write_table(DATASET, recipe, "minutes", combined, source=f"ohlcv 1-second {args.root} bars, tick rule")
    print(f"landed minutes: {entry['rows']:,} rows, {entry['bytes']:,} bytes in {time.time() - began:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
