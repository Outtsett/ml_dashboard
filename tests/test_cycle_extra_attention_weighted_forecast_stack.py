"""Attention-weighted forecast stack (src/ml/cycle/adapters_extra/attention_weighted_forecast_stack.py).

Built through the registry as the direction classifier and the price model;
fitted on a synthetic causal dataset (attention weights sum to one, one row
equals the batch, bars after t never move the prediction at t, the reporter
sees one epoch per combiner epoch, the mean attention weights are in
``fit_summary``); a save -> ``models.load_adapter`` round trip reproduces the
predictions; the registry entry loads and its search space is exactly the
parameters that carry one; and one ``CycleEngine`` fold runs on real MNQ 5m
bars read from the lake (skipped when the lake is not reachable).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

import numpy as np
import pytest

from cycle import catalog, models
from cycle.adapter import BatchReport, EpochReport

KEY = "attention_weighted_forecast_stack"
ENTRY = catalog.entry(KEY)
FAST = {"neighbor_count": 20, "boosting_rounds": 30, "combiner_epochs": 6, "perceptron_hidden_size": 16,
        "combiner_learning_rate": 0.05}


# ─── synthetic causal data ─────────────────────────────────────────────────


class Dataset:
    def __init__(self, row_count: int = 2000, feature_count: int = 6, seed: int = 11) -> None:
        generator = np.random.default_rng(seed)
        features = generator.standard_normal((row_count, feature_count)).astype(np.float32)
        signal = 1.0 * features[:, 0] - 0.7 * features[:, 1] + 0.4 * features[:, 2] * features[:, 3]
        labels = (signal + 0.6 * generator.standard_normal(row_count) > 0).astype(np.float32)
        target = (signal + 0.6 * generator.standard_normal(row_count)).astype(np.float32)
        outliers = generator.choice(np.arange(10, row_count), 20, replace=False)
        target[outliers] += np.where(generator.random(20) < 0.5, -40.0, 40.0).astype(np.float32)
        labels[-6:] = np.nan
        target[-6:] = np.nan
        features[:5] = np.nan
        self.features, self.labels, self.target = features, labels, target
        self.timestamps = (1_700_000_000 + 300 * np.arange(row_count)).astype(np.int64)
        self.train_index = np.arange(5, 1400, dtype=np.int64)
        self.validation_index = np.arange(1410, 1750, dtype=np.int64)
        self.test_index = np.arange(1760, row_count - 6, dtype=np.int64)

    def labels_for(self, task: str) -> np.ndarray:
        return self.labels if task == "classification" else self.target


DATA = Dataset()


class FakeReporter:
    def __init__(self) -> None:
        self.step_unit = ""
        self.epochs: list[EpochReport] = []
        self.batches: list[BatchReport] = []
        self.logs: list[tuple[str, str]] = []
        self.checkpoints = 0

    def epoch_started(self, epoch, epoch_count) -> None:
        pass

    def batch(self, report) -> None:
        self.batches.append(report)

    def epoch_finished(self, report) -> None:
        self.epochs.append(report)

    def validating(self, epoch, epoch_count) -> None:
        pass

    def checkpoint(self) -> None:
        self.checkpoints += 1

    def log(self, message, level="info") -> None:
        assert message.isascii(), message
        self.logs.append((level, message))


def build(task: str, **overrides):
    return models.build_adapter(KEY, {**catalog.defaults(KEY), **FAST, **overrides}, "cpu", 42, task=task)


def fitted(task: str):
    adapter = build(task)
    reporter = FakeReporter()
    adapter.fit(DATA.features, DATA.labels_for(task), DATA.train_index, DATA.validation_index, DATA.timestamps, reporter)
    return adapter, reporter


def predict(adapter, features, index):
    return adapter.predict_probability(features, index) if adapter.task == "classification" \
        else adapter.predict_value(features, index)


@pytest.fixture(scope="module", params=["classification", "regression"])
def task(request):
    return request.param


@pytest.fixture(scope="module")
def stack(task):
    return fitted(task)


# ─── (1) built through the registry ────────────────────────────────────────


def test_build_adapter_gives_the_stack_for_both_tasks():
    from cycle.adapters_extra.attention_weighted_forecast_stack import (
        AttentionWeightedForecastStackAdapter,
    )

    for task in ("classification", "regression"):
        adapter = models.build_adapter(KEY, catalog.defaults(KEY), "cpu", 42, task=task)
        assert isinstance(adapter, AttentionWeightedForecastStackAdapter)
        assert adapter.task == task and adapter.key == KEY and adapter.step_unit == "epoch"
        assert adapter.minimum_history() == 1
        assert adapter.parameters == catalog.defaults(KEY)
    with pytest.raises(TypeError):
        models.build_adapter(KEY, catalog.defaults(KEY), "cpu", 42, task="classification").predict_value(
            DATA.features, DATA.test_index[:1])


def test_it_learns_and_reports_one_epoch_per_combiner_epoch(stack, task):
    adapter, reporter = stack
    assert reporter.step_unit == "epoch"
    assert len(reporter.epochs) == FAST["combiner_epochs"] and len(reporter.batches) == FAST["combiner_epochs"]
    assert reporter.checkpoints >= FAST["combiner_epochs"] + 1
    assert all(report.validation_loss is not None and math.isfinite(report.validation_loss) for report in reporter.epochs)
    assert any(report.is_best for report in reporter.epochs)
    assert adapter.best_iteration in range(1, FAST["combiner_epochs"] + 1)
    prediction = predict(adapter, DATA.features, DATA.test_index)
    truth = DATA.labels_for(task)[DATA.test_index]
    if task == "classification":
        assert np.all((prediction >= 0.0) & (prediction <= 1.0))
        assert np.mean((prediction >= 0.5) == (truth >= 0.5)) > 0.75
    else:
        clean = np.abs(truth) < 10
        assert np.mean(np.sign(prediction[clean]) == np.sign(truth[clean])) > 0.75
    summary = adapter.fit_summary
    # the combiner is fitted on the earlier validation rows and scored on the held-out later ones
    assert summary["combiner_fitted_on"] == "validation_rows_first_part"
    assert summary["validation_metrics_on"] == "held_out_validation_rows"
    assert summary["combiner_fit_row_count"] + summary["combiner_held_out_row_count"] <= DATA.validation_index.size
    assert summary["combiner_held_out_row_count"] >= 10
    weights = summary["mean_attention_weight"]
    assert set(weights) == {"linear_model", "nearest_neighbors", "gradient_boosting", "multilayer_perceptron"}
    assert math.isclose(sum(weights.values()), 1.0, abs_tol=1e-9)
    assert all(0.0 <= value <= 1.0 for value in weights.values())
    assert any("leans on" in message for _, message in reporter.logs)
    assert sum("alone on the held-out validation rows" in message for _, message in reporter.logs) == 4


def test_attention_weights_sum_to_one_per_row(stack):
    adapter, _ = stack
    alpha = adapter.attention_weights(DATA.features, DATA.test_index)
    assert alpha.shape == (DATA.test_index.size, 4)
    assert np.allclose(alpha.sum(axis=1), 1.0)
    assert np.all(alpha >= 0.0)


def test_one_row_at_a_time_equals_the_batch(stack):
    adapter, _ = stack
    rows = DATA.test_index[:40]
    batch = predict(adapter, DATA.features, rows)
    single = np.array([predict(adapter, DATA.features, np.array([row]))[0] for row in rows])
    # the linear model's and the perceptron's matrix products round differently for one row
    # than for forty (BLAS blocking): measured 1.3e-15 at most, so 1e-12 is the bound
    assert np.max(np.abs(batch - single)) <= 1e-12


def test_bars_after_t_never_change_the_prediction_at_t(stack):
    adapter, _ = stack
    rows = DATA.test_index[:30]
    before = predict(adapter, DATA.features, rows)
    perturbed = DATA.features.copy()
    perturbed[int(rows[-1]) + 1:] = np.random.default_rng(3).standard_normal(perturbed[int(rows[-1]) + 1:].shape)
    perturbed[int(rows[-1]) + 1:] += 7.0
    after = predict(adapter, perturbed, rows)
    assert np.array_equal(before, after)


def test_the_scaler_and_the_base_models_saw_the_training_rows_only(stack):
    adapter, _ = stack
    expected = np.asarray(DATA.features[DATA.train_index], dtype=np.float64).mean(axis=0)
    assert np.allclose(adapter.scaler.mean_, expected)
    assert adapter.base_models["nearest_neighbors"].n_samples_fit_ == DATA.train_index.size


def test_the_combiner_is_fitted_and_scored_on_separate_purged_rows():
    """The split: the first two thirds fit, then a purge as long as the train-to-validation gap, then the
    held-out rows; a label of a fitted row never resolves inside the held-out rows."""
    from cycle.adapters_extra.attention_weighted_forecast_stack import split_combiner_rows

    train = np.arange(0, 1000, dtype=np.int64)
    validation = np.arange(1006, 1306, dtype=np.int64)             # the engine purged 6 rows
    fit, held_out, purge = split_combiner_rows(train, validation)
    assert purge == 6 and fit.size == 200
    assert validation[held_out[0]] - validation[fit[-1]] == purge + 1
    assert set(fit.tolist()).isdisjoint(held_out.tolist()) and held_out[-1] == validation.size - 1
    # too few rows to hold any out: every row is both, and the caller says so
    fit, held_out, _ = split_combiner_rows(train, validation[:12])
    assert np.array_equal(fit, held_out) and fit.size == 12


def test_the_combiner_weights_depend_on_its_fit_rows_only():
    """With one combiner epoch the kept weights are that step's: scrambling the held-out rows' labels
    leaves them identical, scrambling the fit rows' labels changes them."""
    from cycle.adapters_extra.attention_weighted_forecast_stack import split_combiner_rows

    fit, held_out, _ = split_combiner_rows(DATA.train_index, DATA.validation_index)

    def weights(labels):
        adapter = build("classification")
        adapter.parameters["combiner_epochs"] = 1
        adapter.fit(DATA.features, labels, DATA.train_index, DATA.validation_index, DATA.timestamps, FakeReporter())
        return adapter.combiner_weight

    def scrambled(positions):
        labels = DATA.labels.copy()
        rows = DATA.validation_index[positions]
        labels[rows] = 1.0 - labels[rows]
        return labels

    reference = weights(DATA.labels)
    assert np.array_equal(weights(scrambled(held_out)), reference)
    assert not np.array_equal(weights(scrambled(fit)), reference)


