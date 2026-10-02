"""MNQ bars from the lake, back-adjusted at every contract roll.

The ``ohlcv_full_<timeframe>`` views carry the stitched root (``symbol = 'MNQ'``,
raw traded prices spliced at each roll) and every dated contract over the whole
history (2019-05 to 2025-12). The rich ``ohlcv_<timeframe>`` family is capped
(15m starts 2024-03), so this study reads the full family and finds the rolls
from its per-contract rows with ``cycle.rolls``.

Timestamps are epoch seconds of Pacific wall-clock digits stored as UTC (the
lake's futures convention), so ``hour`` below is the Pacific hour and a CME
session day is ``date(timestamp + 9 hours)``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
import pandas as pd

from cycle.rolls import Roll, back_adjust, find_rolls

FULL_VIEW = "ohlcv_full_{timeframe}"
_TIMEFRAME = re.compile(r"^[0-9]+[mhd]$")
_ROOT = re.compile(r"^[A-Z0-9]{1,6}$")


@dataclass
class Bars:
    frame: pd.DataFrame        # timestamp, open, high, low, close, volume (back-adjusted), raw_close, adjustment_points
    rolls: list[Roll]
    root: str
    timeframe: str


def session_dates(timestamps: np.ndarray) -> np.ndarray:
    """CME session day of each bar: a session opens at 15:00 Pacific and belongs
    to the next calendar day, so the day is the date of (timestamp + 9 hours).
    A bar that lands on a Saturday or Sunday that way is a coarse bar stamped at
    its start that contains Sunday's 15:00 open (a 4h bar stamped Sunday 12:00):
    it belongs to Monday's session."""
    days = pd.to_datetime(np.asarray(timestamps, dtype=np.int64) + 9 * 3600, unit="s").normalize()
    weekday = days.dayofweek.to_numpy()
    shift = np.where(weekday == 5, 2, np.where(weekday == 6, 1, 0))
    return (days + pd.to_timedelta(shift, unit="D")).values


def load_bars(connection, root: str, timeframe: str, start: str, end: str) -> Bars:
    if not _TIMEFRAME.match(timeframe):
        raise ValueError(f"unreadable timeframe {timeframe!r}")
    if not _ROOT.match(root):
        raise ValueError(f"unreadable root {root!r}")
    view = FULL_VIEW.format(timeframe=timeframe)
    frame = connection.execute(
        f"SELECT CAST(epoch(timestamp) AS BIGINT) AS timestamp, open, high, low, close, volume FROM {view} "
        "WHERE symbol = ? AND timestamp >= CAST(? AS TIMESTAMP) AND timestamp < CAST(? AS TIMESTAMP) "
        "AND close > 0 ORDER BY timestamp",
        [root, start, end],
    ).df()
    if frame.empty:
        raise ValueError(f"no {root} bars in {view} between {start} and {end}")
    frame = frame.drop_duplicates("timestamp").reset_index(drop=True)
    contract_rows = connection.execute(
        f"SELECT symbol, CAST(epoch(timestamp) AS BIGINT), close, volume FROM {view} "
        "WHERE symbol LIKE ? AND symbol <> ? AND symbol NOT LIKE '%-%' "
        "AND timestamp >= CAST(? AS TIMESTAMP) AND timestamp < CAST(? AS TIMESTAMP)",
        [f"{root}%", root, start, end],
    ).fetchall()
    rows = [(str(s), int(t), float(c), float(v or 0.0)) for s, t, c, v in contract_rows]
    timestamps = frame["timestamp"].to_numpy(np.int64)
    rolls = find_rolls(timestamps, frame["open"].to_numpy(float), frame["close"].to_numpy(float), rows)
    raw_close = frame["close"].to_numpy(float).copy()
    o, h, l, c, adjustment = back_adjust(
        frame["open"].to_numpy(float), frame["high"].to_numpy(float),
        frame["low"].to_numpy(float), frame["close"].to_numpy(float), rolls,
    )
    frame = frame.assign(open=o, high=h, low=l, close=c, raw_close=raw_close, adjustment_points=adjustment)
    frame["volume"] = frame["volume"].fillna(0.0).astype(float)
    return Bars(frame=frame, rolls=rolls, root=root, timeframe=timeframe)


_MONTHS = "FGHJKMNQUVXZ"


def contract_sort_key(symbol: str, root: str, first_seen_year: int | None = None) -> tuple[int, int]:
    """(year, month) of a contract code: MNQZ9 -> (2019, 12). A single year digit is read
    as the earliest year ending in that digit that is not before the year the contract
    first traded (a contract trades for at most about a year and a half before expiry).
    The first version assumed every contract was 2019 or later (MNQ's start), which sorted
    NQ's 2010-2018 contracts into the 2020s and stopped an NQ 2010-2019 rebuild at 2018-12-21."""
    code = symbol[len(root):]
    month = _MONTHS.index(code[0]) + 1
    digits = code[1:]
    if len(digits) == 2:
        return 2000 + int(digits), month
    anchor = first_seen_year if first_seen_year is not None else 2019
    year = anchor - anchor % 10 + int(digits)
    if year < anchor:
        year += 10
    return year, month


