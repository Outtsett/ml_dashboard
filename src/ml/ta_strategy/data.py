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
