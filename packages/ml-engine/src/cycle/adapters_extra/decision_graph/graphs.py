"""What every decision-graph engine shares: the engine base class, the decision
and utility nodes, and a posterior cache keyed by the evidence tuple.

A decision node D in {short, flat, long} = {-1, 0, +1} with a utility node
U(d, o) = d mu_o - risk_aversion d^2 s2_o - |d| cost over an outcome node o
(``outcome_bin_count`` training-quantile bins of the scaled h-bar move, with
their training means mu_o and variances s2_o; cost = the median round trip in
scaled units over the training span). The expected utility of a decision is
sum_o P(o | evidence) U(d, o); the engines score a bar by EU(long) - EU(short)
and report the expected-utility-maximising decision.
"""

from __future__ import annotations

import numpy as np

from cycle.bridges.binning import QuantileBins

DECISIONS = np.array([-1.0, 0.0, 1.0])       # short, flat, long


class Engine:
    iterative = False
    has_value = False
    history = 1

    def __init__(self, parameters: dict, seed: int, task: str) -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.task = task
        self.summary: dict = {}
        self._posterior_cache: dict = {}

    def fit(self, context, train_rows, target, direction) -> float | None:
        raise NotImplementedError

    def begin(self, context, train_rows, target, direction) -> None:
        raise NotImplementedError

    def train_epoch(self, epoch, report_batch) -> float | None:
        raise NotImplementedError

    def snapshot(self):
        raise NotImplementedError

    def restore(self, saved) -> None:
        raise NotImplementedError

    def epoch_count(self) -> int:
        return int(self.parameters.get("epochs", 1))

    def score(self, context, rows) -> np.ndarray:
        raise NotImplementedError

    def value(self, context, rows) -> np.ndarray:
        raise NotImplementedError

    def state(self) -> dict:
        raise NotImplementedError

    def load(self, state: dict) -> None:
        raise NotImplementedError

    def cached_posteriors(self, evidence: np.ndarray, answer) -> np.ndarray:
        """``answer(evidence_row) -> probability vector`` evaluated once per distinct evidence row."""
        if evidence.shape[0] == 0:
            return np.empty((0, 0))
        unique, inverse = np.unique(evidence, axis=0, return_inverse=True)
        inverse = np.asarray(inverse).reshape(-1)
        results = []
        for row in unique:
            key = tuple(int(v) for v in row)
            if key not in self._posterior_cache:
                self._posterior_cache[key] = answer(row)
            results.append(self._posterior_cache[key])
        return np.asarray(results)[inverse]


class OutcomeUtility:
    """The outcome bins of the scaled move and the utility table U(d, o)."""

    def __init__(self, bins: QuantileBins, means: np.ndarray, variances: np.ndarray, cost: float,
                 risk_aversion: float) -> None:
        self.bins = bins
        self.means = np.asarray(means, dtype=np.float64)
        self.variances = np.asarray(variances, dtype=np.float64)
        self.cost = float(cost)
        self.risk_aversion = float(risk_aversion)

    @classmethod
    def fit(cls, moves: np.ndarray, bin_count: int, cost: float, risk_aversion: float) -> OutcomeUtility:
        moves = np.asarray(moves, dtype=np.float64)
        moves = moves[np.isfinite(moves)]
        bins = QuantileBins.fit(moves, bin_count)
        codes = bins.assign(moves)
        means = np.array([moves[codes == k].mean() if (codes == k).any() else 0.0 for k in range(bins.bin_count)])
        variances = np.array([moves[codes == k].var() if (codes == k).sum() > 1 else 0.0 for k in range(bins.bin_count)])
        return cls(bins, means, variances, cost, risk_aversion)

    @property
    def count(self) -> int:
        return self.bins.bin_count

    def codes(self, moves) -> np.ndarray:
        return self.bins.assign(np.asarray(moves, dtype=np.float64))

    def table(self) -> np.ndarray:
        """(decisions, outcomes) utility."""
        d = DECISIONS[:, None]
        return d * self.means[None, :] - self.risk_aversion * d ** 2 * self.variances[None, :] - np.abs(d) * self.cost

    def expected_utility(self, posterior: np.ndarray) -> np.ndarray:
        """(rows, decisions)."""
        return posterior @ self.table().T

    def expected_move(self, posterior: np.ndarray) -> np.ndarray:
        return posterior @ self.means

    def to_dict(self) -> dict:
        return {"bins": self.bins.to_dict(), "means": self.means.tolist(), "variances": self.variances.tolist(),
                "cost": self.cost, "riskAversion": self.risk_aversion}

    @classmethod
    def from_dict(cls, document) -> OutcomeUtility:
        return cls(QuantileBins.from_dict(document["bins"]), np.asarray(document["means"]),
                   np.asarray(document["variances"]), float(document["cost"]), float(document["riskAversion"]))


def scaled_cost(view, rows) -> float:
    """The median round-trip cost over ``rows`` in units of the scaled move."""
    scale = np.asarray(view.move_scale, dtype=np.float64)[np.asarray(rows, dtype=np.int64)]
    scale = scale[np.isfinite(scale) & (scale > 0)]
    return float(np.median(float(view.round_trip_cost_points) / scale)) if scale.size else 0.0


def decision_shares(expected_utility: np.ndarray) -> dict:
    choice = np.argmax(expected_utility, axis=1) if expected_utility.size else np.empty(0, dtype=np.int64)
    total = max(choice.size, 1)
    return {"short": float((choice == 0).sum() / total), "flat": float((choice == 1).sum() / total),
            "long": float((choice == 2).sum() / total)}


__all__ = ["DECISIONS", "Engine", "OutcomeUtility", "decision_shares", "scaled_cost"]
