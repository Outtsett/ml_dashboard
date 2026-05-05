"""
QuestDB OHLCV data loading — shared across all ML model packages.

Loads OHLCV data from QuestDB via PG wire protocol (psycopg2).
Returns numpy arrays directly — no PyArrow intermediate.
Supports exact symbol match and front-month stitching for base symbols.
"""

import os
import re
import io
import urllib.request
import urllib.parse
from datetime import datetime

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


# ── Connection helper ──────────────────────────────────────────────────────


def _connect():
    """Create psycopg2 connection to QuestDB PG wire."""
    import psycopg2

    return psycopg2.connect(
        host=os.environ.get("QUESTDB_HOST", "127.0.0.1"),
        port=int(os.environ.get("QUESTDB_PG_PORT", "8812")),
        user=os.environ.get("QUESTDB_USER", "admin"),
        password=os.environ.get("QUESTDB_PASSWORD", "quest"),
        database="qdb",
    )


# ── Fast CSV loading via QuestDB HTTP /exp endpoint ───────────────────────


def _load_via_http(sql, total_hint=0):
    """Load query results via QuestDB HTTP /exp (CSV stream) — faster than PG wire for large results."""
    import io
    import urllib.request
    import urllib.parse

    host = os.environ.get("QUESTDB_HOST", "127.0.0.1")
    port = os.environ.get("QUESTDB_HTTP_PORT", "9000")
    url = f"http://{host}:{port}/exp?query={urllib.parse.quote(sql)}"

    emit_log("Loading via HTTP /exp (CSV stream)...")
    with urllib.request.urlopen(url, timeout=300) as resp:
        csv_bytes = resp.read()

    # Parse CSV with numpy (much faster than row-by-row psycopg2)
    import csv
    reader = csv.reader(io.StringIO(csv_bytes.decode("utf-8")))
    header = next(reader)

    rows = list(reader)
    n = len(rows)
    if n == 0:
        return []

    emit_log(f"Loaded {n:,} rows via HTTP CSV")
    emit_progress(n, n, "loading_data")

    # Convert to tuples matching psycopg2 format: (symbol, timestamp, open, high, low, close, volume)
    sym_idx = header.index("symbol")
    ts_idx = header.index("timestamp")
    o_idx = header.index("open")
    h_idx = header.index("high")
    l_idx = header.index("low")
    c_idx = header.index("close")
    v_idx = header.index("volume")

    from datetime import datetime
    result = []
    for row in rows:
        ts = datetime.fromisoformat(row[ts_idx].replace("Z", "+00:00"))
        result.append((row[sym_idx], ts, float(row[o_idx]), float(row[h_idx]),
                       float(row[l_idx]), float(row[c_idx]), float(row[v_idx])))
    return result


# ── OHLCV Loading (numpy arrays, no PyArrow) ──────────────────────────────

CHUNK_SIZE = 50_000


def load_ohlcv_arrays(symbol, timeframe, max_bars=0, date_range=None):
    """Load OHLCV from QuestDB directly into numpy arrays. No PyArrow.

    Uses server-side cursor with chunked fetching. Emits progress events
    during loading so the UI stays responsive.

    Returns dict: {
        'open': np.ndarray, 'high': np.ndarray, 'low': np.ndarray,
        'close': np.ndarray, 'volume': np.ndarray, 'timestamp': list
    }
    """
    _validate_sql_input(symbol, "symbol")
    _validate_sql_input(timeframe, "timeframe", r"^[0-9]+[mhdw]$")
    max_bars = int(max_bars)
    if date_range:
        if date_range.get("start"):
            _validate_date(date_range["start"], "date_range.start")
        if date_range.get("end"):
            _validate_date(date_range["end"], "date_range.end")

    interval = timeframe if timeframe != "1w" else "7d"

    conn = _connect()
    try:
        # Try exact symbol match first
        rows = _fetch_rows(conn, symbol, interval, max_bars, date_range)

        # If no data and symbol looks like a base/root, try rollover stitching
        if not rows and not re.match(r".+[FGHJKMNQUVXZ]\d{1,2}$", symbol):
            emit_log(f"No exact match for '{symbol}', trying rollover stitching...")
            rows = _fetch_stitched_rows(conn, symbol, interval, max_bars, date_range)
            # Fall back to volume-based if no rollover data
            if not rows:
                emit_log("No rollover data, falling back to volume-based stitching...")
                rows = _fetch_front_month_rows(conn, symbol, interval, max_bars, date_range)
    finally:
        conn.close()

    if not rows:
        raise ValueError(f"No OHLCV data found for {symbol} at {timeframe}")

    # Convert rows to numpy arrays in one pass
    n = len(rows)
    timestamps = []
    open_arr = np.empty(n, dtype=np.float64)
    high_arr = np.empty(n, dtype=np.float64)
    low_arr = np.empty(n, dtype=np.float64)
    close_arr = np.empty(n, dtype=np.float64)
    volume_arr = np.empty(n, dtype=np.float64)

    for i, row in enumerate(rows):
        # row: (symbol, timestamp, open, high, low, close, volume)
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


