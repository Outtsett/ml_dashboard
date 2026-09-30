"""Support / resistance zones (src/ml/shared/zones.py): the chart's definition, in numpy and pandas."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from shared import zones  # noqa: E402


def random_walk_bars(n: int = 600, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 20_000 + np.cumsum(rng.normal(0, 8, n)).round(2)
    spread = np.abs(rng.normal(6, 3, n)) + 1
    high = close + spread * rng.random(n)
    low = close - spread * rng.random(n)
    opens = np.r_[close[0], close[:-1]]
    return pd.DataFrame({"time": 1_700_000_000 + 300 * np.arange(n), "open": opens, "high": high.round(2), "low": low.round(2), "close": close})


def test_structural_pivots_are_strict_extremes_with_bars_on_both_sides():
    high = np.array([1, 2, 5, 2, 1, 3, 4, 3, 1, 1, 1], float)
    low = 10 - high
    highs, lows = zones.structural_pivots(high, low, lookback=2)
    assert highs.tolist() == [2, 6]
    assert lows.tolist() == [2, 6]
    # an equal neighbour is not a strict extreme
    high2 = np.array([1, 2, 5, 5, 1, 1, 1], float)
    assert zones.structural_pivots(high2, 10 - high2, lookback=2)[0].tolist() == []


def test_cluster_levels_follows_the_running_mean_rule():
    prices = np.array([100.0, 100.4, 100.9, 105.0, 105.1, 120.0])
    times = np.arange(prices.size)
    levels = zones.cluster_levels(prices, times, tolerance=0.5)
    # 100, 100.4 (mean 100.2), 100.9 is 0.7 from the mean -> new cluster; 105/105.1 join; 120 alone (dropped)
    assert levels["touches"].tolist() == [2, 2]
    assert levels["price"].round(2).tolist() == [100.2, 105.05]
    assert levels["strength"].tolist() == [1.0, 1.0]


@pytest.mark.skipif(shutil.which("npx") is None, reason="npx is not on PATH")
def test_parity_with_the_charts_typescript():
    bars = random_walk_bars()
    payload = {"bars": bars.to_dict(orient="records"), "lookback": 5, "maxLevels": 10}
    result = subprocess.run(["npx", "tsx", str(ROOT / "tests" / "fixtures" / "support_resistance_parity.ts")], input=json.dumps(payload),
                            capture_output=True, text=True, cwd=ROOT, shell=sys.platform == "win32", timeout=180)
    assert result.returncode == 0, result.stderr[-800:]
    expected = pd.DataFrame(json.loads(result.stdout))
    actual = zones.compute_support_resistance(bars, lookback=5, max_levels=10)
    assert len(actual) == len(expected) > 0
    assert actual["type"].tolist() == expected["type"].tolist()
    assert actual["touches"].tolist() == expected["touches"].tolist()
    np.testing.assert_allclose(actual["price"].to_numpy(float), expected["price"].to_numpy(float), rtol=0, atol=1e-9)
    np.testing.assert_allclose(actual["strength"].to_numpy(float), expected["strength"].to_numpy(float), atol=1e-12)
    assert actual["first_time"].tolist() == expected["firstTime"].tolist()
    assert actual["last_time"].tolist() == expected["lastTime"].tolist()


def test_zone_features_are_causal_and_follow_the_spec():
    bars = random_walk_bars(800, seed=3)
    features = zones.zone_features(bars, lookback=5, max_levels=None)
    assert len(features) == len(bars)
    # truncation test: the features of the first 500 bars do not change when later bars are appended
    head = zones.zone_features(bars.iloc[:500].reset_index(drop=True), lookback=5, max_levels=None)
    for column in ("zone_price_support", "zone_price_resistance", "support_zone", "resistance_zone", "zone_strength", "bandwidth"):
        a, b = features[column].to_numpy()[:500], head[column].to_numpy()
        np.testing.assert_array_equal(np.nan_to_num(a, nan=-1), np.nan_to_num(b, nan=-1), err_msg=column)
    # the spec's flags: within the bandwidth of the nearest zone
    f = features[features["zone_price_support"].notna()]
    within = (np.abs(f["zone_price_support"] - bars.loc[f.index, "low"]) < f["bandwidth"]).astype(np.int8)
    assert within.tolist() == f["support_zone"].tolist()
    touched = features[features["support_zone"] == 1]
    assert (touched["support_zone_strength"] >= 2).all()          # a zone is at least two pivots
    assert (features["zone_strength"] == np.maximum(features["support_zone_strength"] * features["support_zone"],
                                                    features["resistance_zone_strength"] * features["resistance_zone"])).all()
    # a pivot enters the zones only when it is confirmed, lookback bars later
    first_confirmed = int(np.flatnonzero(features["pivot_low"].to_numpy())[0])
    assert features["zone_price_support"].iloc[: first_confirmed].isna().all()


def test_zone_features_at_the_last_bar_are_the_charts_levels_over_its_window():
    bars = random_walk_bars(2000, seed=11)
    window = 700
    features = zones.zone_features(bars, lookback=5, window_bars=window, max_levels=10)
    last = features.iloc[-1]
    chart = zones.compute_support_resistance(bars.iloc[-window:].reset_index(drop=True), lookback=5, max_levels=10)
    # the chart's pivots need 5 bars after them, so the last 5 bars' pivots are not yet known to either
    supports = np.sort(chart.loc[chart["type"] == "support", "price"].to_numpy(float))
    resistances = np.sort(chart.loc[chart["type"] == "resistance", "price"].to_numpy(float))
    assert int(last["support_zone_count"]) == supports.size
    assert int(last["resistance_zone_count"]) == resistances.size
    if supports.size:
        assert np.min(np.abs(supports - last["zone_price_support"])) < 1e-9
    if resistances.size:
        assert np.min(np.abs(resistances - last["zone_price_resistance"])) < 1e-9
    assert last["bandwidth"] == pytest.approx(0.5 * zones.true_range(*(bars.iloc[-window:][c].to_numpy(float) for c in ("high", "low", "close"))).mean(), rel=1e-9)
