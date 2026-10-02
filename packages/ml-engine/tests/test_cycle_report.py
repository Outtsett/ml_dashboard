"""The in-depth metric tables (packages/ml-engine/src/cycle/report.py) on hand-built records.

Parity with the engine's own scoreboards on real engine runs is held in
tests/test_cycle_engine.py (``test_the_report_reproduces_every_scoreboard``);
this file checks every other number against a reference: scikit-learn for the
classification and calibration metrics, closed forms worked by hand for the
drawdown episodes, streaks and the probabilistic Sharpe ratio, and the stated
rules for session days, undefined values and records from before 2026-09-27.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np
import pyarrow as pa
import pytest

from cycle import report
from cycle.metrics import METRIC_NAMES

MNQ_OPEN = int(datetime(2025, 12, 1, 15, 0, tzinfo=timezone.utc).timestamp())   # 15:00 Pacific stored as UTC


def record(bar_net, *, probability=None, actual=None, fold=None, position=None, trades=None, timestamps=None,
           with_forecast=False, old_position=None):
    """A predictions table and a trades table shaped like the record's."""
    count = len(bar_net)
    generator = np.random.default_rng(3)
    probability = np.asarray(probability if probability is not None else generator.uniform(0.3, 0.7, count))
    actual = np.asarray(actual if actual is not None else np.where(generator.uniform(size=count) < 0.5, 1, -1))
    fold = np.asarray(fold if fold is not None else np.zeros(count, dtype=int))
    timestamps = np.asarray(timestamps if timestamps is not None else MNQ_OPEN + 300 * np.arange(count))
    columns = {
        "timestamp": pa.array(timestamps.astype(np.int64)), "fold_index": pa.array(fold.astype(np.int64)),
        "open": pa.array(np.full(count, 100.0)), "close": pa.array(np.full(count, 100.0)),
        "probability_up": pa.array(probability.astype(np.float64)),
        "predicted_direction": pa.array(np.where(probability >= 0.5, 1, -1).astype(np.int64)),
        "actual_direction": pa.array(actual.astype(np.int64)),
        "correct": pa.array([None if a == 0 else bool((p >= 0.5) == (a > 0)) for p, a in zip(probability, actual)], type=pa.bool_()),
        "bar_net_profit_usd": pa.array(np.asarray(bar_net, dtype=np.float64)),
    }
    if old_position is not None:
        columns["position"] = pa.array(np.asarray(old_position, dtype=np.int64))
    else:
        held = np.asarray(position if position is not None else np.ones(count, dtype=int))
        columns["position_held"] = pa.array(held.astype(np.int64))
        columns["exposed"] = pa.array(held != 0)
    if with_forecast:
        columns["predicted_move_points"] = pa.array(np.linspace(-2, 2, count))
        columns["forecast_error_points"] = pa.array(np.linspace(-1, 1, count) * 0.5)
    predictions = pa.table(columns)
    trade_rows = trades or []
    trade_table = pa.table({
        "trade_number": pa.array(list(range(1, len(trade_rows) + 1)), type=pa.int64()),
        "fold_index": pa.array([row.get("fold", 0) for row in trade_rows], type=pa.int64()),
        "side": pa.array([row.get("side", "long") for row in trade_rows], type=pa.string()),
        "contracts": pa.array([row.get("contracts", 1) for row in trade_rows], type=pa.int64()),
        "entry_timestamp": pa.array([MNQ_OPEN + 300 * i for i in range(len(trade_rows))], type=pa.int64()),
        "exit_timestamp": pa.array([MNQ_OPEN + 300 * i + 600 for i in range(len(trade_rows))], type=pa.int64()),
        "bars_held": pa.array([row.get("bars", 2) for row in trade_rows], type=pa.int64()),
        "probability_up_at_entry": pa.array([row.get("probability", 0.6) for row in trade_rows], type=pa.float64()),
        "gross_profit_usd": pa.array([row["net"] + row.get("cost", 2.78) for row in trade_rows], type=pa.float64()),
        "cost_usd": pa.array([row.get("cost", 2.78) for row in trade_rows], type=pa.float64()),
        "net_profit_usd": pa.array([row["net"] for row in trade_rows], type=pa.float64()),
        "exit_reason": pa.array([row.get("reason", "signal") for row in trade_rows], type=pa.string()),
    })
    return predictions, trade_table


