"""
QuestDB OHLCV data loading — shared across all ML model packages.

Loads OHLCV data from QuestDB via PG wire protocol (psycopg2).
Supports exact symbol match and front-month stitching for base symbols.
"""

import os
import re

import pyarrow as pa

from .protocol import emit_log


# ── SQL Input Validation ────────────────────────────────────────────────────

def _validate_sql_input(value, name, pattern=r'^[A-Za-z0-9_\-/]+$'):
    """Validate input before SQL interpolation to prevent injection."""
    if not isinstance(value, str) or not re.match(pattern, value):
        raise ValueError(f"Invalid {name}: {value!r}")
    return value


def _validate_date(value, name):
    """Validate date string is ISO format before SQL interpolation."""
    if not isinstance(value, str) or not re.match(r'^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$', value):
        raise ValueError(f"Invalid {name}: {value!r}")
    return value


# ── OHLCV Loading ───────────────────────────────────────────────────────────

def load_ohlcv_from_questdb(symbol, timeframe, max_bars=0, date_range=None):
    """Load OHLCV data from QuestDB via PG wire protocol. Returns pyarrow Table.

    For base symbols (MNQ, ES, NQ, etc.) performs front-month stitching:
    picks the highest-volume contract per day, then queries each contract
    in its front-month date range. Matches the chart API behavior exactly.
    """
    import psycopg2

    # Validate inputs before any SQL interpolation
    _validate_sql_input(symbol, "symbol")
    _validate_sql_input(timeframe, "timeframe", r'^[0-9]+[mhdw]$')
    max_bars = int(max_bars)
    if date_range:
        if date_range.get("start"):
            _validate_date(date_range["start"], "date_range.start")
        if date_range.get("end"):
            _validate_date(date_range["end"], "date_range.end")

    host = os.environ.get("QUESTDB_HOST", "localhost")
    port = int(os.environ.get("QUESTDB_PG_PORT", "8812"))
    user = os.environ.get("QUESTDB_USER", "admin")
    password = os.environ.get("QUESTDB_PASSWORD", "quest")
    interval = timeframe if timeframe != "1w" else "7d"

    conn = psycopg2.connect(
        host=host, port=port, user=user, password=password, database="qdb"
    )
    try:
        cur = conn.cursor()

        # Try exact symbol match first (handles individual contracts like MNQH5)
        rows, col_names = _query_single_symbol(cur, symbol, interval, max_bars, date_range)

        # If no data and symbol looks like a base/root (no month+year suffix),
        # try front-month stitching across individual contracts
        if not rows and not re.match(r'.+[FGHJKMNQUVXZ]\d{1,2}$', symbol):
            emit_log(f"No exact match for '{symbol}', trying front-month stitching...")
            rows, col_names = _query_front_month(cur, symbol, interval, max_bars, date_range)

        cur.close()
    finally:
        conn.close()

    if not rows:
        raise ValueError(f"No OHLCV data found for {symbol} at {timeframe}")

    # Build pyarrow Table
    arrays = {}
    for i, col in enumerate(col_names):
        arrays[col] = [row[i] for row in rows]
    return pa.table(arrays)


def _query_single_symbol(cur, symbol, interval, max_bars, date_range):
    """Query OHLCV for a specific symbol with SAMPLE BY."""
    where = f"WHERE symbol = '{symbol}'"
    if date_range:
        if date_range.get("start"):
            where += f" AND timestamp >= '{date_range['start']}'"
        if date_range.get("end"):
            where += f" AND timestamp <= '{date_range['end']}'"

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
    cur.execute(sql)
    rows = cur.fetchall()
    col_names = [desc[0] for desc in cur.description] if cur.description else []
    return rows, col_names


def _query_front_month(cur, root, interval, max_bars, date_range):
    """Front-month stitching: pick highest-volume contract per day, query each."""
    contract_regex = f'^{re.escape(root)}[FGHJKMNQUVXZ][0-9]{{1,2}}$'

    time_filter = ""
    if date_range:
        if date_range.get("start"):
            time_filter += f" AND timestamp >= '{date_range['start']}'"
        if date_range.get("end"):
            time_filter += f" AND timestamp <= '{date_range['end']}'"

    # Step 1: Daily volume per contract from materialized view
    cur.execute(f"""
        SELECT symbol, timestamp, volume FROM ohlcv_1d
        WHERE symbol ~ '{contract_regex}'{time_filter}
        ORDER BY timestamp
    """)
    daily_bars = cur.fetchall()

    if not daily_bars:
        return [], []

    # Step 2: Pick highest-volume contract per day (= front month)
    leaders = {}
    for sym, ts, vol in daily_bars:
        day = ts.strftime('%Y-%m-%d') if hasattr(ts, 'strftime') else str(ts)[:10]
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
    col_names = None

    for sym, start, end in ranges:
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
        rows = cur.fetchall()
        if col_names is None and cur.description:
            col_names = [desc[0] for desc in cur.description]
        all_rows.extend(rows)

    if not all_rows:
        return [], col_names or []

    # Sort by timestamp and limit
    all_rows.sort(key=lambda r: r[1])
    if max_bars > 0 and len(all_rows) > max_bars:
        all_rows = all_rows[:max_bars]

    return all_rows, col_names