def test_the_combiner_needs_validation_rows():
    adapter = build("classification")
    with pytest.raises(ValueError, match="validation rows are empty"):
        adapter.fit(DATA.features, DATA.labels, DATA.train_index, np.empty(0, dtype=np.int64), DATA.timestamps,
                    FakeReporter())


# ─── (3) save / load round trip ────────────────────────────────────────────


def test_save_and_load_reproduce_the_predictions(stack, task, tmp_path):
    adapter, _ = stack
    folder = tmp_path / task
    path = adapter.save(str(folder))
    assert path.endswith("base_models.joblib") and (folder / "combiner.npz").exists()
    metadata = json.loads((folder / "model.json").read_text(encoding="utf-8"))
    assert metadata["adapter"] == KEY and metadata["key"] == KEY and metadata["task"] == task
    assert metadata["mean_attention_weight"] == adapter.fit_summary["mean_attention_weight"]
    reloaded = models.load_adapter(str(folder))
    assert type(reloaded) is type(adapter) and reloaded.task == task
    original = predict(adapter, DATA.features, DATA.test_index)
    again = predict(reloaded, DATA.features, DATA.test_index)
    assert np.max(np.abs(original - again)) <= 1e-6
    assert np.allclose(reloaded.attention_weights(DATA.features, DATA.test_index[:5]),
                       adapter.attention_weights(DATA.features, DATA.test_index[:5]))
    if task == "regression":
        assert reloaded.target_clip == adapter.target_clip


