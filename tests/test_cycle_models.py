"""Model Cycle model families (src/ml/cycle/models.py + networks.py).

Every family is fitted on one synthetic causal dataset: the label of bar t is
1 when a combination of bar t's features and LAGGED features (t-1, t-3) plus
noise is above zero. Row-only models can reach ~0.8 accuracy from the bar-t
part; sequence models can also use the lags.

Checked per family (and per device for the neural families and xgboost):
learning (validation and test accuracy >= 0.65 with the fixed seeds below —
every family clears 0.70 in practice), probability shape/range/dtype,
single-row == batched, causality (rows after t never change P(up) at t),
checkpoint cadence, stop and pause through the reporter, save/load,
Optuna search spaces.

The price model (``task="regression"``, bottom of the file) is fitted on a
second synthetic causal target with injected +-40 outliers and checked for:
R^2 >= 0.55 on outlier-free validation and test rows (measured minimum 0.63),
reported losses that are mean absolute error, sign accuracy, single-row ==
batched, causality, stop, save/load with the task recorded, and a training
target clip that uses the training rows' own percentiles only.
"""

from __future__ import annotations

import ast
import json
import threading
import time
from pathlib import Path

import numpy as np
import optuna
import pytest

torch = pytest.importorskip("torch")

from cycle import catalog  # noqa: E402
from cycle.adapter import (  # noqa: E402
    LEGACY_FAMILIES,
    BatchReport,
    EpochReport,
    NoPriceModel,
    StopRequested,
)
from cycle.adapter import MODEL_FAMILIES as REGISTRY_KEYS  # noqa: E402
from cycle.adapter import NEURAL_FAMILIES as REGISTRY_NEURAL_KEYS  # noqa: E402
from cycle.adapter import SEQUENCE_FAMILIES as REGISTRY_SEQUENCE_KEYS  # noqa: E402
from cycle.models import (  # noqa: E402
    ADAPTER_CLASSES,
    FAMILY_PARAMETER_KEYS,
    binary_scores,
    build_adapter,
    default_parameters,
    load_adapter,
    resolve_parameters,
    suggest_parameters,
)

# The fitting tests cover the eight families that predate the registry; every
# other registry model is fitted by the tests of the package that builds it.
MODEL_FAMILIES = LEGACY_FAMILIES
NEURAL_FAMILIES = tuple(family for family in REGISTRY_NEURAL_KEYS if family in LEGACY_FAMILIES)
SEQUENCE_FAMILIES = tuple(family for family in REGISTRY_SEQUENCE_KEYS if family in LEGACY_FAMILIES)

ACCURACY_THRESHOLD = 0.65
CUDA = torch.cuda.is_available()
SEQUENCE_LENGTH = 16

# Small, fast settings per family (defaults otherwise).
FAST_PARAMETERS = {
    "logistic_regression": {},
    "random_forest": {"tree_count": 60, "max_depth": 6},
    "xgboost": {"boosting_rounds": 120, "early_stopping_rounds": 20, "max_depth": 4,
                "learning_rate": 0.1},
    "lightgbm": {"boosting_rounds": 120, "early_stopping_rounds": 20, "leaf_count": 15,
                 "learning_rate": 0.1},
    "multilayer_perceptron": {"hidden_size": 32, "epochs": 8, "batch_size": 128,
                              "patience": 3, "learning_rate": 0.003},
    "lstm": {"sequence_length": SEQUENCE_LENGTH, "hidden_size": 32, "epochs": 8,
             "batch_size": 128, "patience": 3, "learning_rate": 0.003},
    "temporal_convolution_network": {"sequence_length": SEQUENCE_LENGTH, "channel_count": 16,
                                     "epochs": 8, "batch_size": 128, "patience": 3,
                                     "learning_rate": 0.003},
    "transformer_encoder": {"sequence_length": SEQUENCE_LENGTH, "model_dimension": 32,
                            "head_count": 4, "layer_count": 1, "epochs": 8, "batch_size": 128,
                            "patience": 3, "learning_rate": 0.001},
}

# Even smaller: for the stop / pause tests, which only need a few steps.
TINY_PARAMETERS = {
    family: {**values, **({"epochs": 2} if family in NEURAL_FAMILIES else {})}
    for family, values in FAST_PARAMETERS.items()
}
TINY_PARAMETERS["random_forest"] = {"tree_count": 30, "max_depth": 4}
# lbfgs converges inside the first 30-iteration pass on this data (the fit then
# ends after one pass); 2 iterations per pass leaves passes to stop or pause.
TINY_PARAMETERS["logistic_regression"] = {"max_iterations": 20}
TINY_PARAMETERS["xgboost"] = {**FAST_PARAMETERS["xgboost"], "boosting_rounds": 30}
TINY_PARAMETERS["lightgbm"] = {**FAST_PARAMETERS["lightgbm"], "boosting_rounds": 30}

FAMILY_DEVICES = [(family, "cpu") for family in MODEL_FAMILIES] + (
    [(family, "cuda") for family in (*NEURAL_FAMILIES, "xgboost")] if CUDA else []
)


# ─── synthetic causal data ─────────────────────────────────────────────────

class Dataset:
    def __init__(self, row_count: int = 5000, feature_count: int = 12, seed: int = 7) -> None:
        generator = np.random.default_rng(seed)
        features = generator.standard_normal((row_count, feature_count)).astype(np.float32)
        signal = np.zeros(row_count)
        signal[3:] = (
            1.0 * features[3:, 0]
            - 0.8 * features[3:, 1]
            + 0.6 * features[2:-1, 2]   # bar t-1
            + 0.4 * features[:-3, 3]    # bar t-3
        )
        labels = (signal + 0.5 * generator.standard_normal(row_count) > 0).astype(np.float32)
        labels[:3] = np.nan                                   # lags not available
        labels[-6:] = np.nan                                  # horizon past the data
        labels[generator.random(row_count) < 0.03] = np.nan   # inside the threshold
        features[:5] = np.nan                                 # feature warmup
        self.features = features
        self.labels = labels
        self.timestamps = (1_700_000_000 + 300 * np.arange(row_count)).astype(np.int64)

        scored = np.flatnonzero(np.isfinite(labels))
        first_usable = 5 + SEQUENCE_LENGTH - 1
        scored = scored[scored >= first_usable]
        self.train_index = scored[scored < 3000]
        self.validation_index = scored[(scored >= 3010) & (scored < 3800)]
        self.test_index = scored[scored >= 3810]


