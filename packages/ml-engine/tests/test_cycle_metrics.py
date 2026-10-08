"""Model Cycle scoreboard metrics (packages/ml-engine/src/cycle/metrics.py).

Trading numbers are checked against arithmetic written out in the test (the
standard-library ``statistics`` module where a deviation is needed), the
classification numbers against scikit-learn, the trade distribution against
numpy / scipy / pandas. Undefined numbers must be None, never 0.
"""

from __future__ import annotations

import math
import re
import statistics
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from cycle.metrics import (
    METRIC_NAMES,
    MINIMUM_CREDIBLE_TRADES,
    PRICE_FORECAST_METRIC_NAMES,
    ScoreInputs,
    bars_per_year,
    buy_and_hold_usd,
    calmar_ratio,
    classification_metrics,
    distribution,
    maximum_drawdown,
    price_forecast_metrics,
    scoreboard,
    sharpe_ratio,
    sortino_ratio,
    trade_statistics,
)
from scipy import stats
from sklearn import metrics as sk

# the wire schema lives in the shared package (packages/shared), a sibling of this one
SCHEMA = Path(__file__).resolve().parents[2] / "shared" / "src" / "cycle" / "schema.ts"
PERIODS = 19_656.0   # e.g. 78 bars a day, 252 days


def schema_metric_names() -> list[str]:
    text = SCHEMA.read_text(encoding="utf-8")
    block = re.search(r"CYCLE_METRIC_NAMES = \[(.*?)\] as const", text, re.S).group(1)
    return re.findall(r'"([a-z0-9_]+)"', block)


# ─── names ─────────────────────────────────────────────────────────────────


def test_metric_names_match_the_wire_schema_in_order():
    assert list(METRIC_NAMES) == schema_metric_names()
    assert len(METRIC_NAMES) == 30
    assert PRICE_FORECAST_METRIC_NAMES == (
        "price_forecast_mean_absolute_error_points", "persistence_mean_absolute_error_points", "price_forecast_skill",
        "price_forecast_root_mean_square_error_points", "price_forecast_direction_accuracy",
    )


@pytest.mark.parametrize("empty", [True, False])
def test_every_scoreboard_carries_every_metric_name(empty):
    inputs = ScoreInputs() if empty else ScoreInputs(
        bar_net_usd=[1.0, -2.0, 3.0], bar_exposed=[True, False, True], trade_nets=[5.0, -1.0],
        total_cost_usd=5.6, scored_actual_up=[1, 0, 1], scored_predicted_up=[1, 1, 1],
        scored_probability_up=[0.7, 0.6, 0.8], scored_majority_up=[1, 1, 1], buy_and_hold_usd=12.0,
    )
    metrics, trade_distribution, notes = scoreboard(inputs, PERIODS)
    assert list(metrics) == schema_metric_names()
    assert set(trade_distribution) == {"count", "mean", "median", "standardDeviation", "skewness", "kurtosis",
                                       "percentile25", "percentile75", "minimum", "maximum"}
    for value in metrics.values():
        assert value is None or (isinstance(value, float) and math.isfinite(value))
    assert all(isinstance(note, str) for note in notes)


# ─── trading, by hand ──────────────────────────────────────────────────────

BARS = [1.0, -2.0, 3.0, 0.5]   # per-bar net USD


def test_sharpe_is_mean_over_sample_deviation_times_root_bars_per_year():
    expected = statistics.mean(BARS) / statistics.stdev(BARS) * math.sqrt(PERIODS)
    assert sharpe_ratio(np.array(BARS), PERIODS) == pytest.approx(expected, rel=1e-12)


def test_sortino_uses_the_downside_deviation_over_every_bar():
    # min(r, 0) = [0, -2, 0, 0] -> sqrt(mean(squares)) = sqrt(4 / 4) = 1
    expected = 0.625 / 1.0 * math.sqrt(PERIODS)
    assert sortino_ratio(np.array(BARS), PERIODS) == pytest.approx(expected, rel=1e-12)


