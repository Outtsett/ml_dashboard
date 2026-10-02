"""What every pseudo-label loop shares: the fit context and the save / load contract.

A loop is fitted once per fold from a ``FitContext``: the feature matrix, the
targets (1 up / 0 down, or the clipped scaled move), the semi-supervised split
of the training span (``graph_label_inference.nodes``: labelled rows keep their
target, unlabelled rows are the pool pseudo-labels are drawn from) and the
validation rows (scored after every pass, never pseudo-labelled, never fitted
on). A loop records every row it ever pseudo-labelled in ``pseudo_labelled_rows``
so the tests can check the pool: span rows only.

``score(matrix)`` maps finite feature rows (one row per bar, nothing else) to
P(up), a decision value (the transductive SVM, mapped to P(up) by the adapter's
validation curve) or the price.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from cycle.bridges.training import ValidationScore, score


@dataclass
class FitContext:
    features: np.ndarray
    targets: np.ndarray            # float64; NaN where unknown (never read on unlabelled rows)
    labelled: np.ndarray           # int64 rows
    unlabelled: np.ndarray         # int64 rows (the pool)
    validation: np.ndarray         # int64 rows with a finite feature row and target
    task: str
    reporter: object
    name: str

    def matrix(self, rows, columns=None) -> np.ndarray:
        values = np.asarray(self.features[np.asarray(rows, dtype=np.int64)], dtype=np.float64)
        return values if columns is None else values[:, columns]


class Loop:
    #: the loop's P(up) is a decision value the adapter maps through a validation curve
    decision_score = False

    def __init__(self, parameters: dict, seed: int, task: str) -> None:
        self.parameters = parameters
        self.seed = int(seed)
        self.task = task
        self.pseudo_labelled_rows = np.empty(0, dtype=np.int64)
        self.summary: dict = {}

    def validation_score(self, context: FitContext) -> ValidationScore:
        prediction = self.score(context.matrix(context.validation)) if context.validation.size else np.empty(0)
        if self.decision_score and self.task == "classification":
            from cycle.bridges.calibration import ValidationCurve

            curve = ValidationCurve.fit(prediction, context.targets[context.validation])
            prediction = curve.apply(prediction)
        return score(self.task, prediction, context.targets[context.validation])

    def record(self, rows) -> None:
        rows = np.asarray(rows, dtype=np.int64)
        if rows.size:
            self.pseudo_labelled_rows = np.union1d(self.pseudo_labelled_rows, rows)

    # a loop writes these
    def fit(self, context: FitContext) -> dict:
        raise NotImplementedError

    def score(self, matrix: np.ndarray) -> np.ndarray:
        raise NotImplementedError

    def save(self, folder: Path) -> dict:
        """Write the loop's files; return the layout document ``restore`` reads."""
        raise NotImplementedError

    def restore(self, folder: Path, layout: dict) -> None:
        raise NotImplementedError


def seeded(seed: int, *salt: int) -> np.random.Generator:
    return np.random.default_rng((int(seed), *(int(value) for value in salt)))


def bootstrap(rows: np.ndarray, generator: np.random.Generator) -> np.ndarray:
    rows = np.asarray(rows, dtype=np.int64)
    return rows[generator.integers(0, rows.size, rows.size)]


def lowest_share(values: np.ndarray, share: float) -> np.ndarray:
    """Positions of the ``share`` of ``values`` that are smallest (at least one; stable order)."""
    values = np.asarray(values, dtype=np.float64)
    if values.size == 0:
        return np.empty(0, dtype=np.int64)
    count = int(min(values.size, max(1, int(np.ceil(float(share) * values.size)))))
    return np.sort(np.argsort(values, kind="stable")[:count])


__all__ = ["FitContext", "Loop", "bootstrap", "lowest_share", "seeded"]
