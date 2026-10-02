"""What every path simulator shares: the simulator contract, per-row random
streams, causal series windows, and the two train-fitted feature maps.

A path simulator fits a generator of future price paths on the fold's
training span and, at bar t, simulates ``path_count`` paths of h bars from the
state observed at t. The generator's raw direction score is the logit of the
share of paths whose h-bar move is positive (or, for the two deterministic
members, a projected displacement or a rule signal); the adapter turns it into
P(up) with a curve fitted on validation rows only. The mean simulated move, in
units of the bar's ``move_scale`` (the price target's own units), is the price
model.

Causality (``cycle.market``): a simulation at bar t reads the features of row
t, closes and ``move_scale`` at rows <= t, and the gap flag of each step it
uses (``one_bar_crosses_gap[r - 1]`` for the step that ends at r <= t). Fits
read targets and the closes that make them only for rows of
``view.fit_rows(train_index)``.

Randomness is drawn per row: ``row_generator(seed, row, salt)`` seeds a numpy
Generator from (seed, salt, row), so a bar gets the same paths whether it is
scored alone, in a batch, or after a reload.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

# Salts keep the random streams of different purposes apart (paths vs fitting).
PATH_SALT = 11
FIT_SALT = 23
# rows simulated per chunk in a batch (bounds memory; results do not depend on it)
ROW_CHUNK = 256


def row_generator(seed: int, row: int, salt: int = PATH_SALT) -> np.random.Generator:
    """The random stream of one bar: the same numbers alone or in a batch."""
    return np.random.default_rng([int(seed) & 0xFFFFFFFF, int(salt), int(row)])


def fit_generator(seed: int, salt: int) -> np.random.Generator:
    return np.random.default_rng([int(seed) & 0xFFFFFFFF, FIT_SALT, int(salt)])


def rows_of(index) -> np.ndarray:
    return np.asarray(index, dtype=np.int64).reshape(-1)


# ─── the direction score ────────────────────────────────────────────────────


def share_up(moves: np.ndarray) -> np.ndarray:
    """Share of paths (last axis) with a positive move; a path that ends
    exactly flat counts one half."""
    moves = np.asarray(moves, dtype=np.float64)
    return (np.sum(moves > 0, axis=-1) + 0.5 * np.sum(moves == 0, axis=-1)) / moves.shape[-1]


def logit_share(share, path_count: int) -> np.ndarray:
    """logit of a path share, clipped half a path from 0 and 1 (NaN stays NaN)."""
    share = np.asarray(share, dtype=np.float64)
    floor = 0.5 / max(1, int(path_count))
    clipped = np.clip(share, floor, 1.0 - floor)
    out = np.log(clipped) - np.log1p(-clipped)
    out[~np.isfinite(share)] = np.nan
    return out


@dataclass
class Simulated:
    """A simulator's answer for some rows: the raw direction score (the
    validation curve maps it to P(up)), the mean simulated move in
    ``move_scale`` units, and the raw share of up paths (NaN for the
    deterministic members)."""

    score: np.ndarray
    mean_move: np.ndarray
    share: np.ndarray


def empty_simulated(count: int) -> Simulated:
    return Simulated(np.full(count, np.nan), np.full(count, np.nan), np.full(count, np.nan))


# ─── the bar series ─────────────────────────────────────────────────────────


def point_steps(view) -> np.ndarray:
    """close[r] - close[r-1] in points, NaN at row 0 and where the step from
    r-1 to r crosses a session gap (read from ``one_bar_crosses_gap[r - 1]``,
    known at r)."""
    close = np.asarray(view.close, dtype=np.float64)
    out = np.full(close.shape[0], np.nan)
    if close.shape[0] > 1:
        out[1:] = close[1:] - close[:-1]
        out[1:][np.asarray(view.one_bar_crosses_gap[:-1], dtype=bool)] = np.nan
    return out


def scaled_steps(view) -> np.ndarray:
    """Each bar's step divided by the move scale known before it (row r - 1):
    the price target's units, one bar at a time (sd about 1 / sqrt(h))."""
    steps = point_steps(view)
    scale = np.asarray(view.move_scale, dtype=np.float64)
    out = np.full(steps.shape[0], np.nan)
    if steps.shape[0] > 1:
        with np.errstate(invalid="ignore", divide="ignore"):
            out[1:] = steps[1:] / scale[:-1]
    out[~np.isfinite(out)] = np.nan
    return out


