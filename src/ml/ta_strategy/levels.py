"""Multi-timeframe support and resistance for MNQ, computed causally.

Every level is an EVENT: (price, source, family, timeframe, known_from, valid_until).
``known_from`` is the first moment the level could be known (epoch seconds of the
Pacific wall-clock stamps); a level is never used before it. At any bar, the active
levels are merged into ZONES; the nearest zone below the close is support and the
nearest above is resistance. A zone's strength is the number of distinct source
families in it (confluence).

Sources (docs/ta-strategy-600-ticks.md, "Multi-timeframe support and resistance";
research: Osler 2000/2003, Kavajecz & Odders-White 2004, Garzarelli et al. 2014,
Chung & Bellotti 2021):

| family | levels | known from | valid until |
|---|---|---|---|
| prior_session | high, low, close of the previous CME session (15:00-14:00) | next session's first minute | the end of that next session |
| prior_rth | high, low, close of 06:30-13:00 | 13:00 | the end of the next session |
| overnight | high, low of the session before 06:30 | 06:30 | the session end |
| opening_range | high, low of 06:30-06:45 (15) and 06:30-07:00 (30) | 06:45 / 07:00 | the session end |
| prior_week | high, low, close of the previous Monday-Friday week | the week's first session | the end of that week |
| round_number | multiples of 100 (and 50) index points in TRADED prices, shifted by the session's roll adjustment | the session's first minute | the session end |
| fractal_15m / _1h / _4h | Williams fractal highs and lows (strict extreme over k bars each side) | the close of bar i+k (confirmation, never the extreme's own bar) | a close beyond it by 0.25 x ATR, or an age cap |
| session_vwap | volume-weighted average price from the 15:00 open, +/-1 and +/-2 volume-weighted standard deviations | each minute (dynamic) | - |

The 4h fractals use 15:00-anchored bars (``data.aggregate_session_anchored``);
epoch-aligned 4h bars straddle the session break.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import talib
from numba import njit

from .data import aggregate, aggregate_session_anchored, session_dates

RTH_OPEN, RTH_CLOSE = 6 * 3600 + 30 * 60, 13 * 3600
FRACTAL_SPEC = {  # timeframe: (bars each side k, age cap in bars)
    "15m": (3, 5 * 92),
    "1h": (3, 10 * 23),
    "4h": (2, 20 * 6),
}
FAMILY_GROUP = {
    "prior_session": "session", "prior_rth": "session", "overnight": "overnight", "opening_range": "opening_range",
    "prior_week": "week", "round_number": "round", "fractal_15m": "fractal_15m", "fractal_1h": "fractal_1h",
    "fractal_4h": "fractal_4h", "session_vwap": "vwap",
}


@dataclass
class MinuteContext:
    stamps: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    volume: np.ndarray
    raw_close: np.ndarray
    adjustment: np.ndarray
    days: np.ndarray               # session date per minute (datetime64[ns])
    session_id: np.ndarray         # 0..S-1 per minute
    session_start: np.ndarray      # first minute index of each session
    session_end: np.ndarray        # one past the last minute index of each session
    session_day: np.ndarray        # session date per session


def minute_context(minutes: pd.DataFrame) -> MinuteContext:
    stamps = minutes["timestamp"].to_numpy(np.int64)
    days = session_dates(stamps)
    boundary = np.flatnonzero(np.r_[True, days[1:] != days[:-1]])
    session_id = np.cumsum(np.r_[True, days[1:] != days[:-1]]) - 1
    return MinuteContext(
        stamps=stamps, open=minutes["open"].to_numpy(float), high=minutes["high"].to_numpy(float),
        low=minutes["low"].to_numpy(float), close=minutes["close"].to_numpy(float),
        volume=minutes["volume"].to_numpy(float),
        raw_close=minutes["raw_close"].to_numpy(float) if "raw_close" in minutes else minutes["close"].to_numpy(float),
        adjustment=minutes["adjustment_points"].to_numpy(float) if "adjustment_points" in minutes else np.zeros(len(minutes)),
        days=days, session_id=session_id, session_start=boundary, session_end=np.r_[boundary[1:], stamps.size],
        session_day=days[boundary],
    )


def _day_seconds(day: np.datetime64) -> int:
    return int(pd.Timestamp(day).value // 10**9)


# ── static level events ──────────────────────────────────────────────────────
def session_level_events(ctx: MinuteContext, round_steps=(100.0, 50.0), round_span_points: float = 400.0) -> pd.DataFrame:
    rows = []
    n_sessions = ctx.session_start.size
    starts, ends = ctx.session_start, ctx.session_end
    first_stamp = ctx.stamps[starts]
    for s in range(n_sessions):
        a, b = starts[s], ends[s]
        day = _day_seconds(ctx.session_day[s])
        next_start = int(first_stamp[s + 1]) if s + 1 < n_sessions else int(ctx.stamps[-1]) + 60
        after_next = int(first_stamp[s + 2]) if s + 2 < n_sessions else int(ctx.stamps[-1]) + 60
        session_end_stamp = next_start
        hi, lo = ctx.high[a:b], ctx.low[a:b]
        t = ctx.stamps[a:b]
        # the previous session's high/low/close apply to the NEXT session
        if s + 1 < n_sessions:
            for kind, price in (("high", hi.max()), ("low", lo.min()), ("close", ctx.close[b - 1])):
                rows.append((price, f"prior_session_{kind}", "prior_session", "session", next_start, after_next))
        rth = (t >= day + RTH_OPEN) & (t < day + RTH_CLOSE)
        if rth.any():
            rows += [(hi[rth].max(), "prior_rth_high", "prior_rth", "session", day + RTH_CLOSE, after_next),
                     (lo[rth].min(), "prior_rth_low", "prior_rth", "session", day + RTH_CLOSE, after_next),
                     (ctx.close[a:b][rth][-1], "prior_rth_close", "prior_rth", "session", day + RTH_CLOSE, after_next)]
        over = t < day + RTH_OPEN
        if over.any():
            rows += [(hi[over].max(), "overnight_high", "overnight", "session", day + RTH_OPEN, session_end_stamp),
                     (lo[over].min(), "overnight_low", "overnight", "session", day + RTH_OPEN, session_end_stamp)]
        for width in (15, 30):
            window = (t >= day + RTH_OPEN) & (t < day + RTH_OPEN + width * 60)
            if window.any():
                known = day + RTH_OPEN + width * 60
                rows += [(hi[window].max(), f"opening_range_{width}_high", "opening_range", "session", known, session_end_stamp),
                         (lo[window].min(), f"opening_range_{width}_low", "opening_range", "session", known, session_end_stamp)]
        # round numbers in TRADED prices, shifted into the back-adjusted series by this session's adjustment
        # (constant within a session: rolls happen only at session opens)
        adjustment = ctx.adjustment[a]
        reference = ctx.raw_close[a - 1] if a > 0 else ctx.raw_close[a]     # the last close BEFORE the session opens
        for step in round_steps:
            lowest = np.ceil((reference - round_span_points) / step) * step
            for raw in np.arange(lowest, reference + round_span_points + step, step):
                if step != round_steps[0] and raw % round_steps[0] == 0:
                    continue
                rows.append((raw + adjustment, f"round_{int(step)}", "round_number", "static", int(first_stamp[s]), session_end_stamp))
    # prior week
    week = pd.DatetimeIndex(ctx.session_day)
    week_key = (week - pd.to_timedelta(week.dayofweek, unit="D")).values
    boundaries = np.flatnonzero(np.r_[True, week_key[1:] != week_key[:-1]])
    week_end = np.r_[boundaries[1:], n_sessions]
    for w in range(boundaries.size - 1):
        s0, s1 = boundaries[w], week_end[w]
        a, b = starts[s0], ends[s1 - 1]
        known = int(first_stamp[boundaries[w + 1]])
        until = int(first_stamp[boundaries[w + 2]]) if w + 2 < boundaries.size else int(ctx.stamps[-1]) + 60
        rows += [(ctx.high[a:b].max(), "prior_week_high", "prior_week", "week", known, until),
                 (ctx.low[a:b].min(), "prior_week_low", "prior_week", "week", known, until),
                 (ctx.close[b - 1], "prior_week_close", "prior_week", "week", known, until)]
    return pd.DataFrame(rows, columns=["price", "source", "family", "timeframe", "known_from", "valid_until"])


@njit(cache=True)
def _fractals(high, low, close, atr, k, cap, buffer_atr):
    n = high.shape[0]
    out_i = np.empty(2 * n, np.int64)
    out_side = np.empty(2 * n, np.int8)
    out_until = np.empty(2 * n, np.int64)
    count = 0
    for i in range(k, n - k):
        is_high = True
        is_low = True
        for j in range(i - k, i + k + 1):
            if j == i:
                continue
            if high[j] >= high[i]:
                is_high = False
            if low[j] <= low[i]:
                is_low = False
        for side, flag in ((1, is_high), (-1, is_low)):
            if not flag:
                continue
            level = high[i] if side == 1 else low[i]
            until = min(i + k + cap, n - 1)
            for j in range(i + k + 1, min(i + k + cap, n - 1) + 1):
                a = atr[j]
                if not np.isfinite(a):
                    continue
                if (side == 1 and close[j] > level + buffer_atr * a) or (side == -1 and close[j] < level - buffer_atr * a):
                    until = j
                    break
            out_i[count] = i
            out_side[count] = side
            out_until[count] = until
            count += 1
    return out_i[:count], out_side[:count], out_until[:count]


def fractal_events(minutes: pd.DataFrame, penetration_buffer_atr: float = 0.25) -> pd.DataFrame:
    """Williams fractals on 15m and 1h (epoch buckets, which fall on the 15:00 open) and
    4h (15:00-anchored). Known at the close of bar i+k; retired at the close of the bar
    that closes beyond the level by ``penetration_buffer_atr`` x ATR(14), or at the age cap."""
    frames = []
    for tf, (k, cap) in FRACTAL_SPEC.items():
        if tf == "4h":
            bars, _ = aggregate_session_anchored(minutes, "4h")
            ends = bars["end_timestamp"].to_numpy(np.int64)
        else:
            width = 15 if tf == "15m" else 60
            bars, _ = aggregate(minutes, width)
            ends = bars["timestamp"].to_numpy(np.int64) + width * 60
        h, l, c = (bars[x].to_numpy(float) for x in ("high", "low", "close"))
        atr = talib.ATR(h, l, c, 14)
        i, side, until = _fractals(h, l, c, atr, k, cap, penetration_buffer_atr)
        frames.append(pd.DataFrame({
            "price": np.where(side == 1, h[i], l[i]),
            "source": np.where(side == 1, f"fractal_{tf}_high", f"fractal_{tf}_low"),
            "family": f"fractal_{tf}", "timeframe": tf,
            "known_from": ends[i + k], "valid_until": ends[until]}))
    return pd.concat(frames, ignore_index=True)


def all_level_events(minutes: pd.DataFrame, ctx: MinuteContext | None = None) -> pd.DataFrame:
    ctx = ctx or minute_context(minutes)
    events = pd.concat([session_level_events(ctx), fractal_events(minutes)], ignore_index=True)
    events = events[events["valid_until"] > events["known_from"]]
    events["family_group"] = events["family"].map(FAMILY_GROUP)
    return events.sort_values("known_from", kind="stable").reset_index(drop=True)


# ── dynamic levels: session VWAP and bands ───────────────────────────────────
def session_vwap(ctx: MinuteContext) -> dict[str, np.ndarray]:
    """VWAP from the 15:00 open on typical price (H+L+C)/3, and +/-1, +/-2 volume-weighted
    standard deviations. Minute j's value uses minutes up to and including j."""
    typical = (ctx.high + ctx.low + ctx.close) / 3.0
    v = np.where(np.isfinite(ctx.volume), ctx.volume, 0.0)
    out = {}
    pv = pd.Series(typical * v).groupby(ctx.session_id).cumsum().to_numpy()
    vv = pd.Series(v).groupby(ctx.session_id).cumsum().to_numpy()
    p2v = pd.Series(typical * typical * v).groupby(ctx.session_id).cumsum().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        vwap = np.where(vv > 0, pv / vv, typical)
        sigma = np.sqrt(np.maximum(np.where(vv > 0, p2v / vv, typical**2) - vwap**2, 0.0))
    out["session_vwap"] = vwap
    for k in (1, 2):
        out[f"session_vwap_upper_{k}"] = vwap + k * sigma
        out[f"session_vwap_lower_{k}"] = vwap - k * sigma
    return out