class FakeReporter:
    """Records every call. `stop_after=k` raises StopRequested on the k-th
    checkpoint; `pause_after=k` blocks the k-th checkpoint until `resume` is set."""

    def __init__(self, stop_after: int | None = None, pause_after: int | None = None) -> None:
        self.step_unit = None
        self.batches: list[BatchReport] = []
        self.epochs: list[EpochReport] = []
        self.started: list[tuple[int, int]] = []
        self.validating_calls: list[tuple[int, int]] = []
        self.logs: list[tuple[str, str]] = []
        self.checkpoints = 0
        self.stop_after = stop_after
        self.pause_after = pause_after
        self.resume = threading.Event()
        self.resume.set()
        self.blocked = threading.Event()

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
        if self.pause_after is not None and self.checkpoints == self.pause_after:
            self.resume.clear()
        if not self.resume.is_set():
            self.blocked.set()
            assert self.resume.wait(timeout=60), "never resumed"

    def log(self, message, level="info"):
        self.logs.append((message, level))


@pytest.fixture(scope="module")
def dataset() -> Dataset:
    return Dataset()


_FITTED: dict[tuple[str, str], tuple[object, FakeReporter, float]] = {}


def fitted(family: str, device: str, data: Dataset):
    key = (family, device)
    if key not in _FITTED:
        adapter = build_adapter(family, FAST_PARAMETERS[family], device, seed=11)
        reporter = FakeReporter()
        started = time.perf_counter()
        adapter.fit(data.features, data.labels, data.train_index, data.validation_index,
                    data.timestamps, reporter)
        _FITTED[key] = (adapter, reporter, time.perf_counter() - started)
    return _FITTED[key]


def _identifier(value):
    return value if isinstance(value, str) else None


# ─── registry ──────────────────────────────────────────────────────────────

def test_every_family_has_parameters_and_defaults():
    assert set(FAMILY_PARAMETER_KEYS) == set(REGISTRY_KEYS)
    for family in REGISTRY_KEYS:
        defaults = default_parameters(family)
        assert tuple(defaults) == FAMILY_PARAMETER_KEYS[family]
        assert resolve_parameters(family, {"unrelated_key": 5}) == defaults
    assert default_parameters("xgboost")["boosting_rounds"] == 400
    assert default_parameters("transformer_encoder")["learning_rate"] == 0.0005


def test_unknown_family_lists_the_valid_ones():
    with pytest.raises(ValueError, match="random_forest"):
        build_adapter("no_such_model", {}, "cpu", 0)
    with pytest.raises(ValueError, match="lightgbm"):
        default_parameters("nope")


def test_invalid_parameters_are_refused():
    with pytest.raises(ValueError, match="batch_size"):
        build_adapter("multilayer_perceptron", {"batch_size": 0}, "cpu", 0)
    with pytest.raises(ValueError, match="subsample"):
        build_adapter("xgboost", {"subsample": 1.5}, "cpu", 0)
    with pytest.raises(ValueError, match="whole number"):
        build_adapter("random_forest", {"tree_count": 10.5}, "cpu", 0)


def test_minimum_history():
    assert build_adapter("xgboost", {}, "cpu", 0).minimum_history() == 1
    assert build_adapter("multilayer_perceptron", {}, "cpu", 0).minimum_history() == 1
    for family in SEQUENCE_FAMILIES:
        adapter = build_adapter(family, {"sequence_length": 24}, "cpu", 0)
        assert adapter.minimum_history() == 24


def test_transformer_dimension_is_rounded_to_the_head_count():
    adapter = build_adapter("transformer_encoder", {"model_dimension": 30, "head_count": 4},
                            "cpu", 0)
    assert adapter.parameters["model_dimension"] == 32
    assert any("rounded up to 32" in note for note in adapter.notes)


def test_tree_run_never_imports_torch():
    import os
    import subprocess
    import sys
    from pathlib import Path

    source_root = Path(__file__).resolve().parents[1] / "src" / "ml"
    script = (
        "import sys, numpy as np\n"
        "from cycle.models import build_adapter\n"
        "class R:\n"
        "    step_unit = None\n"
        "    def __getattr__(self, name):\n"
        "        return lambda *a, **k: None\n"
        "g = np.random.default_rng(0)\n"
        "x = g.standard_normal((400, 4)).astype(np.float32)\n"
        "y = (x[:, 0] > 0).astype(np.float32)\n"
        "for family in ('logistic_regression', 'random_forest', 'xgboost', 'lightgbm'):\n"
        "    a = build_adapter(family, {'boosting_rounds': 5, 'tree_count': 10}, 'cpu', 0)\n"
        "    a.fit(x, y, np.arange(300), np.arange(300, 400), np.arange(400), R())\n"
        "    a.predict_probability(x, np.array([399]))\n"
        "print('torch' in sys.modules)\n"
    )
    environment = {**os.environ, "PYTHONPATH": str(source_root)}
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True,
                            env=environment, timeout=120)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().splitlines()[-1] == "False"