def build(predictions, trades, *, bars_per_year=1000.0, folds=None, symbol="MNQ"):
    inputs = report.inputs_from_tables("test_run", symbol, predictions, trades, folds, bars_per_year)
    return inputs, report.build_report(inputs)


def value(tables, name, *, scope="run", fold=None, kind="all", segment="all"):
    table = "model_metrics" if report.DEFINITIONS[name].table == "model_metrics" else "trading_metrics"
    rows = [row for row in tables[table].to_pylist()
            if (row["scope"], row["fold_index"], row["segment_kind"], row["segment_value"], row["metric_name"])
            == (scope, fold, kind, segment, name)]
    assert len(rows) == 1, (name, scope, fold, kind, segment, len(rows))
    return rows[0]


# ─── the contract ───────────────────────────────────────────────────────────


def test_every_table_has_its_columns_and_every_metric_its_definition():
    predictions, trades = record(np.random.default_rng(1).normal(0, 5, 300),
                                 trades=[{"net": 10.0}, {"net": -4.0}, {"net": 6.0}])
    _, tables = build(predictions, trades)
    assert set(tables) == set(report.REPORT_TABLES)
    for name, table in tables.items():
        assert table.column_names == [column for column, _ in report.REPORT_COLUMNS[name]]
    for table in ("model_metrics", "trading_metrics"):
        for row in tables[table].to_pylist():
            definition = report.DEFINITIONS[row["metric_name"]]
            assert definition.table == table
            assert row["metric_label"] and row["definition"] and row["formula"] and row["unit"]
            assert row["better"] in {"higher", "lower", "closer_to_zero", "none"}
            assert row["metric_value"] is None or math.isfinite(row["metric_value"])
            assert row["metric_value"] is not None or row["note"], f"{row['metric_name']} is null with no reason"
    # the scoreboard's thirty names are all carried
    assert set(METRIC_NAMES) <= set(report.DEFINITIONS)


def test_names_are_full_words_with_units():
    banned = {"pct", "avg", "std", "num", "cnt", "ret", "dd", "pnl", "mae", "rmse", "mcc", "auc", "ece", "mce",
              "sqn", "psr", "ts", "tf", "prob", "pos", "qty"}
    for name in report.DEFINITIONS:
        assert not set(name.split("_")) & banned or name == "roc_auc", name
    for columns in report.REPORT_COLUMNS.values():
        for column, _ in columns:
            assert not set(column.split("_")) & banned, column


# ─── classification and calibration against scikit-learn ───────────────────


def test_classification_metrics_equal_scikit_learn():
    from sklearn.metrics import (
        average_precision_score,
        cohen_kappa_score,
        matthews_corrcoef,
        precision_score,
        recall_score,
    )

    generator = np.random.default_rng(11)
    count = 800
    actual = np.where(generator.uniform(size=count) < 0.45, 1, -1)
    probability = np.clip(0.5 + 0.15 * (actual > 0) + generator.normal(0, 0.2, count), 0.01, 0.99)
    predictions, trades = record(np.zeros(count), probability=probability, actual=actual)
    _, tables = build(predictions, trades)
    y = (actual > 0).astype(int)
    yhat = (probability >= 0.5).astype(int)
    assert value(tables, "matthews_correlation_coefficient")["metric_value"] == pytest.approx(matthews_corrcoef(y, yhat), abs=1e-12)
    assert value(tables, "cohens_kappa")["metric_value"] == pytest.approx(cohen_kappa_score(y, yhat), abs=1e-12)
    assert value(tables, "average_precision")["metric_value"] == pytest.approx(average_precision_score(y, probability), abs=1e-12)
    assert value(tables, "precision_down")["metric_value"] == pytest.approx(precision_score(y, yhat, pos_label=0), abs=1e-12)
    assert value(tables, "recall_down")["metric_value"] == pytest.approx(recall_score(y, yhat, pos_label=0), abs=1e-12)
    confusion = {(row["actual_direction"], row["predicted_direction"]): row["bar_count"]
                 for row in tables["confusion_matrix"].to_pylist() if row["scope"] == "run"}
    assert confusion == {("up", "up"): int(((y == 1) & (yhat == 1)).sum()), ("up", "down"): int(((y == 1) & (yhat == 0)).sum()),
                         ("down", "up"): int(((y == 0) & (yhat == 1)).sum()), ("down", "down"): int(((y == 0) & (yhat == 0)).sum())}