# ── zones at each bar of a strategy timeframe ────────────────────────────────
ZONE_COLUMNS = ["support_price", "support_low", "support_high", "support_strength", "support_families",
                "resistance_price", "resistance_low", "resistance_high", "resistance_strength", "resistance_families",
                "inside_zone", "zones_within_2_atr"]


def zones_for_bars(bar_end: np.ndarray, bar_close: np.ndarray, bar_atr: np.ndarray, bar_last_minute: np.ndarray,
                   events: pd.DataFrame, vwap: dict[str, np.ndarray] | None, tick: float,
                   width_atr: float = 0.25) -> pd.DataFrame:
    """For each bar (evaluated at its close ``bar_end``): merge every active level within
    6 x ATR of the close into zones (single linkage, gap <= max(width_atr x ATR, 4 ticks)),
    then report the nearest zone below the close (support) and above (resistance).
    Strength = distinct source-family groups in the zone."""
    known = events["known_from"].to_numpy(np.int64)
    until = events["valid_until"].to_numpy(np.int64)
    price = events["price"].to_numpy(float)
    group = events["family_group"].to_numpy()
    n = bar_end.size
    out = {c: np.full(n, np.nan) for c in ZONE_COLUMNS if not c.endswith("families") and c != "inside_zone"}
    out["support_families"] = np.empty(n, dtype=object)
    out["resistance_families"] = np.empty(n, dtype=object)
    out["inside_zone"] = np.zeros(n, dtype=bool)
    active: list[int] = []
    pointer = 0
    vwap_keys = list(vwap) if vwap else []
    for t in range(n):
        end = bar_end[t]
        while pointer < known.size and known[pointer] <= end:
            active.append(pointer)
            pointer += 1
        active = [i for i in active if until[i] > end]
        close, atr = bar_close[t], bar_atr[t]
        if not np.isfinite(atr) or atr <= 0:
            continue
        idx = np.fromiter(active, dtype=np.int64, count=len(active))
        prices = price[idx]
        near = np.abs(prices - close) <= 6 * atr
        prices, groups = prices[near], group[idx[near]]
        if vwap_keys:
            m = bar_last_minute[t]
            extra = np.array([vwap[k][m] for k in vwap_keys])
            prices = np.r_[prices, extra]
            groups = np.r_[groups, np.array(["vwap"] * len(extra), dtype=object)]
        if prices.size == 0:
            continue
        order = np.argsort(prices)
        prices, groups = prices[order], groups[order]
        gap = max(width_atr * atr, 4 * tick)
        breaks = np.flatnonzero(np.diff(prices) > gap) + 1
        starts = np.r_[0, breaks]
        stops = np.r_[breaks, prices.size]
        centres = np.array([prices[a:b].mean() for a, b in zip(starts, stops)])
        lows, highs = prices[starts], prices[stops - 1]
        out["zones_within_2_atr"][t] = float((np.abs(centres - close) <= 2 * atr).sum())
        below = np.flatnonzero(centres <= close)
        above = np.flatnonzero(centres > close)
        for name, pick in (("support", below[-1] if below.size else -1), ("resistance", above[0] if above.size else -1)):
            if pick < 0:
                continue
            members = sorted(set(groups[starts[pick]:stops[pick]]))
            out[f"{name}_price"][t] = centres[pick]
            out[f"{name}_low"][t] = lows[pick]
            out[f"{name}_high"][t] = highs[pick]
            out[f"{name}_strength"][t] = float(len(members))
            out[f"{name}_families"][t] = "+".join(members)
        out["inside_zone"][t] = bool(((lows - gap / 2 <= close) & (close <= highs + gap / 2)).any())
    return pd.DataFrame(out)


