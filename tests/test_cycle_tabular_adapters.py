"""Model Cycle tabular adapters: scikit-learn, CatBoost and statsmodels Probit
(src/ml/cycle/{sklearn_adapter,catboost_adapter,statsmodels_adapter,fitting}.py).

Every non-legacy, non-neural registry model is fitted on one synthetic causal
dataset (the label and the price target of bar t come from bar t's features
plus noise; the price target carries +-40 outliers) as each role it has: the
direction classifier when ``direction.mode == "classifier"``, the price model
when the entry's ``price`` is set (a direction-from-price key is only ever
built as a price model; ``cycle.derived`` wraps it).

Checked per (key, role): it learns; it reports through the reporter with the
registry's step unit; one row at a time equals the batch, bit for bit; bars
after t never change the prediction at t; save -> ``models.load_adapter``
predicts the same; the scaler saw the fitted training rows only; the logistic
curve (SVM) and the calibration map saw the validation rows only; the kept
round / epoch is the best one and the predictions use exactly it; Stop
propagates (and within 0.5 s during a long single fit); CatBoost writes
nothing. Then a real ``CycleEngine`` run completes for one model of each
adapter kind, a direction-from-price key included.
"""

from __future__ import annotations

import copy
import json
import math
import os
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from cycle import catalog, models
from cycle.adapter import BatchReport, EpochReport, NoPriceModel, StopRequested
from cycle.derived import DerivedDirectionAdapter, fit_logistic_curve
from cycle.fitting import run_single_fit

KEYS = (
    "gradient_boosting_machine", "catboost", "stacked_generalization", "extra_trees",
    "classification_and_regression_tree", "decision_tree_classifier", "stochastic_gradient_descent",
    "probit_regression", "ridge_regression", "lasso_regression", "elastic_net_regression",
    "least_angle_regression", "bayesian_ridge_regression", "linear_regression", "quantile_regression",
    "support_vector_machine", "k_nearest_neighbors", "naive_bayes", "calibrated_classifier",
    "multilayer_perceptron_scikit_learn",
)

# Small settings so the whole file runs in about a minute (defaults otherwise).
FAST_PARAMETERS = {
    "gradient_boosting_machine": {"boosting_rounds": 80, "early_stopping_rounds": 10, "learning_rate": 0.2},
    "catboost": {"boosting_rounds": 120, "early_stopping_rounds": 15, "learning_rate": 0.2},
    "stacked_generalization": {"tree_count": 20, "stacking_folds": 3},
    "extra_trees": {"tree_count": 40},
    "stochastic_gradient_descent": {"epochs": 8, "patience": 3},
    "multilayer_perceptron_scikit_learn": {"epochs": 8, "patience": 3, "hidden_size": 16},
}

ENTRIES = {key: catalog.entry(key) for key in KEYS}


def roles(key: str) -> list[str]:
    entry = ENTRIES[key]
    found = []
    if entry["direction"]["mode"] == "classifier":
        found.append("classification")
    if entry["price"] is not None:
        found.append("regression")
    return found


KEY_TASKS = [(key, task) for key in KEYS for task in roles(key)]
IDS = [f"{key}-{task}" for key, task in KEY_TASKS]


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


class FakeReporter:
    """Records every call. ``stop_after=k`` raises StopRequested on the k-th checkpoint."""

    def __init__(self, stop_after: int | None = None) -> None:
        self.step_unit = None
        self.batches: list[BatchReport] = []
        self.epochs: list[EpochReport] = []
        self.started: list[tuple[int, int]] = []
        self.validating_calls: list[tuple[int, int]] = []
        self.logs: list[tuple[str, str]] = []
        self.checkpoints = 0
        self.stop_after = stop_after

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
        if self.stop_after is not None and self.checkpoints >= self.stop_after:
            raise StopRequested()

    def log(self, message, level="info"):
        self.logs.append((message, level))


def build(key: str, task: str, **overrides):
    return models.build_adapter(key, {**FAST_PARAMETERS.get(key, {}), **overrides}, "cpu", 11, task=task)


