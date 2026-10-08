"""Model families behind the Model Cycle's `ModelAdapter` contract.

Exports the engine depends on:

    build_adapter(family, parameters, device, seed, task="classification") -> ModelAdapter
    default_parameters(family) -> dict
    resolve_parameters(family, parameters) -> dict
    suggest_parameters(trial, family, base_parameters) -> dict
    FAMILY_PARAMETER_KEYS: dict[str, tuple[str, ...]]
    load_adapter(directory, device="cpu") -> ModelAdapter   (reload a saved model)
    ADAPTER_CLASSES / adapter_class(adapter)                 (the lazy dispatch table)

A "family" is any key of the model registry (`packages/config/cycle_models/`, read by
`catalog.py`). The registry's `adapter` field decides who builds it:

    legacy        the eight families that predate the registry, built here
                  exactly as before (validation `_DEFAULTS` + the checks below,
                  Optuna spaces in `suggest_parameters`), so their runs are
                  bitwise the same
    scikit_learn  cycle.sklearn_adapter:SklearnEstimatorAdapter
    catboost      cycle.catboost_adapter:CatBoostAdapter
    statsmodels   cycle.statsmodels_adapter:ProbitAdapter
    neural        cycle.networks:NeuralAdapter

Non-legacy adapters are imported only when such a key is built or loaded, and
are constructed as ``Class(key, entry, parameters, device, seed, task=task)``
with ``parameters`` resolved by ``catalog.resolve_parameters``. A key whose
entry has ``price: null`` gets an ``adapter.NoPriceModel`` for
``task="regression"``.

Linear and tree adapters live here; the four PyTorch families live in
`networks.py`, imported lazily so a tree-only run never imports torch.

How each family maps onto the reporter (`adapter.TrainingReporter`):

    family               step_unit        epoch field means        batch reports
    logistic_regression  solver_pass      solver pass k of 10      one per pass (whole window)
      (task=regression)  solver_pass      the one ridge solve      one (whole window)
    random_forest        tree_batch       tree chunk k of n        one per chunk (whole window)
    xgboost / lightgbm   boosting_round   boosting round r of R    one per round (whole window)
    neural families      epoch            epoch                    one per contiguous block

For boosting, `epoch_started` fires at the first round of each ten-round
chunk and `epoch_finished` at every tenth round and at the last round, so a
started/finished pair brackets ten rounds (their epoch numbers differ: 1 and
10, 11 and 20, ...). Tree families report the whole training index as the
span of every step because every round/chunk sees the whole window.

Classification (the direction model): validation loss everywhere is the
plain binary log loss of P(up) against the labels (no class weighting), so it
is comparable across families.

Regression (the price model, ``task="regression"``): the labels are the
engine's volatility-scaled forward move. The model families become Ridge
regression (``logistic_regression``; alpha = 1 / regularization_strength),
RandomForestRegressor, xgboost ``reg:squarederror`` and LightGBM ``regression``
(L2), each fitted on the TRAINING target clipped at its own training 1st / 99th
percentiles (validation and test rows are never clipped and never move the
bounds). Train and validation loss are mean absolute error in target units
(train against the clipped target the model was fitted on, validation against
the raw target), ``validation_accuracy`` is the accuracy of the predicted sign
on rows where prediction and target are both non-zero, ``validation_f1_score``
is None. ``predict_value`` returns the prediction in target units and
``predict_probability`` refuses.

Design: `docs/plans/2026-09-25-model-cycle.md`.
"""

from __future__ import annotations

import importlib
import inspect
import json
import math
import os
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import catalog
from .adapter import (
    MODEL_FAMILIES,
    MODEL_LABELS,
    MODEL_TASKS,
    NEURAL_FAMILIES,
    BatchReport,
    EpochReport,
    NoPriceModel,
    TrainingReporter,
    check_index,
)

# ─── parameters ─────────────────────────────────────────────────────────────

_DEFAULTS: dict[str, dict[str, int | float]] = {
    "logistic_regression": {
        "regularization_strength": 1.0,
        "max_iterations": 300,
    },
    "random_forest": {
        "tree_count": 300,
        "max_depth": 8,
        "min_samples_leaf": 20,
        "max_features_fraction": 0.5,
    },
    "xgboost": {
        "boosting_rounds": 400,
        "max_depth": 6,
        "learning_rate": 0.05,
        "subsample": 0.8,
        "column_subsample": 0.8,
        "min_child_weight": 1.0,
        "l2_regularization": 1.0,
        "early_stopping_rounds": 50,
    },
    "lightgbm": {
        "boosting_rounds": 400,
        "leaf_count": 31,
        "learning_rate": 0.05,
        "subsample": 0.8,
        "column_subsample": 0.8,
        "min_child_samples": 20,
        "l2_regularization": 1.0,
        "early_stopping_rounds": 50,
    },
    "multilayer_perceptron": {
        "hidden_size": 128,
        "layer_count": 2,
        "dropout": 0.2,
        "learning_rate": 0.001,
        "weight_decay": 0.0001,
        "batch_size": 256,
        "epochs": 20,
        "patience": 5,
    },
    "lstm": {
        "sequence_length": 32,
        "hidden_size": 64,
        "layer_count": 1,
        "dropout": 0.2,
        "learning_rate": 0.001,
        "weight_decay": 0.0001,
        "batch_size": 256,
        "epochs": 20,
        "patience": 5,
    },
    "temporal_convolution_network": {
        "sequence_length": 32,
        "channel_count": 32,
        "kernel_size": 3,
        "layer_count": 3,
        "dropout": 0.2,
        "learning_rate": 0.001,
        "weight_decay": 0.0001,
        "batch_size": 256,
        "epochs": 20,
        "patience": 5,
    },
    "transformer_encoder": {
        "sequence_length": 32,
        "model_dimension": 32,
        "head_count": 4,
        "layer_count": 2,
        "dropout": 0.1,
        "learning_rate": 0.0005,
        "weight_decay": 0.0001,
        "batch_size": 256,
        "epochs": 20,
        "patience": 5,
    },
}

# Every registry key's Model-group keys, in order: the legacy families from
# `_DEFAULTS` (which the registry mirrors), every other model from its entry.
FAMILY_PARAMETER_KEYS: dict[str, tuple[str, ...]] = {
    family: tuple(_DEFAULTS[family]) if family in _DEFAULTS
    else tuple(catalog.entry(family)["parameters"])
    for family in MODEL_FAMILIES
}

# Keys that must be at least 1 / strictly positive / inside (0, 1].
_POSITIVE_INTEGER_KEYS = {
    "max_iterations", "tree_count", "max_depth", "min_samples_leaf", "boosting_rounds",
    "leaf_count", "min_child_samples", "hidden_size", "layer_count", "batch_size", "epochs",
    "patience", "sequence_length", "channel_count", "kernel_size", "model_dimension",
    "head_count",
}
_POSITIVE_REAL_KEYS = {"regularization_strength", "learning_rate"}
_FRACTION_KEYS = {"max_features_fraction", "subsample", "column_subsample"}
_NON_NEGATIVE_KEYS = {
    "min_child_weight", "l2_regularization", "weight_decay", "dropout", "early_stopping_rounds",
}


def _check_family(family: str) -> None:
    if family not in MODEL_FAMILIES:
        raise ValueError(
            f"unknown model family {family!r}; valid families: {', '.join(MODEL_FAMILIES)}"
        )


def _is_legacy(family: str) -> bool:
    return family in _DEFAULTS


def default_parameters(family: str) -> dict:
    """The family's Model-group keys and defaults (a fresh copy). Legacy
    families from `_DEFAULTS`, every other model from the registry."""
    _check_family(family)
    if not _is_legacy(family):
        return catalog.defaults(family)
    return dict(_DEFAULTS[family])


