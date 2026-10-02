"""Design matrices and targets of the GLM (and Bayesian predictive) bridges.

Everything here is fitted on TRAINING rows only and applied row by row:

- ``Standardiser``: the mean and standard deviation of each feature column
  over the training rows; a column that is constant there (or not finite
  anywhere on them) is dropped, because a GLM with a constant column besides
  its intercept is not identified (``OrderedModel`` refuses one outright).
- ``training_rows``: the training rows whose scaled h-bar move (the price
  target) is known and whose feature row is finite.
- Targets built from the market view at those rows. Each target of row r is
  made of closes r .. r + horizon, which the engine's purge keeps before the
  first validation row (``MarketView.fit_rows``):

      ordinal_grades      K ordered grades, cut at exactly 0 (K/2 below, K/2 above),
                          graded by within-sign training quantiles
      band_classes        0 down / 1 flat / 2 up around a training-quantile band
      bar_counts          (up, down): bars in r+1 .. r+h whose close moved at least
                          one tick up / down from the previous close
      impulse_counts      (up, down): bars in r+1 .. r+h whose one-bar move exceeds
                          ``multiple`` x the row's trailing one-bar scale
                          (move_scale[r] / sqrt(h), known at r)
      horizon_moves       (n, J) the scaled move at J horizons h/J, 2h/J, .., h
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

MINIMUM_STANDARD_DEVIATION = 1e-9


@dataclass
class Standardiser:
    columns: np.ndarray            # int64, the kept feature columns
    mean: np.ndarray               # float64 per kept column
    scale: np.ndarray              # float64 per kept column
    feature_count: int

    @classmethod
    def fit(cls, features: np.ndarray, rows: np.ndarray) -> Standardiser:
        rows = np.asarray(rows, dtype=np.int64)
        if rows.size == 0:
            raise ValueError("no training rows to standardise the features on")
        block = np.asarray(features[rows], dtype=np.float64)
        mean = block.mean(axis=0)
        scale = block.std(axis=0)
        keep = np.isfinite(mean) & np.isfinite(scale) & (scale > MINIMUM_STANDARD_DEVIATION)
        if not keep.any():
            raise ValueError("every feature column is constant over the training rows")
        return cls(np.flatnonzero(keep).astype(np.int64), mean[keep], scale[keep], int(features.shape[1]))

    def transform(self, features: np.ndarray, rows) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        block = np.asarray(features[rows][:, self.columns], dtype=np.float64)
        return (block - self.mean) / self.scale

    def to_arrays(self, prefix: str = "standardiser") -> dict[str, np.ndarray]:
        return {f"{prefix}_columns": self.columns, f"{prefix}_mean": self.mean, f"{prefix}_scale": self.scale,
                f"{prefix}_feature_count": np.array([self.feature_count], dtype=np.int64)}

    @classmethod
    def from_arrays(cls, arrays: dict, prefix: str = "standardiser") -> Standardiser:
        return cls(np.asarray(arrays[f"{prefix}_columns"], dtype=np.int64),
                   np.asarray(arrays[f"{prefix}_mean"], dtype=np.float64),
                   np.asarray(arrays[f"{prefix}_scale"], dtype=np.float64),
                   int(np.asarray(arrays[f"{prefix}_feature_count"])[0]))


def finite_rows(features: np.ndarray, rows) -> np.ndarray:
    rows = np.asarray(rows, dtype=np.int64)
    if rows.size == 0:
        return rows
    return rows[np.all(np.isfinite(features[rows]), axis=1)]


def training_rows(view, features: np.ndarray, train_index) -> np.ndarray:
    """Training rows (never outside ``train_index``) with a known price target and a finite feature row."""
    rows = np.asarray(train_index, dtype=np.int64)
    rows = rows[np.isfinite(np.asarray(view.price_targets, dtype=np.float64)[rows])]
    return finite_rows(features, rows)


def percentile_bounds(values: np.ndarray, low: float = 1.0, high: float = 99.0) -> tuple[float, float]:
    values = np.asarray(values, dtype=np.float64)
    values = values[np.isfinite(values)]
    if values.size == 0:
        return -math.inf, math.inf
    return float(np.percentile(values, low)), float(np.percentile(values, high))


def ordinal_grades(target: np.ndarray, grade_count: int) -> tuple[np.ndarray, np.ndarray]:
    """(grade int64 in 0..K-1, edges) for K = ``grade_count`` (even): grades
    0..K/2-1 hold moves <= 0 (the lowest the most negative), K/2..K-1 moves > 0.
    ``edges`` are the within-sign quantile cut points actually used (for the log)."""
    grade_count = int(grade_count)
    if grade_count < 2 or grade_count % 2:
        raise ValueError(f"the grade count must be even and at least 2, got {grade_count}")
    target = np.asarray(target, dtype=np.float64)
    half = grade_count // 2
    grades = np.empty(target.shape[0], dtype=np.int64)
    down = target <= 0.0
    edges: list[float] = []
    for side, mask in ((0, down), (1, ~down)):
        values = target[mask]
        if half == 1 or values.size == 0:
            grades[mask] = side * half + (half - 1 if side == 0 else 0)
            continue
        cuts = np.quantile(values, np.arange(1, half) / half)
        edges += [float(cut) for cut in cuts]
        grades[mask] = side * half + np.searchsorted(cuts, values, side="right")
    edges.append(0.0)
    return grades, np.sort(np.asarray(edges, dtype=np.float64))


def band_classes(target: np.ndarray, band: float) -> np.ndarray:
    """0 down (move < -band), 1 flat (|move| <= band), 2 up (move > band)."""
    target = np.asarray(target, dtype=np.float64)
    classes = np.ones(target.shape[0], dtype=np.int64)
    classes[target < -band] = 0
    classes[target > band] = 2
    return classes


def _forward_steps(close: np.ndarray, rows: np.ndarray, horizon: int) -> np.ndarray:
    """(n, h) one-bar close changes of the bars r+1 .. r+h."""
    offsets = np.arange(1, int(horizon) + 1, dtype=np.int64)
    later = rows[:, None] + offsets[None, :]
    return close[later] - close[later - 1]


def bar_counts(view, rows) -> tuple[np.ndarray, np.ndarray]:
    """(up, down) counts of bars in r+1 .. r+h that closed at least one tick above / below the previous close."""
    rows = np.asarray(rows, dtype=np.int64)
    steps = _forward_steps(np.asarray(view.close, dtype=np.float64), rows, view.horizon)
    tick = float(view.tick_size) if math.isfinite(float(view.tick_size)) and view.tick_size > 0 else 1e-12
    threshold = tick * (1.0 - 1e-9)
    return (steps >= threshold).sum(axis=1).astype(np.float64), (steps <= -threshold).sum(axis=1).astype(np.float64)


def impulse_counts(view, rows, multiple: float) -> tuple[np.ndarray, np.ndarray]:
    """(up, down) counts of impulse bars in r+1 .. r+h: a one-bar move beyond
    ``multiple`` x move_scale[r] / sqrt(h) (the row's trailing scale, known at r)."""
    rows = np.asarray(rows, dtype=np.int64)
    steps = _forward_steps(np.asarray(view.close, dtype=np.float64), rows, view.horizon)
    bar_scale = np.asarray(view.move_scale, dtype=np.float64)[rows] / math.sqrt(float(view.horizon))
    threshold = (float(multiple) * bar_scale)[:, None]
    return (steps > threshold).sum(axis=1).astype(np.float64), (steps < -threshold).sum(axis=1).astype(np.float64)


def horizon_steps(horizon: int, count: int) -> np.ndarray:
    """J distinct horizons round(h j / J) for j = 1..J (each >= 1), ending at h."""
    horizon, count = int(horizon), max(1, int(count))
    steps = sorted({max(1, int(round(horizon * j / count))) for j in range(1, count + 1)} | {horizon})
    return np.asarray(steps, dtype=np.int64)


def horizon_moves(view, rows, steps: np.ndarray) -> np.ndarray:
    """(n, J) scaled moves (close[r+m] - close[r]) / move_scale[r] for m in ``steps``;
    the column m = h is the engine's own price target."""
    rows = np.asarray(rows, dtype=np.int64)
    close = np.asarray(view.close, dtype=np.float64)
    scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
    out = np.empty((rows.size, len(steps)), dtype=np.float64)
    for column, step in enumerate(steps):
        if int(step) == int(view.horizon):
            out[:, column] = np.asarray(view.price_targets, dtype=np.float64)[rows]
        else:
            out[:, column] = (close[rows + int(step)] - close[rows]) / scale
    return out


__all__ = ["Standardiser", "band_classes", "bar_counts", "finite_rows", "horizon_moves", "horizon_steps",
           "impulse_counts", "ordinal_grades", "percentile_bounds", "training_rows"]
