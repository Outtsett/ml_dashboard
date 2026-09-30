"""Multi-timeframe swing levels, the cascade trend state, volume around levels, and the
volatility-indicator comparison.

Swing levels per timeframe (1m, 5m, 15m, 30m): Williams fractals with k bars each side,
known at the close of bar i + k. A level is BROKEN on the first 1-minute close beyond it by
``buffer_atr`` x the ATR of the last completed 15-minute bar (support: close below; resistance:
close above), and retires then, or at its age cap.

Cascade (the user's rule): "the 1-minute passes a support, then the 5-minute support, then
the 15-minute, then the 30-minute = trend direction", and the mirror for resistance.
At minute m, for each timeframe t the LAST break (its side, minute and level price) is known.
``stage_down[m]`` is the largest s such that the last break on each of the first s timeframes
(1m, 5m, 15m, 30m in that order) is a support break AND their break minutes are in that order
(1m no later than 5m, ...) AND the latest of them is within ``window`` minutes of m.
``stage_up`` is the mirror. ``aligned_up`` / ``aligned_down`` count the timeframes whose last
break is in that direction regardless of order. ``direction`` is +1 when stage_up beats
stage_down, -1 when the reverse, 0 otherwise. Everything is causal: a minute's state uses
closes up to and including that minute.

Volume: ``expected_volume`` is the causal time-of-day volume profile (mean minute volume of
the same 5-minute bucket over the previous 20 sessions); ``relative_volume(k)`` = volume of the
last k minutes over the expected volume of those minutes; ``volume_trend(k)`` = OLS slope of
relative volume over the last k minutes, per minute, divided by its mean (a fraction per minute:
+0.05 = rising 5% of its level each minute).

Studies: ``volume_at_levels`` (does the volume of the approach change whether a level holds or
breaks, against a within-session shuffled-volume null) and ``volatility_indicators`` (which
causal volatility measure best anticipates the range and the follow-through of the next hour).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import talib
from numba import njit

from . import seasonality
from .data import aggregate
from .levels import _fractals, _test_all, atr_per_minute

TIMEFRAMES = ("1m", "5m", "15m", "30m")
WIDTH = {"1m": 1, "5m": 5, "15m": 15, "30m": 30}
# timeframe: (k bars each side, age cap in bars)
SWING_SPEC = {"1m": (3, 240), "5m": (3, 144), "15m": (2, 96), "30m": (2, 96)}
VOLUME_PROFILE_SESSIONS = 20


@njit(cache=True)
def _minute_breaks(close, atr, price, side, known, cap, buffer_atr):
    """First minute after ``known`` (within ``cap`` minutes) whose close is beyond the level by
    buffer_atr x ATR: -1 when it never breaks inside the cap."""
    n = close.shape[0]
    out = np.full(price.shape[0], -1, np.int64)
    for e in range(price.shape[0]):
        stop = min(known[e] + cap[e], n - 1)
        for m in range(known[e] + 1, stop + 1):
            a = atr[m]
            if not np.isfinite(a):
                continue
            if side[e] == 1:
                if close[m] > price[e] + buffer_atr * a:
                    out[e] = m
                    break
            else:
                if close[m] < price[e] - buffer_atr * a:
                    out[e] = m
                    break
    return out


def swing_levels(minutes: pd.DataFrame, atr_minute: np.ndarray, buffer_atr: float = 0.1) -> pd.DataFrame:
    """One row per swing level per timeframe: price, side (+1 resistance = swing high, -1 support =
    swing low), known_minute (index of the minute at whose close it is known), retire_minute (the age
    cap), break_minute (the first 1-minute close beyond it, -1 if none before the cap)."""
    close = minutes["close"].to_numpy(float)
    frames = []
    for tf in TIMEFRAMES:
        k, cap = SWING_SPEC[tf]
        bars, _ = aggregate(minutes, WIDTH[tf])
        h, l, c = (bars[x].to_numpy(float) for x in ("high", "low", "close"))
        last = bars["last_minute_index"].to_numpy(np.int64)
        atr_bars = talib.ATR(h, l, c, 14)
        i, side, _ = _fractals(h, l, c, atr_bars, k, cap, buffer_atr)
        known = last[np.minimum(i + k, last.size - 1)]
        cap_minutes = np.full(i.size, cap * WIDTH[tf], np.int64)
        break_minute = _minute_breaks(close, atr_minute, np.where(side == 1, h[i], l[i]), side.astype(np.int8), known,
                                      cap_minutes, buffer_atr)
        frames.append(pd.DataFrame({"timeframe": tf, "price": np.where(side == 1, h[i], l[i]), "side": side.astype(np.int8),
                                    "bar_index": i, "known_minute": known,
                                    "retire_minute": np.minimum(known + cap_minutes, close.size - 1),
                                    "break_minute": break_minute}))
    return pd.concat(frames, ignore_index=True)


@dataclass
class Cascade:
    stage_up: np.ndarray            # per minute, 0..4
    stage_down: np.ndarray
    aligned_up: np.ndarray
    aligned_down: np.ndarray
    direction: np.ndarray           # +1 / -1 / 0
    last_side: dict = field(default_factory=dict)     # timeframe -> per-minute side of the last break (0 none)
    last_minute: dict = field(default_factory=dict)   # timeframe -> per-minute minute of the last break (-1 none)
    last_price: dict = field(default_factory=dict)    # timeframe -> per-minute price of the last broken level
    levels: pd.DataFrame | None = None


def _forward_fill_events(n: int, at: np.ndarray, values: np.ndarray, fill):
    """Per-minute value of the most recent event at or before each minute."""
    out = np.full(n, fill, dtype=np.asarray(values).dtype if not isinstance(fill, float) else float)
    order = np.argsort(at, kind="stable")
    out[at[order]] = np.asarray(values)[order]
    marker = np.full(n, -1, np.int64)
    marker[at] = at
    marker = np.maximum.accumulate(marker)
    return np.where(marker >= 0, out[np.maximum(marker, 0)], fill)


def build(minutes: pd.DataFrame, window_minutes: int = 120, buffer_atr: float = 0.1,
          levels: pd.DataFrame | None = None) -> Cascade:
    n = len(minutes)
    atr_minute = atr_per_minute(minutes)
    levels = swing_levels(minutes, atr_minute, buffer_atr) if levels is None else levels
    broken = levels[levels["break_minute"] >= 0]
    sides, minutes_of, prices = {}, {}, {}
    for tf in TIMEFRAMES:
        b = broken[broken["timeframe"] == tf]
        at = b["break_minute"].to_numpy(np.int64)
        # a support break is a DOWN break (-1); a resistance break is an UP break (+1): the level's side
        sides[tf] = _forward_fill_events(n, at, b["side"].to_numpy(np.int8), np.int8(0)).astype(np.int8)
        minutes_of[tf] = _forward_fill_events(n, at, at, np.int64(-1)).astype(np.int64)
        prices[tf] = _forward_fill_events(n, at, b["price"].to_numpy(float), np.nan)
    m = np.arange(n)
    stage = {}
    aligned = {}
    for direction, name in ((1, "up"), (-1, "down")):
        best = np.zeros(n, dtype=np.int8)
        for s in range(1, len(TIMEFRAMES) + 1):
            # the chain read top-down: the stage-s timeframe's LAST break is in this direction and recent; at the
            # minute it broke, the next-lower timeframe's last break was in this direction, at a level not beyond it,
            # and so on down to the 1-minute level. "The 1m broke, then the 5m, then the 15m, then the 30m."
            top = TIMEFRAMES[s - 1]
            valid = (sides[top] == direction) & (minutes_of[top] >= 0) & (m - minutes_of[top] <= window_minutes)
            at = np.maximum(minutes_of[top], 0)
            level = prices[top]
            for j in range(s - 2, -1, -1):
                tf = TIMEFRAMES[j]
                side_then, minute_then, price_then = sides[tf][at], minutes_of[tf][at], prices[tf][at]
                with np.errstate(invalid="ignore"):
                    not_beyond = price_then <= level if direction == 1 else price_then >= level
                valid &= (side_then == direction) & (minute_then >= 0) & (m - minute_then <= window_minutes) & not_beyond
                at = np.maximum(minute_then, 0)
                level = price_then
            best = np.where(valid, np.int8(s), best)
        stage[name] = best
        aligned[name] = sum((sides[tf] == direction).astype(np.int8) for tf in TIMEFRAMES).astype(np.int8)
    direction = np.where(stage["up"] > stage["down"], 1, np.where(stage["down"] > stage["up"], -1, 0)).astype(np.int8)
    return Cascade(stage_up=stage["up"], stage_down=stage["down"], aligned_up=aligned["up"], aligned_down=aligned["down"],
                   direction=direction, last_side=sides, last_minute=minutes_of, last_price=prices, levels=levels)


# ── volume ───────────────────────────────────────────────────────────────────
def expected_volume(minutes: pd.DataFrame, session_days: np.ndarray, sessions: int = VOLUME_PROFILE_SESSIONS) -> np.ndarray:
    """Per minute: mean minute volume of this minute's 5-minute bucket over the previous ``sessions``
    sessions (NaN until enough history)."""
    stamps = minutes["timestamp"].to_numpy(np.int64)
    volume = minutes["volume"].to_numpy(float)
    offset = seasonality.session_offset(stamps)
    inside = offset < seasonality.SESSION_MINUTES
    new_session = np.r_[True, session_days[1:] != session_days[:-1]]
    session = np.cumsum(new_session) - 1
    n_sessions = int(session[-1]) + 1
    bucket = np.minimum(offset // seasonality.BUCKET_MINUTES, seasonality.BUCKETS - 1)
    flat = session * seasonality.BUCKETS + bucket
    total = np.bincount(flat[inside], weights=volume[inside], minlength=n_sessions * seasonality.BUCKETS)
    count = np.bincount(flat[inside], minlength=n_sessions * seasonality.BUCKETS)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = (total / np.where(count > 0, count, np.nan)).reshape(n_sessions, seasonality.BUCKETS)
    profile = seasonality._trailing_mean(mean, sessions, max(sessions // 2, 5))
    return np.where(inside, profile[session, bucket], np.nan)


def relative_volume(volume: np.ndarray, expected: np.ndarray, k: int) -> np.ndarray:
    v = np.r_[0.0, np.cumsum(np.nan_to_num(volume))]
    e = np.r_[0.0, np.cumsum(np.nan_to_num(expected))]
    known = np.r_[0, np.cumsum(np.isfinite(expected))]
    idx = np.arange(volume.size) + 1
    lo = np.maximum(idx - k, 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = (v[idx] - v[lo]) / (e[idx] - e[lo])
    return np.where((known[idx] - known[lo]) == (idx - lo), out, np.nan)


def volume_trend(volume: np.ndarray, expected: np.ndarray, k: int) -> np.ndarray:
    """OLS slope of relative minute volume over the last k minutes, divided by its mean over them."""
    with np.errstate(invalid="ignore", divide="ignore"):
        y = volume / expected
    finite = np.isfinite(y)
    y0 = np.where(finite, y, 0.0)
    idx = np.arange(volume.size)
    sy = np.r_[0.0, np.cumsum(y0)]
    sxy = np.r_[0.0, np.cumsum(idx * y0)]
    cnt = np.r_[0, np.cumsum(finite)]
    end = idx + 1
    lo = np.maximum(end - k, 0)
    kk = end - lo
    sum_y = sy[end] - sy[lo]
    sum_xy = sxy[end] - sxy[lo] - lo * sum_y          # x measured from the window start
    sum_x = kk * (kk - 1) / 2.0
    sum_x2 = (kk - 1) * kk * (2 * kk - 1) / 6.0
    with np.errstate(invalid="ignore", divide="ignore"):
        slope = (kk * sum_xy - sum_x * sum_y) / (kk * sum_x2 - sum_x ** 2)
        out = slope / (sum_y / kk)
    return np.where((cnt[end] - cnt[lo] == kk) & (kk >= 3), out, np.nan)


# ── studies ──────────────────────────────────────────────────────────────────
def delayed_oracle(minutes: pd.DataFrame, session_days: np.ndarray, levels: pd.DataFrame, tick: float,
                   cost_ticks: float) -> pd.DataFrame:
    """The most a trader could earn per session day who knows the FUTURE pivot but can only act once
    the CURRENT one is confirmed: at each confirmed swing (known_minute), trade from that close toward
    the next opposite swing of the same timeframe and exit exactly at its price; skip trades that
    would lose after costs. Causal entry, perfect exit: an upper bound for cascade-style trading."""
    close = minutes["close"].to_numpy(float)
    rows = []
    for tf in TIMEFRAMES:
        lv = levels[levels["timeframe"] == tf].sort_values("bar_index")
        side = lv["side"].to_numpy(np.int8)
        price = lv["price"].to_numpy(float)
        known = lv["known_minute"].to_numpy(np.int64)
        alternate = np.r_[True, side[1:] != side[:-1]]        # keep the first of consecutive same-side swings
        side, price, known = side[alternate], price[alternate], known[alternate]
        entry = close[np.minimum(known[:-1], close.size - 1)]
        target = price[1:]
        direction = np.where(side[:-1] == 1, -1.0, 1.0)      # after a confirmed swing high the next swing is a low
        net = direction * (target - entry) / tick - cost_ticks
        net = np.where(net > 0, net, 0.0)
        day = session_days[np.minimum(known[:-1], close.size - 1)]
        daily = pd.Series(net).groupby(day).sum()
        daily = daily.reindex(np.unique(session_days), fill_value=0.0)
        rows.append({"timeframe": tf, "session_day_count": int(daily.size), "trades_per_session_day": float((net > 0).sum() / daily.size),
                     "ceiling_net_ticks_per_session_day_mean": float(daily.mean()),
                     "ceiling_net_ticks_per_session_day_median": float(daily.median()),
                     "ceiling_net_ticks_per_session_day_percentile_25": float(daily.quantile(0.25)),
                     "ceiling_net_ticks_per_session_day_percentile_75": float(daily.quantile(0.75)),
                     "share_of_session_days_at_or_above_600": float((daily >= 600).mean()),
                     "required_capture_share_for_600": float(600.0 / daily.mean()) if daily.mean() > 0 else np.nan})
    return pd.DataFrame(rows)


def stage_forward_moves(minutes: pd.DataFrame, session_days: np.ndarray, cascade: Cascade, tick: float,
                        horizons=(15, 30, 60, 120), bootstrap: int = 200, seed: int = 5) -> pd.DataFrame:
    """Does the cascade point the way? For every minute at which a stage is FIRST reached (the entry
    moment), the signed move over the next h minutes in ticks (positive = in the cascade's direction),
    against the unconditional move at the same session part; session-block bootstrap intervals."""
    close = minutes["close"].to_numpy(float)
    n = close.size
    part = seasonality.session_part(seasonality.session_offset(minutes["timestamp"].to_numpy(np.int64)))
    session = np.cumsum(np.r_[True, session_days[1:] != session_days[:-1]]) - 1
    n_sessions = int(session[-1]) + 1
    rng = np.random.default_rng(seed)
    rows = []
    for direction, stage in ((1, cascade.stage_up), (-1, cascade.stage_down)):
        for s in (1, 2, 3, 4):
            reached = (stage >= s) & ~np.r_[False, (stage >= s)[:-1]]          # first minute at or above stage s
            for h in horizons:
                move = np.r_[close[h:], np.full(h, np.nan)] - close
                signed = direction * move / tick
                for scope in ("all", "overnight", "regular_hours"):
                    sel = reached & np.isfinite(signed) & (np.ones(n, bool) if scope == "all" else part == scope)
                    base = np.isfinite(signed) & (np.ones(n, bool) if scope == "all" else part == scope)
                    if sel.sum() < 30:
                        continue
                    draws = []
                    for _ in range(bootstrap):
                        pick = rng.integers(0, n_sessions, n_sessions)
                        keep = np.isin(session, pick) & sel
                        if keep.sum() >= 10:
                            draws.append(float(np.mean(signed[keep])))
                    rows.append({"direction": "up" if direction == 1 else "down", "stage": s, "horizon_minutes": h, "session_part": scope,
                                 "events": int(sel.sum()), "events_per_session_day": float(sel.sum() / n_sessions),
                                 "mean_signed_move_ticks": float(np.mean(signed[sel])),
                                 "bootstrap_low": float(np.percentile(draws, 2.5)) if draws else np.nan,
                                 "bootstrap_high": float(np.percentile(draws, 97.5)) if draws else np.nan,
                                 "share_positive": float((signed[sel] > 0).mean()),
                                 "unconditional_mean_signed_move_ticks": float(direction * np.mean(move[base] / tick)),
                                 "mean_absolute_move_ticks": float(np.mean(np.abs(signed[sel])))})
    return pd.DataFrame(rows)


def _wilson(successes: np.ndarray, n: np.ndarray, z: float = 1.96):
    with np.errstate(invalid="ignore", divide="ignore"):
        p = successes / n
        centre = (p + z * z / (2 * n)) / (1 + z * z / n)
        half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return centre - half, centre + half


def volume_at_levels(minutes: pd.DataFrame, session_days: np.ndarray, levels: pd.DataFrame, approach_minutes: int = 10,
                     shuffles: int = 5, seed: int = 7, tolerance_atr: float = 0.1, move_atr: float = 1.0):
    """Every first test of every swing level (held: reversed 1 ATR; broke: passed 1 ATR through) with the
    relative volume and volume trend of the approach; break rate by decile per timeframe and session part,
    beside the same deciles computed on volume shuffled within each session (the null: same tests, same
    levels, volume carrying no information)."""
    high, low, close = (minutes[x].to_numpy(float) for x in ("high", "low", "close"))
    volume = minutes["volume"].to_numpy(float)
    stamps = minutes["timestamp"].to_numpy(np.int64)
    atr = atr_per_minute(minutes)
    expected = expected_volume(minutes, session_days)
    start = levels["known_minute"].to_numpy(np.int64)
    stop = levels["retire_minute"].to_numpy(np.int64)
    a = atr[np.minimum(start, atr.size - 1)]
    ok = np.isfinite(a) & (a > 0) & (stop > start)
    minute, side, outcome = _test_all(high, low, close, start[ok], stop[ok], levels["price"].to_numpy(float)[ok],
                                      tolerance_atr * a[ok], move_atr * a[ok])
    resolved = outcome != 0
    tests = levels[ok].reset_index(drop=True)[resolved].reset_index(drop=True)
    tests["test_minute"] = minute[resolved]
    tests["tested_side"] = side[resolved]
    tests["broke"] = (outcome[resolved] == -1).astype(int)
    tests["session_part"] = seasonality.session_part(seasonality.session_offset(stamps[tests["test_minute"]]))
    tests["session_date"] = session_days[tests["test_minute"]]
    tests["relative_volume"] = relative_volume(volume, expected, approach_minutes)[tests["test_minute"]]
    tests["volume_trend"] = volume_trend(volume, expected, approach_minutes)[tests["test_minute"]]
    approach_range = pd.Series(high).rolling(approach_minutes).max().to_numpy() - pd.Series(low).rolling(approach_minutes).min().to_numpy()
    tests["approach_range_over_atr"] = (approach_range / atr)[tests["test_minute"]]
    session = np.cumsum(np.r_[True, session_days[1:] != session_days[:-1]]) - 1
    rng = np.random.default_rng(seed)
    null_rel, null_trend = [], []
    for _ in range(shuffles):
        shuffled = pd.Series(volume).groupby(session).transform(lambda x: rng.permutation(x.to_numpy())).to_numpy()
        null_rel.append(relative_volume(shuffled, expected, approach_minutes)[tests["test_minute"]])
        null_trend.append(volume_trend(shuffled, expected, approach_minutes)[tests["test_minute"]])
    rows = []
    for measure, real, nulls in (("relative_volume", tests["relative_volume"].to_numpy(), null_rel),
                                 ("volume_trend", tests["volume_trend"].to_numpy(), null_trend)):
        for tf in ("all",) + TIMEFRAMES:
            for part in ("all", "overnight", "regular_hours"):
                mask = np.isfinite(real)
                if tf != "all":
                    mask &= (tests["timeframe"] == tf).to_numpy()
                if part != "all":
                    mask &= (tests["session_part"] == part).to_numpy()
                if mask.sum() < 200:
                    continue
                edges = np.nanquantile(real[mask], np.linspace(0, 1, 11))
                decile = np.clip(np.searchsorted(edges, real[mask], side="right") - 1, 0, 9)
                broke = tests["broke"].to_numpy()[mask]
                for d in range(10):
                    sel = decile == d
                    n = int(sel.sum())
                    if n == 0:
                        continue
                    hits = int(broke[sel].sum())
                    low_ci, high_ci = _wilson(np.array([hits], float), np.array([n], float))
                    null_rates = []
                    for shuffled_values in nulls:
                        sv = shuffled_values[mask]
                        e2 = np.nanquantile(sv[np.isfinite(sv)], np.linspace(0, 1, 11))
                        d2 = np.clip(np.searchsorted(e2, sv, side="right") - 1, 0, 9)
                        s2 = (d2 == d) & np.isfinite(sv)
                        if s2.sum():
                            null_rates.append(broke[s2].mean())
                    rows.append({"measure": measure, "timeframe": tf, "session_part": part, "decile": d + 1,
                                 "measure_low": float(edges[d]), "measure_high": float(edges[d + 1]), "tests": n,
                                 "break_rate": hits / n, "break_rate_wilson_low": float(low_ci[0]), "break_rate_wilson_high": float(high_ci[0]),
                                 "shuffled_volume_break_rate": float(np.mean(null_rates)) if null_rates else np.nan})
    summary = []
    for measure in ("relative_volume", "volume_trend", "approach_range_over_atr"):
        x = tests[measure].to_numpy(float)
        y = tests["broke"].to_numpy(float)
        r = tests["approach_range_over_atr"].to_numpy(float)
        ok = np.isfinite(x) & np.isfinite(r)
        # partial: the measure with the approach's own range regressed out (volume tracks range mechanically)
        beta = np.polyfit(np.log1p(np.maximum(r[ok], 0)), x[ok], 1) if measure != "approach_range_over_atr" else None
        residual = x - (beta[0] * np.log1p(np.maximum(r, 0)) + beta[1]) if beta is not None else x
        summary.append({"measure": measure, "tests": int(ok.sum()), "spearman_with_break": _spearman(x, y),
                        "spearman_with_break_given_range": _spearman(np.where(ok, residual, np.nan), y),
                        "spearman_with_approach_range": _spearman(x, r) if measure != "approach_range_over_atr" else 1.0})
    return tests, pd.DataFrame(rows), pd.DataFrame(summary)


def _spearman(x: np.ndarray, y: np.ndarray) -> float:
    ok = np.isfinite(x) & np.isfinite(y)
    if ok.sum() < 30:
        return np.nan
    rx = pd.Series(x[ok]).rank().to_numpy()
    ry = pd.Series(y[ok]).rank().to_numpy()
    return float(np.corrcoef(rx, ry)[0, 1])


def volatility_indicators(minutes: pd.DataFrame, session_days: np.ndarray, cascade: Cascade, seasonal, bar_minutes: int = 5,
                          ahead_minutes: int = 60, bootstrap: int = 200, seed: int = 11) -> pd.DataFrame:
    """At every ``bar_minutes`` bar: causal volatility measures, and the outcome over the next
    ``ahead_minutes``: range ahead / ATR (expansion) and, on bars where the cascade points a way,
    the move in that direction / ATR (follow-through). Spearman per measure with a session-block
    bootstrap interval, per session part."""
    bars, _ = aggregate(minutes, bar_minutes)
    h, l, c, o, v = (bars[x].to_numpy(float) for x in ("high", "low", "close", "open", "volume"))
    last = bars["last_minute_index"].to_numpy(np.int64)
    n = h.size
    atr = talib.ATR(h, l, c, 14)
    upper, middle, lower = talib.BBANDS(c, 20, 2.0, 2.0)
    from .rules import prior_percentile

    width = (upper - lower) / middle
    keltner_upper = talib.EMA(c, 20) + 1.5 * atr
    keltner_lower = talib.EMA(c, 20) - 1.5 * atr
    tr = talib.TRANGE(h, l, c)
    tr_sum = pd.Series(tr).rolling(14).sum().to_numpy()
    hh = pd.Series(h).rolling(14).max().to_numpy()
    ll = pd.Series(l).rolling(14).min().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        chop = 100 * np.log10(tr_sum / (hh - ll)) / np.log10(14)
        log_hl = np.log(h / l) ** 2
        parkinson = np.sqrt(pd.Series(log_hl).rolling(12).mean().to_numpy() / (4 * np.log(2)))
        returns = np.r_[np.nan, np.diff(np.log(c))]
    realised = pd.Series(returns).rolling(12).std().to_numpy()
    expected = expected_volume(minutes, session_days)
    volume = minutes["volume"].to_numpy(float)
    measures = {
        "normalized_average_true_range_14": talib.NATR(h, l, c, 14),
        "bollinger_bandwidth_20_percentile_200": prior_percentile(width, 200),
        "bollinger_inside_keltner_squeeze": ((upper < keltner_upper) & (lower > keltner_lower)).astype(float),
        "choppiness_index_14": chop,
        "average_directional_index_14": talib.ADX(h, l, c, 14),
        "parkinson_volatility_12_bars": parkinson,
        "realized_volatility_12_bars": realised,
        "seasonal_ahead_ratio_60_minutes": seasonal.ahead_ratio(last, ahead_minutes),
        "seasonal_heat": seasonal.heat[last],
        "relative_volume_15_minutes": relative_volume(volume, expected, 15)[last],
        "volume_trend_15_minutes": volume_trend(volume, expected, 15)[last],
    }
    ahead_bars = ahead_minutes // bar_minutes
    future_high = pd.Series(h[::-1]).rolling(ahead_bars).max().to_numpy()[::-1]
    future_low = pd.Series(l[::-1]).rolling(ahead_bars).min().to_numpy()[::-1]
    future_high = np.r_[future_high[1:], np.nan]
    future_low = np.r_[future_low[1:], np.nan]
    future_close = np.r_[c[ahead_bars:], np.full(ahead_bars, np.nan)]
    with np.errstate(invalid="ignore", divide="ignore"):
        expansion = (future_high - future_low) / atr
        direction = cascade.direction[last].astype(float)
        follow_through = direction * (future_close - c) / atr
    part = seasonality.session_part(seasonality.session_offset(bars["timestamp"].to_numpy(np.int64)))
    session = np.cumsum(np.r_[True, session_days[last][1:] != session_days[last][:-1]]) - 1
    rng = np.random.default_rng(seed)
    n_sessions = int(session[-1]) + 1
    rows = []
    for name, x in measures.items():
        for scope in ("all", "overnight", "regular_hours"):
            mask = np.ones(n, bool) if scope == "all" else part == scope
            for outcome_name, y, extra in (("range_ahead_over_atr", expansion, np.ones(n, bool)),
                                           ("follow_through_over_atr", follow_through, direction != 0)):
                sel = mask & extra & np.isfinite(x) & np.isfinite(y)
                rho = _spearman(x[sel], y[sel])
                draws = []
                for _ in range(bootstrap):
                    pick = rng.integers(0, n_sessions, n_sessions)
                    keep = np.isin(session, pick) & sel
                    draws.append(_spearman(x[keep], y[keep]))
                draws = np.array([d for d in draws if np.isfinite(d)])
                rows.append({"measure": name, "session_part": scope, "outcome": outcome_name, "bars": int(sel.sum()),
                             "spearman": rho, "spearman_bootstrap_low": float(np.percentile(draws, 2.5)) if draws.size else np.nan,
                             "spearman_bootstrap_high": float(np.percentile(draws, 97.5)) if draws.size else np.nan})
    return pd.DataFrame(rows)