def resolve_parameters(family: str, parameters: dict | None) -> dict:
    """Take the family's keys from `parameters` (extra keys are ignored), fill
    the rest from the defaults, coerce to the default's type and validate.
    Non-legacy models are resolved by `catalog.resolve_parameters` (declared
    types, bounds and choices)."""
    _check_family(family)
    if not _is_legacy(family):
        return catalog.resolve_parameters(family, parameters)
    parameters = parameters or {}
    resolved: dict[str, int | float] = {}
    for key, default in _DEFAULTS[family].items():
        raw = parameters.get(key, default)
        if raw is None:
            raw = default
        if isinstance(default, int) and not isinstance(default, bool):
            value = float(raw)
            if not value.is_integer():
                raise ValueError(f"{family}: {key} must be a whole number, got {raw!r}")
            value = int(value)
        else:
            value = float(raw)
            if not math.isfinite(value):
                raise ValueError(f"{family}: {key} must be finite, got {raw!r}")
        if key in _POSITIVE_INTEGER_KEYS and value < 1:
            raise ValueError(f"{family}: {key} must be at least 1, got {value}")
        if key in _POSITIVE_REAL_KEYS and value <= 0:
            raise ValueError(f"{family}: {key} must be greater than 0, got {value}")
        if key in _FRACTION_KEYS and not (0.0 < value <= 1.0):
            raise ValueError(f"{family}: {key} must be in (0, 1], got {value}")
        if key in _NON_NEGATIVE_KEYS and value < 0:
            raise ValueError(f"{family}: {key} must not be negative, got {value}")
        if key == "dropout" and value >= 1.0:
            raise ValueError(f"{family}: dropout must be below 1, got {value}")
        resolved[key] = value
    if family == "temporal_convolution_network" and resolved["kernel_size"] < 2:
        raise ValueError("temporal_convolution_network: kernel_size must be at least 2")
    return resolved


def suggest_parameters(trial, family: str, base_parameters: dict, pinned=()) -> dict:
    """Optuna search space per model, read from the registry's `search` blocks
    (`packages/config/cycle_models/`): every searchable parameter not in ``pinned``
    is suggested under its own name over `base_parameters` (resolved).
    Training length (epochs, boosting rounds, tree count, solver iterations,
    patience, early-stopping rounds) and the sequence length carry no search
    space, so trials stay affordable and the engine's history requirement does
    not move between trials. A legacy family's values are validated by this
    module's `resolve_parameters` (its rules predate the registry); every other
    model by `catalog.resolve_parameters`."""
    _check_family(family)
    if not _is_legacy(family):
        return catalog.suggest_parameters(trial, family, base_parameters, pinned=pinned)
    base = resolve_parameters(family, base_parameters)
    tuned = catalog.suggested_values(trial, family, pinned)
    return resolve_parameters(family, {**base, **tuned})


def _check_task(task: str) -> None:
    if task not in MODEL_TASKS:
        raise ValueError(f"unknown task {task!r}; valid tasks: {', '.join(MODEL_TASKS)}")


# The non-legacy adapters, by the registry's `adapter` field. Strings, so a
# model library (and the module that wraps it) is imported only when a key
# that needs it is built or loaded.
ADAPTER_CLASSES: dict[str, str] = {
    "scikit_learn": "cycle.sklearn_adapter:SklearnEstimatorAdapter",
    "catboost": "cycle.catboost_adapter:CatBoostAdapter",
    "statsmodels": "cycle.statsmodels_adapter:ProbitAdapter",
    "neural": "cycle.networks:NeuralAdapter",
    # one module per catalog spec the Cycle grew to cover (2026-09-27)
    "tree_boosted_neural_embedding": "cycle.adapters_extra.tree_boosted_neural_embedding:TreeBoostedNeuralEmbeddingAdapter",
    "attention_weighted_forecast_stack": "cycle.adapters_extra.attention_weighted_forecast_stack:AttentionWeightedForecastStackAdapter",
    "bayesian_neural_hybrid": "cycle.adapters_extra.bayesian_neural_hybrid:BayesianNeuralHybridAdapter",
    # hidden Markov regimes + regime Monte Carlo + Kronos + FinBERT into a gradient-boosted decision model (2026-10-07)
    "regime_montecarlo_decision": "cycle.adapters_extra.regime_montecarlo_decision:RegimeMonteCarloDecisionAdapter",
    # the bridge families, one package each (cycle/adapters_extra/<family>/adapter.py), built on
    # cycle/bridges/ and bound to the run's cycle.market.MarketView (2026-09-29)
    "discrete_state_agent": "cycle.adapters_extra.discrete_state_agent.adapter:DiscreteStateAgentAdapter",
    "deep_value_agent": "cycle.adapters_extra.deep_value_agent.adapter:DeepValueAgentAdapter",
    "policy_agent": "cycle.adapters_extra.policy_agent.adapter:PolicyAgentAdapter",
    "hierarchical_agent": "cycle.adapters_extra.hierarchical_agent.adapter:HierarchicalAgentAdapter",
    "meta_agent": "cycle.adapters_extra.meta_agent.adapter:MetaAgentAdapter",
    "world_model_agent": "cycle.adapters_extra.world_model_agent.adapter:WorldModelAgentAdapter",
    "planning_agent": "cycle.adapters_extra.planning_agent.adapter:PlanningAgentAdapter",
    "signal_program": "cycle.adapters_extra.signal_program.adapter:SignalProgramAdapter",
    "policy_search": "cycle.adapters_extra.policy_search.adapter:PolicySearchAdapter",
    "path_simulator": "cycle.adapters_extra.path_simulator.adapter:PathSimulatorAdapter",
    "series_forecast": "cycle.adapters_extra.series_forecast.adapter:SeriesForecastAdapter",
    "barrier_survival": "cycle.adapters_extra.barrier_survival.adapter:BarrierSurvivalAdapter",
    "glm_bridge": "cycle.adapters_extra.glm_bridge.adapter:GlmBridgeAdapter",
    "bayesian_predictive": "cycle.adapters_extra.bayesian_predictive.adapter:BayesianPredictiveAdapter",
    "decision_graph": "cycle.adapters_extra.decision_graph.adapter:DecisionGraphAdapter",
    "symbolic_reasoner": "cycle.adapters_extra.symbolic_reasoner.adapter:SymbolicReasonerAdapter",
    "self_supervised_probe": "cycle.adapters_extra.self_supervised_probe.adapter:SelfSupervisedProbeAdapter",
    "density_classifier": "cycle.adapters_extra.density_classifier.adapter:DensityClassifierAdapter",
    "implicit_generator_classifier": "cycle.adapters_extra.implicit_generator_classifier.adapter:ImplicitGeneratorClassifierAdapter",
    "latent_state_readout": "cycle.adapters_extra.latent_state_readout.adapter:LatentStateReadoutAdapter",
    "latent_projection_head": "cycle.adapters_extra.latent_projection_head.adapter:LatentProjectionHeadAdapter",
    "graph_label_inference": "cycle.adapters_extra.graph_label_inference.adapter:GraphLabelInferenceAdapter",
    "pseudo_label_ensemble": "cycle.adapters_extra.pseudo_label_ensemble.adapter:PseudoLabelEnsembleAdapter",
    "semi_supervised_network": "cycle.adapters_extra.semi_supervised_network.adapter:SemiSupervisedNetworkAdapter",
    "meta_symbolic_router": "cycle.adapters_extra.meta_symbolic_router.adapter:MetaSymbolicRouterAdapter",
}

_REGISTRY_CONSTRUCTOR = "(key, entry, parameters, device, seed, task)"


def _module_name(name: str) -> str:
    """`cycle.x` in the table, under whatever name this package was imported as."""
    package = __package__ or "cycle"
    return package + name[len("cycle"):] if name.startswith("cycle.") else name


