"""Trading AT the multi-timeframe support/resistance zones: what happens when price first touches a zone.

A zone is what ``levels.zones_for_bars`` builds at each strategy-bar close: the merged levels (prior
session / RTH / week highs, lows and closes, opening ranges, round numbers, Williams fractals on
15m / 1h / 4h, the 5m / 15m / 30m swing levels, session VWAP bands) within 6 ATR of the close,
single-linked into zones, with ``strength`` = distinct level families in the zone. The zones of bar b
are known at its close and used on the minutes of bar b + 1.

A TOUCH: the first minute whose low enters the support zone (low <= zone top + tolerance) while the
previous close was above it; the mirror for resistance. One touch per (zone top, side, session).

Outcomes, on the 1-minute path after the touch minute:
- ``bounced``: price moved ``move_atr`` x ATR away from the zone edge before closing through the far
  edge by ``buffer_atr`` x ATR (the same first-passage test as ``levels.level_quality``);
- ``reached_next_zone``: the opposing zone's near edge (known at the touch bar) was reached before the
  touched zone broke;
- ``favourable_ticks``: the best excursion away from the zone within ``horizon_minutes``;
- the null: the same tests on distance-matched pseudo levels (the zone edge's signed distance from the
  price at the touch bar, in ATR, re-applied at the same time of day in random other sessions).

Conditioning: zone strength, the families and timeframes in the zone, session part, approach speed
and length, RSI at the touch bar, relative volume, the time-of-day expected-volatility ratio.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import talib
from numba import njit

from . import cascade, seasonality
from .levels import _test_all, atr_per_minute


@njit(cache=True)
def _race(high, low, close, start, stop, side, edge, buffer, target):
    """From ``start`` to ``stop``: +1 if the target is reached first, -1 if the zone breaks first (a close
    beyond the far edge by ``buffer``), 0 if neither. ``side`` +1 = support touched (target above), -1 =
    resistance touched (target below). ``edge`` is the FAR edge of the zone."""
    n = start.shape[0]
    out = np.zeros(n, np.int8)
    best = np.zeros(n, np.float64)
    for e in range(n):
        s = side[e]
        b = 0.0
        for m in range(start[e], stop[e]):
            if s == 1:
                if high[m] - close[start[e] - 1] > b:
                    b = high[m] - close[start[e] - 1]
                if high[m] >= target[e]:
                    out[e] = 1
                    break
                if close[m] < edge[e] - buffer[e]:
                    out[e] = -1
                    break
            else:
                if close[start[e] - 1] - low[m] > b:
                    b = close[start[e] - 1] - low[m]
                if low[m] <= target[e]:
                    out[e] = 1
                    break
                if close[m] > edge[e] + buffer[e]:
                    out[e] = -1
                    break
        best[e] = b
    return out, best


def touches(
    ctx,
    horizon_minutes: int = 240,
    tolerance_atr: float = 0.1,
    move_atr: float = 1.0,
    buffer_atr: float = 0.1,
    leak: bool = False,
) -> pd.DataFrame:
    """One row per first touch of a zone on the rebuilt minutes of ``ctx`` (a strategy Context).

    ``leak=True`` is the deliberately leaky control: the zones of bar b are applied to the minutes of bar b
    itself, so a zone built from the touch bar's extreme is "touched" by that extreme. Its bounce rate must
    sit above the honest one; the study prints the separation."""
    m = ctx.minutes
    stamps, high, low, close = m.stamps, m.high, m.low, m.close
    n = stamps.size
    atr = atr_per_minute(ctx.minutes_frame)
    zones = ctx.zones
    # zones of bar b apply to the minutes of bar b + 1 (of bar b itself under the leaky control)
    bar_of_minute = np.searchsorted(
        ctx.last_minute, np.arange(n), side="left"
    )  # index of the bar containing each minute
    previous_bar = bar_of_minute if leak else bar_of_minute - 1
    valid_bar = previous_bar >= 0
    pb = np.clip(previous_bar, 0, None)
    columns = {}
    for name in (
        "support_low",
        "support_high",
        "support_strength",
        "resistance_low",
        "resistance_high",
        "resistance_strength",
    ):
        columns[name] = np.where(valid_bar, zones[name].to_numpy(float)[pb], np.nan)
    families = {
        side: zones[f"{side}_families"].to_numpy(object)[pb] for side in ("support", "resistance")
    }
    previous_close = np.r_[np.nan, close[:-1]]
    opens = ctx.minutes_frame["open"].to_numpy(float)
    tolerance = tolerance_atr * atr
    rows = []
    for side_name, s in (("support", 1), ("resistance", -1)):
        near = columns[f"{side_name}_high"] if s == 1 else columns[f"{side_name}_low"]
        far = columns[f"{side_name}_low"] if s == 1 else columns[f"{side_name}_high"]
        if s == 1:
            hit = (low <= near + tolerance) & (previous_close > near + tolerance)
        else:
            hit = (high >= near - tolerance) & (previous_close < near - tolerance)
        hit &= np.isfinite(near) & np.isfinite(atr) & (atr > 0) & valid_bar
        idx = np.flatnonzero(hit)
        if idx.size == 0:
            continue
        frame = pd.DataFrame(
            {
                "minute": idx,
                "side": s,
                "side_name": side_name,
                "near_edge": near[idx],
                "far_edge": far[idx],
                "strength": columns[f"{side_name}_strength"][idx],
                "families": families[side_name][idx],
                "atr": atr[idx],
                "session_id": m.session_id[idx],
                "session_date": m.days[idx],
            }
        )
        # opposing zone at the touch bar: the target of a bounce
        opposing = columns["resistance_low"] if s == 1 else columns["support_high"]
        frame["opposing_edge"] = opposing[idx]
        # a minute that OPENS beyond the far edge gapped through the zone: logged, never a bounce candidate
        frame["gapped_through"] = (opens[idx] < far[idx]) if s == 1 else (opens[idx] > far[idx])
        frame["zone_key"] = np.round(frame["near_edge"] / ctx.tick).astype(np.int64)
        frame = frame.drop_duplicates(["zone_key", "side", "session_id"], keep="first")
        rows.append(frame)
    t = pd.concat(rows, ignore_index=True).sort_values("minute").reset_index(drop=True)
    start = t["minute"].to_numpy(np.int64) + 1
    stop = np.minimum(start + horizon_minutes, n)
    ok = start < n
    t = t[ok].reset_index(drop=True)
    start, stop = start[ok], stop[ok]
    a = t["atr"].to_numpy(float)
    side = t["side"].to_numpy(np.int8)
    near = t["near_edge"].to_numpy(float)
    far = t["far_edge"].to_numpy(float)
    # bounce test: the same first-passage rule as level_quality on the zone's near edge
    _, _, outcome = _test_all(
        high,
        low,
        close,
        t["minute"].to_numpy(np.int64),
        stop,
        near,
        tolerance_atr * a,
        move_atr * a,
    )
    gap = t["gapped_through"].to_numpy(bool)
    t["bounced"] = (outcome == 1) & ~gap
    t["broke"] = (outcome == -1) | gap
    t["resolved"] = (outcome != 0) | gap
    t["timed_out"] = (outcome == 0) & ~gap
    opposing = t["opposing_edge"].to_numpy(float)
    has_target = np.isfinite(opposing)
    race, best = _race(
        high,
        low,
        close,
        start,
        stop,
        side,
        far,
        buffer_atr * a,
        np.where(has_target, opposing, np.where(side == 1, np.inf, -np.inf)),
    )
    t["reached_next_zone"] = (race == 1) & has_target
    t["broke_before_next_zone"] = race == -1
    t["favourable_ticks"] = best / ctx.tick
    t["next_zone_distance_ticks"] = np.where(has_target, np.abs(opposing - near) / ctx.tick, np.nan)
    t["zone_width_ticks"] = np.abs(near - far) / ctx.tick
    t["stop_ticks_zone_to_zone"] = t["zone_width_ticks"] + buffer_atr * a / ctx.tick
    # E = p T - (1 - p) S - 5.56 - (1 - p) x 1 tick stop slippage = 0  ->  p* = (S + 6.56) / (S + T + 1)
    t["break_even_hit_rate_zone_to_zone"] = (t["stop_ticks_zone_to_zone"] + 6.56) / (
        t["stop_ticks_zone_to_zone"] + t["next_zone_distance_ticks"] + 1
    )
    # conditioning features, all at or before the touch minute
    minute = t["minute"].to_numpy(np.int64)
    t["session_part"] = seasonality.session_part(seasonality.session_offset(stamps[minute]))
    t["hour_pacific"] = ((stamps[minute] % 86400) // 3600).astype(int)
    back = np.maximum(minute - 10, 0)
    t["approach_speed_ticks_per_minute"] = side * (close[back] - close[minute]) / ctx.tick / 10
    t["approach_length_atr"] = np.where(has_target, np.abs(opposing - near) / a, np.nan)
    bars_close = ctx.bars["close"]
    rsi = talib.RSI(bars_close, 14)
    t["rsi_14_previous_bar"] = rsi[np.clip(previous_bar[minute], 0, rsi.size - 1)]
    expected = cascade.expected_volume(ctx.minutes_frame, m.days)
    volume = ctx.minutes_frame["volume"].to_numpy(float)
    t["relative_volume_15"] = cascade.relative_volume(volume, expected, 15)[minute]
    seasonal = seasonality.build(ctx.minutes_frame, m.days)
    t["seasonal_ahead_ratio_30"] = seasonal.ahead_ratio(minute, 30)
    t["seasonal_expected_move_60_ticks"] = seasonal.expected_move_points(minute, 60) / ctx.tick
    fam = t["families"].astype(str)
    t["has_session_level"] = fam.str.contains("session|overnight|opening_range|week")
    t["has_round_number"] = fam.str.contains("round")
    t["has_fractal_1h_or_4h"] = fam.str.contains("fractal_1h|fractal_4h")
    t["has_swing_30m"] = fam.str.contains("swing_30m")
    t["has_vwap"] = fam.str.contains("vwap")
    t["timestamp"] = pd.to_datetime(stamps[minute], unit="s")
    return t


def matched_null(
    ctx,
    t: pd.DataFrame,
    permutations: int = 10,
    seed: int = 3,
    horizon_minutes: int = 240,
    tolerance_atr: float = 0.1,
    move_atr: float = 1.0,
    buffer_atr: float = 0.1,
) -> pd.DataFrame:
    """The bounce test on distance-matched pseudo zones: each touch's near edge is re-applied at the same
    signed ATR distance from the price, at the same session offset, in random other sessions; and the
    zone-to-zone race on a pseudo far edge and pseudo next zone at the same distances. Returns per-touch
    null bounce, resolved and next-zone-reach rates."""
    m = ctx.minutes
    atr = atr_per_minute(ctx.minutes_frame)
    minute = t["minute"].to_numpy(np.int64)
    a = t["atr"].to_numpy(float)
    distance = (t["near_edge"].to_numpy(float) - m.close[np.maximum(minute - 1, 0)]) / a
    session_of = m.session_id[minute]
    session_start = np.flatnonzero(np.r_[True, m.session_id[1:] != m.session_id[:-1]])
    session_end = np.r_[session_start[1:], m.stamps.size]
    offset = minute - session_start[session_of]
    n_sessions = session_start.size
    far_distance = (t["far_edge"].to_numpy(float) - m.close[np.maximum(minute - 1, 0)]) / a
    target_distance = (t["opposing_edge"].to_numpy(float) - m.close[np.maximum(minute - 1, 0)]) / a
    side = t["side"].to_numpy(np.int8)
    has_target = np.isfinite(target_distance)
    rng = np.random.default_rng(seed)
    bounced = np.zeros((permutations, minute.size))
    resolved = np.zeros((permutations, minute.size))
    reached = np.zeros((permutations, minute.size))
    for p in range(permutations):
        other = (session_of + rng.integers(1, n_sessions, size=minute.size)) % n_sessions
        pstart = np.minimum(session_start[other] + offset, session_end[other] - 2)
        pstart = np.maximum(pstart, 1)
        pstop = np.minimum(pstart + horizon_minutes, m.stamps.size)
        pa = atr[pstart]
        good = np.isfinite(pa) & (pa > 0)
        pa = np.where(good, pa, 1.0)
        plevel = m.close[pstart - 1] + distance * pa
        pminute, pside, pout = _test_all(
            m.high, m.low, m.close, pstart, pstop, plevel, tolerance_atr * pa, move_atr * pa
        )
        res = good & (pside != 0) & (pout != 0)
        resolved[p] = res
        bounced[p] = np.where(res, pout == 1, np.nan)
        # zone-to-zone null: the race starts where the pseudo level is first TESTED (matched on the approach), on a
        # pseudo far edge and pseudo next zone at the same signed ATR distances
        tested = good & (pside != 0)
        race_start = np.where(tested, pminute + 1, pstart)
        pfar = m.close[pstart - 1] + far_distance * pa
        ptarget = np.where(
            has_target, m.close[pstart - 1] + target_distance * pa, np.where(side == 1, np.inf, -np.inf)
        )
        race, _ = _race(m.high, m.low, m.close, race_start, pstop, side, pfar, buffer_atr * pa, ptarget)
        reached[p] = np.where(tested & has_target, race == 1, np.nan)
    return pd.DataFrame(
        {
            "null_bounce_rate": np.nanmean(bounced, axis=0),
            "null_resolved_share": resolved.mean(axis=0),
            "null_next_zone_reach_rate": np.nanmean(reached, axis=0),
        }
    )


def _wilson(k: int, n: int, z: float = 1.96):
    if n == 0:
        return np.nan, np.nan
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return centre - half, centre + half


def _benjamini_hochberg(p: np.ndarray, q: float = 0.10) -> np.ndarray:
    """Which of the p-values survive Benjamini-Hochberg at rate ``q`` (NaN never survives)."""
    p = np.asarray(p, float)
    ok = np.isfinite(p)
    survive = np.zeros(p.size, bool)
    if ok.sum() == 0:
        return survive
    order = np.argsort(p[ok])
    sorted_p = p[ok][order]
    m = sorted_p.size
    threshold = q * (np.arange(1, m + 1) / m)
    below = np.flatnonzero(sorted_p <= threshold)
    if below.size:
        k = below.max()
        survive[np.flatnonzero(ok)[order[: k + 1]]] = True
    return survive


def _bootstrap_p(draws: list[float]) -> float:
    """Two-sided bootstrap p-value of a mean difference: twice the smaller tail share across zero."""
    if not draws:
        return np.nan
    d = np.asarray(draws)
    return float(min(1.0, 2 * min((d <= 0).mean(), (d >= 0).mean())))


def _session_bootstrap(
    values: np.ndarray, session: np.ndarray, n_sessions: int, bootstrap: int, rng
) -> list[float]:
    """Session-block bootstrap of the mean of ``values`` (NaN skipped): sessions resampled with replacement,
    each weighted by its multiplicity."""
    ok = np.isfinite(values)
    if ok.sum() == 0:
        return []
    s = session[ok]
    per_sum = np.bincount(s, weights=values[ok], minlength=n_sessions)
    per_cnt = np.bincount(s, minlength=n_sessions).astype(float)
    draws = []
    for _ in range(bootstrap):
        w = np.bincount(rng.integers(0, n_sessions, n_sessions), minlength=n_sessions).astype(float)
        c = w @ per_cnt
        if c > 0:
            draws.append(float(w @ per_sum / c))
    return draws


def summary(
    t: pd.DataFrame,
    session_days: np.ndarray,
    bootstrap: int = 200,
    seed: int = 5,
    cost_ticks: float = 5.56,
) -> pd.DataFrame:
    """Bounce rate and next-zone reach with their paired lifts over the matched null (session-block bootstrap
    intervals; Benjamini-Hochberg at q = 0.10 across every conditioned cell), the break-even hit rate of the
    zone-to-zone bracket, favourable excursion and the oracle zone-to-zone ceiling, by condition; plus a
    ``strength_trend`` row (Spearman rank trend of the bounce lift across strength buckets) and a
    ``gapped_through`` row. Gap-throughs are excluded from every rate."""
    r = t[t["resolved"] & ~t["gapped_through"]].copy()
    r["strength_bucket"] = np.where(r["strength"] >= 3, "3+", r["strength"].astype(int).astype(str))
    r["approach_speed_bucket"] = pd.qcut(
        r["approach_speed_ticks_per_minute"].rank(method="first"),
        4,
        labels=["slowest", "slow", "fast", "fastest"],
    )
    r["rsi_bucket"] = pd.cut(
        r["rsi_14_previous_bar"],
        [0, 30, 45, 55, 70, 100],
        labels=["<30", "30-45", "45-55", "55-70", ">70"],
    )
    r["volume_bucket"] = pd.qcut(
        r["relative_volume_15"].rank(method="first"), 3, labels=["low", "mid", "high"]
    )
    r["ahead_bucket"] = pd.cut(
        r["seasonal_ahead_ratio_30"], [0, 0.9, 1.1, 99], labels=["falling", "flat", "rising"]
    )
    n_days = np.unique(session_days).size
    sessions = pd.factorize(r["session_date"])[0]
    n_sessions = int(sessions.max()) + 1
    rng = np.random.default_rng(seed)
    rows = []
    conditions = [("all", None)] + [
        (c, None)
        for c in (
            "side_name",
            "session_part",
            "strength_bucket",
            "approach_speed_bucket",
            "rsi_bucket",
            "volume_bucket",
            "ahead_bucket",
            "has_session_level",
            "has_round_number",
            "has_fractal_1h_or_4h",
            "has_swing_30m",
            "has_vwap",
        )
    ]
    for column, _ in conditions:
        groups = (
            [("all", np.ones(len(r), bool))]
            if column == "all"
            else [
                (str(v), (r[column] == v).to_numpy())
                for v in sorted(r[column].dropna().unique(), key=str)
            ]
        )
        for label, mask in groups:
            g = r[mask]
            n = len(g)
            if n < 100:
                continue
            k = int(g["bounced"].sum())
            low, high = _wilson(k, n)
            lift = (g["bounced"].astype(float) - g["null_bounce_rate"]).to_numpy()
            has_target = np.isfinite(g["next_zone_distance_ticks"].to_numpy(float))
            reach_lift = np.where(
                has_target,
                g["reached_next_zone"].astype(float) - g["null_next_zone_reach_rate"],
                np.nan,
            )
            draws = _session_bootstrap(lift, sessions[mask], n_sessions, bootstrap, rng)
            reach_draws = _session_bootstrap(reach_lift, sessions[mask], n_sessions, bootstrap, rng)
            oracle = np.maximum(g["favourable_ticks"].to_numpy(float) - cost_ticks, 0.0)
            rows.append(
                {
                    "condition": column,
                    "value": label,
                    "touches": n,
                    "sessions": int(np.unique(sessions[mask]).size),
                    "touches_per_session_day": n / n_days,
                    "bounce_rate": k / n,
                    "bounce_wilson_low": low,
                    "bounce_wilson_high": high,
                    "null_bounce_rate": float(np.nanmean(g["null_bounce_rate"])),
                    "lift_over_matched_random": float(np.nanmean(lift)),
                    "lift_bootstrap_low": float(np.percentile(draws, 2.5)) if draws else np.nan,
                    "lift_bootstrap_high": float(np.percentile(draws, 97.5)) if draws else np.nan,
                    "lift_bootstrap_p": _bootstrap_p(draws),
                    "next_zone_reach_rate": float(g["reached_next_zone"][has_target].mean())
                    if has_target.any()
                    else np.nan,
                    "null_next_zone_reach_rate": float(np.nanmean(g["null_next_zone_reach_rate"])),
                    "reach_lift_over_matched_random": float(np.nanmean(reach_lift))
                    if has_target.any()
                    else np.nan,
                    "reach_lift_bootstrap_low": float(np.percentile(reach_draws, 2.5))
                    if reach_draws
                    else np.nan,
                    "reach_lift_bootstrap_high": float(np.percentile(reach_draws, 97.5))
                    if reach_draws
                    else np.nan,
                    "reach_lift_bootstrap_p": _bootstrap_p(reach_draws),
                    "break_even_hit_rate_zone_to_zone_median": float(
                        np.nanmedian(g["break_even_hit_rate_zone_to_zone"])
                    ),
                    "broke_before_next_zone_rate": float(g["broke_before_next_zone"].mean()),
                    "next_zone_distance_ticks_median": float(
                        np.nanmedian(g["next_zone_distance_ticks"])
                    ),
                    "stop_ticks_zone_to_zone_median": float(
                        np.nanmedian(g["stop_ticks_zone_to_zone"])
                    ),
                    "favourable_ticks_mean": float(g["favourable_ticks"].mean()),
                    "favourable_ticks_median": float(g["favourable_ticks"].median()),
                    "oracle_zone_to_zone_ticks_per_session_day": float(oracle.sum() / n_days),
                    "zone_width_ticks_median": float(g["zone_width_ticks"].median()),
                }
            )
    out = pd.DataFrame(rows)
    # multiple comparisons: one family = every conditioned cell (the "all" row is the pooled test, not a cell)
    cells = (out["condition"] != "all").to_numpy()
    out["survives_benjamini_hochberg_q10"] = False
    out["reach_survives_benjamini_hochberg_q10"] = False
    out.loc[cells, "survives_benjamini_hochberg_q10"] = _benjamini_hochberg(
        out.loc[cells, "lift_bootstrap_p"].to_numpy()
    )
    out.loc[cells, "reach_survives_benjamini_hochberg_q10"] = _benjamini_hochberg(
        out.loc[cells, "reach_lift_bootstrap_p"].to_numpy()
    )
    out["cells_tested"] = int(cells.sum())
    # F4: does the lift rise with strength?  Spearman rank trend over the strength-bucket lifts
    sb = out[out["condition"] == "strength_bucket"].sort_values("value")
    if len(sb) >= 3:
        from scipy.stats import spearmanr

        rho, p = spearmanr(np.arange(len(sb)), sb["lift_over_matched_random"].to_numpy())
        out = pd.concat(
            [
                out,
                pd.DataFrame(
                    [
                        {
                            "condition": "strength_trend",
                            "value": "spearman",
                            "touches": int(sb["touches"].sum()),
                            "lift_over_matched_random": float(rho),
                            "lift_bootstrap_p": float(p),
                        }
                    ]
                ),
            ],
            ignore_index=True,
        )
    gap = t[t["gapped_through"]]
    out = pd.concat(
        [
            out,
            pd.DataFrame(
                [
                    {
                        "condition": "gapped_through",
                        "value": "all",
                        "touches": int(len(gap)),
                        "touches_per_session_day": len(gap) / n_days,
                    }
                ]
            ),
        ],
        ignore_index=True,
    )
    return out
