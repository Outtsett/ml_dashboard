"""MNQ 1-minute bars with the 61 TA-Lib pattern columns, as the lake already holds them.

Source: ``derived_mnq_next_candles_1m`` (``s3://derived/mnq_next_candles_1m/recipe=pattern_forward_candles_v1``,
built by datalake ``scripts/build_mnq_next_candles.py``): one row per traded minute of the front
contract, true UTC, unadjusted, with every ``candlestick_<name>`` column computed by TA-Lib 0.7.1
inside each contract. Bars from 2025-07-01 on are never read — that half-year is the multimodal
model's locked holdout (``packages/ml-engine/src/multimodal/holdout.py``).
"""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd

SOURCE = ("read_parquet('s3://derived/mnq_next_candles_1m/recipe=pattern_forward_candles_v1/**/*.parquet', "
          "hive_partitioning=true, union_by_name=true)")
HOLDOUT_START = "2025-07-01"
TICK = 0.25


CACHE = Path(__file__).resolve().parents[3] / "data" / ".cache" / "candle_vision"


def load(start: str = "2021-01-01", end: str = HOLDOUT_START, with_patterns: bool = True, attempts: int = 6) -> pd.DataFrame:
    """Bars in time order with a ``contract_position`` column (0 = the contract's first bar here).

    The read is cached under ``data/.cache/candle_vision/`` (the repo's lake-read cache; the source
    recipe is write-once, so the cache cannot go stale) and retried with back-off, because the lake's
    object server drops connections under load."""
    if pd.Timestamp(end) > pd.Timestamp(HOLDOUT_START):
        raise ValueError(f"bars from {HOLDOUT_START} on are the locked holdout; end must be <= {HOLDOUT_START}")
    cached = CACHE / f"mnq_next_candles_1m_{start}_{end}_{'patterns' if with_patterns else 'bars'}.parquet"
    if cached.exists():
        return pd.read_parquet(cached)
    for attempt in range(attempts):
        try:
            frame = _read(start, end, with_patterns)
            break
        except Exception:  # noqa: BLE001 — duckdb raises IOException on a dropped connection
            if attempt == attempts - 1:
                raise
            time.sleep(5 * 2 ** attempt)
    CACHE.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(cached, index=False)
    return frame


def _read(start: str, end: str, with_patterns: bool) -> pd.DataFrame:
    from lake.catalog import duckdb_connect

    con = duckdb_connect()  # S3 credentials only: this reads one dataset, not the whole serving catalog
    con.execute("SET TimeZone='UTC'")
    columns = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {SOURCE}").fetchall()]
    patterns = [c for c in columns if c.startswith("candlestick_")] if with_patterns else []
    wanted = ["timestamp", "contract_symbol", "trading_day", "minute_of_session", "open", "high", "low", "close",
              "volume", "bars_since_session_break"] + patterns
    select = ", ".join(f'"{c}"' for c in wanted)
    frame = con.execute(
        f"SELECT {select} FROM {SOURCE} WHERE timestamp >= TIMESTAMP '{pd.Timestamp(start):%Y-%m-%d}' "
        f"AND timestamp < TIMESTAMP '{pd.Timestamp(end):%Y-%m-%d}' ORDER BY timestamp"
    ).df()
    con.close()
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
    if frame["timestamp"].duplicated().any():
        raise ValueError("duplicate timestamps in the source")
    frame["contract_position"] = frame.groupby((frame["contract_symbol"] != frame["contract_symbol"].shift()).cumsum()).cumcount()
    return frame.reset_index(drop=True)
