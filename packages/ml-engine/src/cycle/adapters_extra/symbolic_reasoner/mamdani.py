"""Fuzzy logic model: Mamdani inference with Wang-Mendel rules.

Inputs are the ``input_feature_count`` feature columns with the most mutual
information with the training direction (three training-quantile bins).
Each input gets ``membership_function_count`` linguistic terms whose peaks sit
at evenly spaced training quantiles (5 % .. 95 %): shoulders at both ends,
triangles between (a Ruspini partition), built with scikit-fuzzy's ``trapmf``
and ``trimf``; the universe is the training 0.5 % .. 99.5 % range and inputs
are clipped to it. The output universe is a bullishness score in [-1, 1] with
the terms bearish, neutral and bullish.

Rules (Wang-Mendel, on the training span): every training bar proposes the
antecedent made of each input's strongest term, with the product of those
memberships as its degree; a proposal's consequent is the output term that
best matches its degree-weighted up-share relative to the base rate. The
``rule_count`` antecedents with the most degree mass are kept.

Inference is textbook Mamdani, vectorised over bars: AND = minimum, implication
= clipping, aggregation = maximum, centroid defuzzification on a
``defuzzification_grid_points`` grid with scikit-fuzzy's exact piecewise-linear
centroid formula (checked against ``skfuzzy.control`` in the tests). A bar on
which no rule fires scores 0 (neutral).
"""

from __future__ import annotations

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.reasoning import Engine, to_list

OUTPUT_TERMS = {"bearish": (-1.0, -1.0, 0.0), "neutral": (-0.5, 0.0, 0.5), "bullish": (0.0, 1.0, 1.0)}
CHUNK_ROWS = 256


def mutual_information_columns(features: np.ndarray, rows: np.ndarray, direction: np.ndarray, count: int) -> list[int]:
    """The ``count`` columns with the highest mutual information between their
    three training-quantile bins and the direction (training rows only)."""
    y = direction[rows]
    scores = []
    for column in range(features.shape[1]):
        values = np.asarray(features[rows, column], dtype=np.float64)
        usable = np.isfinite(values) & np.isfinite(y)
        if usable.sum() < 30:
            continue
        edges = np.unique(np.quantile(values[usable], (1 / 3, 2 / 3)))
        codes = np.searchsorted(edges, values[usable], side="right")
        joint = np.zeros((edges.size + 1, 2))
        np.add.at(joint, (codes, y[usable].astype(np.int64)), 1.0)
        joint /= joint.sum()
        marginal_x = joint.sum(axis=1, keepdims=True)
        marginal_y = joint.sum(axis=0, keepdims=True)
        with np.errstate(divide="ignore", invalid="ignore"):
            information = np.nansum(joint * np.log(joint / (marginal_x * marginal_y)))
        scores.append((-float(information), column))
    scores.sort()
    return [column for _, column in scores[: max(1, count)]]


def input_terms(values: np.ndarray, term_count: int) -> tuple[list[list[float]], float, float]:
    """Membership-function vertices (trapezoid / triangle) at training quantiles, and the universe."""
    values = values[np.isfinite(values)]
    low, high = (float(v) for v in np.quantile(values, (0.005, 0.995)))
    peaks = np.unique(np.quantile(values, np.linspace(0.05, 0.95, term_count)))
    peaks = peaks[(peaks > low) & (peaks < high)] if high > low else peaks[:1]
    if peaks.size < 2 or not high > low:
        return [[low, low, high, high]], low, max(high, low + 1e-9)
    terms = [[low, low, float(peaks[0]), float(peaks[1])]]
    for k in range(1, peaks.size - 1):
        terms.append([float(peaks[k - 1]), float(peaks[k]), float(peaks[k + 1])])
    terms.append([float(peaks[-2]), float(peaks[-1]), high, high])
    return terms, low, high


def membership(values: np.ndarray, vertices: list[float]) -> np.ndarray:
    import skfuzzy

    values = np.asarray(values, dtype=np.float64)
    if len(vertices) == 4:
        return skfuzzy.trapmf(values, vertices)
    return skfuzzy.trimf(values, vertices)


def centroid(grid: np.ndarray, aggregated: np.ndarray) -> np.ndarray:
    """scikit-fuzzy's exact piecewise-linear centroid, vectorised over rows (aggregated: rows x grid)."""
    x1, x2 = grid[:-1][None, :], grid[1:][None, :]
    y1, y2 = aggregated[:, :-1], aggregated[:, 1:]
    width = x2 - x1
    area = 0.5 * width * (y1 + y2)
    moment_area = 0.5 * width * (y1 + y2) * x1 + (width ** 2) * (y2 + 0.5 * y1) / 3.0
    total = area.sum(axis=1)
    return np.divide(moment_area.sum(axis=1), total, out=np.zeros(total.shape), where=total > 0)


