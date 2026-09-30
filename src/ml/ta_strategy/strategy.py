"""Compile a conditional strategy spec into entry signals, exit plans and exit conditions.

A spec is plain data (JSON-able). Parameters are written ``{"param": "name"}`` and are
substituted before compiling (``resolve``), which is how Optuna tunes a template without
a model predicting anything.

Series nodes (evaluated on the strategy timeframe; a node with ``"tf"`` is computed on that
higher timeframe and each strategy bar sees the LAST COMPLETED higher-timeframe bar):

    "close" | "open" | "high" | "low" | "volume" | "atr"
    {"ind": "RSI", "args": {"timeperiod": 14}, "out": 0, "tf": "1h"}      any TA-Lib function (abstract API)
    {"op": "sma"|"ema"|"wma", "of": S, "n": 9}                            e.g. RSI's signal line
    {"op": "sub"|"add"|"mul"|"div", "a": S, "b": S}, {"op": "lag", "of": S, "n": 1}
    {"op": "highest"|"lowest", "of": S, "n": 20}                          previous n bars, current excluded
    {"level": "support_low"|"resistance_high"|...}                        multi-timeframe zones (levels.zones_for_bars)
    {"event": "opening_range_30_high"|"prior_session_high"|...}           the active level of one source
    {"vwap": "session_vwap"|"session_vwap_upper_1"|...}
    {"const": 50}

Condition nodes (boolean per strategy bar):

    cross_above / cross_below (a, b)     a crosses b (b may be a constant)
    above / below (a, b)                  state
    rising / falling (a, n)               a vs a n bars ago
    within (k, cond)                      cond on any of the last k bars, this one included
    then (first, second, k)               second now, first on one of the previous k bars
    broke_above / broke_below (level)     close crosses the level as it stood on the PREVIOUS bar
    retest_above / retest_below (level, k, tol_atr)
                                          a break within the last k bars, then a bar reaches back within
                                          tol_atr x ATR of the level as it was at the break and closes beyond it
    near (level, tol_atr), at_least (a, b), session_window (start, end), pct_rank_below (a, q)
    all / any / not

Entry: ``{"long": C, "short": C}``: a side fires on the bar its condition turns true.
Exit: stop (atr | level | ticks), target (r | level with a room filter | none), trail
(breakeven and/or chandelier), signal (a condition per side, exits at the next open),
time_stop_bars, risk bounds; every position is flat at the session end.
"""

from __future__ import annotations

import copy
import json
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import talib
from talib import abstract

from . import engine, levels, seasonality
from .data import aggregate, aggregate_session_anchored, effective_roll_timestamps, session_dates
from .rules import prior_percentile

TIMEFRAME_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60}


def resolve(node, params: dict):
    """The spec with every {"param": name} replaced by its value."""
    if isinstance(node, dict):
        if set(node) == {"param"}:
            return params[node["param"]]
        return {k: resolve(v, params) for k, v in node.items()}
    if isinstance(node, list):
        return [resolve(v, params) for v in node]
    return node


def materialize(template: dict, params: dict) -> dict:
    """A runnable spec from a template: parameters substituted, and every "$name" string
    replaced by the template's named series node."""
    resolved = resolve(template, params)
    named = resolved.get("series", {})

    def expand(node):
        if isinstance(node, str) and node.startswith("$"):
            return expand(named[node[1:]])
        if isinstance(node, dict):
            return {k: expand(v) for k, v in node.items()}
        if isinstance(node, list):
            return [expand(v) for v in node]
        return node

    return {k: expand(v) for k, v in resolved.items() if k not in ("series", "params", "defaults")}


@dataclass
class Minutes:
    stamps: np.ndarray
    open: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    days: np.ndarray
    session_id: np.ndarray
    session_last: np.ndarray
    roll_after: np.ndarray
    vwap: dict


@dataclass
class Context:
    """Everything a spec reads, for one strategy timeframe."""
    timeframe: str
    minutes: Minutes
    minutes_frame: pd.DataFrame
    bars: dict                     # open/high/low/close/volume arrays of the strategy timeframe
    bar_end: np.ndarray
    last_minute: np.ndarray
    start_minute: np.ndarray       # Pacific minute of day each bar starts
    atr: np.ndarray
    zones: pd.DataFrame
    events: pd.DataFrame
    tick: float
    cache: dict = field(default_factory=dict)
    higher: dict = field(default_factory=dict)
    calendar: pd.DataFrame | None = None     # scheduled releases (seasonality.calendar_frame); loaded on first use
    seasonal: object | None = None           # seasonality.Seasonal, built on first use
    time: object | None = None               # seasonality.TimeEvents, built on first use
    flow: dict | None = None                 # per-minute tick-rule signed and total volume (see _flow)


