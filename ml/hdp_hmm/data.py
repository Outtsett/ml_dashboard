"""
HDP-HMM Data Loading
======================

Loads OHLCV data from DuckDB or pre-exported parquet files.
Handles root symbols (continuous contracts) and specific contract symbols.
"""

from typing import Optional

import duckdb
import pandas as pd  # type: ignore[import-untyped]

from .config import DB_PATH, TIMEFRAME_MAP


def load_ohlcv_data(
    symbol: str,
    timeframe: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    data_file: Optional[str] = None,
) -> pd.DataFrame:
    """
    Load OHLCV data for a single symbol. Handles root symbols (continuous contracts)
    and specific contract symbols.

    Returns DataFrame with columns: ts, open, high, low, close, volume
    """
    if data_file:
        mem = duckdb.connect(":memory:")
        fpath = data_file.replace("\\", "/")
        df = mem.execute(f"SELECT * FROM read_parquet('{fpath}')").fetchdf()
        mem.close()
        return df

    conn = duckdb.connect(str(DB_PATH), read_only=True)

    is_root = len(symbol) <= 3 and symbol.isalpha()
    tf_seconds = TIMEFRAME_MAP.get(timeframe, TIMEFRAME_MAP.get(timeframe.lower(), 60))
    interval = f"{tf_seconds} seconds"

    time_filter = ""
    if start:
        time_filter += f" AND o.ts >= '{start}'"
    if end:
        time_filter += f" AND o.ts <= '{end}'"

    if is_root:
        sql = f"""
            WITH schedule AS (
                SELECT to_contract as contract, rollover_date as start_date,
                       LEAD(rollover_date) OVER (PARTITION BY root ORDER BY rollover_date) as end_date,
                       cumulative_adjustment as adj
                FROM rollovers WHERE root = '{symbol}'
                UNION ALL
                SELECT from_contract as contract, DATE '1900-01-01' as start_date,
                       rollover_date as end_date,
                       cumulative_adjustment + price_gap as adj
                FROM rollovers
                WHERE root = '{symbol}'
                  AND rollover_date = (SELECT MIN(rollover_date) FROM rollovers WHERE root = '{symbol}')
            ),
            stitched AS (
                SELECT o.ts, o.open + s.adj as open, o.high + s.adj as high,
                       o.low + s.adj as low, o.close + s.adj as close, o.volume
                FROM ohlcv o
                JOIN schedule s ON o.symbol = s.contract
                  AND CAST(o.ts AS DATE) >= s.start_date
                  AND (s.end_date IS NULL OR CAST(o.ts AS DATE) < s.end_date)
                WHERE 1=1 {time_filter}
            )
            SELECT time_bucket(INTERVAL '{interval}', ts) as ts,
                   FIRST(open ORDER BY ts) as open, MAX(high) as high,
                   MIN(low) as low, LAST(close ORDER BY ts) as close,
                   CAST(SUM(volume) AS DOUBLE) as volume
            FROM stitched
            GROUP BY time_bucket(INTERVAL '{interval}', ts)
            ORDER BY 1 ASC
        """
    else:
        where = f"WHERE symbol = '{symbol}'"
        if start:
            where += f" AND ts >= '{start}'"
        if end:
            where += f" AND ts <= '{end}'"

        if tf_seconds <= 60:
            sql = f"""
                SELECT ts, open, high, low, close, CAST(volume AS DOUBLE) as volume
                FROM ohlcv {where}
                ORDER BY ts ASC
            """
        else:
            sql = f"""
                SELECT
                    time_bucket(INTERVAL '{interval}', ts) as ts,
                    FIRST(open) as open, MAX(high) as high,
                    MIN(low) as low, LAST(close) as close,
                    CAST(SUM(volume) AS DOUBLE) as volume
                FROM ohlcv {where}
                GROUP BY time_bucket(INTERVAL '{interval}', ts)
                ORDER BY 1 ASC
            """

    df = conn.execute(sql).fetchdf()
    conn.close()
    return df