class MamdaniSystem(Engine):
    uses_predicates = False

    def fit(self, context, train_rows, target, direction):
        p = self.parameters
        features = context.features
        self.columns = mutual_information_columns(features, train_rows, direction, int(p["input_feature_count"]))
        self.terms, self.universe = [], []
        for column in self.columns:
            terms, low, high = input_terms(np.asarray(features[train_rows, column], dtype=np.float64),
                                           int(p["membership_function_count"]))
            self.terms.append(terms)
            self.universe.append([low, high])
        memberships = self._memberships(features, train_rows)                 # list of (rows, terms)
        y = direction[train_rows]
        known = np.isfinite(y) & np.all(np.column_stack([np.isfinite(m).all(axis=1) for m in memberships]), axis=1)
        strongest = np.column_stack([np.argmax(m, axis=1) for m in memberships])[known]
        degree = np.prod(np.column_stack([np.max(m, axis=1) for m in memberships])[known], axis=1)
        y = y[known]
        base = float(np.mean(y)) if y.size else 0.5
        keys, inverse = np.unique(strongest, axis=0, return_inverse=True)
        inverse = np.asarray(inverse).reshape(-1)
        mass = np.bincount(inverse, weights=degree, minlength=keys.shape[0])
        up_mass = np.bincount(inverse, weights=degree * y, minlength=keys.shape[0])
        order = np.lexsort((np.arange(keys.shape[0]), -mass))[: int(p["rule_count"])]
        grid_points = int(p["defuzzification_grid_points"])
        self.grid = np.linspace(-1.0, 1.0, grid_points)
        self.rules = []
        spread = max(base, 1.0 - base, 1e-9)
        for index in order:
            share = up_mass[index] / mass[index] if mass[index] > 0 else base
            z = float(np.clip((share - base) / spread, -1.0, 1.0))
            consequent = max(OUTPUT_TERMS, key=lambda name: float(membership(np.array([z]), list(OUTPUT_TERMS[name]))[0]))
            self.rules.append({"antecedent": [int(k) for k in keys[index]], "consequent": consequent,
                               "mass": float(mass[index]), "upShare": float(share)})
        self.summary = {"inputs": [str(c) for c in self.columns], "rule_count": len(self.rules)}
        context.log(f"fuzzy logic model: {len(self.columns)} inputs, {len(self.rules)} Wang-Mendel rules "
                    f"({sum(r['consequent'] == 'bullish' for r in self.rules)} bullish, "
                    f"{sum(r['consequent'] == 'bearish' for r in self.rules)} bearish)")
        return None

    def _memberships(self, features, rows) -> list[np.ndarray]:
        out = []
        for position, column in enumerate(self.columns):
            values = np.asarray(features[rows, column], dtype=np.float64)
            low, high = self.universe[position]
            clipped = np.clip(values, low, high)
            matrix = np.column_stack([membership(clipped, vertices) for vertices in self.terms[position]])
            matrix[~np.isfinite(values)] = np.nan
            out.append(matrix)
        return out

    def output(self, features, rows) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        memberships = self._memberships(features, rows)
        missing = np.any(np.column_stack([np.isnan(m).any(axis=1) for m in memberships]), axis=1)
        consequents = np.stack([membership(self.grid, list(OUTPUT_TERMS[rule["consequent"]])) for rule in self.rules]) \
            if self.rules else np.zeros((0, self.grid.size))
        firing = np.ones((rows.size, len(self.rules)))
        for position in range(len(self.columns)):
            terms = np.array([rule["antecedent"][position] for rule in self.rules], dtype=np.int64)
            firing = np.minimum(firing, np.nan_to_num(memberships[position])[:, terms])
        out = np.zeros(rows.size)
        for start in range(0, rows.size, CHUNK_ROWS):
            block = firing[start:start + CHUNK_ROWS]
            aggregated = np.max(np.minimum(block[:, :, None], consequents[None, :, :]), axis=1) if self.rules \
                else np.zeros((block.shape[0], self.grid.size))
            out[start:start + CHUNK_ROWS] = centroid(self.grid, aggregated)
        out[missing] = np.nan
        return out

    def score(self, context, rows):
        return self.output(context.features, rows)

    def state(self):
        return {"columns": [int(c) for c in self.columns], "terms": self.terms, "universe": self.universe,
                "grid": to_list(self.grid), "rules": self.rules}

    def load(self, state):
        self.columns = [int(c) for c in state["columns"]]
        self.terms = [[list(map(float, vertices)) for vertices in terms] for terms in state["terms"]]
        self.universe = [list(map(float, pair)) for pair in state["universe"]]
        self.grid = np.asarray(state["grid"], dtype=np.float64)
        self.rules = list(state["rules"])