def test_calibration_equals_scikit_learn_and_the_brier_decomposition_adds_up():
    from sklearn.calibration import calibration_curve

    generator = np.random.default_rng(5)
    # probabilities constant inside each bin, so the Murphy decomposition is exact
    probability = generator.choice(np.array([0.05, 0.15, 0.25, 0.45, 0.55, 0.75, 0.95]), 1200)
    actual = np.where(generator.uniform(size=1200) < probability * 0.8 + 0.1, 1, -1)
    predictions, trades = record(np.zeros(1200), probability=probability, actual=actual)
    _, tables = build(predictions, trades)
    y = (actual > 0).astype(int)
    observed, predicted = calibration_curve(y, probability, n_bins=10, strategy="uniform")
    bins = [row for row in tables["calibration_bins"].to_pylist() if row["scope"] == "run" and row["scored_bar_count"]]
    np.testing.assert_allclose([row["observed_up_fraction"] for row in bins], observed, atol=1e-12)
    np.testing.assert_allclose([row["mean_probability_up"] for row in bins], predicted, atol=1e-12)
    weights = np.array([row["scored_bar_count"] for row in bins]) / 1200
    assert value(tables, "expected_calibration_error")["metric_value"] == pytest.approx(float(np.sum(weights * np.abs(observed - predicted))), abs=1e-12)
    assert value(tables, "maximum_calibration_error")["metric_value"] == pytest.approx(float(np.max(np.abs(observed - predicted))), abs=1e-12)
    reliability = value(tables, "brier_reliability_component")["metric_value"]
    resolution = value(tables, "brier_resolution_component")["metric_value"]
    uncertainty = value(tables, "brier_uncertainty_component")["metric_value"]
    assert reliability - resolution + uncertainty == pytest.approx(value(tables, "brier_score")["metric_value"], abs=1e-12)
    assert uncertainty == pytest.approx(y.mean() * (1 - y.mean()), abs=1e-12)


def test_one_class_leaves_the_ranking_metrics_null_with_a_reason_never_zero():
    predictions, trades = record(np.zeros(50), probability=np.full(50, 0.7), actual=np.ones(50))
    _, tables = build(predictions, trades)
    for name in ("roc_auc", "average_precision", "matthews_correlation_coefficient", "precision_down", "recall_down"):
        row = value(tables, name)
        assert row["metric_value"] is None and row["note"], name


# ─── trading ────────────────────────────────────────────────────────────────


def test_drawdown_episodes_worked_by_hand():
    # equity 0, 1, -1, -2, 2, 1, 2: a 3-deep drawdown from bar 1 recovered at bar 4, a 1-deep one recovered at bar 6
    bar_net = [1.0, -2.0, -1.0, 4.0, -1.0, 1.0]
    predictions, trades = record(bar_net)
    _, tables = build(predictions, trades)
    assert value(tables, "maximum_drawdown_usd")["metric_value"] == 3.0
    assert value(tables, "drawdown_count")["metric_value"] == 2
    assert value(tables, "maximum_drawdown_duration_bars")["metric_value"] == 3
    assert value(tables, "maximum_drawdown_recovery_bars")["metric_value"] == 1
    assert value(tables, "average_drawdown_usd")["metric_value"] == pytest.approx((2 + 3 + 1) / 3)
    assert value(tables, "ulcer_index_usd")["metric_value"] == pytest.approx(math.sqrt((4 + 9 + 1) / 6))
    episodes = [row for row in tables["drawdowns"].to_pylist() if row["scope"] == "run"]
    assert [(row["depth_usd"], row["bars_to_trough"], row["bars_to_recovery"], row["recovered"], row["depth_rank"])
            for row in episodes] == [(3.0, 2, 1, True, 1), (1.0, 1, 1, True, 2)]


