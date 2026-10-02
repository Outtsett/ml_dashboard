"""What the market offered each session: range, path length and a hindsight zigzag ceiling.

For each CME session day (and its regular-trading-hours part, 06:30-13:00
Pacific) on back-adjusted 1-minute closes: the high-low range, the sum of
absolute 1-minute moves, and for swing thresholds of 8, 20, 40, 80 and 160
ticks the legs of a perfect-hindsight zigzag, each charged one round trip. The
zigzag net is the most one contract could have captured trading only swings of
at least that size. It uses closes, so it slightly understates the true ceiling.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .data import Bars, session_dates

THRESHOLDS_TICKS = (8, 20, 40, 80, 160)
COMPLETE_SESSION_MINIMUM_BARS = 1000
RTH_OPEN_MINUTE, RTH_CLOSE_MINUTE = 6 * 60 + 30, 13 * 60


def zigzag_legs(price: np.ndarray, threshold: float) -> np.ndarray:
    """Leg lengths of a hindsight zigzag whose every leg is at least ``threshold``."""
    n = price.size
    if n < 2:
        return np.empty(0)
    pivots: list[float] = []
    high = low = price[0]
    high_index = low_index = 0
    direction = 0
    anchor = price[0]
    for i in range(1, n):
        p = price[i]
        if direction == 0:
            if p > high:
                high, high_index = p, i
            if p < low:
                low, low_index = p, i
            if high - low >= threshold:
                if high_index > low_index:
                    pivots.append(low)
                    direction, anchor = 1, high
                else:
                    pivots.append(high)
                    direction, anchor = -1, low
        elif direction == 1:
            if p > anchor:
                anchor = p
            elif anchor - p >= threshold:
                pivots.append(anchor)
                direction, anchor = -1, p
        else:
            if p < anchor:
                anchor = p
            elif p - anchor >= threshold:
                pivots.append(anchor)
                direction, anchor = 1, p
    if direction != 0 and abs(anchor - pivots[-1]) >= threshold:
        pivots.append(anchor)
    return np.abs(np.diff(np.asarray(pivots)))


def _session_row(close: np.ndarray, high: np.ndarray, low: np.ndarray, prefix: str, tick: float,
                 cost_ticks: float) -> dict:
    row = {
        f"{prefix}_bar_count": int(close.size),
        f"{prefix}_range_ticks": float((high.max() - low.min()) / tick),
        f"{prefix}_path_length_1m_ticks": float(np.abs(np.diff(close)).sum() / tick),
    }
    for threshold in THRESHOLDS_TICKS:
        legs = zigzag_legs(close, threshold * tick) / tick
        row[f"{prefix}_oracle_{threshold}_tick_swing_leg_count"] = int(legs.size)
        row[f"{prefix}_oracle_{threshold}_tick_swing_net_ticks"] = float((legs - cost_ticks).sum())
    return row


def by_session(bars: Bars, tick: float, cost_ticks: float) -> pd.DataFrame:
    frame = bars.frame
    stamps = frame["timestamp"].to_numpy(np.int64)
    days = session_dates(stamps)
    moments = pd.to_datetime(stamps, unit="s")
    minute = (moments.hour * 60 + moments.minute).to_numpy()
    rth = (minute >= RTH_OPEN_MINUTE) & (minute < RTH_CLOSE_MINUTE)
    close, high, low = (frame[k].to_numpy(float) for k in ("close", "high", "low"))
    rows = []
    boundaries = np.flatnonzero(np.r_[True, days[1:] != days[:-1], True])
    for a, b in zip(boundaries[:-1], boundaries[1:]):
        if b - a < 30:
            continue
        row = {"session_date": pd.Timestamp(days[a])}
        row.update(_session_row(close[a:b], high[a:b], low[a:b], "session", tick, cost_ticks))
        inside = np.flatnonzero(rth[a:b]) + a
        if inside.size >= 30:
            row.update(_session_row(close[inside], high[inside], low[inside], "regular_hours", tick, cost_ticks))
        row["complete_session"] = row["session_bar_count"] >= COMPLETE_SESSION_MINIMUM_BARS
        rows.append(row)
    return pd.DataFrame(rows)