def _build_where(symbol, date_range):
    """Build WHERE clause for OHLCV query."""
    where = f"WHERE symbol = '{symbol}'"
    if date_range:
        if date_range.get("start"):
            where += f" AND timestamp >= '{date_range['start']}'"
        if date_range.get("end"):
            where += f" AND timestamp <= '{date_range['end']}'"
    return where


def _fetch_rows(conn, symbol, interval, max_bars, date_range):
    """Fetch OHLCV rows — tries HTTP CSV for speed, falls back to PG wire."""
    where = _build_where(symbol, date_range)
    limit_clause = f"LIMIT {max_bars}" if max_bars > 0 else ""

    sql = f"""
        SELECT symbol, timestamp,
            first(open) as open, max(high) as high,
            min(low) as low, last(close) as close,
            sum(volume) as volume
        FROM ohlcv
        {where}
        SAMPLE BY {interval} ALIGN TO CALENDAR
        ORDER BY timestamp
        {limit_clause}
    """

    # Try HTTP /exp first (faster for large results — no row-by-row parsing)
    try:
        rows = _load_via_http(sql)
        if rows:
            return rows
    except Exception as e:
        emit_log(f"HTTP /exp failed ({e}), falling back to PG wire...")

    # Fallback: PG wire with chunked fetch
    count_sql = f"""
        SELECT count() FROM (
            SELECT first(open) FROM ohlcv {where}
            SAMPLE BY {interval} ALIGN TO CALENDAR
            {limit_clause}
        )
    """
    cur = conn.cursor()
    try:
        cur.execute(count_sql)
        total_rows = int(cur.fetchone()[0])
    except Exception as e:
        emit_log(f"Count pre-query failed ({e}), will attempt data fetch anyway...")
        total_rows = -1
        conn.rollback()
    cur.close()

    if total_rows == 0:
        return []

    if total_rows > 0:
        emit_log(f"Fetching {total_rows} bars via PG wire...")
    else:
        emit_log("Fetching bars (count unknown)...")

    cur = conn.cursor()
    cur.execute(sql)

    rows = []
    loaded = 0
    while True:
        chunk = cur.fetchmany(CHUNK_SIZE)
        if not chunk:
            break
        rows.extend(chunk)
        loaded += len(chunk)
        emit_progress(loaded, total_rows if total_rows > 0 else loaded, "loading_data")

    cur.close()
    return rows


def _fetch_stitched_rows(conn, root, interval, max_bars, date_range):
    """DEPRECATED: rollovers table has been dropped from QuestDB.

    Always returns [] so the caller falls through to _fetch_front_month_rows()
    which detects front-month contracts via volume from the base ohlcv table.
    """
    emit_log("Rollovers table no longer exists, skipping rollover stitching...")
    return []