_FITTED: dict[tuple[str, str], tuple[object, FakeReporter]] = {}


def fitted(key: str, task: str):
    if (key, task) not in _FITTED:
        adapter = build(key, task)
        reporter = FakeReporter()
        adapter.fit(DATA.features, DATA.labels_for(task), DATA.train_index, DATA.validation_index,
                    DATA.timestamps, reporter)
        _FITTED[(key, task)] = (adapter, reporter)
    return _FITTED[(key, task)]


def predict(adapter, features, index) -> np.ndarray:
    if adapter.task == "classification":
        return adapter.predict_probability(features, index)
    return adapter.predict_value(features, index)


# ─── the registry ──────────────────────────────────────────────────────────


def test_every_tabular_model_is_runnable_and_covered_here():
    for key in KEYS:
        entry = ENTRIES[key]
        assert entry["runnable"] is True and entry["unavailableReason"] is None, key
        assert entry["adapter"] in ("scikit_learn", "catboost", "statsmodels"), key
    registry_tabular = {key: entry for key, entry in catalog.registry()["models"].items()
                        if entry["adapter"] in ("scikit_learn", "catboost", "statsmodels")}
    assert set(KEYS) <= set(registry_tabular)
    # a tabular key this file does not cover is one still greyed (ordinal_regression until it moves to glm_bridge);
    # the scikit-learn keys a bridge unit adds are covered by that unit's own tests
    for key, entry in registry_tabular.items():
        if key not in KEYS and entry["runnable"]:
            assert entry["implementationNote"], f"{key}: a runnable tabular key outside this file carries its unit's note"


def test_the_adapter_classes_and_the_no_price_slot():
    from cycle.catboost_adapter import CatBoostAdapter
    from cycle.sklearn_adapter import SklearnEstimatorAdapter
    from cycle.statsmodels_adapter import ProbitAdapter

    expected = {"scikit_learn": SklearnEstimatorAdapter, "catboost": CatBoostAdapter, "statsmodels": ProbitAdapter}
    for key in KEYS:
        for task in roles(key):
            assert isinstance(build(key, task), expected[ENTRIES[key]["adapter"]]), (key, task)
        if ENTRIES[key]["price"] is None:
            assert isinstance(build(key, "regression"), NoPriceModel)
    with pytest.raises(ValueError, match="no classifier"):
        SklearnEstimatorAdapter("ridge_regression", ENTRIES["ridge_regression"], {"penalty_strength": 1.0},
                                "cpu", 1, task="classification")
    with pytest.raises(ValueError, match="not a scikit-learn dotted path"):
        from cycle.sklearn_adapter import import_estimator

        import_estimator("os.system")


# ─── fitting and reporting ─────────────────────────────────────────────────


@pytest.mark.parametrize(("key", "task"), KEY_TASKS, ids=IDS)
def test_fit_learns_and_reports_through_the_reporter(key, task):
    adapter, reporter = fitted(key, task)
    entry = ENTRIES[key]
    assert reporter.step_unit == entry["stepUnit"]
    assert adapter.key == key and adapter.family == key and adapter.task == task
    assert adapter.feature_count == DATA.features.shape[1]
    assert reporter.epochs and reporter.batches and reporter.validating_calls
    assert reporter.checkpoints >= 1
    for report in reporter.epochs:
        assert 1 <= report.epoch <= report.epoch_count
        assert report.validation_loss is not None and math.isfinite(report.validation_loss)
        assert report.validation_accuracy is not None
        if task == "regression":
            assert report.validation_f1_score is None
    # the steps a paced model takes are each checkpointed
    if entry["progress"] != "single_fit":
        assert reporter.checkpoints >= len(reporter.started)
    if task == "classification":
        probability = adapter.predict_probability(DATA.features, DATA.test_index)
        assert probability.dtype == np.float64 and probability.shape == DATA.test_index.shape
        assert np.all((probability >= 0) & (probability <= 1))
        accuracy = np.mean((probability >= 0.5) == (DATA.labels[DATA.test_index] >= 0.5))
        assert accuracy >= 0.75, f"{key}: test accuracy {accuracy:.3f}"
    else:
        value = adapter.predict_value(DATA.features, DATA.clean_test)
        assert value.dtype == np.float64
        correlation = np.corrcoef(value, DATA.target[DATA.clean_test])[0, 1]
        assert correlation >= 0.6, f"{key}: test correlation {correlation:.3f}"
        # the clip bounds are the training rows' own 1st / 99th percentiles
        low, high = np.percentile(DATA.target[adapter.training_rows if hasattr(adapter, "training_rows")
                                              else DATA.train_index].astype(np.float64), [1, 99])
        assert adapter.target_clip == pytest.approx((low, high))


