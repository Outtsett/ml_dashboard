"""Geometry shared by the state models: standardising, projections, neighbours, Gaussian densities.

Every object here is fitted on the training rows the caller passes and applied
row by row: the value at bar t reads the feature row t alone, so a single row
gives exactly what it gives inside a batch. Every fitted object round-trips
through plain numpy arrays (``arrays`` / ``from_arrays``).

Library fits run on one thread (``single_thread``): a multi-threaded BLAS or
OpenMP reduction can differ in its last bit between two identical fits, and a
refit on the same training rows must save the same model (the poison gate).
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass

import numpy as np

FLOAT = np.float64


@contextlib.contextmanager
def single_thread():
    """Every library fit inside runs on one BLAS / OpenMP thread (bit-identical refits)."""
    from threadpoolctl import threadpool_limits

    with threadpool_limits(1):
        yield


def rows_of(index) -> np.ndarray:
    return np.asarray(index, dtype=np.int64).reshape(-1)


def spread_rows(rows, maximum: int) -> np.ndarray:
    """At most ``maximum`` rows spread evenly over ``rows`` in time order (no
    randomness): a chronologically stratified subsample of the training span."""
    rows = rows_of(rows)
    maximum = int(maximum)
    if maximum <= 0 or rows.size <= maximum:
        return rows
    return rows[np.unique(np.linspace(0, rows.size - 1, maximum).round().astype(np.int64))]


# ─── standardising ─────────────────────────────────────────────────────────


@dataclass
class Standardiser:
    """z = (x - mean) / scale with the training rows' mean and deviation (a
    column with no spread keeps scale 1). A missing value becomes 0, the
    training mean: it moves the row toward the centre instead of dropping it."""

    mean: np.ndarray
    scale: np.ndarray

    @classmethod
    def fit(cls, features: np.ndarray, rows) -> Standardiser:
        matrix = np.asarray(features[rows_of(rows)], dtype=FLOAT)
        with np.errstate(invalid="ignore"):
            mean = np.nanmean(np.where(np.isfinite(matrix), matrix, np.nan), axis=0)
            scale = np.nanstd(np.where(np.isfinite(matrix), matrix, np.nan), axis=0)
        mean = np.where(np.isfinite(mean), mean, 0.0)
        scale = np.where(np.isfinite(scale) & (scale > 1e-12), scale, 1.0)
        return cls(mean.astype(FLOAT), scale.astype(FLOAT))

    def transform(self, features: np.ndarray, rows) -> np.ndarray:
        matrix = np.asarray(features[rows_of(rows)], dtype=FLOAT)
        z = (matrix - self.mean) / self.scale
        return np.where(np.isfinite(z), z, 0.0)

    def arrays(self) -> dict[str, np.ndarray]:
        return {"mean": self.mean, "scale": self.scale}

    @classmethod
    def from_arrays(cls, arrays: dict[str, np.ndarray]) -> Standardiser:
        return cls(np.asarray(arrays["mean"], dtype=FLOAT), np.asarray(arrays["scale"], dtype=FLOAT))


@dataclass
class Projection:
    """The training rows' leading principal components, whitened (unit
    variance on the training rows). ``component_count`` 0 (or at least the
    column count with ``whiten`` false) is the identity. The sign of each axis
    is fixed (its largest loading positive) so a refit names the axes the same."""

    components: np.ndarray        # (d, F); empty (0, F) = identity
    center: np.ndarray            # (F,)
    deviation: np.ndarray         # (d,) the training rows' spread along each axis

    @property
    def identity(self) -> bool:
        return self.components.shape[0] == 0

    @classmethod
    def fit(cls, space: np.ndarray, component_count: int) -> Projection:
        space = np.asarray(space, dtype=FLOAT)
        width = space.shape[1]
        count = int(component_count)
        if count <= 0:
            return cls(np.zeros((0, width)), np.zeros(width), np.zeros(0))
        count = min(count, width, max(1, space.shape[0] - 1))
        center = space.mean(axis=0)
        _, singular, vectors = np.linalg.svd(space - center, full_matrices=False)
        components = vectors[:count]
        flip = np.sign(components[np.arange(count), np.argmax(np.abs(components), axis=1)])
        components = components * np.where(flip == 0, 1.0, flip)[:, None]
        deviation = singular[:count] / np.sqrt(max(space.shape[0] - 1, 1))
        deviation = np.where(deviation > 1e-12, deviation, 1.0)
        return cls(components.astype(FLOAT), center.astype(FLOAT), deviation.astype(FLOAT))

    def transform(self, space: np.ndarray) -> np.ndarray:
        if self.identity:
            return np.asarray(space, dtype=FLOAT)
        return ((np.asarray(space, dtype=FLOAT) - self.center) @ self.components.T) / self.deviation

    def arrays(self) -> dict[str, np.ndarray]:
        return {"components": self.components, "center": self.center, "deviation": self.deviation}

    @classmethod
    def from_arrays(cls, arrays: dict[str, np.ndarray]) -> Projection:
        return cls(np.asarray(arrays["components"], dtype=FLOAT), np.asarray(arrays["center"], dtype=FLOAT),
                   np.asarray(arrays["deviation"], dtype=FLOAT))


# ─── distances and assignments ─────────────────────────────────────────────


def squared_distances(points: np.ndarray, references: np.ndarray) -> np.ndarray:
    """(n, m) squared Euclidean distances, computed per pair (no expansion
    trick, so a row's distances do not depend on the other rows in the batch)."""
    points = np.asarray(points, dtype=FLOAT)
    references = np.asarray(references, dtype=FLOAT)
    out = np.empty((points.shape[0], references.shape[0]), dtype=FLOAT)
    for position in range(points.shape[0]):
        difference = references - points[position]
        out[position] = np.einsum("ij,ij->i", difference, difference)
    return out


def nearest(points: np.ndarray, references: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(index of the nearest reference, its squared distance) per point."""
    distance = squared_distances(points, references)
    index = np.argmin(distance, axis=1)
    return index.astype(np.int64), distance[np.arange(distance.shape[0]), index]


def one_hot(codes, state_count: int) -> np.ndarray:
    """(n, S) indicator rows; a code < 0 gives a NaN row."""
    codes = np.asarray(codes, dtype=np.int64).reshape(-1)
    out = np.zeros((codes.size, int(state_count)), dtype=FLOAT)
    known = codes >= 0
    out[np.flatnonzero(known), codes[known]] = 1.0
    out[~known] = np.nan
    return out


def neighbour_vote(points: np.ndarray, references: np.ndarray, reference_states: np.ndarray, state_count: int,
                   neighbor_count: int) -> np.ndarray:
    """Soft states from a distance-weighted vote of the ``neighbor_count``
    nearest fitted rows (weights 1 / (distance + 1e-9)): the out-of-sample
    extension of a clustering that has no predict of its own. Ties in distance
    break by the reference order (a stable sort)."""
    distance = squared_distances(points, references)
    count = max(1, min(int(neighbor_count), references.shape[0]))
    order = np.argsort(distance, axis=1, kind="stable")[:, :count]
    out = np.zeros((points.shape[0], int(state_count)), dtype=FLOAT)
    for position in range(points.shape[0]):
        chosen = order[position]
        weights = 1.0 / (np.sqrt(distance[position, chosen]) + 1e-9)
        np.add.at(out[position], reference_states[chosen], weights)
        out[position] /= out[position].sum()
    return out


# ─── Gaussian mixtures in plain numpy ──────────────────────────────────────


COVARIANCE_STRUCTURES = ("full", "diag")


def gaussian_log_density(points: np.ndarray, means: np.ndarray, precision_cholesky: np.ndarray,
                         structure: str) -> np.ndarray:
    """log N(x | mean_k, covariance_k) per point and component (n, K), from the
    Cholesky factor of each precision matrix, as scikit-learn parameterises a
    fitted mixture (``precisions_cholesky_``): full (K, d, d) or diag (K, d)."""
    points = np.asarray(points, dtype=FLOAT)
    means = np.asarray(means, dtype=FLOAT)
    width = points.shape[1]
    components = means.shape[0]
    out = np.empty((points.shape[0], components), dtype=FLOAT)
    if structure == "full":
        for k in range(components):
            factor = precision_cholesky[k]
            log_determinant = float(np.sum(np.log(np.diag(factor))))
            projected = points @ factor - means[k] @ factor
            out[:, k] = -0.5 * (width * np.log(2.0 * np.pi) + np.sum(projected ** 2, axis=1)) + log_determinant
    elif structure == "diag":
        for k in range(components):
            factor = precision_cholesky[k]
            log_determinant = float(np.sum(np.log(factor)))
            projected = (points - means[k]) * factor
            out[:, k] = -0.5 * (width * np.log(2.0 * np.pi) + np.sum(projected ** 2, axis=1)) + log_determinant
    else:
        raise ValueError(f"unknown covariance structure {structure!r}; valid: {', '.join(COVARIANCE_STRUCTURES)}")
    return out


def softmax_rows(log_values: np.ndarray) -> np.ndarray:
    log_values = np.asarray(log_values, dtype=FLOAT)
    peak = np.max(log_values, axis=1, keepdims=True)
    weights = np.exp(log_values - peak)
    return weights / weights.sum(axis=1, keepdims=True)


@dataclass
class GaussianComponents:
    """A fitted mixture as plain arrays: responsibilities are
    softmax_k(log N(x | mean_k, precision_k) + log_constant_k), where the
    constant carries the log weight (and, for a variational mixture, its
    expected-precision terms)."""

    means: np.ndarray
    precision_cholesky: np.ndarray
    log_constant: np.ndarray
    structure: str

    @property
    def component_count(self) -> int:
        return int(self.means.shape[0])

    @classmethod
    def from_sklearn(cls, model, sample: np.ndarray) -> GaussianComponents:
        """From a fitted ``GaussianMixture`` or ``BayesianGaussianMixture``: the
        per-component constant is what the model's own weighted log probability
        adds to the Gaussian log density (read off one training row: it does
        not depend on the row)."""
        structure = str(model.covariance_type)
        if structure not in COVARIANCE_STRUCTURES:
            raise ValueError(f"covariance structure {structure!r} is not supported here")
        means = np.asarray(model.means_, dtype=FLOAT)
        factor = np.asarray(model.precisions_cholesky_, dtype=FLOAT)
        row = np.asarray(sample, dtype=FLOAT)[:1]
        weighted = np.asarray(model._estimate_weighted_log_prob(row), dtype=FLOAT)[0]
        constant = weighted - gaussian_log_density(row, means, factor, structure)[0]
        return cls(means, factor, constant.astype(FLOAT), structure)

    def log_joint(self, points: np.ndarray) -> np.ndarray:
        return gaussian_log_density(points, self.means, self.precision_cholesky, self.structure) + self.log_constant

    def responsibilities(self, points: np.ndarray) -> np.ndarray:
        return softmax_rows(self.log_joint(points))

    def arrays(self) -> dict[str, np.ndarray]:
        return {"means": self.means, "precision_cholesky": self.precision_cholesky,
                "log_constant": self.log_constant, "structure_is_full": np.asarray(self.structure == "full")}

    @classmethod
    def from_arrays(cls, arrays: dict[str, np.ndarray]) -> GaussianComponents:
        structure = "full" if bool(arrays["structure_is_full"]) else "diag"
        return cls(np.asarray(arrays["means"], dtype=FLOAT), np.asarray(arrays["precision_cholesky"], dtype=FLOAT),
                   np.asarray(arrays["log_constant"], dtype=FLOAT), structure)


def prefixed(prefix: str, arrays: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    return {f"{prefix}__{name}": np.asarray(value) for name, value in arrays.items()}


def unprefixed(prefix: str, arrays: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    head = f"{prefix}__"
    return {name[len(head):]: value for name, value in arrays.items() if name.startswith(head)}


__all__ = ["COVARIANCE_STRUCTURES", "GaussianComponents", "Projection", "Standardiser", "gaussian_log_density",
           "nearest", "neighbour_vote", "one_hot", "prefixed", "rows_of", "single_thread", "softmax_rows",
           "spread_rows", "squared_distances", "unprefixed"]
