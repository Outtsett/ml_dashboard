"""
QuestDB OHLCV data loading — shared across all ML model packages.

Loads OHLCV data from QuestDB via PG wire protocol (psycopg2).
Returns numpy arrays directly — no PyArrow intermediate.
Supports exact symbol match and front-month stitching for base symbols.
"""

import os
import re

import numpy as np

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

        # If no data and symbol looks like a base/root, try front-month stitching
        if not rows and not re.match(r".+[FGHJKMNQUVXZ]\d{1,2}$", symbol):
            emit_log(f"No exact match for '{symbol}', trying front-month stitching...")
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
    """Fetch OHLCV rows for a single symbol with chunked cursor + progress."""
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

    # Count first for progress reporting
    # QuestDB SAMPLE BY requires an aggregation function in SELECT — use count()
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
        total_rows = -1  # Unknown — still proceed
        conn.rollback()  # Reset connection state after failed query (psycopg2 requirement)
    cur.close()

    if total_rows == 0:
        return []

    if total_rows > 0:
        emit_log(f"Fetching {total_rows} bars...")
    else:
        emit_log("Fetching bars (count unknown)...")

    # Use regular cursor — QuestDB PG wire doesn't support DECLARE CURSOR
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


def _fetch_front_month_rows(conn, root, interval, max_bars, date_range):
    """Front-month stitching: pick highest-volume contract per day, query each."""
    contract_regex = f"^{re.escape(root)}[FGHJKMNQUVXZ][0-9]{{1,2}}$"

    time_filter = ""
    if date_range:
        if date_range.get("start"):
            time_filter += f" AND timestamp >= '{date_range['start']}'"
        if date_range.get("end"):
            time_filter += f" AND timestamp <= '{date_range['end']}'"

    cur = conn.cursor()

    # Step 1: Daily volume per contract from materialized view
    cur.execute(f"""
        SELECT symbol, timestamp, volume FROM ohlcv_1d
        WHERE symbol ~ '{contract_regex}'{time_filter}
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