@pytest.mark.parametrize(("key", "task"), KEY_TASKS, ids=IDS)
def test_one_row_at_a_time_equals_the_batch(key, task):
    adapter, _ = fitted(key, task)
    rows = DATA.test_index[:40]
    batch = predict(adapter, DATA.features, rows)
    single = np.array([predict(adapter, DATA.features, np.array([row]))[0] for row in rows])
    if ENTRIES[key]["explainKind"] in ("trees", "oblivious_trees", "neighbors", "naive_bayes", "support_vectors",
                                       "calibration"):
        assert np.array_equal(single, batch), f"{key}: max difference {np.max(np.abs(single - batch))}"
    else:
        # a weighted sum over one row runs a different BLAS kernel (dot) than over many
        # (matrix product), so the last bit can differ: measured at most 4.4e-16
        np.testing.assert_allclose(single, batch, rtol=0, atol=1e-12)


@pytest.mark.parametrize(("key", "task"), KEY_TASKS, ids=IDS)
def test_changing_future_rows_never_changes_a_prediction(key, task):
    adapter, _ = fitted(key, task)
    generator = np.random.default_rng(5)
    for cut in (DATA.test_index[10], DATA.test_index[120]):
        rows = DATA.test_index[DATA.test_index <= cut][-25:]
        before = predict(adapter, DATA.features, rows)
        perturbed = DATA.features.copy()
        perturbed[cut + 1:] = generator.standard_normal(perturbed[cut + 1:].shape).astype(np.float32) * 9
        assert np.array_equal(predict(adapter, perturbed, rows), before)


@pytest.mark.parametrize(("key", "task"), KEY_TASKS, ids=IDS)
def test_save_and_reload_through_models_load_adapter(key, task, tmp_path):
    adapter, _ = fitted(key, task)
    path = adapter.save(str(tmp_path))
    assert Path(path).is_file()
    metadata = json.loads((tmp_path / "model.json").read_text(encoding="utf-8"))
    assert metadata["adapter"] == ENTRIES[key]["adapter"] and metadata["key"] == key
    assert metadata["family"] == key and metadata["task"] == task
    assert metadata["feature_count"] == DATA.features.shape[1] and metadata["model_file"] == Path(path).name
    assert metadata["parameters"] == json.loads(json.dumps(adapter.parameters))
    reloaded = models.load_adapter(str(tmp_path))
    assert type(reloaded) is type(adapter) and reloaded.task == task and reloaded.key == key
    assert np.array_equal(predict(reloaded, DATA.features, DATA.test_index), predict(adapter, DATA.features, DATA.test_index))
    assert reloaded.best_iteration == adapter.best_iteration
    if hasattr(adapter, "training_rows"):
        assert np.array_equal(reloaded.training_rows, adapter.training_rows)
        assert reloaded.logistic_curve == adapter.logistic_curve
    if hasattr(adapter, "target_clip") and task == "regression":
        assert reloaded.target_clip == pytest.approx(adapter.target_clip)


# ─── what each piece was fitted on ─────────────────────────────────────────


SCALED = [(key, task) for key, task in KEY_TASKS if "standard_scaler" in ENTRIES[key]["preprocess"]]


