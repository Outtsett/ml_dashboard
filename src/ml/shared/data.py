"""
OHLCV loading from the lake — shared across all ML model packages.

Reads through `lake.serving.connect()` — DuckDB with `bars` over the Iceberg
table plus the per-table serving views. Every query runs in-process against
``E:/lake``; there is no database server to reach and no network hop.
Returns numpy arrays directly.

Public entry points:
  - load_ohlcv_arrays(symbol, timeframe, max_bars=0, date_range=None)
  - load_ohlcv_arrays_fast(...)   (legacy; now identical to load_ohlcv_arrays)
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np
import polars as pl

from .protocol import emit_log, emit_progress

# ── SQL Input Validation ────────────────────────────────────────────────────


def _validate_sql_input(value, name, pattern=r"^[A-Za-z0-9_\-/]+$"):
    """Validate input before SQL interpolation to prevent injection."""
    if not isinstance(value, str) or not re.match(pattern, value):
        raise ValueError(f"Invalid {name}: {value!r}")
    return value


def _validate_date(value, name):
    """Validate date string is ISO format before SQL interpolation."""
    if not isinstance(value, str) or not re.match(
        r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$", value
    ):
        raise ValueError(f"Invalid {name}: {value!r}")
    return value


# ── Connection helpers ─────────────────────────────────────────────────────


_OHLCV_SCHEMA: dict[str, Any] = {
    "symbol": pl.Utf8,
    "timestamp": pl.Datetime("us"),
    "open": pl.Float64,
    "high": pl.Float64,
    "low": pl.Float64,
    "close": pl.Float64,
    "volume": pl.Float64,
}


CHUNK_SIZE = 50_000


# ── Query builders ────────────────────────────────────────────────────────


def _build_where(symbol: str, date_range: dict | None) -> str:
    where = f"WHERE symbol = '{symbol}'"
    if date_range:
        if date_range.get("start"):
            where += f" AND timestamp >= '{date_range['start']}'"
        if date_range.get("end"):
            where += f" AND timestamp <= '{date_range['end']}'"
    return where


_SERVING = None


def _serving():
    """DuckDB over the lake, carrying every serving table as a view.

    Built once per process: the cost is a glob of the snapshot prefix plus one
    Iceberg catalog round trip.
    """
    global _SERVING
    if _SERVING is None:
        from lake.serving import connect

        _SERVING = connect()
    return _SERVING


def _build_sample_sql(symbol: str, interval: str, max_bars: int, date_range: dict | None) -> str:
    """Bars at `interval`, read from the lake through DuckDB.

    Where the lake already carries a pre-aggregated view for the timeframe, read
    THAT rather than re-aggregating — same rows, no work. Only an interval with
    no such view is recomputed, and then through lake.serving.resample_sql,
    which uses arg_min/arg_max on the timestamp because DuckDB's first()/last()
    are order-unspecified inside a group.
    """
    from lake.serving import TIMEFRAME_VIEW, resample_sql

    where = _build_where(symbol, date_range)
    limit = f" LIMIT {max_bars}" if max_bars > 0 else ""
    view = TIMEFRAME_VIEW.get(interval)
    if view:
        return (
            f"SELECT symbol, timestamp, open, high, low, close, volume "
            f"FROM {view} {where} ORDER BY timestamp{limit}"
        )
    return resample_sql("ohlcv", interval, where.removeprefix("WHERE ")) + limit


# ── Public entry point ────────────────────────────────────────────────────


def load_ohlcv_arrays(
    symbol: str,
    timeframe: str,
    max_bars: int = 0,
    date_range: dict | None = None,
) -> dict:
    """Load OHLCV from the lake into numpy arrays.

    Strategy:
      1. One DuckDB query over the lake, materialized straight into Polars
      2. Front-month volume-based stitching if no data for the exact symbol

    Returns dict::
        {"open": np.ndarray, "high": np.ndarray, "low": np.ndarray,
         "close": np.ndarray, "volume": np.ndarray, "timestamp": list[datetime]}
    """
    _validate_sql_input(symbol, "symbol")
    _validate_sql_input(timeframe, "timeframe", r"^[0-9]+[mhdw]$")
    max_bars = int(max_bars)
    if date_range:
        if date_range.get("start"):
            _validate_date(date_range["start"], "date_range.start")
        if date_range.get("end"):
            _validate_date(date_range["end"], "date_range.end")

    interval = timeframe
    sql = _build_sample_sql(symbol, interval, max_bars, date_range)

    emit_log(f"[data] Loading {symbol}@{timeframe} from the lake via DuckDB...")
    con = _serving()
    rows = con.execute(sql).fetchall()

    # Front-month stitching when the symbol names a root rather than a contract.
    if not rows and not re.match(r".+[FGHJKMNQUVXZ]\d{1,2}$", symbol):
        emit_log(f"[data] No exact match for '{symbol}', trying front-month stitching...")
        rows = _fetch_front_month_rows(con, symbol, interval, max_bars, date_range)

    if not rows:
        raise ValueError(f"No OHLCV data found for {symbol} at {timeframe}")

    emit_log(f"[data] Loaded {len(rows):,} rows from the lake")
    emit_progress(len(rows), len(rows), "loading_data")
    return _rows_to_arrays(rows)


def _rows_to_arrays(rows: list[tuple]) -> dict:
    """Convert PG-wire row tuples (sym, ts, o, h, l, c, v) to arrays dict."""
    n = len(rows)
    timestamps: list = []
    open_arr = np.empty(n, dtype=np.float64)
    high_arr = np.empty(n, dtype=np.float64)
    low_arr = np.empty(n, dtype=np.float64)
    close_arr = np.empty(n, dtype=np.float64)
    volume_arr = np.empty(n, dtype=np.float64)

    for i, row in enumerate(rows):
        timestamps.append(row[1])
        open_arr[i] = float(row[2])
        high_arr[i] = float(row[3])
        low_arr[i] = float(row[4])
        close_arr[i] = float(row[5])
        volume_arr[i] = float(row[6])

    return {
        "open": open_arr,
        "high": high_arr,
        "low": low_arr,
        "close": close_arr,
        "volume": volume_arr,
        "timestamp": timestamps,
    }


def _fetch_front_month_rows(con, root: str, interval: str, max_bars: int, date_range: dict | None) -> list[tuple]:
    """Front-month stitching: pick the highest-volume contract per day, read each from the lake."""
    time_filter = ""
    if date_range:
        if date_range.get("start"):
            time_filter += f" AND timestamp >= '{date_range['start']}'"
        if date_range.get("end"):
            time_filter += f" AND timestamp <= '{date_range['end']}'"

    daily_bars = con.execute(f"""
        SELECT symbol, time_bucket(INTERVAL '1 day', timestamp) AS timestamp,
               sum(volume) AS volume
        FROM ohlcv
        WHERE root = '{root}' AND asset_class = 'futures'
          AND symbol != '{root}'{time_filter}
        GROUP BY 1, 2
        ORDER BY timestamp
    """).fetchall()

    if not daily_bars:
        return []

    leaders: dict[str, tuple[str, float]] = {}
    for sym, ts, vol in daily_bars:
        day = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)[:10]
        v = float(vol) if vol else 0.0
        if day not in leaders or v > leaders[day][1]:
            leaders[day] = (sym, v)

    ranges: list[tuple[str, str, str]] = []
    current = None
    for day in sorted(leaders.keys()):
        sym = leaders[day][0]
        if current is None or current[0] != sym:
            if current:
                ranges.append(current)
            current = (sym, day, day)
        else:
            current = (current[0], current[1], day)
    if current:
        ranges.append(current)

    emit_log(f"[data] Front-month stitching: {len(ranges)} contracts, {len(leaders)} trading days")

    all_rows: list[tuple] = []
    total_contracts = len(ranges)

    for idx, (sym, start, end) in enumerate(ranges):
        s = f"{start}T00:00:00.000Z"
        e = f"{end}T23:59:59.999Z"

        sql = _build_sample_sql(
            sym, interval, 0, {"start": s, "end": e}
        )
        for row in con.execute(sql).fetchall():
            all_rows.append((
                sym, row[1],
                float(row[2]), float(row[3]),
                float(row[4]), float(row[5]),
                float(row[6] or 0.0),
            ))
        emit_progress(idx + 1, total_contracts, "loading_data")

    if not all_rows:
        return []

    all_rows.sort(key=lambda r: r[1])
    if max_bars > 0 and len(all_rows) > max_bars:
        all_rows = all_rows[:max_bars]
    return all_rows