# Order flow is readable only before the multimodal project's locked holdout (src/ml/multimodal/holdout.py).
FLOW_END = "2025-07-01"


def _flow(ctx: Context) -> dict:
    """Tick-rule signed volume per minute of the rebuilt one-contract series (derived/multimodal_orderflow,
    built from 1-second bars: a second's volume is + when its close rose, - when it fell). Joined on
    (minute, contract); a minute of the covered span with no flow row is 0; minutes after FLOW_END or
    outside the recipe's span are NaN, so no condition on flow can pass there."""
    if ctx.flow is None:
        import re

        from multimodal.sources import flow_minutes

        frame = ctx.minutes_frame
        contract = frame["contract"].astype(str).to_numpy()
        root = re.match(r"^([A-Z0-9]+?)[FGHJKMNQUVXZ]\d{1,2}$", contract[0]).group(1)
        stamps = ctx.minutes.stamps
        start = str(pd.Timestamp(int(stamps[0]), unit="s").date())
        end = min(str((pd.Timestamp(int(stamps[-1]), unit="s") + pd.Timedelta(days=1)).date()), FLOW_END)
        flow = flow_minutes(start, end, root=root) if start < end else pd.DataFrame(columns=["timestamp", "contract", "signed_volume", "volume"])
        joined = pd.DataFrame({"timestamp": stamps, "contract": contract}).merge(
            flow[["timestamp", "contract", "signed_volume", "volume"]], on=["timestamp", "contract"], how="left")
        covered = np.zeros(stamps.size, dtype=bool)
        if len(flow):
            covered = (stamps >= int(flow["timestamp"].min())) & (stamps <= int(flow["timestamp"].max()))
        signed = np.where(covered, joined["signed_volume"].fillna(0.0).to_numpy(float), np.nan)
        volume = np.where(covered, joined["volume"].fillna(0.0).to_numpy(float), np.nan)
        ctx.flow = {"signed_cumulative": np.r_[0.0, np.cumsum(np.nan_to_num(signed))],
                    "volume_cumulative": np.r_[0.0, np.cumsum(np.nan_to_num(volume))],
                    "covered_cumulative": np.r_[0, np.cumsum(covered)]}
    return ctx.flow


def _flow_imbalance(ctx: Context, minutes: int) -> np.ndarray:
    """(buy - sell) / volume over the ``minutes`` minutes ending with each strategy bar's last minute."""
    f = _flow(ctx)
    end = ctx.last_minute + 1
    start = np.maximum(end - int(minutes), 0)
    volume = f["volume_cumulative"][end] - f["volume_cumulative"][start]
    fully_covered = (f["covered_cumulative"][end] - f["covered_cumulative"][start]) == (end - start)
    with np.errstate(invalid="ignore", divide="ignore"):
        imbalance = (f["signed_cumulative"][end] - f["signed_cumulative"][start]) / volume
    return np.where(fully_covered & (volume > 0), imbalance, np.nan)


def _seasonal(ctx: Context):
    if ctx.seasonal is None:
        ctx.seasonal = seasonality.build(ctx.minutes_frame, ctx.minutes.days)
    return ctx.seasonal


def _time(ctx: Context):
    if ctx.time is None:
        if ctx.calendar is None:
            ctx.calendar = seasonality.calendar_frame()
        ctx.time = seasonality.time_events(ctx.minutes.stamps, ctx.minutes.days, ctx.calendar)
    return ctx.time


def _event_extreme(ctx: Context, event: str, minutes: int, high: bool) -> np.ndarray:
    """High (or low) of the ``minutes`` after a time event in each session, known from the
    minute after the window closes until the session ends; NaN before and on sessions without it."""
    t = _time(ctx)
    m = ctx.minutes
    at = t.anchors[event]
    first = np.searchsorted(m.stamps, at)                      # NaN anchors sort to the end
    last = np.searchsorted(m.stamps, at + minutes * 60)
    extreme = np.full(at.size, np.nan)
    source = m.high if high else m.low
    session_first = np.searchsorted(m.session_id, np.arange(at.size))
    session_stop = np.searchsorted(m.session_id, np.arange(at.size), side="right")
    for k in np.flatnonzero(np.isfinite(at)):
        a, b = max(first[k], session_first[k]), min(last[k], session_stop[k])
        if b > a:
            extreme[k] = source[a:b].max() if high else source[a:b].min()
    index = ctx.last_minute
    session = m.session_id[index]
    known = np.isfinite(at[session]) & (ctx.bar_end >= at[session] + minutes * 60)
    return np.where(known, extreme[session], np.nan)


