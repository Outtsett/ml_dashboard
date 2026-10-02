"""``SignalProgramAdapter``: a mathematical program as the trainer of a linear signal score.

Fit (one fold):

1. ``SignalStatistics`` of the training rows whose price target is known: each
   feature column is a signal; its information coefficient mu, the Ledoit-Wolf
   covariance of the signals' profit streams, the signal correlations and the
   least-squares moments (``signal_statistics``). Only training rows are read,
   and the price target of a training row resolves before validation starts.
2. The variant's program (``programs/<variant>.py``) solves for the weights w,
   reporting one epoch per solver pass (``step_unit`` ``solver_pass``) with a
   Pause / Stop checkpoint between passes. The solver status, objective, gap
   or bound, dual prices and iterations are logged. Validation rows are scored
   after every pass for the chart only: nothing is selected on them.
3. The score of bar t is s_t = w . x_t (+ an intercept for the interior-point
   program). Direction model: P(up) = sigmoid(slope * s + intercept) with the
   curve fitted by maximum likelihood on the VALIDATION rows (``bridges.calibration.ValidationCurve``;
   registry ``logistic_curve_on_validation``), except the interior-point
   program, whose L1 logistic regression gives P(up) = sigmoid(s) itself
   (``predict_proba``). Price model: beta * s, beta the through-origin least-squares
   slope of the clipped price target on the training scores (the
   interior-point price model forecasts the target directly).

Prediction at bar t reads only the feature row of t, so it is causal and a
row scored alone equals the batch. A row whose used signal is missing gets NaN.
The saved model is the weights plus the calibration (``model.npz`` and
``program.json``); nothing of the market view is needed to reload it.
"""

from __future__ import annotations

import math
import time
from pathlib import Path

import numpy as np

from cycle.adapter import BatchReport, EpochReport
from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.calibration import ValidationCurve, sigmoid
from cycle.bridges.groups import feature_category
from cycle.bridges.training import score as validation_score

from . import programs
from .signal_statistics import SignalStatistics

PROGRAM_FILE = "program.json"


def _plain(value):
    """JSON-safe and comparable: non-finite floats become None, numpy scalars plain Python."""
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        value = float(value)
        return value if math.isfinite(value) else None
    return value


