"""Attention-weighted forecast stack behind the Model Cycle's ``ModelAdapter`` contract.

Catalog spec: *Hybrid and composite architectures / Multi-modal temporal /
Attention-weighted forecast stack* (``Trading/_architecture/educational/
algo_models/Hybrid & Composite Architectures/Multi-Modal & Temporal Fusion/
Attention-Weighted Forecast Stack.md``). Built by ``models.build_adapter`` for
the registry entry with ``adapter == "attention_weighted_forecast_stack"``
(``src/config/cycle_models/attention_weighted_forecast_stack.json``) through
the registry constructor
``AttentionWeightedForecastStackAdapter(key, entry, parameters, device, seed, task=task)``.

What the spec describes, and what runs here
-------------------------------------------
The spec stacks K heterogeneous base forecasters f_k and lets an attention
module weight their forecasts per time step:

    alpha_k(t) = softmax_k( score(X_t) )          y_hat(t) = sum_k alpha_k(t) * y_hat_k(t)

trained in two stages (base models first, the attention module on their
predictions afterwards). The Cycle hands every model ONE causal feature
matrix, so the implementation is:

* **Base forecasters (level 0)**, all scikit-learn, fitted on the TRAINING
  rows only, on features standardised by a StandardScaler fitted on those same
  rows: logistic regression (Ridge for the price model), k-nearest neighbors
  (``neighbor_count``), histogram gradient boosting (``boosting_rounds``) and a
  one-hidden-layer multilayer perceptron (``perceptron_hidden_size``). Their outputs
  are the stack's forecasts: the LOGIT of each classifier's P(up) for the
  direction model, each regressor's value for the price model.
* **Attention combiner (level 1)**: one linear map from the standardised
  features to ``base_model_count`` scores, divided by ``attention_temperature``,
  softmax over the base models, dot with the base forecasts. The stack's
  output is a logit (direction model, P(up) = sigmoid) or the target itself
  (price model). Starting from zero weights, so the first epoch is the plain
  average of the base forecasts, it is fitted by gradient descent in torch
  (Adam, ``combiner_learning_rate``, ``combiner_epochs`` full-batch epochs, a
  small fixed weight decay), on the CPU, with one ``EpochReport`` per epoch.
* **The combiner is fitted on the EARLIER part of the validation rows and
  scored on the later part.** The base models have seen the training rows, so
  their training-row outputs are optimistic (a nearest-neighbors model is its
  own nearest neighbour there, a boosted ensemble fits its training rows
  closely); a combiner fitted on them would learn to trust whichever base
  model memorises best. The validation rows are the only rows inside the fold
  where every base forecast is honest, so the attention map is learned there,
  exactly as the spec's stage 2 uses out-of-fold predictions. The validation
  rows are cut in two (``split_combiner_rows``): the first
  ``COMBINER_FIT_SHARE`` (two thirds) fit the combiner by gradient descent;
  the rest, after a purge as long as the one the engine left between the
  training and validation rows (the label horizon), are held out, so no label
  of a fitted row resolves inside them. The epoch with the lowest HELD-OUT loss
  (log loss, or Huber loss for the price model) is kept, and the validation
  numbers every epoch reports are the held-out part's, an out-of-sample figure
  comparable with every other model's. This is the documented exception to
  "nothing is fitted on validation rows": the base models never see them, and
  the combiner never sees the rows it is scored on. With too few validation
  rows to cut (fewer than ``_MINIMUM_COMBINER_ROWS`` on either side) the
  combiner is fitted and scored on all of them, the fit log says so as a
  warning and ``fit_summary["validation_metrics_on"]`` reads
  ``"combiner_fit_rows"``.

Reported per epoch: ``train_loss`` = the stack's loss on the training rows
(log loss / mean absolute error; optimistic for the reason above),
``validation_loss`` / ``validation_accuracy`` / ``validation_f1_score`` = the
stack scored on the held-out validation rows. Each base model's own loss on
those rows is logged once, and ``fit_summary["mean_attention_weight"]`` carries
the mean attention weight per base model over every validation row, so a reader
can see which forecaster the stack leans on.

The price model's training target is clipped at its TRAINING 1st / 99th
percentiles for the base regressors (``models.clip_training_target``); the
combiner minimises Huber loss (delta 1.0) on the raw validation target and
reports mean absolute error.

Causal by construction: every prediction reads its own feature row only
(``minimum_history() == 1``), and every fitted object saw rows inside the
fold's training or validation span.

Simplifications versus the spec (also in the registry's ``implementationNote``):
the spec's LSTM / temporal CNN / transformer / ARIMA base models over
multi-modal inputs (price, volume, news) become four tabular scikit-learn
models over the Cycle's one causal feature matrix; its multi-head self-attention
becomes a single linear score per base model with a temperature; there is no
joint end-to-end training of base models and attention and no attention
entropy regularisation; the output is a point forecast, never a distribution.

Saved as ``base_models.joblib`` (the scaler and the four fitted scikit-learn
objects; only load a directory this cycle wrote itself), ``combiner.npz`` (the
attention weights, bias and temperature) and ``model.json``.

Attributes a reader may use: ``.base_models`` (name -> fitted estimator),
``.scaler``, ``.combiner_weight`` (feature_count x base_model_count),
``.combiner_bias``, ``.attention_weights(features, index)`` (per-row alpha),
``.key``, ``.task``, ``.feature_count``, ``.best_iteration`` (the kept epoch).
"""