# ─── fitting ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize(("family", "device"), FAMILY_DEVICES, ids=_identifier)
def test_fit_learns_and_reports(family, device, dataset):
    adapter, reporter, _ = fitted(family, device, dataset)

    assert reporter.step_unit == adapter.step_unit
    assert reporter.step_unit in ("epoch", "boosting_round", "tree_batch", "solver_pass")
    assert reporter.batches, "no batch reports"
    assert reporter.epochs, "no epoch reports"
    assert reporter.checkpoints >= len(reporter.batches) >= 1

    validation = adapter.predict_probability(dataset.features, dataset.validation_index)
    test = adapter.predict_probability(dataset.features, dataset.test_index)
    validation_accuracy = binary_scores(validation, dataset.labels[dataset.validation_index])
    test_accuracy = binary_scores(test, dataset.labels[dataset.test_index])
    assert validation_accuracy["accuracy"] >= ACCURACY_THRESHOLD, validation_accuracy
    assert test_accuracy["accuracy"] >= ACCURACY_THRESHOLD, test_accuracy

    train_low, train_high = int(dataset.train_index[0]), int(dataset.train_index[-1])
    position = {int(row): i for i, row in enumerate(dataset.train_index)}
    for report in reporter.batches:
        assert train_low <= report.span_start_index <= report.span_end_index <= train_high
        assert report.epoch_count >= report.epoch >= 1
        assert report.batch_count >= report.batch >= 1
    if family in NEURAL_FAMILIES:
        batch_size = FAST_PARAMETERS[family]["batch_size"]
        for report in reporter.batches:
            # a contiguous block of the sorted training index
            span = position[report.span_end_index] - position[report.span_start_index] + 1
            assert span == batch_size or report.span_end_index == train_high
            assert report.gradient_norm is None or report.gradient_norm >= 0
            assert report.learning_rate is not None and report.learning_rate > 0
        first_epoch = [r for r in reporter.batches if r.epoch == 1]
        assert len(first_epoch) == first_epoch[0].batch_count
        starts = [r.span_start_index for r in first_epoch]
        assert starts != sorted(starts), "block order was not shuffled"
        assert sorted(starts) == sorted({r.span_start_index for r in first_epoch})
    else:
        for report in reporter.batches:  # trees see the whole window every step
            assert (report.span_start_index, report.span_end_index) == (train_low, train_high)
    best = [r for r in reporter.epochs if r.is_best]
    assert best, "no epoch marked best"
    assert all(r.validation_loss is not None for r in reporter.epochs)
    assert reporter.validating_calls


@pytest.mark.parametrize(("family", "device"), FAMILY_DEVICES, ids=_identifier)
def test_probabilities_single_row_and_causality(family, device, dataset):
    adapter, _, _ = fitted(family, device, dataset)
    index = dataset.test_index[:300]
    batched = adapter.predict_probability(dataset.features, index)
    assert batched.dtype == np.float64
    assert batched.shape == index.shape
    assert np.all((batched >= 0.0) & (batched <= 1.0))
    assert np.unique(np.round(batched, 3)).size > 10, "predictions are constant"

    for position in (0, 7, 150, 299):
        single = adapter.predict_probability(dataset.features, index[position:position + 1])
        assert single.shape == (1,)
        assert abs(single[0] - batched[position]) < 1e-5

    generator = np.random.default_rng(3)
    for row in (int(index[10]), int(index[200])):
        perturbed = dataset.features.copy()
        perturbed[row + 1:] = generator.normal(0, 25, perturbed[row + 1:].shape)
        before = adapter.predict_probability(dataset.features, np.array([row]))
        after = adapter.predict_probability(perturbed, np.array([row]))
        assert after[0] == pytest.approx(before[0], abs=1e-6)
        # the multi-row path reads the same rows only
        rows = np.array([row - 5, row - 1, row])
        assert np.allclose(adapter.predict_probability(perturbed, rows),
                           adapter.predict_probability(dataset.features, rows), atol=1e-5)
        # and the prediction DOES depend on its own bar
        own_bar = dataset.features.copy()
        own_bar[row] = generator.normal(0, 3, own_bar[row].shape)
        changed = adapter.predict_probability(own_bar, np.array([row]))
        assert changed[0] != pytest.approx(before[0], abs=1e-9)


@pytest.mark.parametrize("family", SEQUENCE_FAMILIES)
def test_sequence_networks_are_causal_inside_the_window(family):
    from cycle.networks import build_network

    parameters = resolve_parameters(family, FAST_PARAMETERS[family])
    torch.manual_seed(0)
    network = build_network(family, parameters, 6).eval()
    window = torch.randn(3, SEQUENCE_LENGTH, 6)
    with torch.inference_mode():
        reference = network.sequence_output(window)
        for position in (1, 5, SEQUENCE_LENGTH - 1):
            changed = window.clone()
            changed[:, position:] += torch.randn_like(changed[:, position:]) * 10
            output = network.sequence_output(changed)
            assert torch.allclose(output[:, :position], reference[:, :position], atol=1e-5)
            assert not torch.allclose(output[:, position], reference[:, position], atol=1e-5)


# ─── stop / pause ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("family", MODEL_FAMILIES)
def test_stop_requested_propagates(family, dataset):
    adapter = build_adapter(family, TINY_PARAMETERS[family], "cpu", seed=5)
    reporter = FakeReporter(stop_after=3)
    with pytest.raises(StopRequested):
        adapter.fit(dataset.features, dataset.labels, dataset.train_index,
                    dataset.validation_index, dataset.timestamps, reporter)
    assert reporter.checkpoints == 3
    assert len(reporter.batches) <= 2


@pytest.mark.parametrize("family", MODEL_FAMILIES)
def test_pause_blocks_fitting_until_resumed(family, dataset):
    adapter = build_adapter(family, TINY_PARAMETERS[family], "cpu", seed=5)
    reporter = FakeReporter(pause_after=2)
    failure: list[BaseException] = []

    def run():
        try:
            adapter.fit(dataset.features, dataset.labels, dataset.train_index,
                        dataset.validation_index, dataset.timestamps, reporter)
        except BaseException as error:  # surfaced in the main thread below
            failure.append(error)

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    assert reporter.blocked.wait(timeout=60), "fit never reached the pause"
    batches_at_pause = len(reporter.batches)
    time.sleep(0.25)
    assert len(reporter.batches) == batches_at_pause, "work continued while paused"
    assert worker.is_alive()
    reporter.resume.set()
    worker.join(timeout=120)
    assert not worker.is_alive()
    assert not failure, failure
    assert len(reporter.batches) > batches_at_pause