def _finite(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


class SignalProgramAdapter(BridgeAdapter):
    step_unit = "solver_pass"
    model_file = "model.npz"

    def __init__(self, key, entry, parameters, device, seed, task="classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if self.variant not in programs.VARIANTS:
            raise ValueError(f"{key}: unknown signal program variant {self.variant!r}; "
                             f"known: {', '.join(programs.VARIANTS)}")
        self.weights: np.ndarray | None = None
        self.intercept = 0.0
        self.link = "linear"
        self.curve: ValidationCurve | None = None
        self.slope_to_target = 0.0
        self.program_status = ""
        self.program_objective = 0.0
        self.diagnostics: dict = {}
        self.feature_names: tuple[str, ...] = ()

    # ── the score ──
    def _score(self, features: np.ndarray, index: np.ndarray, weights: np.ndarray | None = None,
               intercept: float | None = None) -> np.ndarray:
        weights = self.weights if weights is None else weights
        intercept = self.intercept if intercept is None else intercept
        index = np.asarray(index, dtype=np.int64)
        used = np.flatnonzero(weights != 0.0)
        if used.size == 0:
            return np.full(index.size, float(intercept))
        rows = np.asarray(features[index][:, used], dtype=np.float64)
        return rows @ weights[used] + float(intercept)

    def _target_slope(self, statistics: SignalStatistics, features, rows, weights, intercept) -> float:
        """Through-origin least squares of the clipped price target on the training scores."""
        target = self.market.price_targets
        scores = self._score(features, rows, weights, intercept)
        values = np.clip(np.asarray(target, dtype=np.float64)[rows], *statistics.target_clip)
        keep = np.isfinite(scores) & np.isfinite(values)
        denominator = float(scores[keep] @ scores[keep])
        return float(scores[keep] @ values[keep]) / denominator if denominator > 0.0 else 0.0

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        started = time.perf_counter()
        view = self.require_market()
        price_targets = np.asarray(view.price_targets, dtype=np.float64)
        rows = train_index[np.isfinite(price_targets[train_index])]
        column_count = int(features.shape[1])
        names = tuple(view.feature_names) if len(view.feature_names) == column_count \
            else tuple(f"feature_{column}" for column in range(column_count))
        categories = tuple(feature_category(name) for name in names)
        statistics = SignalStatistics.from_rows(
            features, price_targets, rows, names,
            labels=labels if self.task == "classification" else None, categories=categories)
        self.feature_names = names

        def log(message: str) -> None:
            reporter.log(f"{self.key}: {message}")

        usable = int(statistics.usable.sum())
        strongest = np.argsort(-np.abs(statistics.mu), kind="stable")[:3]
        log(f"train-span statistics over {statistics.row_count} bars: {usable} of {column_count} signals usable; "
            "strongest information coefficients " + ", ".join(
                f"{names[column]} {programs.number(statistics.mu[column])}" for column in strongest))
        validation_rows = np.asarray(validation_index, dtype=np.int64)
        validation_target = (np.asarray(labels, dtype=np.float64) if self.task == "classification"
                             else price_targets)[validation_rows] if validation_rows.size else np.empty(0)

        def score_validation(weights, intercept, link):
            if validation_rows.size == 0:
                return None
            scores = self._score(features, validation_rows, weights, intercept)
            if self.task == "classification":
                prediction = sigmoid(scores) if link == "native" else ValidationCurve.fit(scores, validation_target).apply(scores)
            elif link == "native":
                prediction = scores
            else:
                prediction = self._target_slope(statistics, features, rows, weights, intercept) * scores
            return validation_score(self.task, prediction, validation_target)

        solve = programs.program(self.variant)
        planned = programs.planned_passes(self.variant, self.parameters)
        generator = solve(statistics, self.parameters, log, self.task)
        result = None
        epoch = 0
        span_start = int(rows[0]) if rows.size else int(train_index[0])
        span_end = int(rows[-1]) if rows.size else int(train_index[-1])
        while result is None:
            epoch += 1
            reporter.checkpoint()
            reporter.epoch_started(epoch, max(planned, epoch))
            pass_started = time.perf_counter()
            try:
                update = next(generator)
                weights, intercept, objective, link = update.weights, update.intercept, update.objective, "linear"
            except StopIteration as finished:
                result = finished.value
                weights, intercept, objective, link = result.weights, result.intercept, result.objective, result.link
            weights = statistics.to_feature_weights(weights)
            elapsed = max(time.perf_counter() - pass_started, 1e-9)
            epoch_count = max(planned, epoch)
            reporter.batch(BatchReport(epoch=epoch, epoch_count=epoch_count, batch=1, batch_count=1,
                                       span_start_index=span_start, span_end_index=span_end,
                                       train_loss=_finite(-objective), learning_rate=None, gradient_norm=None,
                                       samples_per_second=_finite(statistics.row_count / elapsed)))
            reporter.checkpoint()
            reporter.validating(epoch, epoch_count)
            scored = score_validation(weights, intercept, link)
            reporter.epoch_finished(EpochReport(
                epoch=epoch, epoch_count=epoch_count, train_loss=_finite(-objective),
                validation_loss=_finite(scored.loss) if scored else None,
                validation_accuracy=_finite(scored.accuracy) if scored else None,
                validation_f1_score=_finite(scored.f1_score) if scored else None,
                is_best=result is not None, stopped_early=result is not None and epoch < planned))
        self.weights = statistics.to_feature_weights(result.weights)
        self.intercept = float(result.intercept)
        self.link = result.link
        self.program_status = str(result.status)
        self.program_objective = float(result.objective)
        self.diagnostics = _plain(result.diagnostics)
        self.curve = None
        self.slope_to_target = 0.0
        if self.task == "classification" and self.link == "linear":
            scores = self._score(features, validation_rows, self.weights, self.intercept) if validation_rows.size \
                else np.empty(0)
            self.curve = ValidationCurve.fit(scores, validation_target)
            log(f"P(up) = sigmoid({programs.number(self.curve.slope)} * score + {programs.number(self.curve.intercept)}), "
                f"fitted on {self.curve.row_count} validation bars")
        elif self.task == "regression" and self.link == "linear":
            self.slope_to_target = self._target_slope(statistics, features, rows, self.weights, self.intercept)
            log(f"price forecast = {programs.number(self.slope_to_target)} * score (training-span least squares)")
        self.best_iteration = epoch
        self.fit_summary = _plain({
            "program_status": self.program_status,
            "program_objective": self.program_objective,
            "selected_signal_count": int(np.count_nonzero(self.weights)),
            "statistics_row_count": statistics.row_count,
            "solver_passes": epoch,
            "fit_seconds": time.perf_counter() - started,
        })

    # ── predict ──
    def _predict_probability(self, features, index) -> np.ndarray:
        scores = self._score(features, index)
        if self.link == "native":
            return sigmoid(scores)
        return self.curve.apply(scores)

    def _predict_value(self, features, index) -> np.ndarray:
        scores = self._score(features, index)
        return scores if self.link == "native" else self.slope_to_target * scores

    # ── save / load ──
    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "scipy", "scikit-learn", "cvxpy", "clarabel", "osqp")

    def _save_state(self, folder: Path) -> str:
        persistence.save_arrays(folder / self.model_file, weights=self.weights)
        persistence.save_json(folder / PROGRAM_FILE, _plain({
            "variant": self.variant,
            "link": self.link,
            "intercept": self.intercept,
            "curve": self.curve.to_dict() if self.curve is not None else None,
            "slope_to_target": self.slope_to_target,
            "status": self.program_status,
            "objective": self.program_objective,
            "feature_names": list(self.feature_names),
            "diagnostics": self.diagnostics,
        }))
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        self.weights = persistence.load_arrays(folder / metadata.get("model_file", self.model_file))["weights"]
        document = persistence.load_json(folder / PROGRAM_FILE)
        self.link = document["link"]
        self.intercept = float(document["intercept"] or 0.0)
        self.curve = ValidationCurve.from_dict(document["curve"]) if document.get("curve") else None
        self.slope_to_target = float(document.get("slope_to_target") or 0.0)
        self.program_status = document.get("status", "")
        self.program_objective = float(document.get("objective") or 0.0)
        self.feature_names = tuple(document.get("feature_names") or ())
        self.diagnostics = document.get("diagnostics") or {}


__all__ = ["SignalProgramAdapter"]