# ─── (4) the registry entry ────────────────────────────────────────────────


class _RecordingTrial:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def suggest_float(self, name, low, high, log=False):
        self.calls.append(("float", name, low, high, log))
        return low

    def suggest_int(self, name, low, high, log=False):
        self.calls.append(("int", name, low, high, log))
        return low

    def suggest_categorical(self, name, choices):
        self.calls.append(("categorical", name, tuple(choices)))
        return choices[0]


def test_the_registry_accepts_the_entry_and_searches_exactly_the_parameters_with_a_search_block():
    registry = catalog.load_registry()
    entry = registry["models"][KEY]
    assert registry["files"][KEY] == "attention_weighted_forecast_stack.json"
    assert entry["runnable"] and entry["adapter"] == KEY and entry["explainKind"] == "opaque"
    assert entry["sequence"] is False and entry["network"] is None and entry["price"] is not None
    assert entry["catalogSpecId"] == "hybrid-composite-architectures-multi-modal-temporal-fusion-attention-weighted-forecast-stack"
    searched = {name for name, spec in entry["parameters"].items() if spec.get("search")}
    assert searched == {"neighbor_count", "boosting_rounds", "combiner_learning_rate", "attention_temperature",
                        "perceptron_hidden_size"}
    assert "combiner_epochs" not in searched
    trial = _RecordingTrial()
    suggested = catalog.suggest_parameters(trial, KEY, {})
    assert {call[1] for call in trial.calls} == searched
    assert ("int", "neighbor_count", 5, 200, True) in trial.calls
    assert ("categorical", "boosting_rounds", (50, 100, 200)) in trial.calls
    assert suggested["combiner_epochs"] == 50 and suggested["neighbor_count"] == 5 and suggested["boosting_rounds"] == 50
    for name in entry["parameters"]:
        assert "_" in name or name.isalpha()
        assert all(len(word) > 2 for word in name.split("_")), name


# ─── (2) one engine fold on real MNQ 5m bars from the lake ─────────────────


@dataclass
class Market:
    data: object
    features: object