# ─── save / load ───────────────────────────────────────────────────────────

@pytest.mark.parametrize(("family", "device"), FAMILY_DEVICES, ids=_identifier)
def test_save_writes_a_loadable_model(family, device, dataset, tmp_path):
    import json

    adapter, _, _ = fitted(family, device, dataset)
    path = adapter.save(str(tmp_path))
    metadata = json.loads((tmp_path / "model.json").read_text(encoding="utf-8"))
    assert metadata["family"] == family
    assert metadata["feature_count"] == dataset.features.shape[1]
    assert set(FAMILY_PARAMETER_KEYS[family]) <= set(metadata["parameters"])
    assert (tmp_path / metadata["model_file"]).exists()
    assert path.endswith(metadata["model_file"])
    assert not list(tmp_path.glob("*.tmp*"))

    if family in NEURAL_FAMILIES:
        state = torch.load(path, map_location="cpu", weights_only=True)
        assert set(state) >= {"state_dict", "family", "parameters", "feature_count",
                              "sequence_length"}

    reloaded = load_adapter(str(tmp_path), device="cpu")
    index = dataset.test_index[:50]
    original = adapter.predict_probability(dataset.features, index)
    again = reloaded.predict_probability(dataset.features, index)
    # CUDA-trained networks reloaded on the CPU differ by float rounding only
    assert np.allclose(original, again, atol=1e-4)


# ─── tuning search spaces ──────────────────────────────────────────────────

@pytest.mark.parametrize("family", MODEL_FAMILIES)
def test_suggest_parameters_returns_every_key(family):
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(direction="minimize",
                                sampler=optuna.samplers.RandomSampler(seed=1))
    base = default_parameters(family)
    base_training_length = {
        key: base[key] for key in ("epochs", "boosting_rounds", "tree_count", "max_iterations",
                                   "patience", "early_stopping_rounds", "sequence_length")
        if key in base
    }
    for _ in range(5):
        trial = study.ask()
        suggested = suggest_parameters(trial, family, base)
        assert tuple(suggested) == FAMILY_PARAMETER_KEYS[family]
        assert resolve_parameters(family, suggested) == suggested
        for key, value in base_training_length.items():
            assert suggested[key] == value
        assert trial.params, "nothing was tuned"
        assert set(trial.params) <= set(FAMILY_PARAMETER_KEYS[family])
        for key, value in trial.params.items():
            assert suggested[key] == value
        if family == "transformer_encoder":
            assert suggested["model_dimension"] % suggested["head_count"] == 0
        study.tell(trial, 0.5)


# ─── guards ────────────────────────────────────────────────────────────────

def test_predict_before_fit_and_single_class_labels(dataset):
    for family in ("logistic_regression", "xgboost", "multilayer_perceptron"):
        adapter = build_adapter(family, TINY_PARAMETERS[family], "cpu", 0)
        with pytest.raises(RuntimeError):
            adapter.predict_probability(dataset.features, dataset.test_index[:3])
        labels = dataset.labels.copy()
        labels[np.isfinite(labels)] = 1.0
        with pytest.raises(ValueError, match="only one class"):
            adapter.fit(dataset.features, labels, dataset.train_index,
                        dataset.validation_index, dataset.timestamps, FakeReporter())


def test_sequence_model_refuses_rows_without_history(dataset):
    adapter, _, _ = fitted("lstm", "cpu", dataset)
    with pytest.raises(ValueError, match="history"):
        adapter.predict_probability(dataset.features, np.array([SEQUENCE_LENGTH - 2]))


# ═══ regression: the price model (task="regression") ══════════════════════
#
# Target of bar t = a linear combination of bar t's features and LAGGED
# features (t-1, t-3) plus noise, scaled to roughly unit deviation (the shape
# of the engine's volatility-scaled forward move), with 0.6% of rows pushed
# +-40 target units: the outliers the training-percentile clip and the Huber
# loss exist for. Row-only models can explain ~68% of the clean variance,
# sequence models ~90%. R^2 is measured on rows without an injected outlier.

R_SQUARED_THRESHOLD = 0.55  # measured minimum 0.633 (random forest, test rows)
REGRESSION_FAST_PARAMETERS = dict(FAST_PARAMETERS)


class RegressionDataset:
    def __init__(self, row_count: int = 5000, feature_count: int = 12, seed: int = 17) -> None:
        generator = np.random.default_rng(seed)
        features = generator.standard_normal((row_count, feature_count)).astype(np.float32)
        signal = np.zeros(row_count)
        signal[3:] = (
            1.0 * features[3:, 0]
            - 0.8 * features[3:, 1]
            + 0.6 * features[2:-1, 2]   # bar t-1
            + 0.4 * features[:-3, 3]    # bar t-3
        )
        clean = (signal + 0.5 * generator.standard_normal(row_count)) / 1.5
        self.outlier = generator.random(row_count) < 0.006
        outlier_sign = np.where(generator.random(row_count) < 0.5, -1.0, 1.0)
        target = (clean + np.where(self.outlier, 40.0 * outlier_sign, 0.0)).astype(np.float32)
        target[:3] = np.nan                    # lags not available
        target[-6:] = np.nan                   # horizon past the data
        features[:5] = np.nan                  # feature warmup
        self.features = features
        self.labels = target
        self.timestamps = (1_700_000_000 + 300 * np.arange(row_count)).astype(np.int64)

        scored = np.flatnonzero(np.isfinite(target))
        first_usable = 5 + SEQUENCE_LENGTH - 1
        scored = scored[scored >= first_usable]
        self.train_index = scored[scored < 3000]
        self.validation_index = scored[(scored >= 3010) & (scored < 3800)]
        self.test_index = scored[scored >= 3810]


