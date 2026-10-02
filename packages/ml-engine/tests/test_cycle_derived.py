"""Direction from price (packages/ml-engine/src/cycle/derived.py): the two-parameter logistic
curve from a price model's forecast to P(up), and the adapter that wraps a
price model with it. The engine-level checks (a from_price key on the
synthetic market, tuning through the same factory) live in
tests/test_cycle_engine.py."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from cycle.adapter import EpochReport
from cycle.derived import (
    DerivedDirectionAdapter,
    apply_logistic_curve,
    fit_logistic_curve,
    price_rows,
)


def negative_log_likelihood(curve: tuple[float, float], score: np.ndarray, label: np.ndarray) -> float:
    eta = curve[0] * score + curve[1]
    return float(np.sum(np.logaddexp(0.0, eta) - label * eta))


def test_the_curve_recovers_a_known_logistic_relation():
    generator = np.random.default_rng(3)
    score = generator.normal(0.0, 2.0, 40_000)
    label = (generator.random(score.size) < 1.0 / (1.0 + np.exp(-(1.3 * score - 0.4)))).astype(float)
    slope, intercept = fit_logistic_curve(score, label)
    assert slope == pytest.approx(1.3, abs=0.05) and intercept == pytest.approx(-0.4, abs=0.05)


# scikit-learn 1.8 warns that C=inf means "no penalty" while it moves off the `penalty` keyword
@pytest.mark.filterwarnings("ignore:Setting penalty=None:UserWarning")
def test_the_curve_is_the_maximum_likelihood_fit():
    generator = np.random.default_rng(11)
    score = generator.normal(0.5, 0.3, 500)
    label = (generator.random(score.size) < 0.5 + 0.4 * np.tanh(score - 0.5)).astype(float)
    curve = fit_logistic_curve(score, label)
    best = negative_log_likelihood(curve, score, label)
    for step in ((1e-3, 0.0), (-1e-3, 0.0), (0.0, 1e-3), (0.0, -1e-3)):
        assert negative_log_likelihood((curve[0] + step[0], curve[1] + step[1]), score, label) > best - 1e-9
    # scikit-learn's unpenalised logistic regression agrees (the slope penalty is negligible here)
    from sklearn.linear_model import LogisticRegression

    reference = LogisticRegression(C=np.inf, tol=1e-12, max_iter=10_000).fit(score[:, None], label)
    assert curve[0] == pytest.approx(float(reference.coef_[0, 0]), rel=1e-3)
    assert curve[1] == pytest.approx(float(reference.intercept_[0]), rel=1e-3, abs=1e-4)


def test_missing_values_are_ignored():
    score = np.array([np.nan, -2.0, -1.0, 0.5, 1.0, 2.0, 3.0, np.inf, 0.0])
    label = np.array([1.0, 0.0, 1.0, 0.0, 1.0, 1.0, np.nan, 0.0, 0.0])
    keep = np.isfinite(score) & np.isfinite(label)
    assert fit_logistic_curve(score, label) == pytest.approx(fit_logistic_curve(score[keep], label[keep]))


@pytest.mark.parametrize("label_value", [0.0, 1.0])
def test_one_class_missing_gives_a_flat_confident_curve(label_value):
    score = np.linspace(-1.0, 1.0, 9)
    slope, intercept = fit_logistic_curve(score, np.full(9, label_value))
    assert slope == 0.0
    smoothed = (9 * label_value + 0.5) / 10
    assert intercept == pytest.approx(math.log(smoothed / (1 - smoothed)))
    assert math.isfinite(intercept)


def test_constant_scores_give_the_base_rate():
    slope, intercept = fit_logistic_curve(np.full(8, 0.7), np.array([1, 1, 1, 0, 0, 1, 1, 0], dtype=float))
    assert slope == 0.0 and intercept == pytest.approx(math.log(5 / 3))


def test_no_usable_rows_is_a_coin_flip():
    assert fit_logistic_curve(np.array([np.nan, 1.0]), np.array([1.0, np.nan])) == (0.0, 0.0)
    assert fit_logistic_curve(np.empty(0), np.empty(0)) == (0.0, 0.0)


def test_perfect_separation_still_gives_a_finite_curve():
    score = np.array([-3.0, -2.0, -1.0, 1.0, 2.0, 3.0])
    slope, intercept = fit_logistic_curve(score, (score > 0).astype(float))
    assert math.isfinite(slope) and math.isfinite(intercept) and slope > 0
    probability = apply_logistic_curve((slope, intercept), score)
    assert np.all(probability[score > 0] > 0.5) and np.all(probability[score < 0] < 0.5)


def test_the_curve_keeps_a_missing_score_missing():
    out = apply_logistic_curve((2.0, -1.0), np.array([0.5, np.nan, 1e9, -1e9]))
    assert out[0] == pytest.approx(0.5) and np.isnan(out[1]) and out[2] == 1.0 and 0.0 <= out[3] < 1e-200


def test_price_rows_keep_the_rows_with_a_known_target():
    target = np.array([np.nan, 0.1, -0.2, np.nan, 0.0], dtype=np.float32)
    np.testing.assert_array_equal(price_rows(np.array([0, 1, 2, 3, 4]), target), [1, 2, 4])


# ─── the adapter ────────────────────────────────────────────────────────────


class Reporter:
    step_unit = "epoch"

    def __init__(self) -> None:
        self.lines: list[str] = []
        self.checkpoints = 0

    def epoch_started(self, epoch, epoch_count): ...

    def batch(self, report): ...

    def validating(self, epoch, epoch_count): ...

    def epoch_finished(self, report: EpochReport): ...

    def checkpoint(self) -> None:
        self.checkpoints += 1

    def log(self, message: str, level: str = "info") -> None:
        self.lines.append(message)


class LinearPriceModel:
    """Least squares on the first feature column; records what it was asked."""

    family = "planted_linear"
    task = "regression"
    step_unit = "single_fit"

    def __init__(self) -> None:
        self.weights: np.ndarray | None = None
        self.fitted_on: tuple[np.ndarray, np.ndarray] | None = None
        self.asked: list[np.ndarray] = []
        self.parameters = {"alpha": 1.0}

    def minimum_history(self) -> int:
        return 1

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        self.fitted_on = (np.array(train_index), np.array(validation_index))
        design = np.column_stack([np.ones(train_index.size), features[train_index, 0]])
        self.weights = np.linalg.lstsq(design, labels[train_index].astype(np.float64), rcond=None)[0]
        reporter.checkpoint()

    def predict_value(self, features, index):
        index = np.asarray(index, dtype=np.int64)
        self.asked.append(index)
        return self.weights[0] + self.weights[1] * features[index, 0].astype(np.float64)

    def save(self, directory: str) -> str:
        path = Path(directory) / "weights.json"
        path.write_text(json.dumps(self.weights.tolist()), encoding="utf-8")
        return str(path)

    @classmethod
    def load(cls, directory: str, device: str = "cpu") -> LinearPriceModel:
        model = cls()
        model.weights = np.array(json.loads((Path(directory) / "weights.json").read_text(encoding="utf-8")))
        return model


def planted(count: int = 1200, seed: int = 7):
    generator = np.random.default_rng(seed)
    signal = generator.standard_normal(count)
    target = (0.8 * signal + generator.normal(0, 0.6, count)).astype(np.float32)
    target[[5, 17, 900]] = np.nan                       # moves the data never resolved
    labels = np.where(target > 0, 1.0, 0.0).astype(np.float32)
    labels[np.abs(target) < 0.05] = np.nan              # inside the threshold
    labels[np.isnan(target)] = np.nan
    features = np.column_stack([signal, generator.standard_normal(count)]).astype(np.float32)
    return features, labels, target


def test_the_adapter_fits_the_price_model_then_the_curve_on_validation_only():
    features, labels, target = planted()
    train = np.arange(0, 800)[np.isfinite(labels[:800])]
    validation = np.arange(810, 1000)[np.isfinite(labels[810:1000])]
    price = LinearPriceModel()
    adapter = DerivedDirectionAdapter(price, price_target=target, key="ridge_regression")
    reporter = Reporter()
    adapter.fit(features, labels, train, validation, np.arange(features.shape[0]), reporter)
    # without explicit price rows: the direction rows whose price target is known
    np.testing.assert_array_equal(price.fitted_on[0], train)
    np.testing.assert_array_equal(price.fitted_on[1], validation)
    # the curve saw the validation rows, and only them
    (asked,) = price.asked
    np.testing.assert_array_equal(asked, validation)
    np.testing.assert_array_equal(adapter.curve_rows, validation)
    scores = price.weights[0] + price.weights[1] * features[validation, 0]
    assert adapter.logistic_curve == pytest.approx(fit_logistic_curve(scores, labels[validation]))
    assert adapter.logistic_curve[0] > 0
    assert reporter.checkpoints >= 2 and any(line.startswith("direction from the price model: P(up)") for line in reporter.lines)
    test = np.arange(1000, 1200)
    probability = adapter.predict_probability(features, test)
    expected = 1.0 / (1.0 + np.exp(-(adapter.logistic_curve[0] * adapter.predict_value(features, test) + adapter.logistic_curve[1])))
    np.testing.assert_allclose(probability, expected, rtol=1e-12)
    assert np.all((probability >= 0) & (probability <= 1))
    up = labels[test] == 1
    assert probability[up].mean() > probability[labels[test] == 0].mean() + 0.2
    assert adapter.minimum_history() == 1 and adapter.task == "classification" and adapter.step_unit == "single_fit"
    assert adapter.parameters == {"alpha": 1.0} and adapter.family == "ridge_regression"


def test_explicit_price_rows_and_target_win():
    features, labels, target = planted()
    other_target = target * 2
    price_train, price_validation = np.arange(0, 700), np.arange(720, 900)
    price_train = price_train[np.isfinite(other_target[price_train])]
    price_validation = price_validation[np.isfinite(other_target[price_validation])]
    validation = np.arange(720, 900)[np.isfinite(labels[720:900])]
    price = LinearPriceModel()
    adapter = DerivedDirectionAdapter(price, price_target=target)
    adapter.fit(features, labels, np.arange(0, 700)[np.isfinite(labels[:700])], validation, None, Reporter(),
                price_target=other_target, price_train_index=price_train, price_validation_index=price_validation)
    np.testing.assert_array_equal(price.fitted_on[0], price_train)
    np.testing.assert_array_equal(price.fitted_on[1], price_validation)
    np.testing.assert_array_equal(price.asked[0], validation)


def test_a_missing_price_target_is_an_error_not_a_guess():
    features, labels, _ = planted()
    adapter = DerivedDirectionAdapter(LinearPriceModel())
    with pytest.raises(ValueError, match="price target"):
        adapter.fit(features, labels, np.arange(10), np.arange(20, 30), None, Reporter())
    with pytest.raises(RuntimeError, match="before fit"):
        adapter.predict_probability(features, np.arange(3))


def test_save_and_load_round_trip(tmp_path):
    features, labels, target = planted()
    train = np.arange(0, 800)[np.isfinite(labels[:800])]
    validation = np.arange(810, 1000)[np.isfinite(labels[810:1000])]
    adapter = DerivedDirectionAdapter(LinearPriceModel(), price_target=target, key="lasso_regression")
    adapter.fit(features, labels, train, validation, None, Reporter())
    path = adapter.save(str(tmp_path))
    assert Path(path) == tmp_path / "model.json"
    assert adapter.price_model_path == str(tmp_path / "price_model" / "weights.json")
    metadata = json.loads(Path(path).read_text(encoding="utf-8"))
    assert metadata["adapter"] == "derived" and metadata["key"] == "lasso_regression"
    assert metadata["directionMode"] == "from_price" and metadata["task"] == "classification"
    assert metadata["priceModelDirectory"] == "price_model"
    assert metadata["curveValidationBarCount"] == validation.size
    assert (metadata["logisticCurve"]["slope"], metadata["logisticCurve"]["intercept"]) == adapter.logistic_curve
    loaded = DerivedDirectionAdapter.load(str(tmp_path), load_price_adapter=LinearPriceModel.load)
    assert loaded.logistic_curve == adapter.logistic_curve and loaded.key == "lasso_regression"
    rows = np.arange(1000, 1200)
    np.testing.assert_array_equal(loaded.predict_probability(features, rows), adapter.predict_probability(features, rows))
    np.testing.assert_array_equal(loaded.predict_value(features, rows), adapter.predict_value(features, rows))
    assert loaded.price_model_path == adapter.price_model_path
    with pytest.raises(RuntimeError, match="before fit"):
        DerivedDirectionAdapter(LinearPriceModel()).save(str(tmp_path / "unfitted"))


def test_models_load_adapter_reloads_a_direction_from_price_model(tmp_path):
    """The engine saves a from_price fold as adapter "derived"; the generic loader
    (used by the explainer) must send it back to DerivedDirectionAdapter, with
    the price model inside reloading through the same loader."""
    from cycle import models

    features, labels, target = planted()
    train = np.arange(0, 800)[np.isfinite(labels[:800])]
    validation = np.arange(810, 1000)[np.isfinite(labels[810:1000])]
    price = models.build_adapter("logistic_regression", {}, "cpu", 42, task="regression")
    adapter = DerivedDirectionAdapter(price, price_target=target, key="ridge_regression")
    adapter.fit(features, labels, train, validation, None, Reporter())
    adapter.save(str(tmp_path))
    loaded = models.load_adapter(str(tmp_path))
    assert isinstance(loaded, DerivedDirectionAdapter) and loaded.key == "ridge_regression"
    rows = np.arange(1000, 1200)
    np.testing.assert_array_equal(loaded.predict_probability(features, rows), adapter.predict_probability(features, rows))
    np.testing.assert_array_equal(loaded.predict_value(features, rows), adapter.predict_value(features, rows))
