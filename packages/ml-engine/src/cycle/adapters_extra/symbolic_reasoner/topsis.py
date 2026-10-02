"""Multi-criteria decision analysis: TOPSIS on the most informative signals.

Criteria are the ``criterion_count`` feature columns with the largest absolute
information coefficient (Pearson correlation with the direction, or with the
scaled move for a price model) on the training span; a criterion with a
negative coefficient is a cost criterion and enters negated. Criterion
weights, also from the training span, come from the analytic hierarchy
process (pairwise ratios |IC_i| / |IC_j|, principal eigenvector; the
consistency ratio is logged) or from the entropy method (``weighting_method``).

Each bar is an alternative scored against an ideal and an anti-ideal
(``ideal_reference``):

- ``training_span``: the ideal is every criterion at its training 95th
  percentile and the anti-ideal at its 5th; criteria are min-max normalised
  to that range (clipped), so the bar is ranked against the whole training
  history (reads the bar itself only);
- ``trailing_window``: the alternatives are the last ``sequence_length`` bars,
  the current one included (rows <= t only), normalised within that window, so
  the bar is ranked against its own recent past.

After weighting, the distances d+ to the ideal and d- to the anti-ideal give
the relative closeness C = d- / (d+ + d-) in [0, 1]. The score is C - 0.5; the
price model is beta (C - 0.5) with beta the through-origin least-squares slope
of the clipped scaled move on the training span.
"""

from __future__ import annotations

import math
import warnings

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine

RANDOM_INDEX = {1: 0.0, 2: 0.0, 3: 0.58, 4: 0.90, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49, 11: 1.51,
                12: 1.48, 13: 1.56, 14: 1.57, 15: 1.59}


def analytic_hierarchy_weights(importance: np.ndarray) -> tuple[np.ndarray, float]:
    """Principal-eigenvector weights of the pairwise matrix a_ij = importance_i / importance_j, and its consistency ratio."""
    importance = np.maximum(np.asarray(importance, dtype=np.float64), 1e-12)
    matrix = importance[:, None] / importance[None, :]
    values, vectors = np.linalg.eig(matrix)
    principal = int(np.argmax(values.real))
    weights = np.abs(vectors[:, principal].real)
    weights /= weights.sum()
    size = importance.size
    index = (float(values.real[principal]) - size) / (size - 1) if size > 1 else 0.0
    ratio = index / RANDOM_INDEX.get(size, 1.59) if RANDOM_INDEX.get(size, 1.59) > 0 else 0.0
    return weights, float(ratio)


def entropy_weights(matrix: np.ndarray) -> np.ndarray:
    """The entropy method on a (rows, criteria) training matrix shifted to be positive."""
    shifted = matrix - matrix.min(axis=0, keepdims=True) + 1e-9
    share = shifted / shifted.sum(axis=0, keepdims=True)
    entropy = -(share * np.log(share)).sum(axis=0) / math.log(max(matrix.shape[0], 2))
    diversity = np.maximum(1.0 - entropy, 1e-12)
    return diversity / diversity.sum()