from __future__ import annotations

import math
import os
import warnings
from pathlib import Path

import numpy as np

from .. import catalog
from ..adapter import MODEL_TASKS, BatchReport, EpochReport, check_index
from ..fitting import Stopwatch, run_single_fit
from ..models import (
    _base_metadata,
    _require_both_classes,
    _require_varying_target,
    _training_summary,
    _wrong_task_error,
    binary_scores,
    clip_training_target,
    huber_loss,
    regression_scores,
    write_metadata,
)

ADAPTER = "attention_weighted_forecast_stack"
BASE_MODEL_FILE = "base_models.joblib"
COMBINER_FILE = "combiner.npz"
BASE_MODEL_NAMES = ("linear_model", "nearest_neighbors", "gradient_boosting", "multilayer_perceptron")
BASE_MODEL_COUNT = len(BASE_MODEL_NAMES)

_PROBABILITY_FLOOR = 1e-6
_HUBER_DELTA = 1.0
_COMBINER_WEIGHT_DECAY = 1e-4
_GRADIENT_CLIP_NORM = 1.0
_WARNINGS_LOGGED = 3
_MLP_MAX_ITERATIONS = 200
_BOOSTING_LEARNING_RATE = 0.05
_BOOSTING_MAX_LEAF_NODES = 15
# the share of the validation rows the combiner is fitted on; the rest (after the purge) score it
COMBINER_FIT_SHARE = 2.0 / 3.0
_MINIMUM_COMBINER_ROWS = 10


def split_combiner_rows(train_index: np.ndarray, validation_index: np.ndarray) -> tuple[np.ndarray, np.ndarray, int]:
    """Positions into ``validation_index``: (rows the combiner is fitted on, rows it is
    scored and selected on, the purge between them). The fit rows are the first
    ``COMBINER_FIT_SHARE``; the held-out rows start more than ``purge`` rows after the
    last fit row, where ``purge`` is the gap the engine left between the last training
    row and the first validation row (its label-horizon purge), so no label of a fit
    row resolves inside the held-out rows. Too few rows on either side: every
    validation row is both (the caller says so)."""
    everything = np.arange(validation_index.size, dtype=np.int64)
    purge = max(0, int(validation_index[0]) - int(train_index[-1]) - 1) if train_index.size else 0
    cut = int(round(validation_index.size * COMBINER_FIT_SHARE))
    if cut < _MINIMUM_COMBINER_ROWS:
        return everything, everything, purge
    fit = everything[:cut]
    held_out = everything[validation_index > int(validation_index[cut - 1]) + purge]
    if held_out.size < _MINIMUM_COMBINER_ROWS:
        return everything, everything, purge
    return fit, held_out, purge


def _as_index(index) -> np.ndarray:
    return np.asarray(index, dtype=np.int64).reshape(-1)


def _finite_or_none(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _logit(probability: np.ndarray) -> np.ndarray:
    clipped = np.clip(np.asarray(probability, dtype=np.float64), _PROBABILITY_FLOOR, 1.0 - _PROBABILITY_FLOOR)
    return np.log(clipped) - np.log1p(-clipped)


def _sigmoid(logit: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(np.asarray(logit, dtype=np.float64), -500.0, 500.0)))


