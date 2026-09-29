"""MNQ minutes and 5-minute decision bars for the development period.

Minutes come from ``ta_strategy.data.load_minutes_rebuilt``: one contract per
whole session (chosen causally from the two previous sessions' volume),
back-adjusted additively at every roll, so a roll is never a move. Timestamps
are epoch SECONDS of Pacific wall-clock digits stored as UTC (the lake's futures
convention): minute-of-day below is the Pacific clock.

Trading happens in the regular session (RTH, 06:30-13:00 Pacific). A decision is
taken at the close of each 5-minute RTH bar whose close is at or before
``LAST_DECISION_MINUTE`` (12:00), and fills at the next minute's open; every
position is flat by the close of the last RTH minute (12:59).

Every loader here passes its timestamps through ``holdout.guard``.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from multimodal import holdout

RTH_OPEN_MINUTE = 6 * 60 + 30      # 06:30 Pacific
RTH_CLOSE_MINUTE = 13 * 60         # 13:00 Pacific (the last RTH minute bar starts 12:59)
FIRST_DECISION_MINUTE = 6 * 60 + 35
LAST_DECISION_MINUTE = 12 * 60
DECISION_MINUTES = 5
ATR_BARS = 20
SESSION_OFFSET_SECONDS = 9 * 3600  # CME session day = date(stamp + 9 h)


@dataclass
class Minutes:
    timestamp: np.ndarray   # epoch seconds, Pacific stamp, bar start
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    session: np.ndarray     # CME session day (int days since epoch)
    contract: np.ndarray


def minute_of_day(timestamps: np.ndarray) -> np.ndarray:
    return (np.asarray(timestamps, dtype=np.int64) % 86400) // 60


def session_days(timestamps: np.ndarray) -> np.ndarray:
    """CME session day as days since the epoch (a session opens 15:00 Pacific, belongs to the next date)."""
    return (np.asarray(timestamps, dtype=np.int64) + SESSION_OFFSET_SECONDS) // 86400


def load_minutes(start: str, end: str, root: str = "MNQ", connection=None) -> Minutes:
    """Back-adjusted minutes for [start, end) — refused if any falls in a locked period."""
    from ta_strategy.data import load_minutes_rebuilt

    if connection is None:
        from lake.serving import connect

        connection = connect(with_bars=False, with_derived=False)
    bars = load_minutes_rebuilt(connection, root, start, end)
    frame = bars.frame
    stamps = frame["timestamp"].to_numpy(np.int64)
    holdout.guard(stamps * 1000, what=f"{root} minutes {start}..{end}")
    return Minutes(
        timestamp=stamps,
        open=frame["open"].to_numpy(float),
        high=frame["high"].to_numpy(float),
        low=frame["low"].to_numpy(float),
        close=frame["close"].to_numpy(float),
        volume=frame["volume"].to_numpy(float),
        session=session_days(stamps),
        contract=frame["contract"].to_numpy(str),
    )


def rth_mask(timestamps: np.ndarray) -> np.ndarray:
    minute = minute_of_day(timestamps)
    return (minute >= RTH_OPEN_MINUTE) & (minute < RTH_CLOSE_MINUTE)


@dataclass
class DecisionBars:
    """5-minute RTH bars built from the minutes, stamped at their start."""

    frame: pd.DataFrame      # timestamp, open, high, low, close, volume, session, last_minute, atr_points, is_decision
    minutes: Minutes          # the RTH minutes the bars index into


def decision_bars(minutes: Minutes) -> DecisionBars:
    """5-minute RTH bars, their causal ATR, and which of them are decision points.

    ATR is the mean true range of the last ``ATR_BARS`` completed RTH 5-minute
    bars (the bar itself included: the decision is taken at its close), carried
    across sessions so the first bars of a day have a value; the true range of a
    session's first bar includes the gap from the previous RTH close. The first
    ``ATR_BARS - 1`` bars have no ATR (NaN, never zero).
    """
    keep = rth_mask(minutes.timestamp)
    m = Minutes(*(getattr(minutes, name)[keep] for name in Minutes.__dataclass_fields__))
    bucket = m.timestamp // (60 * DECISION_MINUTES) * (60 * DECISION_MINUTES)
    starts = np.flatnonzero(np.r_[True, bucket[1:] != bucket[:-1]])
    ends = np.r_[starts[1:], bucket.size]
    frame = pd.DataFrame({
        "timestamp": bucket[starts],
        "open": m.open[starts],
        "high": np.maximum.reduceat(m.high, starts),
        "low": np.minimum.reduceat(m.low, starts),
        "close": m.close[ends - 1],
        "volume": np.add.reduceat(m.volume, starts),
        "session": m.session[starts],
        "first_minute": starts,
        "last_minute": ends - 1,
    })
    previous_close = np.r_[np.nan, frame["close"].to_numpy()[:-1]]
    high, low = frame["high"].to_numpy(), frame["low"].to_numpy()
    true_range = np.where(
        np.isnan(previous_close), high - low,
        np.maximum(high, previous_close) - np.minimum(low, previous_close),
    )
    atr = pd.Series(true_range).rolling(ATR_BARS, min_periods=ATR_BARS).mean().to_numpy()
    close_minute = minute_of_day(frame["timestamp"].to_numpy()) + DECISION_MINUTES
    frame["atr_points"] = atr
    frame["is_decision"] = (close_minute >= FIRST_DECISION_MINUTE) & (close_minute <= LAST_DECISION_MINUTE) & np.isfinite(atr)
    return DecisionBars(frame=frame, minutes=m)
