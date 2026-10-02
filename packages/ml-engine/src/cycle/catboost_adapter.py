"""CatBoost behind the Model Cycle's `ModelAdapter` contract.

Built by ``models.build_adapter`` for the registry entry with ``adapter ==
"catboost"`` (``packages/config/cycle_models/boosting.json``) through the registry
constructor ``CatBoostAdapter(key, entry, parameters, device, seed, task=task)``:
``CatBoostClassifier`` for the direction model (log loss), ``CatBoostRegressor``
for the price model (squared error on the training target clipped at its
TRAINING 1st / 99th percentiles, early stopping on validation mean absolute
error, as the legacy XGBoost / LightGBM price models do). Keyword arguments are
``catalog.estimator_arguments(key, parameters, role)``.

The price model's mean absolute error is a small Python ``eval_metric``
(``PriceMeanAbsoluteError``) rather than CatBoost's built-in "MAE": CatBoost
has no sign-accuracy metric and takes Python metric objects only as
``eval_metric``, so the same pass over the validation rows also records the
accuracy of the predicted sign, which the price model's epoch reports carry
(the regression contract in ``cycle/adapter.py``). CatBoost calls a copy of
the metric object, so the sign accuracy is handed back through a class-level
table keyed by the fit. Its value matches the built-in MAE (checked to 2e-9).

- The validation rows are the ``eval_set``: early stopping after
  ``early_stopping_rounds`` flat rounds, and ``use_best_model`` so the model
  keeps exactly its best rounds. ``.best_iteration`` is the number of trees
  kept (``model.tree_count_``).
- CatBoost writes nothing: ``allow_writing_files=False`` and its ``train_dir``
  is a temporary folder that is removed after the fit (never the repository).
- Progress per round through CatBoost's ``after_iteration`` callback:
  ``reporter.checkpoint()`` and a ``BatchReport`` every round, an
  ``EpochReport`` every ten rounds. CatBoost does NOT pass a Python exception
  raised inside a callback through: it re-raises it as ``CatBoostError`` with
  the traceback as text (checked with catboost 1.2.10). So a Stop makes the
  callback return False, which ends training after that round, and
  ``StopRequested`` is raised once ``fit`` has returned.
- Prediction runs with one thread for a few rows (the test walk asks for one
  row at a time) and every thread for large batches.

Attributes the explainer relies on: ``.model`` (the fitted CatBoost model,
symmetric "oblivious" trees) and ``.best_iteration``.
"""

from __future__ import annotations

import math
import os
import tempfile
import time
import warnings
from pathlib import Path

import numpy as np

from . import catalog
from .adapter import MODEL_TASKS, BatchReport, EpochReport, StopRequested, check_index
from .fitting import Stopwatch
from .models import (
    _base_metadata,
    _require_both_classes,
    _require_varying_target,
    _training_summary,
    _wrong_task_error,
    clip_training_target,
    regression_scores,
    write_metadata,
)

MODEL_FILE = "model.cbm"
REPORT_EVERY_ROUNDS = 10
SMALL_BATCH_ROWS = 256
# every core but two, so the dashboard and the browser stay responsive
TRAINING_THREADS = max(1, (os.cpu_count() or 2) - 2)


def _as_index(index) -> np.ndarray:
    return np.asarray(index, dtype=np.int64).reshape(-1)


def _last(values) -> float | None:
    if not values:
        return None
    value = float(values[-1])
    return value if math.isfinite(value) else None


class PriceMeanAbsoluteError:
    """The price model's CatBoost ``eval_metric``: mean absolute error (what
    early stopping and ``use_best_model`` follow), which on the validation
    rows also records the accuracy of the predicted sign in ``latest[token]``.
    CatBoost evaluates a copy of this object, so the result goes through the
    class-level table; the adapter removes its entry after the fit."""

    latest: dict[str, float | None] = {}

    def __init__(self, token: str, validation_size: int, train_size: int) -> None:
        self.token = token
        # a validation set the same size as the training set cannot be told apart from it
        self.validation_size = validation_size if validation_size != train_size else -1

    def is_max_optimal(self) -> bool:
        return False

    def evaluate(self, approxes, target, weight):
        prediction = np.asarray(approxes[0], dtype=np.float64)
        truth = np.asarray(target, dtype=np.float64)
        if truth.size == self.validation_size:
            PriceMeanAbsoluteError.latest[self.token] = regression_scores(prediction, truth)["accuracy"]
        weights = np.ones_like(truth) if weight is None else np.asarray(weight, dtype=np.float64)
        return float(np.sum(weights * np.abs(prediction - truth))), float(np.sum(weights))

    def get_final_error(self, error, weight):
        return error / weight if weight else 0.0