def adapter_class(adapter: str, key: str | None = None):
    """Import and return the class the dispatch table names for `adapter`.
    Raises NotImplementedError naming the model when its module or class does
    not exist yet; any other import failure (a missing library inside the
    module) propagates unchanged."""
    if adapter not in ADAPTER_CLASSES:
        raise ValueError(f"no adapter class for {adapter!r}; the table has: {', '.join(ADAPTER_CLASSES)}")
    target = ADAPTER_CLASSES[adapter]
    module_name, _, attribute = target.partition(":")
    module_name = _module_name(module_name)
    who = f"{MODEL_LABELS.get(key, key)} ({key})" if key else f"the {adapter!r} adapter"
    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as error:
        # the module itself, or its package (a bridge family's `<family>/adapter.py`), is not written
        # yet; a library missing INSIDE an existing module is a different failure and propagates
        if error.name != module_name and not module_name.startswith(f"{error.name}."):
            raise
        raise NotImplementedError(f"{who} is built by {target}, which does not exist yet") from None
    cls = getattr(module, attribute, None)
    if cls is None:
        raise NotImplementedError(f"{who} is built by {target}, which does not exist yet")
    return cls


def build_adapter(family: str, parameters: dict | None, device: str, seed: int,
                  task: str = "classification"):
    """Build one registry model's adapter. `device` is "cuda", "cpu" or "auto"
    (neural families resolve "auto" to CUDA when available; tree families use
    the GPU only for xgboost and only when device == "cuda"). `task` is
    "classification" (direction model, `predict_probability`) or "regression"
    (price model, `predict_value`).

    Legacy families are built here exactly as before. Every other key goes
    through `ADAPTER_CLASSES` with the registry constructor
    ``(key, entry, parameters, device, seed, task=task)``; a class that does
    not take it yet (``networks.NeuralAdapter`` before it learns registry keys)
    fails with NotImplementedError before anything is constructed. A model
    with no price model returns ``NoPriceModel`` for ``task="regression"``.
    This does not refuse a key the registry marks not runnable: its package's
    tests build it before flipping the flag; `main.py` refuses it for runs."""
    _check_family(family)
    _check_task(task)
    if _is_legacy(family):
        resolved = resolve_parameters(family, parameters)
        if family in NEURAL_FAMILIES:
            from . import networks  # lazy: tree-only runs never import torch

            return networks.NeuralAdapter(family, resolved, device, int(seed), task=task)
        return _tabular_class(family, task)(resolved, device, int(seed), task=task)
    entry = catalog.entry(family)
    if task == "regression" and entry["price"] is None:
        return NoPriceModel(family)
    resolved = catalog.resolve_parameters(family, parameters)
    cls = adapter_class(entry["adapter"], family)
    try:
        inspect.signature(cls).bind(family, entry, resolved, device, int(seed), task=task)
    except TypeError:
        raise NotImplementedError(
            f"{MODEL_LABELS[family]} ({family}): {ADAPTER_CLASSES[entry['adapter']]} does not take "
            f"the registry constructor {_REGISTRY_CONSTRUCTOR} yet"
        ) from None
    return cls(family, entry, resolved, device, int(seed), task=task)


def load_adapter(directory: str, device: str = "cpu"):
    """Rebuild a saved adapter from `directory` (what `save()` wrote). A
    model.json without a `task` key predates the price model: classification.
    One without an `adapter` key predates the registry: a legacy family, named
    by `family`. Otherwise `adapter` picks the class from `ADAPTER_CLASSES`,
    whose ``load(directory, ...)`` receives ``metadata=`` and / or ``device=``
    when its signature names them."""
    metadata = json.loads((Path(directory) / "model.json").read_text(encoding="utf-8"))
    kind = metadata.get("adapter", "legacy")
    task = metadata.get("task", "classification")
    _check_task(task)
    if kind == "legacy":
        family = metadata.get("family") or metadata["key"]
        _check_family(family)
        if family in NEURAL_FAMILIES:
            from . import networks

            return networks.NeuralAdapter.load(directory, device)
        return _tabular_class(family, task).load(directory, metadata)
    if kind == "derived":
        # A direction-from-price model: its price model lives in a subfolder and
        # reloads through this same function.
        from .derived import DerivedDirectionAdapter

        return DerivedDirectionAdapter.load(directory, device, load_price_adapter=load_adapter)
    cls = adapter_class(kind, metadata.get("key") or metadata.get("family"))
    accepted = inspect.signature(cls.load).parameters
    arguments = {}
    if "metadata" in accepted:
        arguments["metadata"] = metadata
    if "device" in accepted:
        arguments["device"] = device
    return cls.load(directory, **arguments)


# ─── shared scoring ────────────────────────────────────────────────────────

_PROBABILITY_FLOOR = 1e-7


def binary_scores(probability: np.ndarray, labels: np.ndarray) -> dict[str, float | None]:
    """Plain log loss, accuracy at 0.5 and F1 of the up class.
    F1 is None when there are no positives and no predicted positives."""
    probability = np.asarray(probability, dtype=np.float64)
    labels = np.asarray(labels, dtype=np.float64)
    if probability.size == 0:
        return {"log_loss": None, "accuracy": None, "f1_score": None}
    clipped = np.clip(probability, _PROBABILITY_FLOOR, 1.0 - _PROBABILITY_FLOOR)
    log_loss = float(-np.mean(labels * np.log(clipped) + (1.0 - labels) * np.log(1.0 - clipped)))
    predicted_up = probability >= 0.5
    actual_up = labels >= 0.5
    accuracy = float(np.mean(predicted_up == actual_up))
    true_positive = int(np.sum(predicted_up & actual_up))
    false_positive = int(np.sum(predicted_up & ~actual_up))
    false_negative = int(np.sum(~predicted_up & actual_up))
    denominator = 2 * true_positive + false_positive + false_negative
    f1_score = None if denominator == 0 else float(2 * true_positive / denominator)
    return {"log_loss": log_loss, "accuracy": accuracy, "f1_score": f1_score}


def regression_scores(prediction: np.ndarray, target: np.ndarray) -> dict[str, float | None]:
    """Mean absolute error (target units) and the accuracy of the predicted
    SIGN on rows where prediction and target are both non-zero (None when
    there are none). `f1_score` is always None: there is no positive class."""
    prediction = np.asarray(prediction, dtype=np.float64)
    target = np.asarray(target, dtype=np.float64)
    if prediction.size == 0:
        return {"mean_absolute_error": None, "accuracy": None, "f1_score": None}
    mean_absolute_error = float(np.mean(np.abs(prediction - target)))
    signed = (prediction != 0.0) & (target != 0.0)
    accuracy = (
        float(np.mean(np.sign(prediction[signed]) == np.sign(target[signed])))
        if signed.any() else None
    )
    return {"mean_absolute_error": mean_absolute_error, "accuracy": accuracy, "f1_score": None}


def huber_loss(prediction: np.ndarray, target: np.ndarray, delta: float = 1.0) -> float | None:
    """Mean Huber loss, the same quantity as torch.nn.HuberLoss(delta)."""
    difference = np.asarray(prediction, dtype=np.float64) - np.asarray(target, dtype=np.float64)
    if difference.size == 0:
        return None
    magnitude = np.abs(difference)
    loss = np.where(magnitude <= delta, 0.5 * difference ** 2, delta * (magnitude - 0.5 * delta))
    return float(np.mean(loss))


TARGET_CLIP_PERCENTILES = (1.0, 99.0)


def clip_training_target(target: np.ndarray) -> tuple[np.ndarray, float, float]:
    """Clip a TRAINING target at its own 1st / 99th percentiles. Returns the
    clipped target (float64) and the bounds. Called on training rows only, so
    no validation or test value can move the bounds."""
    target = np.asarray(target, dtype=np.float64)
    low, high = np.percentile(target, TARGET_CLIP_PERCENTILES)
    return np.clip(target, low, high), float(low), float(high)


def _wrong_task_error(family: str, task: str, method: str) -> TypeError:
    if task == "regression":
        return TypeError(
            f"{family}: {method} is not available on a price model (task='regression'); "
            "call predict_value"
        )
    return TypeError(
        f"{family}: {method} is not available on a direction model (task='classification'); "
        "call predict_probability"
    )


def _require_varying_target(family: str, target: np.ndarray) -> None:
    if target.size < 2 or float(np.ptp(target)) == 0.0:
        raise ValueError(
            f"{family}: the training target is constant ({target.size} rows); a price model "
            "needs targets that vary"
        )