def r_squared(prediction: np.ndarray, target: np.ndarray) -> float:
    residual = np.sum((target - prediction) ** 2)
    total = np.sum((target - target.mean()) ** 2)
    return float(1.0 - residual / total)


@pytest.fixture(scope="module")
def regression_dataset() -> RegressionDataset:
    return RegressionDataset()


_FITTED_REGRESSION: dict[tuple[str, str], tuple[object, FakeReporter, float]] = {}


def fitted_regression(family: str, device: str, data: RegressionDataset):
    key = (family, device)
    if key not in _FITTED_REGRESSION:
        adapter = build_adapter(family, REGRESSION_FAST_PARAMETERS[family], device, seed=11,
                                task="regression")
        reporter = FakeReporter()
        started = time.perf_counter()
        adapter.fit(data.features, data.labels, data.train_index, data.validation_index,
                    data.timestamps, reporter)
        _FITTED_REGRESSION[key] = (adapter, reporter, time.perf_counter() - started)
    return _FITTED_REGRESSION[key]


@pytest.mark.parametrize(("family", "device"), FAMILY_DEVICES, ids=_identifier)
def test_regression_fit_learns_and_reports(family, device, regression_dataset):
    from cycle.models import regression_scores

    data = regression_dataset
    adapter, reporter, _ = fitted_regression(family, device, data)
    assert adapter.task == "regression"
    assert reporter.step_unit == adapter.step_unit
    assert reporter.batches and reporter.epochs and reporter.validating_calls
    assert reporter.checkpoints >= 1

    for name, index in (("validation", data.validation_index), ("test", data.test_index)):
        clean = index[~data.outlier[index]]
        prediction = adapter.predict_value(data.features, clean)
        assert prediction.dtype == np.float64 and prediction.shape == clean.shape
        score = r_squared(prediction, data.labels[clean].astype(np.float64))
        assert score >= R_SQUARED_THRESHOLD, f"{name} R^2 {score:.3f}"

    # Every regression epoch reports mean absolute error and sign accuracy.
    for report in reporter.epochs:
        assert report.validation_loss is not None and report.validation_loss > 0
        assert report.validation_accuracy is not None and 0.5 < report.validation_accuracy <= 1
        assert report.validation_f1_score is None
    assert any(report.is_best for report in reporter.epochs)
    validation_prediction = adapter.predict_value(data.features, data.validation_index)
    final = regression_scores(validation_prediction, data.labels[data.validation_index])
    if family == "random_forest":  # keeps every tree: the last chunk is the final model
        reported = reporter.epochs[-1].validation_loss
    else:                          # the kept pass / round / epoch
        reported = adapter.fit_summary["best_validation_loss"]
    assert reported == pytest.approx(final["mean_absolute_error"], rel=1e-4, abs=1e-5)
    assert final["accuracy"] >= 0.65, final

    if family in NEURAL_FAMILIES:
        assert adapter.fit_summary["loss_function"].startswith("huber")
    else:
        low, high = np.percentile(data.labels[data.train_index].astype(np.float64), [1, 99])
        assert adapter.target_clip == pytest.approx((low, high))
        assert adapter.fit_summary["clipped_train_row_count"] > 0
    for report in reporter.batches:
        assert report.train_loss is None or report.train_loss >= 0


@pytest.mark.parametrize(("family", "device"), FAMILY_DEVICES, ids=_identifier)
def test_regression_single_row_and_causality(family, device, regression_dataset):
    data = regression_dataset
    adapter, _, _ = fitted_regression(family, device, data)
    index = data.test_index[:300]
    batched = adapter.predict_value(data.features, index)
    assert np.unique(np.round(batched, 4)).size > 50, "predictions are constant"
    for position in (0, 7, 150, 299):
        single = adapter.predict_value(data.features, index[position:position + 1])
        assert single.shape == (1,) and single.dtype == np.float64
        assert abs(single[0] - batched[position]) < 1e-5

    generator = np.random.default_rng(3)
    for row in (int(index[10]), int(index[200])):
        perturbed = data.features.copy()
        perturbed[row + 1:] = generator.normal(0, 25, perturbed[row + 1:].shape)
        before = adapter.predict_value(data.features, np.array([row]))
        after = adapter.predict_value(perturbed, np.array([row]))
        assert after[0] == pytest.approx(before[0], abs=1e-6)
        rows = np.array([row - 5, row - 1, row])
        assert np.allclose(adapter.predict_value(perturbed, rows),
                           adapter.predict_value(data.features, rows), atol=1e-5)
        own_bar = data.features.copy()
        own_bar[row] = generator.normal(0, 3, own_bar[row].shape)
        changed = adapter.predict_value(own_bar, np.array([row]))
        assert changed[0] != pytest.approx(before[0], abs=1e-9)


@pytest.mark.parametrize(("family", "device"), FAMILY_DEVICES, ids=_identifier)
def test_regression_save_load_round_trip(family, device, regression_dataset, tmp_path):
    import json

    data = regression_dataset
    adapter, _, _ = fitted_regression(family, device, data)
    adapter.save(str(tmp_path))
    metadata = json.loads((tmp_path / "model.json").read_text(encoding="utf-8"))
    assert metadata["task"] == "regression"
    assert metadata["family"] == family
    assert not list(tmp_path.glob("*.tmp*"))
    reloaded = load_adapter(str(tmp_path), device="cpu")
    assert reloaded.task == "regression"
    index = data.test_index[:50]
    assert np.allclose(adapter.predict_value(data.features, index),
                       reloaded.predict_value(data.features, index), atol=1e-4)
    if family not in NEURAL_FAMILIES:
        assert reloaded.target_clip == pytest.approx(adapter.target_clip)


def test_classification_model_json_records_its_task(dataset, tmp_path):
    import json

    adapter, _, _ = fitted("xgboost", "cpu", dataset)
    adapter.save(str(tmp_path))
    metadata = json.loads((tmp_path / "model.json").read_text(encoding="utf-8"))
    assert metadata["task"] == "classification"
    # a model.json from before the price model has no task: still a direction model
    del metadata["task"]
    (tmp_path / "model.json").write_text(json.dumps(metadata), encoding="utf-8")
    assert load_adapter(str(tmp_path)).task == "classification"