def test_maximum_drawdown_starts_from_zero_equity_and_is_positive():
    # equity 0, 1, -1, 2, 2.5 -> the fall from 1 to -1
    assert maximum_drawdown(np.array(BARS)) == pytest.approx(2.0)
    # equity 0, -3, -2: the first bar's loss from the zero start counts
    assert maximum_drawdown(np.array([-3.0, 1.0])) == pytest.approx(3.0)
    assert maximum_drawdown(np.array([1.0, 2.0])) == 0.0


def test_calmar_is_annualised_profit_over_maximum_drawdown():
    expected = 0.625 * PERIODS / 2.0
    assert calmar_ratio(np.array(BARS), PERIODS) == pytest.approx(expected, rel=1e-12)


def test_trade_statistics_by_hand():
    values, notes = trade_statistics(np.array([10.0, -4.0, 6.0, -2.0]))
    assert values["profit_factor"] == pytest.approx(16.0 / 6.0)
    assert values["win_rate"] == pytest.approx(0.5)
    assert values["trade_count"] == 4.0
    assert values["average_trade_usd"] == pytest.approx(2.5)
    # 0.5 * 8 - 0.5 * 3
    assert values["expectancy_usd"] == pytest.approx(2.5)
    assert values["gross_profit_usd"] == pytest.approx(16.0)
    assert values["gross_loss_usd"] == pytest.approx(-6.0)
    assert any(str(MINIMUM_CREDIBLE_TRADES) in note for note in notes)


def test_scoreboard_trading_numbers_by_hand():
    inputs = ScoreInputs(bar_net_usd=list(BARS), bar_exposed=[True, False, True, True],
                         trade_nets=[10.0, -4.0, 6.0, -2.0], total_cost_usd=11.2)
    metrics, _, _ = scoreboard(inputs, PERIODS)
    assert metrics["net_profit_usd"] == pytest.approx(2.5)
    assert metrics["exposure_fraction"] == pytest.approx(0.75)
    assert metrics["total_cost_usd"] == pytest.approx(11.2)
    assert metrics["maximum_drawdown_usd"] == pytest.approx(2.0)
    assert metrics["sharpe_ratio"] == pytest.approx(statistics.mean(BARS) / statistics.stdev(BARS) * math.sqrt(PERIODS))
    assert metrics["buy_and_hold_net_profit_usd"] is None


def test_buy_and_hold_and_bars_per_year():
    # (18010 - 18000) points * $2 * 3 contracts - $2.80 round trip * 3
    assert buy_and_hold_usd(18000.0, 18010.0, 2.0, 3, 2.8) == pytest.approx(60.0 - 8.4)
    year = int(365.25 * 86400)
    assert bars_per_year(np.linspace(0, year, 1000).astype(np.int64)) == pytest.approx(1000.0, rel=1e-6)
    assert bars_per_year(np.array([0, 86400 * 2], dtype=np.int64)) == pytest.approx(2 / (2 / 365.25))
    with pytest.raises(ValueError):
        bars_per_year(np.array([5], dtype=np.int64))
    with pytest.raises(ValueError):
        bars_per_year(np.array([5, 5], dtype=np.int64))