@pytest.mark.parametrize(("key", "task"), SCALED, ids=[f"{k}-{t}" for k, t in SCALED])
def test_the_scaler_saw_the_fitted_training_rows_only(key, task):
    adapter, _ = fitted(key, task)
    rows = adapter.training_rows if hasattr(adapter, "training_rows") else DATA.train_index
    assert np.isin(rows, DATA.train_index).all()
    expected = DATA.features[rows].astype(np.float64)
    assert adapter.scaler.n_samples_seen_ == rows.size
    np.testing.assert_allclose(adapter.scaler.mean_, expected.mean(axis=0), rtol=1e-12, atol=1e-12)
    np.testing.assert_allclose(adapter.scaler.scale_, expected.std(axis=0), rtol=1e-10)


def test_unscaled_models_have_no_scaler():
    for key, task in KEY_TASKS:
        if "standard_scaler" not in ENTRIES[key]["preprocess"] and ENTRIES[key]["adapter"] == "scikit_learn":
            assert fitted(key, task)[0].scaler is None, key


def test_the_support_vector_machine_fits_the_most_recent_bars_and_its_curve_on_validation_only():
    cap = 900
    adapter = build("support_vector_machine", "classification", maximum_training_bars=cap)
    reporter = FakeReporter()
    adapter.fit(DATA.features, DATA.labels, DATA.train_index, DATA.validation_index, DATA.timestamps, reporter)
    np.testing.assert_array_equal(adapter.training_rows, DATA.train_index[-cap:])
    assert adapter.estimator.shape_fit_[0] == cap
    assert any("most recent 900 of" in message for message, _ in reporter.logs)
    assert adapter.estimator.probability is False            # never libsvm's Platt scaling
    scores = adapter.estimator.decision_function(adapter.scaler.transform(DATA.features[DATA.validation_index].astype(np.float64)))
    assert adapter.logistic_curve == fit_logistic_curve(scores, DATA.labels[DATA.validation_index])
    # the default direction model: the curve came from the validation rows, never the training rows
    default, _ = fitted("support_vector_machine", "classification")
    train_scores = default.estimator.decision_function(default.scaler.transform(DATA.features[DATA.train_index].astype(np.float64)))
    assert default.logistic_curve != fit_logistic_curve(train_scores, DATA.labels[DATA.train_index])
    # the price model takes the same cap and has no curve
    price = build("support_vector_machine", "regression", maximum_training_bars=cap)
    price.fit(DATA.features, DATA.target, DATA.train_index, DATA.validation_index, DATA.timestamps, FakeReporter())
    np.testing.assert_array_equal(price.training_rows, DATA.train_index[-cap:])
    assert price.logistic_curve is None


@pytest.mark.parametrize("method", ["sigmoid", "isotonic"])
@pytest.mark.parametrize("base_model", ["gradient_boosting_machine", "naive_bayes"])
def test_the_calibration_map_is_fitted_on_the_validation_rows_only(base_model, method):
    from sklearn.calibration import CalibratedClassifierCV
    from sklearn.frozen import FrozenEstimator

    adapter = build("calibrated_classifier", "classification", base_model=base_model, calibration_method=method)
    adapter.fit(DATA.features, DATA.labels, DATA.train_index, DATA.validation_index, DATA.timestamps, FakeReporter())
    np.testing.assert_array_equal(adapter.calibration_rows, DATA.validation_index)
    np.testing.assert_array_equal(adapter.training_rows, DATA.train_index)
    calibrated = adapter.estimator.calibrated_classifiers_
    assert len(calibrated) == 1
    base = calibrated[0].estimator.estimator                 # FrozenEstimator(base)
    assert base.n_features_in_ == DATA.features.shape[1]
    # the same base model calibrated again on the validation rows gives the same probabilities
    again = CalibratedClassifierCV(FrozenEstimator(base), method=method).fit(
        DATA.features[DATA.validation_index].astype(np.float64), DATA.labels[DATA.validation_index].astype(np.int64))
    expected = again.predict_proba(DATA.features[DATA.test_index].astype(np.float64))[:, 1]
    np.testing.assert_allclose(adapter.predict_probability(DATA.features, DATA.test_index), expected, rtol=0, atol=1e-12)
    # and calibrating on the training rows instead would not
    wrong = CalibratedClassifierCV(FrozenEstimator(base), method=method).fit(
        DATA.features[DATA.train_index].astype(np.float64), DATA.labels[DATA.train_index].astype(np.int64))
    assert not np.allclose(wrong.predict_proba(DATA.features[DATA.test_index].astype(np.float64))[:, 1], expected)