def test_an_unrecovered_drawdown_has_no_recovery_and_says_so():
    predictions, trades = record([2.0, -1.0, -1.0, 0.5])
    _, tables = build(predictions, trades)
    row = value(tables, "maximum_drawdown_recovery_bars")
    assert row["metric_value"] is None and "ended before" in row["note"]
    (episode,) = [row for row in tables["drawdowns"].to_pylist() if row["scope"] == "run"]
    assert episode["recovered"] is False and episode["recovery_timestamp"] is None and episode["underwater_bars"] == 3


def test_trade_statistics_streaks_and_payoff():
    nets = [5.0, 7.0, -3.0, -2.0, -4.0, 6.0, 1.0, -1.0]
    predictions, trades = record(np.zeros(20), trades=[{"net": net, "bars": 3 if net > 0 else 5} for net in nets])
    _, tables = build(predictions, trades)
    assert value(tables, "longest_winning_streak_trades")["metric_value"] == 2
    assert value(tables, "longest_losing_streak_trades")["metric_value"] == 3
    assert value(tables, "payoff_ratio")["metric_value"] == pytest.approx(np.mean([5, 7, 6, 1]) / np.mean([3, 2, 4, 1]))
    assert value(tables, "average_bars_held_winners")["metric_value"] == 3
    assert value(tables, "average_bars_held_losers")["metric_value"] == 5
    sqn = math.sqrt(len(nets)) * np.mean(nets) / np.std(nets, ddof=1)
    assert value(tables, "system_quality_number")["metric_value"] == pytest.approx(sqn)
    assert value(tables, "cost_per_contract_per_side_usd")["metric_value"] == pytest.approx(1.39)
    net = sum(nets)
    assert value(tables, "trade_net_profit_usd")["metric_value"] == pytest.approx(net)


def test_no_losing_trade_leaves_the_loss_ratios_null_with_a_reason():
    predictions, trades = record(np.zeros(10), trades=[{"net": 4.0}, {"net": 2.0}])
    _, tables = build(predictions, trades)
    for name in ("profit_factor", "payoff_ratio", "average_loss_usd", "average_bars_held_losers"):
        row = value(tables, name)
        assert row["metric_value"] is None and row["note"], name
    assert value(tables, "longest_losing_streak_trades")["metric_value"] == 0


def test_trade_segments_split_by_side_exit_reason_and_entry_confidence():
    rows = [{"net": 5.0, "side": "long", "reason": "signal", "probability": 0.58},
            {"net": -2.0, "side": "short", "reason": "stop_loss", "probability": 0.42},
            {"net": 3.0, "side": "long", "reason": "signal", "probability": 0.8}]
    predictions, trades = record(np.zeros(12), trades=rows)
    _, tables = build(predictions, trades)
    assert value(tables, "trade_count", kind="side", segment="long")["metric_value"] == 2
    assert value(tables, "trade_net_profit_usd", kind="side", segment="short")["metric_value"] == -2.0
    assert value(tables, "trade_count", kind="exit_reason", segment="stop loss")["metric_value"] == 1
    labels = report.confidence_labels()
    assert value(tables, "trade_count", kind="entry_confidence", segment=labels[1])["metric_value"] == 2   # 0.05 to 0.10
    assert value(tables, "trade_count", kind="entry_confidence", segment=labels[3])["metric_value"] == 1   # 0.20 to 0.50


def test_the_probabilistic_sharpe_ratio_and_its_standard_error_follow_the_closed_form():
    from scipy.stats import kurtosis, norm, skew

    generator = np.random.default_rng(7)
    bar_net = generator.gamma(2.0, 1.0, 500) - 1.8          # skewed, fat right tail
    predictions, trades = record(bar_net)
    _, tables = build(predictions, trades, bars_per_year=5000.0)
    per_bar = np.mean(bar_net) / np.std(bar_net, ddof=1)
    g3 = skew(bar_net, bias=False)
    g4 = kurtosis(bar_net, fisher=True, bias=False) + 3.0
    inner = 1 - g3 * per_bar + (g4 - 1) / 4 * per_bar ** 2
    assert value(tables, "probabilistic_sharpe_ratio")["metric_value"] == pytest.approx(
        norm.cdf(per_bar * math.sqrt(499) / math.sqrt(inner)), abs=1e-12)
    assert value(tables, "sharpe_ratio_standard_error")["metric_value"] == pytest.approx(
        math.sqrt(inner / 499) * math.sqrt(5000.0), abs=1e-12)
    assert value(tables, "sharpe_ratio")["metric_value"] == pytest.approx(per_bar * math.sqrt(5000.0), abs=1e-12)