def build_context(minutes_bars, timeframe: str, tick: float, events: pd.DataFrame | None = None) -> Context:
    frame = minutes_bars.frame
    stamps = frame["timestamp"].to_numpy(np.int64)
    days = session_dates(stamps)
    session_id = np.cumsum(np.r_[True, days[1:] != days[:-1]]) - 1
    session_last = np.r_[days[1:] != days[:-1], True]
    roll_after = np.zeros(stamps.size, dtype=np.bool_)
    for r in effective_roll_timestamps(minutes_bars.rolls):
        k = int(np.searchsorted(stamps, r))
        if 0 < k < stamps.size:
            roll_after[k] = True
    ctx_levels = levels.minute_context(frame)
    vwap = levels.session_vwap(ctx_levels)
    events = events if events is not None else levels.all_level_events(frame, ctx_levels)
    width = TIMEFRAME_MINUTES[timeframe]
    bars_frame, _ = aggregate(frame, width)
    b = {k: bars_frame[k].to_numpy(np.float64) for k in ("open", "high", "low", "close", "volume")}
    bar_end = bars_frame["timestamp"].to_numpy(np.int64) + width * 60
    moments = pd.to_datetime(bars_frame["timestamp"].to_numpy(np.int64), unit="s")
    atr = talib.ATR(b["high"], b["low"], b["close"], 14)
    zones = levels.zones_for_bars(bar_end, b["close"], atr, bars_frame["last_minute_index"].to_numpy(np.int64),
                                  events, vwap, tick)
    m = Minutes(stamps, frame["open"].to_numpy(float), frame["high"].to_numpy(float), frame["low"].to_numpy(float),
                frame["close"].to_numpy(float), days, session_id.astype(np.int64), session_last, roll_after, vwap)
    return Context(timeframe, m, frame, b, bar_end, bars_frame["last_minute_index"].to_numpy(np.int64),
                   (moments.hour * 60 + moments.minute).to_numpy(), atr, zones, events, tick)


# ── series ───────────────────────────────────────────────────────────────────
def _lag(x: np.ndarray, n: int = 1) -> np.ndarray:
    out = np.full(x.shape, np.nan)
    if n < x.size:
        out[n:] = x[:-n] if n > 0 else x
    return out


def _higher(ctx: Context, tf: str) -> dict:
    """Bars of a higher timeframe, and for each strategy bar the index of the last higher bar
    that had CLOSED by the strategy bar's close."""
    if tf not in ctx.higher:
        if tf in ("4h", "session", "week"):
            frame, _ = aggregate_session_anchored(ctx.minutes_frame, tf)
            ends = frame["end_timestamp"].to_numpy(np.int64)
        else:
            width = TIMEFRAME_MINUTES[tf]
            frame, _ = aggregate(ctx.minutes_frame, width)
            ends = frame["timestamp"].to_numpy(np.int64) + width * 60
        index = np.searchsorted(ends, ctx.bar_end, side="right") - 1
        ctx.higher[tf] = {"bars": {k: frame[k].to_numpy(np.float64) for k in ("open", "high", "low", "close", "volume")},
                          "index": index}
    return ctx.higher[tf]


def _talib(name: str, bars: dict, args: dict, out: int) -> np.ndarray:
    function = abstract.Function(name)
    result = function({k: bars[k] for k in ("open", "high", "low", "close", "volume")}, **args)
    if isinstance(result, list):
        result = result[out]
    return np.asarray(result, dtype=np.float64)


def series(ctx: Context, node) -> np.ndarray:
    key = json.dumps(node, sort_keys=True)
    if key in ctx.cache:
        return ctx.cache[key]
    value = _series(ctx, node)
    ctx.cache[key] = value
    return value