# ── level quality: does price hold at a level more often than at a random level? ──
@njit(cache=True)
def _first_test(high, low, close, start, stop, level, tolerance, move):
    """First minute in [start, stop) that tests ``level``: from above (low within tolerance
    while the previous close was above it) = a support test; from below = a resistance test.
    Then the first passage: +move away from the level on the tested side (held) or -move
    through it (broke). Returns (test minute, side +1 support / -1 resistance, outcome
    +1 held / -1 broke / 0 unresolved by ``stop``)."""
    for m in range(max(start, 1), stop):
        prev = close[m - 1]
        side = 0
        if prev > level + tolerance and low[m] <= level + tolerance:
            side = 1
        elif prev < level - tolerance and high[m] >= level - tolerance:
            side = -1
        if side == 0:
            continue
        for j in range(m + 1, stop):
            if side == 1:
                if low[j] <= level - move:
                    return m, side, -1
                if high[j] >= level + move:
                    return m, side, 1
            else:
                if high[j] >= level + move:
                    return m, side, -1
                if low[j] <= level - move:
                    return m, side, 1
        return m, side, 0
    return -1, 0, 0


@njit(cache=True)
def _test_all(high, low, close, starts, stops, levels, tolerances, moves):
    n = levels.shape[0]
    minute = np.empty(n, np.int64)
    side = np.empty(n, np.int8)
    outcome = np.empty(n, np.int8)
    for e in range(n):
        minute[e], side[e], outcome[e] = _first_test(high, low, close, starts[e], stops[e], levels[e], tolerances[e], moves[e])
    return minute, side, outcome


