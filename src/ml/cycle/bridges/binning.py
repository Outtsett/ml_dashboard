"""Discrete states from the training span: quantile bins, target bins, clusters.

Causality: every edge, bin mean and cluster centre is fitted on the rows the
caller passes, which must be training rows (``train_index``, or
``MarketView.fit_rows`` for targets). Assigning a row to a bin or a cluster
reads only that row's own values, so the state of bar t depends on bars <= t
through the causal feature matrix and on nothing after the training span.

- ``QuantileBins``: interior edges at the training values' quantiles
  (duplicates dropped, so a column with few distinct values gets fewer bins);
  a value maps to ``searchsorted(edges, value, side="right")``, a missing value
  to -1.
- ``FeatureBins``: one ``QuantileBins`` per chosen feature column, and the
  mixed-radix state id of a row (-1 when any of its columns is missing).
- ``TargetBins``: quantile bins of a real-valued target with the mean target
  per bin (the "price model" of a tabular agent), smoothed toward the overall
  mean with ``prior_weight`` pseudo-rows.
- ``ClusterStates``: k-means (scikit-learn, seeded, one thread so a refit is
  bit-identical) fitted on training rows;
  assignment is the nearest centre by Euclidean distance in numpy, so a saved
  model needs no scikit-learn object and single-row equals batch exactly.
- ``conditional_means``: a smoothed per-state mean (Beta / pseudo-count style).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


def _rows(index) -> np.ndarray:
    return np.asarray(index, dtype=np.int64).reshape(-1)


@dataclass
class QuantileBins:
    edges: np.ndarray            # interior edges, strictly increasing (bin_count - 1 of them)

    @property
    def bin_count(self) -> int:
        return int(self.edges.size) + 1

    @classmethod
    def fit(cls, values, bin_count: int) -> QuantileBins:
        if bin_count < 1:
            raise ValueError(f"bin_count must be >= 1, got {bin_count}")
        values = np.asarray(values, dtype=np.float64).ravel()
        values = values[np.isfinite(values)]
        if values.size == 0 or bin_count == 1:
            return cls(np.empty(0, dtype=np.float64))
        quantiles = np.quantile(values, np.linspace(0.0, 1.0, bin_count + 1)[1:-1])
        edges = np.unique(quantiles)
        # an edge equal to the maximum would leave the top bin empty
        edges = edges[edges < values.max()]
        return cls(edges.astype(np.float64))

    def assign(self, values) -> np.ndarray:
        values = np.asarray(values, dtype=np.float64)
        codes = np.searchsorted(self.edges, values, side="right").astype(np.int64)
        codes[~np.isfinite(values)] = -1
        return codes

    def to_dict(self) -> dict:
        return {"edges": [float(edge) for edge in self.edges]}

    @classmethod
    def from_dict(cls, document: dict) -> QuantileBins:
        return cls(np.asarray(document["edges"], dtype=np.float64))


@dataclass
class FeatureBins:
    columns: list[int]
    bins: list[QuantileBins]

    @classmethod
    def fit(cls, features: np.ndarray, rows, bin_count: int, columns=None) -> FeatureBins:
        rows = _rows(rows)
        columns = list(range(features.shape[1])) if columns is None else [int(column) for column in columns]
        return cls(columns, [QuantileBins.fit(features[rows, column], bin_count) for column in columns])

    @property
    def radices(self) -> list[int]:
        return [item.bin_count for item in self.bins]

    @property
    def state_count(self) -> int:
        return int(np.prod(self.radices)) if self.bins else 1

    def codes(self, features: np.ndarray, rows) -> np.ndarray:
        rows = _rows(rows)
        if not self.bins:
            return np.zeros((rows.size, 0), dtype=np.int64)
        return np.column_stack([item.assign(features[rows, column]) for column, item in zip(self.columns, self.bins)])

    def states(self, features: np.ndarray, rows) -> np.ndarray:
        """The mixed-radix state id of each row (int64), -1 when any column is missing."""
        codes = self.codes(features, rows)
        state = np.zeros(codes.shape[0], dtype=np.int64)
        multiplier = 1
        for column in range(codes.shape[1] - 1, -1, -1):
            state += codes[:, column] * multiplier
            multiplier *= self.radices[column]
        if codes.shape[1]:
            state[np.any(codes < 0, axis=1)] = -1
        return state

    def to_dict(self) -> dict:
        return {"columns": list(self.columns), "bins": [item.to_dict() for item in self.bins]}

    @classmethod
    def from_dict(cls, document: dict) -> FeatureBins:
        return cls([int(column) for column in document["columns"]],
                   [QuantileBins.from_dict(item) for item in document["bins"]])


@dataclass
class TargetBins:
    bins: QuantileBins
    means: np.ndarray = field(default_factory=lambda: np.empty(0))   # mean target per bin
    counts: np.ndarray = field(default_factory=lambda: np.empty(0, dtype=np.int64))

    @classmethod
    def fit(cls, targets, rows, bin_count: int, prior_weight: float = 1.0) -> TargetBins:
        rows = _rows(rows)
        values = np.asarray(targets, dtype=np.float64)[rows]
        values = values[np.isfinite(values)]
        bins = QuantileBins.fit(values, bin_count)
        codes = bins.assign(values)
        means = conditional_means(codes, values, bins.bin_count, prior_weight=prior_weight)
        counts = np.bincount(codes[codes >= 0], minlength=bins.bin_count).astype(np.int64)
        return cls(bins, means, counts)

    def assign(self, values) -> np.ndarray:
        return self.bins.assign(values)

    def mean_of(self, codes) -> np.ndarray:
        codes = np.asarray(codes, dtype=np.int64)
        out = np.full(codes.shape, np.nan, dtype=np.float64)
        known = codes >= 0
        out[known] = self.means[codes[known]]
        return out

    def to_dict(self) -> dict:
        return {"bins": self.bins.to_dict(), "means": [float(v) for v in self.means],
                "counts": [int(v) for v in self.counts]}

    @classmethod
    def from_dict(cls, document: dict) -> TargetBins:
        return cls(QuantileBins.from_dict(document["bins"]), np.asarray(document["means"], dtype=np.float64),
                   np.asarray(document["counts"], dtype=np.int64))


def conditional_means(states, values, state_count: int, *, prior_weight: float = 1.0,
                      prior_mean: float | None = None) -> np.ndarray:
    """Per-state mean of ``values`` shrunk toward ``prior_mean`` (the overall
    mean by default) with ``prior_weight`` pseudo-rows; a state never seen gets
    the prior. States < 0 and missing values are ignored."""
    states = np.asarray(states, dtype=np.int64).ravel()
    values = np.asarray(values, dtype=np.float64).ravel()
    keep = (states >= 0) & np.isfinite(values)
    states, values = states[keep], values[keep]
    prior = float(np.mean(values)) if prior_mean is None and values.size else float(prior_mean or 0.0)
    sums = np.bincount(states, weights=values, minlength=state_count)[:state_count]
    counts = np.bincount(states, minlength=state_count)[:state_count].astype(np.float64)
    return (sums + prior_weight * prior) / (counts + prior_weight)


@dataclass
class ClusterStates:
    centers: np.ndarray          # (cluster_count, column_count)
    columns: list[int]

    @property
    def cluster_count(self) -> int:
        return int(self.centers.shape[0])

    @classmethod
    def fit(cls, features: np.ndarray, rows, cluster_count: int, seed: int, columns=None,
            maximum_rows: int = 20000) -> ClusterStates:
        """k-means on the finite training rows (a seeded subsample above ``maximum_rows``)."""
        from sklearn.cluster import KMeans

        rows = _rows(rows)
        columns = list(range(features.shape[1])) if columns is None else [int(column) for column in columns]
        matrix = np.asarray(features[np.ix_(rows, columns)], dtype=np.float64)
        matrix = matrix[np.all(np.isfinite(matrix), axis=1)]
        if matrix.shape[0] < cluster_count:
            raise ValueError(f"{matrix.shape[0]} finite training rows cannot make {cluster_count} clusters")
        if matrix.shape[0] > maximum_rows:
            chosen = np.sort(np.random.default_rng(seed).choice(matrix.shape[0], maximum_rows, replace=False))
            matrix = matrix[chosen]
        # one thread: parallel k-means sums differ in the last bit between two identical fits,
        # and a refit on the same rows must reproduce the same centres (the poison gate)
        from threadpoolctl import threadpool_limits

        with threadpool_limits(1):
            model = KMeans(n_clusters=int(cluster_count), n_init=4, random_state=int(seed)).fit(matrix)
        return cls(np.asarray(model.cluster_centers_, dtype=np.float64), columns)

    def assign(self, features: np.ndarray, rows) -> np.ndarray:
        rows = _rows(rows)
        matrix = np.asarray(features[np.ix_(rows, self.columns)], dtype=np.float64)
        distance = ((matrix[:, None, :] - self.centers[None, :, :]) ** 2).sum(axis=2)
        codes = np.argmin(np.where(np.isfinite(distance), distance, np.inf), axis=1).astype(np.int64)
        codes[~np.all(np.isfinite(matrix), axis=1)] = -1
        return codes

    def to_dict(self) -> dict:
        return {"centers": self.centers.tolist(), "columns": list(self.columns)}

    @classmethod
    def from_dict(cls, document: dict) -> ClusterStates:
        return cls(np.asarray(document["centers"], dtype=np.float64), [int(c) for c in document["columns"]])


__all__ = ["ClusterStates", "FeatureBins", "QuantileBins", "TargetBins", "conditional_means"]
