"""Multi-timeframe swing levels and the cascade trend state (src/ml/ta_strategy/cascade.py)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

from ta_strategy import cascade, strategy  # noqa: E402
from ta_strategy.data import session_dates  # noqa: E402


def staircase_minutes(sessions: int = 12, seed: int = 1) -> pd.DataFrame:
    """Noisy minutes with one deliberate upward staircase in the last session: a run of higher highs
    that breaks every timeframe's swing high in order."""
    rng = np.random.default_rng(seed)
    days = pd.bdate_range("2024-02-05", periods=sessions)
    stamps, closes = [], []
    price = 18000.0
    for d in days:
        start = int(pd.Timestamp(d).value // 10**9) - 9 * 3600
        for o in range(1380):
            price += rng.normal(0, 0.8) - 0.002 * (price - 18000.0)
            stamps.append(start + o * 60)
            closes.append(price)
    closes = np.asarray(closes)
    n = closes.size
    ramp_start = n - 400
    floor = closes[ramp_start - 2880:ramp_start].min() - 10          # start below every active level of every timeframe
    closes[ramp_start:] = floor + np.linspace(0, 140, n - ramp_start) + rng.normal(0, 0.3, n - ramp_start)
    high = closes + np.abs(rng.normal(0, 0.3, n))
    low = closes - np.abs(rng.normal(0, 0.3, n))
    return pd.DataFrame({"timestamp": np.asarray(stamps, np.int64), "open": closes, "high": high, "low": low, "close": closes,
                         "volume": rng.integers(5, 50, n).astype(float), "contract": "MNQH4"})


def test_swing_levels_are_known_after_k_bars_and_break_on_a_close_beyond():
    frame = staircase_minutes()
    c = cascade.build(frame, window_minutes=240)
    lv = c.levels
    assert set(lv["timeframe"]) == set(cascade.TIMEFRAMES)
    close = frame["close"].to_numpy(float)
    for r in lv[lv["break_minute"] >= 0].head(200).itertuples():
        k = cascade.SWING_SPEC[r.timeframe][0]
        width = cascade.WIDTH[r.timeframe]
        assert r.known_minute >= r.bar_index * width + k * width - 1          # known at the close of bar i + k
        assert r.break_minute > r.known_minute
        if r.side == 1:
            assert close[r.break_minute] > r.price
        else:
            assert close[r.break_minute] < r.price


def test_cascade_reaches_every_stage_in_order_on_the_staircase_and_is_causal():
    frame = staircase_minutes()
    c = cascade.build(frame, window_minutes=240)
    n = len(frame)
    tail = slice(n - 400, n)
    assert c.stage_up[tail].max() == 4
    first = [n - 400 + int(np.flatnonzero(c.stage_up[tail] >= s)[0]) for s in (1, 2, 3, 4)]
    assert first == sorted(first)                                        # the stages are reached in order
    assert c.direction[tail][-50:].tolist() == [1] * 50
    # every minute's state is unchanged by later data
    cut = n - 150
    part = cascade.build(frame.iloc[:cut].reset_index(drop=True), window_minutes=240)
    np.testing.assert_array_equal(part.stage_up, c.stage_up[:cut])
    np.testing.assert_array_equal(part.stage_down, c.stage_down[:cut])
    for tf in cascade.TIMEFRAMES:
        np.testing.assert_array_equal(part.last_side[tf], c.last_side[tf][:cut])


def test_relative_volume_and_trend_match_closed_forms():
    rng = np.random.default_rng(2)
    volume = rng.integers(1, 100, 500).astype(float)
    expected = np.full(500, 40.0)
    expected[:30] = np.nan
    rel = cascade.relative_volume(volume, expected, 10)
    assert np.isnan(rel[:39]).all()
    assert rel[100] == pytest.approx(volume[91:101].sum() / 400.0)
    trend = cascade.volume_trend(volume, expected, 10)
    y = volume[91:101] / 40.0
    slope = np.polyfit(np.arange(10), y, 1)[0]
    assert trend[100] == pytest.approx(slope / y.mean())
    assert np.isnan(trend[35])


def test_expected_volume_is_the_previous_sessions_profile():
    frame = staircase_minutes(sessions=30)
    days = session_dates(frame["timestamp"].to_numpy(np.int64))
    expected = cascade.expected_volume(frame, days, sessions=10)
    session = np.cumsum(np.r_[True, days[1:] != days[:-1]]) - 1
    assert np.isnan(expected[session < 5]).all()
    m = np.flatnonzero(session == 20)[600]
    offset = int((frame["timestamp"].iloc[m] % 86400) // 60 - 15 * 60) % 1440
    bucket = offset // 5
    prior = []
    for s in range(10, 20):
        rows = np.flatnonzero(session == s)
        offsets = ((frame["timestamp"].to_numpy(np.int64)[rows] % 86400) // 60 - 15 * 60) % 1440
        prior.append(frame["volume"].to_numpy(float)[rows][offsets // 5 == bucket].mean())
    assert expected[m] == pytest.approx(np.mean(prior))


def test_cascade_templates_materialize_and_read_cascade_series():
    config = json.loads((ROOT / "src" / "config" / "ta_conditional_templates.json").read_text(encoding="utf-8"))["templates"]
    names = [k for k in config if k.startswith("cascade")]
    assert len(names) >= 8
    for name in names:
        spec = strategy.materialize(config[name], config[name]["defaults"])
        text = json.dumps(spec)
        assert '"param"' not in text
        assert '"cascade"' in text
        assert set(config[name]["defaults"]) == set(config[name]["params"])
