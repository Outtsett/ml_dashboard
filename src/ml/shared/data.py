"""
QuestDB OHLCV data loading — shared across all ML model packages.

Default path is HTTP /exp (CSV stream parsed by Polars — multi-threaded, ~5x
faster than the stdlib csv module). Falls back to PG wire (psycopg2 chunked
cursor) when HTTP fails. Returns numpy arrays directly — no PyArrow.

Public entry points:
  - load_ohlcv_arrays(symbol, timeframe, max_bars=0, date_range=None)
  - load_ohlcv_from_questdb(...)  (back-compat alias)
  - load_ohlcv_arrays_fast(...)   (legacy; now identical to load_ohlcv_arrays)
"""

from __future__ import annotations

import io
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime
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


def _connect():
    """Refuse, loudly. QuestDB was emptied on 2026-09-10.

    Kept as a named failure rather than deleted because a caller that still
    reaches for PG wire should be told where the data went, not handed an open
    connection to an empty database that answers every query with zero rows.
    """
    raise RuntimeError(
        "QuestDB was emptied on 2026-09-10; this module now reads the lake "
        "through lake.serving.connect(). If you need the old serving database "
        "back, replay meta/questdb_schema/questdb_schema_latest.sql and load "
        "derived/recipe=questdb_full_2026-09-09/."
    )


def _connect_questdb_disabled():
    """The original PG-wire connector, unreferenced. Kept for the restore path."""
    import psycopg2

    return psycopg2.connect(
        host=os.environ.get("QUESTDB_HOST", "127.0.0.1"),
        port=int(os.environ.get("QUESTDB_PG_PORT", "8812")),
        user=os.environ.get("QUESTDB_USER", "admin"),
        password=os.environ.get("QUESTDB_PASSWORD", "quest"),
        database="qdb",
    )


def _http_url(sql: str) -> str:
    host = os.environ.get("QUESTDB_HOST", "127.0.0.1")
    port = os.environ.get("QUESTDB_HTTP_PORT", "9000")
    return f"http://{host}:{port}/exp?query={urllib.parse.quote(sql)}"


# ── HTTP /exp loader (Polars CSV parser) ──────────────────────────────────


_OHLCV_SCHEMA: dict[str, Any] = {
    "symbol": pl.Utf8,
    "timestamp": pl.Datetime("us"),
    "open": pl.Float64,
    "high": pl.Float64,
    "low": pl.Float64,
    "close": pl.Float64,
    "volume": pl.Float64,
}


def _fetch_csv_bytes(sql: str, *, timeout: int = 300) -> bytes | None:
    """Run SQL via QuestDB's HTTP /exp endpoint and return raw CSV bytes.

    Schema-agnostic — used both by the OHLCV-specific parser below and by
    ``dataset.py``'s generic ``questdb_table`` loader. Returns None on any
    failure (network error or empty body) so the caller can fall back
    (PG wire for OHLCV; a raised error for the generic loader).
    """
    url = _http_url(sql)
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            csv_bytes = resp.read()
    except Exception as exc:
        emit_log(f"[data] HTTP /exp request failed: {exc}", level="warning")
        return None

    if not csv_bytes:
        return None
    return csv_bytes


def _http_csv_to_arrays(sql: str, *, expect_symbol: bool = True) -> dict[str, Any] | None:
    """Run SQL via HTTP /exp, parse CSV with Polars, return arrays dict.

    Returns None on any failure so caller can fall back to PG wire.
    """
    csv_bytes = _fetch_csv_bytes(sql)
    if not csv_bytes:
        return None

    try:
        # Polars infers types fast; we override numerics + timestamp for stability.
        df = pl.read_csv(
            io.BytesIO(csv_bytes),
            try_parse_dates=True,
            schema_overrides={k: v for k, v in _OHLCV_SCHEMA.items()
                              if k != "symbol" or expect_symbol},
        )
    except Exception as exc:
        emit_log(f"[data] Polars CSV parse failed: {exc}", level="warning")
        return None

    if df.height == 0:
        return None

    # Polars doesn't return Python datetimes by default — convert via ns→sec
    ts_series = df["timestamp"]
    if ts_series.dtype == pl.Datetime:
        # epoch microseconds -> Python datetime list (cheap; one allocation)
        timestamps = ts_series.dt.replace_time_zone(None).to_list()
    else:
        # already string ISO; parse via numpy datetime64
        ts_arr = np.asarray(ts_series.to_list())
        timestamps = [datetime.fromisoformat(str(x).replace("Z", "+00:00")) for x in ts_arr]

    open_arr = df["open"].to_numpy().astype(np.float64)
    high_arr = df["high"].to_numpy().astype(np.float64)
    low_arr = df["low"].to_numpy().astype(np.float64)
    close_arr = df["close"].to_numpy().astype(np.float64)
    volume_arr = df["volume"].to_numpy().astype(np.float64)

    n = open_arr.shape[0]
    emit_progress(n, n, "loading_data")

    return {
        "open": open_arr,
        "high": high_arr,
        "low": low_arr,
        "close": close_arr,
        "volume": volume_arr,
        "timestamp": timestamps,
        "n_rows": n,
    }


# ── PG wire fallback (chunked) ────────────────────────────────────────────


CHUNK_SIZE = 50_000


def _pg_fetch(conn, sql: str, total_hint: int = -1) -> list[tuple]:
    """Chunked PG-wire fetch — used only when HTTP /exp fails."""
    cur = conn.cursor()
    cur.execute(sql)
    rows: list[tuple] = []
    loaded = 0
    while True:
        chunk = cur.fetchmany(CHUNK_SIZE)
        if not chunk:
            break
        rows.extend(chunk)
        loaded += len(chunk)
        emit_progress(loaded, total_hint if total_hint > 0 else loaded, "loading_data")
    cur.close()
    return rows


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
    """DuckDB over the lake, carrying the former QuestDB tables as views.

    QuestDB was emptied on 2026-09-10 after every table was copied to parquet in
    the lake and row-count verified. Built once per process: the cost is a glob
    of the snapshot prefix plus one Iceberg catalog round trip.
    """
    global _SERVING
    if _SERVING is None:
        from lake.serving import connect

        _SERVING = connect()
    return _SERVING


def _build_sample_sql(symbol: str, interval: str, max_bars: int, date_range: dict | None) -> str:
    """Bars at `interval`, read from the lake through DuckDB.

    Where QuestDB kept a materialized view for the timeframe, read THAT rather
    than re-aggregating: it is the same rows QuestDB's SAMPLE BY returned, and
    it was copied into the snapshot with everything else. Only an interval with
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
    """Load OHLCV from QuestDB into numpy arrays.

    Strategy:
      1. HTTP /exp + Polars CSV parser (default, fastest)
      2. PG wire chunked fallback if HTTP fails
      3. Front-month volume-based stitching if no data for the exact symbol

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


def _drop_meta(result: dict) -> dict:
    out = {k: v for k, v in result.items() if k != "n_rows"}
    return out


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


# ── Backward-compatible aliases ───────────────────────────────────────────


def load_ohlcv_from_questdb(symbol, timeframe, max_bars=0, date_range=None):
    """Back-compat alias used by all model main.py files."""
    return load_ohlcv_arrays(symbol, timeframe, max_bars, date_range)


def load_ohlcv_arrays_fast(symbol, timeframe, max_bars=0, date_range=None):
    """Legacy alias — now identical to load_ohlcv_arrays (HTTP /exp is the default path)."""
    return load_ohlcv_arrays(symbol, timeframe, max_bars, date_range)
