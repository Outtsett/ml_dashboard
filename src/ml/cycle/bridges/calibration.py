"""P(up) from a model's own score, calibrated on VALIDATION rows only.

Three maps from a score to a probability, each fitted on the fold's
``validation_index`` (never on training rows: the model has already seen them,
so its scores there are optimistic and a curve fitted on them over-confident):

- ``TemperatureScale`` (Boltzmann): P(up) = sigmoid(q_gap / T), the share a
  softmax over two action values gives the long action. One parameter, the
  inverse temperature 1/T >= 0; a negative fit is clamped to 0 (P(up) = 0.5):
  the sign of the gap is the policy's own and is never flipped by calibration.
- ``ValidationCurve`` (Platt scaling): P(up) = sigmoid(slope * score +
  intercept), ``cycle.derived.fit_logistic_curve`` — the same curve a
  direction-from-price model uses, so a bridge whose registry entry says
  ``logistic_curve_on_validation`` behaves exactly like one.
- ``share(long, short)``: long / (long + short) for non-negative masses
  (visit counts, elite shares, policy probabilities), no fitting.

Every function keeps a missing score missing (NaN in, NaN out) and every
fitted object round-trips through ``to_dict`` / ``from_dict`` (plain floats) so
a saved model reloads to the same probabilities.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from cycle.derived import apply_logistic_curve, fit_logistic_curve

MAXIMUM_STANDARDISED_INVERSE_TEMPERATURE = 50.0
NEWTON_ITERATIONS = 100


def sigmoid(values) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64)
    return 1.0 / (1.0 + np.exp(-np.clip(values, -500.0, 500.0)))


def _usable(score, label) -> tuple[np.ndarray, np.ndarray]:
    score = np.asarray(score, dtype=np.float64).ravel()
    label = np.asarray(label, dtype=np.float64).ravel()
    if score.shape != label.shape:
        raise ValueError(f"score and label differ in length: {score.size} and {label.size}")
    keep = np.isfinite(score) & np.isfinite(label)
    return score[keep], (label[keep] >= 0.5).astype(np.float64)


def boltzmann(value_long, value_short, temperature: float) -> np.ndarray:
    """The softmax share of the long action over {long, short}:
    sigmoid((value_long - value_short) / temperature). An infinite (or
    non-positive) temperature gives 0.5; a NaN value gives NaN."""
    gap = np.asarray(value_long, dtype=np.float64) - np.asarray(value_short, dtype=np.float64)
    if not math.isfinite(temperature) or temperature <= 0:
        out = np.full(gap.shape, 0.5)
    else:
        out = sigmoid(gap / temperature)
    out[~np.isfinite(gap)] = np.nan
    return out


def share(long_mass, short_mass) -> np.ndarray:
    """long / (long + short) for non-negative masses; NaN when both are 0 or either is missing."""
    long_mass = np.asarray(long_mass, dtype=np.float64)
    short_mass = np.asarray(short_mass, dtype=np.float64)
    if np.any(long_mass < 0) or np.any(short_mass < 0):
        raise ValueError("share needs non-negative masses")
    total = long_mass + short_mass
    with np.errstate(invalid="ignore", divide="ignore"):
        out = long_mass / total
    out[~np.isfinite(out)] = np.nan
    return out


@dataclass(frozen=True)
class TemperatureScale:
    """P(up) = sigmoid(inverse_temperature * gap), ``inverse_temperature`` >= 0
    fitted by maximum likelihood on validation rows."""

    inverse_temperature: float
    row_count: int = 0

    @property
    def temperature(self) -> float:
        return math.inf if self.inverse_temperature <= 0 else 1.0 / self.inverse_temperature

    @classmethod
    def fit(cls, gap, label) -> TemperatureScale:
        """Newton's method on the one-parameter logistic likelihood of the
        standardised gap, bounded to [0, MAXIMUM_STANDARDISED_INVERSE_TEMPERATURE]."""
        gap, label = _usable(gap, label)
        count = int(gap.size)
        if count == 0:
            return cls(0.0, 0)
        spread = float(np.sqrt(np.mean(gap ** 2)))
        if not math.isfinite(spread) or spread <= 1e-12:
            return cls(0.0, count)
        z = gap / spread
        weight = 0.0
        for _ in range(NEWTON_ITERATIONS):
            p = sigmoid(weight * z)
            gradient = float(np.sum((p - label) * z))
            curvature = float(np.sum(p * (1.0 - p) * z * z)) + 1e-9
            step = gradient / curvature
            candidate = min(max(weight - step, 0.0), MAXIMUM_STANDARDISED_INVERSE_TEMPERATURE)
            if abs(candidate - weight) < 1e-12:
                weight = candidate
                break
            weight = candidate
        return cls(float(weight / spread), count)

    def apply(self, gap) -> np.ndarray:
        gap = np.asarray(gap, dtype=np.float64)
        out = sigmoid(self.inverse_temperature * gap)
        out[~np.isfinite(gap)] = np.nan
        return out

    def to_dict(self) -> dict:
        return {"inverseTemperature": float(self.inverse_temperature), "rowCount": int(self.row_count)}

    @classmethod
    def from_dict(cls, document: dict) -> TemperatureScale:
        return cls(float(document["inverseTemperature"]), int(document.get("rowCount", 0)))


@dataclass(frozen=True)
class ValidationCurve:
    """P(up) = sigmoid(slope * score + intercept), fitted on validation rows
    (``cycle.derived.fit_logistic_curve``: finite on separated or one-class data)."""

    slope: float
    intercept: float
    row_count: int = 0

    @classmethod
    def fit(cls, score, label) -> ValidationCurve:
        score_used, _ = _usable(score, label)
        slope, intercept = fit_logistic_curve(score, label)
        return cls(float(slope), float(intercept), int(score_used.size))

    def apply(self, score) -> np.ndarray:
        return apply_logistic_curve((self.slope, self.intercept), np.asarray(score, dtype=np.float64))

    def to_dict(self) -> dict:
        return {"slope": float(self.slope), "intercept": float(self.intercept), "rowCount": int(self.row_count)}

    @classmethod
    def from_dict(cls, document: dict) -> ValidationCurve:
        return cls(float(document["slope"]), float(document["intercept"]), int(document.get("rowCount", 0)))


def fit_platt(score, label) -> tuple[float, float]:
    """(slope, intercept) of the Platt curve on validation rows."""
    curve = ValidationCurve.fit(score, label)
    return curve.slope, curve.intercept


def apply_platt(curve: tuple[float, float], score) -> np.ndarray:
    return apply_logistic_curve(curve, np.asarray(score, dtype=np.float64))


def validation_curve(score_function, features: np.ndarray, labels: np.ndarray,
                     validation_index: np.ndarray) -> ValidationCurve:
    """Fit the curve from ``score_function(features, rows)`` on the validation rows only."""
    rows = np.asarray(validation_index, dtype=np.int64)
    scores = np.asarray(score_function(features, rows), dtype=np.float64) if rows.size else np.empty(0)
    return ValidationCurve.fit(scores, np.asarray(labels, dtype=np.float64)[rows])


__all__ = ["TemperatureScale", "ValidationCurve", "apply_platt", "boltzmann", "fit_platt", "share", "sigmoid",
           "validation_curve"]
