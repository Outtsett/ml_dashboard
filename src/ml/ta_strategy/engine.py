"""Exit engine for conditional strategies: several exits per trade, on the 1-minute path.

A superset of ``bracket.simulate`` (identical outputs for a stop + R-target plan; held to
that by ``tests/test_ta_conditional.py``). Each entry signal carries a PLAN row, fixed at
the signal bar's close:

    P_STOP_PRICE    absolute stop (a level minus a buffer), NaN = use P_STOP_TICKS
    P_STOP_TICKS    stop distance from the entry fill, in ticks
    P_TARGET_PRICE  absolute target (the next level), NaN = use R or ticks
    P_TARGET_R      target = entry +/- R x the initial risk
    P_TARGET_TICKS  target distance from the fill, in ticks
    P_TRAIL_MODE    0 none | 1 chandelier (running extreme -/+ P_TRAIL_A ticks) |
                    2 breakeven (after P_TRAIL_A R of profit, stop to entry +/- P_TRAIL_B ticks) | 3 both
    P_TRAIL_A, P_TRAIL_B
    P_MAX_BARS      time stop, in strategy bars after the entry (0 = none)
    P_MIN_ROOM_R    room filter: an absolute target closer than this many R is rejected
    P_BOUNCE_TICKS  with trail bit 4: P_TARGET_PRICE is a LEVEL, not a limit. Once price reaches it the
                    trade is armed and exits when price retreats P_BOUNCE_TICKS from its running extreme
                    (a resting trailing stop, market exit): "reached the next level and bounced".

Order of events inside each minute of an open trade:
1. at the open: a gap through the stop or target fills at the open; else an exit decided at
   the previous strategy bar's close (signal or time) fills at this open;
2. resting stop, then target, inside the minute (stop first when both are touched);
3. flatten at the session's last minute (or the data end);
4. trailing updates from this minute's extreme apply from the NEXT minute and never loosen;
5. at a strategy bar's close: the side's exit condition, else the time stop, marks an exit
   for the next minute's open.
Market exits (stop, trail, signal, time, session end) pay ``slippage`` ticks; a target is a
resting limit. A trade whose stop or target is on the wrong side of the actual fill, or whose
risk is outside [min_risk_ticks, max_risk_ticks], is rejected and counted, never clipped.
"""

from __future__ import annotations

import numpy as np
from numba import njit

EXIT_STOP, EXIT_TARGET, EXIT_SESSION_END, EXIT_DATA_END, EXIT_SIGNAL, EXIT_TIME, EXIT_TRAIL, EXIT_BOUNCE = 0, 1, 2, 3, 4, 5, 6, 7
EXIT_NAMES = {0: "stop", 1: "target", 2: "session_end", 3: "data_end", 4: "signal_exit", 5: "time_stop", 6: "trailing_stop",
              7: "level_bounce"}
(P_STOP_PRICE, P_STOP_TICKS, P_TARGET_PRICE, P_TARGET_R, P_TARGET_TICKS, P_TRAIL_MODE, P_TRAIL_A, P_TRAIL_B,
 P_MAX_BARS, P_MIN_ROOM_R, P_BOUNCE_TICKS) = range(11)
PLAN_COLUMNS = 11


def empty_plan(count: int) -> np.ndarray:
    plan = np.full((count, PLAN_COLUMNS), np.nan)
    plan[:, P_TRAIL_MODE] = 0
    plan[:, P_MAX_BARS] = 0
    plan[:, P_MIN_ROOM_R] = 0
    return plan