def _fetch_front_month_rows(conn, root, interval, max_bars, date_range):
    """Front-month stitching: pick highest-volume contract per day, query each."""
    time_filter = ""
    if date_range:
        if date_range.get("start"):
            time_filter += f" AND timestamp >= '{date_range['start']}'"
        if date_range.get("end"):
            time_filter += f" AND timestamp <= '{date_range['end']}'"

    cur = conn.cursor()

    # Step 1: Daily volume per contract via SAMPLE BY on base table
    cur.execute(f"""
        SELECT symbol, timestamp, sum(volume) as volume FROM ohlcv
        WHERE root = '{root}' AND asset_class = 'futures'
        AND symbol != '{root}'{time_filter}
        SAMPLE BY 1d ALIGN TO CALENDAR
        ORDER BY timestamp
    """)
    daily_bars = cur.fetchall()

    if not daily_bars:
        cur.close()
        return []

    # Step 2: Pick highest-volume contract per day (= front month)
    leaders = {}
    for sym, ts, vol in daily_bars:
        day = ts.strftime("%Y-%m-%d") if hasattr(ts, "strftime") else str(ts)[:10]
        v = float(vol) if vol else 0
        if day not in leaders or v > leaders[day][1]:
            leaders[day] = (sym, v)

    # Step 3: Build contiguous date ranges per front-month contract
    ranges = []
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

    emit_log(f"Front-month stitching: {len(ranges)} contracts, {len(leaders)} trading days")

    # Step 4: Query each contract in its front-month range
    all_rows = []
    total_contracts = len(ranges)

    for idx, (sym, start, end) in enumerate(ranges):
        s = f"{start}T00:00:00.000Z"
        e = f"{end}T23:59:59.999Z"

        cur.execute(f"""
            SELECT '{sym}' as symbol, timestamp,
                first(open) as open, max(high) as high,
                min(low) as low, last(close) as close,
                sum(volume) as volume
            FROM ohlcv
            WHERE symbol = '{sym}' AND timestamp >= '{s}' AND timestamp <= '{e}'
            SAMPLE BY {interval} ALIGN TO CALENDAR
            ORDER BY timestamp
        """)
        all_rows.extend(cur.fetchall())
        emit_progress(idx + 1, total_contracts, "loading_data")

    cur.close()

    if not all_rows:
        return []

    # Sort by timestamp and limit
    all_rows.sort(key=lambda r: r[1])
    if max_bars > 0 and len(all_rows) > max_bars:
        all_rows = all_rows[:max_bars]

    return all_rows


# ── Backward-compatible wrapper ────────────────────────────────────────────


def load_ohlcv_from_questdb(symbol, timeframe, max_bars=0, date_range=None):
    """Load OHLCV data from QuestDB. Returns dict of numpy arrays.

    This is the backward-compatible entry point used by all model main.py files.
    """
    return load_ohlcv_arrays(symbol, timeframe, max_bars, date_range)

def load_ohlcv_arrays_fast(symbol, timeframe, max_bars=0):
    """
    Institutional-Grade HTTP fetcher. 
    Bypasses row-by-row PG protocol for 10x faster bulk data loading.
    """
    import requests
    import pandas as pd
    import io
    
    host = os.environ.get("QUESTDB_HOST", "localhost")
    port = os.environ.get("QUESTDB_HTTP_PORT", "9000")
    
    where = f"WHERE symbol = '{symbol}'"
    limit = f"LIMIT {max_bars}" if max_bars > 0 else ""
    
    sql = f"SELECT timestamp, open, high, low, close, volume FROM ohlcv {where} SAMPLE BY {timeframe} ALIGN TO CALENDAR {limit}"
    url = f"http://{host}:{port}/exp?query={requests.utils.quote(sql)}"
    
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text), parse_dates=['timestamp'])
        
        return {
            "timestamp": df['timestamp'].values,
            "open": df['open'].values.astype(np.float64),
            "high": df['high'].values.astype(np.float64),
            "low": df['low'].values.astype(np.float64),
            "close": df['close'].values.astype(np.float64),
            "volume": df['volume'].values.astype(np.float64),
        }
    except Exception as e:
        print(f"[QuestDB-Fast] HTTP fetch failed, falling back to PG: {e}")
        return load_ohlcv_arrays(symbol, timeframe, max_bars)