def test_session_days_follow_the_cme_session_for_futures():
    before_open = MNQ_OPEN - 300                                # 14:55 Pacific: the Dec 1 session
    days = report.session_days(np.array([before_open, MNQ_OPEN, MNQ_OPEN + 8 * 3600]), "MNQ")
    assert days.tolist() == ["2025-12-01", "2025-12-02", "2025-12-02"]
    assert report.session_days(np.array([MNQ_OPEN]), "EURUSD").tolist() == ["2025-12-01"]
    predictions, trades = record([1.0, 2.0, -1.0], timestamps=np.array([before_open, MNQ_OPEN, MNQ_OPEN + 300]))
    _, tables = build(predictions, trades)
    daily = tables["daily_results"].to_pylist()
    assert [(row["session_day"], row["net_profit_usd"], row["cumulative_net_profit_usd"]) for row in daily] == [
        ("2025-12-01", 1.0, 1.0), ("2025-12-02", 1.0, 2.0)]


def test_an_unknown_symbol_dates_session_days_by_the_stored_date_and_says_so():
    predictions, trades = record([1.0, 2.0], timestamps=np.array([MNQ_OPEN - 300, MNQ_OPEN]))
    _, tables = build(predictions, trades, symbol="")
    daily = tables["daily_results"].to_pylist()
    assert [row["session_day"] for row in daily] == ["2025-12-01"]
    assert daily[0]["session_day_rule"] == "the stored calendar date (the run recorded no symbol)"
    assert "recorded no symbol" in value(tables, "session_day_count")["note"]
    _, tables = build(predictions, trades, symbol="MNQ")
    assert tables["daily_results"].to_pylist()[0]["session_day_rule"].startswith("CME Globex session")
    assert value(tables, "session_day_count")["note"] is None


def test_symmetric_probabilities_share_a_confidence_bucket():
    buckets = report._confidence_bucket(np.array([0.3, 0.7, 0.45, 0.55, 0.4, 0.6, 0.5, 1.0, 0.0]))
    labels = report.confidence_labels()
    assert buckets.tolist() == [labels[3], labels[3], labels[1], labels[1], labels[2], labels[2], labels[0], labels[3], labels[3]]


def test_the_longest_drawdown_in_days_is_the_longest_episode_in_days():
    # episode one: 4 bars 5 minutes apart; episode two: 2 bars across a weekend (2 days)
    stamps = MNQ_OPEN + np.array([0, 300, 600, 900, 1200, 1500, 1800, 1800 + 2 * 86400, 1800 + 2 * 86400 + 300])
    bar_net = [1.0, -1.0, -1.0, -1.0, 4.0, 1.0, -0.5, -0.5, 2.0]
    predictions, trades = record(bar_net, timestamps=stamps)
    _, tables = build(predictions, trades)
    assert value(tables, "maximum_drawdown_duration_bars")["metric_value"] == 4
    days = value(tables, "maximum_drawdown_duration_days")["metric_value"]
    episodes = [row for row in tables["drawdowns"].to_pylist() if row["scope"] == "run"]
    assert days == pytest.approx(max(row["underwater_days"] for row in episodes)) and days > 2.0


def test_distributions_carry_the_eight_numbers():
    predictions, trades = record(np.random.default_rng(2).normal(0, 3, 200),
                                 trades=[{"net": n} for n in (5.0, -3.0, 2.0, -1.0, 8.0)])
    _, tables = build(predictions, trades)
    row = next(row for row in tables["distributions"].to_pylist()
               if (row["scope"], row["quantity_name"], row["segment_value"]) == ("run", "trade_net_profit_usd", "all trades"))
    nets = np.array([5.0, -3.0, 2.0, -1.0, 8.0])
    assert row["count"] == 5 and row["mean"] == pytest.approx(nets.mean()) and row["median"] == 2.0
    assert row["percentile_25"] == -1.0 and row["percentile_75"] == 5.0 and row["minimum"] == -3.0 and row["maximum"] == 8.0
    assert row["skewness"] is not None and row["kurtosis"] is not None


