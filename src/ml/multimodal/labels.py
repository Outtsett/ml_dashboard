"""The label: what a bracket trade opened at each decision point would have done.

For every decision bar (a 5-minute RTH bar closing 06:35-12:00 Pacific), both
sides, and each reward multiple R, a bracket is opened at the NEXT minute's
open and walked forward on the 1-minute path until it exits:

- stop distance S = max(round(ATR_MULTIPLE x ATR / tick), MIN_STOP_TICKS) ticks,
  ATR = the causal 20-bar ATR of the 5-minute RTH bars;
- target distance T = R x S + (R + 1) x c + R x slip, rounded UP to the tick —
  the smallest target whose net win is at least R times the net loss after the
  round-trip cost c (1.39 points, AMP, 1 tick slippage per side included) and
  the extra tick a stop pays as a market order (slip);
- in each minute from the entry on: an open beyond a level fills at that open
  (a gap); else a minute touching both levels is a STOP (its path is unknown, so
  the conservative reading); else the level touched fills — a STOP on a touch
  (a market order), a TARGET only when price trades at least one tick THROUGH it
  (a resting limit that is merely touched may not fill: queue position);
- sessions whose data ends before 10:00 Pacific (data holes, truncated holiday
  history) are left out: a bracket there would be scored on an exit that is an
  artefact of the missing data;
- still open at the last RTH minute (12:59): exits at its close as a market order;
- net points = side x (exit - entry) - c, minus slip on stop and session-end exits.

Candidates are labelled independently (overlapping trades are allowed here);
the policy in ``backtest`` decides which are taken.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from numba import njit

from multimodal.data import DecisionBars, minute_of_day

TICK = 0.25
POINT_VALUE_USD = 2.0
ROUND_TRIP_COST_POINTS = 1.39        # src/config/cost_model.json MNQ total_round_trip_points
STOP_SLIPPAGE_POINTS = 0.25           # a stop / flatten is a market order: one more tick
ATR_MULTIPLE = 1.0
MIN_STOP_TICKS = 16                   # 4 points: below this the round trip is over a third of the risk
TARGET_TRADE_THROUGH_POINTS = TICK    # a target fills only when price trades one tick through it
MINIMUM_SESSION_END_MINUTE = 10 * 60  # a session whose RTH minutes end before 10:00 Pacific is incomplete
REWARD_MULTIPLES = (2.0, 3.0)
EXIT_STOP, EXIT_TARGET, EXIT_SESSION_END = 0, 1, 2
EXIT_NAMES = {EXIT_STOP: "stop", EXIT_TARGET: "target", EXIT_SESSION_END: "session_end"}


def bracket_distances(atr_points: np.ndarray, reward_multiple: float,
                      cost: float = ROUND_TRIP_COST_POINTS, slip: float = STOP_SLIPPAGE_POINTS) -> tuple[np.ndarray, np.ndarray]:
    """(stop points, target points) on the tick grid for each ATR."""
    stop_ticks = np.maximum(np.round(ATR_MULTIPLE * atr_points / TICK), MIN_STOP_TICKS)
    stop = stop_ticks * TICK
    target_raw = reward_multiple * stop + (reward_multiple + 1.0) * cost + reward_multiple * slip
    target = np.ceil(target_raw / TICK - 1e-9) * TICK
    return stop, target


@njit(cache=True)
def _walk(open_, high, low, close, entry_index, last_index, side, stop_distance, target_distance, through=0.0):
    """Exit (index, price, reason) of one bracket opened at open_[entry_index]; the target needs
    `through` points of trade-through (0 = fill on a touch)."""
    entry = open_[entry_index]
    stop = entry - side * stop_distance
    target = entry + side * target_distance
    for j in range(entry_index, last_index + 1):
        if j > entry_index:
            if side > 0:
                if open_[j] <= stop:
                    return j, open_[j], 0
                if open_[j] >= target + through:
                    return j, open_[j], 1
            else:
                if open_[j] >= stop:
                    return j, open_[j], 0
                if open_[j] <= target - through:
                    return j, open_[j], 1
        if side > 0:
            if low[j] <= stop:
                return j, stop, 0
            if high[j] >= target + through:
                return j, target, 1
        else:
            if high[j] >= stop:
                return j, stop, 0
            if low[j] <= target - through:
                return j, target, 1
    return last_index, close[last_index], 2


@njit(cache=True)
def _label_all(open_, high, low, close, entries, lasts, sides, stops, targets, through):
    n = entries.shape[0]
    exit_index = np.empty(n, np.int64)
    exit_price = np.empty(n, np.float64)
    reason = np.empty(n, np.int8)
    for k in range(n):
        j, price, why = _walk(open_, high, low, close, entries[k], lasts[k], sides[k], stops[k], targets[k], through)
        exit_index[k] = j
        exit_price[k] = price
        reason[k] = why
    return exit_index, exit_price, reason


def label(decisions: DecisionBars, reward_multiples: tuple[float, ...] = REWARD_MULTIPLES) -> pd.DataFrame:
    """One row per (decision bar, side, reward multiple): the bracket's outcome."""
    frame = decisions.frame
    minutes = decisions.minutes
    stamps = minutes.timestamp
    candidates = frame.index[frame["is_decision"].to_numpy()]
    entry_minute = frame.loc[candidates, "last_minute"].to_numpy() + 1
    valid = entry_minute < stamps.size
    candidates, entry_minute = candidates[valid], entry_minute[valid]
    # the entry must be the very next minute of the same session (no gap, no next day)
    decision_close = frame.loc[candidates, "timestamp"].to_numpy() + 60 * 5
    same_session = minutes.session[entry_minute] == frame.loc[candidates, "session"].to_numpy()
    on_time = stamps[entry_minute] <= decision_close + 60
    candidates, entry_minute = candidates[same_session & on_time], entry_minute[same_session & on_time]
    # each session's last RTH minute; sessions whose data stops before 10:00 are incomplete and left out
    last_of_session = pd.Series(np.arange(stamps.size)).groupby(minutes.session).transform("max").to_numpy()
    last_minute_of_day = (stamps[last_of_session[entry_minute]] % 86400) // 60
    complete = last_minute_of_day >= MINIMUM_SESSION_END_MINUTE
    candidates, entry_minute = candidates[complete], entry_minute[complete]

    rows = []
    for reward in reward_multiples:
        stop, target = bracket_distances(frame.loc[candidates, "atr_points"].to_numpy(), reward)
        for side in (1, -1):
            sides = np.full(candidates.size, side, np.int64)
            exit_index, exit_price, reason = _label_all(
                minutes.open, minutes.high, minutes.low, minutes.close,
                entry_minute.astype(np.int64), last_of_session[entry_minute].astype(np.int64), sides, stop, target,
                TARGET_TRADE_THROUGH_POINTS,
            )
            entry_price = minutes.open[entry_minute]
            gross = side * (exit_price - entry_price)
            net = gross - ROUND_TRIP_COST_POINTS - np.where(reason != EXIT_TARGET, STOP_SLIPPAGE_POINTS, 0.0)
            rows.append(pd.DataFrame({
                "decision_timestamp": frame.loc[candidates, "timestamp"].to_numpy(),
                "decision_bar": candidates.to_numpy(),
                "session": frame.loc[candidates, "session"].to_numpy(),
                "side": side,
                "reward_multiple": reward,
                "atr_points": frame.loc[candidates, "atr_points"].to_numpy(),
                "stop_points": stop,
                "target_points": target,
                "entry_timestamp": stamps[entry_minute],
                "entry_price": entry_price,
                "exit_timestamp": stamps[exit_index],
                "exit_price": exit_price,
                "exit_reason": reason,
                "minutes_held": exit_index - entry_minute + 1,
                "gross_points": gross,
                "net_points": net,
            }))
    out = pd.concat(rows, ignore_index=True)
    out["target_hit"] = (out["exit_reason"] == EXIT_TARGET).astype(np.int8)
    out["win"] = (out["net_points"] > 0).astype(np.int8)
    out["net_usd"] = out["net_points"] * POINT_VALUE_USD
    out["decision_minute_of_day"] = minute_of_day(out["decision_timestamp"].to_numpy()) + 5
    return out