def windows(values: np.ndarray, rows: np.ndarray, length: int) -> np.ndarray:
    """(len(rows), length) of ``values[r - length + 1 .. r]``; positions
    before row 0 are NaN. Reads nothing after r."""
    rows = rows_of(rows)
    offsets = np.arange(-int(length) + 1, 1, dtype=np.int64)
    index = rows[:, None] + offsets[None, :]
    out = np.asarray(values, dtype=np.float64)[np.clip(index, 0, None)]
    out[index < 0] = np.nan
    return out


def history_closes(view, rows: np.ndarray, length: int) -> np.ndarray:
    """(len(rows), length) closes up to and including each row, in the row's
    ``move_scale`` units relative to its own close (the last column is 0)."""
    rows = rows_of(rows)
    close = windows(view.close, rows, length)
    scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
    with np.errstate(invalid="ignore", divide="ignore"):
        return (close - close[:, -1:]) / scale[:, None]


# ─── train-fitted feature maps ──────────────────────────────────────────────


def finite_rows(features: np.ndarray, rows: np.ndarray) -> np.ndarray:
    rows = rows_of(rows)
    if rows.size == 0:
        return rows
    return rows[np.all(np.isfinite(features[rows]), axis=1)]


@dataclass
class Standardizer:
    mean: np.ndarray
    scale: np.ndarray

    @classmethod
    def fit(cls, features: np.ndarray, rows: np.ndarray) -> Standardizer:
        values = np.asarray(features[rows], dtype=np.float64)
        mean = values.mean(axis=0)
        scale = values.std(axis=0)
        scale[~np.isfinite(scale) | (scale < 1e-12)] = 1.0
        return cls(mean, scale)

    def apply(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        return (np.asarray(features[rows_of(rows)], dtype=np.float64) - self.mean) / self.scale


@dataclass
class Embedding:
    """Standardised features projected on the training span's first principal
    components (unit variance each)."""

    standardizer: Standardizer
    components: np.ndarray          # (d, F)
    component_scale: np.ndarray     # (d,)

    @classmethod
    def fit(cls, features: np.ndarray, rows: np.ndarray, component_count: int) -> Embedding:
        standardizer = Standardizer.fit(features, rows)
        z = standardizer.apply(features, rows)
        count = max(1, min(int(component_count), z.shape[1]))
        _, singular, vt = np.linalg.svd(z - z.mean(axis=0), full_matrices=False)
        components = vt[:count].copy()
        # a sign convention so a refit on identical data gives identical components
        signs = np.sign(components[np.arange(count), np.argmax(np.abs(components), axis=1)])
        signs[signs == 0] = 1.0
        components *= signs[:, None]
        projected = z @ components.T
        component_scale = projected.std(axis=0)
        component_scale[component_scale < 1e-12] = 1.0
        return cls(standardizer, components, component_scale)

    @property
    def dimension(self) -> int:
        return int(self.components.shape[0])

    def apply(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        return (self.standardizer.apply(features, rows) @ self.components.T) / self.component_scale

    def arrays(self, prefix: str) -> dict:
        return {f"{prefix}_mean": self.standardizer.mean, f"{prefix}_scale": self.standardizer.scale,
                f"{prefix}_components": self.components, f"{prefix}_component_scale": self.component_scale}

    @classmethod
    def from_arrays(cls, arrays: dict, prefix: str) -> Embedding:
        return cls(Standardizer(arrays[f"{prefix}_mean"], arrays[f"{prefix}_scale"]), arrays[f"{prefix}_components"],
                   arrays[f"{prefix}_component_scale"])


@dataclass
class RidgeIndex:
    """A train-fitted ridge map from the standardised features to a target
    (an intercept plus weights): the "information" a simulator's drift or
    informed agents read."""

    standardizer: Standardizer
    weights: np.ndarray
    intercept: float

    @classmethod
    def fit(cls, features: np.ndarray, rows: np.ndarray, target: np.ndarray, penalty: float) -> RidgeIndex:
        rows = rows_of(rows)
        target = np.asarray(target, dtype=np.float64)
        rows = rows[np.isfinite(target[rows])]
        standardizer = Standardizer.fit(features, rows)
        z = standardizer.apply(features, rows)
        y = target[rows]
        intercept = float(y.mean()) if y.size else 0.0
        if y.size < 2:
            return cls(standardizer, np.zeros(z.shape[1]), intercept)
        centred = z - z.mean(axis=0)
        gram = centred.T @ centred + float(penalty) * y.size * np.eye(z.shape[1])
        weights = np.linalg.solve(gram, centred.T @ (y - intercept))
        intercept = float(intercept - z.mean(axis=0) @ weights)
        return cls(standardizer, weights, intercept)

    def apply(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        return self.standardizer.apply(features, rows) @ self.weights + self.intercept

    def arrays(self, prefix: str) -> dict:
        return {f"{prefix}_mean": self.standardizer.mean, f"{prefix}_scale": self.standardizer.scale,
                f"{prefix}_weights": self.weights, f"{prefix}_intercept": np.array([self.intercept])}

    @classmethod
    def from_arrays(cls, arrays: dict, prefix: str) -> RidgeIndex:
        return cls(Standardizer(arrays[f"{prefix}_mean"], arrays[f"{prefix}_scale"]), arrays[f"{prefix}_weights"],
                   float(arrays[f"{prefix}_intercept"][0]))


def forward_steps(view, rows: np.ndarray, horizon: int) -> np.ndarray:
    """(len(rows), horizon): the steps after each row in the row's move-scale
    units, (close[r+k] - close[r+k-1]) / move_scale[r]; their sum is the price
    target. Fit-only: it reads the h closes after r, so only for training rows
    (they resolve by train_index[-1] + h, before validation starts)."""
    rows = rows_of(rows)
    close = np.asarray(view.close, dtype=np.float64)
    index = rows[:, None] + np.arange(0, int(horizon) + 1, dtype=np.int64)[None, :]
    path = close[index]
    scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.diff(path, axis=1) / scale[:, None]


def usable_training_rows(view, features: np.ndarray, train_index: np.ndarray, maximum_rows: int | None = None) -> np.ndarray:
    """The training span's rows with finite features, a finite move scale and
    a known price target whose horizon does not cross a session gap; the most
    recent ``maximum_rows`` of them when given."""
    rows = view.fit_rows(train_index)
    rows = finite_rows(features, rows)
    targets = np.asarray(view.price_targets, dtype=np.float64)[rows]
    scale = np.asarray(view.move_scale, dtype=np.float64)[rows]
    keep = np.isfinite(targets) & np.isfinite(scale) & (scale > 0) & ~np.asarray(view.crosses_gap, dtype=bool)[rows]
    rows = rows[keep]
    if maximum_rows is not None and rows.size > int(maximum_rows):
        rows = rows[-int(maximum_rows):]
    return rows


def excess_kurtosis(values: np.ndarray) -> float:
    values = np.asarray(values, dtype=np.float64)
    values = values[np.isfinite(values)]
    if values.size < 4:
        return float("nan")
    centred = values - values.mean()
    variance = float(np.mean(centred ** 2))
    if variance <= 0:
        return 0.0
    return float(np.mean(centred ** 4) / variance ** 2 - 3.0)


def correlation(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    keep = np.isfinite(a) & np.isfinite(b)
    if keep.sum() < 3:
        return 0.0
    a, b = a[keep] - a[keep].mean(), b[keep] - b[keep].mean()
    denominator = math.sqrt(float(np.sum(a * a)) * float(np.sum(b * b)))
    return float(np.sum(a * b) / denominator) if denominator > 0 else 0.0


class Simulator:
    """The contract every generator in this package follows (see the module docstring).

    ``prepare`` sets the fit up, ``train_epoch`` runs one reported step of it
    (``epoch_count`` of them; a one-shot fit has one), ``finish`` checks the
    result (MCMC convergence), ``simulate`` answers for rows, and
    ``state`` / ``restore`` round-trip everything a prediction needs."""

    variant = ""
    step_unit = "single_fit"

    def __init__(self, parameters: dict, seed: int, horizon: int) -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.horizon = int(horizon)
        self.path_count = int(self.parameters.get("path_count", 1))

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return 1

    def prepare(self, context) -> None:
        raise NotImplementedError

    def epoch_count(self) -> int:
        return 1

    def train_epoch(self, epoch: int, report_batch, context) -> float | None:
        raise NotImplementedError

    def finish(self, context) -> None:
        """Checks after the last epoch (default: none)."""

    def simulate(self, features: np.ndarray, view, rows: np.ndarray) -> Simulated:
        raise NotImplementedError

    def state(self) -> tuple[dict, dict]:
        raise NotImplementedError

    def restore(self, arrays: dict, document: dict) -> None:
        raise NotImplementedError

    def summary(self) -> dict:
        """Plain numbers the fit wants in model.json (deterministic, no timings)."""
        return {}


@dataclass
class FitContext:
    features: np.ndarray
    view: object
    train_index: np.ndarray
    validation_index: np.ndarray
    task: str
    reporter: object


def chunked(rows: np.ndarray, size: int = ROW_CHUNK):
    rows = rows_of(rows)
    for start in range(0, rows.size, size):
        yield start, rows[start:start + size]