def load_minutes_rebuilt(connection, root: str, start: str, end: str, confirm_sessions: int = 2) -> Bars:
    """1-minute bars rebuilt from the contracts themselves, ONE contract per whole session.

    The stitched root picks its contract by same-day volume, so in thin 2019-2020
    MNQ it flips between two contracts inside a session thousands of times
    (4,833 switches on 1m), and some flips put a contract gap where the traded price
    barely moved (the round-1 rule review measured fake jumps of up to 115 ticks).
    Here the front contract is chosen per session: the contract that led daily volume
    on each of the previous ``confirm_sessions`` completed sessions (causal: today's
    choice never reads today's volume), never switching back to an earlier expiry.
    Rolls therefore happen only at session opens, and each is back-adjusted by the
    gap between the two contracts' closes on the last bar both traded before it."""
    if not _ROOT.match(root):
        raise ValueError(f"unreadable root {root!r}")
    rows = connection.execute(
        "SELECT symbol, CAST(epoch(timestamp) AS BIGINT) AS timestamp, open, high, low, close, volume FROM ohlcv_full_1m "
        "WHERE symbol LIKE ? AND symbol <> ? AND symbol NOT LIKE '%-%' AND close > 0 "
        "AND timestamp >= CAST(? AS TIMESTAMP) AND timestamp < CAST(? AS TIMESTAMP)",
        [f"{root}%", root, start, end],
    ).df()
    rows = rows[rows["symbol"].str.fullmatch(rf"{root}[{_MONTHS}]\d{{1,2}}")].copy()
    rows["session_date"] = session_dates(rows["timestamp"].to_numpy(np.int64))
    rows["volume"] = rows["volume"].fillna(0.0)
    first_seen = rows.groupby("symbol")["timestamp"].min()
    order = {s: contract_sort_key(s, root, int(pd.Timestamp(first_seen[s], unit="s").year)) for s in rows["symbol"].unique()}
    volume = rows.groupby(["session_date", "symbol"])["volume"].sum().reset_index()
    leaders = volume.sort_values(["session_date", "volume"], ascending=[True, False]).drop_duplicates("session_date")
    sessions = leaders["session_date"].to_numpy()
    leader = leaders["symbol"].to_numpy()
    chosen: list[str] = []
    current = leader[0]
    for k in range(len(sessions)):
        if k >= confirm_sessions:
            recent = leader[k - confirm_sessions:k]
            if (recent == recent[0]).all() and order[recent[0]] > order[current]:
                current = recent[0]
        chosen.append(current)
    front = pd.DataFrame({"session_date": sessions, "symbol": chosen})
    bars = rows.merge(front, on=["session_date", "symbol"]).sort_values("timestamp").drop_duplicates("timestamp")
    bars = bars.reset_index(drop=True)
    close_by = {(s, int(t)): float(c) for s, t, c in rows[["symbol", "timestamp", "close"]].itertuples(index=False)}
    symbols = bars["symbol"].to_numpy()
    stamps = bars["timestamp"].to_numpy(np.int64)
    rolls: list[Roll] = []
    for index in np.flatnonzero(symbols[1:] != symbols[:-1]) + 1:
        old, new = symbols[index - 1], symbols[index]
        gap, measured = None, int(stamps[index - 1])
        for back in range(1, min(240, index) + 1):          # the last minute both contracts traded, up to 4 hours back
            t = int(stamps[index - back])
            if (old, t) in close_by and (new, t) in close_by:
                gap, measured = close_by[(new, t)] - close_by[(old, t)], t
                break
        exact = gap is not None
        if gap is None:
            gap = float(bars["open"].iat[index]) - float(bars["close"].iat[index - 1])
        rolls.append(Roll(int(index), int(stamps[index]), str(old), str(new), float(gap), measured, exact))
    raw_close = bars["close"].to_numpy(float).copy()
    o, h, l, c, adjustment = back_adjust(bars["open"].to_numpy(float), bars["high"].to_numpy(float),
                                         bars["low"].to_numpy(float), bars["close"].to_numpy(float), rolls)
    frame = pd.DataFrame({"timestamp": stamps, "open": o, "high": h, "low": l, "close": c,
                          "volume": bars["volume"].to_numpy(float), "raw_close": raw_close,
                          "adjustment_points": adjustment, "contract": symbols})
    return Bars(frame=frame, rolls=rolls, root=root, timeframe="1m")


