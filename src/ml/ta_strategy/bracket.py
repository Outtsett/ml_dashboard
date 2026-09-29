"""Bracket-order simulator for conditional strategies: one position at a time,
a fixed stop and a target at ``reward_multiple`` x the stop.

Rules (the same conventions as ``cycle/simulate.py``, where they overlap):
- A signal at bar t's CLOSE fills at bar t+1's OPEN. No entry on a session's last
  bar (its next open is the next session).
- Stop = entry - side x stop distance; target = entry + side x reward_multiple x
  stop distance. Both are whole ticks from the entry, so they are on the grid.
- Each bar from the entry bar on: an open beyond a level fills at the open; else
  a bar touching both levels is a STOP (the conservative assumption, since the
  bar's path is unknown); else the one touched fills at its level.
- A position still open at a session's last bar exits at that bar's close.
- Costs: ``cost_ticks`` per round trip, charged on every trade; a trade held
  across a real contract roll pays one more round trip.
- While a position is open, new signals are ignored.
"""

from __future__ import annotations

import numpy as np
from numba import njit

EXIT_STOP, EXIT_TARGET, EXIT_SESSION_END, EXIT_DATA_END = 0, 1, 2, 3
EXIT_NAMES = {EXIT_STOP: "stop", EXIT_TARGET: "target", EXIT_SESSION_END: "session_end", EXIT_DATA_END: "data_end"}


@njit(cache=True)
def simulate(open_, high, low, close, signal, stop_ticks, session_last, roll_after, tick, reward_multiple):
    """Returns (entry_index, exit_index, side, entry_price, exit_price, stop_distance_ticks, exit_reason, rolls_crossed),
    each trimmed to the number of trades. ``stop_ticks[t]`` is the stop distance decided at bar t's close;
    ``roll_after[j]`` is True when a real contract roll happens between bar j-1 and bar j."""
    n = open_.shape[0]
    cap = n // 2 + 1
    e_i = np.empty(cap, np.int64)
    x_i = np.empty(cap, np.int64)
    sd = np.empty(cap, np.int8)
    e_p = np.empty(cap, np.float64)
    x_p = np.empty(cap, np.float64)
    st = np.empty(cap, np.float64)
    why = np.empty(cap, np.int8)
    rc = np.empty(cap, np.int64)
    count = 0
    t = 0
    while t < n - 1:
        s = signal[t]
        if s == 0 or session_last[t] or not (stop_ticks[t] > 0):
            t += 1
            continue
        j = t + 1
        entry = open_[j]
        distance = stop_ticks[t] * tick
        stop = entry - s * distance
        target = entry + s * reward_multiple * distance
        rolls = 0
        exit_price = 0.0
        reason = -1
        while True:
            if j > t + 1 and roll_after[j]:
                rolls += 1
            if s > 0:
                if j > t + 1 and open_[j] <= stop:
                    exit_price, reason = open_[j], EXIT_STOP
                elif j > t + 1 and open_[j] >= target:
                    exit_price, reason = open_[j], EXIT_TARGET
                elif low[j] <= stop:
                    exit_price, reason = stop, EXIT_STOP
                elif high[j] >= target:
                    exit_price, reason = target, EXIT_TARGET
            else:
                if j > t + 1 and open_[j] >= stop:
                    exit_price, reason = open_[j], EXIT_STOP
                elif j > t + 1 and open_[j] <= target:
                    exit_price, reason = open_[j], EXIT_TARGET
                elif high[j] >= stop:
                    exit_price, reason = stop, EXIT_STOP
                elif low[j] <= target:
                    exit_price, reason = target, EXIT_TARGET
            if reason < 0 and session_last[j]:
                exit_price, reason = close[j], EXIT_SESSION_END
            if reason < 0 and j == n - 1:
                exit_price, reason = close[j], EXIT_DATA_END
            if reason >= 0:
                break
            j += 1
        e_i[count], x_i[count], sd[count] = t + 1, j, s
        e_p[count], x_p[count], st[count], why[count], rc[count] = entry, exit_price, stop_ticks[t], reason, rolls
        count += 1
        t = j          # a signal on the exit bar's close may open the next trade
    return e_i[:count], x_i[:count], sd[:count], e_p[:count], x_p[:count], st[:count], why[:count], rc[:count]


def stop_distance_ticks(mode: str, value: float, atr: np.ndarray, tick: float, minimum_ticks: int = 4) -> np.ndarray:
    """Stop distance in whole ticks per bar: ``fixed`` = value ticks; ``atr`` = value x ATR(14), rounded."""
    if mode == "fixed":
        return np.full(atr.shape, float(value))
    if mode == "atr":
        out = np.round(value * atr / tick)
        out[~np.isfinite(out)] = np.nan
        return np.maximum(out, minimum_ticks)
    raise ValueError(f"stop mode must be fixed or atr, got {mode!r}")