def test_price_forecast_metrics_and_their_absence():
    predictions, trades = record(np.zeros(40), with_forecast=True)
    _, tables = build(predictions, trades)
    predicted = np.linspace(-2, 2, 40)
    error = np.linspace(-1, 1, 40) * 0.5
    assert value(tables, "price_forecast_bias_points")["metric_value"] == pytest.approx(float(np.mean(error)), abs=1e-12)
    assert value(tables, "price_forecast_median_absolute_error_points")["metric_value"] == pytest.approx(float(np.median(np.abs(error))))
    assert value(tables, "predicted_actual_move_correlation")["metric_value"] == pytest.approx(
        float(np.corrcoef(predicted, predicted - error)[0, 1]))
    predictions, trades = record(np.zeros(40))
    _, tables = build(predictions, trades)
    row = value(tables, "price_forecast_mean_absolute_error_points")
    assert row["metric_value"] is None and "no resolved price forecasts" in row["note"]


# ─── records from before 2026-09-27 ─────────────────────────────────────────


def test_an_older_record_takes_its_bar_net_from_the_equity_and_leaves_exposure_unknown():
    # before 2026-09-27: no per-bar net (only the equity, continuous across folds) and no exposure
    predictions, trades = record(np.zeros(6), old_position=[1, 1, -1, -1, 1, 0], fold=[0, 0, 0, 1, 1, 1])
    equity = [0.0, 2.0, 1.0, 4.0, 3.0, 5.0]
    predictions = predictions.drop(["bar_net_profit_usd"]).append_column("equity_usd", pa.array(equity))
    inputs, tables = build(predictions, trades)
    assert inputs.predictions["bar_net_profit_usd"].tolist() == [0.0, 2.0, -1.0, 3.0, -1.0, 2.0]
    row = value(tables, "net_profit_usd")
    assert row["metric_value"] == 5.0 and "change in the recorded equity" in row["note"]
    assert value(tables, "net_profit_usd", scope="fold", fold=1)["metric_value"] == 4.0
    for name in ("exposure_fraction", "long_exposure_fraction", "short_exposure_fraction", "flat_fraction"):
        row = value(tables, name)
        assert row["metric_value"] is None and "recorded before 2026-09-27" in row["note"], name


def test_bars_per_year_is_recovered_from_a_landed_fold_sharpe():
    bar_net = np.random.default_rng(4).normal(0.2, 1.0, 300)
    predictions, trades = record(bar_net)
    sharpe = float(np.mean(bar_net) / np.std(bar_net, ddof=1) * math.sqrt(7777.0))
    folds = pa.table({"fold_index": pa.array([0], type=pa.int64()),
                      "metrics": pa.array([f'{{"sharpe_ratio": {sharpe!r}, "majority_class_accuracy": 0.5}}'])})
    inputs, tables = build(predictions, trades, bars_per_year=None, folds=folds)
    assert inputs.bars_per_year == pytest.approx(7777.0, rel=1e-9)
    assert "recovered from fold 1" in value(tables, "annualized_net_profit_usd")["note"]
    assert value(tables, "sharpe_ratio")["metric_value"] == pytest.approx(sharpe, rel=1e-9)


def test_the_majority_class_accuracy_of_an_older_record_is_weighted_by_scored_bars():
    count = 40
    actual = np.where(np.arange(count) % 3 == 0, 1, -1)
    folds_index = np.array([0] * 10 + [1] * 30)
    predictions, trades = record(np.zeros(count), actual=actual, fold=folds_index)
    folds = pa.table({"fold_index": pa.array([0, 1], type=pa.int64()),
                      "metrics": pa.array(['{"majority_class_accuracy": 0.6}', '{"majority_class_accuracy": 0.8}'])})
    _, tables = build(predictions, trades, folds=folds)
    assert value(tables, "majority_class_accuracy")["metric_value"] == pytest.approx((0.6 * 10 + 0.8 * 30) / 40)
    folds = pa.table({"fold_index": pa.array([0, 1], type=pa.int64()), "majority_class_up": pa.array([0, 0], type=pa.int64()),
                      "metrics": pa.array(["{}", "{}"])})
    _, tables = build(predictions, trades, folds=folds)
    assert value(tables, "majority_class_accuracy")["metric_value"] == pytest.approx(float(np.mean(actual < 0)))
