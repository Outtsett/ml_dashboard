""""Inside the model" for linear models (``explainKind == "linear"``).

A linear model's raw output is its intercept plus one weight times one input
per feature; the link turns that sum into the reported output. Every number
comes from the fitted object the engine saved:

    model                                   weights and intercept             raw (asked of the model)
    legacy logistic regression (direction)  ``.coefficients``, ``.intercept``  its own margin formula
    legacy ridge (its price model)          ``.coefficients``, ``.intercept``  its own linear formula
    scikit-learn linear models              ``estimator.coef_`` / ``intercept_`` ``decision_function`` (classifier)
      (SGD, ridge, lasso, elastic net, LARS,                                      or ``predict`` (regressor)
      Bayesian ridge, linear, quantile)
    probit (statsmodels)                    ``result.params`` (constant first)  design @ params

The inputs are in the units the weights multiply: the core's
``context.model_inputs`` runs the features through the adapter's own scaler
(the legacy models' training mean and deviation, or the fitted
StandardScaler), and ``inputs.scaled`` says so.

Links (``common.link_for``): logistic (logistic regression, SGD), probit,
logistic_curve (direction from price: the raw output is the inner price
model's forecast and the curve is the adapter's validation curve, which the
core puts in ``structure.logisticCurve``), identity (every price model).

``link_output(link, raw, context)`` is the link as a function; the tree
explainer's G2 check uses it too.
"""

from __future__ import annotations

import math

import numpy as np

from . import NotExplained

G2_TOLERANCE = 1e-6


# ─── the link ──────────────────────────────────────────────────────────────