def atr_per_minute(minutes: pd.DataFrame, width: int = 15) -> np.ndarray:
    """ATR(14) of the last COMPLETED ``width``-minute bar at each minute."""
    bars, group = aggregate(minutes, width)
    atr = talib.ATR(bars["high"].to_numpy(float), bars["low"].to_numpy(float), bars["close"].to_numpy(float), 14)
    previous = group - 1
    return np.where(previous >= 0, atr[np.clip(previous, 0, None)], np.nan)


def level_quality(minutes: pd.DataFrame, events: pd.DataFrame, ctx: MinuteContext, permutations: int = 10,
                  seed: int = 3, tolerance_atr: float = 0.1, move_atr: float = 1.0) -> tuple[pd.DataFrame, pd.DataFrame]:
    """First test of every level event, and the same test at distance-matched random levels.

    Null (distance-matched session permutation): a level's signed distance from the price
    when it became known, in ATR units, is re-applied at the same time of day in a random
    other session; the pseudo level lives for the same length of time. Only the
    price-specific information is destroyed.
    Returns (per-event tests, per family x year summary)."""
    stamps = ctx.stamps
    atr = atr_per_minute(minutes)
    start = np.searchsorted(stamps, events["known_from"].to_numpy(np.int64))
    stop = np.searchsorted(stamps, events["valid_until"].to_numpy(np.int64))
    start = np.minimum(start, stamps.size - 1)
    reference = ctx.close[np.maximum(start - 1, 0)]
    a = atr[start]
    level = events["price"].to_numpy(float)
    ok = np.isfinite(a) & (a > 0) & (stop > start)
    real_minute, real_side, real_outcome = _test_all(
        ctx.high, ctx.low, ctx.close, start[ok], stop[ok], level[ok], tolerance_atr * a[ok], move_atr * a[ok])
    tests = events[ok].reset_index(drop=True).assign(
        test_minute=real_minute, tested_side=real_side, outcome=real_outcome,
        session_date=ctx.days[start[ok]], atr_at_known=a[ok])
    # null: same signed distance (in ATR) from the reference price, at the same time of day in another session
    rng = np.random.default_rng(seed)
    distance = (level[ok] - reference[ok]) / a[ok]
    duration = stop[ok] - start[ok]
    session_of = ctx.session_id[start[ok]]
    offset_in_session = start[ok] - ctx.session_start[session_of]
    n_sessions = ctx.session_start.size
    null_held = np.zeros((permutations, distance.size))
    null_tested = np.zeros((permutations, distance.size))
    for p in range(permutations):
        other = (session_of + rng.integers(1, n_sessions, size=distance.size)) % n_sessions
        pstart = np.minimum(ctx.session_start[other] + offset_in_session, ctx.session_end[other] - 1)
        pstop = np.minimum(pstart + duration, stamps.size)
        pa = atr[pstart]
        good = np.isfinite(pa) & (pa > 0)
        plevel = ctx.close[np.maximum(pstart - 1, 0)] + distance * np.where(good, pa, 1.0)
        pa = np.where(good, pa, 1.0)
        _, pside, pout = _test_all(ctx.high, ctx.low, ctx.close, pstart, pstop, plevel, tolerance_atr * pa, move_atr * pa)
        resolved = good & (pside != 0) & (pout != 0)
        null_tested[p] = resolved
        null_held[p] = np.where(resolved, pout == 1, np.nan)
    tests["null_held_rate"] = np.nanmean(null_held, axis=0)
    tests["null_resolved_share"] = null_tested.mean(axis=0)
    resolved = tests[tests["outcome"] != 0].copy()
    resolved["held"] = (resolved["outcome"] == 1).astype(float)
    resolved["year"] = pd.DatetimeIndex(resolved["session_date"]).year
    rows = []
    for (family, year), g in resolved.groupby(["family", "year"]):
        rows.append(_quality_row(g, family, int(year)))
    for family, g in resolved.groupby("family"):
        rows.append(_quality_row(g, family, None))
    return tests, pd.DataFrame(rows)