def softmax_attention(inputs: np.ndarray, weight: np.ndarray, bias: np.ndarray, temperature: float) -> np.ndarray:
    """alpha (rows x base models): softmax over the base models of
    ``(inputs @ weight + bias) / temperature``, row by row."""
    scores = (np.asarray(inputs, dtype=np.float64) @ weight + bias) / float(temperature)
    scores = scores - scores.max(axis=1, keepdims=True)
    exponent = np.exp(scores)
    return exponent / exponent.sum(axis=1, keepdims=True)


class AttentionWeightedForecastStackAdapter:
    """See the module docstring."""

    available = True

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        if task not in MODEL_TASKS:
            raise ValueError(f"unknown task {task!r}; valid tasks: {', '.join(MODEL_TASKS)}")
        if entry["adapter"] != ADAPTER:
            raise ValueError(f"{key}: its registry adapter is {entry['adapter']!r}, not {ADAPTER!r}")
        self.role = "direction" if task == "classification" else "price"
        if (entry["direction"] if self.role == "direction" else entry["price"]) is None:
            raise ValueError(f"{entry['displayName']} ({key}) has no {self.role} model in the registry")
        self.key = key
        self.family = key
        self.entry = entry
        self.task = task
        self.parameters = dict(parameters)
        self.device = "cpu"          # the combiner is a handful of weights; it never needs the GPU
        self.seed = int(seed)
        self.step_unit = entry["stepUnit"]
        self.label = entry["displayName"]
        self.uses_scaler = "standard_scaler" in entry["preprocess"]
        # fitted state
        self.scaler = None
        self.base_models: dict[str, object] = {}
        self.combiner_weight: np.ndarray | None = None
        self.combiner_bias: np.ndarray | None = None
        self.temperature = float(self.parameters["attention_temperature"])
        self.feature_count: int | None = None
        self.best_iteration: int | None = None
        self.target_clip: tuple[float, float] | None = None
        self.fit_summary: dict = {}
        self._clip_summary: dict = {}

    # ── contract ─────────────────────────────────────────────────────────
    def minimum_history(self) -> int:
        return 1

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        train_index = _as_index(train_index)
        validation_index = _as_index(validation_index)
        if train_index.size == 0:
            raise ValueError(f"{self.key}: the training index is empty")
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        if validation_index.size == 0:
            raise ValueError(f"{self.key}: the validation rows are empty; the attention combiner is fitted on them")
        regression = self.task == "regression"
        if regression:
            _require_varying_target(self.key, labels[train_index])
        else:
            _require_both_classes(self.key, labels[train_index])
        self.feature_count = int(features.shape[1])
        reporter.step_unit = self.step_unit
        watch = Stopwatch()

        train_rows = np.asarray(features[train_index], dtype=np.float64)
        validation_rows = np.asarray(features[validation_index], dtype=np.float64)
        if self.uses_scaler:
            from sklearn.preprocessing import StandardScaler

            self.scaler = StandardScaler().fit(train_rows)
        train_matrix = self._transform(train_rows)
        validation_matrix = self._transform(validation_rows)
        train_target = self._target(labels, train_index)
        validation_target = np.asarray(labels[validation_index], dtype=np.float64)
        fit_positions, held_out_positions, purge = split_combiner_rows(train_index, validation_index)
        held_out_separately = fit_positions.size < validation_index.size
        combiner_fit_span = (int(validation_index[fit_positions[0]]), int(validation_index[fit_positions[-1]]))

        neighbor_count = int(self.parameters["neighbor_count"])
        if neighbor_count > train_index.size:
            reporter.log(
                f"{self.label}: neighbor_count {neighbor_count} is more than the {train_index.size} training rows; "
                f"using {train_index.size}", "warn",
            )
            neighbor_count = int(train_index.size)
        self._neighbor_count_used = neighbor_count
        epochs = int(self.parameters["combiner_epochs"])
        reporter.log(
            f"{self.label} ({self.role} model): fitting {BASE_MODEL_COUNT} base forecasters "
            f"({', '.join(name.replace('_', ' ') for name in BASE_MODEL_NAMES)}) on {train_index.size:,} training rows; "
            f"then the attention combiner on the first {fit_positions.size:,} of the {validation_index.size:,} validation rows "
            f"for {epochs} epochs, scored on the last {held_out_positions.size:,} (after a {purge}-row purge) "
            f"(learning rate {float(self.parameters['combiner_learning_rate']):g}, temperature {self.temperature:g})"
        )
        if not held_out_separately:
            reporter.log(
                f"{self.label}: only {validation_index.size} validation rows, too few to hold any out; the combiner "
                f"is fitted and scored on all of them, so its validation numbers are in-sample", "warn",
            )

        # stage 1: the base forecasters, one library call each on a daemon thread (Pause / Stop every 0.2 s)
        adapter = self

        def stage_one():
            models = adapter._new_base_models(neighbor_count)
            for estimator in models.values():
                estimator.fit(train_matrix, train_target)
            train_base = adapter._base_outputs(train_matrix, models)
            validation_base = adapter._base_outputs(validation_matrix, models)
            return models, train_base, validation_base

        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            self.base_models, train_base, validation_base = run_single_fit(stage_one, reporter, name=self.key)
        self._log_warnings(caught, reporter)
        base_seconds = watch.seconds()
        held_out_base = validation_base[held_out_positions]
        held_out_target = validation_target[held_out_positions]
        for column, name in enumerate(BASE_MODEL_NAMES):
            scores = self._scores(self._final_output(held_out_base[:, column]), held_out_target)
            reporter.log(
                f"{self.label}: {name.replace('_', ' ')} alone on the held-out validation rows: "
                f"{self._loss_name} {_format(scores['loss'])}, accuracy {_format(scores['accuracy'])}"
            )
        reporter.log(f"{self.label}: base forecasters fitted in {base_seconds:.1f} s")

        # stage 2: the attention combiner, fitted on the earlier validation rows, selected on the held-out ones
        best_loss = self._fit_combiner(
            train_matrix, train_base, train_target,
            validation_matrix[fit_positions], validation_base[fit_positions], validation_target[fit_positions],
            validation_matrix[held_out_positions], held_out_base, held_out_target,
            combiner_fit_span, reporter,
        )
        alpha = softmax_attention(validation_matrix, self.combiner_weight, self.combiner_bias, self.temperature)
        mean_attention = {name: float(alpha[:, column].mean()) for column, name in enumerate(BASE_MODEL_NAMES)}
        leaned = max(mean_attention, key=mean_attention.get)
        reporter.log(
            f"{self.label}: mean attention weight on the validation rows: "
            + ", ".join(f"{name.replace('_', ' ')} {value:.3f}" for name, value in mean_attention.items())
            + f"; the stack leans on {leaned.replace('_', ' ')}"
        )
        if regression:
            low, high = self.target_clip
            reporter.log(
                f"{self.label} price model: training target clipped to [{low:.3f}, {high:.3f}] "
                f"({self._clip_summary['clipped_train_row_count']} rows moved) for the base regressors"
            )
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            **(dict(self._clip_summary) if regression else {}),
            "base_model_names": list(BASE_MODEL_NAMES),
            "neighbor_count_used": neighbor_count,
            "combiner_fitted_on": "validation_rows_first_part" if held_out_separately else "validation_rows",
            "combiner_fit_row_count": int(fit_positions.size),
            "combiner_held_out_row_count": int(held_out_positions.size),
            "combiner_purge_rows": int(purge),
            "validation_metrics_on": "held_out_validation_rows" if held_out_separately else "combiner_fit_rows",
            "combiner_epochs_trained": epochs,
            "best_epoch": self.best_iteration,
            "best_validation_loss": best_loss,
            "mean_attention_weight": mean_attention,
            "base_fit_seconds": base_seconds,
            "fit_seconds": watch.seconds(),
        }

    def predict_probability(self, features, index) -> np.ndarray:
        if self.task != "classification":
            raise _wrong_task_error(self.key, self.task, "predict_probability")
        return np.clip(self._final_output(self._stack_output(features, index, "predict_probability")), 0.0, 1.0)

    def predict_value(self, features, index) -> np.ndarray:
        if self.task != "regression":
            raise _wrong_task_error(self.key, self.task, "predict_value")
        return self._stack_output(features, index, "predict_value")

    def attention_weights(self, features, index) -> np.ndarray:
        """The attention weight of every base model (rows x base models) for the rows in ``index``."""
        inputs = self._inputs(features, index, "attention_weights")
        return softmax_attention(inputs, self.combiner_weight, self.combiner_bias, self.temperature)

    def save(self, directory: str) -> str:
        import joblib
        import sklearn
        import torch

        if not self.base_models or self.combiner_weight is None:
            raise RuntimeError(f"{self.key}: save called before fit")
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / BASE_MODEL_FILE
        temporary = folder / (BASE_MODEL_FILE + ".tmp")
        joblib.dump({"scaler": self.scaler, "base_models": dict(self.base_models),
                     "neighbor_count_used": self._neighbor_count_used}, temporary)
        os.replace(temporary, path)
        combiner_path = folder / COMBINER_FILE
        combiner_temporary = folder / (COMBINER_FILE + ".tmp.npz")
        np.savez(combiner_temporary, weight=self.combiner_weight, bias=self.combiner_bias,
                 temperature=np.asarray(self.temperature, dtype=np.float64))
        os.replace(combiner_temporary, combiner_path)
        metadata = _base_metadata(self, path.name, {"scikit_learn": sklearn.__version__, "torch": torch.__version__})
        metadata.update({
            "combiner_file": COMBINER_FILE,
            "preprocess": list(self.entry["preprocess"]),
            "best_iteration": self.best_iteration,
        })
        write_metadata(folder, metadata)
        return str(path)

    @classmethod
    def load(cls, directory: str, metadata: dict) -> AttentionWeightedForecastStackAdapter:
        """Rebuild a saved model. joblib unpickles: only load a directory this
        cycle wrote itself (``data/models/<model_id>/``)."""
        import joblib

        key = metadata["key"]
        adapter = cls(key, catalog.entry(key), metadata["parameters"], "cpu", metadata["seed"],
                      task=metadata.get("task", "classification"))
        payload = joblib.load(Path(directory) / metadata["model_file"])
        adapter.scaler = payload["scaler"]
        adapter.base_models = dict(payload["base_models"])
        adapter._neighbor_count_used = int(payload["neighbor_count_used"])
        with np.load(Path(directory) / metadata.get("combiner_file", COMBINER_FILE)) as combiner:
            adapter.combiner_weight = np.asarray(combiner["weight"], dtype=np.float64)
            adapter.combiner_bias = np.asarray(combiner["bias"], dtype=np.float64)
            adapter.temperature = float(combiner["temperature"])
        adapter.feature_count = int(metadata["feature_count"])
        adapter.best_iteration = metadata.get("best_iteration")
        if "target_clip_low" in metadata and "target_clip_high" in metadata:
            adapter.target_clip = (float(metadata["target_clip_low"]), float(metadata["target_clip_high"]))
        adapter.fit_summary = {name: metadata[name] for name in
                               ("fit_seconds", "best_validation_loss", "mean_attention_weight", "best_epoch")
                               if name in metadata}
        return adapter

    # ── data ─────────────────────────────────────────────────────────────
    @property
    def _loss_name(self) -> str:
        return "mean absolute error" if self.task == "regression" else "log loss"

    def _transform(self, rows: np.ndarray) -> np.ndarray:
        return self.scaler.transform(rows) if self.scaler is not None else rows

    def _target(self, labels: np.ndarray, rows: np.ndarray) -> np.ndarray:
        if self.task == "classification":
            return np.asarray(labels[rows] >= 0.5, dtype=np.int64)
        raw = np.asarray(labels[rows], dtype=np.float64)
        clipped, low, high = clip_training_target(raw)
        self.target_clip = (low, high)
        self._clip_summary = {
            "target_clip_low": low,
            "target_clip_high": high,
            "clipped_train_row_count": int(np.sum(clipped != raw)),
        }
        return clipped

    def _inputs(self, features, index, method: str) -> np.ndarray:
        if not self.base_models or self.combiner_weight is None or self.feature_count is None:
            raise RuntimeError(f"{self.key}: {method} called before fit")
        return self._transform(np.asarray(features[_as_index(index)], dtype=np.float64))

    # ── the base forecasters ─────────────────────────────────────────────
    def _new_base_models(self, neighbor_count: int) -> dict[str, object]:
        hidden = int(self.parameters["perceptron_hidden_size"])
        rounds = int(self.parameters["boosting_rounds"])
        boosting = dict(max_iter=rounds, learning_rate=_BOOSTING_LEARNING_RATE, max_leaf_nodes=_BOOSTING_MAX_LEAF_NODES,
                        early_stopping=False, random_state=self.seed)
        perceptron = dict(hidden_layer_sizes=(hidden,), max_iter=_MLP_MAX_ITERATIONS, random_state=self.seed)
        if self.task == "classification":
            from sklearn.ensemble import HistGradientBoostingClassifier
            from sklearn.linear_model import LogisticRegression
            from sklearn.neighbors import KNeighborsClassifier
            from sklearn.neural_network import MLPClassifier

            return {
                "linear_model": LogisticRegression(C=1.0, max_iter=1000, random_state=self.seed),
                "nearest_neighbors": KNeighborsClassifier(n_neighbors=neighbor_count),
                "gradient_boosting": HistGradientBoostingClassifier(**boosting),
                "multilayer_perceptron": MLPClassifier(**perceptron),
            }
        from sklearn.ensemble import HistGradientBoostingRegressor
        from sklearn.linear_model import Ridge
        from sklearn.neighbors import KNeighborsRegressor
        from sklearn.neural_network import MLPRegressor

        return {
            "linear_model": Ridge(alpha=1.0),
            "nearest_neighbors": KNeighborsRegressor(n_neighbors=neighbor_count),
            "gradient_boosting": HistGradientBoostingRegressor(**boosting),
            "multilayer_perceptron": MLPRegressor(**perceptron),
        }

    def _base_outputs(self, matrix: np.ndarray, models: dict[str, object] | None = None) -> np.ndarray:
        """Every base model's forecast for model-input rows (already scaled):
        the logit of P(up) per classifier, or each regressor's value."""
        models = self.base_models if models is None else models
        outputs = np.empty((matrix.shape[0], BASE_MODEL_COUNT), dtype=np.float64)
        for column, name in enumerate(BASE_MODEL_NAMES):
            estimator = models[name]
            if self.task == "regression":
                outputs[:, column] = np.asarray(estimator.predict(matrix), dtype=np.float64).reshape(-1)
            else:
                up = int(np.flatnonzero(np.asarray(estimator.classes_) == 1)[0])
                outputs[:, column] = _logit(np.asarray(estimator.predict_proba(matrix), dtype=np.float64)[:, up])
        return outputs

    # ── the combiner ─────────────────────────────────────────────────────
    def _combine(self, inputs: np.ndarray, base: np.ndarray) -> np.ndarray:
        alpha = softmax_attention(inputs, self.combiner_weight, self.combiner_bias, self.temperature)
        return np.sum(alpha * base, axis=1)

    def _final_output(self, stack: np.ndarray) -> np.ndarray:
        """The task's prediction from the stack's raw output: P(up) from the logit, or the value itself."""
        return stack if self.task == "regression" else _sigmoid(stack)

    def _stack_output(self, features, index, method: str) -> np.ndarray:
        inputs = self._inputs(features, index, method)
        return self._combine(inputs, self._base_outputs(inputs))

    def _scores(self, output: np.ndarray, target: np.ndarray) -> dict:
        """{"loss", "accuracy", "f1_score"} for this task from the task's prediction."""
        if self.task == "regression":
            scores = regression_scores(output, target)
            return {"loss": _finite_or_none(scores["mean_absolute_error"]), "accuracy": scores["accuracy"],
                    "f1_score": None}
        scores = binary_scores(output, target)
        return {"loss": _finite_or_none(scores["log_loss"]), "accuracy": scores["accuracy"],
                "f1_score": scores["f1_score"]}

    def _fit_combiner(self, train_matrix, train_base, train_target, fit_matrix, fit_base, fit_target,
                      held_out_matrix, held_out_base, held_out_target, fit_span, reporter) -> float | None:
        """Gradient descent (Adam) on the combiner's fit rows (the earlier
        validation rows); every epoch is one full-batch step, reported through the
        reporter. Keeps the weights of the epoch with the lowest loss on the
        held-out validation rows (log loss, or Huber loss for the price model),
        which is also the validation loss every epoch reports. Returns that loss
        as reported (log loss / mean absolute error)."""
        import torch

        torch.manual_seed(self.seed)
        regression = self.task == "regression"
        epochs = int(self.parameters["combiner_epochs"])
        learning_rate = float(self.parameters["combiner_learning_rate"])
        feature_count = int(train_matrix.shape[1])
        weight = torch.zeros((feature_count, BASE_MODEL_COUNT), dtype=torch.float64, requires_grad=True)
        bias = torch.zeros(BASE_MODEL_COUNT, dtype=torch.float64, requires_grad=True)
        optimizer = torch.optim.Adam([weight, bias], lr=learning_rate, weight_decay=_COMBINER_WEIGHT_DECAY)
        inputs = torch.from_numpy(np.ascontiguousarray(fit_matrix, dtype=np.float64))
        forecasts = torch.from_numpy(np.ascontiguousarray(fit_base, dtype=np.float64))
        target = torch.from_numpy(np.asarray(fit_target, dtype=np.float64))
        if regression:
            loss_function = torch.nn.HuberLoss(delta=_HUBER_DELTA)
        else:
            loss_function = torch.nn.BCEWithLogitsLoss()
        train_target_float = np.asarray(train_target, dtype=np.float64)
        held_out_target_float = np.asarray(held_out_target, dtype=np.float64)
        best_loss = math.inf
        best_reported: float | None = None
        best_epoch = 0
        best_state: tuple[np.ndarray, np.ndarray] | None = None
        row_count = int(fit_matrix.shape[0])
        for epoch in range(1, epochs + 1):
            reporter.checkpoint()
            reporter.epoch_started(epoch, epochs)
            watch = Stopwatch()
            optimizer.zero_grad(set_to_none=True)
            scores = (inputs @ weight + bias) / self.temperature
            alpha = torch.softmax(scores, dim=1)
            output = (alpha * forecasts).sum(dim=1)
            loss = loss_function(output, target)
            loss.backward()
            norm = float(torch.nn.utils.clip_grad_norm_([weight, bias], _GRADIENT_CLIP_NORM).item())
            optimizer.step()
            # the weights after this step, as numpy, for the reports and the kept state
            self.combiner_weight = weight.detach().cpu().numpy().copy()
            self.combiner_bias = bias.detach().cpu().numpy().copy()
            train_scores = self._scores(self._final_output(self._combine(train_matrix, train_base)), train_target_float)
            reporter.batch(BatchReport(
                epoch=epoch, epoch_count=epochs, batch=1, batch_count=1,
                span_start_index=fit_span[0], span_end_index=fit_span[1],
                train_loss=train_scores["loss"], learning_rate=learning_rate,
                gradient_norm=norm if math.isfinite(norm) else None,
                samples_per_second=row_count / watch.seconds(),
            ))
            reporter.validating(epoch, epochs)
            stack = self._combine(held_out_matrix, held_out_base)
            scores_now = self._scores(self._final_output(stack), held_out_target_float)
            selection = (huber_loss(stack, held_out_target_float, _HUBER_DELTA) if regression
                         else scores_now["loss"])
            improved = selection is not None and math.isfinite(selection) and selection < best_loss
            if improved:
                best_loss, best_reported, best_epoch = selection, scores_now["loss"], epoch
                best_state = (self.combiner_weight.copy(), self.combiner_bias.copy())
            reporter.epoch_finished(EpochReport(
                epoch=epoch, epoch_count=epochs, train_loss=train_scores["loss"],
                validation_loss=scores_now["loss"], validation_accuracy=scores_now["accuracy"],
                validation_f1_score=scores_now["f1_score"], learning_rate=learning_rate,
                gradient_norm=norm if math.isfinite(norm) else None, is_best=improved, stopped_early=False,
            ))
        if best_state is None:
            best_epoch = epochs
            reporter.log(f"{self.label}: no combiner epoch had a finite held-out loss; kept the last epoch", "warn")
        else:
            self.combiner_weight, self.combiner_bias = best_state
        self.best_iteration = int(best_epoch)
        selection_name = "Huber loss" if regression else "log loss"
        reporter.log(
            f"{self.label}: kept the attention weights of epoch {best_epoch} of {epochs} "
            f"(lowest {selection_name} on the held-out validation rows; fitted on the earlier validation rows)"
        )
        return best_reported

    def _log_warnings(self, caught, reporter) -> None:
        """Library warnings raised by the base fits, once each (a few at most):
        a perceptron that had not converged after its iterations, and the like."""
        seen: list[str] = []
        for warning in caught:
            text = f"{warning.category.__name__}: {warning.message}"
            if text not in seen:
                seen.append(text)
        for text in seen[:_WARNINGS_LOGGED]:
            reporter.log(f"{self.label}: {text}", "warn")


def _format(value: float | None) -> str:
    return "n/a" if value is None or not math.isfinite(value) else f"{value:.4f}"


__all__ = ["AttentionWeightedForecastStackAdapter", "BASE_MODEL_NAMES", "softmax_attention"]