def test_stacking_uses_contiguous_folds_and_the_named_base_models():
    from sklearn.model_selection import KFold

    adapter, _ = fitted("stacked_generalization", "classification")
    stacking = adapter.estimator
    assert isinstance(stacking.cv, KFold) and stacking.cv.shuffle is False and stacking.cv.n_splits == 3
    assert [name for name, _ in stacking.estimators] == ["logistic_regression", "random_forest", "gradient_boosting"]
    assert stacking.named_estimators_["random_forest"].n_estimators == 20
    assert stacking.named_estimators_["gradient_boosting"].n_estimators == 20
    assert stacking.final_estimator_.C == ENTRIES["stacked_generalization"]["parameters"]["regularization_strength"]["default"]
    assert stacking.named_estimators_["random_forest"].n_jobs == 1     # single-threaded for the walk
    price, _ = fitted("stacked_generalization", "regression")
    assert [name for name, _ in price.estimator.estimators] == ["ridge_regression", "random_forest", "gradient_boosting"]
    assert price.estimator.final_estimator_.alpha == pytest.approx(1.0)


# ─── the kept round / epoch ────────────────────────────────────────────────


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_gradient_boosting_keeps_exactly_its_best_round(task, monkeypatch):
    from cycle import sklearn_adapter

    untruncated = {}
    original = sklearn_adapter._keep_first_rounds

    def spy(estimator, rounds):
        untruncated["estimator"] = copy.deepcopy(estimator)
        original(estimator, rounds)

    monkeypatch.setattr(sklearn_adapter, "_keep_first_rounds", spy)
    adapter = build("gradient_boosting_machine", task, boosting_rounds=200, early_stopping_rounds=15, learning_rate=0.3)
    reporter = FakeReporter()
    adapter.fit(DATA.features, DATA.labels_for(task), DATA.train_index, DATA.validation_index, DATA.timestamps, reporter)
    full = untruncated["estimator"]
    trained = len(full.estimators_)
    validation = DATA.features[DATA.validation_index]
    truth = DATA.labels_for(task)[DATA.validation_index].astype(np.float64)
    if task == "classification":
        losses = [models.binary_scores(stage[:, 1], truth)["log_loss"] for stage in full.staged_predict_proba(validation)]
    else:
        losses = [models.regression_scores(stage, truth)["mean_absolute_error"] for stage in full.staged_predict(validation)]
    best = int(np.argmin(losses)) + 1
    assert adapter.best_iteration == best < trained
    assert trained - best >= 15 and trained < 200               # it stopped early, after 15 flat rounds
    assert len(adapter.estimator.estimators_) == best == adapter.estimator.n_estimators_
    stage_at_best = list(full.staged_predict_proba(DATA.features[DATA.test_index]) if task == "classification"
                         else full.staged_predict(DATA.features[DATA.test_index]))[best - 1]
    expected = stage_at_best[:, 1] if task == "classification" else stage_at_best
    np.testing.assert_allclose(predict(adapter, DATA.features, DATA.test_index), expected, rtol=0, atol=1e-12)
    assert reporter.epochs[-1].stopped_early and reporter.epochs[-1].epoch == trained
    assert [report.epoch for report in reporter.epochs] == list(range(10, trained + 1, 10))