def aggregate(minutes: pd.DataFrame, timeframe_minutes: int) -> tuple[pd.DataFrame, np.ndarray]:
    """Bars of ``timeframe_minutes`` built from 1-minute bars, stamped at their start
    (the lake's convention), and for every minute the index of the bar it belongs to.
    Buckets are aligned to the epoch, which on Pacific wall-clock stamps puts every
    15m/30m/1h boundary on the 15:00 session open."""
    stamps = minutes["timestamp"].to_numpy(np.int64)
    bucket = stamps // (60 * timeframe_minutes) * (60 * timeframe_minutes)
    starts = np.flatnonzero(np.r_[True, bucket[1:] != bucket[:-1]])
    ends = np.r_[starts[1:], stamps.size]
    group = np.repeat(np.arange(starts.size), ends - starts)
    frame = pd.DataFrame({
        "timestamp": bucket[starts],
        "open": minutes["open"].to_numpy(float)[starts],
        "high": np.maximum.reduceat(minutes["high"].to_numpy(float), starts),
        "low": np.minimum.reduceat(minutes["low"].to_numpy(float), starts),
        "close": minutes["close"].to_numpy(float)[ends - 1],
        "volume": np.add.reduceat(minutes["volume"].to_numpy(float), starts),
        "last_minute_index": ends - 1,
    })
    return frame, group


SESSION_OPEN_SECONDS = 15 * 3600      # CME equity futures open at 15:00 Pacific (the stamps are Pacific wall clock)


def aggregate_session_anchored(minutes: pd.DataFrame, timeframe: str) -> tuple[pd.DataFrame, np.ndarray]:
    """Bars anchored at the 15:00 session open, for timeframes whose epoch buckets would
    straddle it: ``4h`` (15:00-19:00, 19:00-23:00, ... so no bar spans the 13:00 RTH close,
    the 14:00 break and the 15:00 open at once), ``session`` (one bar per CME session, the
    session day from ``session_dates``) and ``week`` (Monday-Friday sessions).
    Returns (bars stamped at their first minute, with ``end_timestamp`` = the last minute + 60 s,
    and the bar index of every minute)."""
    stamps = minutes["timestamp"].to_numpy(np.int64)
    if timeframe == "4h":
        key = (stamps - SESSION_OPEN_SECONDS) // (4 * 3600)
    elif timeframe == "session":
        key = session_dates(stamps).astype("datetime64[D]").astype(np.int64)
    elif timeframe == "week":
        days = pd.DatetimeIndex(session_dates(stamps))
        key = (days - pd.to_timedelta(days.dayofweek, unit="D")).values.astype("datetime64[D]").astype(np.int64)
    else:
        raise ValueError(f"anchored timeframe must be 4h, session or week, got {timeframe!r}")
    starts = np.flatnonzero(np.r_[True, key[1:] != key[:-1]])
    ends = np.r_[starts[1:], stamps.size]
    group = np.repeat(np.arange(starts.size), ends - starts)
    frame = pd.DataFrame({
        "timestamp": stamps[starts],
        "end_timestamp": stamps[ends - 1] + 60,
        "open": minutes["open"].to_numpy(float)[starts],
        "high": np.maximum.reduceat(minutes["high"].to_numpy(float), starts),
        "low": np.minimum.reduceat(minutes["low"].to_numpy(float), starts),
        "close": minutes["close"].to_numpy(float)[ends - 1],
        "volume": np.add.reduceat(minutes["volume"].to_numpy(float), starts),
        "last_minute_index": ends - 1,
    })
    return frame, group


def effective_roll_timestamps(rolls: list[Roll]) -> np.ndarray:
    """Timestamps where a position would really have to roll: the first bar a
    contract never seen before becomes the source. In 2019-2020 the thin
    stitched root flips back and forth between two contracts for days (the
    back-adjustment handles each flip exactly); those returns to an older
    contract are not rolls a trader pays for."""
    seen: set[str] = set()
    out: list[int] = []
    for roll in rolls:
        seen.add(roll.from_contract)
        if roll.to_contract not in seen:
            out.append(roll.timestamp)
            seen.add(roll.to_contract)
    return np.asarray(out, dtype=np.int64)


def roll_table(bars: Bars) -> pd.DataFrame:
    effective = set(effective_roll_timestamps(bars.rolls).tolist())
    return pd.DataFrame(
        [
            {
                "timeframe": bars.timeframe,
                "roll_timestamp": pd.Timestamp(r.timestamp, unit="s"),
                "from_contract": r.from_contract,
                "to_contract": r.to_contract,
                "gap_points": r.gap_points,
                "gap_measured_on_common_bar": r.exact,
                "charged_as_roll": r.timestamp in effective,
            }
            for r in bars.rolls
        ]
    )