# ─── classification vs scikit-learn ────────────────────────────────────────


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_classification_matches_scikit_learn(seed):
    generator = np.random.default_rng(seed)
    actual = generator.integers(0, 2, 400)
    probability = np.clip(0.5 + 0.3 * (actual - 0.5) + generator.normal(0, 0.25, 400), 0.0, 1.0)
    probability[:3] = [0.0, 1.0, 0.5]     # the clipped ends of log loss
    predicted = (probability >= 0.5).astype(int)
    ours = classification_metrics(actual, predicted, probability)
    assert ours["accuracy"] == pytest.approx(sk.accuracy_score(actual, predicted))
    assert ours["balanced_accuracy"] == pytest.approx(sk.balanced_accuracy_score(actual, predicted))
    assert ours["precision"] == pytest.approx(sk.precision_score(actual, predicted))
    assert ours["recall"] == pytest.approx(sk.recall_score(actual, predicted))
    assert ours["f1_score"] == pytest.approx(sk.f1_score(actual, predicted))
    assert ours["macro_f1_score"] == pytest.approx(sk.f1_score(actual, predicted, average="macro"))
    assert ours["roc_auc"] == pytest.approx(sk.roc_auc_score(actual, probability))
    assert ours["log_loss"] == pytest.approx(sk.log_loss(actual, probability, labels=[0, 1]), rel=1e-9)
    assert ours["brier_score"] == pytest.approx(sk.brier_score_loss(actual, probability))


def test_classification_when_the_model_predicts_one_class_only():
    actual = np.array([1, 0, 1, 1, 0])
    predicted = np.ones(5, dtype=int)
    probability = np.array([0.9, 0.6, 0.7, 0.8, 0.55])
    ours = classification_metrics(actual, predicted, probability)
    assert ours["macro_f1_score"] == pytest.approx(sk.f1_score(actual, predicted, average="macro", zero_division=0))
    assert ours["balanced_accuracy"] == pytest.approx(sk.balanced_accuracy_score(actual, predicted))
    assert ours["precision"] == pytest.approx(0.6)


# ─── undefined is None, never 0 ────────────────────────────────────────────


def test_undefined_trading_numbers_are_none():
    assert sharpe_ratio(np.array([]), PERIODS) is None
    assert sharpe_ratio(np.array([3.0]), PERIODS) is None           # fewer than two bars
    assert sharpe_ratio(np.array([2.0, 2.0, 2.0]), PERIODS) is None  # no variation
    assert sortino_ratio(np.array([1.0, 0.0, 2.0]), PERIODS) is None  # no losing bar
    assert calmar_ratio(np.array([1.0, 2.0]), PERIODS) is None       # no drawdown
    assert calmar_ratio(np.array([]), PERIODS) is None


def test_undefined_trade_numbers_are_none_with_a_note():
    values, notes = trade_statistics(np.array([4.0, 2.0]))
    assert values["profit_factor"] is None
    assert any("no losing trades" in note for note in notes)
    assert values["win_rate"] == 1.0
    values, notes = trade_statistics(np.array([]))
    for name in ("profit_factor", "win_rate", "average_trade_usd", "expectancy_usd"):
        assert values[name] is None
    assert values["trade_count"] == 0.0
    assert any("no closed trades" in note for note in notes)


def test_undefined_classification_numbers_are_none():
    empty = classification_metrics(np.array([]), np.array([]), np.array([]))
    assert all(value is None for value in empty.values())
    one_class = classification_metrics(np.array([1, 1, 1]), np.array([1, 0, 1]), np.array([0.8, 0.4, 0.9]))
    assert one_class["roc_auc"] is None
    assert one_class["accuracy"] == pytest.approx(2 / 3)
    never_up = classification_metrics(np.array([0, 0, 1]), np.array([0, 0, 0]), np.array([0.1, 0.2, 0.3]))
    assert never_up["precision"] is None      # nothing predicted up
    assert never_up["recall"] == 0.0          # defined: one up bar, missed
    no_positive = classification_metrics(np.array([0, 0]), np.array([0, 0]), np.array([0.1, 0.2]))
    assert no_positive["precision"] is None and no_positive["recall"] is None and no_positive["f1_score"] is None


def test_an_empty_scoreboard_is_null_where_undefined():
    metrics, trade_distribution, notes = scoreboard(ScoreInputs(), PERIODS)
    for name in ("sharpe_ratio", "sortino_ratio", "calmar_ratio", "profit_factor", "win_rate", "average_trade_usd",
                 "expectancy_usd", "exposure_fraction", "accuracy", "roc_auc", "log_loss", "brier_score",
                 "majority_class_accuracy", "buy_and_hold_net_profit_usd"):
        assert metrics[name] is None, name
    assert trade_distribution["count"] == 0
    assert all(trade_distribution[key] is None for key in trade_distribution if key != "count")
    assert any("no scored bars" in note for note in notes)