@pytest.mark.parametrize("key", ["stochastic_gradient_descent", "multilayer_perceptron_scikit_learn"])
def test_per_epoch_models_keep_the_best_epoch(key):
    adapter, reporter = fitted(key, "classification")
    best_reports = [report for report in reporter.epochs if report.is_best]
    assert best_reports and adapter.best_iteration == best_reports[-1].epoch
    losses = [report.validation_loss for report in reporter.epochs]
    assert best_reports[-1].validation_loss == min(losses)
    scores = models.binary_scores(adapter.predict_probability(DATA.features, DATA.validation_index),
                                  DATA.labels[DATA.validation_index])
    assert scores["log_loss"] == pytest.approx(min(losses), rel=1e-12)


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_catboost_keeps_its_best_round(task):
    adapter, reporter = fitted("catboost", task)
    model = adapter.model
    assert adapter.best_iteration == model.tree_count_ == model.get_best_iteration() + 1
    trained = max(report.epoch for report in reporter.epochs)
    assert adapter.best_iteration <= trained
    assert [report.epoch for report in reporter.batches] == list(range(1, trained + 1))
    assert all(report.epoch % 10 == 0 or report.epoch == trained for report in reporter.epochs)


# ─── stopping ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("key", "task"), KEY_TASKS, ids=IDS)
def test_stop_propagates_from_the_first_checkpoint(key, task):
    adapter = build(key, task)
    with pytest.raises(StopRequested):
        adapter.fit(DATA.features, DATA.labels_for(task), DATA.train_index, DATA.validation_index,
                    DATA.timestamps, FakeReporter(stop_after=1))


def test_catboost_stops_mid_training_with_stop_requested_not_a_catboost_error():
    adapter = build("catboost", "classification", boosting_rounds=400, early_stopping_rounds=400)
    reporter = FakeReporter(stop_after=5)
    with pytest.raises(StopRequested):
        adapter.fit(DATA.features, DATA.labels, DATA.train_index, DATA.validation_index, DATA.timestamps, reporter)
    # one checkpoint runs before training, then one per round: the 5th is round 4's, the last round trained
    assert len(reporter.batches) == 4 and reporter.checkpoints == 5


class TimedStop:
    """A reporter whose Stop is pressed from another thread; records when."""

    def __init__(self) -> None:
        self.step_unit = None
        self.pressed = threading.Event()
        self.pressed_at: float | None = None

    def press(self) -> None:
        self.pressed_at = time.perf_counter()
        self.pressed.set()

    def checkpoint(self):
        if self.pressed.is_set():
            raise StopRequested()

    def epoch_started(self, *args):
        pass

    def batch(self, report):
        pass

    def epoch_finished(self, report):
        pass

    def validating(self, *args):
        pass

    def log(self, message, level="info"):
        pass


def test_stop_during_a_long_support_vector_machine_fit_is_answered_within_half_a_second():
    generator = np.random.default_rng(9)
    rows = 14_000
    features = generator.standard_normal((rows, 30)).astype(np.float32)
    labels = (features[:, 0] + generator.standard_normal(rows) > 0).astype(np.float32)
    adapter = models.build_adapter("support_vector_machine", {"maximum_training_bars": 0}, "cpu", 1)
    reporter = TimedStop()
    timer = threading.Timer(0.6, reporter.press)
    timer.start()
    started = time.perf_counter()
    try:
        with pytest.raises(StopRequested):
            adapter.fit(features, labels, np.arange(0, 12_000), np.arange(12_010, rows), None, reporter)
    finally:
        timer.cancel()
    answered = time.perf_counter()
    assert reporter.pressed_at is not None, "the fit ended before Stop was pressed; make it longer"
    assert answered - reporter.pressed_at < 0.5, f"Stop answered after {answered - reporter.pressed_at:.2f} s"
    assert answered - started < 2.0


def test_run_single_fit_pauses_returns_and_re_raises():
    class Pausing(TimedStop):
        def __init__(self):
            super().__init__()
            self.resume = threading.Event()
            self.checks = 0

        def checkpoint(self):
            self.checks += 1
            if self.checks == 2:
                assert self.resume.wait(10)

    reporter = Pausing()
    threading.Timer(0.8, reporter.resume.set).start()
    started = time.perf_counter()
    assert run_single_fit(lambda: time.sleep(0.3) or 42, reporter) == 42
    assert time.perf_counter() - started >= 0.75          # held by the pause until resumed
    with pytest.raises(ZeroDivisionError):
        run_single_fit(lambda: 1 / 0, TimedStop())


