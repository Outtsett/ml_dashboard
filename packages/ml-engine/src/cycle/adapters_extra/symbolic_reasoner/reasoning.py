"""What every symbolic engine shares: the evaluation context and the engine base class.

An engine turns grounded predicates (``predicates.PredicateBank``) or feature
columns into one **score** per bar (larger = more bullish). The adapter maps
the score to P(up) with a logistic curve fitted on the validation rows only
(``cycle.bridges.calibration.ValidationCurve``); a price-capable engine
(``has_value``) also predicts the scaled move directly.

Causality: ``Context`` evaluates predicates at the asked rows only (each
predicate reads bars <= its row); an engine's fitted state comes from training
rows (``train_rows``) only; validation rows reach the adapter's calibration
curve, never an engine's fit.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from cycle.adapters_extra.symbolic_reasoner.predicates import PredicateBank


@dataclass
class Context:
    features: np.ndarray
    view: object | None
    bank: PredicateBank | None
    cache: dict = field(default_factory=dict)
    log: Callable[[str], None] = lambda message: None

    def values(self, rows) -> np.ndarray:
        return self.bank.values(self.view, self.features, rows, self.cache)

    def truth(self, rows) -> np.ndarray:
        return self.bank.truth(self.values(rows))

    def degree(self, rows) -> np.ndarray:
        return self.bank.degree(self.values(rows))


def unique_rows(matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(unique rows, inverse) with NaN encoded as -1, so identical fact vectors share one evaluation."""
    coded = np.where(np.isnan(matrix), -1.0, matrix)
    if coded.shape[0] == 0:
        return coded, np.empty(0, dtype=np.int64)
    unique, inverse = np.unique(coded, axis=0, return_inverse=True)
    return unique, np.asarray(inverse, dtype=np.int64).reshape(-1)


def logit(probability) -> np.ndarray:
    probability = np.clip(np.asarray(probability, dtype=np.float64), 1e-6, 1 - 1e-6)
    return np.log(probability / (1.0 - probability))


def to_list(values) -> list:
    return np.asarray(values, dtype=np.float64).tolist()


class Engine:
    """Base class; see the module docstring."""

    #: the engine reasons over the predicate bank (built by the adapter before ``fit``)
    uses_predicates = True
    #: trained over epochs (``begin`` / ``train_epoch`` / ``snapshot`` / ``restore``) instead of one ``fit``
    iterative = False
    #: predicts the scaled move for a price model (task "regression")
    has_value = False
    #: the smallest number of rows (this bar included) the score reads
    history = 1

    def __init__(self, parameters: dict, seed: int, task: str) -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.task = task
        self.summary: dict = {}

    # single fit
    def fit(self, context: Context, train_rows: np.ndarray, target: np.ndarray, direction: np.ndarray) -> float | None:
        raise NotImplementedError

    # iterative fit
    def begin(self, context: Context, train_rows: np.ndarray, target: np.ndarray, direction: np.ndarray) -> None:
        raise NotImplementedError

    def train_epoch(self, epoch: int, report_batch) -> float | None:
        raise NotImplementedError

    def snapshot(self):
        raise NotImplementedError

    def restore(self, saved) -> None:
        raise NotImplementedError

    def epoch_count(self) -> int:
        return int(self.parameters.get("epochs", 1))

    # prediction
    def score(self, context: Context, rows: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def value(self, context: Context, rows: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    # persistence (plain JSON)
    def state(self) -> dict:
        raise NotImplementedError

    def load(self, state: dict) -> None:
        raise NotImplementedError


__all__ = ["Context", "Engine", "logit", "to_list", "unique_rows"]