def test_scoreboard_notes_explain_undefined_sharpe_and_sortino():
    _, _, notes = scoreboard(ScoreInputs(bar_net_usd=[1.0], bar_exposed=[True]), PERIODS)
    assert any(note.startswith("Sharpe undefined") for note in notes)
    assert any(note.startswith("Sortino undefined") for note in notes)


def test_majority_class_baseline():
    inputs = ScoreInputs(scored_actual_up=[1, 0, 1, 1], scored_predicted_up=[1, 1, 0, 1],
                         scored_probability_up=[0.6, 0.7, 0.4, 0.9], scored_majority_up=[1, 1, 0, 0])
    metrics, _, _ = scoreboard(inputs, PERIODS)
    # majority [1, 1, 0, 0] against actual [1, 0, 1, 1]: right on bar 0 only
    assert metrics["majority_class_accuracy"] == pytest.approx(0.25)
    assert metrics["accuracy"] == pytest.approx(0.5)


# ─── the price forecast, by hand ───────────────────────────────────────────

# predicted moves [2, -1, 0.5, 0, 3] against actual moves [1, -2, -1, 4, 0] points
PREDICTED_MOVES = [2.0, -1.0, 0.5, 0.0, 3.0]
ACTUAL_MOVES = [1.0, -2.0, -1.0, 4.0, 0.0]


def test_price_forecast_metrics_by_hand():
    values = price_forecast_metrics(PREDICTED_MOVES, ACTUAL_MOVES)
    # errors 1, 1, 1.5, -4, 3 -> |e| sum 10.5 over 5 bars
    assert values["price_forecast_mean_absolute_error_points"] == pytest.approx(2.1)
    # persistence predicts no move: its error is the whole move, |1|+|-2|+|-1|+|4|+|0| = 8 over 5
    assert values["persistence_mean_absolute_error_points"] == pytest.approx(1.6)
    assert values["price_forecast_skill"] == pytest.approx(1 - 2.1 / 1.6)       # worse than persistence: negative
    # squares 1 + 1 + 2.25 + 16 + 9 = 29.25 over 5
    assert values["price_forecast_root_mean_square_error_points"] == pytest.approx(math.sqrt(29.25 / 5))
    # the zero predicted move (bar 4) and the zero actual move (bar 5) are left out:
    # signs (+,+) (-,-) (+,-) -> 2 of 3
    assert values["price_forecast_direction_accuracy"] == pytest.approx(2 / 3)


def test_price_forecast_metrics_are_none_when_undefined():
    assert all(value is None for value in price_forecast_metrics([], []).values())
    # every actual move zero: persistence is perfect, skill undefined, no signed pair
    flat = price_forecast_metrics([1.0, -0.5], [0.0, 0.0])
    assert flat["persistence_mean_absolute_error_points"] == 0.0
    assert flat["price_forecast_skill"] is None and flat["price_forecast_direction_accuracy"] is None
    assert flat["price_forecast_mean_absolute_error_points"] == pytest.approx(0.75)
    # a perfect forecast has skill 1
    assert price_forecast_metrics([1.0, -2.0], [1.0, -2.0])["price_forecast_skill"] == pytest.approx(1.0)
    with pytest.raises(ValueError):
        price_forecast_metrics([1.0], [1.0, 2.0])


