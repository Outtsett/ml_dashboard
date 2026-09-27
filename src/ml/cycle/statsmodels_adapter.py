"""Probit regression (statsmodels) behind the Model Cycle's `ModelAdapter` contract.

Built by ``models.build_adapter`` for the registry entry with ``adapter ==
"statsmodels"`` (``probit_regression`` in ``src/config/cycle_models/linear.json``)
through the registry constructor ``ProbitAdapter(key, entry, parameters, device,
seed, task=task)``. Direction model only: Probit has no regression form, the
entry's ``price`` is null and ``build_adapter`` hands the engine an
``adapter.NoPriceModel`` for ``task="regression"``.

    P(up) = Φ(β₀ + β · z)        Φ the standard normal CDF, z the features
                                  standardised with the TRAINING rows' mean and
                                  deviation, β₀ the intercept (``params[0]``)

- ``penalty_strength`` > 0: ``fit_regularized`` (L1, the intercept unpenalised,
  ``maxiter = max_iterations``); 0: the plain maximum-likelihood ``fit``.
- One library call on a daemon thread (``fitting.run_single_fit``), so Pause
  and Stop are checked every 0.2 s.
- Reported losses: log loss / accuracy at 0.5 / F1 of the up class
  (``models.binary_scores``), one ``single_fit`` step.

Attributes the explainer relies on: ``.result`` (the fitted statsmodels
results; ``params[0]`` is the intercept) and ``.scaler``.

Saved as ``model.joblib`` (joblib pickle: only load a directory this cycle
wrote itself) plus ``model.json``.
"""

from __future__ import annotations

import os
import warnings
from pathlib import Path

import numpy as np

from . import catalog
from .adapter import BatchReport, EpochReport, check_index
from .fitting import Stopwatch, run_single_fit
from .models import (
    _base_metadata,
    _require_both_classes,
    _training_summary,
    _wrong_task_error,
    binary_scores,
    write_metadata,
)

MODEL_FILE = "model.joblib"


def _as_index(index) -> np.ndarray:
    return np.asarray(index, dtype=np.int64).reshape(-1)


def _with_constant(matrix: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones(matrix.shape[0]), matrix])


