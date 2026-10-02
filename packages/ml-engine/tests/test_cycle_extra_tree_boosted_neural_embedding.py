"""Model Cycle adapter ``tree_boosted_neural_embedding``
(packages/ml-engine/src/cycle/adapters_extra/tree_boosted_neural_embedding.py, registry entry
packages/config/cycle_models/tree_boosted_neural_embedding.json).

Checked: the registry accepts the entry and Optuna is asked for exactly the
parameters that carry a search block (never epochs, patience or batch_size);
``models.build_adapter`` builds the direction and the price model; on a
synthetic causal dataset both learn, report through the reporter with the
registry's step unit, predict one row at a time within 1e-6 of the batch,
never let a later bar move an earlier prediction, and round-trip through
``save`` -> ``models.load_adapter`` to 1e-6; the trees are frozen at
``tree_count`` and the standardisation is the training rows' own; then a real
``CycleEngine`` run on MNQ 5-minute bars read from the lake (one fold, a few
hundred test bars, ``land_in_lake=False``) completes with every streamed
P(up) in [0, 1], writes predictions.parquet, and the reloaded fold models
reproduce what the walk streamed.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("lightgbm")

from cycle import catalog, models  # noqa: E402
from cycle.adapter import BatchReport, EpochReport  # noqa: E402
from cycle.adapters_extra.tree_boosted_neural_embedding import (  # noqa: E402
    HEAD_FILE,
    TREE_FILE,
    TreeBoostedNeuralEmbeddingAdapter,
)

KEY = "tree_boosted_neural_embedding"
ENTRY = catalog.entry(KEY)
NEVER_SEARCHED = ("sequence_length", "epochs", "patience", "batch_size")
FAST = {"tree_count": 50, "max_depth": 4, "epochs": 6, "patience": 3, "batch_size": 256, "learning_rate": 0.003}


# ─── registry ──────────────────────────────────────────────────────────────


class RecordingTrial:
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


def test_the_registry_accepts_the_entry():
    registry = catalog.load_registry()
    assert KEY in registry["models"]
    assert registry["files"][KEY] == f"{KEY}.json"
    entry = registry["models"][KEY]
    assert entry["adapter"] == KEY and entry["implementation"] == "torch" and entry["runnable"] is True
    assert entry["explainKind"] == "opaque" and entry["sequence"] is False and entry["network"] is None
    assert entry["price"] is not None and entry["direction"]["mode"] == "classifier"
    assert entry["catalogSpecId"] == "hybrid-composite-architectures-composite-controllers-planners-tree-boosted-neural-embedding"
    assert entry["stepUnit"] == "epoch" and entry["progress"] == "per_epoch"
    assert models.ADAPTER_CLASSES[KEY].endswith(":TreeBoostedNeuralEmbeddingAdapter")
    assert models.adapter_class(KEY) is TreeBoostedNeuralEmbeddingAdapter


def test_optuna_is_asked_for_exactly_the_searchable_parameters():
    searchable = catalog.searchable_parameters(KEY)
    assert set(searchable) == {"tree_count", "max_depth", "tree_learning_rate", "embedding_size", "hidden_size",
                               "dropout", "learning_rate", "weight_decay"}
    assert not set(searchable) & set(NEVER_SEARCHED)
    trial = RecordingTrial()
    suggested = catalog.suggest_parameters(trial, KEY, catalog.defaults(KEY))
    assert tuple(call[1] for call in trial.calls) == searchable
    assert set(suggested) == set(catalog.defaults(KEY))
    for name in NEVER_SEARCHED:
        if name in suggested:
            assert suggested[name] == catalog.defaults(KEY)[name]
    # the same names through the model-level entry point
    trial = RecordingTrial()
    models.suggest_parameters(trial, KEY, {})
    assert tuple(call[1] for call in trial.calls) == searchable


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_build_adapter_builds_both_roles(task):
    adapter = models.build_adapter(KEY, catalog.defaults(KEY), "cpu", 42, task=task)
    assert isinstance(adapter, TreeBoostedNeuralEmbeddingAdapter)
    assert adapter.task == task and adapter.key == KEY and adapter.step_unit == "epoch"
    assert adapter.minimum_history() == 1 and adapter.device == "cpu"
    assert adapter.parameters == catalog.defaults(KEY)
    assert adapter.leaves_per_tree == 2 ** catalog.defaults(KEY)["max_depth"]


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
        features[:5] = np.nan
        self.features, self.labels, self.target = features, labels, target
        self.timestamps = (1_700_000_000 + 300 * np.arange(row_count)).astype(np.int64)
        self.train_index = np.arange(5, 2200, dtype=np.int64)
        self.validation_index = np.arange(2210, 2650, dtype=np.int64)
        self.test_index = np.arange(2660, row_count - 6, dtype=np.int64)

    def labels_for(self, task: str) -> np.ndarray:
        return self.labels if task == "classification" else self.target


DATA = Dataset()


class Reporter:
    def __init__(self) -> None:
        self.step_unit = None
        self.batches: list[BatchReport] = []
        self.epochs: list[EpochReport] = []
        self.validating_calls = 0
        self.checkpoints = 0
        self.logs: list[str] = []

    def epoch_started(self, epoch, epoch_count):
        pass

    def batch(self, report):
        assert isinstance(report, BatchReport)
        self.batches.append(report)

    def epoch_finished(self, report):
        assert isinstance(report, EpochReport)
        self.epochs.append(report)

    def validating(self, epoch, epoch_count):
        self.validating_calls += 1

    def checkpoint(self):
        self.checkpoints += 1

    def log(self, message, level="info"):
        assert message.isascii(), message
        self.logs.append(message)


def predictor(adapter):
    return adapter.predict_probability if adapter.task == "classification" else adapter.predict_value


@pytest.fixture(scope="module", params=["classification", "regression"])
def fitted(request):
    task = request.param
    adapter = models.build_adapter(KEY, FAST, "cpu", 42, task=task)
    reporter = Reporter()
    adapter.fit(DATA.features, DATA.labels_for(task), DATA.train_index, DATA.validation_index, DATA.timestamps, reporter)
    return adapter, reporter


def test_it_learns_and_reports_through_the_reporter(fitted):
    adapter, reporter = fitted
    assert reporter.step_unit == "epoch"
    assert reporter.checkpoints > 0 and reporter.validating_calls == len(reporter.epochs)
    assert 1 <= len(reporter.epochs) <= FAST["epochs"]
    assert all(report.epoch_count == FAST["epochs"] for report in reporter.epochs)
    assert any(report.is_best for report in reporter.epochs)
    assert reporter.batches and all(
        DATA.train_index[0] <= report.span_start_index <= report.span_end_index <= DATA.train_index[-1]
        for report in reporter.batches
    )
    last = reporter.epochs[-1]
    assert last.validation_loss is not None and last.validation_accuracy is not None
    prediction = predictor(adapter)(DATA.features, DATA.test_index)
    truth = DATA.labels_for(adapter.task)[DATA.test_index]
    if adapter.task == "classification":
        assert np.all((prediction >= 0.0) & (prediction <= 1.0))
        accuracy = float(np.mean((prediction >= 0.5) == (truth >= 0.5)))
        assert last.validation_f1_score is not None
    else:
        assert last.validation_f1_score is None
        accuracy = float(np.mean(np.sign(prediction) == np.sign(truth)))
        assert adapter.target_clip is not None and adapter.target_clip[0] < 0 < adapter.target_clip[1]
    assert accuracy > 0.75, accuracy
    assert adapter.best_iteration == max(report.epoch for report in reporter.epochs if report.is_best)
    assert adapter.fit_summary["best_epoch"] == adapter.best_iteration
    assert adapter.fit_summary["train_row_count"] == DATA.train_index.size


def test_the_trees_are_frozen_at_tree_count_and_the_scaler_is_the_training_rows_own(fitted):
    adapter, _ = fitted
    assert adapter.booster.num_trees() == FAST["tree_count"] == adapter.tree_count_fitted
    assert adapter.fit_summary["tree_count_fitted"] == FAST["tree_count"]
    train_rows = DATA.features[DATA.train_index].astype(np.float64)
    np.testing.assert_allclose(adapter.feature_mean, train_rows.mean(axis=0), atol=1e-5)
    np.testing.assert_allclose(adapter.feature_scale, train_rows.std(axis=0), atol=1e-5)
    embedding = adapter.bucket_embedding(DATA.features, DATA.test_index[:7])
    assert embedding.shape == (7, FAST.get("embedding_size", catalog.defaults(KEY)["embedding_size"]))
    assert np.all(np.isfinite(embedding))


def test_one_row_at_a_time_equals_the_batch(fitted):
    adapter, _ = fitted
    predict = predictor(adapter)
    rows = DATA.test_index[:40]
    batch = predict(DATA.features, rows)
    single = np.array([predict(DATA.features, np.array([row]))[0] for row in rows])
    assert np.max(np.abs(batch - single)) <= 1e-6


def test_a_later_bar_never_moves_an_earlier_prediction(fitted):
    adapter, _ = fitted
    predict = predictor(adapter)
    rows = DATA.test_index[:25]
    before = predict(DATA.features, rows)
    perturbed = DATA.features.copy()
    generator = np.random.default_rng(11)
    for row in rows:
        perturbed[row + 1:] = generator.standard_normal(perturbed[row + 1:].shape).astype(np.float32) * 5.0
        assert abs(float(predict(perturbed, np.array([row]))[0]) - before[list(rows).index(row)]) <= 1e-6
        perturbed[row + 1:] = DATA.features[row + 1:]


def test_save_and_load_reproduce_the_predictions(fitted, tmp_path):
    adapter, _ = fitted
    folder = tmp_path / adapter.task
    path = adapter.save(str(folder))
    assert Path(path).name == TREE_FILE and (folder / HEAD_FILE).exists()
    metadata = json.loads((folder / "model.json").read_text(encoding="utf-8"))
    assert metadata["adapter"] == KEY and metadata["key"] == KEY and metadata["task"] == adapter.task
    assert metadata["model_file"] == TREE_FILE and metadata["head_file"] == HEAD_FILE
    assert metadata["best_iteration"] == adapter.best_iteration
    assert metadata["libraries"]["lightgbm"] and metadata["libraries"]["torch"]
    reloaded = models.load_adapter(str(folder))
    assert isinstance(reloaded, TreeBoostedNeuralEmbeddingAdapter)
    assert reloaded.task == adapter.task and reloaded.parameters == adapter.parameters
    assert reloaded.tree_count_fitted == adapter.tree_count_fitted
    assert reloaded.target_clip == adapter.target_clip
    rows = DATA.test_index
    assert np.max(np.abs(predictor(reloaded)(DATA.features, rows) - predictor(adapter)(DATA.features, rows))) <= 1e-6


def test_the_wrong_task_method_refuses(fitted):
    adapter, _ = fitted
    wrong = adapter.predict_value if adapter.task == "classification" else adapter.predict_probability
    with pytest.raises(TypeError):
        wrong(DATA.features, DATA.test_index[:3])


def test_predict_before_fit_refuses():
    adapter = models.build_adapter(KEY, FAST, "cpu", 42)
    with pytest.raises(RuntimeError):
        adapter.predict_probability(DATA.features, DATA.test_index[:3])
    with pytest.raises(RuntimeError):
        adapter.save("nowhere")


# ─── a real engine run on MNQ 5-minute bars from the lake ─────────────────

LAKE_WINDOW = {"start": "2025-07-07", "end": "2025-07-26"}   # three weeks inside one MNQ contract (no roll)


@pytest.fixture(scope="module")
def lake_market():
    """MNQ 5m bars read from the lake through the loader `main.py` uses, and
    the engine's causal features over them. Skips (never fails) when the lake
    is unreachable, so the test states the reason instead of guessing."""
    from cycle.engine import clean_market_data
    from cycle.features import build_features
    from shared.data import load_ohlcv_arrays

    try:
        raw = load_ohlcv_arrays("MNQ", "5m", max_bars=0, date_range=LAKE_WINDOW)
    except Exception as error:  # noqa: BLE001 - the lake is an external service
        pytest.skip(f"the lake is unreachable: {type(error).__name__}: {error}")
    data, _ = clean_market_data(raw)
    if len(data) < 1000:
        pytest.skip(f"only {len(data)} MNQ 5m bars in {LAKE_WINDOW}")
    return data, build_features(data.as_dict())


def test_an_engine_run_on_real_mnq_bars_completes(lake_market, tmp_path, monkeypatch):
    import pyarrow.parquet as pq

    from cycle.engine import CycleEngine, CycleSettings
    from cycle.simulate import load_cost_model
    from shared import protocol

    data, feature_set = lake_market
    events: list[dict] = []
    monkeypatch.setattr(protocol, "emit", lambda event: events.append(json.loads(protocol.dumps_safe(event))))
    parameters = catalog.resolve_parameters(KEY, {"tree_count": 50, "max_depth": 4, "epochs": 3, "patience": 2})
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id=f"cycle_extra_{KEY}", model_family=KEY,
        model_parameters=parameters, artifact_directory=str(tmp_path),
        train_days=8, validation_fraction=0.2, test_days=2, step_days=0, fold_limit=1, expanding_window=False,
        label_horizon_bars=4, label_threshold_ticks=1.0, embargo_bars=2,
        long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1,
        tuning_trials=0, tuning_mode="reviewed_defaults", bars_per_second=0.0, start_paused=False, quiet_bars=True,
        log_every_batches=1000, device="cpu", seed=42, land_in_lake=False,
    )
    factory = lambda values, task="classification": models.build_adapter(KEY, values, "cpu", 42, task=task)  # noqa: E731
    engine = CycleEngine(settings, data, feature_set, load_cost_model("MNQ"), factory)
    engine.run()

    assert events[-1]["type"] == "done", [e for e in events if e["type"] in ("error", "log")][-5:]
    assert not [e for e in events if e["type"] == "error"]
    (plan,) = [e for e in events if e["type"] == "cycle_plan"]
    assert plan["explainKind"] == "opaque" and plan["hasPriceModel"] is True and plan["directionMode"] == "classifier"
    roles = {e.get("modelRole") for e in events if e["type"] == "cycle_epoch"}
    assert roles == {"direction", "price"}
    processed = [e for e in events if e["type"] == "cycle_bars" and e["role"] == "processed"]
    probabilities = [p for e in processed for p in e["probabilityUp"]]
    assert len(probabilities) >= 200, len(probabilities)   # a few hundred test bars walked one at a time
    assert all(p is None or 0.0 <= p <= 1.0 for p in probabilities)
    assert sum(p is not None for p in probabilities) > 0.9 * len(probabilities)
    (final,) = [e for e in events if e["type"] == "cycle_scoreboard" and e["scope"] == "final"]
    assert final["metrics"]["accuracy"] is not None and final["metrics"]["log_loss"] is not None

    assert (tmp_path / "predictions.parquet").exists()
    fold = tmp_path / "fold_0"
    metadata = json.loads((fold / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["task"]) == (KEY, KEY, "classification")
    direction = models.load_adapter(str(fold))
    price = models.load_adapter(str(fold / "price_model"))
    assert (direction.task, price.task) == ("classification", "regression")
    predictions = pq.read_table(tmp_path / "predictions.parquet").to_pydict()
    rows = {int(stamp): index for index, stamp in enumerate(data.timestamps)}
    checked = 0
    for stamp, probability in zip(predictions["timestamp"], predictions["probability_up"]):
        if probability is None:
            continue
        row = rows[int(stamp.timestamp()) if hasattr(stamp, "timestamp") else int(stamp)]
        reloaded = direction.predict_probability(feature_set.matrix, np.array([row]))[0]
        assert abs(reloaded - probability) <= 1e-6
        checked += 1
        if checked == 25:
            break
    assert checked == 25
