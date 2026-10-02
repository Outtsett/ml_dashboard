"""What every searcher in the family optimises: a problem over a population.

A policy-search model is trained by an OPTIMISER, not by a loss the model
defines for itself. The family's policy is one of three forms:

- ``LinearPolicy``: score s_t = w . x_t + b over the bar's causal feature row
  (the eight linear searchers and gradient descent). As a trader its position
  is tanh(s_t) in [-1, 1].
- a rule ensemble (``rules.RuleEnsemblePolicy``): position +1 when a rule fires,
  -1 when it does not, averaged over the ensemble.
- a formula (``formula.FormulaPolicy``): the evolved expression's value.

``Problem`` scores a whole population in one matrix product: ``loss(thetas)``
takes a (population, dimension) matrix of candidate (w, b) vectors and returns
one loss per candidate (lower is better), so a generation of any searcher is a
single call. Three kinds:

``utility`` (direction models, trading the reward tape)
    loss = -mean_t [ p_t * move_t - |p_t| * cost_t ] + weight_decay * |w|^2,
    p_t = tanh(s_t). ``move_t`` and ``cost_t`` are read off the reward tape
    (``cycle.bridges.tape.RewardTape``): a long decision at t earns
    move_t - cost_t and a short one -move_t - cost_t, where move_t is the
    next-open to next-open-after-h move and cost_t one round trip, both
    divided by the causal move scale at t. The moves are clipped to
    +-``MOVE_CLIP`` scale units so one extreme bar cannot own the search.
``huber`` (price models)
    loss = mean_t huber(s_t - y_t) + weight_decay * |w|^2, y the scaled
    h-bar move (the engine's price target), huber with delta 1.
``log_loss`` (gradient descent's direction model)
    loss = mean_t [ log(1 + e^s_t) - y_t * s_t ] + weight_decay * |w|^2,
    y the up / down label: a logistic regression trained by the optimiser.

The utility is IN-SAMPLE: the rows are the training span's (targets read
through ``MarketView.fit_rows``, prices through a tape that stops at the last
training row + h + 1). The validation problem is the same arithmetic on the
validation rows, used only to choose which generation is kept.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from cycle.bridges.tape import RewardTape

PROBLEM_KINDS = ("utility", "huber", "log_loss")
MOVE_CLIP = 10.0                  # scale units; a move beyond this is one extreme bar
HUBER_DELTA = 1.0


def finite_rows(features: np.ndarray, rows) -> np.ndarray:
    rows = np.asarray(rows, dtype=np.int64).reshape(-1)
    if rows.size == 0:
        return rows
    return rows[np.all(np.isfinite(features[rows]), axis=1)]


@dataclass(eq=False)
class Problem:
    """One population objective (see the module docstring). ``inputs`` are the
    rows' feature vectors (float64, n x F); ``target`` the label or price target
    (``huber`` / ``log_loss``); ``move`` and ``cost`` the tape (``utility``)."""

    kind: str
    rows: np.ndarray
    inputs: np.ndarray
    weight_decay: float = 0.0
    target: np.ndarray | None = None
    move: np.ndarray | None = None
    cost: np.ndarray | None = None

    def __post_init__(self) -> None:
        if self.kind not in PROBLEM_KINDS:
            raise ValueError(f"problem kind must be one of {PROBLEM_KINDS}, got {self.kind!r}")
        self.inputs = np.ascontiguousarray(self.inputs, dtype=np.float64)
        if self.kind == "utility" and (self.move is None or self.cost is None):
            raise ValueError("a utility problem needs the tape's move and cost")
        if self.kind != "utility" and self.target is None:
            raise ValueError(f"a {self.kind} problem needs a target")

    @property
    def row_count(self) -> int:
        return int(self.inputs.shape[0])

    @property
    def feature_count(self) -> int:
        return int(self.inputs.shape[1])

    @property
    def dimension(self) -> int:
        """Weights plus the bias."""
        return self.feature_count + 1

    # ── builders ──
    @classmethod
    def from_tape(cls, features: np.ndarray, tape: RewardTape, rows, weight_decay: float = 0.0) -> Problem:
        """The utility problem on ``rows`` (those with a finite feature row and a known reward)."""
        rows = finite_rows(features, rows)
        long_reward = tape.position_reward(rows, 1.0)
        short_reward = tape.position_reward(rows, -1.0)
        known = np.isfinite(long_reward) & np.isfinite(short_reward)
        rows, long_reward, short_reward = rows[known], long_reward[known], short_reward[known]
        move = np.clip((long_reward - short_reward) / 2.0, -MOVE_CLIP, MOVE_CLIP)
        cost = np.maximum(-(long_reward + short_reward) / 2.0, 0.0)
        return cls("utility", rows, features[rows], float(weight_decay), move=move, cost=cost)

    @classmethod
    def from_targets(cls, kind: str, features: np.ndarray, targets: np.ndarray, rows,
                     weight_decay: float = 0.0) -> Problem:
        """A ``huber`` or ``log_loss`` problem on the rows with finite features and target."""
        rows = finite_rows(features, rows)
        values = np.asarray(targets, dtype=np.float64)[rows]
        known = np.isfinite(values)
        rows, values = rows[known], values[known]
        if kind == "log_loss":
            values = (values >= 0.5).astype(np.float64)
        return cls(kind, rows, features[rows], float(weight_decay), target=values)

    # ── scoring ──
    def _split(self, thetas) -> tuple[np.ndarray, np.ndarray]:
        thetas = np.atleast_2d(np.asarray(thetas, dtype=np.float64))
        if thetas.shape[1] != self.dimension:
            raise ValueError(f"a candidate has {thetas.shape[1]} values; this problem has {self.dimension} "
                             f"({self.feature_count} weights and a bias)")
        return thetas[:, :-1], thetas[:, -1]

    def scores(self, thetas) -> np.ndarray:
        """(n, population) scores s = X w + b."""
        weights, bias = self._split(thetas)
        return self.inputs @ weights.T + bias[None, :]

    def penalty(self, thetas) -> np.ndarray:
        weights, _ = self._split(thetas)
        return self.weight_decay * np.sum(weights * weights, axis=1)

    def data_loss_from_scores(self, scores: np.ndarray) -> np.ndarray:
        """The loss without the weight penalty, from (n, population) scores."""
        scores = np.asarray(scores, dtype=np.float64)
        if scores.ndim == 1:
            scores = scores[:, None]
        if self.row_count == 0:
            return np.full(scores.shape[1], np.nan)
        if self.kind == "utility":
            return -self.utility_from_positions(np.tanh(scores))
        if self.kind == "huber":
            residual = scores - self.target[:, None]
            absolute = np.abs(residual)
            loss = np.where(absolute <= HUBER_DELTA, 0.5 * residual * residual, HUBER_DELTA * (absolute - 0.5 * HUBER_DELTA))
            return loss.mean(axis=0)
        return (np.logaddexp(0.0, scores) - self.target[:, None] * scores).mean(axis=0)

    def utility_from_positions(self, positions: np.ndarray) -> np.ndarray:
        """Mean net utility per bar of (n, population) positions in [-1, 1] (utility problems only)."""
        if self.kind != "utility":
            raise TypeError(f"a {self.kind} problem has no trading utility")
        positions = np.asarray(positions, dtype=np.float64)
        if positions.ndim == 1:
            positions = positions[:, None]
        if self.row_count == 0:
            return np.full(positions.shape[1], np.nan)
        return (positions * self.move[:, None] - np.abs(positions) * self.cost[:, None]).mean(axis=0)

    def loss(self, thetas) -> np.ndarray:
        """One loss per candidate (row of ``thetas``), penalty included: the searchers' objective."""
        return self.data_loss_from_scores(self.scores(thetas)) + self.penalty(thetas)

    def loss_and_gradient(self, theta) -> tuple[float, np.ndarray]:
        """The loss of one candidate and its exact gradient (gradient descent and
        the basin-hopping local solver). |tanh| has the subgradient 0 at 0."""
        theta = np.asarray(theta, dtype=np.float64).reshape(-1)
        weights, bias = theta[:-1], theta[-1]
        score = self.inputs @ weights + bias
        count = max(self.row_count, 1)
        if self.kind == "utility":
            position = np.tanh(score)
            value = -float(np.mean(position * self.move - np.abs(position) * self.cost))
            slope = -(1.0 - position * position) * (self.move - np.sign(position) * self.cost) / count
        elif self.kind == "huber":
            residual = score - self.target
            absolute = np.abs(residual)
            value = float(np.mean(np.where(absolute <= HUBER_DELTA, 0.5 * residual * residual,
                                           HUBER_DELTA * (absolute - 0.5 * HUBER_DELTA))))
            slope = np.clip(residual, -HUBER_DELTA, HUBER_DELTA) / count
        else:
            value = float(np.mean(np.logaddexp(0.0, score) - self.target * score))
            slope = (1.0 / (1.0 + np.exp(-np.clip(score, -500.0, 500.0))) - self.target) / count
        if self.row_count == 0:
            return math.nan, np.zeros_like(theta)
        gradient = np.empty_like(theta)
        gradient[:-1] = self.inputs.T @ slope + 2.0 * self.weight_decay * weights
        gradient[-1] = float(np.sum(slope))
        value += self.weight_decay * float(weights @ weights)
        return value, gradient