@njit(cache=True)
def simulate(open_, high, low, close, sig_idx, sig_side, plan, exit_long, exit_short, bar_close,
             session_id, session_last, roll_after, tick, slippage, min_risk_ticks, max_risk_ticks,
             max_entries_per_session, cost_ticks):
    n = open_.shape[0]
    ns = sig_idx.shape[0]
    cap = ns + 1
    e_i = np.empty(cap, np.int64)
    x_i = np.empty(cap, np.int64)
    sd = np.empty(cap, np.int8)
    e_p = np.empty(cap, np.float64)
    x_p = np.empty(cap, np.float64)
    risk = np.empty(cap, np.float64)
    why = np.empty(cap, np.int8)
    rc = np.empty(cap, np.int64)
    mfe = np.empty(cap, np.float64)
    mae = np.empty(cap, np.float64)
    held = np.empty(cap, np.int64)
    rejected = 0
    count = 0
    free_at = 0
    cur_session = -1
    entries_in_session = 0
    for k in range(ns):
        t = sig_idx[k]
        s = sig_side[k]
        if t >= n - 1 or s == 0 or session_last[t] or t < free_at:
            continue
        j = t + 1
        sess = session_id[j]
        if sess != cur_session:
            cur_session = sess
            entries_in_session = 0
        if max_entries_per_session > 0 and entries_in_session >= max_entries_per_session:
            continue
        entry = open_[j]
        if np.isfinite(plan[k, P_STOP_PRICE]):
            stop = plan[k, P_STOP_PRICE]
        elif np.isfinite(plan[k, P_STOP_TICKS]):
            stop = entry - s * plan[k, P_STOP_TICKS] * tick
        else:
            rejected += 1
            continue
        r_ticks = s * (entry - stop) / tick
        if not (r_ticks >= min_risk_ticks and r_ticks <= max_risk_ticks):
            rejected += 1
            continue
        target = np.nan
        if np.isfinite(plan[k, P_TARGET_PRICE]):
            target = plan[k, P_TARGET_PRICE]
            room = s * (target - entry) / tick
            if room <= 0 or room < plan[k, P_MIN_ROOM_R] * r_ticks:
                rejected += 1
                continue
        elif np.isfinite(plan[k, P_TARGET_R]):
            target = entry + s * plan[k, P_TARGET_R] * r_ticks * tick
        elif np.isfinite(plan[k, P_TARGET_TICKS]):
            target = entry + s * plan[k, P_TARGET_TICKS] * tick
        mode = int(plan[k, P_TRAIL_MODE])
        bounce_level = np.nan
        if (mode & 4) != 0 and np.isfinite(plan[k, P_TARGET_PRICE]):
            bounce_level = target          # the level arms a trail; it never fills as a limit
            target = np.nan
        has_target = np.isfinite(target)
        armed = False
        bounce = plan[k, P_BOUNCE_TICKS]
        ta = plan[k, P_TRAIL_A]
        tb = plan[k, P_TRAIL_B]
        max_bars = int(plan[k, P_MAX_BARS])
        risk_price = r_ticks * tick
        extreme = entry
        stop_is_trailed = False
        pending = -1
        bars_seen = 0
        rolls = 0
        best = 0.0
        worst = 0.0
        exit_price = 0.0
        reason = -1
        while True:
            if j > t + 1 and roll_after[j]:
                rolls += 1
            stop_reason = EXIT_BOUNCE if armed else (EXIT_TRAIL if stop_is_trailed else EXIT_STOP)
            if j > t + 1:
                o = open_[j]
                if s > 0:
                    if o <= stop:
                        exit_price, reason = o, stop_reason
                    elif has_target and o >= target:
                        exit_price, reason = o, EXIT_TARGET
                else:
                    if o >= stop:
                        exit_price, reason = o, stop_reason
                    elif has_target and o <= target:
                        exit_price, reason = o, EXIT_TARGET
                if reason < 0 and pending >= 0:
                    exit_price, reason = o, pending
            if reason < 0:
                if s > 0:
                    if low[j] <= stop:
                        exit_price, reason = stop, stop_reason
                    elif has_target and high[j] >= target:
                        exit_price, reason = target, EXIT_TARGET
                else:
                    if high[j] >= stop:
                        exit_price, reason = stop, stop_reason
                    elif has_target and low[j] <= target:
                        exit_price, reason = target, EXIT_TARGET
            if reason < 0 and session_last[j]:
                exit_price, reason = close[j], EXIT_SESSION_END
            if reason < 0 and j == n - 1:
                exit_price, reason = close[j], EXIT_DATA_END
            adverse = s * ((low[j] if s > 0 else high[j]) - entry) / tick
            if adverse < worst:
                worst = adverse
            if reason < 0 or reason == EXIT_TARGET:
                favourable = s * ((high[j] if s > 0 else low[j]) - entry) / tick
                if favourable > best:
                    best = favourable
            if reason >= 0:
                if reason != EXIT_TARGET:
                    exit_price -= s * slippage * tick
                break
            if mode != 0:
                if s > 0:
                    if high[j] > extreme:
                        extreme = high[j]
                else:
                    if low[j] < extreme:
                        extreme = low[j]
                if not armed and np.isfinite(bounce_level) and s * (extreme - bounce_level) >= 0:
                    armed = True
                candidate = stop
                if armed:
                    c4 = extreme - s * bounce * tick
                    if s * (c4 - candidate) > 0:
                        candidate = c4
                if (mode & 1) != 0:
                    c1 = extreme - s * ta * tick
                    if s * (c1 - candidate) > 0:
                        candidate = c1
                if (mode & 2) != 0 and s * (extreme - entry) >= ta * risk_price:
                    c2 = entry + s * tb * tick
                    if s * (c2 - candidate) > 0:
                        candidate = c2
                if candidate != stop:
                    stop = candidate
                    stop_is_trailed = True
            if bar_close[j]:
                bars_seen += 1
                if pending < 0:
                    if (s > 0 and exit_long[j]) or (s < 0 and exit_short[j]):
                        pending = EXIT_SIGNAL
                    elif max_bars > 0 and bars_seen >= max_bars:
                        pending = EXIT_TIME
            j += 1
        e_i[count] = t + 1
        x_i[count] = j
        sd[count] = s
        e_p[count] = entry
        x_p[count] = exit_price
        risk[count] = r_ticks
        why[count] = reason
        rc[count] = rolls
        mfe[count] = best
        mae[count] = worst
        held[count] = j - t
        entries_in_session += 1
        count += 1
        free_at = j
    return (e_i[:count], x_i[:count], sd[:count], e_p[:count], x_p[:count], risk[:count], why[:count], rc[:count],
            mfe[:count], mae[:count], held[:count], rejected)