@pytest.mark.parametrize("family", MODEL_FAMILIES)
def test_regression_stop_requested_propagates(family, regression_dataset):
    data = regression_dataset
    adapter = build_adapter(family, TINY_PARAMETERS[family], "cpu", seed=5, task="regression")
    # Ridge is one closed-form solve with a single checkpoint in front of it.
    stop_after = 1 if family == "logistic_regression" else 3
    reporter = FakeReporter(stop_after=stop_after)
    with pytest.raises(StopRequested):
        adapter.fit(data.features, data.labels, data.train_index, data.validation_index,
                    data.timestamps, reporter)
    assert reporter.checkpoints == stop_after
    assert len(reporter.batches) <= stop_after - 1


_CLIP_PARAMETERS = {
    "logistic_regression": {},
    "random_forest": {"tree_count": 30, "max_depth": 6},
    # early stopping off: the fitted model must not depend on validation at all
    "xgboost": {"boosting_rounds": 60, "early_stopping_rounds": 0, "max_depth": 4,
                "learning_rate": 0.1},
    "lightgbm": {"boosting_rounds": 60, "early_stopping_rounds": 0, "leaf_count": 15,
                 "learning_rate": 0.1},
}


@pytest.mark.parametrize("family", tuple(_CLIP_PARAMETERS))
def test_regression_clip_uses_training_percentiles_only(family, regression_dataset):
    data = regression_dataset

    def fit(labels):
        adapter = build_adapter(family, _CLIP_PARAMETERS[family], "cpu", seed=11,
                                task="regression")
        adapter.fit(data.features, labels, data.train_index, data.validation_index,
                    data.timestamps, FakeReporter())
        return adapter, adapter.predict_value(data.features, data.test_index)

    reference, reference_prediction = fit(data.labels)
    train_outliers = data.train_index[data.outlier[data.train_index]]
    assert train_outliers.size >= 5

    # 1. Training outliers 100x larger: they sit beyond the 1st / 99th
    #    percentiles either way, so they clip to the same bounds and the fitted
    #    model is unchanged; the clip is what tames them.
    louder = data.labels.copy()
    louder[train_outliers] *= 100.0
    adapter, prediction = fit(louder)
    assert adapter.target_clip == reference.target_clip
    assert np.allclose(prediction, reference_prediction, atol=1e-9)

    # 2. Huge values in VALIDATION rows move neither the bounds nor the model.
    huge_validation = data.labels.copy()
    huge_validation[data.validation_index[::7]] = 1e6
    adapter, prediction = fit(huge_validation)
    assert adapter.target_clip == reference.target_clip
    assert np.allclose(prediction, reference_prediction, atol=1e-9)

    # 3. The bounds are the training rows' own 1st / 99th percentiles, inside
    #    the clean target's range (the +-40 outliers did not leak into them).
    low, high = np.percentile(data.labels[data.train_index].astype(np.float64), [1, 99])
    assert reference.target_clip == pytest.approx((low, high))
    assert high - low < 10.0


def test_each_task_refuses_the_other_tasks_prediction(dataset, regression_dataset):
    for family in ("logistic_regression", "random_forest", "xgboost", "lightgbm",
                   "multilayer_perceptron"):
        classifier, _, _ = fitted(family, "cpu", dataset)
        assert classifier.task == "classification"
        with pytest.raises(TypeError, match="predict_probability"):
            classifier.predict_value(dataset.features, dataset.test_index[:3])
        regressor = build_adapter(family, TINY_PARAMETERS[family], "cpu", 0, task="regression")
        with pytest.raises(TypeError, match="predict_value"):
            regressor.predict_probability(regression_dataset.features,
                                          regression_dataset.test_index[:3])
        with pytest.raises(RuntimeError, match="before fit"):
            regressor.predict_value(regression_dataset.features,
                                    regression_dataset.test_index[:3])
    with pytest.raises(ValueError, match="regression"):
        build_adapter("xgboost", {}, "cpu", 0, task="forecast")


def test_regression_refuses_a_constant_target(regression_dataset):
    data = regression_dataset
    labels = data.labels.copy()
    labels[np.isfinite(labels)] = 0.25
    for family in ("logistic_regression", "lightgbm", "multilayer_perceptron"):
        adapter = build_adapter(family, TINY_PARAMETERS[family], "cpu", 0, task="regression")
        with pytest.raises(ValueError, match="constant"):
            adapter.fit(data.features, labels, data.train_index, data.validation_index,
                        data.timestamps, FakeReporter())


def test_regression_scores_huber_loss_and_clip():
    from cycle.models import clip_training_target, huber_loss, regression_scores

    scores = regression_scores(np.array([1.0, -2.0, 0.0, 3.0]), np.array([2.0, -1.0, 5.0, -1.0]))
    assert scores["mean_absolute_error"] == pytest.approx((1 + 1 + 5 + 4) / 4)
    assert scores["accuracy"] == pytest.approx(2 / 3)  # the zero prediction is excluded
    assert scores["f1_score"] is None
    prediction = torch.tensor([0.0, 0.5, 3.0, -4.0])
    target = torch.tensor([0.2, -0.5, 0.0, 0.0])
    expected = float(torch.nn.HuberLoss(delta=1.0)(prediction, target))
    assert huber_loss(prediction.numpy(), target.numpy()) == pytest.approx(expected, rel=1e-6)
    clipped, low, high = clip_training_target(np.arange(101, dtype=np.float64))
    assert (low, high) == (1.0, 99.0)
    assert clipped.min() == 1.0 and clipped.max() == 99.0


# ─── the registry dispatch (models.build_adapter / load_adapter) ───────────

LEGACY_RULES = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "cycle_legacy_parameter_rules.json").read_text(encoding="utf-8")
)


