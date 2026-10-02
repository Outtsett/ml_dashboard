"""TA-indicator strategy study (packages/ml-engine/src/ta_strategy): the properties its numbers rest on."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

pytest.importorskip("talib")

from cycle.rolls import Roll  # noqa: E402
from cycle.simulate import load_cost_model  # noqa: E402
from ta_strategy import evaluate, features, oracle  # noqa: E402
from ta_strategy.data import Bars, effective_roll_timestamps  # noqa: E402


def random_bars(n: int = 2500, seed: int = 0, start: int = 1_600_000_000, step: int = 3600) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 10000 + np.cumsum(rng.normal(0, 5, n))
    close = np.round(close * 4) / 4
    open_ = np.round((close + rng.normal(0, 2, n)) * 4) / 4
    high = np.maximum(open_, close) + np.round(rng.gamma(2, 2, n) * 4) / 4
    low = np.minimum(open_, close) - np.round(rng.gamma(2, 2, n) * 4) / 4
    return pd.DataFrame({"timestamp": start + np.arange(n) * step, "open": open_, "high": high, "low": low,
                         "close": close, "volume": rng.integers(100, 2000, n).astype(float)})


def test_features_are_causal():
    frame = random_bars()
    full = features.compute(frame).to_numpy(float)
    cut = 1500
    prefix = features.compute(frame.iloc[:cut]).to_numpy(float)
    a = full[:cut]
    assert np.array_equal(np.isfinite(a), np.isfinite(prefix))
    both = np.isfinite(a)
    np.testing.assert_allclose(a[both], prefix[both], rtol=1e-4, atol=1e-5)


def test_features_do_not_move_when_the_series_is_shifted():
    """A back-adjusted level carries future roll gaps; a feature that moves under a shift reads them."""
    frame = random_bars()
    shifted = frame.copy()
    for column in ("open", "high", "low", "close"):
        shifted[column] = shifted[column] + 2500.0
    a = features.compute(frame).to_numpy(float)
    b = features.compute(shifted).to_numpy(float)
    both = np.isfinite(a) & np.isfinite(b)
    assert np.array_equal(np.isfinite(a), np.isfinite(b))
    np.testing.assert_allclose(a[both], b[both], rtol=1e-6, atol=1e-6)


def test_no_absolute_price_column():
    names = features.compute(random_bars(400)).columns
    assert not [n for n in names if n in {"open", "high", "low", "close"} or n.startswith("absolute_")]


def test_label_is_the_trade_the_signal_asks_for():
    frame = pd.DataFrame({"open": [10.0, 11.0, 12.0, 11.0, 11.0, 15.0]})
    label, exit_index = evaluate.labels_for(frame, 2)
    # bar 0: fill at open[1]=11, exit at open[3]=11 -> tie -> no label
    assert np.isnan(label[0])
    # bar 1: fill at open[2]=12, exit at open[4]=11 -> down
    assert label[1] == 0.0
    # bar 2: fill at open[3]=11, exit at open[5]=15 -> up
    assert label[2] == 1.0
    assert np.isnan(label[3]) and np.isnan(label[5])
    assert exit_index[2] == 5


def _bars_with(frame: pd.DataFrame, rolls=None) -> Bars:
    return Bars(frame=frame, rolls=rolls or [], root="MNQ", timeframe="1h")


def test_gate_threshold_comes_from_validation_not_the_test_fold():
    frame = random_bars(300)
    window = evaluate.FoldWindow(0, pd.Timestamp(frame.timestamp[100], unit="s"), pd.Timestamp(frame.timestamp[299], unit="s"))
    rows = np.arange(100, 299)
    prediction = evaluate.HorizonPredictions("1h", 3, "logistic")
    # validation convictions are wide (up to 0.4); every test conviction is tiny (0.01)
    prediction.by_fold[0] = {
        "test_rows": rows, "probability": np.full(rows.size, 0.51), "validation_probability": np.linspace(0.1, 0.9, 500),
        "test_label": np.ones(rows.size), "auc": np.nan, "validation_auc": np.nan, "accuracy": np.nan,
        "majority_baseline_accuracy": np.nan, "fit_row_count": 0, "feature_count": 0,
    }
    cost = load_cost_model("MNQ")
    gated = evaluate.simulate(_bars_with(frame), prediction, evaluate.TradingRule(gate_fraction=0.1), cost, [window])
    # a test-fold quantile would have traded the top 10% of these bars; the validation threshold trades none
    assert len(gated["trades"]) == 0
    ungated = evaluate.simulate(_bars_with(frame), prediction, evaluate.TradingRule(gate_fraction=1.0), cost, [window])
    assert len(ungated["trades"]) >= 1


def test_fills_at_next_open_and_charges_costs():
    frame = random_bars(60)
    window = evaluate.FoldWindow(0, pd.Timestamp(frame.timestamp[10], unit="s"), pd.Timestamp(frame.timestamp[59], unit="s") + pd.Timedelta(hours=1))
    rows = np.arange(10, 60)
    probability = np.full(rows.size, 0.5)
    probability[0] = 0.9      # one long signal at bar 10's close
    prediction = evaluate.HorizonPredictions("1h", 3, "logistic")
    prediction.by_fold[0] = {"test_rows": rows, "probability": probability, "validation_probability": np.array([0.5, 0.6]),
                             "test_label": np.ones(rows.size), "auc": np.nan, "validation_auc": np.nan, "accuracy": np.nan,
                             "majority_baseline_accuracy": np.nan, "fit_row_count": 0, "feature_count": 0}
    cost = load_cost_model("MNQ")
    result = evaluate.simulate(_bars_with(frame), prediction, evaluate.TradingRule(gate_fraction=1.0), cost, [window])
    trade = result["trades"].iloc[0]
    assert trade["entry_price"] == frame.open[11]
    assert trade["cost_usd"] == pytest.approx(cost.round_trip)
    # the daily series sums to the trades' net (no roll inside)
    assert result["daily"]["net_usd"].sum() == pytest.approx(result["trades"]["net_profit_after_rolls_usd"].sum())


def test_a_position_across_a_real_roll_pays_another_round_trip():
    frame = random_bars(60)
    roll_time = int(frame.timestamp[14])
    rolls = [Roll(14, roll_time, "MNQH5", "MNQM5", 200.0, roll_time, True)]
    window = evaluate.FoldWindow(0, pd.Timestamp(frame.timestamp[10], unit="s"), pd.Timestamp(frame.timestamp[59], unit="s") + pd.Timedelta(hours=1))
    rows = np.arange(10, 60)
    probability = np.full(rows.size, 0.5)
    probability[0] = 0.9
    prediction = evaluate.HorizonPredictions("1h", 8, "logistic")
    prediction.by_fold[0] = {"test_rows": rows, "probability": probability, "validation_probability": np.array([0.5, 0.6]),
                             "test_label": np.ones(rows.size), "auc": np.nan, "validation_auc": np.nan, "accuracy": np.nan,
                             "majority_baseline_accuracy": np.nan, "fit_row_count": 0, "feature_count": 0}
    cost = load_cost_model("MNQ")
    result = evaluate.simulate(_bars_with(frame, rolls), prediction, evaluate.TradingRule(gate_fraction=1.0), cost, [window])
    trade = result["trades"].iloc[0]
    assert trade["rolls_crossed"] == 1
    assert trade["roll_cost_usd"] == pytest.approx(cost.round_trip)
    assert result["daily"]["net_usd"].sum() == pytest.approx(result["trades"]["net_profit_after_rolls_usd"].sum())


def test_flip_flops_between_two_contracts_are_not_rolls():
    rolls = [Roll(1, 100, "A", "B", 1, 100, True), Roll(2, 200, "B", "A", -1, 200, True),
             Roll(3, 300, "A", "B", 1, 300, True), Roll(9, 900, "B", "C", 1, 900, True)]
    assert effective_roll_timestamps(rolls).tolist() == [100, 900]


def test_session_day_rule():
    from ta_strategy.data import session_dates

    def stamp(text: str) -> int:
        return int(pd.Timestamp(text).timestamp())

    days = session_dates(np.array([
        stamp("2025-03-13 16:00"),   # Thursday after the 15:00 open -> Friday's session
        stamp("2025-03-14 09:00"),   # Friday RTH -> Friday
        stamp("2025-03-14 12:00"),   # Friday 4h bar 12:00-16:00 -> Friday
        stamp("2025-03-16 12:00"),   # Sunday 4h bar holding the 15:00 open -> Monday
        stamp("2025-03-16 15:00"),   # Sunday open -> Monday
    ]))
    assert [str(pd.Timestamp(d).date()) for d in days] == ["2025-03-14", "2025-03-14", "2025-03-14", "2025-03-17", "2025-03-17"]


def test_alpha_beta_recovers_a_planted_split():
    from ta_strategy import metrics

    rng = np.random.default_rng(3)
    market = rng.normal(10, 300, 3000)
    net = 5 + 0.5 * market + rng.normal(0, 50, 3000)
    ab = metrics.alpha_beta(net, market)
    assert ab["beta"] == pytest.approx(0.5, abs=0.02)
    assert ab["alpha"] == pytest.approx(5, abs=2.5)
    assert ab["alpha_newey_west_t"] > 2


def test_reality_check_separates_noise_from_a_real_edge():
    from ta_strategy import metrics

    rng = np.random.default_rng(5)
    noise = rng.normal(0, 100, (800, 20))
    assert metrics.reality_check_p_value(noise, repetitions=500) > 0.05
    edged = noise.copy()
    edged[:, 0] += 25
    assert metrics.reality_check_p_value(edged, repetitions=500) < 0.05
    assert metrics.effective_trial_count(noise) > 15


def test_centred_gate_does_not_read_the_drift_prior_as_conviction():
    frame = random_bars(120)
    window = evaluate.FoldWindow(0, pd.Timestamp(frame.timestamp[20], unit="s"), pd.Timestamp(frame.timestamp[119], unit="s") + pd.Timedelta(hours=1))
    rows = np.arange(20, 120)
    probability = np.full(rows.size, 0.55)          # a model that learned only the up-drift
    prediction = evaluate.HorizonPredictions("1h", 3, "logistic")
    prediction.by_fold[0] = {"test_rows": rows, "probability": probability, "validation_probability": np.full(200, 0.55),
                             "fit_mean_probability": 0.55, "fit_up_rate": 0.54, "test_label": np.ones(rows.size),
                             "auc": np.nan, "validation_auc": np.nan, "accuracy": np.nan,
                             "majority_baseline_accuracy": np.nan, "fit_row_count": 0, "feature_count": 0}
    cost = load_cost_model("MNQ")
    half = evaluate.simulate(_bars_with(frame), prediction, evaluate.TradingRule(gate_fraction=1.0), cost, [window])
    centred = evaluate.simulate(_bars_with(frame), prediction, evaluate.TradingRule(gate_fraction=1.0, gate_centre="fit_mean"), cost, [window])
    assert (half["trades"]["side"] == "long").all() and len(half["trades"]) >= 1
    assert len(centred["trades"]) == 0


def test_folds_are_cut_at_session_opens():
    windows = evaluate.fold_windows("2022-01-01", 6, "2023-01-01")
    assert windows[0].test_start == pd.Timestamp("2021-12-31 15:00")
    assert windows[1].test_start == pd.Timestamp("2022-06-30 15:00")
    assert windows[-1].test_end == pd.Timestamp("2022-12-31 15:00")


def test_a_session_is_never_split_between_folds():
    """A 4h bar stamped Sunday 12:00 holds Monday's session open; it must land in Monday's fold."""
    from ta_strategy.data import session_dates

    stamps = pd.date_range("2024-06-27 00:00", "2024-07-03 20:00", freq="4h")
    stamps = stamps[~((stamps.dayofweek == 5) | ((stamps.dayofweek == 6) & (stamps.hour < 12)))]
    frame = random_bars(len(stamps))
    frame["timestamp"] = (stamps.asi8 // 10**9).astype(np.int64)
    windows = evaluate.fold_windows("2024-06-01", 1, "2024-08-01")
    days = session_dates(frame["timestamp"].to_numpy())
    label, _ = evaluate.labels_for(frame, 1)
    fold_of_day: dict = {}
    for window in windows:
        first = (window.test_start + evaluate.SESSION_OPEN_OFFSET).normalize().to_datetime64()
        last = (window.test_end + evaluate.SESSION_OPEN_OFFSET).normalize().to_datetime64()
        for d in np.unique(days[(days >= first) & (days < last)]):
            fold_of_day.setdefault(d, set()).add(window.index)
    assert all(len(f) == 1 for f in fold_of_day.values())
    assert np.datetime64("2024-07-01") in fold_of_day


def test_zigzag_oracle_legs():
    price = np.array([0, 5, 10, 4, 1, 6, 12, 3.0])
    legs = oracle.zigzag_legs(price, 5.0)
    np.testing.assert_allclose(legs, [10, 9, 11, 9])
