"""Multi-timeframe levels, the conditional-strategy compiler and the exit engine (src/ml/ta_strategy)."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

pytest.importorskip("talib")
pytest.importorskip("numba")

from ta_strategy import bracket, engine, levels, strategy  # noqa: E402
from ta_strategy.data import aggregate_session_anchored  # noqa: E402

TICK = 0.25


def synth(n, seed, session_len=390):
    rng = np.random.default_rng(seed)
    close = np.round((15000 + np.cumsum(rng.normal(0, 1.2, n))) / TICK) * TICK
    sid = np.arange(n) // session_len
    open_ = np.r_[close[0], close[:-1]]
    gap = np.zeros(n)
    gap[np.flatnonzero(np.r_[False, sid[1:] != sid[:-1]])] = rng.normal(0, 8, sid[-1])
    open_ = np.round((open_ + gap) / TICK) * TICK
    high = np.maximum(open_, close) + np.round(rng.exponential(0.8, n) / TICK) * TICK
    low = np.minimum(open_, close) - np.round(rng.exponential(0.8, n) / TICK) * TICK
    session_last = np.r_[sid[1:] != sid[:-1], True]
    roll_after = np.zeros(n, bool)
    roll_after[rng.choice(n, 3, replace=False)] = True
    return open_, high, low, close, sid.astype(np.int64), session_last, roll_after


@pytest.mark.parametrize("seed", range(8))
def test_engine_equals_the_bracket_simulator_for_a_stop_and_r_target(seed):
    n = 30_000
    o, h, l, c, sid, sl, ra = synth(n, seed)
    rng = np.random.default_rng(seed + 100)
    signal = np.zeros(n, np.int8)
    pick = rng.choice(n, 1200, replace=False)
    signal[pick] = rng.choice([-1, 1], pick.size)
    stops = np.full(n, np.nan)
    stops[pick] = rng.integers(4, 60, pick.size)
    reward, slip = float(rng.choice([1.0, 2.0, 3.0])), float(rng.choice([0.0, 1.0]))
    a = bracket.simulate(o, h, l, c, signal, stops, sl, ra, TICK, reward, slip)
    idx = np.flatnonzero(signal != 0)
    plan = engine.empty_plan(idx.size)
    plan[:, engine.P_STOP_TICKS] = stops[idx]
    plan[:, engine.P_TARGET_R] = reward
    none = np.zeros(n, np.bool_)
    b = engine.simulate(o, h, l, c, idx.astype(np.int64), signal[idx], plan, none, none, none, sid, sl, ra, TICK, slip,
                        1e-9, 1e18, 0, 5.56)
    for k in range(8):
        assert np.array_equal(np.asarray(a[k]), np.asarray(b[k])), k


def one_trade(plan_values, exit_long=None, side=1, slip=0.0):
    n = 12
    o = np.array([100, 100, 101, 102, 103, 104, 103, 102, 101, 100, 99, 98], float)
    h, l, c = o + 0.5, o - 0.5, o.copy()
    last = np.zeros(n, np.bool_)
    last[-1] = True
    plan = engine.empty_plan(1)
    for k, v in plan_values.items():
        plan[0, k] = v
    el = np.zeros(n, np.bool_) if exit_long is None else exit_long
    r = engine.simulate(o, h, l, c, np.array([0], np.int64), np.array([side], np.int8), plan, el, np.zeros(n, np.bool_),
                        np.ones(n, np.bool_), np.zeros(n, np.int64), last, np.zeros(n, np.bool_), 1.0, slip, 1e-9, 1e18, 0, 0.0)
    return {"exit_index": int(r[1][0]) if len(r[0]) else None, "exit_price": float(r[4][0]) if len(r[0]) else None,
            "reason": int(r[6][0]) if len(r[0]) else None, "rejected": r[11]}


def test_signal_exit_fills_at_the_next_open():
    e = np.zeros(12, np.bool_)
    e[4] = True
    out = one_trade({engine.P_STOP_TICKS: 5, engine.P_TARGET_R: 10}, exit_long=e)
    assert out["reason"] == engine.EXIT_SIGNAL and out["exit_index"] == 5 and out["exit_price"] == 104.0


def test_time_stop_breakeven_chandelier_and_rejection():
    assert one_trade({engine.P_STOP_TICKS: 5, engine.P_TARGET_R: 10, engine.P_MAX_BARS: 3})["reason"] == engine.EXIT_TIME
    be = one_trade({engine.P_STOP_TICKS: 2, engine.P_TARGET_R: 20, engine.P_TRAIL_MODE: 2, engine.P_TRAIL_A: 1.0, engine.P_TRAIL_B: 0})
    assert be["reason"] == engine.EXIT_TRAIL and be["exit_price"] == 100.0
    ch = one_trade({engine.P_STOP_TICKS: 5, engine.P_TARGET_R: 20, engine.P_TRAIL_MODE: 1, engine.P_TRAIL_A: 2})
    assert ch["reason"] == engine.EXIT_TRAIL and ch["exit_price"] == 102.5       # running high 104.5 - 2 ticks
    assert one_trade({engine.P_STOP_PRICE: 105.0})["rejected"] == 1              # a stop above a long's fill
    room = one_trade({engine.P_STOP_PRICE: 99.0, engine.P_TARGET_PRICE: 101.0, engine.P_MIN_ROOM_R: 2.0})
    assert room["rejected"] == 1                                                  # 1 tick of room < 2R


def minute_frame(n_sessions=40, seed=0):
    rng = np.random.default_rng(seed)
    days = pd.bdate_range("2024-01-02", periods=n_sessions)
    stamps = []
    for d in days:
        start = pd.Timestamp(d) - pd.Timedelta(hours=9)                     # 15:00 the previous day
        stamps.append(start + pd.to_timedelta(np.arange(23 * 60), unit="m"))
    stamps = pd.DatetimeIndex(np.concatenate([s.values for s in stamps]))
    n = stamps.size
    close = np.round((17000 + np.cumsum(rng.normal(0, 1.5, n))) / TICK) * TICK
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) + np.round(rng.exponential(0.7, n) / TICK) * TICK
    low = np.minimum(open_, close) - np.round(rng.exponential(0.7, n) / TICK) * TICK
    return pd.DataFrame({"timestamp": (stamps.asi8 // 10**9).astype(np.int64), "open": open_, "high": high, "low": low,
                         "close": close, "volume": rng.integers(1, 500, n).astype(float), "raw_close": close,
                         "adjustment_points": np.zeros(n)})


def test_level_events_are_causal():
    frame = minute_frame()
    cut = int(frame["timestamp"].iloc[len(frame) * 2 // 3])
    full = levels.all_level_events(frame)
    part = levels.all_level_events(frame[frame["timestamp"] < cut])
    cols = ["price", "source", "known_from"]
    a = full[full["known_from"] < cut][cols].round(6).sort_values(cols).reset_index(drop=True)
    b = part[part["known_from"] < cut][cols].round(6).sort_values(cols).reset_index(drop=True)
    pd.testing.assert_frame_equal(a, b)


def test_fractal_is_known_only_at_confirmation():
    frame = minute_frame()
    events = levels.fractal_events(frame)
    four = events[events["timeframe"] == "4h"]
    bars, _ = aggregate_session_anchored(frame, "4h")
    ends = bars["end_timestamp"].to_numpy()
    k = levels.FRACTAL_SPEC["4h"][0]
    for row in four.itertuples():
        column = "high" if row.source.endswith("high") else "low"
        candidates = np.flatnonzero(bars[column].to_numpy() == row.price)
        # the extreme's bar is the one whose k-th successor closes exactly when the level becomes known
        assert any(i + k < ends.size and ends[i + k] == row.known_from for i in candidates), row
        assert all(row.known_from > ends[i] for i in candidates if i + k < ends.size and ends[i + k] == row.known_from)


def test_anchored_four_hour_bars_start_at_the_session_open():
    frame = minute_frame(5)
    bars, _ = aggregate_session_anchored(frame, "4h")
    hours = pd.to_datetime(bars["timestamp"], unit="s").dt.hour
    assert set(hours) <= {15, 19, 23, 3, 7, 11}


def test_vwap_is_causal():
    frame = minute_frame(3)
    ctx = levels.minute_context(frame)
    full = levels.session_vwap(ctx)["session_vwap"]
    part = levels.session_vwap(levels.minute_context(frame.iloc[:2000]))["session_vwap"]
    np.testing.assert_allclose(full[:2000], part)


def fake_context(close, high=None, low=None, atr=1.0, start_minute=None):
    n = len(close)
    close = np.asarray(close, float)
    high = close + 0.5 if high is None else np.asarray(high, float)
    low = close - 0.5 if low is None else np.asarray(low, float)
    return SimpleNamespace(
        bar_end=np.arange(n) * 900, bars={"open": close, "high": high, "low": low, "close": close, "volume": np.ones(n)},
        atr=np.full(n, atr), start_minute=np.full(n, 7 * 60) if start_minute is None else np.asarray(start_minute),
        cache={}, timeframe="15m", zones=pd.DataFrame({"resistance_high": np.full(n, 10.0)}))


def test_conditions_cross_within_then_broke_and_retest():
    ctx = fake_context([9, 9, 11, 12, 10.2, 11, 12])
    broke = strategy.condition(ctx, {"op": "broke_above", "level": {"level": "resistance_high"}})
    assert broke.tolist() == [False, False, True, False, False, False, False]
    retest = strategy.condition(ctx, {"op": "retest_above", "level": {"level": "resistance_high"}, "k": 3, "tol_atr": 0.3})
    assert retest.tolist() == [False, False, False, False, True, False, False]   # bar 4 dips to 9.7 <= 10.3 and closes 10.2 > 10
    cross = strategy.condition(ctx, {"op": "cross_above", "a": "close", "b": {"const": 10.5}})
    assert np.flatnonzero(cross).tolist() == [2, 5]
    within = strategy.condition(ctx, {"op": "within", "k": 2, "cond": {"op": "cross_above", "a": "close", "b": {"const": 10.5}}})
    assert np.flatnonzero(within).tolist() == [2, 3, 5, 6]
    then = strategy.condition(ctx, {"op": "then", "k": 3, "first": {"op": "cross_above", "a": "close", "b": {"const": 10.5}},
                                    "second": {"op": "below", "a": "close", "b": {"const": 10.5}}})
    assert np.flatnonzero(then).tolist() == [4]


def test_matched_null_stays_inside_the_evaluated_span():
    n = 400
    ctx = fake_context(np.linspace(100, 120, n), start_minute=np.tile(np.arange(6 * 60 + 30, 12 * 60 + 30, 15), 20)[:n])
    span = np.zeros(n, dtype=bool)
    span[300:] = True                           # the "test year"
    index = np.arange(300, 400, 7)
    sides = np.ones(index.size, dtype=np.int8)
    spec = {"gate": {"op": "session_window", "start": "06:30", "end": "12:30"}}
    for seed in range(5):
        picked, _ = strategy.matched_null_entries(ctx, spec, index, sides, seed, span)
        assert picked.size > 0 and span[picked].all()


def test_templates_materialize_and_every_param_is_used():
    config = json.loads((ROOT / "src" / "config" / "ta_conditional_templates.json").read_text(encoding="utf-8"))
    for name, template in config["templates"].items():
        spec = strategy.materialize(template, template["defaults"])
        text = json.dumps(spec)
        assert "param" not in text and "$" not in text, name
        for p in template["params"]:
            assert p in json.dumps(template["entry"]) + json.dumps(template["exit"]) + json.dumps(template.get("series", {})), (name, p)
        assert set(template["defaults"]) == set(template["params"]), name