class TopsisRanking(Engine):
    uses_predicates = False
    has_value = True

    @property
    def history(self) -> int:
        return int(self.parameters["sequence_length"]) if self.parameters["ideal_reference"] == "trailing_window" else 1

    def fit(self, context, train_rows, target, direction):
        p = self.parameters
        features = context.features
        goal = np.asarray(target[train_rows] if self.task == "regression" else direction[train_rows], dtype=np.float64)
        coefficients = []
        for column in range(features.shape[1]):
            values = np.asarray(features[train_rows, column], dtype=np.float64)
            usable = np.isfinite(values) & np.isfinite(goal)
            if usable.sum() < 30 or np.std(values[usable]) <= 1e-12 or np.std(goal[usable]) <= 1e-12:
                continue
            coefficients.append((float(np.corrcoef(values[usable], goal[usable])[0, 1]), column))
        coefficients.sort(key=lambda item: (-abs(item[0]), item[1]))
        chosen = coefficients[: int(p["criterion_count"])] or [(1.0, 0)]
        self.columns = [column for _, column in chosen]
        self.orientation = np.array([1.0 if coefficient >= 0 else -1.0 for coefficient, _ in chosen])
        importance = np.array([abs(coefficient) for coefficient, _ in chosen])
        self.consistency_ratio = 0.0
        if p["weighting_method"] == "entropy":
            matrix = np.asarray(features[np.ix_(train_rows, self.columns)], dtype=np.float64) * self.orientation
            matrix = matrix[np.all(np.isfinite(matrix), axis=1)]
            self.weights = entropy_weights(matrix) if matrix.shape[0] > 1 else np.full(len(self.columns), 1 / len(self.columns))
        else:
            self.weights, self.consistency_ratio = analytic_hierarchy_weights(importance)
        oriented = np.asarray(features[np.ix_(train_rows, self.columns)], dtype=np.float64) * self.orientation
        oriented = oriented[np.all(np.isfinite(oriented), axis=1)]
        if oriented.shape[0]:
            self.low, self.high = (np.quantile(oriented, level, axis=0) for level in (0.05, 0.95))
        else:
            self.low, self.high = np.zeros(len(self.columns)), np.ones(len(self.columns))
        closeness = self.closeness(features, train_rows) - 0.5
        self.slope = 0.0
        if self.task == "regression":
            raw = np.asarray(target[train_rows], dtype=np.float64)
            usable = np.isfinite(raw) & np.isfinite(closeness)
            if usable.any():
                low, high = np.quantile(raw[usable], (0.01, 0.99))
                clipped = np.clip(raw[usable], low, high)
                denominator = float(np.sum(closeness[usable] ** 2))
                self.slope = float(np.sum(closeness[usable] * clipped) / denominator) if denominator > 0 else 0.0
        self.summary = {"criteria": [int(c) for c in self.columns], "weights": self.weights.tolist(),
                        "consistency_ratio": self.consistency_ratio}
        context.log(f"multi-criteria decision analysis: {len(self.columns)} criteria, {p['weighting_method']} weights "
                    f"(consistency ratio {self.consistency_ratio:.4f}), ideal from the {p['ideal_reference']}")
        return None

    def closeness(self, features: np.ndarray, rows) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        if self.parameters["ideal_reference"] == "training_span":
            current = np.asarray(features[rows[:, None], np.asarray(self.columns, dtype=np.int64)[None, :]],
                                 dtype=np.float64) * self.orientation
            span = self.high - self.low
            normalised = np.where(span > 1e-12, np.clip((current - self.low) / np.where(span > 1e-12, span, 1.0), 0.0, 1.0),
                                  0.5)
            return self._relative_closeness(normalised, current)
        window = int(self.parameters["sequence_length"])
        offsets = np.arange(-window + 1, 1, dtype=np.int64)
        index = rows[:, None] + offsets[None, :]
        valid = index >= 0
        flat = np.clip(index, 0, None).reshape(-1)
        gathered = features[flat[:, None], np.asarray(self.columns, dtype=np.int64)[None, :]]
        matrix = np.asarray(gathered, dtype=np.float64).reshape(rows.size, window, len(self.columns)) * self.orientation
        matrix[~valid] = np.nan
        current = matrix[:, -1, :]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)       # an all-missing window gives NaN, handled below
            low = np.nanmin(matrix, axis=1)
            high = np.nanmax(matrix, axis=1)
        span = high - low
        normalised = np.where(span > 1e-12, (current - low) / np.where(span > 1e-12, span, 1.0), 0.5)
        return self._relative_closeness(normalised, current)

    def _relative_closeness(self, normalised: np.ndarray, current: np.ndarray) -> np.ndarray:
        weighted = normalised * self.weights[None, :]
        to_ideal = np.sqrt(((weighted - self.weights[None, :]) ** 2).sum(axis=1))
        to_anti = np.sqrt((weighted ** 2).sum(axis=1))
        total = to_ideal + to_anti
        out = np.where(total > 0, to_anti / np.where(total > 0, total, 1.0), 0.5)
        out[~np.all(np.isfinite(current), axis=1)] = np.nan
        return out

    def score(self, context, rows):
        return self.closeness(context.features, rows) - 0.5

    def value(self, context, rows):
        return self.slope * (self.closeness(context.features, rows) - 0.5)

    def state(self):
        return {"columns": [int(c) for c in self.columns], "orientation": self.orientation.tolist(),
                "weights": self.weights.tolist(), "slope": float(self.slope), "consistencyRatio": self.consistency_ratio,
                "low": self.low.tolist(), "high": self.high.tolist()}

    def load(self, state):
        self.columns = [int(c) for c in state["columns"]]
        self.orientation = np.asarray(state["orientation"], dtype=np.float64)
        self.weights = np.asarray(state["weights"], dtype=np.float64)
        self.slope = float(state["slope"])
        self.consistency_ratio = float(state["consistencyRatio"])
        self.low = np.asarray(state["low"], dtype=np.float64)
        self.high = np.asarray(state["high"], dtype=np.float64)
