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
    # the wick zone of every cluster: resistance from the lowest body top to the highest high, support the mirror
    np.testing.assert_allclose(actual["zone_top"].to_numpy(float), expected["zoneTop"].to_numpy(float), atol=1e-9)
    np.testing.assert_allclose(actual["zone_bottom"].to_numpy(float), expected["zoneBottom"].to_numpy(float), atol=1e-9)
    assert (actual["zone_top"] >= actual["zone_bottom"]).all()


def test_zone_features_are_causal_and_follow_the_spec():
    bars = random_walk_bars(800, seed=3)
    features = zones.zone_features(bars, lookback=5, max_levels=None)
    assert len(features) == len(bars)
    # truncation test: the features of the first 500 bars do not change when later bars are appended
    head = zones.zone_features(bars.iloc[:500].reset_index(drop=True), lookback=5, max_levels=None)
    for column in ("zone_price_support", "zone_price_resistance", "support_zone", "resistance_zone", "zone_strength", "bandwidth_points"):
        a, b = features[column].to_numpy()[:500], head[column].to_numpy()
        np.testing.assert_array_equal(np.nan_to_num(a, nan=-1), np.nan_to_num(b, nan=-1), err_msg=column)
    # the spec's flags: within the bandwidth of the nearest zone
    f = features[features["zone_price_support"].notna()]
    within = (np.abs(f["zone_price_support"] - bars.loc[f.index, "low"]) < f["bandwidth_points"]).astype(np.int8)
    assert within.tolist() == f["support_zone"].tolist()
    touched = features[features["support_zone"] == 1]
    assert (touched["support_zone_strength"] >= 2).all()          # a zone is at least two pivots
    assert (features["zone_strength"] == np.maximum(features["support_zone_strength"] * features["support_zone"],
                                                    features["resistance_zone_strength"] * features["resistance_zone"])).all()
    # a pivot enters the zones only when it is confirmed, lookback bars later
    first_confirmed = int(np.flatnonzero(features["pivot_low"].to_numpy())[0])
    assert features["zone_price_support"].iloc[: first_confirmed].isna().all()


def test_zone_features_replay_the_chart_on_the_window_ending_at_every_sampled_bar():
    """Event bars (a pivot confirmed) and non-event bars alike: the chart run on bars[i-window+1 : i+1]
    gives the same zones, nearest prices, strengths and flags as the causal walk at bar i."""
    bars = random_walk_bars(3000, seed=11)
    window, lookback = 500, 5
    features = zones.zone_features(bars, lookback=lookback, window_bars=window, max_levels=10)
    events = np.flatnonzero((features["pivot_high"] | features["pivot_low"]).to_numpy())
    rng = np.random.default_rng(0)
    sample = np.unique(np.r_[rng.choice(events[events >= window], 40, replace=False), rng.choice(np.arange(window, 3000), 60, replace=False)])
    checked = 0
    for i in sample:
        piece = bars.iloc[i - window + 1 : i + 1].reset_index(drop=True)
        chart = zones.compute_support_resistance(piece, lookback=lookback, max_levels=10)
        supports = chart[chart["type"] == "support"]
        resistances = chart[chart["type"] == "resistance"]
        row = features.iloc[i]
        assert int(row["support_zone_count"]) == len(supports), (i, "support count")
        assert int(row["resistance_zone_count"]) == len(resistances), (i, "resistance count")
        bandwidth = 0.5 * zones.true_range(*(piece[c].to_numpy(float) for c in ("high", "low", "close"))).mean()
        assert row["bandwidth_points"] == pytest.approx(bandwidth, rel=1e-9)
        if len(supports):
            nearest = supports.iloc[np.argmin(np.abs(supports["price"].to_numpy(float) - float(bars.loc[i, "low"])))]
            assert row["zone_price_support"] == pytest.approx(float(nearest["price"]), abs=1e-9), (i, "support price")
            assert int(row["support_zone_strength"]) == int(nearest["touches"]), (i, "support touches")
            assert int(row["support_zone"]) == int(abs(float(bars.loc[i, "low"]) - float(nearest["price"])) < bandwidth), (i, "support flag")
        if len(resistances):
            nearest = resistances.iloc[np.argmin(np.abs(resistances["price"].to_numpy(float) - float(bars.loc[i, "high"])))]
            assert row["zone_price_resistance"] == pytest.approx(float(nearest["price"]), abs=1e-9), (i, "resistance price")
            assert int(row["resistance_zone_strength"]) == int(nearest["touches"]), (i, "resistance touches")
        checked += 1
    assert checked >= 90


