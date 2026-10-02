"""Direction from price: P(up) read from a price model's forecast.

Some registry models have no classifier form (ridge, lasso, elastic net, least
angle, Bayesian ridge, linear and quantile regression: ``direction.mode ==
"from_price"`` in ``packages/config/cycle_models/``). For them the fold fits ONE
model, the price model, on the price target (the h-bar move divided by its
causal trailing volatility, ``cycle.labels.price_target``), and turns its
forecast ŷ into a probability with a two-parameter logistic curve

    P(up) = 1 / (1 + exp(-(slope * ŷ + intercept)))

fitted by maximum likelihood on the VALIDATION bars only (forecast against the
up/down label). Training rows never fit the curve: the price model has already
seen them, so its forecasts there are optimistic and would make the curve
over-confident.

``DerivedDirectionAdapter`` wraps the price adapter and is the fold's direction
model; its inner ``price_adapter`` is the fold's price model — fitted once,
never twice. The engine's direction factory returns it for a from_price key,
and tuning builds it through the same factory, so a tuned trial fits and scores
exactly what a fold does.

Saved layout (``save(directory)``, the explainer reads it back):

    <directory>/model.json         {"adapter": "derived", "key", "task", "directionMode",
                                    "logisticCurve": {"slope", "intercept"},
                                    "curveValidationBarCount", "priceModelDirectory", ...}
    <directory>/price_model/…      whatever the price adapter's own ``save`` writes
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import numpy as np

PRICE_MODEL_DIRECTORY = "price_model"
# the curve's slope is lightly penalised (on standardised forecasts) so a
# perfectly separated validation set still gives a finite curve
SLOPE_PENALTY = 1e-3
NEWTON_ITERATIONS = 100
NEWTON_TOLERANCE = 1e-10


def _logistic(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -500.0, 500.0)))


def _logit(p: float) -> float:
    return math.log(p / (1.0 - p))


def fit_logistic_curve(score, label) -> tuple[float, float]:
    """(slope, intercept) of P(up) = 1 / (1 + exp(-(slope * score + intercept))),
    the maximum-likelihood fit of ``label`` (1 up, 0 down) on ``score``.

    Rows where either value is missing are ignored. Always finite:
    - no usable row: (0, 0), a coin flip;
    - one class missing: slope 0 and the intercept of the smoothed base rate
      (k + 0.5) / (n + 1), so the curve is confident but never certain;
    - constant scores: slope 0 and the intercept of the base rate k / n;
    - otherwise Newton's method on standardised scores, with a small penalty
      on the slope so a perfectly separated set still converges.
    """
    score = np.asarray(score, dtype=np.float64).ravel()
    label = np.asarray(label, dtype=np.float64).ravel()
    if score.shape != label.shape:
        raise ValueError(f"score and label differ in length: {score.size} and {label.size}")
    usable = np.isfinite(score) & np.isfinite(label)
    score, label = score[usable], (label[usable] >= 0.5).astype(np.float64)
    count = score.size
    if count == 0:
        return 0.0, 0.0
    ups = float(label.sum())
    if ups == 0.0 or ups == count:
        return 0.0, _logit((ups + 0.5) / (count + 1.0))
    mean = float(score.mean())
    spread = float(score.std())
    if not math.isfinite(spread) or spread <= 1e-12 * max(1.0, abs(mean)):
        return 0.0, _logit(ups / count)
    z = (score - mean) / spread
    design = np.column_stack([np.ones(count), z])
    penalty = np.diag([0.0, SLOPE_PENALTY])
    weights = np.array([_logit(ups / count), 0.0])

    def objective(w: np.ndarray) -> float:
        eta = design @ w
        # -log likelihood, written stably: log(1 + e^eta) - y * eta
        return float(np.sum(np.logaddexp(0.0, eta) - label * eta) + 0.5 * SLOPE_PENALTY * w[1] ** 2)

    current = objective(weights)
    for _ in range(NEWTON_ITERATIONS):
        p = _logistic(design @ weights)
        gradient = design.T @ (p - label) + penalty @ weights
        hessian = (design * (p * (1.0 - p))[:, None]).T @ design + penalty
        try:
            step = np.linalg.solve(hessian, gradient)
        except np.linalg.LinAlgError:
            break
        size = 1.0
        while size > 1e-8:     # step halving keeps every move downhill
            candidate = weights - size * step
            value = objective(candidate)
            if value <= current:
                break
            size /= 2
        else:
            break
        moved = float(np.max(np.abs(candidate - weights)))
        weights, current = candidate, value
        if moved < NEWTON_TOLERANCE:
            break
    intercept_z, slope_z = float(weights[0]), float(weights[1])
    slope = slope_z / spread
    intercept = intercept_z - slope_z * mean / spread
    if not (math.isfinite(slope) and math.isfinite(intercept)):
        return 0.0, _logit(ups / count)
    return slope, intercept


def apply_logistic_curve(curve: tuple[float, float], score: np.ndarray) -> np.ndarray:
    """P(up) for each score; a missing score stays missing (NaN)."""
    slope, intercept = curve
    score = np.asarray(score, dtype=np.float64)
    out = _logistic(slope * score + intercept)
    out[~np.isfinite(score)] = np.nan
    return out


def price_rows(index: np.ndarray, target: np.ndarray) -> np.ndarray:
    """The rows of ``index`` whose price target is known."""
    index = np.asarray(index, dtype=np.int64)
    return index[np.isfinite(np.asarray(target)[index])]


class DerivedDirectionAdapter:
    """The direction model of a from_price key: a fitted price adapter plus the
    logistic curve from its forecast to P(up). Implements ``ModelAdapter``
    (``cycle/adapter.py``) for ``task == "classification"``.

    Attributes the explainer relies on: ``.price_adapter`` (the fitted price
    model, the fold's price model too) and ``.logistic_curve`` ((slope,
    intercept), None before ``fit``)."""

    task = "classification"
    direction_mode = "from_price"

    def __init__(self, price_adapter, *, price_target: np.ndarray | None = None, key: str | None = None) -> None:
        self.price_adapter = price_adapter
        self.price_target = price_target
        self.key = key or getattr(price_adapter, "family", "from_price")
        self.family = self.key
        self.logistic_curve: tuple[float, float] | None = None
        self.curve_rows: np.ndarray = np.empty(0, dtype=np.int64)     # the validation rows the curve was fitted on
        self.price_train_rows: np.ndarray = np.empty(0, dtype=np.int64)
        self.price_validation_rows: np.ndarray = np.empty(0, dtype=np.int64)
        self.price_model_path: str | None = None

    @property
    def step_unit(self) -> str:
        return getattr(self.price_adapter, "step_unit", "single_fit")

    @property
    def parameters(self) -> dict:
        return dict(getattr(self.price_adapter, "parameters", {}) or {})

    def minimum_history(self) -> int:
        return int(self.price_adapter.minimum_history())

    def bind_market(self, view) -> None:
        """Forward the run's ``cycle.market.MarketView`` to the inner price
        model when it takes one (the explainer binds the reloaded wrapper;
        the engine binds the inner model when it builds it)."""
        bind = getattr(self.price_adapter, "bind_market", None)
        if callable(bind):
            bind(view)

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter, *,
            price_target: np.ndarray | None = None, price_train_index: np.ndarray | None = None,
            price_validation_index: np.ndarray | None = None) -> None:
        """Fit the price model on the price target, then the curve on the
        VALIDATION rows (``validation_index``, whose ``labels`` are the up/down
        labels). The engine hands the fold's own price rows and target; without
        them (tuning) the price rows are the direction rows whose price target
        is known."""
        target = price_target if price_target is not None else self.price_target
        if target is None:
            raise ValueError("a direction-from-price model needs the price target (the h-bar move over its volatility)")
        train = np.asarray(price_train_index if price_train_index is not None else price_rows(train_index, target), dtype=np.int64)
        validation = np.asarray(price_validation_index if price_validation_index is not None
                                else price_rows(validation_index, target), dtype=np.int64)
        if train.size == 0 or validation.size == 0:
            raise ValueError(f"too few rows with a known price target to fit the price model "
                             f"({train.size} training, {validation.size} validation)")
        self.price_train_rows, self.price_validation_rows = train, validation
        self.price_adapter.fit(features, target, train, validation, timestamps, reporter)
        reporter.checkpoint()
        curve_rows = np.asarray(validation_index, dtype=np.int64)
        scores = np.asarray(self.price_adapter.predict_value(features, curve_rows), dtype=np.float64) \
            if curve_rows.size else np.empty(0)
        self.logistic_curve = fit_logistic_curve(scores, np.asarray(labels)[curve_rows])
        self.curve_rows = curve_rows
        slope, intercept = self.logistic_curve
        reporter.log(
            f"direction from the price model: P(up) = 1 / (1 + exp(-({slope:.4f} x forecast {intercept:+.4f}))) "
            f"fitted on {curve_rows.size:,} validation bars"
        )

    def predict_value(self, features, index) -> np.ndarray:
        return np.asarray(self.price_adapter.predict_value(features, index), dtype=np.float64)

    def predict_probability(self, features, index) -> np.ndarray:
        if self.logistic_curve is None:
            raise RuntimeError("predict_probability before fit: the logistic curve is not fitted")
        return apply_logistic_curve(self.logistic_curve, self.predict_value(features, index))

    def save(self, directory: str) -> str:
        """Write the price model into ``<directory>/price_model`` and the curve
        into ``<directory>/model.json``; returns the model.json path. The price
        model's own path is kept on ``.price_model_path``."""
        if self.logistic_curve is None:
            raise RuntimeError("save before fit: the logistic curve is not fitted")
        root = Path(directory)
        price_directory = root / PRICE_MODEL_DIRECTORY
        price_directory.mkdir(parents=True, exist_ok=True)
        self.price_model_path = self.price_adapter.save(str(price_directory))
        slope, intercept = self.logistic_curve
        metadata = {
            "adapter": "derived",
            "key": self.key,
            "task": self.task,
            "directionMode": self.direction_mode,
            "logisticCurve": {"slope": slope, "intercept": intercept},
            "curveValidationBarCount": int(self.curve_rows.size),
            "priceModelDirectory": PRICE_MODEL_DIRECTORY,
            "priceModelPath": self.price_model_path,
            "minimum_history": self.minimum_history(),
            "step_unit": self.step_unit,
            "saved_at": datetime.now(timezone.utc).isoformat(),
        }
        path = root / "model.json"
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_text(json.dumps(metadata, indent=2, default=str), encoding="utf-8")
        os.replace(temporary, path)
        return str(path)

    @classmethod
    def load(cls, directory: str, device: str = "cpu",
             load_price_adapter: Callable[[str, str], object] | None = None) -> DerivedDirectionAdapter:
        """Rebuild a saved direction-from-price model. ``load_price_adapter``
        (directory, device) defaults to ``cycle.models.load_adapter``."""
        root = Path(directory)
        metadata = json.loads((root / "model.json").read_text(encoding="utf-8"))
        if metadata.get("adapter") != "derived":
            raise ValueError(f"{root / 'model.json'} is not a direction-from-price model")
        if load_price_adapter is None:
            from cycle.models import load_adapter as load_price_adapter
        inner = load_price_adapter(str(root / metadata.get("priceModelDirectory", PRICE_MODEL_DIRECTORY)), device)
        adapter = cls(inner, key=metadata.get("key"))
        curve = metadata["logisticCurve"]
        adapter.logistic_curve = (float(curve["slope"]), float(curve["intercept"]))
        adapter.price_model_path = metadata.get("priceModelPath")
        return adapter