@pytest.fixture(scope="module")
def real_market() -> Market:
    """Two weeks of MNQ 5m bars from the lake (about 2,700 bars), features built
    the way main.py builds them. Skipped when the lake cannot be read."""
    from cycle.engine import clean_market_data
    from cycle.features import build_features

    try:
        from shared.data import load_ohlcv_arrays

        raw = load_ohlcv_arrays("MNQ", "5m", max_bars=0, date_range={"start": "2025-06-02", "end": "2025-06-14"})
    except Exception as error:  # noqa: BLE001 - the lake is an external service to this test
        pytest.skip(f"the lake is not reachable: {type(error).__name__}: {error}")
    data, _ = clean_market_data(raw)
    if len(data) < 500:
        pytest.skip(f"only {len(data)} MNQ 5m bars in the lake for the window")
    return Market(data, build_features(data.as_dict()))


def test_an_engine_fold_runs_on_real_bars(real_market, tmp_path, monkeypatch):
    import pyarrow.parquet as pq

    from cycle.engine import CycleEngine, CycleSettings
    from cycle.simulate import load_cost_model
    from shared import protocol

    events: list[dict] = []
    monkeypatch.setattr(protocol, "emit", lambda event: events.append(json.loads(protocol.dumps_safe(event))))
    parameters = catalog.resolve_parameters(KEY, FAST)
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id=f"extra_{KEY}", model_family=KEY,
        model_parameters=parameters, artifact_directory=str(tmp_path),
        train_days=6, validation_fraction=0.2, test_days=1, fold_limit=1, label_horizon_bars=4,
        label_threshold_ticks=1.0, embargo_bars=2, contracts=1, tuning_trials=0, tuning_mode="reviewed_defaults",
        bars_per_second=0.0, quiet_bars=True, log_every_batches=1000, device="cpu", seed=42, land_in_lake=False,
    )
    engine = CycleEngine(
        settings, real_market.data, real_market.features, load_cost_model("MNQ"),
        lambda values, task="classification": models.build_adapter(KEY, values, "cpu", 42, task=task),
    )
    engine.run()
    kinds = [event["type"] for event in events]
    errors = [event for event in events if event["type"] == "error"]
    assert not errors, errors
    assert kinds[-1] == "done"
    (plan,) = [event for event in events if event["type"] == "cycle_plan"]
    assert plan["explainKind"] == "opaque" and plan["directionMode"] == "classifier" and plan["hasPriceModel"] is True
    roles = {event.get("modelRole") for event in events if event["type"] == "cycle_epoch"}
    assert roles == {"direction", "price"}
    processed = [event for event in events if event["type"] == "cycle_bars" and event["role"] == "processed"]
    assert processed
    streamed = [value for event in processed for value in event["probabilityUp"]]
    assert streamed and all(value is None or 0.0 <= value <= 1.0 for value in streamed)
    (final,) = [event for event in events if event["type"] == "cycle_scoreboard" and event["scope"] == "final"]
    metrics = final["metrics"]
    log_loss = metrics.get("log_loss", metrics.get("logLoss"))
    assert metrics["accuracy"] is not None and log_loss is not None
    predictions = pq.read_table(tmp_path / "predictions.parquet").to_pydict()
    assert len(predictions["timestamp"]) == engine.folds[0].test_index.size
    assert all(value is None or 0.0 <= value <= 1.0 for value in predictions["probability_up"])
    # the reloaded fold models reproduce the walk's predictions and the price model is the stack too
    fold = tmp_path / "fold_0"
    direction = models.load_adapter(str(fold))
    price = models.load_adapter(str(fold / "price_model"))
    assert (direction.task, price.task) == ("classification", "regression")
    metadata = json.loads((fold / "model.json").read_text(encoding="utf-8"))
    assert metadata["adapter"] == KEY and set(metadata["mean_attention_weight"]) == set(direction.base_models)
    rows = {int(stamp): index for index, stamp in enumerate(real_market.data.timestamps)}
    checked = 0
    for stamp, probability in zip(predictions["timestamp"], predictions["probability_up"]):
        if probability is None:
            continue
        row = rows[int(stamp.timestamp()) if hasattr(stamp, "timestamp") else int(stamp)]
        reloaded = direction.predict_probability(real_market.features.matrix, np.array([row]))[0]
        assert abs(reloaded - probability) <= 1e-6
        checked += 1
        if checked == 25:
            break
    assert checked == 25
    print(f"SMOKE rows fitted {engine.folds[0].train_index.size} train + {engine.folds[0].validation_index.size} validation, "
          f"bars processed {len(predictions['timestamp'])}, "
          f"seconds {events[-1]['diagnostics'].get('elapsedSeconds', 'n/a')}, "
          f"accuracy {metrics['accuracy']:.4f}, log loss {log_loss:.4f}, "
          f"attention {metadata['mean_attention_weight']}")