@dataclass(eq=False)
class LinearPolicy:
    """score s = x . weights + bias; NaN on a row with a missing feature."""

    weights: np.ndarray
    bias: float

    @classmethod
    def from_theta(cls, theta) -> LinearPolicy:
        theta = np.asarray(theta, dtype=np.float64).reshape(-1)
        return cls(theta[:-1].copy(), float(theta[-1]))

    @property
    def theta(self) -> np.ndarray:
        return np.concatenate([self.weights, [self.bias]])

    def score(self, features: np.ndarray, index) -> np.ndarray:
        rows = np.asarray(index, dtype=np.int64).reshape(-1)
        block = np.asarray(features[rows], dtype=np.float64)
        out = np.full(rows.shape[0], np.nan)
        known = np.all(np.isfinite(block), axis=1)
        if known.any():
            # a row-by-row dot product, so a row scored alone equals the same row in a batch bit for bit
            out[known] = np.einsum("ij,j->i", block[known], self.weights) + self.bias
        return out

    def copy(self) -> LinearPolicy:
        return LinearPolicy(self.weights.copy(), float(self.bias))

    def to_dict(self) -> dict:
        return {"form": "linear", "weights": [float(value) for value in self.weights], "bias": float(self.bias)}

    @classmethod
    def from_dict(cls, document: dict) -> LinearPolicy:
        return cls(np.asarray(document["weights"], dtype=np.float64), float(document["bias"]))


__all__ = ["HUBER_DELTA", "MOVE_CLIP", "PROBLEM_KINDS", "LinearPolicy", "Problem", "finite_rows"]