def _logistic(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exponential = math.exp(value)
    return exponential / (1.0 + exponential)


def link_output(link: str, raw: float, context) -> float | None:
    """The reported output for a raw value through ``link``: P(up) for a
    direction model, target units for a price model; None for links that are
    not a function of one raw number (vote, calibration map, posterior needs
    none of this module)."""
    raw = float(raw)
    if link in ("logistic", "posterior"):
        return _logistic(raw)
    if link in ("identity", "mean_probability", "vote"):
        return raw
    if link == "probit":
        from scipy.stats import norm

        return float(norm.cdf(raw))
    if link == "logistic_curve":
        curve = context.logistic_curve()
        if curve is None:
            return None
        return _logistic(curve[0] * raw + curve[1])
    return None


def reported_output(bar: dict) -> float:
    """What the link must reproduce: P(up) (direction) or target units (price)."""
    output = bar["output"]
    value = output["targetUnits"] if bar["role"] == "price" else output["probabilityUp"]
    return float(bar["engineReload"] if value is None else value)


# ─── the fitted weights ────────────────────────────────────────────────────


class LinearModel:
    """Weights, intercept and the model's own raw output for model-input rows."""

    def __init__(self, source: str, coefficients: np.ndarray, intercept: float, raw_function) -> None:
        self.source = source
        self.coefficients = np.asarray(coefficients, dtype=np.float64).reshape(-1)
        self.intercept = float(intercept)
        self._raw = raw_function

    def raw(self, inputs: np.ndarray) -> np.ndarray:
        """The raw output for rows of model inputs (already through the adapter's scaler)."""
        return np.asarray(self._raw(np.asarray(inputs, dtype=np.float64)), dtype=np.float64).reshape(-1)


def _legacy(adapter) -> LinearModel:
    coefficients = np.asarray(adapter.coefficients, dtype=np.float64)
    intercept = float(adapter.intercept)
    # the legacy adapters' own formula (models.LogisticRegressionAdapter._score's margin,
    # RidgeRegressionAdapter._linear), on the rows standardised with their mean and scale
    return LinearModel(f"{type(adapter).__name__}", coefficients, intercept,
                       lambda matrix: matrix @ coefficients + intercept)


def _scikit_learn(adapter) -> LinearModel:
    estimator = adapter.estimator
    if not hasattr(estimator, "coef_") or not hasattr(estimator, "intercept_"):
        raise NotExplained(f"{type(estimator).__name__} has no linear weights (coef_ / intercept_)")
    coefficients = np.asarray(estimator.coef_, dtype=np.float64)
    if coefficients.ndim == 2:
        if coefficients.shape[0] != 1:
            raise NotExplained(f"{type(estimator).__name__} has {coefficients.shape[0]} weight rows; one is explained")
        coefficients = coefficients[0]
    intercept = float(np.asarray(estimator.intercept_, dtype=np.float64).reshape(-1)[0]) \
        if np.ndim(estimator.intercept_) else float(estimator.intercept_)
    if adapter.task == "classification":
        if not hasattr(estimator, "decision_function"):
            raise NotExplained(f"{type(estimator).__name__} has no decision function")
        classes = np.asarray(getattr(estimator, "classes_", [0, 1]))
        if classes.size != 2 or int(classes[1]) != 1:
            # decision_function is the score of classes_[1]; the Cycle's up class is 1
            raise NotExplained(f"{type(estimator).__name__}: classes {classes.tolist()} do not end with the up class")
        function = estimator.decision_function
    else:
        function = estimator.predict
    return LinearModel(type(estimator).__name__, coefficients, intercept, function)


def _probit(adapter) -> LinearModel:
    params = np.asarray(adapter.result.params, dtype=np.float64).reshape(-1)
    # the adapter's own formula (statsmodels_adapter.ProbitAdapter.predict_probability): Φ([1, z] @ params)
    return LinearModel("Probit", params[1:], float(params[0]),
                       lambda matrix: np.column_stack([np.ones(matrix.shape[0]), matrix]) @ params)


def linear_model(context) -> LinearModel:
    """The explained adapter's weights (memoised on the context)."""
    cached = context.cache.get("linear_model")
    if cached is not None:
        return cached
    adapter = context.explained_adapter
    name = type(adapter).__name__
    if name in ("LogisticRegressionAdapter", "RidgeRegressionAdapter"):
        model = _legacy(adapter)
    elif name == "SklearnEstimatorAdapter":
        model = _scikit_learn(adapter)
    elif name == "ProbitAdapter":
        model = _probit(adapter)
    else:
        raise NotExplained(f"{name} is not a linear model this explainer knows")
    feature_count = context.features.shape[1]
    if model.coefficients.size != feature_count:
        raise NotExplained(f"{model.source} has {model.coefficients.size} weights for {feature_count} inputs")
    context.cache["linear_model"] = model
    return model


# ─── the dispatch contract ─────────────────────────────────────────────────


def structure_block(context) -> dict:
    model = linear_model(context)
    return {
        "baseValue": model.intercept,
        "linear": {"intercept": model.intercept, "coefficients": model.coefficients},
    }


def _decomposition(context, row: int) -> tuple[np.ndarray, float]:
    """Per-input contributions (weight × model input) and the model's own raw output."""
    model = linear_model(context)
    inputs, _ = context.model_inputs([row])
    contributions = model.coefficients * inputs[0]
    raw = float(model.raw(inputs)[0])
    return contributions, raw


def bar_block(context, row: int) -> dict:
    model = linear_model(context)
    contributions, raw = _decomposition(context, row)
    return {
        "contributions": {"values": contributions, "base": model.intercept},
        "output": {"raw": raw},
    }


def check(context, row: int, bar: dict) -> list[dict]:
    """G2: the link applied to intercept + Σ contributions reproduces the output."""
    block = bar.get("contributions")
    if block is None:
        return [{"gate": "G2", "passed": None, "error": None, "tolerance": G2_TOLERANCE,
                 "detail": "the bar carries no contributions"}]
    total = float(block["base"]) + float(np.sum(np.asarray(block["values"], dtype=np.float64)))
    linked = link_output(bar["link"], total, context)
    expected = reported_output(bar)
    if linked is None:
        return [{"gate": "G2", "passed": None, "error": None, "tolerance": G2_TOLERANCE,
                 "detail": f"the {bar['link']} link has no curve to apply"}]
    error = abs(linked - expected)
    return [{"gate": "G2", "passed": error <= G2_TOLERANCE, "error": error, "tolerance": G2_TOLERANCE,
             "detail": f"{bar['link']}(intercept + sum of {len(block['values'])} contributions = {total!r}) = "
                       f"{linked!r} against {expected!r}; the model's own raw {bar['output']['raw']!r}"}]


__all__ = ["LinearModel", "bar_block", "check", "link_output", "linear_model", "reported_output", "structure_block"]