class CatBoostAdapter:
    available = True

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        if task not in MODEL_TASKS:
            raise ValueError(f"unknown task {task!r}; valid tasks: {', '.join(MODEL_TASKS)}")
        if entry["adapter"] != "catboost":
            raise ValueError(f"{key}: its registry adapter is {entry['adapter']!r}, not 'catboost'")
        self.role = "direction" if task == "classification" else "price"
        if (entry["direction"] if self.role == "direction" else entry["price"]) is None:
            raise ValueError(f"{entry['displayName']} ({key}) has no {self.role} model in the registry")
        self.key = key
        self.family = key
        self.entry = entry
        self.task = task
        self.parameters = dict(parameters)
        self.device = "cpu"
        self.seed = int(seed)
        self.step_unit = entry["stepUnit"]
        self.label = entry["displayName"]
        self.model = None
        self.best_iteration: int | None = None
        self.feature_count: int | None = None
        self.target_clip: tuple[float, float] | None = None
        self.fit_summary: dict = {}
        self._clip_summary: dict = {}
        self._token = ""

    @property
    def _metric(self) -> str:
        """The metric's name in CatBoost's per-round metrics."""
        return PriceMeanAbsoluteError.__name__ if self.task == "regression" else "Logloss"

    def sign_accuracy(self) -> float | None:
        """The price model's validation sign accuracy at the latest round."""
        return PriceMeanAbsoluteError.latest.get(self._token)

    def minimum_history(self) -> int:
        return 1

    def _new_model(self, with_validation: bool, train_dir: str, validation_size: int = 0, train_size: int = 0):
        from catboost import CatBoostClassifier, CatBoostRegressor

        arguments = catalog.estimator_arguments(self.key, self.parameters, self.role)
        if not with_validation:
            arguments.pop("early_stopping_rounds", None)
        arguments.update(
            random_seed=self.seed,
            thread_count=TRAINING_THREADS,
            allow_writing_files=False,
            train_dir=train_dir,
            verbose=False,
        )
        if self.task == "regression":
            metric = PriceMeanAbsoluteError(self._token, validation_size, train_size)
            return CatBoostRegressor(eval_metric=metric, **arguments)
        arguments["eval_metric"] = self._metric
        return CatBoostClassifier(custom_metric=["Accuracy", "F1"], **arguments)

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        train_index = _as_index(train_index)
        validation_index = _as_index(validation_index)
        if train_index.size == 0:
            raise ValueError(f"{self.key}: the training index is empty")
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        regression = self.task == "regression"
        if regression:
            _require_varying_target(self.key, labels[train_index])
        else:
            _require_both_classes(self.key, labels[train_index])
        self.feature_count = int(features.shape[1])
        reporter.step_unit = self.step_unit
        train_matrix = np.ascontiguousarray(features[train_index], dtype=np.float32)
        if regression:
            raw = np.asarray(labels[train_index], dtype=np.float64)
            target, low, high = clip_training_target(raw)
            self.target_clip = (low, high)
            self._clip_summary = {"target_clip_low": low, "target_clip_high": high,
                                  "clipped_train_row_count": int(np.sum(target != raw))}
        else:
            target = np.asarray(labels[train_index] >= 0.5, dtype=np.int64)
        has_validation = validation_index.size > 0
        validation_matrix = np.ascontiguousarray(features[validation_index], dtype=np.float32)
        validation_target = (np.asarray(labels[validation_index], dtype=np.float64) if regression
                             else np.asarray(labels[validation_index] >= 0.5, dtype=np.int64))
        total = int(self.parameters["boosting_rounds"])
        span = (int(train_index[0]), int(train_index[-1]))
        progress = _RoundProgress(self, reporter, total, span, train_index.size, has_validation)
        reporter.log(
            f"catboost on cpu ({TRAINING_THREADS} threads): {train_index.size} training rows, "
            f"{validation_index.size} validation rows, up to {total} rounds"
            + (f", early stopping after {self.parameters['early_stopping_rounds']} flat rounds" if has_validation else "")
        )
        watch = Stopwatch()
        reporter.checkpoint()
        self._token = f"{id(self)}-{time.perf_counter_ns()}"
        try:
            with tempfile.TemporaryDirectory(prefix="cycle_catboost_") as train_dir, warnings.catch_warnings():
                # CatBoost tries to compile a Python metric with numba and says why it cannot
                warnings.filterwarnings("ignore", message="Can't optimze method")
                model = self._new_model(has_validation, train_dir, validation_index.size, train_index.size)
                model.fit(
                    train_matrix, target,
                    eval_set=(validation_matrix, validation_target) if has_validation else None,
                    use_best_model=has_validation,
                    callbacks=[progress],
                )
            if progress.error is not None:
                raise progress.error
            trained = progress.last_round
            stopped_early = trained < total
            progress.report(trained, stopped_early=stopped_early)
        finally:
            PriceMeanAbsoluteError.latest.pop(self._token, None)
        self.model = model
        self.best_iteration = int(model.tree_count_)
        loss_name = "mean absolute error" if regression else "log loss"
        if stopped_early:
            reporter.log(f"early stopping at round {trained}: best validation {loss_name} at round {self.best_iteration}")
        reporter.log(f"{self.label}: kept the first {self.best_iteration} of {trained} rounds (lowest validation {loss_name})"
                     if has_validation else f"{self.label}: kept all {trained} rounds (no validation rows)")
        if regression:
            reporter.log(
                f"{self.label} price model: training target clipped to [{low:.3f}, {high:.3f}] "
                f"({self._clip_summary['clipped_train_row_count']} rows moved)"
            )
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            **(dict(self._clip_summary) if regression else {}),
            "trained_rounds": int(trained),
            "best_round": self.best_iteration,
            "best_validation_loss": None if math.isinf(progress.best_loss) else progress.best_loss,
            "fit_seconds": watch.seconds(),
        }

    def _output(self, rows: np.ndarray) -> np.ndarray:
        threads = 1 if rows.shape[0] <= SMALL_BATCH_ROWS else TRAINING_THREADS
        if self.task == "regression":
            return np.asarray(self.model.predict(rows, thread_count=threads), dtype=np.float64).reshape(-1)
        probability = self.model.predict(rows, prediction_type="Probability", thread_count=threads)
        column = int(np.flatnonzero(np.asarray(self.model.classes_) == 1)[0])
        return np.asarray(probability, dtype=np.float64)[:, column]

    def _rows(self, features, index, method: str) -> np.ndarray:
        if self.model is None:
            raise RuntimeError(f"{self.key}: {method} called before fit")
        return np.ascontiguousarray(features[_as_index(index)], dtype=np.float32)

    def predict_probability(self, features, index) -> np.ndarray:
        if self.task != "classification":
            raise _wrong_task_error(self.key, self.task, "predict_probability")
        return np.clip(self._output(self._rows(features, index, "predict_probability")), 0.0, 1.0)

    def predict_value(self, features, index) -> np.ndarray:
        if self.task != "regression":
            raise _wrong_task_error(self.key, self.task, "predict_value")
        return self._output(self._rows(features, index, "predict_value"))

    def save(self, directory: str) -> str:
        import catboost

        if self.model is None:
            raise RuntimeError(f"{self.key}: save called before fit")
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / MODEL_FILE
        temporary = folder / ("model.tmp.cbm")
        self.model.save_model(str(temporary), format="cbm")
        os.replace(temporary, path)
        metadata = _base_metadata(self, path.name, {"catboost": catboost.__version__})
        metadata["best_iteration"] = self.best_iteration
        write_metadata(folder, metadata)
        return str(path)

    @classmethod
    def load(cls, directory: str, metadata: dict) -> CatBoostAdapter:
        from catboost import CatBoostClassifier, CatBoostRegressor

        key = metadata["key"]
        adapter = cls(key, catalog.entry(key), metadata["parameters"], "cpu", metadata["seed"],
                      task=metadata.get("task", "classification"))
        model = CatBoostRegressor() if adapter.task == "regression" else CatBoostClassifier()
        model.load_model(str(Path(directory) / metadata["model_file"]), format="cbm")
        adapter.model = model
        adapter.best_iteration = int(metadata["best_iteration"])
        adapter.feature_count = int(metadata["feature_count"])
        if "target_clip_low" in metadata and "target_clip_high" in metadata:
            adapter.target_clip = (float(metadata["target_clip_low"]), float(metadata["target_clip_high"]))
        return adapter