# ─── CatBoost writes nothing ───────────────────────────────────────────────


def test_catboost_writes_nothing_into_the_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    before_temporary = {name for name in os.listdir(tempfile.gettempdir()) if name.startswith("cycle_catboost_")}
    for task in ("classification", "regression"):
        adapter = build("catboost", task, boosting_rounds=30)
        adapter.fit(DATA.features, DATA.labels_for(task), DATA.train_index, DATA.validation_index,
                    DATA.timestamps, FakeReporter())
    assert list(tmp_path.iterdir()) == []
    after_temporary = {name for name in os.listdir(tempfile.gettempdir()) if name.startswith("cycle_catboost_")}
    assert after_temporary <= before_temporary                 # its train_dir is removed after the fit
    repository = Path(__file__).resolve().parents[1]
    assert not (repository / "catboost_info").exists()


def test_probit_exposes_its_result_and_penalises_everything_but_the_intercept():
    adapter, _ = fitted("probit_regression", "classification")
    from scipy.stats import norm

    params = np.asarray(adapter.result.params)
    assert params.shape == (DATA.features.shape[1] + 1,)
    design = adapter.scaler.transform(DATA.features[DATA.test_index].astype(np.float64))
    np.testing.assert_allclose(adapter.predict_probability(DATA.features, DATA.test_index),
                               norm.cdf(params[0] + design @ params[1:]), rtol=0, atol=1e-15)
    penalised = build("probit_regression", "classification", penalty_strength=50.0)
    penalised.fit(DATA.features, DATA.labels, DATA.train_index, DATA.validation_index, DATA.timestamps, FakeReporter())
    weights = np.asarray(penalised.result.params)
    assert np.sum(np.abs(weights[1:]) < 1e-8) >= 3            # an L1 penalty zeroes the weak features
    assert abs(weights[0]) > 0 or np.mean(DATA.labels[DATA.train_index]) == 0.5


# ─── a real engine run per adapter kind ────────────────────────────────────


@dataclass
class Market:
    data: object
    features: object


def synthetic_market(calendar_days: int = 42, seed: int = 5) -> Market:
    """Weekday 5-minute bars (96 a day) whose next move follows a planted AR(1)
    signal the model is handed as a feature, as in test_cycle_engine.py."""
    from cycle.engine import MarketData
    from cycle.features import FeatureSet

    generator = np.random.default_rng(seed)
    first_monday = int(datetime(2026, 3, 2, tzinfo=timezone.utc).timestamp())
    stamps: list[int] = []
    for day in range(calendar_days):
        if day % 7 >= 5:
            continue
        opening = first_monday + day * 86_400 + 13 * 3_600 + 30 * 60
        stamps.extend(opening + 300 * np.arange(96))
    timestamps = np.array(stamps, dtype=np.int64)
    count = timestamps.size
    signal = np.zeros(count)
    innovation = generator.standard_normal(count) * math.sqrt(1 - 0.9 ** 2)
    for t in range(1, count):
        signal[t] = 0.9 * signal[t - 1] + innovation[t]
    step = np.zeros(count)
    step[1:] = 1.5 * signal[:-1] + generator.normal(0, 1.5, count - 1)
    close = np.round((18_000 + np.cumsum(step)) / 0.25) * 0.25
    open_ = np.r_[18_000.0, close[:-1] + 0.25 * generator.integers(-1, 2, count - 1)]
    high = np.maximum(open_, close) + 0.25 * generator.integers(0, 5, count)
    low = np.minimum(open_, close) - 0.25 * generator.integers(0, 5, count)
    volume = generator.integers(50, 2_000, count).astype(np.float64)
    matrix = np.column_stack([signal, np.r_[np.nan, signal[:-1]], generator.standard_normal(count),
                              generator.standard_normal(count)]).astype(np.float32)
    matrix[:30] = np.nan
    names = ["planted_signal", "planted_signal_previous_bar", "noise_first", "noise_second"]
    return Market(MarketData(timestamps, open_, high, low, close, volume), FeatureSet(matrix, names, raw=matrix.copy()))


