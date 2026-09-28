"""The Bayesian neural hybrid (Monte Carlo dropout perceptron) behind the Model
Cycle: ``src/ml/cycle/adapters_extra/bayesian_neural_hybrid.py`` and its registry
entry ``src/config/cycle_models/bayesian_neural_hybrid.json``.

Adapter-level checks run on one synthetic causal dataset (the label and the
price target of bar t come from bar t's features plus noise; the price target
carries +-40 outliers): it builds for both tasks through ``models.build_adapter``;
it learns and reports per epoch; the prediction is the mean and the
uncertainty the standard deviation of exactly ``sample_count`` sampled
networks; dropout is really on at prediction (the spread is not zero); one row
at a time equals the batch; bars after t never change the prediction at t;
save -> ``models.load_adapter`` reproduces predictions and uncertainty to 1e-6;
the registry accepts the entry and Optuna is asked for exactly the searchable
parameters. Then one ``CycleEngine`` fold runs on REAL MNQ 5-minute bars read
from the lake (2025-06-02 .. 2025-06-10, a window with no contract roll: the
June 2025 roll is the 16th), with the direction and the price model, and the
reloaded fold model reproduces the streamed P(up).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from cycle import catalog, models  # noqa: E402
from cycle.adapter import BatchReport, EpochReport  # noqa: E402
from cycle.adapters_extra.bayesian_neural_hybrid import (  # noqa: E402
    NETWORK_KIND,
    BayesianNeuralHybridAdapter,
    MonteCarloDropoutPerceptron,
)

KEY = "bayesian_neural_hybrid"
ENTRY = catalog.entry(KEY)
FAST = {"epochs": 8, "patience": 3, "hidden_size": 16, "layer_count": 2, "sample_count": 10,
        "batch_size": 128, "learning_rate": 0.003}


def build(task: str = "classification", seed: int = 42, **overrides) -> BayesianNeuralHybridAdapter:
    return models.build_adapter(KEY, {**catalog.defaults(KEY), **FAST, **overrides}, "cpu", seed, task=task)


# ─── synthetic causal data ─────────────────────────────────────────────────


class Dataset:
    def __init__(self, row_count: int = 3000, feature_count: int = 8, seed: int = 3) -> None:
        generator = np.random.default_rng(seed)
        features = generator.standard_normal((row_count, feature_count)).astype(np.float32)
        signal = 1.0 * features[:, 0] - 0.7 * features[:, 1] + 0.4 * features[:, 2]
        labels = (signal + 0.6 * generator.standard_normal(row_count) > 0).astype(np.float32)
        target = (signal + 0.6 * generator.standard_normal(row_count)).astype(np.float32)
        outliers = generator.choice(np.arange(10, row_count), 30, replace=False)
        target[outliers] += np.where(generator.random(30) < 0.5, -40.0, 40.0).astype(np.float32)
        labels[-6:] = np.nan
        target[-6:] = np.nan
        features[:5] = np.nan               # feature warmup
        self.features, self.labels, self.target = features, labels, target
        self.timestamps = (1_700_000_000 + 300 * np.arange(row_count)).astype(np.int64)
        self.train_index = np.arange(5, 2200, dtype=np.int64)
        self.validation_index = np.arange(2210, 2650, dtype=np.int64)
        self.test_index = np.arange(2660, row_count - 6, dtype=np.int64)
        self.clean_test = np.setdiff1d(self.test_index, outliers)

    def labels_for(self, task: str) -> np.ndarray:
        return self.labels if task == "classification" else self.target


DATA = Dataset()


class Reporter:
    def __init__(self) -> None:
        self.step_unit = None
        self.batches: list[BatchReport] = []
        self.epochs: list[EpochReport] = []
        self.started: list[tuple[int, int]] = []
        self.validating_calls: list[tuple[int, int]] = []
        self.logs: list[tuple[str, str]] = []
        self.checkpoints = 0

    def epoch_started(self, epoch, epoch_count):
        self.started.append((epoch, epoch_count))

    def batch(self, report):
        assert isinstance(report, BatchReport)
        self.batches.append(report)

    def epoch_finished(self, report):
        assert isinstance(report, EpochReport)
        self.epochs.append(report)

    def validating(self, epoch, epoch_count):
        self.validating_calls.append((epoch, epoch_count))

    def checkpoint(self):
        self.checkpoints += 1

    def log(self, message, level="info"):
        assert message.isascii(), message
        self.logs.append((level, message))


def fitted(task: str = "classification", seed: int = 42, **overrides) -> tuple[BayesianNeuralHybridAdapter, Reporter]:
    adapter = build(task, seed, **overrides)
    reporter = Reporter()
    adapter.fit(DATA.features, DATA.labels_for(task), DATA.train_index, DATA.validation_index, DATA.timestamps, reporter)
    return adapter, reporter


@pytest.fixture(scope="module")
def direction() -> tuple[BayesianNeuralHybridAdapter, Reporter]:
    return fitted("classification")


@pytest.fixture(scope="module")
def price() -> tuple[BayesianNeuralHybridAdapter, Reporter]:
    return fitted("regression")


# ─── building ──────────────────────────────────────────────────────────────


def test_builds_through_the_factory_for_both_tasks():
    for task in ("classification", "regression"):
        adapter = models.build_adapter(KEY, catalog.defaults(KEY), "cpu", 42, task=task)
        assert isinstance(adapter, BayesianNeuralHybridAdapter)
        assert (adapter.key, adapter.family, adapter.task, adapter.device) == (KEY, KEY, task, "cpu")
        assert adapter.step_unit == ENTRY["stepUnit"] == "epoch"
        assert adapter.minimum_history() == 1 and adapter.available is True
        assert adapter.sample_count == catalog.defaults(KEY)["sample_count"] == 20
        assert adapter.parameters == catalog.defaults(KEY)
        assert adapter.network is None and adapter.last_uncertainty is None


def test_the_constructor_refuses_a_foreign_entry_and_a_degenerate_dropout():
    with pytest.raises(ValueError, match="registry adapter"):
        BayesianNeuralHybridAdapter(KEY, catalog.entry("catboost"), catalog.defaults(KEY), "cpu", 1)
    with pytest.raises(ValueError, match="dropout"):
        MonteCarloDropoutPerceptron(4, 8, 1, 0.0)
    with pytest.raises(ValueError, match="task"):
        BayesianNeuralHybridAdapter(KEY, ENTRY, catalog.defaults(KEY), "cpu", 1, task="ranking")


# ─── fitting and reporting ─────────────────────────────────────────────────


def test_the_direction_model_learns_and_reports_every_epoch(direction):
    adapter, reporter = direction
    assert reporter.step_unit == "epoch"
    assert 1 <= len(reporter.epochs) <= FAST["epochs"]
    assert [report.epoch for report in reporter.epochs] == list(range(1, len(reporter.epochs) + 1))
    assert reporter.validating_calls == [(report.epoch, FAST["epochs"]) for report in reporter.epochs]
    assert reporter.checkpoints >= len(reporter.batches)
    assert all(report.batch_count == math.ceil(DATA.train_index.size / FAST["batch_size"]) for report in reporter.batches)
    # every batch is one contiguous span of the training index
    for report in reporter.batches:
        assert DATA.train_index[0] <= report.span_start_index <= report.span_end_index <= DATA.train_index[-1]
    best = [report for report in reporter.epochs if report.is_best]
    assert best and adapter.best_iteration == best[-1].epoch
    assert max(report.validation_accuracy for report in reporter.epochs) > 0.75
    probability = adapter.predict_probability(DATA.features, DATA.clean_test)
    assert probability.dtype == np.float64 and np.all((probability >= 0) & (probability <= 1))
    accuracy = np.mean((probability >= 0.5) == (DATA.labels[DATA.clean_test] >= 0.5))
    assert accuracy > 0.75
    summary = adapter.fit_summary
    assert summary["best_epoch"] == adapter.best_iteration and summary["sample_count"] == FAST["sample_count"]
    assert summary["mean_validation_uncertainty"] is not None and summary["mean_validation_uncertainty"] > 0
    assert summary["best_validation_loss"] == min(report.validation_loss for report in reporter.epochs)
    assert summary["positive_class_weight"] > 0 and summary["gaussian_prior_weight_decay"] == catalog.defaults(KEY)["weight_decay"]
    assert any("sampled networks per prediction" in message for _, message in reporter.logs)


def test_the_price_model_fits_the_scaled_target_with_huber_and_reports_mean_absolute_error(price):
    adapter, reporter = price
    assert reporter.step_unit == "epoch" and adapter.task == "regression"
    assert adapter.fit_summary["loss_function"] == "huber (delta 1)"
    for report in reporter.epochs:
        assert report.validation_f1_score is None
        assert report.validation_loss is not None and report.validation_loss > 0     # mean absolute error
        assert 0 <= report.validation_accuracy <= 1                                   # sign accuracy
    value = adapter.predict_value(DATA.features, DATA.clean_test)
    truth = DATA.target[DATA.clean_test].astype(np.float64)
    r_squared = 1 - np.sum((value - truth) ** 2) / np.sum((truth - truth.mean()) ** 2)
    assert r_squared > 0.5
    assert adapter.last_uncertainty.shape == value.shape and np.all(adapter.last_uncertainty >= 0)
    with pytest.raises(TypeError, match="predict_value"):
        adapter.predict_probability(DATA.features, DATA.clean_test[:3])


def test_a_direction_model_refuses_predict_value_and_predicting_before_fit(direction):
    adapter, _ = direction
    with pytest.raises(TypeError, match="predict_probability"):
        adapter.predict_value(DATA.features, DATA.clean_test[:3])
    with pytest.raises(RuntimeError, match="before fit"):
        build().predict_probability(DATA.features, DATA.clean_test[:3])
    with pytest.raises(ValueError, match="training index is empty"):
        build().fit(DATA.features, DATA.labels, np.empty(0, np.int64), DATA.validation_index, DATA.timestamps, Reporter())


# ─── Monte Carlo dropout ───────────────────────────────────────────────────


def test_the_prediction_is_the_mean_and_the_uncertainty_the_spread_of_the_sampled_networks(direction):
    adapter, _ = direction
    rows = DATA.clean_test[:40]
    probability = adapter.predict_probability(DATA.features, rows)
    uncertainty = adapter.last_uncertainty
    masks = adapter._sampled_masks()
    assert len(masks) == FAST["sample_count"]
    with torch.no_grad():
        inputs = torch.from_numpy(np.ascontiguousarray(DATA.features[rows], dtype=np.float32))
        passes = np.stack([torch.sigmoid(adapter.network(inputs, mask_set)).double().numpy() for mask_set in masks])
    np.testing.assert_allclose(probability, passes.mean(axis=0), atol=1e-9)
    np.testing.assert_allclose(uncertainty, passes.std(axis=0, ddof=0), atol=1e-9)
    np.testing.assert_allclose(adapter.predict_uncertainty(DATA.features, rows), uncertainty, atol=1e-12)


def test_dropout_stays_on_at_prediction(direction):
    adapter, _ = direction
    rows = DATA.clean_test[:200]
    adapter.predict_probability(DATA.features, rows)
    assert float(adapter.last_uncertainty.max()) > 0.0
    # a plain (dropout-free) forward is not what the model answers with
    with torch.no_grad():
        inputs = torch.from_numpy(np.ascontiguousarray(DATA.features[rows], dtype=np.float32))
        hidden = inputs
        for layer in adapter.network.hidden:
            hidden = torch.nn.functional.gelu(layer(hidden))
        deterministic = torch.sigmoid(adapter.network.head(hidden).squeeze(-1)).double().numpy()
    assert not np.allclose(adapter.predict_probability(DATA.features, rows), deterministic, atol=1e-6)
    # an ordinary forward without masks draws fresh per-element dropout: two calls differ
    with torch.no_grad():
        first = adapter.network(inputs)
        second = adapter.network(inputs)
    assert not torch.allclose(first, second)


def test_the_same_seed_gives_the_same_model_and_another_seed_another_spread():
    first, _ = fitted("classification", seed=7)
    again, _ = fitted("classification", seed=7)
    rows = DATA.clean_test[:50]
    np.testing.assert_array_equal(first.predict_probability(DATA.features, rows), again.predict_probability(DATA.features, rows))
    other, _ = fitted("classification", seed=8)
    assert not np.allclose(first.predict_probability(DATA.features, rows), other.predict_probability(DATA.features, rows))


def test_more_samples_narrow_the_estimate_of_the_mean(direction):
    adapter, _ = direction
    rows = DATA.clean_test[:100]
    few = adapter.predict_probability(DATA.features, rows)
    many = build(sample_count=200)
    many.network, many.feature_count = adapter.network, adapter.feature_count
    reference = many.predict_probability(DATA.features, rows)
    # the ten-sample mean sits within a few standard errors of the two-hundred-sample mean
    standard_error = many.last_uncertainty / math.sqrt(FAST["sample_count"]) + 1e-9
    assert np.mean(np.abs(few - reference) / standard_error < 4.0) > 0.9


# ─── batch invariance and causality ────────────────────────────────────────


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_one_row_at_a_time_equals_the_batch(task, direction, price):
    adapter, _ = direction if task == "classification" else price
    predict = adapter.predict_probability if task == "classification" else adapter.predict_value
    rows = DATA.clean_test[:60]
    batched = predict(DATA.features, rows)
    batched_uncertainty = adapter.last_uncertainty.copy()
    single = np.array([predict(DATA.features, np.array([row]))[0] for row in rows])
    single_uncertainty = np.array([adapter.predict_uncertainty(DATA.features, np.array([row]))[0] for row in rows])
    # a one-row and a batched float32 matmul take different kernels: equal to the contract's 1e-6
    np.testing.assert_allclose(single, batched, atol=1e-6)
    np.testing.assert_allclose(single_uncertainty, batched_uncertainty, atol=1e-6)


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_bars_after_t_never_change_the_prediction_at_t(task, direction, price):
    adapter, _ = direction if task == "classification" else price
    predict = adapter.predict_probability if task == "classification" else adapter.predict_value
    generator = np.random.default_rng(11)
    for row in (2700, 2800, 2950):
        before = predict(DATA.features, np.array([row]))[0]
        spread_before = adapter.last_uncertainty[0]
        altered = DATA.features.copy()
        altered[row + 1:] = generator.standard_normal(altered[row + 1:].shape).astype(np.float32) * 5
        altered[row + 1:] = np.where(generator.random(altered[row + 1:].shape) < 0.1, np.nan, altered[row + 1:])
        assert predict(altered, np.array([row]))[0] == before
        assert adapter.last_uncertainty[0] == spread_before


# ─── save / load ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_save_and_load_reproduce_predictions_and_uncertainty(task, direction, price, tmp_path):
    adapter, _ = direction if task == "classification" else price
    folder = tmp_path / task
    path = adapter.save(str(folder))
    assert Path(path).name == "model.pt" and (folder / "model.json").is_file()
    metadata = json.loads((folder / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["task"], metadata["network"]) == (KEY, KEY, task, NETWORK_KIND)
    assert metadata["best_iteration"] == adapter.best_iteration and metadata["sample_count"] == FAST["sample_count"]
    assert metadata["mean_validation_uncertainty"] == adapter.fit_summary["mean_validation_uncertainty"]
    assert metadata["parameters"] == adapter.parameters and metadata["minimum_history"] == 1
    reloaded = models.load_adapter(str(folder))
    assert isinstance(reloaded, BayesianNeuralHybridAdapter) and reloaded.task == task
    assert reloaded.best_iteration == adapter.best_iteration and reloaded.seed == adapter.seed
    assert reloaded.parameters == adapter.parameters and reloaded.feature_count == adapter.feature_count
    rows = DATA.clean_test
    predict = "predict_probability" if task == "classification" else "predict_value"
    expected = getattr(adapter, predict)(DATA.features, rows)
    expected_uncertainty = adapter.last_uncertainty.copy()
    actual = getattr(reloaded, predict)(DATA.features, rows)
    np.testing.assert_allclose(actual, expected, atol=1e-6)
    np.testing.assert_allclose(reloaded.last_uncertainty, expected_uncertainty, atol=1e-6)
    # the direct class loader takes the metadata too
    direct = BayesianNeuralHybridAdapter.load(str(folder), device="cpu", metadata=metadata)
    np.testing.assert_allclose(getattr(direct, predict)(DATA.features, rows[:20]), expected[:20], atol=1e-6)
    assert direct.fit_summary["mean_validation_uncertainty"] == metadata["mean_validation_uncertainty"]


def test_load_refuses_another_network_kind(direction, tmp_path):
    adapter, _ = direction
    folder = tmp_path / "foreign"
    adapter.save(str(folder))
    state = torch.load(folder / "model.pt", map_location="cpu", weights_only=True)
    state["network"] = "lstm"
    torch.save(state, folder / "model.pt")
    with pytest.raises(ValueError, match="not 'monte_carlo_dropout_perceptron'"):
        BayesianNeuralHybridAdapter.load(str(folder))


# ─── registry ──────────────────────────────────────────────────────────────


class RecordingTrial:
    def __init__(self) -> None:
        self.calls: list[list] = []

    def suggest_float(self, name, low, high, log=False):
        self.calls.append(["float", name, low, high, log])
        return high if log else low

    def suggest_int(self, name, low, high, log=False):
        self.calls.append(["int", name, low, high, log])
        return high

    def suggest_categorical(self, name, choices):
        self.calls.append(["categorical", name, list(choices)])
        return choices[-1]


def test_the_registry_accepts_the_entry():
    registry = catalog.load_registry()
    assert registry["files"][KEY] == "bayesian_neural_hybrid.json"
    entry = registry["models"][KEY]
    assert entry["catalogSpecId"] == "hybrid-composite-architectures-generative-discriminative-hybrids-bayesian-neural-hybrid-model"
    assert (entry["displayName"], entry["category"], entry["subcategory"]) == (
        "Bayesian neural hybrid", "Hybrid and composite architectures", "Generative-discriminative")
    assert entry["runnable"] is True and entry["unavailableReason"] is None
    assert (entry["implementation"], entry["adapter"], entry["legacyFamily"]) == ("torch", KEY, None)
    assert entry["direction"] == {"mode": "classifier", "estimator": None, "fixed": {}, "probability": "network"}
    assert entry["price"] == {"estimator": None, "fixed": {}}
    assert (entry["preprocess"], entry["progress"], entry["stepUnit"]) == ([], "per_epoch", "epoch")
    assert (entry["explainKind"], entry["sequence"], entry["network"]) == ("opaque", False, None)
    assert "Monte Carlo dropout" in entry["implementationNote"] and "rather than variational inference" in entry["implementationNote"]
    assert models.ADAPTER_CLASSES[KEY] == "cycle.adapters_extra.bayesian_neural_hybrid:BayesianNeuralHybridAdapter"
    assert KEY in catalog.runnable_keys() and catalog.uses_torch(KEY) and catalog.has_price_model(KEY)
    for name, spec in entry["parameters"].items():
        assert "_" in name or name.isalpha()
        assert spec["description"] and spec["description"].isascii()


def test_optuna_is_asked_for_exactly_the_searchable_parameters():
    searchable = catalog.searchable_parameters(KEY)
    assert searchable == ("hidden_size", "layer_count", "dropout", "sample_count", "learning_rate", "weight_decay")
    for never in ("sequence_length", "epochs", "patience", "batch_size"):
        assert never not in searchable
    trial = RecordingTrial()
    suggested = catalog.suggest_parameters(trial, KEY, catalog.defaults(KEY))
    assert [call[1] for call in trial.calls] == list(searchable)
    assert trial.calls == [
        ["categorical", "hidden_size", [32, 64, 128]],
        ["int", "layer_count", 1, 3, False],
        ["float", "dropout", 0.1, 0.5, False],
        ["categorical", "sample_count", [10, 20, 50]],
        ["float", "learning_rate", 0.0001, 0.003, True],
        ["float", "weight_decay", 1e-05, 0.1, True],
    ]
    assert suggested == {**catalog.defaults(KEY), "hidden_size": 128, "layer_count": 3, "dropout": 0.1,
                         "sample_count": 50, "learning_rate": 0.003, "weight_decay": 0.1}
    assert models.build_adapter(KEY, suggested, "cpu", 1).sample_count == 50


# ─── one engine fold on real MNQ 5-minute bars from the lake ───────────────

REAL_WINDOW = {"start": "2025-06-02", "end": "2025-06-10"}   # no contract roll inside (the June 2025 roll is the 16th)


@pytest.fixture(scope="module")
def real_market():
    from cycle.engine import clean_market_data
    from cycle.features import build_features
    from shared import protocol

    try:
        from shared.data import load_ohlcv_arrays

        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(protocol, "emit", lambda event: None)
            raw = load_ohlcv_arrays("MNQ", "5m", date_range=dict(REAL_WINDOW))
    except Exception as error:  # noqa: BLE001 - the lake is a live service
        pytest.skip(f"the lake did not serve MNQ 5m bars: {type(error).__name__}: {error}")
    data, _ = clean_market_data(raw)
    assert 1_000 <= len(data) <= 3_000, len(data)
    return data, build_features(data.as_dict())


def test_an_engine_fold_runs_on_real_mnq_bars(real_market, tmp_path, monkeypatch):
    import pyarrow.parquet as pq

    from cycle.engine import CycleEngine, CycleSettings
    from cycle.simulate import load_cost_model
    from shared import protocol

    data, features = real_market
    events: list[dict] = []
    monkeypatch.setattr(protocol, "emit", lambda event: events.append(json.loads(protocol.dumps_safe(event))))
    parameters = {**catalog.defaults(KEY), "epochs": 3, "patience": 3, "hidden_size": 32, "layer_count": 2,
                  "sample_count": 10, "batch_size": 128}
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id=f"cycle_extra_{KEY}", model_family=KEY,
        model_parameters=parameters, artifact_directory=str(tmp_path),
        train_days=5, validation_fraction=0.2, test_days=1, step_days=0, fold_limit=1, expanding_window=False,
        label_horizon_bars=4, label_threshold_ticks=1.0, embargo_bars=2,
        long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1,
        tuning_trials=0, tuning_mode="reviewed_defaults", bars_per_second=0.0, start_paused=False, quiet_bars=True,
        log_every_batches=1000, device="cpu", seed=42, land_in_lake=False,
    )
    factory = lambda values, task="classification": models.build_adapter(KEY, values, "cpu", 42, task=task)  # noqa: E731
    engine = CycleEngine(settings, data, features, load_cost_model("MNQ"), factory)
    engine.run()

    assert events[-1]["type"] == "done", [e for e in events if e["type"] in ("error", "log")][-5:]
    assert not [e for e in events if e["type"] == "error"]
    (plan,) = [e for e in events if e["type"] == "cycle_plan"]
    assert plan["explainKind"] == "opaque" and plan["hasPriceModel"] is True and plan["directionMode"] == "classifier"
    assert {e.get("modelRole") for e in events if e["type"] == "cycle_epoch"} == {"direction", "price"}
    assert engine.fold_count == 1
    processed = [(t, p) for e in events if e["type"] == "cycle_bars" and e["role"] == "processed"
                 for t, p in zip(e["timestamps"], e["probabilityUp"])]
    assert len(processed) >= 100
    assert all(p is None or 0.0 <= p <= 1.0 for _, p in processed)
    assert sum(p is not None for _, p in processed) >= 100
    (final,) = [e for e in events if e["type"] == "cycle_scoreboard" and e["scope"] == "final"]
    assert final["metrics"]["accuracy"] is not None and 0.0 <= final["metrics"]["accuracy"] <= 1.0

    predictions_path = tmp_path / "predictions.parquet"
    assert predictions_path.is_file()
    predictions = pq.read_table(predictions_path).to_pydict()
    assert len(predictions["timestamp"]) == len(processed)

    fold = tmp_path / "fold_0"
    metadata = json.loads((fold / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["network"]) == (KEY, KEY, NETWORK_KIND)
    assert metadata["mean_validation_uncertainty"] is not None and metadata["mean_validation_uncertainty"] > 0
    direction = models.load_adapter(str(fold))
    price = models.load_adapter(str(fold / "price_model"))
    assert isinstance(direction, BayesianNeuralHybridAdapter) and isinstance(price, BayesianNeuralHybridAdapter)
    assert (direction.task, price.task) == ("classification", "regression")
    # the reloaded fold model reproduces what the walk streamed for its test bars
    rows = {int(stamp): index for index, stamp in enumerate(data.timestamps)}
    checked = 0
    for stamp, probability in zip(predictions["timestamp"], predictions["probability_up"]):
        if probability is None:
            continue
        row = rows[int(stamp.timestamp()) if hasattr(stamp, "timestamp") else int(stamp)]
        reloaded = direction.predict_probability(features.matrix, np.array([row]))[0]
        assert abs(reloaded - probability) <= 1e-6
        checked += 1
        if checked == 25:
            break
    assert checked == 25