def _require_both_classes(family: str, labels: np.ndarray) -> None:
    positives = int(np.sum(labels >= 0.5))
    if positives == 0 or positives == labels.size:
        raise ValueError(
            f"{family}: the training labels contain only one class "
            f"({positives} up of {labels.size}); widen the training window or lower the "
            "label threshold"
        )


def _as_index(index) -> np.ndarray:
    return np.asarray(index, dtype=np.int64).reshape(-1)


def _span(train_index: np.ndarray) -> tuple[int, int]:
    return int(train_index[0]), int(train_index[-1])


def _atomic_write_text(path: Path, text: str) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, path)


def write_metadata(directory: Path, metadata: dict) -> Path:
    """Write the `model.json` sidecar every saved model carries."""
    path = directory / "model.json"
    _atomic_write_text(path, json.dumps(metadata, indent=2, default=str))
    return path


def _base_metadata(adapter, model_file: str, libraries: dict[str, str]) -> dict:
    key = getattr(adapter, "key", adapter.family)
    metadata = {
        "key": key,
        # which `load_adapter` path rebuilds it; the registry is the authority
        "adapter": catalog.entry(key)["adapter"] if key in MODEL_FAMILIES else "legacy",
        "family": adapter.family,
        "task": adapter.task,
        "parameters": dict(adapter.parameters),
        "feature_count": adapter.feature_count,
        "minimum_history": adapter.minimum_history(),
        "step_unit": adapter.step_unit,
        "seed": adapter.seed,
        "device": adapter.device,
        "model_file": model_file,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "libraries": libraries,
    }
    metadata.update(adapter.fit_summary)
    return metadata


def _training_summary(train_index, validation_index, timestamps) -> dict:
    summary = {
        "train_row_count": int(train_index.size),
        "validation_row_count": int(validation_index.size),
    }
    if timestamps is not None and train_index.size:
        summary["train_start"] = int(timestamps[train_index[0]])
        summary["train_end"] = int(timestamps[train_index[-1]])
    if timestamps is not None and validation_index.size:
        summary["validation_start"] = int(timestamps[validation_index[0]])
        summary["validation_end"] = int(timestamps[validation_index[-1]])
    return summary