@pytest.fixture(scope="module")
def market() -> Market:
    return synthetic_market()


ENGINE_RUNS = {
    # key: (parameters, tuning trials)
    "gradient_boosting_machine": ({"boosting_rounds": 40, "early_stopping_rounds": 10}, 0),
    "catboost": ({"boosting_rounds": 60}, 0),
    "probit_regression": ({}, 0),
    "lasso_regression": ({}, 2),                     # direction from price, tuned through the registry search space
    "support_vector_machine": ({"maximum_training_bars": 1500}, 0),
}


@pytest.mark.parametrize("key", list(ENGINE_RUNS))
def test_an_engine_run_completes(key, market, tmp_path, monkeypatch):
    from cycle.engine import CycleEngine, CycleSettings
    from cycle.simulate import load_cost_model
    from shared import protocol

    events: list[dict] = []
    monkeypatch.setattr(protocol, "emit", lambda event: events.append(json.loads(protocol.dumps_safe(event))))
    parameters, trials = ENGINE_RUNS[key]
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id=f"tabular_{key}", model_family=key,
        model_parameters=catalog.resolve_parameters(key, parameters), artifact_directory=str(tmp_path),
        train_days=14, validation_fraction=0.2, test_days=3, fold_limit=2, label_horizon_bars=4,
        label_threshold_ticks=1.0, embargo_bars=2, contracts=1, tuning_trials=trials, tuning_folds=2, tuning_mode=("tuned" if trials else "reviewed_defaults"),
        bars_per_second=0.0, quiet_bars=True, log_every_batches=1000, device="cpu", seed=42, land_in_lake=False,
    )
    engine = CycleEngine(
        settings, market.data, market.features, load_cost_model("MNQ"),
        lambda values, task="classification": models.build_adapter(key, values, "cpu", 42, task=task),
        suggest_parameters=(lambda trial, base: models.suggest_parameters(trial, key, base)) if trials else None,
    )
    engine.run()
    kinds = [event["type"] for event in events]
    errors = [event for event in events if event["type"] == "error"]
    assert not errors, errors
    assert kinds[-1] == "done"
    plan = next(event for event in events if event["type"] == "cycle_plan")
    entry = ENTRIES[key]
    assert plan["explainKind"] == entry["explainKind"] and plan["directionMode"] == entry["direction"]["mode"]
    assert plan["hasPriceModel"] == (entry["price"] is not None)
    if trials:
        assert len([event for event in events if event["type"] == "cycle_trial"]) >= trials
    (final,) = [event for event in events if event["type"] == "cycle_scoreboard" and event["scope"] == "final"]
    assert final["metrics"]["accuracy"] is not None and final["metrics"]["accuracy"] > 0.55   # the planted signal
    for k in range(engine.fold_count):
        folder = tmp_path / f"fold_{k}"
        metadata = json.loads((folder / "model.json").read_text(encoding="utf-8"))
        direction = models.load_adapter(str(folder))
        spec = engine.folds[k]
        probability = direction.predict_probability(engine.features, spec.test_index[:5])
        assert np.all((probability >= 0) & (probability <= 1))
        if entry["direction"]["mode"] == "from_price":
            assert metadata["adapter"] == "derived" and isinstance(direction, DerivedDirectionAdapter)
            assert direction.price_adapter.key == key and direction.logistic_curve is not None
        else:
            assert metadata["adapter"] == entry["adapter"] and metadata["key"] == key
            if entry["price"] is not None:
                price = models.load_adapter(str(folder / "price_model"))
                assert price.task == "regression"
            else:
                assert not (folder / "price_model").exists()