class _RoundProgress:
    """CatBoost's ``after_iteration`` callback: a checkpoint and a batch report
    every round, an epoch report every ten rounds. A Stop (or any other error
    from the reporter) is held and training ended by returning False; the
    adapter raises it once ``fit`` returns."""

    def __init__(self, adapter: CatBoostAdapter, reporter, total: int, span: tuple[int, int],
                 train_size: int, has_validation: bool) -> None:
        self.adapter = adapter
        self.reporter = reporter
        self.total = total
        self.span = span
        self.train_size = train_size
        self.has_validation = has_validation
        self.metric = adapter._metric
        self.error: BaseException | None = None
        self.last_round = 0
        self.last_reported = 0
        self.best_loss = math.inf
        self.best_round = 0
        self.improved_since_report = False
        self.metrics: dict = {}
        self.watch = Stopwatch()

    def after_iteration(self, info) -> bool:
        try:
            return self._after(int(info.iteration), info.metrics)
        except StopRequested as error:
            self.error = error
        except Exception as error:  # noqa: BLE001 - CatBoost would turn it into CatBoostError
            self.error = error
        return False

    def _after(self, round_number: int, metrics: dict) -> bool:
        self.last_round = round_number
        self.metrics = metrics
        seconds = self.watch.seconds()
        self.watch = Stopwatch()
        validation_loss = _last(metrics.get("validation", {}).get(self.metric))
        if validation_loss is not None and validation_loss < self.best_loss:
            self.best_loss, self.best_round = validation_loss, round_number
            self.improved_since_report = True
        if (round_number - 1) % REPORT_EVERY_ROUNDS == 0:
            self.reporter.epoch_started(round_number, self.total)
        self.reporter.batch(BatchReport(
            epoch=round_number, epoch_count=self.total, batch=1, batch_count=1,
            span_start_index=self.span[0], span_end_index=self.span[1],
            train_loss=_last(metrics.get("learn", {}).get(self.metric)),
            samples_per_second=self.train_size / seconds,
        ))
        if round_number % REPORT_EVERY_ROUNDS == 0:
            self.report(round_number, stopped_early=False)
        self.reporter.checkpoint()
        return True

    def report(self, round_number: int, stopped_early: bool) -> None:
        if round_number == self.last_reported or round_number == 0:
            return
        self.last_reported = round_number
        validation = self.metrics.get("validation", {})
        if self.has_validation:
            self.reporter.validating(round_number, self.total)
        classification = self.adapter.task == "classification"
        self.reporter.epoch_finished(EpochReport(
            epoch=round_number, epoch_count=self.total,
            train_loss=_last(self.metrics.get("learn", {}).get(self.metric)),
            validation_loss=_last(validation.get(self.metric)),
            validation_accuracy=(_last(validation.get("Accuracy")) if classification
                                 else self.adapter.sign_accuracy() if self.has_validation else None),
            validation_f1_score=_last(validation.get("F1")) if classification else None,
            is_best=self.improved_since_report,
            stopped_early=stopped_early,
        ))
        self.improved_since_report = False


__all__ = ["CatBoostAdapter"]
