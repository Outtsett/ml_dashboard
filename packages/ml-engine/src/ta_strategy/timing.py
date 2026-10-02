"""Measure volatility and ranging by time of day, weekday, calendar day and time event,
overnight (ETH) against regular hours (RTH), and land the tables.

    .venv/Scripts/python.exe packages/ml-engine/src/ta_strategy/timing.py --symbol MNQ --start 2019-06-01 --end 2026-01-01 --recipe <stem> --json

Tables (dataset ``ta_conditional_strategies_600_ticks``, prefix ``season_``):
- ``season_buckets``: per 5-minute bucket of the session x year ("all" and each) x weekday ("all" and
  each): absolute 1-minute return, 5-minute range, 30-minute efficiency ratio (and relative to a random
  walk's 1/sqrt(30)), variance ratio VR(5), return autocorrelation at lag 1 and lags 2-5, breakout
  follow-through, volume. Descriptive (full-sample within each year); the strategies use the causal
  profile in ``seasonality.build`` instead.
- ``season_sessions``: per session and part (overnight / regular hours): realised volatility, range,
  efficiency ratio, net move, volume, and the calendar flags of the session.
- ``season_parts``: the eight numbers of every session measure, overnight vs regular hours.
- ``season_events``: absolute 1-minute return from 60 minutes before to 120 after each time event,
  per year, relative to the event's own pre-window (-60..-31).
- ``season_calendar``: each calendar flag's session volatility relative to the trailing 20-session
  median of the same part (causal baseline), with a Newey-West t.
- ``season_stability``: per year and part, the correlation of the year's bucket profile with the
  previous year's, and how much of each session's bucket-to-bucket volatility the causal profile
  explains (out-of-sample R^2 of log volatility against a flat profile).
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

from shared import protocol  # noqa: E402

DATASET = "ta_conditional_strategies_600_ticks"
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
EVENT_WINDOW = (-60, 120)
RANDOM_WALK_EFFICIENCY_30 = 1 / math.sqrt(30)


def _matrices(frame: pd.DataFrame, days: np.ndarray):
    from ta_strategy import seasonality as se

    stamps = frame["timestamp"].to_numpy(np.int64)
    offset = se.session_offset(stamps)
    new_session = np.r_[True, days[1:] != days[:-1]]
    session = np.cumsum(new_session) - 1
    inside = offset < se.SESSION_MINUTES
    n = int(session[-1]) + 1
    shape = (n, se.SESSION_MINUTES)
    out = {}
    for name in ("close", "high", "low", "volume"):
        m = np.full(shape, np.nan)
        m[session[inside], offset[inside]] = frame[name].to_numpy(float)[inside]
        out[name] = m
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.diff(np.log(out["close"]), axis=1)
    out["return"] = np.hstack([np.full((n, 1), np.nan), r])        # minute o: log(close_o / close_(o-1)), NaN across gaps
    return out, days[new_session]


def bucket_table(mx: dict, session_days: np.ndarray, symbol: str, tick: float) -> pd.DataFrame:
    from ta_strategy import seasonality as se

    r, close, high, low, volume = mx["return"], mx["close"], mx["high"], mx["low"], mx["volume"]
    n, width = r.shape
    B, W = se.BUCKETS, se.BUCKET_MINUTES
    rb = r.reshape(n, B, W)
    absolute = np.nanmean(np.abs(rb), axis=2) * 1e4                                        # basis points per minute
    range_points = np.nanmax(high.reshape(n, B, W), axis=2) - np.nanmin(low.reshape(n, B, W), axis=2)
    price = np.nanmean(close.reshape(n, B, W), axis=2)
    five = np.nansum(rb, axis=2)
    five[np.isnan(rb).all(axis=2)] = np.nan
    filled = pd.DataFrame(close).ffill(axis=1).to_numpy()
    path = np.hstack([np.zeros((n, 1)), np.nancumsum(np.abs(np.diff(filled, axis=1)), axis=1)])
    starts = np.arange(B) * W
    ends = np.minimum(starts + 30, width - 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        efficiency = np.abs(filled[:, ends] - filled[:, starts]) / (path[:, ends] - path[:, starts])
        following = (filled[:, np.minimum(starts + W + 15, width - 1)] - filled[:, np.minimum(starts + W, width - 1)])
    vol = np.nansum(volume.reshape(n, B, W), axis=2)
    years = pd.DatetimeIndex(session_days).year.to_numpy()
    weekday = pd.DatetimeIndex(session_days).dayofweek.to_numpy()
    rows = []
    groups = [("all", "all", np.ones(n, bool))]
    groups += [(str(y), "all", years == y) for y in np.unique(years)]
    groups += [("all", WEEKDAYS[d], weekday == d) for d in range(5)]
    labels = se.offset_label(starts)
    parts = se.session_part(starts)
    for year, day, mask in groups:
        if mask.sum() < 20:
            continue
        a = absolute[mask]
        mean_abs = np.nanmean(a, axis=0)
        relative = mean_abs / np.nanmean(mean_abs)
        typical_five = np.nanmean(np.abs(five[mask]), axis=0)
        big = np.abs(five[mask]) >= 1.5 * typical_five
        same = np.sign(five[mask]) == np.sign(following[mask])
        with np.errstate(invalid="ignore"):
            follow = np.where(big.sum(axis=0) > 0, (big & same).sum(axis=0) / big.sum(axis=0), np.nan)
        rsub = rb[mask]
        for b in range(B):
            x = rsub[:, b, :]
            one = x[np.isfinite(x)]
            sums = np.nansum(x, axis=1)[np.isfinite(x).all(axis=1)]
            var1 = np.var(one) if one.size > 10 else np.nan
            lag1 = _autocorrelation(x, 1)
            lag25 = np.nanmean([_autocorrelation(x, k) for k in range(2, 5)])
            rows.append({
                "symbol": symbol, "year": year, "weekday": day, "bucket_start_pacific": labels[b], "session_offset_minutes": int(starts[b]),
                "session_part": parts[b], "session_count": int(np.isfinite(a[:, b]).sum()),
                "mean_absolute_one_minute_return_basis_points": float(mean_abs[b]),
                "relative_volatility_to_session_average": float(relative[b]),
                "average_five_minute_range_ticks": float(np.nanmean(range_points[mask][:, b]) / tick),
                "average_five_minute_range_basis_points": float(np.nanmean(range_points[mask][:, b] / price[mask][:, b]) * 1e4),
                "efficiency_ratio_thirty_minutes": float(np.nanmean(efficiency[mask][:, b])),
                "efficiency_relative_to_random_walk": float(np.nanmean(efficiency[mask][:, b]) / RANDOM_WALK_EFFICIENCY_30),
                "variance_ratio_five_minutes": float(np.var(sums) / (5 * var1)) if sums.size > 10 and var1 > 0 else math.nan,
                "autocorrelation_lag_one_minute": lag1, "autocorrelation_lags_two_to_four_minutes": float(lag25),
                "breakout_follow_through_probability": float(follow[b]), "breakout_count": int(big[:, b].sum()),
                "mean_volume_contracts": float(np.nanmean(vol[mask][:, b])),
            })
    return pd.DataFrame(rows)


def _autocorrelation(x: np.ndarray, lag: int) -> float:
    a, b = x[:, lag:], x[:, :-lag]
    ok = np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 30:
        return math.nan
    a, b = a[ok], b[ok]
    return float(np.corrcoef(a, b)[0, 1])


def session_table(mx: dict, session_days: np.ndarray, flags: dict, symbol: str, tick: float) -> pd.DataFrame:
    from ta_strategy import seasonality as se

    r, close, high, low, volume = mx["return"], mx["close"], mx["high"], mx["low"], mx["volume"]
    offsets = np.arange(r.shape[1])
    parts = {"overnight": offsets < se.RTH_START_OFFSET, "regular_hours": (offsets >= se.RTH_START_OFFSET) & (offsets < se.RTH_END_OFFSET)}
    frame = {"symbol": symbol, "session_date": pd.DatetimeIndex(session_days), "year": pd.DatetimeIndex(session_days).year,
             "weekday": [WEEKDAYS[d] if d < 5 else "weekend" for d in pd.DatetimeIndex(session_days).dayofweek]}
    for name, cols in parts.items():
        c = close[:, cols]
        filled = pd.DataFrame(c).ffill(axis=1).bfill(axis=1).to_numpy()
        with np.errstate(invalid="ignore", divide="ignore"):
            first, last = filled[:, 0], filled[:, -1]
            path = np.nansum(np.abs(np.diff(filled, axis=1)), axis=1)
            frame[f"{name}_realized_volatility_basis_points"] = np.sqrt(np.nansum(r[:, cols] ** 2, axis=1)) * 1e4
            frame[f"{name}_range_ticks"] = (np.nanmax(high[:, cols], axis=1) - np.nanmin(low[:, cols], axis=1)) / tick
            frame[f"{name}_range_basis_points"] = (np.nanmax(high[:, cols], axis=1) - np.nanmin(low[:, cols], axis=1)) / first * 1e4
            frame[f"{name}_net_move_ticks"] = (last - first) / tick
            frame[f"{name}_efficiency_ratio"] = np.abs(last - first) / path
            # a random walk's efficiency ratio falls as 1/sqrt(steps): this is comparable across parts of different length
            frame[f"{name}_efficiency_ratio_times_square_root_minutes"] = frame[f"{name}_efficiency_ratio"] * np.sqrt(np.isfinite(c).sum(axis=1))
            frame[f"{name}_volume_contracts"] = np.nansum(volume[:, cols], axis=1)
            frame[f"{name}_minutes_traded"] = np.isfinite(c).sum(axis=1)
    out = pd.DataFrame(frame)
    with np.errstate(invalid="ignore", divide="ignore"):
        out["overnight_to_regular_hours_volatility_ratio"] = out["overnight_realized_volatility_basis_points"] / out["regular_hours_realized_volatility_basis_points"]
        out["overnight_share_of_session_variance"] = out["overnight_realized_volatility_basis_points"] ** 2 / (
            out["overnight_realized_volatility_basis_points"] ** 2 + out["regular_hours_realized_volatility_basis_points"] ** 2)
    for name, values in flags.items():
        out[name] = np.asarray(values, dtype=bool)
    keep = (out["overnight_minutes_traded"] >= 300) & (out["regular_hours_minutes_traded"] >= 300)
    return out[keep].reset_index(drop=True)


def parts_table(sessions: pd.DataFrame, symbol: str) -> pd.DataFrame:
    from ta_strategy import metrics as m

    rows = []
    for measure in ("realized_volatility_basis_points", "range_ticks", "range_basis_points", "efficiency_ratio",
                    "efficiency_ratio_times_square_root_minutes", "net_move_ticks", "volume_contracts"):
        for part in ("overnight", "regular_hours"):
            for year in ["all"] + sorted(sessions["year"].unique().tolist()):
                x = sessions[f"{part}_{measure}"] if year == "all" else sessions.loc[sessions["year"] == year, f"{part}_{measure}"]
                row = {"symbol": symbol, "measure": measure, "session_part": part, "year": str(year)}
                row.update(m.eight_numbers(x.to_numpy(float), "value"))
                rows.append(row)
    return pd.DataFrame(rows)


def event_table(mx: dict, session_days: np.ndarray, events, symbol: str) -> pd.DataFrame:
    from ta_strategy import seasonality as se

    absolute = np.abs(mx["return"]) * 1e4
    n, width = absolute.shape
    session_open = (pd.DatetimeIndex(session_days).asi8 // 10**9) - 9 * 3600
    years = pd.DatetimeIndex(session_days).year.to_numpy()
    rel = np.arange(EVENT_WINDOW[0], EVENT_WINDOW[1] + 1)
    specs = [("globex_open", None), ("tokyo_open", None), ("london_open", None), ("us_data_0830", "release_0830_day"),
             ("us_data_0830", "no_release"), ("rth_open", None), ("us_data_1000", "release_1000_day"), ("us_data_1000", "no_release"),
             ("fomc_statement", None), ("rth_close", None)]
    rows = []
    for event, condition in specs:
        at = events.anchors[event]
        if condition == "no_release":
            flag = events.flags["release_0830_day" if event == "us_data_0830" else "release_1000_day"]
            group = "release_0830" if event == "us_data_0830" else "release_1000"
            take = np.isfinite(at) & ~flag & (session_open >= events.covered_from[group] - 86400)
            label = f"{event}_without_release"
        elif condition:
            take = np.isfinite(at) & events.flags[condition]
            label = f"{event}_with_release"
        else:
            take = np.isfinite(at)
            label = event
        k = np.flatnonzero(take)
        if k.size < 5:
            continue
        start = ((at[k] - session_open[k]) // 60).astype(int)
        cols = start[:, None] + rel[None, :]
        ok = (cols >= 0) & (cols < width)
        window = np.where(ok, absolute[k[:, None], np.clip(cols, 0, width - 1)], np.nan)
        base = np.nanmean(window[:, :30], axis=1)
        for year in ["all"] + sorted(set(years[k].tolist())):
            sel = np.ones(k.size, bool) if year == "all" else years[k] == year
            if sel.sum() < 5:
                continue
            mean = np.nanmean(window[sel], axis=0)
            relative = mean / np.nanmean(base[sel])          # ratio of means: a silent pre-window in one session cannot divide by zero
            for j, minute in enumerate(rel):
                rows.append({"symbol": symbol, "event": label, "year": str(year), "minutes_from_event": int(minute),
                             "session_count": int(sel.sum()), "mean_absolute_one_minute_return_basis_points": float(mean[j]),
                             "relative_to_pre_event_hour": float(relative[j])})
    del se
    return pd.DataFrame(rows)


def calendar_table(sessions: pd.DataFrame, flags: list[str], symbol: str) -> pd.DataFrame:
    from ta_strategy import metrics as m

    rows = []
    for part in ("overnight", "regular_hours"):
        v = sessions[f"{part}_realized_volatility_basis_points"]
        baseline = v.shift(1).rolling(20, min_periods=10).median()
        ratio = np.log(v / baseline)
        for flag in flags + ["weekday_" + d for d in WEEKDAYS]:
            mask = (sessions["weekday"] == flag[8:]).to_numpy() if flag.startswith("weekday_") else sessions[flag].to_numpy(bool)
            x = ratio[mask].dropna().to_numpy()
            others = ratio[~mask].dropna().to_numpy()
            row = {"symbol": symbol, "session_part": part, "calendar_condition": flag, "session_count": int(x.size),
                   "volatility_ratio_to_trailing_median": float(np.exp(x.mean())) if x.size else math.nan,
                   "volatility_ratio_other_sessions": float(np.exp(others.mean())) if others.size else math.nan,
                   "log_ratio_difference": float(x.mean() - others.mean()) if x.size and others.size else math.nan,
                   "log_ratio_newey_west_t": m.newey_west_mean_t(x - others.mean(), 1) if x.size > 3 else math.nan}
            rows.append(row)
    return pd.DataFrame(rows)


def stability_table(mx: dict, session_days: np.ndarray, seasonal, symbol: str) -> pd.DataFrame:
    from ta_strategy import seasonality as se

    absolute = np.abs(mx["return"])
    n = absolute.shape[0]
    bucket = np.nanmean(absolute.reshape(n, se.BUCKETS, se.BUCKET_MINUTES), axis=2)
    years = pd.DatetimeIndex(session_days).year.to_numpy()
    parts = se.session_part(np.arange(se.BUCKETS) * se.BUCKET_MINUTES)
    rows = []
    with np.errstate(invalid="ignore", divide="ignore"):
        shape_by_year = {y: np.nanmean(bucket[years == y] / np.nanmean(bucket[years == y], axis=1, keepdims=True), axis=0)
                         for y in np.unique(years)}
        log_actual = np.log(bucket / np.nanmean(bucket, axis=1, keepdims=True))
        log_profile = np.log(seasonal.profile)
    for y in np.unique(years):
        for part in ("overnight", "regular_hours", "whole_session"):
            cols = np.ones(se.BUCKETS, bool) if part == "whole_session" else parts == part
            prev = shape_by_year.get(y - 1)
            both = np.isfinite(shape_by_year[y]) & (np.isfinite(prev) if prev is not None else False) & cols
            corr = float(np.corrcoef(shape_by_year[y][both], prev[both])[0, 1]) if prev is not None and both.sum() > 10 else math.nan
            a, p = log_actual[years == y][:, cols], log_profile[years == y][:, cols]
            ok = np.isfinite(a) & np.isfinite(p)
            residual = np.nansum(np.where(ok, (a - p) ** 2, 0.0))
            flat = np.nansum(np.where(ok, (a - np.nanmean(np.where(ok, a, np.nan), axis=1, keepdims=True)) ** 2, 0.0))
            rows.append({"symbol": symbol, "year": int(y), "session_part": part,
                         "correlation_with_previous_year_profile": corr,
                         "out_of_sample_r_squared_of_log_volatility": float(1 - residual / flat) if flat > 0 else math.nan,
                         "mean_absolute_log_error": float(np.mean(np.abs((a - p)[ok]))) if ok.any() else math.nan,
                         "session_count": int((years == y).sum())})
    return pd.DataFrame(rows)


def run(args: argparse.Namespace) -> dict:
    from cycle.simulate import load_cost_model
    from shared.data import _serving
    from ta_strategy import seasonality as se
    from ta_strategy import store
    from ta_strategy.data import load_minutes_rebuilt, session_dates

    started = time.monotonic()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    recipe = f"{args.recipe or 'timing_' + stamp}_{args.symbol}"
    cost = load_cost_model(args.symbol if args.symbol != "NQ" else "MNQ")
    connection = _serving()
    connection.execute("SET TimeZone='UTC'")
    minutes = load_minutes_rebuilt(connection, args.symbol, args.start, args.end)
    frame = minutes.frame
    days = session_dates(frame["timestamp"].to_numpy(np.int64))
    protocol.emit_log(f"[data] {args.symbol} {args.start}..{args.end}: {len(frame):,} minutes, {len(minutes.rolls)} rolls")
    mx, session_days = _matrices(frame, days)
    calendar = se.calendar_frame()
    events = se.time_events(frame["timestamp"].to_numpy(np.int64), days, calendar)
    seasonal = se.build(frame, days)
    tick = cost.tick_size
    tables = {"season_buckets": bucket_table(mx, session_days, args.symbol, tick)}
    sessions = session_table(mx, session_days, events.flags, args.symbol, tick)
    tables["season_sessions"] = sessions
    tables["season_parts"] = parts_table(sessions, args.symbol)
    tables["season_events"] = event_table(mx, session_days, events, args.symbol)
    tables["season_calendar"] = calendar_table(sessions, list(se.FLAG_NAMES), args.symbol)
    tables["season_stability"] = stability_table(mx, session_days, seasonal, args.symbol)
    tables = {k: v.assign(recipe=recipe) for k, v in tables.items()}
    p = tables["season_parts"]
    for measure in ("realized_volatility_basis_points", "efficiency_ratio_times_square_root_minutes", "range_ticks"):
        s = p[(p["measure"] == measure) & (p["year"] == "all")].set_index("session_part")
        protocol.emit_log(f"[{args.symbol} {measure}] overnight median {s.loc['overnight', 'value_median']:.3f} vs regular hours "
                          f"{s.loc['regular_hours', 'value_median']:.3f}")
    st = tables["season_stability"]
    protocol.emit_log(f"[{args.symbol} stability] year-on-year profile correlation (whole session) median "
                      f"{st.loc[st.session_part == 'whole_session', 'correlation_with_previous_year_profile'].median():.3f}; causal "
                      f"profile out-of-sample R^2 median {st.loc[st.session_part == 'whole_session', 'out_of_sample_r_squared_of_log_volatility'].median():.3f}")
    directory = os.path.join(args.output_dir, f"ta_timing_{recipe}")
    paths = store.write_local(tables, directory)
    landing = None
    if not args.no_land:
        landing = store.land(paths, recipe, f"TA timing study {args.symbol}", dataset=DATASET)
        for name, info in landing.items():
            protocol.emit_log(f"[save] {name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    protocol.emit_done(directory, {"recipe": recipe, "lake": landing, "seconds": time.monotonic() - started})
    return {"recipe": recipe}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--recipe", default=None)
    parser.add_argument("--output-dir", default=str(ROOT / "data" / "models"))
    parser.add_argument("--no-land", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        run(args)
        return 0
    except Exception as error:  # noqa: BLE001
        import traceback

        protocol.emit_error(f"{type(error).__name__}: {error}", traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
