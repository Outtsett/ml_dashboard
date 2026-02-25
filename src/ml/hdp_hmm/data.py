"""
HDP-HMM Data Loading
======================

Loads OHLCV data from CSV, Parquet, or (optionally) DuckDB.

Standalone: works with any CSV or Parquet file containing OHLCV columns.
No DuckDB or external database required.

DuckDB support is kept as an optional fallback for users who have the
market.duckdb file and want continuous contract stitching.
"""

from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd  # type: ignore[import-untyped]

from .config import DB_PATH, TIMEFRAME_MAP


def _standardize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    Standardize column names to: ts, open, high, low, close, volume.
    Handles common variants (timestamp, date, datetime, Date, etc.).
    """
    col_map: dict[str, str] = {}
    lower_cols = {c.lower(): c for c in df.columns}

    # Timestamp variants
    for alias in ("ts", "timestamp", "date", "datetime", "time", "ts_event"):
        if alias in lower_cols:
            col_map[lower_cols[alias]] = "ts"
            break

    # OHLCV variants
    for target in ("open", "high", "low", "close", "volume"):
        if target in lower_cols:
            col_map[lower_cols[target]] = target

    if col_map:
        df = df.rename(columns=col_map)

    # Ensure ts is datetime
    if "ts" in df.columns and not pd.api.types.is_datetime64_any_dtype(df["ts"]):
        df["ts"] = pd.to_datetime(df["ts"])

    # Ensure volume exists (some forex data lacks it)
    if "volume" not in df.columns:
        df["volume"] = 0.0

    return df


def _resample_ohlcv(df: pd.DataFrame, tf_seconds: int) -> pd.DataFrame:
    """Resample OHLCV data to the target timeframe using pandas."""
    if tf_seconds <= 60:
        return df  # already at 1m or finer

    freq_map = {
        300: "5min",
        900: "15min",
        1800: "30min",
        3600: "1h",
        14400: "4h",
        86400: "1D",
        604800: "1W",
    }
    freq = freq_map.get(tf_seconds, f"{tf_seconds}s")

    df = df.set_index("ts").sort_index()
    resampled = (
        df.resample(freq)
        .agg(
            {
                "open": "first",
                "high": "max",
                "low": "min",
                "close": "last",
                "volume": "sum",
            }
        )
        .dropna(subset=["open"])
    )
    resampled = resampled.reset_index()
    return resampled


def load_ohlcv_data(
    symbol: str,
    timeframe: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
    data_file: Optional[str] = None,
) -> pd.DataFrame:
    """
    Load OHLCV data for a single symbol.

    Standalone priority:
      1. --data-file flag: loads any CSV or Parquet file directly (no DuckDB)
      2. DuckDB fallback: if data_file is None AND market.duckdb exists,
         uses DuckDB for continuous contract stitching (optional)

    Returns DataFrame with columns: ts, open, high, low, close, volume
    """
    tf_seconds = TIMEFRAME_MAP.get(timeframe, TIMEFRAME_MAP.get(timeframe.lower(), 60))

    # ── Path 1: Load from explicit file (CSV or Parquet) — fully standalone ──
    if data_file:
        fpath = Path(data_file)
        if not fpath.exists():
            raise FileNotFoundError(f"Data file not found: {data_file}")

        if fpath.suffix.lower() == ".csv":
            df = pd.read_csv(data_file)
        elif fpath.suffix.lower() in (".parquet", ".pq"):
            df = pd.read_parquet(data_file)
        else:
            raise ValueError(
                f"Unsupported file format: {fpath.suffix}. Use .csv or .parquet"
            )

        df = _standardize_columns(df)

        # Filter by date range
        if start:
            df = df[df["ts"] >= pd.Timestamp(start)]
        if end:
            df = df[df["ts"] <= pd.Timestamp(end)]

        # Resample to target timeframe
        df = _resample_ohlcv(df, tf_seconds)
        df = df.sort_values("ts").reset_index(drop=True)
        return df

    # ── Path 2: DuckDB fallback (optional — for continuous contracts) ──
    if not DB_PATH.exists():
        raise FileNotFoundError(
            f"No data file provided (--data-file) and market.duckdb not found at {DB_PATH}.\n"
            f"To run standalone, provide a CSV or Parquet file with OHLCV data:\n"
            f"  python -m ml.hdp_hmm --symbol ES --timeframe 1d --data-file path/to/ohlcv.csv"
        )

    try:
        import duckdb
    except ImportError:
        raise ImportError(
            "DuckDB not installed and no --data-file provided.\n"
            "Either install duckdb (`pip install duckdb`) or provide a data file:\n"
            "  python -m ml.hdp_hmm --data-file path/to/ohlcv.csv"
        ) from None

    conn = duckdb.connect(str(DB_PATH), read_only=True)

    is_root = len(symbol) <= 3 and symbol.isalpha()
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