class RecordingTrial:
    """A stand-in Optuna trial that records every suggestion and answers
    deterministically (the recorder the legacy fixture was made with)."""

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


def test_legacy_families_are_the_registry_legacy_keys():
    assert set(LEGACY_FAMILIES) == set(LEGACY_RULES["families"])
    assert set(LEGACY_FAMILIES) == {key for key in REGISTRY_KEYS if catalog.is_legacy(key)}


@pytest.mark.parametrize("family", sorted(LEGACY_RULES["families"]))
def test_legacy_defaults_validation_and_search_are_unchanged(family):
    """Against `fixtures/cycle_legacy_parameter_rules.json`, recorded from
    models.py before the registry existed."""
    rules = LEGACY_RULES["families"][family]
    defaults = default_parameters(family)
    assert defaults == rules["defaults"]
    assert {key: type(value).__name__ for key, value in defaults.items()} == rules["defaultTypes"]
    for probe, expected in rules["validation"].items():
        key, _, text = probe.partition("=")
        value = ast.literal_eval(text)
        if "error" in expected:
            with pytest.raises(Exception) as refused:
                resolve_parameters(family, {key: value})
            assert f"{type(refused.value).__name__}: {refused.value}" == expected["error"], probe
        else:
            resolved = resolve_parameters(family, {key: value})[key]
            assert resolved == expected["value"] and type(resolved).__name__ == expected["type"], probe
    trial = RecordingTrial()
    assert suggest_parameters(trial, family, defaults) == rules["optunaResult"]
    assert trial.calls == rules["optunaCalls"]


def test_the_dispatch_table_names_one_class_per_non_legacy_adapter():
    assert ADAPTER_CLASSES == {
        "scikit_learn": "cycle.sklearn_adapter:SklearnEstimatorAdapter",
        "catboost": "cycle.catboost_adapter:CatBoostAdapter",
        "statsmodels": "cycle.statsmodels_adapter:ProbitAdapter",
        "neural": "cycle.networks:NeuralAdapter",
        # one module per catalog spec the Cycle grew to cover (2026-09-27)
        "tree_boosted_neural_embedding": "cycle.adapters_extra.tree_boosted_neural_embedding:TreeBoostedNeuralEmbeddingAdapter",
        "attention_weighted_forecast_stack": "cycle.adapters_extra.attention_weighted_forecast_stack:AttentionWeightedForecastStackAdapter",
        "bayesian_neural_hybrid": "cycle.adapters_extra.bayesian_neural_hybrid:BayesianNeuralHybridAdapter",
    }
    adapters = {catalog.entry(key)["adapter"] for key in REGISTRY_KEYS}
    assert adapters - {"legacy"} <= set(ADAPTER_CLASSES)


def test_building_a_legacy_family_imports_no_new_adapter_module():
    import os
    import subprocess
    import sys

    source_root = Path(__file__).resolve().parents[1] / "src" / "ml"
    script = (
        "import sys\n"
        "from cycle.models import build_adapter\n"
        "for family in ('logistic_regression', 'random_forest', 'xgboost', 'lightgbm'):\n"
        "    build_adapter(family, {}, 'cpu', 0)\n"
        "    build_adapter(family, {}, 'cpu', 0, task='regression')\n"
        "watched = ('cycle.sklearn_adapter', 'cycle.catboost_adapter', 'cycle.statsmodels_adapter',\n"
        "           'cycle.networks', 'catboost', 'statsmodels', 'torch')\n"
        "print(sorted(name for name in watched if name in sys.modules))\n"
    )
    environment = {**os.environ, "PYTHONPATH": str(source_root)}
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True,
                            env=environment, timeout=120)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().splitlines()[-1] == "[]"


def non_legacy_key(adapter: str, *, price: bool | None = None) -> str:
    for key in REGISTRY_KEYS:
        entry = catalog.entry(key)
        if entry["adapter"] == adapter and (price is None or (entry["price"] is not None) == price):
            return key
    pytest.skip(f"the registry has no {adapter} model with price={price}")


class RegistryAdapter:
    """A class with the registry constructor, recording what it was given."""

    def __init__(self, key, entry, parameters, device, seed, task="classification"):
        self.received = (key, entry, parameters, device, seed, task)

    @classmethod
    def load(cls, directory, metadata):
        return ("loaded", directory, metadata)


class DeviceLoadingAdapter(RegistryAdapter):
    @classmethod
    def load(cls, directory, device="cpu"):
        return ("loaded", directory, device)


class FamilyAdapter:
    """The legacy constructor (family, parameters, device, seed, task)."""

    def __init__(self, family, parameters, device, seed, task="classification"):
        raise AssertionError("must not be constructed")


@pytest.fixture
def fake_adapters(monkeypatch):
    import sys
    import types

    module = types.ModuleType("fake_cycle_adapters")
    module.RegistryAdapter = RegistryAdapter
    module.DeviceLoadingAdapter = DeviceLoadingAdapter
    module.FamilyAdapter = FamilyAdapter
    monkeypatch.setitem(sys.modules, "fake_cycle_adapters", module)

    def point(adapter: str, attribute: str) -> None:
        monkeypatch.setitem(ADAPTER_CLASSES, adapter, f"fake_cycle_adapters:{attribute}")

    return point


def test_a_non_legacy_key_is_built_with_the_registry_constructor(fake_adapters):
    key = non_legacy_key("scikit_learn", price=True)
    fake_adapters("scikit_learn", "RegistryAdapter")
    for task in ("classification", "regression"):
        adapter = build_adapter(key, {}, "cpu", 7.0, task=task)
        assert isinstance(adapter, RegistryAdapter)
        received_key, entry, parameters, device, seed, received_task = adapter.received
        assert (received_key, device, seed, received_task) == (key, "cpu", 7, task)
        assert type(seed) is int
        assert entry is catalog.entry(key)
        assert parameters == catalog.defaults(key) == default_parameters(key)
        assert tuple(parameters) == FAMILY_PARAMETER_KEYS[key]


