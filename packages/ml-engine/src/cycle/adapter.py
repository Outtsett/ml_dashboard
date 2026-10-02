"""Model adapter contract for the Model Cycle engine.

The engine (`engine.py`) owns data, folds, tuning, the test walk and every
event. An adapter owns one model family's fitting and prediction. They meet
here, and nowhere else: the engine never imports a model library, and an
adapter never prints to stdout — it reports through `TrainingReporter`, which
the engine turns into `cycle_cursor` / `cycle_epoch` / `log` events.

Data shape
----------
The engine builds ONE causal feature matrix for the whole loaded window and
hands adapters index arrays into it, never copies:

    features   float32 (n_bars, n_features)  row t uses only bars <= t;
                                             NaN rows are warmup and are never
                                             in any index array
    labels     float32 (n_bars,)             1.0 up, 0.0 down, NaN unscored
                                             (inside the threshold, or the
                                             horizon runs past the data)
    timestamps int64   (n_bars,)             epoch seconds

A sequence model predicting bar t reads features[t - sequence_length + 1 : t + 1];
`minimum_history()` tells the engine how many bars that needs, so it never
asks for a prediction the model cannot make causally.

Design and command line: `docs/plans/2026-09-25-model-cycle.md`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from . import catalog as _catalog

# Every name below is read from the model registry (`packages/config/cycle_models/`,
# loaded by `catalog.py`); the names predate it and are kept so importers still
# work. A "family" here is a registry key.
_MODELS = _catalog.registry()["models"]

MODEL_FAMILIES = tuple(_MODELS)

# The eight families that predate the registry (`adapter == "legacy"`): their
# validation, search spaces and adapters live in `models.py` / `networks.py`.
LEGACY_FAMILIES = tuple(key for key, entry in _MODELS.items() if entry["adapter"] == "legacy")

# Models that read a window of bars (`sequence`) and models built on torch.
SEQUENCE_FAMILIES = tuple(key for key, entry in _MODELS.items() if entry["sequence"])
NEURAL_FAMILIES = tuple(key for key, entry in _MODELS.items() if entry["implementation"] == "torch")

MODEL_LABELS = {key: entry["displayName"] for key, entry in _MODELS.items()}


class StopRequested(Exception):
    """Raised by `TrainingReporter.checkpoint()` when the user pressed Stop.

    Adapters let it propagate. The engine catches it, closes the open trade,
    writes what exists and emits `done` with `stopped: true`.
    """


@dataclass(frozen=True)
class BatchReport:
    """One optimisation step inside an epoch (neural) or one boosting round /
    tree chunk (trees). `span_*_index` are row indices into the feature matrix
    covering the samples this step used — a contiguous block for neural
    models, the whole training index for trees."""

    epoch: int                 # 1-based
    epoch_count: int
    batch: int                 # 1-based within the epoch
    batch_count: int
    span_start_index: int
    span_end_index: int
    train_loss: float | None
    learning_rate: float | None = None
    gradient_norm: float | None = None
    samples_per_second: float | None = None


@dataclass(frozen=True)
class EpochReport:
    """End of one epoch / boosting chunk / tree chunk / solver pass."""

    epoch: int                 # 1-based
    epoch_count: int
    train_loss: float | None
    validation_loss: float | None
    validation_accuracy: float | None
    validation_f1_score: float | None
    learning_rate: float | None = None
    gradient_norm: float | None = None
    is_best: bool = False
    stopped_early: bool = False


class TrainingReporter(Protocol):
    """What an adapter calls while fitting. Implemented by the engine."""

    step_unit: str  # the adapter sets this before its first report:
    #                 "epoch" | "boosting_round" | "tree_batch" | "solver_pass"

    def epoch_started(self, epoch: int, epoch_count: int) -> None: ...

    def batch(self, report: BatchReport) -> None: ...

    def epoch_finished(self, report: EpochReport) -> None: ...

    def validating(self, epoch: int, epoch_count: int) -> None:
        """Called just before the adapter scores the validation index."""

    def checkpoint(self) -> None:
        """Call between batches / rounds / chunks. Blocks while the user has
        paused; raises `StopRequested` once they pressed Stop."""

    def log(self, message: str, level: str = "info") -> None: ...


MODEL_TASKS = ("classification", "regression")


class ModelAdapter(Protocol):
    """One model family, as a direction classifier (``task="classification"``)
    or as a price model (``task="regression"``). Built by
    ``models.build_adapter(family, parameters, device, seed, task=...)``.

    Regression adapters fit ``labels`` = the real-valued target the engine
    passes — the forward move close[t+h] - close[t] divided by a causal trailing
    volatility of h-bar moves, so roughly unit scale in every regime (NaN rows
    are never in an index) — and return predictions in the SAME units from
    ``predict_value``; the engine multiplies back to points. Outlier handling is
    the adapter's: Huber loss (delta 1.0) for neural networks; tree and linear
    models clip the training target at its TRAINING 1st/99th percentiles.
    Their ``EpochReport``s carry mean absolute error (target units) as the
    train / validation loss and the accuracy of the predicted SIGN as
    ``validation_accuracy`` (``validation_f1_score`` None)."""

    family: str
    step_unit: str

    def minimum_history(self) -> int:
        """Rows of feature history one prediction needs (1 for tabular models,
        `sequence_length` for sequence models)."""

    def fit(
        self,
        features: np.ndarray,
        labels: np.ndarray,
        train_index: np.ndarray,
        validation_index: np.ndarray,
        timestamps: np.ndarray,
        reporter: TrainingReporter,
    ) -> None:
        """Fit on `train_index`, early-stop and select on `validation_index`.
        Both are sorted, contain only rows with finite features and labels,
        and never overlap. Must call `reporter.checkpoint()` at least once per
        batch / round / chunk."""

    task: str

    def predict_value(self, features: np.ndarray, index: np.ndarray) -> np.ndarray:
        """Regression adapters only: the predicted target (same units as the
        fitted labels) for each row in `index` (float64), causal like
        `predict_probability`."""

    def predict_probability(self, features: np.ndarray, index: np.ndarray) -> np.ndarray:
        """P(up) for each row in `index` (float64, in [0, 1]), using only
        feature rows <= that row. Called with one row at a time during the
        test walk, and with many rows when scoring validation or tuning."""

    def save(self, directory: str) -> str:
        """Write the fitted model into `directory`; return the file path."""


class NoPriceModel:
    """The price-model slot of a model whose registry entry has ``price: null``
    (Probit, Naive Bayes, the calibrated classifier, ...): no library, nothing
    to fit, no forecast line. ``models.build_adapter(key, ..., task="regression")``
    returns one for such a key, so the engine can take it from the same factory
    as every other price model and check ``available`` (False) instead of
    special-casing the key.

    ``fit`` does nothing, ``save`` writes nothing (the fold then has no
    ``price_model/`` directory: "none" in the explainer's readiness), and the
    two predict methods raise with a sentence naming the model."""

    available = False
    task = "regression"
    step_unit = "single_fit"

    def __init__(self, key: str) -> None:
        self.key = key
        self.family = key
        self.parameters: dict = {}
        self.best_iteration = None

    def _reason(self) -> str:
        label = MODEL_LABELS.get(self.key, self.key)
        return (f"{label} ({self.key}) has no price model: its registry entry's price is null, "
                "so the run makes no price forecast")

    def minimum_history(self) -> int:
        return 1

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        return None

    def predict_value(self, features, index):
        raise RuntimeError(self._reason())

    def predict_probability(self, features, index):
        raise RuntimeError(self._reason() + "; P(up) comes from its direction model")

    def save(self, directory: str) -> str:
        return ""


def check_index(features: np.ndarray, labels: np.ndarray, index: np.ndarray, name: str) -> None:
    """Assert an index array is what the contract promises (used by tests and
    adapters that want a cheap guard)."""
    if index.ndim != 1:
        raise ValueError(f"{name} must be one-dimensional")
    if index.size and (np.any(np.diff(index) <= 0)):
        raise ValueError(f"{name} must be strictly increasing")
    if index.size and not np.all(np.isfinite(features[index])):
        raise ValueError(f"{name} includes rows with non-finite features")
    if index.size and not np.all(np.isfinite(labels[index])):
        raise ValueError(f"{name} includes rows without a label")
