"""The base learners every pseudo-label loop retrains, and the round loop they report through.

``base_learner`` picks one of three scikit-learn estimators, each with a
direction (classifier) and a price (regressor) form:

    logistic            LogisticRegression(C = regularization_strength) / Ridge(alpha = 1 / C)
    gradient_boosting   HistGradientBoosting, 100 rounds of 15-leaf trees, learning rate 0.1,
                        no early stopping (a fit reads only the rows it is given)
    random_forest       40 trees of depth <= 8, >= 20 rows per leaf

Fits and predictions run under a small BLAS / OpenMP thread limit: a pool of
every core per call thrashes when several runs share the machine.

``run_rounds`` is the solver-pass loop: one pass = one ``epoch_started`` /
``batch`` / ``validating`` / ``epoch_finished`` group with ``step_unit``
``solver_pass``, a ``checkpoint`` before the pass and before its validation
(Pause blocks, Stop raises ``StopRequested`` and is never caught). The loop ends
when a pass reports no further change or at ``maximum_rounds``.
"""

from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Callable

import numpy as np

from cycle.adapter import BatchReport, EpochReport
from cycle.bridges import persistence
from cycle.bridges.training import ValidationScore

BASE_LEARNERS = ("logistic", "gradient_boosting", "random_forest")
THREAD_LIMIT = 4
_CONTROLLER = None


def limited_threads():
    """A context that caps BLAS and OpenMP pools at ``THREAD_LIMIT`` threads."""
    global _CONTROLLER
    from threadpoolctl import ThreadpoolController

    if _CONTROLLER is None:
        _CONTROLLER = ThreadpoolController()
    return _CONTROLLER.limit(limits=THREAD_LIMIT)


def make_learner(base_learner: str, task: str, regularization_strength: float, seed: int):
    if base_learner not in BASE_LEARNERS:
        raise ValueError(f"base_learner must be one of {BASE_LEARNERS}, got {base_learner!r}")
    seed = int(seed) % (2 ** 31 - 1)
    if task == "classification":
        if base_learner == "logistic":
            from sklearn.linear_model import LogisticRegression

            return LogisticRegression(C=float(regularization_strength), max_iter=1000)
        if base_learner == "gradient_boosting":
            from sklearn.ensemble import HistGradientBoostingClassifier

            return HistGradientBoostingClassifier(max_iter=100, learning_rate=0.1, max_leaf_nodes=15,
                                                  min_samples_leaf=20, l2_regularization=1.0, early_stopping=False,
                                                  random_state=seed)
        from sklearn.ensemble import RandomForestClassifier

        return RandomForestClassifier(n_estimators=40, max_depth=8, min_samples_leaf=20, random_state=seed, n_jobs=1)
    if base_learner == "logistic":
        from sklearn.linear_model import Ridge

        return Ridge(alpha=1.0 / float(regularization_strength))
    if base_learner == "gradient_boosting":
        from sklearn.ensemble import HistGradientBoostingRegressor

        return HistGradientBoostingRegressor(max_iter=100, learning_rate=0.1, max_leaf_nodes=15, min_samples_leaf=20,
                                             l2_regularization=1.0, early_stopping=False, random_state=seed)
    from sklearn.ensemble import RandomForestRegressor

    return RandomForestRegressor(n_estimators=40, max_depth=8, min_samples_leaf=20, random_state=seed, n_jobs=1)


def fit(learner, matrix: np.ndarray, target: np.ndarray, sample_weight: np.ndarray | None = None):
    matrix = np.asarray(matrix, dtype=np.float64)
    target = np.asarray(target)
    with limited_threads():
        if sample_weight is None:
            learner.fit(matrix, target)
        else:
            learner.fit(matrix, target, sample_weight=np.asarray(sample_weight, dtype=np.float64))
    return learner


def up_probability(learner, matrix: np.ndarray) -> np.ndarray:
    """P(class 1) of a fitted classifier (0 when it saw class 0 only, 1 when class 1 only)."""
    matrix = np.asarray(matrix, dtype=np.float64)
    if matrix.shape[0] == 0:
        return np.empty(0, dtype=np.float64)
    classes = list(learner.classes_)
    if 1 not in classes:
        return np.zeros(matrix.shape[0])
    with limited_threads():
        probability = learner.predict_proba(matrix)
    return np.asarray(probability[:, classes.index(1)], dtype=np.float64)


def value(learner, matrix: np.ndarray) -> np.ndarray:
    matrix = np.asarray(matrix, dtype=np.float64)
    if matrix.shape[0] == 0:
        return np.empty(0, dtype=np.float64)
    with limited_threads():
        return np.asarray(learner.predict(matrix), dtype=np.float64)


def save_learners(folder: Path, prefix: str, learners: list) -> list[str]:
    names = []
    for position, learner in enumerate(learners):
        name = f"{prefix}_{position}.joblib"
        persistence.save_joblib(folder / name, learner)
        names.append(name)
    return names


def load_learners(folder: Path, names: list[str]) -> list:
    return [persistence.load_joblib(folder / name) for name in names]


def _finite(number) -> float | None:
    if number is None:
        return None
    number = float(number)
    return number if math.isfinite(number) else None


def run_rounds(reporter, *, maximum_rounds: int, train_index, step: Callable[[int], tuple[float | None, bool]],
               validate: Callable[[], ValidationScore], name: str = "") -> dict:
    """Solver passes until ``step(pass)`` returns ``(train_loss, False)`` or
    ``maximum_rounds`` passes ran; ``validate()`` scores the model as the pass
    left it. Returns {"solver_passes", "best_pass", "best_validation_loss",
    "last_validation_loss", "fit_seconds"}."""
    reporter.step_unit = "solver_pass"
    rows = np.asarray(train_index, dtype=np.int64)
    maximum_rounds = max(1, int(maximum_rounds))
    started = time.perf_counter()
    best = math.inf
    best_pass = 0
    best_loss = last_loss = None
    passes = 0
    for number in range(1, maximum_rounds + 1):
        passes = number
        reporter.checkpoint()
        reporter.epoch_started(number, maximum_rounds)
        pass_started = time.perf_counter()
        loss, more = step(number)
        elapsed = max(time.perf_counter() - pass_started, 1e-9)
        reporter.batch(BatchReport(epoch=number, epoch_count=maximum_rounds, batch=1, batch_count=1,
                                   span_start_index=int(rows[0]), span_end_index=int(rows[-1]),
                                   train_loss=_finite(loss), samples_per_second=rows.size / elapsed))
        reporter.checkpoint()
        reporter.validating(number, maximum_rounds)
        result = validate()
        selection = _finite(result.selection)
        is_best = selection is not None and selection < best
        if is_best:
            best, best_pass, best_loss = selection, number, _finite(result.loss)
        last_loss = _finite(result.loss)
        stop = not more
        reporter.epoch_finished(EpochReport(epoch=number, epoch_count=maximum_rounds, train_loss=_finite(loss),
                                            validation_loss=last_loss, validation_accuracy=_finite(result.accuracy),
                                            validation_f1_score=_finite(result.f1_score), is_best=is_best,
                                            stopped_early=stop and number < maximum_rounds))
        if stop:
            break
    return {"solver_passes": passes, "best_pass": best_pass or passes, "best_validation_loss": best_loss,
            "last_validation_loss": last_loss, "fit_seconds": time.perf_counter() - started}


__all__ = ["BASE_LEARNERS", "fit", "limited_threads", "load_learners", "make_learner", "run_rounds",
           "save_learners", "up_probability", "value"]