def test_a_non_legacy_key_resolves_through_the_registry(fake_adapters):
    key = non_legacy_key("scikit_learn", price=True)
    fake_adapters("scikit_learn", "RegistryAdapter")
    bounded = [(n, s) for n, s in catalog.entry(key)["parameters"].items()
               if s["type"] in ("int", "float") and "max" in s]
    for name, spec in bounded:
        with pytest.raises(ValueError, match=name):
            build_adapter(key, {name: spec["max"] + 1}, "cpu", 0)
    assert resolve_parameters(key, {"unrelated": 1}) == catalog.resolve_parameters(key, {})


def test_a_missing_adapter_module_fails_naming_the_model(monkeypatch):
    key = non_legacy_key("scikit_learn", price=True)
    monkeypatch.setitem(ADAPTER_CLASSES, "scikit_learn", "cycle.no_such_adapter_module:Missing")
    with pytest.raises(NotImplementedError, match="does not exist yet") as refused:
        build_adapter(key, {}, "cpu", 0)
    assert catalog.display_name(key) in str(refused.value) and key in str(refused.value)
    monkeypatch.setitem(ADAPTER_CLASSES, "scikit_learn", "cycle.adapter:NoSuchClass")
    with pytest.raises(NotImplementedError, match="does not exist yet"):
        build_adapter(key, {}, "cpu", 0)


def test_a_class_without_the_registry_constructor_fails_before_construction(fake_adapters):
    key = non_legacy_key("neural")
    fake_adapters("neural", "FamilyAdapter")
    with pytest.raises(NotImplementedError, match="registry constructor"):
        build_adapter(key, {}, "cpu", 0)


def test_new_neural_keys_follow_what_networks_accepts():
    import inspect

    from cycle import networks

    key = non_legacy_key("neural")
    entry = catalog.entry(key)
    try:
        inspect.signature(networks.NeuralAdapter).bind(key, entry, catalog.defaults(key), "cpu", 0,
                                                       task="classification")
    except TypeError:
        with pytest.raises(NotImplementedError, match="registry constructor"):
            build_adapter(key, {}, "cpu", 0)
    else:
        assert build_adapter(key, {}, "cpu", 0).minimum_history() >= 1
    # the legacy neural families keep the family constructor
    assert build_adapter("lstm", {"sequence_length": 12}, "cpu", 0).minimum_history() == 12


def test_a_model_without_a_price_model_gets_no_price_model(monkeypatch, tmp_path):
    key = next((k for k in REGISTRY_KEYS if not catalog.is_legacy(k) and not catalog.has_price_model(k)), None)
    if key is None:
        pytest.skip("every registry model has a price model")
    # the price slot never imports the model's adapter module
    monkeypatch.setitem(ADAPTER_CLASSES, catalog.entry(key)["adapter"], "cycle.no_such_adapter_module:Missing")
    adapter = build_adapter(key, {}, "cpu", 0, task="regression")
    assert isinstance(adapter, NoPriceModel)
    assert adapter.available is False and adapter.task == "regression" and adapter.key == key
    assert adapter.minimum_history() == 1
    assert adapter.fit(None, None, None, None, None, FakeReporter()) is None
    with pytest.raises(RuntimeError, match="has no price model") as refused:
        adapter.predict_value(np.zeros((2, 3), dtype=np.float32), np.array([1]))
    assert key in str(refused.value)
    with pytest.raises(RuntimeError, match="has no price model"):
        adapter.predict_probability(np.zeros((2, 3), dtype=np.float32), np.array([1]))
    assert adapter.save(str(tmp_path)) == "" and list(tmp_path.iterdir()) == []


def test_non_legacy_search_is_the_registry_search():
    key = next((k for k in REGISTRY_KEYS
                if not catalog.is_legacy(k) and any("search" in s for s in catalog.entry(k)["parameters"].values())),
               None)
    if key is None:
        pytest.skip("no registry model declares a search space")
    through_models, through_catalog = RecordingTrial(), RecordingTrial()
    tuned = suggest_parameters(through_models, key, default_parameters(key))
    assert tuned == catalog.suggest_parameters(through_catalog, key, catalog.defaults(key))
    assert through_models.calls == through_catalog.calls and through_models.calls


def test_load_adapter_reads_the_adapter_and_key(tmp_path, fake_adapters):
    key = non_legacy_key("scikit_learn", price=True)
    fake_adapters("scikit_learn", "RegistryAdapter")
    metadata = {"adapter": "scikit_learn", "key": key, "task": "classification"}
    (tmp_path / "model.json").write_text(json.dumps(metadata), encoding="utf-8")
    assert load_adapter(str(tmp_path), device="cuda") == ("loaded", str(tmp_path), metadata)
    fake_adapters("scikit_learn", "DeviceLoadingAdapter")
    assert load_adapter(str(tmp_path), device="cuda") == ("loaded", str(tmp_path), "cuda")


def test_saved_legacy_models_name_their_key_and_old_files_still_load(tmp_path, dataset):
    adapter = build_adapter("logistic_regression", TINY_PARAMETERS["logistic_regression"], "cpu", 0)
    adapter.fit(dataset.features, dataset.labels, dataset.train_index, dataset.validation_index,
                dataset.timestamps, FakeReporter())
    adapter.save(str(tmp_path))
    path = tmp_path / "model.json"
    metadata = json.loads(path.read_text(encoding="utf-8"))
    assert (metadata["key"], metadata["adapter"], metadata["family"]) == (
        "logistic_regression", "legacy", "logistic_regression")
    expected = adapter.predict_probability(dataset.features, dataset.test_index[:20])
    del metadata["key"], metadata["adapter"]            # a file written before the registry
    path.write_text(json.dumps(metadata), encoding="utf-8")
    reloaded = load_adapter(str(tmp_path))
    assert np.array_equal(reloaded.predict_probability(dataset.features, dataset.test_index[:20]), expected)