class ProbitAdapter:
    available = True

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        if task != "classification":
            raise ValueError(f"{entry['displayName']} ({key}) has no regression form; its price slot is "
                             "adapter.NoPriceModel")
        if entry["adapter"] != "statsmodels":
            raise ValueError(f"{key}: its registry adapter is {entry['adapter']!r}, not 'statsmodels'")
        self.key = key
        self.family = key
        self.entry = entry
        self.task = task
        self.parameters = dict(parameters)
        self.device = "cpu"
        self.seed = int(seed)
        self.step_unit = entry["stepUnit"]
        self.label = entry["displayName"]
        self.result = None
        self.scaler = None
        self.best_iteration = None
        self.feature_count: int | None = None
        self.converged: bool | None = None
        self.fit_summary: dict = {}

    def minimum_history(self) -> int:
        return 1

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        from sklearn.preprocessing import StandardScaler

        train_index = _as_index(train_index)
        validation_index = _as_index(validation_index)
        if train_index.size == 0:
            raise ValueError(f"{self.key}: the training index is empty")
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        _require_both_classes(self.key, labels[train_index])
        self.feature_count = int(features.shape[1])
        reporter.step_unit = self.step_unit
        rows = np.asarray(features[train_index], dtype=np.float64)
        scaler = StandardScaler().fit(rows)
        design = _with_constant(scaler.transform(rows))
        target = np.asarray(labels[train_index] >= 0.5, dtype=np.float64)
        validation_design = _with_constant(scaler.transform(np.asarray(features[validation_index], dtype=np.float64)))
        validation_labels = np.asarray(labels[validation_index], dtype=np.float64)
        penalty = float(self.parameters["penalty_strength"])
        iterations = int(self.parameters["max_iterations"])

        def job():
            from scipy.stats import norm
            from statsmodels.discrete.discrete_model import Probit

            model = Probit(target, design)
            if penalty > 0:
                weights = np.full(design.shape[1], penalty)
                weights[0] = 0.0          # the intercept is never penalised
                result = model.fit_regularized(method="l1", alpha=weights, maxiter=iterations, disp=0)
            else:
                result = model.fit(maxiter=iterations, disp=0)
            params = np.asarray(result.params, dtype=np.float64)
            train_output = norm.cdf(design @ params)
            validation_output = norm.cdf(validation_design @ params) if validation_labels.size else None
            return result, train_output, validation_output

        reporter.epoch_started(1, 1)
        watch = Stopwatch()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            result, train_output, validation_output = run_single_fit(job, reporter, name=self.key)
        seconds = watch.seconds()
        self.result, self.scaler = result, scaler
        self.converged = bool(getattr(result, "mle_retvals", {}).get("converged", True))
        span = (int(train_index[0]), int(train_index[-1]))
        train_loss = binary_scores(train_output, target)["log_loss"]
        reporter.batch(BatchReport(
            epoch=1, epoch_count=1, batch=1, batch_count=1, span_start_index=span[0], span_end_index=span[1],
            train_loss=train_loss, samples_per_second=train_index.size / seconds,
        ))
        scores = {"log_loss": None, "accuracy": None, "f1_score": None}
        if validation_output is not None:
            reporter.validating(1, 1)
            scores = binary_scores(validation_output, validation_labels)
        reporter.epoch_finished(EpochReport(
            epoch=1, epoch_count=1, train_loss=train_loss, validation_loss=scores["log_loss"],
            validation_accuracy=scores["accuracy"], validation_f1_score=scores["f1_score"], is_best=True,
        ))
        how = f"L1 penalty {penalty:g}" if penalty > 0 else "maximum likelihood"
        reporter.log(f"{self.label}: {how} on {train_index.size:,} training bars in {seconds:.2f} s"
                     + ("" if self.converged else f" (did not converge within {iterations} iterations)"))
        for text in sorted({f"{w.category.__name__}: {w.message}" for w in caught})[:3]:
            reporter.log(f"{self.label}: {text}", "warn")
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            "training_row_count": int(train_index.size),
            "converged": self.converged,
            "best_validation_loss": scores["log_loss"],
            "fit_seconds": seconds,
        }

    def predict_probability(self, features, index) -> np.ndarray:
        from scipy.stats import norm

        if self.result is None:
            raise RuntimeError(f"{self.key}: predict_probability called before fit")
        rows = np.asarray(features[_as_index(index)], dtype=np.float64)
        design = _with_constant(self.scaler.transform(rows))
        return np.clip(norm.cdf(design @ np.asarray(self.result.params, dtype=np.float64)), 0.0, 1.0)

    def predict_value(self, features, index):
        raise _wrong_task_error(self.key, self.task, "predict_value")

    def save(self, directory: str) -> str:
        import joblib
        import statsmodels

        if self.result is None:
            raise RuntimeError(f"{self.key}: save called before fit")
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / MODEL_FILE
        temporary = folder / (MODEL_FILE + ".tmp")
        try:
            self.result.remove_data()   # the training design matrix is not needed to predict or explain
        except Exception:  # noqa: BLE001 - a regularized result may not support it; keep the data then
            pass
        joblib.dump({"result": self.result, "scaler": self.scaler}, temporary)
        os.replace(temporary, path)
        metadata = _base_metadata(self, path.name, {"statsmodels": statsmodels.__version__})
        metadata["params"] = [float(value) for value in np.asarray(self.result.params)]
        metadata["best_iteration"] = None
        write_metadata(folder, metadata)
        return str(path)

    @classmethod
    def load(cls, directory: str, metadata: dict) -> ProbitAdapter:
        """joblib unpickles: only load a directory this cycle wrote itself."""
        import joblib

        key = metadata["key"]
        adapter = cls(key, catalog.entry(key), metadata["parameters"], "cpu", metadata["seed"])
        payload = joblib.load(Path(directory) / metadata["model_file"])
        adapter.result = payload["result"]
        adapter.scaler = payload["scaler"]
        adapter.feature_count = int(metadata["feature_count"])
        adapter.converged = metadata.get("converged")
        return adapter


__all__ = ["ProbitAdapter"]