class _TabularBase:
    """Shared plumbing for the four non-neural families."""

    family = ""
    step_unit = ""

    def __init__(self, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        _check_task(task)
        self.parameters = dict(parameters)
        self.device = "cuda" if device == "cuda" else "cpu"
        self.seed = int(seed)
        self.task = task
        self.feature_count: int | None = None
        self.fit_summary: dict = {}
        self.target_clip: tuple[float, float] | None = None

    @property
    def _loss_name(self) -> str:
        return "mean absolute error" if self.task == "regression" else "log loss"

    def minimum_history(self) -> int:
        return 1

    def _prepare_fit(self, features, labels, train_index, validation_index, reporter):
        train_index = _as_index(train_index)
        validation_index = _as_index(validation_index)
        if train_index.size == 0:
            raise ValueError(f"{self.family}: the training index is empty")
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        if self.task == "regression":
            _require_varying_target(self.family, labels[train_index])
        else:
            _require_both_classes(self.family, labels[train_index])
        self.feature_count = int(features.shape[1])
        reporter.step_unit = self.step_unit
        return train_index, validation_index

    def _regression_target(self, labels: np.ndarray, train_index: np.ndarray) -> np.ndarray:
        """The training target clipped at its training 1st / 99th percentiles;
        records the bounds and how many rows they moved."""
        raw = labels[train_index].astype(np.float64)
        clipped, low, high = clip_training_target(raw)
        self.target_clip = (low, high)
        self._clip_summary = {
            "target_clip_low": low,
            "target_clip_high": high,
            "clipped_train_row_count": int(np.sum(clipped != raw)),
        }
        return clipped

    def _task_scores(self, prediction: np.ndarray, target: np.ndarray) -> dict:
        """{"loss", "accuracy", "f1_score"} for this task: log loss / accuracy
        at 0.5 / F1 for classification; mean absolute error / sign accuracy /
        None for regression."""
        if self.task == "regression":
            scores = regression_scores(prediction, target)
            return {"loss": scores["mean_absolute_error"], "accuracy": scores["accuracy"],
                    "f1_score": None}
        scores = binary_scores(prediction, target)
        return {"loss": scores["log_loss"], "accuracy": scores["accuracy"],
                "f1_score": scores["f1_score"]}

    def _task_summary(self) -> dict:
        return dict(self._clip_summary) if self.task == "regression" else {}

    def _require_task(self, task: str, method: str) -> None:
        if self.task != task:
            raise _wrong_task_error(self.family, self.task, method)

    def predict_value(self, features, index):  # overridden by families with a price model
        raise _wrong_task_error(self.family, self.task, "predict_value")

    def _rows(self, features: np.ndarray, index) -> np.ndarray:
        if self.feature_count is None:
            method = "predict_value" if self.task == "regression" else "predict_probability"
            raise RuntimeError(f"{self.family}: {method} called before fit")
        index = _as_index(index)
        return np.ascontiguousarray(features[index], dtype=np.float32)


# ─── logistic regression ───────────────────────────────────────────────────

class LogisticRegressionAdapter(_TabularBase):
    """sklearn LogisticRegression (lbfgs, balanced class weights) on features
    standardised with the training rows' mean and deviation. Fitted in ten
    warm-started solver passes; the pass with the lowest validation log loss
    is kept."""

    family = "logistic_regression"
    step_unit = "solver_pass"
    pass_count = 10

    def __init__(self, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        if task != "classification":
            raise ValueError("LogisticRegressionAdapter is the direction model; the price model "
                             "is RidgeRegressionAdapter")
        super().__init__(parameters, device, seed, task)
        self.mean: np.ndarray | None = None
        self.scale: np.ndarray | None = None
        self.coefficients: np.ndarray | None = None
        self.intercept: float = 0.0
        self.model = None

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        from sklearn.exceptions import ConvergenceWarning
        from sklearn.linear_model import LogisticRegression

        train_index, validation_index = self._prepare_fit(
            features, labels, train_index, validation_index, reporter
        )
        train_rows = features[train_index].astype(np.float64)
        self.mean = train_rows.mean(axis=0)
        deviation = train_rows.std(axis=0)
        self.scale = np.where(deviation > 1e-12, deviation, 1.0)
        train_matrix = (train_rows - self.mean) / self.scale
        train_labels = labels[train_index].astype(np.int64)
        validation_matrix = (features[validation_index].astype(np.float64) - self.mean) / self.scale
        validation_labels = labels[validation_index]

        iterations_per_pass = max(1, self.parameters["max_iterations"] // self.pass_count)
        self.model = LogisticRegression(
            C=self.parameters["regularization_strength"],
            solver="lbfgs",
            max_iter=iterations_per_pass,
            warm_start=True,
            class_weight="balanced",
            random_state=self.seed,
        )
        span_start, span_end = _span(train_index)
        best_loss = math.inf
        best_pass = 0
        started = time.perf_counter()
        for solver_pass in range(1, self.pass_count + 1):
            reporter.checkpoint()
            reporter.epoch_started(solver_pass, self.pass_count)
            pass_started = time.perf_counter()
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", category=ConvergenceWarning)
                self.model.fit(train_matrix, train_labels)
            elapsed = max(time.perf_counter() - pass_started, 1e-9)
            self._copy_weights()
            train_scores = binary_scores(self._score(train_matrix), train_labels)
            reporter.batch(BatchReport(
                epoch=solver_pass, epoch_count=self.pass_count, batch=1, batch_count=1,
                span_start_index=span_start, span_end_index=span_end,
                train_loss=train_scores["log_loss"],
                samples_per_second=train_index.size / elapsed,
            ))
            validation_scores = self._validate(
                validation_matrix, validation_labels, solver_pass, reporter
            )
            validation_loss = validation_scores["log_loss"]
            is_best = validation_loss is not None and validation_loss < best_loss
            if is_best:
                best_loss = validation_loss
                best_pass = solver_pass
                best_weights = (self.coefficients.copy(), self.intercept)
            elif validation_loss is None and solver_pass == 1:
                best_pass = solver_pass
                best_weights = (self.coefficients.copy(), self.intercept)
            converged = int(np.max(self.model.n_iter_)) < iterations_per_pass
            final_pass = converged or solver_pass == self.pass_count
            reporter.epoch_finished(EpochReport(
                epoch=solver_pass, epoch_count=self.pass_count,
                train_loss=train_scores["log_loss"],
                validation_loss=validation_loss,
                validation_accuracy=validation_scores["accuracy"],
                validation_f1_score=validation_scores["f1_score"],
                is_best=is_best,
                stopped_early=converged and solver_pass < self.pass_count,
            ))
            if final_pass:
                if converged:
                    reporter.log(
                        f"solver converged after pass {solver_pass}/{self.pass_count} "
                        f"({int(np.max(self.model.n_iter_))} of {iterations_per_pass} iterations)"
                    )
                break
        if validation_index.size == 0:
            best_weights = (self.coefficients.copy(), self.intercept)
            best_pass = solver_pass
        self.coefficients, self.intercept = best_weights
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            "best_step": best_pass,
            "best_validation_loss": None if math.isinf(best_loss) else best_loss,
            "fit_seconds": time.perf_counter() - started,
        }
        reporter.log(f"kept solver pass {best_pass} (lowest validation log loss)")

    def _copy_weights(self) -> None:
        self.coefficients = self.model.coef_[0].astype(np.float64).copy()
        self.intercept = float(self.model.intercept_[0])

    def _score(self, matrix: np.ndarray) -> np.ndarray:
        margin = matrix @ self.coefficients + self.intercept
        return 1.0 / (1.0 + np.exp(-np.clip(margin, -500.0, 500.0)))

    def _validate(self, matrix, validation_labels, solver_pass, reporter):
        if validation_labels.size == 0:
            return binary_scores(np.empty(0), np.empty(0))
        reporter.validating(solver_pass, self.pass_count)
        return binary_scores(self._score(matrix), validation_labels)

    def predict_probability(self, features, index):
        rows = self._rows(features, index).astype(np.float64)
        if self.coefficients is None:
            raise RuntimeError("logistic_regression: predict_probability called before fit")
        return self._score((rows - self.mean) / self.scale)

    def save(self, directory: str) -> str:
        import sklearn

        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "model.npz"
        temporary = folder / "model.tmp.npz"
        np.savez(
            temporary, mean=self.mean, scale=self.scale, coefficients=self.coefficients,
            intercept=np.array([self.intercept]),
        )
        os.replace(temporary, path)
        write_metadata(folder, _base_metadata(self, path.name, {"scikit_learn": sklearn.__version__}))
        return str(path)

    @classmethod
    def load(cls, directory: str, metadata: dict):
        adapter = cls(metadata["parameters"], metadata.get("device", "cpu"), metadata["seed"])
        stored = np.load(Path(directory) / metadata["model_file"])
        adapter.mean = stored["mean"]
        adapter.scale = stored["scale"]
        adapter.coefficients = stored["coefficients"]
        adapter.intercept = float(stored["intercept"][0])
        adapter.feature_count = int(metadata["feature_count"])
        return adapter


class RidgeRegressionAdapter(_TabularBase):
    """The linear family's price model: sklearn Ridge (alpha = 1 /
    regularization_strength) on features standardised with the training rows'
    mean and deviation, fitted to the training target clipped at its training
    1st / 99th percentiles. Ridge has a closed-form solution, so the fit is ONE
    solver pass (reported as pass 1 of 1); `max_iterations` is unused."""

    family = "logistic_regression"
    step_unit = "solver_pass"

    def __init__(self, parameters: dict, device: str, seed: int,
                 task: str = "regression") -> None:
        if task != "regression":
            raise ValueError("RidgeRegressionAdapter is the price model; the direction model "
                             "is LogisticRegressionAdapter")
        super().__init__(parameters, device, seed, task)
        self.mean: np.ndarray | None = None
        self.scale: np.ndarray | None = None
        self.coefficients: np.ndarray | None = None
        self.intercept: float = 0.0

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        from sklearn.linear_model import Ridge

        train_index, validation_index = self._prepare_fit(
            features, labels, train_index, validation_index, reporter
        )
        target = self._regression_target(labels, train_index)
        train_rows = features[train_index].astype(np.float64)
        self.mean = train_rows.mean(axis=0)
        deviation = train_rows.std(axis=0)
        self.scale = np.where(deviation > 1e-12, deviation, 1.0)
        train_matrix = (train_rows - self.mean) / self.scale
        alpha = 1.0 / self.parameters["regularization_strength"]

        reporter.checkpoint()
        reporter.epoch_started(1, 1)
        started = time.perf_counter()
        model = Ridge(alpha=alpha)
        model.fit(train_matrix, target)
        elapsed = max(time.perf_counter() - started, 1e-9)
        self.coefficients = np.asarray(model.coef_, dtype=np.float64).reshape(-1).copy()
        self.intercept = float(np.asarray(model.intercept_).reshape(-1)[0])
        train_loss = regression_scores(self._linear(train_matrix), target)["mean_absolute_error"]
        span_start, span_end = _span(train_index)
        reporter.batch(BatchReport(
            epoch=1, epoch_count=1, batch=1, batch_count=1,
            span_start_index=span_start, span_end_index=span_end,
            train_loss=train_loss, samples_per_second=train_index.size / elapsed,
        ))
        scores = {"loss": None, "accuracy": None, "f1_score": None}
        if validation_index.size:
            reporter.validating(1, 1)
            validation_matrix = (
                (features[validation_index].astype(np.float64) - self.mean) / self.scale
            )
            scores = self._task_scores(self._linear(validation_matrix), labels[validation_index])
        reporter.epoch_finished(EpochReport(
            epoch=1, epoch_count=1,
            train_loss=train_loss,
            validation_loss=scores["loss"],
            validation_accuracy=scores["accuracy"],
            validation_f1_score=None,
            is_best=True,
        ))
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            **self._task_summary(),
            "best_step": 1,
            "best_validation_loss": scores["loss"],
            "fit_seconds": time.perf_counter() - started,
        }
        low, high = self.target_clip
        reporter.log(
            f"ridge regression (alpha {alpha:.4g}): one closed-form solve on {train_index.size} "
            f"rows; training target clipped to [{low:.3f}, {high:.3f}] "
            f"({self._clip_summary['clipped_train_row_count']} rows moved)"
        )

    def _linear(self, matrix: np.ndarray) -> np.ndarray:
        return matrix @ self.coefficients + self.intercept

    def predict_value(self, features, index):
        rows = self._rows(features, index).astype(np.float64)
        if self.coefficients is None:
            raise RuntimeError("logistic_regression: predict_value called before fit")
        return self._linear((rows - self.mean) / self.scale)

    def predict_probability(self, features, index):
        raise _wrong_task_error(self.family, self.task, "predict_probability")

    def save(self, directory: str) -> str:
        import sklearn

        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "model.npz"
        temporary = folder / "model.tmp.npz"
        np.savez(
            temporary, mean=self.mean, scale=self.scale, coefficients=self.coefficients,
            intercept=np.array([self.intercept]),
        )
        os.replace(temporary, path)
        write_metadata(folder, _base_metadata(self, path.name, {"scikit_learn": sklearn.__version__}))
        return str(path)

    @classmethod
    def load(cls, directory: str, metadata: dict):
        adapter = cls(metadata["parameters"], metadata.get("device", "cpu"), metadata["seed"])
        stored = np.load(Path(directory) / metadata["model_file"])
        adapter.mean = stored["mean"]
        adapter.scale = stored["scale"]
        adapter.coefficients = stored["coefficients"]
        adapter.intercept = float(stored["intercept"][0])
        adapter.feature_count = int(metadata["feature_count"])
        _restore_clip(adapter, metadata)
        return adapter


def _restore_clip(adapter, metadata: dict) -> None:
    if "target_clip_low" in metadata and "target_clip_high" in metadata:
        adapter.target_clip = (float(metadata["target_clip_low"]),
                               float(metadata["target_clip_high"]))


# ─── random forest ─────────────────────────────────────────────────────────

class RandomForestAdapter(_TabularBase):
    """sklearn RandomForestClassifier grown in warm-started chunks of trees
    (balanced_subsample class weights, all cores); as the price model, a
    RandomForestRegressor (squared-error splits) grown the same way on the
    clipped training target. Every chunk refits on the whole training window,
    so its span is the whole window."""

    family = "random_forest"
    step_unit = "tree_batch"

    def __init__(self, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(parameters, device, seed, task)
        self.model = None
        self._up_column = 1

    def _new_forest(self):
        common = {
            "n_estimators": 0,
            "max_depth": self.parameters["max_depth"],
            "min_samples_leaf": self.parameters["min_samples_leaf"],
            "max_features": self.parameters["max_features_fraction"],
            "warm_start": True,
            "n_jobs": -1,
            "random_state": self.seed,
        }
        if self.task == "regression":
            from sklearn.ensemble import RandomForestRegressor

            return RandomForestRegressor(**common)
        from sklearn.ensemble import RandomForestClassifier

        return RandomForestClassifier(class_weight="balanced_subsample", **common)

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        train_index, validation_index = self._prepare_fit(
            features, labels, train_index, validation_index, reporter
        )
        tree_count = self.parameters["tree_count"]
        chunk = max(10, tree_count // 15)
        chunk_count = math.ceil(tree_count / chunk)
        train_matrix = np.ascontiguousarray(features[train_index], dtype=np.float32)
        if self.task == "regression":
            train_target = self._regression_target(labels, train_index)
        else:
            train_target = labels[train_index].astype(np.int64)
        validation_matrix = np.ascontiguousarray(features[validation_index], dtype=np.float32)
        validation_labels = labels[validation_index]
        self.model = self._new_forest()
        span_start, span_end = _span(train_index)
        best_loss = math.inf
        started = time.perf_counter()
        for chunk_number in range(1, chunk_count + 1):
            reporter.checkpoint()
            reporter.epoch_started(chunk_number, chunk_count)
            chunk_started = time.perf_counter()
            self.model.n_estimators = min(tree_count, chunk_number * chunk)
            with warnings.catch_warnings():
                # Warns that balanced presets are "not recommended for warm_start if the
                # fitted data differs" — every chunk here fits the same rows.
                warnings.simplefilter("ignore", category=UserWarning)
                self.model.fit(train_matrix, train_target)
            elapsed = max(time.perf_counter() - chunk_started, 1e-9)
            if self.task == "classification":
                self._up_column = int(np.flatnonzero(self.model.classes_ == 1)[0])
            added = self.model.n_estimators - (chunk_number - 1) * chunk
            reporter.batch(BatchReport(
                epoch=chunk_number, epoch_count=chunk_count, batch=1, batch_count=1,
                span_start_index=span_start, span_end_index=span_end,
                train_loss=None,
                samples_per_second=train_index.size * added / elapsed,
            ))
            validation_scores = {"loss": None, "accuracy": None, "f1_score": None}
            if validation_index.size:
                reporter.validating(chunk_number, chunk_count)
                validation_scores = self._task_scores(
                    self._forest_output(validation_matrix), validation_labels
                )
            validation_loss = validation_scores["loss"]
            is_best = validation_loss is not None and validation_loss < best_loss
            if is_best:
                best_loss = validation_loss
            reporter.epoch_finished(EpochReport(
                epoch=chunk_number, epoch_count=chunk_count,
                train_loss=None,
                validation_loss=validation_loss,
                validation_accuracy=validation_scores["accuracy"],
                validation_f1_score=validation_scores["f1_score"],
                is_best=is_best,
            ))
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            **self._task_summary(),
            "tree_count": len(self.model.estimators_),
            "best_validation_loss": None if math.isinf(best_loss) else best_loss,
            "fit_seconds": time.perf_counter() - started,
        }
        if self.task == "regression":
            low, high = self.target_clip
            reporter.log(
                f"random forest price model: training target clipped to [{low:.3f}, {high:.3f}] "
                f"({self._clip_summary['clipped_train_row_count']} rows moved)"
            )

    def _forest_output(self, matrix: np.ndarray) -> np.ndarray:
        if self.task == "regression":
            return self._forest_value(matrix)
        return self._forest_probability(matrix)

    def _forest_probability(self, matrix: np.ndarray) -> np.ndarray:
        # A few rows (the test walk) run the trees directly: joblib's dispatch
        # per call costs more than the trees themselves. Averaging each tree's
        # leaf class fractions is exactly what predict_proba does.
        if matrix.shape[0] <= 64:
            total = np.zeros(matrix.shape[0], dtype=np.float64)
            for estimator in self.model.estimators_:
                leaf_fractions = estimator.tree_.predict(matrix)
                total += leaf_fractions.reshape(matrix.shape[0], -1)[:, self._up_column]
            return total / len(self.model.estimators_)
        return self.model.predict_proba(matrix)[:, self._up_column].astype(np.float64)

    def _forest_value(self, matrix: np.ndarray) -> np.ndarray:
        # Same shortcut as `_forest_probability`: averaging each tree's leaf mean
        # is exactly what RandomForestRegressor.predict does.
        if matrix.shape[0] <= 64:
            total = np.zeros(matrix.shape[0], dtype=np.float64)
            for estimator in self.model.estimators_:
                total += estimator.tree_.predict(matrix).reshape(matrix.shape[0], -1)[:, 0]
            return total / len(self.model.estimators_)
        return np.asarray(self.model.predict(matrix), dtype=np.float64).reshape(-1)

    def predict_probability(self, features, index):
        self._require_task("classification", "predict_probability")
        if self.model is None:
            raise RuntimeError("random_forest: predict_probability called before fit")
        return np.clip(self._forest_probability(self._rows(features, index)), 0.0, 1.0)

    def predict_value(self, features, index):
        self._require_task("regression", "predict_value")
        if self.model is None:
            raise RuntimeError("random_forest: predict_value called before fit")
        return self._forest_value(self._rows(features, index))

    def save(self, directory: str) -> str:
        import joblib
        import sklearn

        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "model.joblib"
        temporary = folder / "model.joblib.tmp"
        joblib.dump(self.model, temporary)
        os.replace(temporary, path)
        write_metadata(folder, _base_metadata(self, path.name, {"scikit_learn": sklearn.__version__}))
        return str(path)

    @classmethod
    def load(cls, directory: str, metadata: dict):
        import joblib

        # joblib unpickles: only load a directory this cycle wrote itself
        # (data/models/<model_id>/), never a file from elsewhere.
        adapter = cls(metadata["parameters"], metadata.get("device", "cpu"), metadata["seed"],
                      task=metadata.get("task", "classification"))
        adapter.model = joblib.load(Path(directory) / metadata["model_file"])
        if adapter.task == "classification":
            adapter._up_column = int(np.flatnonzero(adapter.model.classes_ == 1)[0])
        adapter.feature_count = int(metadata["feature_count"])
        _restore_clip(adapter, metadata)
        return adapter


# ─── boosting shared ───────────────────────────────────────────────────────

_BOOSTING_REPORT_EVERY = 10


class _RoundReporter:
    """Turns one finished boosting round into checkpoint / batch / epoch
    reports. `score_validation(round_number)` returns the validation rows'
    prediction (P(up), or the predicted target for a price model) using the
    first `round_number` rounds (only called every tenth round); `scorer`
    turns it into {"accuracy", "f1_score", ...} (`binary_scores` or
    `regression_scores`)."""

    def __init__(self, reporter, total_rounds, span, train_size, validation_labels,
                 score_validation, scorer=binary_scores) -> None:
        self.reporter = reporter
        self.total_rounds = total_rounds
        self.span = span
        self.train_size = train_size
        self.validation_labels = validation_labels
        self.score_validation = score_validation
        self.scorer = scorer
        self.best_loss = math.inf
        self.best_round = 0
        self.last_round = 0
        self.last_train_loss = None
        self.last_validation_loss = None
        self.last_reported_round = 0
        self.round_started = time.perf_counter()

    def before_round(self, round_number: int) -> None:
        self.reporter.checkpoint()
        if (round_number - 1) % _BOOSTING_REPORT_EVERY == 0:
            self.reporter.epoch_started(round_number, self.total_rounds)
        self.round_started = time.perf_counter()

    def after_round(self, round_number: int, train_loss, validation_loss) -> None:
        elapsed = max(time.perf_counter() - self.round_started, 1e-9)
        self.last_round = round_number
        self.last_train_loss = train_loss
        self.last_validation_loss = validation_loss
        if validation_loss is not None and validation_loss < self.best_loss:
            self.best_loss = validation_loss
            self.best_round = round_number
        self.reporter.batch(BatchReport(
            epoch=round_number, epoch_count=self.total_rounds, batch=1, batch_count=1,
            span_start_index=self.span[0], span_end_index=self.span[1],
            train_loss=train_loss,
            samples_per_second=self.train_size / elapsed,
        ))
        if round_number % _BOOSTING_REPORT_EVERY == 0:
            self.report_epoch(round_number, stopped_early=False)
        self.reporter.checkpoint()

    def report_epoch(self, round_number: int, stopped_early: bool) -> None:
        if round_number == self.last_reported_round:
            return
        self.last_reported_round = round_number
        scores = {"accuracy": None, "f1_score": None}
        if self.validation_labels.size:
            self.reporter.validating(round_number, self.total_rounds)
            scores = self.scorer(self.score_validation(round_number), self.validation_labels)
        self.reporter.epoch_finished(EpochReport(
            epoch=round_number, epoch_count=self.total_rounds,
            train_loss=self.last_train_loss,
            validation_loss=self.last_validation_loss,
            validation_accuracy=scores["accuracy"],
            validation_f1_score=scores["f1_score"],
            is_best=self.best_round == round_number,
            stopped_early=stopped_early,
        ))


# ─── xgboost ───────────────────────────────────────────────────────────────

class XGBoostAdapter(_TabularBase):
    """xgboost.train (binary:logistic, hist; as the price model
    reg:squarederror on the clipped training target with mean absolute error
    as the evaluation and early-stopping metric). Trains on the GPU when
    device == "cuda"; prediction always runs on the CPU booster because a
    CUDA booster fed a NumPy row falls back to a slow DMatrix copy."""

    family = "xgboost"
    step_unit = "boosting_round"

    def __init__(self, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(parameters, device, seed, task)
        self.booster = None
        self.best_iteration = 0

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        import xgboost as xgb

        train_index, validation_index = self._prepare_fit(
            features, labels, train_index, validation_index, reporter
        )
        regression = self.task == "regression"
        metric = "mae" if regression else "logloss"
        p = self.parameters
        training_parameters = {
            "objective": "reg:squarederror" if regression else "binary:logistic",
            "eval_metric": metric,
            "tree_method": "hist",
            "device": self.device,
            "max_depth": p["max_depth"],
            "eta": p["learning_rate"],
            "subsample": p["subsample"],
            "colsample_bytree": p["column_subsample"],
            "min_child_weight": p["min_child_weight"],
            "lambda": p["l2_regularization"],
            "seed": self.seed,
            "verbosity": 0,
        }
        train_target = (
            self._regression_target(labels, train_index) if regression else labels[train_index]
        )
        train_matrix = xgb.DMatrix(
            np.ascontiguousarray(features[train_index], dtype=np.float32),
            label=train_target,
        )
        evaluations = [(train_matrix, "train")]
        validation_labels = labels[validation_index]
        validation_matrix = None
        if validation_index.size:
            validation_matrix = xgb.DMatrix(
                np.ascontiguousarray(features[validation_index], dtype=np.float32),
                label=validation_labels,
            )
            evaluations.append((validation_matrix, "validation"))
        total_rounds = p["boosting_rounds"]
        adapter = self

        def score_validation(round_number: int) -> np.ndarray:
            return adapter._callback_booster.predict(
                validation_matrix, iteration_range=(0, round_number)
            )

        rounds = _RoundReporter(
            reporter, total_rounds, _span(train_index), train_index.size, validation_labels,
            score_validation, regression_scores if regression else binary_scores,
        )

        class ReportingCallback(xgb.callback.TrainingCallback):
            def before_iteration(self, model, epoch, evals_log):
                adapter._callback_booster = model
                rounds.before_round(epoch + 1)
                return False

            def after_iteration(self, model, epoch, evals_log):
                train_loss = _last(evals_log.get("train", {}).get(metric))
                validation_loss = _last(evals_log.get("validation", {}).get(metric))
                rounds.after_round(epoch + 1, train_loss, validation_loss)
                return False

        early_stopping = p["early_stopping_rounds"] if validation_index.size else 0
        started = time.perf_counter()
        reporter.log(
            f"xgboost on {self.device}: {train_index.size} training rows, "
            f"{validation_index.size} validation rows, up to {total_rounds} rounds"
            + (f", early stopping after {early_stopping} flat rounds" if early_stopping else "")
        )
        if regression:
            low, high = self.target_clip
            reporter.log(
                f"xgboost price model: squared error on the training target clipped to "
                f"[{low:.3f}, {high:.3f}] ({self._clip_summary['clipped_train_row_count']} rows "
                "moved); early stopping on validation mean absolute error"
            )
        self._callback_booster = None
        booster = xgb.train(
            training_parameters,
            train_matrix,
            num_boost_round=total_rounds,
            evals=evaluations,
            early_stopping_rounds=early_stopping or None,
            callbacks=[ReportingCallback()],
            verbose_eval=False,
        )
        self._callback_booster = booster
        trained_rounds = booster.num_boosted_rounds()
        stopped_early = trained_rounds < total_rounds
        rounds.report_epoch(trained_rounds, stopped_early=stopped_early)
        self._callback_booster = None
        self.best_iteration = trained_rounds - 1
        if early_stopping:
            try:
                self.best_iteration = int(booster.best_iteration)
            except AttributeError:  # early stopping never recorded a best round
                pass
        if stopped_early:
            reporter.log(
                f"early stopping at round {trained_rounds}: best validation {self._loss_name} "
                f"{rounds.best_loss:.4f} at round {rounds.best_round}"
            )
        booster.set_param({"device": "cpu", "nthread": 1})
        self.booster = booster
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            **self._task_summary(),
            "trained_rounds": trained_rounds,
            "best_round": self.best_iteration + 1,
            "best_validation_loss": None if math.isinf(rounds.best_loss) else rounds.best_loss,
            "fit_seconds": time.perf_counter() - started,
        }

    def _booster_output(self, features, index, method: str) -> np.ndarray:
        if self.booster is None:
            raise RuntimeError(f"xgboost: {method} called before fit")
        rows = self._rows(features, index)
        output = self.booster.inplace_predict(rows, iteration_range=(0, self.best_iteration + 1))
        return np.asarray(output, dtype=np.float64).reshape(-1)

    def predict_probability(self, features, index):
        self._require_task("classification", "predict_probability")
        return np.clip(self._booster_output(features, index, "predict_probability"), 0.0, 1.0)

    def predict_value(self, features, index):
        self._require_task("regression", "predict_value")
        return self._booster_output(features, index, "predict_value")

    def save(self, directory: str) -> str:
        import xgboost as xgb

        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "model.ubj"
        temporary = folder / "model.tmp.ubj"
        self.booster.save_model(str(temporary))
        os.replace(temporary, path)
        metadata = _base_metadata(self, path.name, {"xgboost": xgb.__version__})
        metadata["best_iteration"] = self.best_iteration
        write_metadata(folder, metadata)
        return str(path)

    @classmethod
    def load(cls, directory: str, metadata: dict):
        import xgboost as xgb

        adapter = cls(metadata["parameters"], "cpu", metadata["seed"],
                      task=metadata.get("task", "classification"))
        adapter.booster = xgb.Booster(model_file=str(Path(directory) / metadata["model_file"]))
        adapter.booster.set_param({"device": "cpu", "nthread": 1})
        adapter.best_iteration = int(metadata["best_iteration"])
        adapter.feature_count = int(metadata["feature_count"])
        _restore_clip(adapter, metadata)
        return adapter


def _last(values):
    if not values:
        return None
    value = values[-1]
    if isinstance(value, tuple):  # (mean, std) in cross-validation logs
        value = value[0]
    value = float(value)
    return value if math.isfinite(value) else None


# ─── lightgbm ──────────────────────────────────────────────────────────────

class LightGBMAdapter(_TabularBase):
    """lightgbm.train (binary objective, CPU; as the price model the L2
    `regression` objective on the clipped training target with l1 — mean
    absolute error — as the evaluation and early-stopping metric) with bagging
    and feature sub-sampling."""

    family = "lightgbm"
    step_unit = "boosting_round"

    def __init__(self, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(parameters, device, seed, task)
        self.device = "cpu"
        self.booster = None
        self.best_iteration = 0

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        import lightgbm as lgb

        train_index, validation_index = self._prepare_fit(
            features, labels, train_index, validation_index, reporter
        )
        regression = self.task == "regression"
        p = self.parameters
        training_parameters = {
            "objective": "regression" if regression else "binary",
            "metric": "l1" if regression else "binary_logloss",
            "num_leaves": p["leaf_count"],
            "learning_rate": p["learning_rate"],
            "bagging_fraction": p["subsample"],
            "bagging_freq": 1,
            "feature_fraction": p["column_subsample"],
            "lambda_l2": p["l2_regularization"],
            "min_child_samples": p["min_child_samples"],
            "seed": self.seed,
            "deterministic": True,
            "force_col_wise": True,
            "verbosity": -1,
        }
        train_target = (
            self._regression_target(labels, train_index) if regression else labels[train_index]
        )
        # Leave num_threads at LightGBM's default: with num_threads=8 on this 24-thread
        # machine, the every-tenth-round validation predict below made each following
        # update ~110x slower (145 ms/round vs 1.3 ms/round, 14k x 30 rows, measured).
        train_set = lgb.Dataset(
            np.ascontiguousarray(features[train_index], dtype=np.float32),
            label=train_target,
            free_raw_data=False,
        )
        validation_sets = [train_set]
        validation_names = ["train"]
        validation_labels = labels[validation_index]
        validation_matrix = None
        if validation_index.size:
            validation_matrix = np.ascontiguousarray(features[validation_index], dtype=np.float32)
            validation_sets.append(
                lgb.Dataset(validation_matrix, label=validation_labels, reference=train_set)
            )
            validation_names.append("validation")
        total_rounds = p["boosting_rounds"]
        adapter = self

        def score_validation(round_number: int) -> np.ndarray:
            return adapter._callback_booster.predict(validation_matrix, num_iteration=round_number)

        rounds = _RoundReporter(
            reporter, total_rounds, _span(train_index), train_index.size, validation_labels,
            score_validation, regression_scores if regression else binary_scores,
        )

        def before_round(environment) -> None:
            adapter._callback_booster = environment.model
            rounds.before_round(environment.iteration + 1)

        before_round.before_iteration = True
        before_round.order = 0

        def after_round(environment) -> None:
            losses = {name: value for name, _, value, _ in environment.evaluation_result_list}
            rounds.after_round(
                environment.iteration + 1,
                _finite(losses.get("train")),
                _finite(losses.get("validation")),
            )

        after_round.order = 10  # before lightgbm's early stopping (order 30)

        early_stopping = p["early_stopping_rounds"] if validation_index.size else 0
        callbacks = [before_round, after_round]
        if early_stopping:
            callbacks.append(lgb.early_stopping(early_stopping, verbose=False))
        reporter.log(
            f"lightgbm on cpu: {train_index.size} training rows, {validation_index.size} "
            f"validation rows, up to {total_rounds} rounds"
            + (f", early stopping after {early_stopping} flat rounds" if early_stopping else "")
        )
        if regression:
            low, high = self.target_clip
            reporter.log(
                f"lightgbm price model: squared error on the training target clipped to "
                f"[{low:.3f}, {high:.3f}] ({self._clip_summary['clipped_train_row_count']} rows "
                "moved); early stopping on validation mean absolute error"
            )
        started = time.perf_counter()
        self._callback_booster = None
        booster = lgb.train(
            training_parameters,
            train_set,
            num_boost_round=total_rounds,
            valid_sets=validation_sets,
            valid_names=validation_names,
            callbacks=callbacks,
        )
        self._callback_booster = booster
        trained_rounds = booster.current_iteration()
        stopped_early = trained_rounds < total_rounds
        rounds.report_epoch(rounds.last_round, stopped_early=stopped_early)
        self._callback_booster = None
        best = booster.best_iteration if booster.best_iteration > 0 else trained_rounds
        self.best_iteration = int(best)
        if stopped_early:
            reporter.log(
                f"early stopping at round {rounds.last_round}: best validation {self._loss_name} "
                f"{rounds.best_loss:.4f} at round {self.best_iteration}"
            )
        self.booster = booster
        self.fit_summary = {
            **_training_summary(train_index, validation_index, timestamps),
            **self._task_summary(),
            "trained_rounds": int(rounds.last_round),
            "best_round": self.best_iteration,
            "best_validation_loss": None if math.isinf(rounds.best_loss) else rounds.best_loss,
            "fit_seconds": time.perf_counter() - started,
        }

    def _booster_output(self, features, index, method: str) -> np.ndarray:
        if self.booster is None:
            raise RuntimeError(f"lightgbm: {method} called before fit")
        rows = self._rows(features, index)
        output = self.booster.predict(
            rows, num_iteration=self.best_iteration, num_threads=1 if rows.shape[0] < 256 else 0
        )
        return np.asarray(output, dtype=np.float64).reshape(-1)

    def predict_probability(self, features, index):
        self._require_task("classification", "predict_probability")
        return np.clip(self._booster_output(features, index, "predict_probability"), 0.0, 1.0)

    def predict_value(self, features, index):
        self._require_task("regression", "predict_value")
        return self._booster_output(features, index, "predict_value")

    def save(self, directory: str) -> str:
        import lightgbm as lgb

        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "model.txt"
        temporary = folder / "model.tmp.txt"
        self.booster.save_model(str(temporary), num_iteration=self.best_iteration)
        os.replace(temporary, path)
        metadata = _base_metadata(self, path.name, {"lightgbm": lgb.__version__})
        metadata["best_iteration"] = self.best_iteration
        write_metadata(folder, metadata)
        return str(path)

    @classmethod
    def load(cls, directory: str, metadata: dict):
        import lightgbm as lgb

        adapter = cls(metadata["parameters"], "cpu", metadata["seed"],
                      task=metadata.get("task", "classification"))
        adapter.booster = lgb.Booster(model_file=str(Path(directory) / metadata["model_file"]))
        adapter.best_iteration = int(metadata["best_iteration"])
        adapter.feature_count = int(metadata["feature_count"])
        _restore_clip(adapter, metadata)
        return adapter


def _finite(value):
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


_TABULAR_ADAPTERS = {
    "logistic_regression": LogisticRegressionAdapter,
    "random_forest": RandomForestAdapter,
    "xgboost": XGBoostAdapter,
    "lightgbm": LightGBMAdapter,
}

# The price model of each tabular family. Only the linear family changes class
# (logistic regression has no regression form; Ridge is its linear analogue);
# the tree families take `task="regression"` on the same class.
_TABULAR_REGRESSORS = {
    "logistic_regression": RidgeRegressionAdapter,
    "random_forest": RandomForestAdapter,
    "xgboost": XGBoostAdapter,
    "lightgbm": LightGBMAdapter,
}


def _tabular_class(family: str, task: str):
    return (_TABULAR_REGRESSORS if task == "regression" else _TABULAR_ADAPTERS)[family]


__all__ = [
    "ADAPTER_CLASSES",
    "FAMILY_PARAMETER_KEYS",
    "adapter_class",
    "TrainingReporter",
    "binary_scores",
    "build_adapter",
    "clip_training_target",
    "default_parameters",
    "huber_loss",
    "load_adapter",
    "regression_scores",
    "resolve_parameters",
    "suggest_parameters",
]