def test_the_scoreboard_carries_the_price_forecast_metrics():
    inputs = ScoreInputs(forecast_predicted_move_points=list(PREDICTED_MOVES),
                         forecast_actual_move_points=list(ACTUAL_MOVES))
    metrics, _, notes = scoreboard(inputs, PERIODS)
    assert list(metrics)[-5:] == list(PRICE_FORECAST_METRIC_NAMES)
    assert metrics["price_forecast_mean_absolute_error_points"] == pytest.approx(2.1)
    assert metrics["price_forecast_skill"] == pytest.approx(1 - 2.1 / 1.6)
    assert not any("price forecast" in note for note in notes)
    empty, _, empty_notes = scoreboard(ScoreInputs(), PERIODS)
    assert all(empty[name] is None for name in PRICE_FORECAST_METRIC_NAMES)
    assert any(note.startswith("no resolved price forecasts") for note in empty_notes)
    _, _, flat_notes = scoreboard(ScoreInputs(forecast_predicted_move_points=[1.0],
                                              forecast_actual_move_points=[0.0]), PERIODS)
    assert any(note.startswith("price forecast skill undefined") for note in flat_notes)


# ─── the trade distribution ────────────────────────────────────────────────


@pytest.mark.parametrize("count", [4, 5, 37])
def test_trade_distribution_matches_numpy_scipy_and_pandas(count):
    generator = np.random.default_rng(count)
    values = np.round(generator.standard_t(3, count) * 20 - 3, 2)
    summary = distribution(values)
    series = pd.Series(values)
    assert summary["count"] == count
    assert summary["mean"] == pytest.approx(np.mean(values))
    assert summary["median"] == pytest.approx(np.median(values))
    assert summary["standardDeviation"] == pytest.approx(statistics.stdev(values.tolist()))
    assert summary["skewness"] == pytest.approx(stats.skew(values, bias=False))
    assert summary["skewness"] == pytest.approx(series.skew())
    assert summary["kurtosis"] == pytest.approx(stats.kurtosis(values, fisher=True, bias=False))
    assert summary["kurtosis"] == pytest.approx(series.kurt())
    assert summary["percentile25"] == pytest.approx(np.percentile(values, 25))
    assert summary["percentile75"] == pytest.approx(np.percentile(values, 75))
    assert summary["minimum"] == values.min() and summary["maximum"] == values.max()


@pytest.mark.parametrize("count", [1, 2, 3])
def test_trade_distribution_moments_need_enough_trades(count):
    values = np.array([5.0, -3.0, 8.0][:count])
    summary = distribution(values)
    assert summary["count"] == count
    assert summary["skewness"] is None and summary["kurtosis"] is None
    assert summary["mean"] == pytest.approx(values.mean())
    if count == 1:
        assert summary["standardDeviation"] is None
    else:
        assert summary["standardDeviation"] == pytest.approx(statistics.stdev(values.tolist()))


@pytest.mark.filterwarnings("ignore:Precision loss occurred in moment calculation:RuntimeWarning")
def test_constant_trades_have_no_skewness():
    summary = distribution(np.array([2.0, 2.0, 2.0, 2.0, 2.0]))
    assert summary["standardDeviation"] == 0.0
    assert summary["skewness"] is None and summary["kurtosis"] is None


def test_bars_per_year_ignores_a_data_outage_but_keeps_weekends():
    """A multi-week hole is not calendar time the market traded in; a weekend is."""
    five_minutes = 300
    day = 86_400
    # weekday 23-hour sessions, 5-minute bars, Monday 2025-09-29 onwards
    start = 1_759_104_000
    stamps = []
    for d in range(0, 91):
        if (d % 7) in (5, 6):  # Saturday, Sunday
            continue
        base = start + d * day
        stamps.extend(range(base, base + 23 * 3600, five_minutes))
    dense = np.array(stamps, dtype=np.int64)
    # the same, plus one week after a nine-week outage
    later = start + (91 + 63) * day
    tail = [later + d * day + k for d in range(5) for k in range(0, 23 * 3600, five_minutes)]
    holed = np.concatenate([dense, np.array(tail, dtype=np.int64)])
    # the tail week has no weekend, so it is a little denser; the old first-to-last
    # span measured about 45k here, 40% low
    assert bars_per_year(holed) == pytest.approx(bars_per_year(dense), rel=0.05)
