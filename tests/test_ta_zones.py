"""Zone touches and their outcomes (src/ml/ta_strategy/zones.py)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

from ta_strategy import strategy, zones  # noqa: E402


def test_race_reports_which_comes_first():
    close = np.array([100.0, 100.5, 101.0, 102.0, 103.0, 104.0, 105.0, 104.0, 99.0, 98.0])
    high = close + 0.5
    low = close - 0.5
    start = np.array([1, 1], np.int64)
    stop = np.array([10, 10], np.int64)
    side = np.array([1, 1], np.int8)
    edge = np.array([99.5, 99.5])            # far edge of the support zone
    buffer = np.array([0.25, 0.25])
    target = np.array([104.0, 110.0])        # reached at minute 5 / never
    out, best, end = zones._race(high, low, close, start, stop, side, edge, buffer, target)
    assert out.tolist() == [1, -1]           # target first; then the zone breaks at minute 8 (close 99 < 99.25)
    assert best[1] == pytest.approx(105.5 - 100.0)
    assert end.tolist() == [5, 8]


def test_touch_requires_entering_the_zone_from_above(monkeypatch):
    from types import SimpleNamespace

    import pandas as pd

    n = 60
    close = np.full(n, 105.0)
    close[20:24] = [103.0, 101.4, 101.6, 102.5]     # dips into the support zone [100, 101.5] at minute 21 and closes back above
    high = close + 0.3
    low = close - 0.3
    stamps = 1_700_000_000 + np.arange(n) * 60
    frame = pd.DataFrame({"timestamp": stamps, "open": close, "high": high, "low": low, "close": close, "volume": 10.0})
    bars = 12
    last_minute = np.arange(4, n, 5)
    zone = pd.DataFrame({"support_low": np.full(bars, 100.0), "support_high": np.full(bars, 101.5), "support_strength": np.full(bars, 2.0),
                         "support_families": ["a+b"] * bars, "resistance_low": np.full(bars, 110.0), "resistance_high": np.full(bars, 110.5),
                         "resistance_strength": np.full(bars, 1.0), "resistance_families": ["c"] * bars})
    days = np.array([np.datetime64("2024-01-02")] * n)
    ctx = SimpleNamespace(minutes=SimpleNamespace(stamps=stamps, high=high, low=low, close=close, session_id=np.zeros(n, np.int64), days=days),
                          minutes_frame=frame, last_minute=last_minute, zones=zone, tick=0.25,
                          bars={"close": close[last_minute]})
    import ta_strategy.zones as z
    monkeypatch.setattr(z, "atr_per_minute", lambda f: np.full(len(f), 1.0))            # a flat ATR for the synthetic path
    monkeypatch.setattr(z.cascade, "expected_volume", lambda f, d: np.full(len(f), 10.0))
    monkeypatch.setattr(z.seasonality, "build", lambda f, d: SimpleNamespace(ahead_ratio=lambda i, k: np.ones(len(i)), expected_move_points=lambda i, k: np.ones(len(i))))
    t = z.touches(ctx, horizon_minutes=30)
    assert len(t) == 1 and t.loc[0, "minute"] == 21 and t.loc[0, "side"] == 1
    assert bool(t.loc[0, "bounced"]) is True                   # price moved 1 ATR above the zone top before breaking


def test_zone_templates_materialize():
    config = json.loads((ROOT / "src" / "config" / "ta_conditional_templates.json").read_text(encoding="utf-8"))["templates"]
    names = [k for k in config if k.startswith("zone_")]
    assert len(names) >= 6
    for name in names:
        spec = strategy.materialize(config[name], config[name]["defaults"])
        assert '"param"' not in json.dumps(spec)
        assert set(config[name]["defaults"]) == set(config[name]["params"])


def test_gap_through_is_a_break_never_a_bounce(monkeypatch):
    from types import SimpleNamespace

    import pandas as pd

    n = 60
    close = np.full(n, 105.0)
    close[20:30] = 99.0                                   # opens and stays below the support zone [100, 101.5]
    high = close + 0.3
    low = close - 0.3
    opens = close.copy()
    stamps = 1_700_000_000 + np.arange(n) * 60
    frame = pd.DataFrame({"timestamp": stamps, "open": opens, "high": high, "low": low, "close": close, "volume": 10.0})
    bars = 12
    last_minute = np.arange(4, n, 5)
    zone = pd.DataFrame({"support_low": np.full(bars, 100.0), "support_high": np.full(bars, 101.5), "support_strength": np.full(bars, 2.0),
                         "support_families": ["a+b"] * bars, "resistance_low": np.full(bars, 110.0), "resistance_high": np.full(bars, 110.5),
                         "resistance_strength": np.full(bars, 1.0), "resistance_families": ["c"] * bars})
    days = np.array([np.datetime64("2024-01-02")] * n)
    ctx = SimpleNamespace(minutes=SimpleNamespace(stamps=stamps, high=high, low=low, close=close, session_id=np.zeros(n, np.int64), days=days),
                          minutes_frame=frame, last_minute=last_minute, zones=zone, tick=0.25, bars={"close": close[last_minute]})
    import ta_strategy.zones as z
    monkeypatch.setattr(z, "atr_per_minute", lambda f: np.full(len(f), 1.0))
    monkeypatch.setattr(z.cascade, "expected_volume", lambda f, d: np.full(len(f), 10.0))
    monkeypatch.setattr(z.seasonality, "build", lambda f, d: SimpleNamespace(ahead_ratio=lambda i, k: np.ones(len(i)), expected_move_points=lambda i, k: np.ones(len(i))))
    t = z.touches(ctx, horizon_minutes=30)
    assert len(t) == 1 and bool(t.loc[0, "gapped_through"]) and bool(t.loc[0, "broke"]) and not bool(t.loc[0, "bounced"])


def test_benjamini_hochberg_and_bootstrap_p():
    import ta_strategy.zones as z

    survive = z._benjamini_hochberg(np.array([0.001, 0.02, 0.5, np.nan, 0.03]), q=0.10)
    assert survive.tolist() == [True, True, False, False, True]
    assert z._bootstrap_p([1.0, 2.0, 3.0]) == pytest.approx(0.5)      # (0 + 1) / (3 + 1), two-sided
    assert z._bootstrap_p([-1.0, 1.0, 2.0, -2.0]) == 1.0
    assert z._exact_spearman(np.array([3.0, 2.0, 1.0])) == (-1.0, pytest.approx(1 / 3))
    credit = z._one_position_oracle(np.array([10, 12, 40]), np.array([30, 20, 50]), np.array([5.0, 7.0, 9.0]))
    assert credit.tolist() == [5.0, 0.0, 9.0]