def shuffled_minutes(minutes: pd.DataFrame, seed: int) -> pd.DataFrame:
    """The same sessions with their 1-minute bars shuffled in time WITHIN each session
    (each minute keeps its close-to-close move, and its open/high/low relative to its
    close, as one block). Session opens, volumes and the minute clock stay; any real price
    structure is destroyed. Level generators and tests re-run on this path measure what a
    level definition produces mechanically (a swing level "bounces" partly by construction)."""
    rng = np.random.default_rng(seed)
    stamps = minutes["timestamp"].to_numpy(np.int64)
    days = session_dates(stamps)
    close = minutes["close"].to_numpy(float)
    step = np.r_[0.0, np.diff(close)]
    body = {k: minutes[k].to_numpy(float) - close for k in ("open", "high", "low")}
    order = np.arange(stamps.size)
    starts = np.flatnonzero(np.r_[True, days[1:] != days[:-1]])
    ends = np.r_[starts[1:], stamps.size]
    for a, b in zip(starts, ends):
        if b - a > 2:
            order[a + 1:b] = a + 1 + rng.permutation(b - a - 1)       # the session's first minute stays first
    new_close = np.empty_like(close)
    for a, b in zip(starts, ends):
        new_close[a:b] = close[a] + np.cumsum(np.r_[0.0, step[order[a + 1:b]]])
    out = minutes.copy()
    out["close"] = new_close
    for k in ("open", "high", "low"):
        out[k] = new_close + body[k][order]
    out["volume"] = minutes["volume"].to_numpy(float)[order]
    if "raw_close" in out:
        out["raw_close"] = new_close - minutes["adjustment_points"].to_numpy(float)
    return out


def _quality_row(g: pd.DataFrame, family: str, year: int | None) -> dict:
    lift = g["held"] - g["null_held_rate"]
    lift = lift[np.isfinite(lift)]
    clusters = g.loc[lift.index, "session_date"].to_numpy()
    n = lift.size
    if n > 1:
        residual = pd.Series(lift.to_numpy() - lift.mean()).groupby(clusters).sum().to_numpy()
        se = float(np.sqrt((residual**2).sum()) / n)
    else:
        se = np.nan
    return {"family": family, "year": year if year is not None else "all", "resolved_tests": int(len(g)),
            "held_rate": float(g["held"].mean()), "null_held_rate": float(g["null_held_rate"].mean()),
            "held_rate_lift_over_null": float(lift.mean()) if n else np.nan, "lift_standard_error": se,
            "lift_z": float(lift.mean() / se) if n > 1 and se and se > 0 else np.nan,
            "support_test_share": float((g["tested_side"] == 1).mean())}