def _series(ctx: Context, node) -> np.ndarray:
    n = ctx.bar_end.size
    if isinstance(node, (int, float)):
        return np.full(n, float(node))
    if isinstance(node, str):
        if node == "atr":
            return ctx.atr
        return ctx.bars[node]
    if "const" in node:
        return np.full(n, float(node["const"]))
    if "ind" in node:
        tf = node.get("tf")
        if tf and tf != ctx.timeframe:
            h = _higher(ctx, tf)
            values = _talib(node["ind"], h["bars"], node.get("args", {}), node.get("out", 0))
            return np.where(h["index"] >= 0, values[np.clip(h["index"], 0, None)], np.nan)
        return _talib(node["ind"], ctx.bars, node.get("args", {}), node.get("out", 0))
    if "seasonal" in node:
        # causal intraday seasonality at each strategy bar's close (seasonality.py)
        season, index, kind = _seasonal(ctx), ctx.last_minute, node["seasonal"]
        if kind == "shape":
            return season.shape[index]
        if kind == "efficiency":
            return season.efficiency[index]
        if kind == "heat":
            return season.heat[index]
        if kind == "ahead_ratio":
            return season.ahead_ratio(index, int(node["minutes"]))
        if kind == "expected_move":
            return season.expected_move_points(index, int(node["minutes"]))
        raise ValueError(f"unknown seasonal series {kind!r}")
    if "flow" in node:
        kind = node["flow"]
        imbalance = _flow_imbalance(ctx, int(node["minutes"]))
        if kind == "imbalance":
            return imbalance
        if kind == "imbalance_zscore":
            # against the previous `window` bars' values (strictly before this bar): removes the tick rule's drift
            window = int(node.get("window", 500))
            past = pd.Series(imbalance).shift(1).rolling(window, min_periods=window // 2)
            with np.errstate(invalid="ignore", divide="ignore"):
                return ((imbalance - past.mean().to_numpy()) / past.std().to_numpy())
        raise ValueError(f"unknown flow series {kind!r}")
    if "time" in node:
        index, kind = ctx.last_minute, node["time"]
        if kind == "minute_of_day":
            return ((ctx.minutes.stamps[index] % 86400) // 60).astype(float)
        t = _time(ctx)
        if kind == "weekday":
            return t.weekday[t.session[index]].astype(float)
        if kind == "minutes_since":
            return t.minutes_since(index, node["event"])
        if kind == "minutes_until":
            return t.minutes_until(index, node["event"])
        if kind == "flag":
            return t.flag(index, node["name"])
        if kind in ("event_high", "event_low"):
            return _event_extreme(ctx, node["event"], int(node["minutes"]), kind == "event_high")
        raise ValueError(f"unknown time series {kind!r}")
    if "level" in node:
        return ctx.zones[node["level"]].to_numpy(np.float64)
    if "event" in node:
        ev = ctx.events[ctx.events["source"] == node["event"]]
        known, until, price = (ev[c].to_numpy() for c in ("known_from", "valid_until", "price"))
        idx = np.searchsorted(known, ctx.bar_end, side="right") - 1
        ok = (idx >= 0) & (until[np.clip(idx, 0, None)] > ctx.bar_end)
        return np.where(ok, price[np.clip(idx, 0, None)], np.nan)
    if "vwap" in node:
        return ctx.minutes.vwap[node["vwap"]][ctx.last_minute]
    op = node["op"]
    if op in ("sma", "ema", "wma"):
        x = series(ctx, node["of"])
        values = pd.Series(x)
        n_ = int(node["n"])
        if op == "sma":
            return values.rolling(n_, min_periods=n_).mean().to_numpy()
        if op == "ema":
            return values.ewm(span=n_, adjust=False, min_periods=n_).mean().to_numpy()   # NaN warmup of e.g. RSI is respected
        return values.rolling(n_, min_periods=n_).apply(lambda w: np.dot(w, np.arange(1, n_ + 1)) / (n_ * (n_ + 1) / 2), raw=True).to_numpy()
    if op in ("sub", "add", "mul", "div"):
        a, b = series(ctx, node["a"]), series(ctx, node["b"])
        with np.errstate(divide="ignore", invalid="ignore"):
            return {"sub": a - b, "add": a + b, "mul": a * b, "div": a / b}[op]
    if op == "lag":
        return _lag(series(ctx, node["of"]), int(node.get("n", 1)))
    if op in ("highest", "lowest"):
        x = pd.Series(series(ctx, node["of"])).shift(1)
        n_ = int(node["n"])
        rolled = x.rolling(n_, min_periods=n_)
        return (rolled.max() if op == "highest" else rolled.min()).to_numpy()
    raise ValueError(f"unknown series node {node!r}")


# ── conditions ───────────────────────────────────────────────────────────────
def _within(x: np.ndarray, k: int) -> np.ndarray:
    return pd.Series(x.astype(float)).rolling(max(int(k), 1), min_periods=1).max().to_numpy() > 0


def condition(ctx: Context, node) -> np.ndarray:
    key = "C" + json.dumps(node, sort_keys=True)
    if key in ctx.cache:
        return ctx.cache[key]
    value = _condition(ctx, node)
    ctx.cache[key] = value
    return value


def _condition(ctx: Context, node) -> np.ndarray:
    op = node["op"]
    if op == "all":
        out = np.ones(ctx.bar_end.size, dtype=bool)
        for c in node["of"]:
            out &= condition(ctx, c)
        return out
    if op == "any":
        out = np.zeros(ctx.bar_end.size, dtype=bool)
        for c in node["of"]:
            out |= condition(ctx, c)
        return out
    if op == "not":
        return ~condition(ctx, node["of"])
    if op in ("cross_above", "cross_below"):
        a, b = series(ctx, node["a"]), series(ctx, node["b"])
        pa, pb = _lag(a), _lag(b)
        with np.errstate(invalid="ignore"):
            return (a > b) & (pa <= pb) if op == "cross_above" else (a < b) & (pa >= pb)
    if op in ("above", "below", "at_least"):
        a, b = series(ctx, node["a"]), series(ctx, node["b"])
        with np.errstate(invalid="ignore"):
            return {"above": a > b, "below": a < b, "at_least": a >= b}[op]
    if op in ("rising", "falling"):
        a = series(ctx, node["a"])
        p = _lag(a, int(node.get("n", 1)))
        with np.errstate(invalid="ignore"):
            return a > p if op == "rising" else a < p
    if op == "within":
        return _within(condition(ctx, node["cond"]), int(node["k"]))
    if op == "then":
        first = np.r_[False, condition(ctx, node["first"])[:-1]]
        return condition(ctx, node["second"]) & _within(first, int(node["k"]))
    if op in ("broke_above", "broke_below"):
        level = _lag(series(ctx, node["level"]))
        close, prev = ctx.bars["close"], _lag(ctx.bars["close"])
        with np.errstate(invalid="ignore"):
            return (close > level) & (prev <= level) if op == "broke_above" else (close < level) & (prev >= level)
    if op in ("retest_above", "retest_below"):
        up = op == "retest_above"
        level_prev = _lag(series(ctx, node["level"]))
        close, prev = ctx.bars["close"], _lag(ctx.bars["close"])
        with np.errstate(invalid="ignore"):
            broke = (close > level_prev) & (prev <= level_prev) if up else (close < level_prev) & (prev >= level_prev)
        index = np.arange(broke.size)
        last = np.maximum.accumulate(np.where(broke, index, -1))
        level_at_break = np.where(last >= 0, level_prev[np.clip(last, 0, None)], np.nan)
        age = index - last
        tolerance = float(node["tol_atr"]) * ctx.atr
        with np.errstate(invalid="ignore"):
            if up:
                touch = (ctx.bars["low"] <= level_at_break + tolerance) & (close > level_at_break)
            else:
                touch = (ctx.bars["high"] >= level_at_break - tolerance) & (close < level_at_break)
        return (last >= 0) & (age >= 1) & (age <= int(node["k"])) & touch
    if op == "near":
        level = series(ctx, node["level"])
        with np.errstate(invalid="ignore"):
            return np.abs(ctx.bars["close"] - level) <= float(node["tol_atr"]) * ctx.atr
    if op == "in_set":
        values = series(ctx, node["a"])
        return np.isin(values, np.asarray(node["values"], dtype=float))
    if op == "between":
        values = series(ctx, node["a"])
        with np.errstate(invalid="ignore"):
            return (values >= series(ctx, node["low"])) & (values < series(ctx, node["high"]))
    if op == "session_window":
        start = _minutes_of(node["start"])
        end = _minutes_of(node["end"])
        if end <= start:  # wraps midnight: the overnight (ETH) session 13:00 -> 06:30 Pacific
            return (ctx.start_minute >= start) | (ctx.start_minute < end)
        return (ctx.start_minute >= start) & (ctx.start_minute < end)
    if op == "pct_rank_below":
        return prior_percentile(series(ctx, node["a"]), int(node.get("window", 1000))) < float(node["q"])
    raise ValueError(f"unknown condition {op!r}")


def _minutes_of(text: str) -> int:
    hours, minutes = text.split(":")
    return int(hours) * 60 + int(minutes)


def _rising_edge(x: np.ndarray) -> np.ndarray:
    return x & ~np.r_[False, x[:-1]]


# ── compile a resolved spec ─────────────────────────────────────────────────
def entries(ctx: Context, spec: dict) -> np.ndarray:
    """+1 / -1 / 0 per strategy bar: a side fires on the bar its condition turns true;
    a bar where both fire takes neither."""
    entry = spec["entry"]
    long = _rising_edge(condition(ctx, entry["long"])) if entry.get("long") else np.zeros(ctx.bar_end.size, bool)
    short = _rising_edge(condition(ctx, entry["short"])) if entry.get("short") else np.zeros(ctx.bar_end.size, bool)
    out = np.zeros(ctx.bar_end.size, dtype=np.int8)
    out[long & ~short] = 1
    out[short & ~long] = -1
    out[~np.isfinite(ctx.atr)] = 0
    return out


def plans(ctx: Context, spec: dict, bars_index: np.ndarray, sides: np.ndarray) -> np.ndarray:
    """One engine plan row per entry (strategy-bar index, side), decided at that bar's close."""
    exit_spec = spec["exit"]
    tick = ctx.tick
    atr = ctx.atr[bars_index]
    plan = engine.empty_plan(bars_index.size)
    stop = exit_spec["stop"]
    atr_ticks = np.maximum(np.round(float(stop.get("fallback_atr", stop.get("mult", 1.5))) * atr / tick), 4)
    if stop["kind"] == "atr":
        plan[:, engine.P_STOP_TICKS] = np.maximum(np.round(float(stop["mult"]) * atr / tick), 4)
    elif stop["kind"] == "ticks":
        plan[:, engine.P_STOP_TICKS] = float(stop["value"])
    elif stop["kind"] == "series":
        # a distance in index points from a series at the signal bar (e.g. the expected move ahead) x mult
        plan[:, engine.P_STOP_TICKS] = np.maximum(np.round(float(stop.get("mult", 1.0)) * _side_series(ctx, stop, bars_index, sides) / tick), 4)
    elif stop["kind"] == "level":
        # "long_level" / "short_level" name the exact level the entry broke (e.g. the previous bar's
        # resistance_high for a breakout); without them: the zone under the close (long) / over it (short).
        # Round 1 used the nearest zone, which after a breakout was the broken one in only 38-55% of signals.
        low_edge = (series(ctx, stop["long_level"]) if "long_level" in stop else ctx.zones["support_low"].to_numpy(float))[bars_index]
        high_edge = (series(ctx, stop["short_level"]) if "short_level" in stop else ctx.zones["resistance_high"].to_numpy(float))[bars_index]
        buffer = float(stop.get("buffer_atr", 0.25)) * atr
        price = np.where(sides > 0, np.floor((low_edge - buffer) / tick) * tick, np.ceil((high_edge + buffer) / tick) * tick)
        plan[:, engine.P_STOP_PRICE] = price
        plan[:, engine.P_STOP_TICKS] = np.where(np.isfinite(price), np.nan, atr_ticks)
    else:
        raise ValueError(f"unknown stop kind {stop['kind']!r}")
    target = exit_spec.get("target", {"kind": "r", "value": 2.0})
    if target["kind"] == "r":
        plan[:, engine.P_TARGET_R] = float(target["value"])
        room = float(target.get("room_min_r", 0) or 0)
        if room > 0:
            # room filter at the signal close: skip when the next opposing zone is closer than room x the risk
            close = ctx.bars["close"][bars_index]
            opposing = np.where(sides > 0, ctx.zones["resistance_low"].to_numpy(float)[bars_index],
                                ctx.zones["support_high"].to_numpy(float)[bars_index])
            risk_ticks = np.where(np.isfinite(plan[:, engine.P_STOP_PRICE]),
                                  np.abs(close - plan[:, engine.P_STOP_PRICE]) / tick, plan[:, engine.P_STOP_TICKS])
            room_ticks = sides * (opposing - close) / tick
            blocked = np.isfinite(room_ticks) & (room_ticks < room * risk_ticks)
            plan[blocked, engine.P_STOP_PRICE] = np.nan
            plan[blocked, engine.P_STOP_TICKS] = np.nan          # the engine rejects a plan with no stop
    elif target["kind"] == "level":
        res = ctx.zones["resistance_low"].to_numpy(float)[bars_index]
        sup = ctx.zones["support_high"].to_numpy(float)[bars_index]
        gap = float(target.get("buffer_ticks", 1)) * tick
        price = np.where(sides > 0, np.floor((res - gap) / tick) * tick, np.ceil((sup + gap) / tick) * tick)
        plan[:, engine.P_TARGET_PRICE] = price
        plan[:, engine.P_MIN_ROOM_R] = float(target.get("min_r", 2.0))
        plan[:, engine.P_TARGET_R] = np.where(np.isfinite(price), np.nan, float(target.get("fallback_r", 2.0)))
    elif target["kind"] == "series":
        distance = float(target.get("mult", 1.0)) * _side_series(ctx, target, bars_index, sides)
        plan[:, engine.P_TARGET_TICKS] = np.where(np.isfinite(distance) & (distance > 0), np.maximum(np.round(distance / tick), 1), np.nan)
        plan[:, engine.P_TARGET_R] = np.where(np.isfinite(distance) & (distance > 0), np.nan, float(target.get("fallback_r", 2.0)))
    elif target["kind"] != "none":
        raise ValueError(f"unknown target kind {target['kind']!r}")
    mode = 0
    trail = exit_spec.get("trail", {})
    if trail.get("breakeven_after_r"):
        mode |= 2
        plan[:, engine.P_TRAIL_A] = float(trail["breakeven_after_r"])
        plan[:, engine.P_TRAIL_B] = float(trail.get("breakeven_offset_ticks", 1))
    if trail.get("chandelier_atr"):
        if mode & 2:
            raise ValueError("chandelier and breakeven share the trail columns; use one")
        mode |= 1
        plan[:, engine.P_TRAIL_A] = np.maximum(np.round(float(trail["chandelier_atr"]) * atr / tick), 4)
    plan[:, engine.P_TRAIL_MODE] = mode
    plan[:, engine.P_MAX_BARS] = int(exit_spec.get("time_stop_bars", 0))
    return plan


def _side_series(ctx: Context, node: dict, bars_index: np.ndarray, sides: np.ndarray) -> np.ndarray:
    """``of`` for both sides, or ``long_of`` / ``short_of``, read at the signal bars (points)."""
    if "of" in node:
        return series(ctx, node["of"])[bars_index]
    return np.where(sides > 0, series(ctx, node["long_of"])[bars_index], series(ctx, node["short_of"])[bars_index])


def exit_arrays(ctx: Context, spec: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Signal exits and strategy-bar closes on the minute path."""
    n = ctx.minutes.stamps.size
    bar_close = np.zeros(n, dtype=np.bool_)
    bar_close[ctx.last_minute] = True
    exit_long = np.zeros(n, dtype=np.bool_)
    exit_short = np.zeros(n, dtype=np.bool_)
    signal = spec["exit"].get("signal") or {}
    if signal.get("long"):
        exit_long[ctx.last_minute[condition(ctx, signal["long"])]] = True
    if signal.get("short"):
        exit_short[ctx.last_minute[condition(ctx, signal["short"])]] = True
    return exit_long, exit_short, bar_close


def run(ctx: Context, spec: dict, bars_index: np.ndarray, sides: np.ndarray, slippage: float, cost_ticks: float,
        exits=None, stop_ticks: np.ndarray | None = None) -> dict:
    """Trade the given entries (strategy-bar index, side) with the spec's exits.
    ``stop_ticks`` (one per entry) replaces the spec's stop: the geometry-matched nulls use it."""
    order = np.argsort(bars_index, kind="stable")
    bars_index, sides = bars_index[order], sides[order]
    risk = spec["exit"].get("risk", {})
    plan = plans(ctx, spec, bars_index, sides)
    if stop_ticks is not None:
        plan[:, engine.P_STOP_PRICE] = np.nan
        plan[:, engine.P_STOP_TICKS] = np.asarray(stop_ticks, dtype=float)[order]
    exit_long, exit_short, bar_close = exits if exits is not None else exit_arrays(ctx, spec)
    m = ctx.minutes
    (e_i, x_i, side, e_p, x_p, risk_t, reason, rolls, mfe, mae, held, rejected) = engine.simulate(
        m.open, m.high, m.low, m.close, ctx.last_minute[bars_index].astype(np.int64), sides.astype(np.int8), plan,
        exit_long, exit_short, bar_close, m.session_id, m.session_last, m.roll_after, ctx.tick, slippage,
        float(risk.get("min_ticks", 4)), float(risk.get("max_ticks", 1e9)), int(risk.get("max_entries_per_session", 0)),
        cost_ticks)
    gross = side * (x_p - e_p) / ctx.tick
    net = gross - cost_ticks * (1 + rolls)
    return {"entry": e_i, "exit": x_i, "side": side, "entry_price": e_p, "exit_price": x_p, "risk_ticks": risk_t,
            "reason": reason, "rolls": rolls, "gross": gross, "net": net, "mfe": mfe, "mae": mae, "held_minutes": held,
            "day": m.days[e_i], "year": pd.DatetimeIndex(m.days[e_i]).year.to_numpy(), "rejected": int(rejected),
            "net_r": np.where(risk_t > 0, net / np.where(risk_t > 0, risk_t, 1.0), np.nan)}


def signal_entries(ctx: Context, spec: dict) -> tuple[np.ndarray, np.ndarray]:
    signal = entries(ctx, spec)
    index = np.flatnonzero(signal != 0)
    return index, signal[index]


def matched_null_entries(ctx: Context, spec: dict, index: np.ndarray, sides: np.ndarray, seed: int,
                         span_mask_bars: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Random entries on the bars the spec's GATE allows (its session window, not its indicator
    conditions), inside the SAME span as the real entries (``span_mask_bars``), with the same
    count per hour of day and the same long share. Without the span mask the pool covered
    2019-2025 and only 14-21% of null trades landed in the evaluated year (round-1 review)."""
    rng = np.random.default_rng(seed)
    gate = condition(ctx, spec["gate"]) if spec.get("gate") else np.ones(ctx.bar_end.size, dtype=bool)
    allowed = gate & np.isfinite(ctx.atr)
    if span_mask_bars is not None:
        allowed &= span_mask_bars
    hours = ctx.start_minute // 60
    long_share = float((sides > 0).mean()) if sides.size else 0.5
    picked, picked_side = [], []
    for hour, count in pd.Series(hours[index]).value_counts().items():
        pool = np.flatnonzero(allowed & (hours == hour))
        if pool.size:
            chosen = rng.choice(pool, size=min(int(count), pool.size), replace=False)
            picked.append(chosen)
            picked_side.append(np.where(rng.random(chosen.size) < long_share, 1, -1))
    if not picked:
        return np.empty(0, np.int64), np.empty(0, np.int8)
    return np.concatenate(picked).astype(np.int64), np.concatenate(picked_side).astype(np.int8)


def uses_level_stop(spec: dict) -> bool:
    return spec["exit"]["stop"]["kind"] == "level"


def geometry_matched_stops(ctx: Context, real: dict, null_index: np.ndarray, seed: int) -> np.ndarray:
    """Stops for null entries of a LEVEL-stop strategy: a real trade's risk in ATR units, resampled,
    times the ATR at the null bar. A level stop applied at a random bar usually sits on the wrong
    side of the fill, so the engine rejected most null trades and the survivors had half the risk
    (round-2 review); matching the risk geometry makes the null comparable."""
    signal_bar = np.searchsorted(ctx.last_minute, real["entry"] - 1)
    signal_bar = np.clip(signal_bar, 0, ctx.atr.size - 1)
    risk_atr = real["risk_ticks"] * ctx.tick / ctx.atr[signal_bar]
    risk_atr = risk_atr[np.isfinite(risk_atr) & (risk_atr > 0)]
    if risk_atr.size == 0:
        risk_atr = np.array([1.5])
    rng = np.random.default_rng(seed)
    drawn = rng.choice(risk_atr, size=null_index.size, replace=True)
    return np.maximum(np.round(drawn * ctx.atr[null_index] / ctx.tick), 4)


def daily(trades: dict, days: np.ndarray) -> np.ndarray:
    """Net ticks per session day over ``days`` (0 on days without a trade)."""
    per_day = pd.Series(trades["net"]).groupby(trades["day"]).sum()
    return per_day.reindex(pd.Index(days), fill_value=0.0).to_numpy()


def spec_copy(spec: dict) -> dict:
    return copy.deepcopy(spec)


def finite(x) -> bool:
    return x is not None and not (isinstance(x, float) and math.isnan(x))
