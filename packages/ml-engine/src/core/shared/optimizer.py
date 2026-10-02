"""Base optimizer interface and data structures for hyperparameter search.

Provides the abstract ``BaseOptimizer`` class, search-space definitions,
result containers, and a registry/factory so concrete optimizers (Optuna,
Bayesian, PSO, …) can be plugged in without touching calling code.

All SSE communication with the Node.js server goes through the stdout
protocol emitters in ``protocol.py``.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Protocol, runtime_checkable

try:
    import orjson

    def _json_dumps(obj: Any) -> str:
        return orjson.dumps(obj, option=orjson.OPT_SERIALIZE_NUMPY).decode()
except ImportError:
    import json

    def _json_dumps(obj: Any) -> str:  # type: ignore[misc]
        return json.dumps(obj, default=str)


from .protocol import emit, emit_log

logger = logging.getLogger(__name__)

__all__ = [
    "SearchDimension",
    "SearchSpace",
    "TrialResult",
    "OptimizationResult",
    "OptimizerCallback",
    "SSECallback",
    "BaseOptimizer",
    "OptimizerRegistry",
]


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class SearchDimension:
    """Definition of a single hyperparameter's search space.

    Attributes:
        name: Parameter name (must be unique within a ``SearchSpace``).
        dim_type: One of ``'int'``, ``'float'``, ``'categorical'``, ``'bool'``.
        low: Lower bound (inclusive) for ``int`` / ``float`` dimensions.
        high: Upper bound (inclusive) for ``int`` / ``float`` dimensions.
        step: Step size for ``int`` dimensions.
        log_scale: Whether to sample in log space.
        choices: Allowed values for ``categorical`` dimensions.
        distribution: Sampling distribution hint —
            ``'uniform'``, ``'loguniform'``, ``'normal'``, ``'choice'``.
        default: Optional default value used when no search is requested.
    """

    name: str
    dim_type: str  # 'int', 'float', 'categorical', 'bool'
    low: float | None = None
    high: float | None = None
    step: float | None = None
    log_scale: bool = False
    choices: list | None = None
    distribution: str = "uniform"
    default: float | str | bool | None = None

    def __post_init__(self) -> None:
        valid_types = {"int", "float", "categorical", "bool"}
        if self.dim_type not in valid_types:
            raise ValueError(
                f"Invalid dim_type '{self.dim_type}' for '{self.name}'. "
                f"Must be one of {valid_types}."
            )
        if self.dim_type in {"int", "float"} and (self.low is None or self.high is None):
            raise ValueError(
                f"Dimension '{self.name}' (type={self.dim_type}) requires both 'low' and 'high'."
            )
        if self.dim_type == "categorical" and not self.choices:
            raise ValueError(f"Dimension '{self.name}' (type=categorical) requires 'choices'.")

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a plain dict, dropping ``None`` values."""
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class SearchSpace:
    """Ordered collection of search dimensions.

    Attributes:
        dimensions: Mapping from parameter name to ``SearchDimension``.
    """

    dimensions: dict[str, SearchDimension] = field(default_factory=dict)

    # -- construction helpers ------------------------------------------------

    @classmethod
    def from_dict(cls, config: dict[str, Any]) -> SearchSpace:
        """Parse a ``SearchSpace`` from a JSON-compatible dict.

        Expected format::

            {
                "param_name": {
                    "type": "float",
                    "low": 0.001,
                    "high": 1.0,
                    "log_scale": true
                },
                ...
            }

        Args:
            config: Dict mapping parameter names to dimension specs.

        Returns:
            A new ``SearchSpace`` instance.
        """
        dims: dict[str, SearchDimension] = {}
        for name, spec in config.items():
            spec = dict(spec)  # shallow copy so we don't mutate the input
            dim_type = spec.pop("type", spec.pop("dim_type", "float"))
            dims[name] = SearchDimension(name=name, dim_type=dim_type, **spec)
        return cls(dimensions=dims)

    # -- serialization -------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        """Serialize back to the same format accepted by ``from_dict``."""
        out: dict[str, Any] = {}
        for name, dim in self.dimensions.items():
            d = dim.to_dict()
            d.pop("name", None)
            # Rename dim_type → type for the external representation
            d["type"] = d.pop("dim_type")
            out[name] = d
        return out

    # -- convenience filters -------------------------------------------------

    @property
    def continuous_dims(self) -> list[SearchDimension]:
        """Return dimensions with ``int`` or ``float`` type."""
        return [d for d in self.dimensions.values() if d.dim_type in {"int", "float"}]

    @property
    def categorical_dims(self) -> list[SearchDimension]:
        """Return dimensions with ``categorical`` or ``bool`` type."""
        return [d for d in self.dimensions.values() if d.dim_type in {"categorical", "bool"}]

    def __len__(self) -> int:
        return len(self.dimensions)

    def __iter__(self):
        return iter(self.dimensions.values())

    def __getitem__(self, name: str) -> SearchDimension:
        return self.dimensions[name]


@dataclass
class TrialResult:
    """Outcome of a single hyperparameter trial.

    Attributes:
        trial_id: Sequential trial index.
        params: Hyperparameter values used for this trial.
        score: Objective value (lower = better when minimising).
        metrics: Additional metrics beyond the primary objective.
        duration_sec: Wall-clock time for the trial in seconds.
        pruned: Whether the trial was stopped early by a pruner.
        error: Error message if the trial failed.
        iteration_history: Per-iteration metrics within the trial
            (e.g. per-epoch loss).
    """

    trial_id: int
    params: dict[str, Any]
    score: float
    metrics: dict[str, float] = field(default_factory=dict)
    duration_sec: float = 0.0
    pruned: bool = False
    error: str | None = None
    iteration_history: list[dict] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-friendly dict."""
        return asdict(self)


@dataclass
class OptimizationResult:
    """Aggregated result of a full hyperparameter search.

    Attributes:
        best_trial: The trial with the best objective score.
        all_trials: Every trial executed during the search.
        best_params: Shortcut to ``best_trial.params``.
        best_score: Shortcut to ``best_trial.score``.
        total_trials: Number of trials requested.
        completed_trials: Trials that finished without error / pruning.
        pruned_trials: Trials stopped early by a pruner.
        elapsed_sec: Total wall-clock time for the optimisation.
        optimizer_type: Name of the optimizer backend used.
        search_space: The search space that was explored.
    """

    best_trial: TrialResult
    all_trials: list[TrialResult]
    best_params: dict[str, Any]
    best_score: float
    total_trials: int
    completed_trials: int
    pruned_trials: int
    elapsed_sec: float
    optimizer_type: str
    search_space: SearchSpace

    def top_n(self, n: int = 5) -> list[TrialResult]:
        """Return the *n* best trials sorted by score (ascending).

        Args:
            n: Number of top trials to return.

        Returns:
            Sorted list of the best ``TrialResult`` instances.
        """
        completed = [t for t in self.all_trials if not t.pruned and t.error is None]
        return sorted(completed, key=lambda t: t.score)[:n]

    def to_dict(self) -> dict[str, Any]:
        """Serialize the full result for JSON transport."""
        return {
            "best_trial": self.best_trial.to_dict(),
            "all_trials": [t.to_dict() for t in self.all_trials],
            "best_params": self.best_params,
            "best_score": self.best_score,
            "total_trials": self.total_trials,
            "completed_trials": self.completed_trials,
            "pruned_trials": self.pruned_trials,
            "elapsed_sec": self.elapsed_sec,
            "optimizer_type": self.optimizer_type,
            "search_space": self.search_space.to_dict(),
        }


# ---------------------------------------------------------------------------
# Callback protocol & default SSE implementation
# ---------------------------------------------------------------------------


@runtime_checkable
class OptimizerCallback(Protocol):
    """Protocol for optimizer lifecycle callbacks."""

    def on_trial_start(self, trial_id: int, params: dict[str, Any]) -> None:
        """Called when a new trial begins."""
        ...

    def on_trial_end(self, result: TrialResult) -> None:
        """Called when a trial completes (success, pruned, or error)."""
        ...

    def on_best_update(self, result: TrialResult) -> None:
        """Called when a new best score is found."""
        ...

    def on_optimization_complete(self, result: OptimizationResult) -> None:
        """Called when the entire optimisation run finishes."""
        ...


class SSECallback:
    """Emits HPO events to stdout for the Node.js server.

    Uses the shared ``protocol.emit`` helper so events flow through the
    same JSON-line channel as training progress.
    """

    def on_trial_start(self, trial_id: int, params: dict[str, Any]) -> None:
        """Emit ``hpo-trial-start`` event."""
        emit(
            {
                "type": "hpo-trial-start",
                "trialId": trial_id,
                "params": params,
            }
        )

    def on_trial_end(self, result: TrialResult) -> None:
        """Emit ``hpo-trial-done`` event."""
        emit(
            {
                "type": "hpo-trial-done",
                "trialId": result.trial_id,
                "score": result.score,
                "params": result.params,
                "metrics": result.metrics,
                "durationSec": result.duration_sec,
                "pruned": result.pruned,
                "error": result.error,
            }
        )

    def on_best_update(self, result: TrialResult) -> None:
        """Emit ``hpo-best-update`` event."""
        emit(
            {
                "type": "hpo-best-update",
                "trialId": result.trial_id,
                "score": result.score,
                "params": result.params,
            }
        )

    def on_optimization_complete(self, result: OptimizationResult) -> None:
        """Emit ``hpo-complete`` event."""
        emit(
            {
                "type": "hpo-complete",
                "bestScore": result.best_score,
                "bestParams": result.best_params,
                "totalTrials": result.total_trials,
                "completedTrials": result.completed_trials,
                "prunedTrials": result.pruned_trials,
                "elapsedSec": result.elapsed_sec,
                "optimizerType": result.optimizer_type,
            }
        )


# ---------------------------------------------------------------------------
# Abstract base optimizer
# ---------------------------------------------------------------------------


class BaseOptimizer(ABC):
    """Abstract base class for hyperparameter optimizers.

    Subclasses must implement:
      * ``_optimize`` — the core search loop.
      * ``get_config_schema`` — JSON schema for the optimizer's own knobs.
      * ``optimizer_type`` — short string identifier.

    Args:
        search_space: The search space to explore.
        direction: ``'minimize'`` or ``'maximize'``.
        n_trials: Maximum number of trials.
        n_jobs: Parallel workers (``1`` = sequential).
        seed: Random seed for reproducibility.
        timeout: Optional wall-clock timeout in seconds.
        callbacks: Lifecycle callbacks (defaults to ``[SSECallback()]``).
    """

    def __init__(
        self,
        search_space: SearchSpace,
        direction: str = "minimize",
        n_trials: int = 100,
        n_jobs: int = 1,
        seed: int = 42,
        timeout: float | None = None,
        callbacks: list[OptimizerCallback] | None = None,
    ) -> None:
        if direction not in {"minimize", "maximize"}:
            raise ValueError(f"direction must be 'minimize' or 'maximize', got '{direction}'")

        self.search_space = search_space
        self.direction = direction
        self.n_trials = n_trials
        self.n_jobs = n_jobs
        self.seed = seed
        self.timeout = timeout
        self.callbacks: list[OptimizerCallback] = (
            callbacks if callbacks is not None else [SSECallback()]
        )
        self._best_score: float | None = None
        self._best_trial: TrialResult | None = None

    # -- public API ----------------------------------------------------------

    def optimize(self, objective_fn: Callable[[dict[str, Any]], float]) -> OptimizationResult:
        """Run the full optimisation and return results.

        Wraps ``_optimize`` with timing, logging, callback notification,
        and error handling.

        Args:
            objective_fn: Callable that receives a parameter dict and returns
                a scalar objective value.

        Returns:
            An ``OptimizationResult`` summarising the search.
        """
        logger.info(
            "Starting %s optimisation — %d trials, %d jobs, direction=%s",
            self.optimizer_type,
            self.n_trials,
            self.n_jobs,
            self.direction,
        )
        emit_log(
            f"Starting {self.optimizer_type} optimisation: "
            f"{self.n_trials} trials, direction={self.direction}",
        )

        self._best_score = None
        self._best_trial = None
        t0 = time.perf_counter()

        try:
            result = self._optimize(objective_fn)
        except Exception:
            logger.exception("Optimisation failed")
            raise

        elapsed = time.perf_counter() - t0
        result.elapsed_sec = elapsed

        logger.info(
            "Optimisation complete in %.1fs — best score: %.6f",
            elapsed,
            result.best_score,
        )

        for cb in self.callbacks:
            try:
                cb.on_optimization_complete(result)
            except Exception:
                logger.exception("Callback error in on_optimization_complete")

        return result

    # -- abstract interface --------------------------------------------------

    @abstractmethod
    def _optimize(self, objective_fn: Callable[[dict[str, Any]], float]) -> OptimizationResult:
        """Subclass implements the actual optimisation loop.

        Args:
            objective_fn: The objective to minimise / maximise.

        Returns:
            A fully populated ``OptimizationResult``.
        """

    @abstractmethod
    def get_config_schema(self) -> dict[str, Any]:
        """Return a JSON-schema describing this optimizer's own options.

        Returns:
            A dict conforming to JSON Schema (draft-07+).
        """

    @property
    @abstractmethod
    def optimizer_type(self) -> str:
        """Short identifier for this optimizer (e.g. ``'optuna'``)."""

    # -- callback helpers (for use by subclasses) ----------------------------

    def _notify_trial_start(self, trial_id: int, params: dict[str, Any]) -> None:
        """Invoke ``on_trial_start`` on all registered callbacks."""
        for cb in self.callbacks:
            try:
                cb.on_trial_start(trial_id, params)
            except Exception:
                logger.exception("Callback error in on_trial_start (trial %d)", trial_id)

    def _notify_trial_end(self, result: TrialResult) -> None:
        """Invoke ``on_trial_end`` and conditionally ``on_best_update``."""
        for cb in self.callbacks:
            try:
                cb.on_trial_end(result)
            except Exception:
                logger.exception("Callback error in on_trial_end (trial %d)", result.trial_id)

        # Track best score & notify if improved
        if result.error is None and not result.pruned:
            is_better = (
                self._best_score is None
                or (self.direction == "minimize" and result.score < self._best_score)
                or (self.direction == "maximize" and result.score > self._best_score)
            )
            if is_better:
                self._best_score = result.score
                self._best_trial = result
                self._notify_best_update(result)

    def _notify_best_update(self, result: TrialResult) -> None:
        """Invoke ``on_best_update`` on all registered callbacks."""
        for cb in self.callbacks:
            try:
                cb.on_best_update(result)
            except Exception:
                logger.exception("Callback error in on_best_update (trial %d)", result.trial_id)


# ---------------------------------------------------------------------------
# Optimizer registry / factory
# ---------------------------------------------------------------------------


class OptimizerRegistry:
    """Factory for creating optimizers by name.

    Register concrete optimizers with the ``@OptimizerRegistry.register``
    decorator, then instantiate them via ``OptimizerRegistry.create``.

    Example::

        @OptimizerRegistry.register("optuna")
        class OptunaOptimizer(BaseOptimizer):
            ...

        optimizer = OptimizerRegistry.create("optuna", search_space, n_trials=50)
    """

    _registry: dict[str, type[BaseOptimizer]] = {}

    @classmethod
    def register(cls, name: str) -> Callable[[type[BaseOptimizer]], type[BaseOptimizer]]:
        """Class decorator that registers an optimizer under *name*.

        Args:
            name: Lookup key for ``create`` (e.g. ``'optuna'``).

        Returns:
            The original class, unmodified.
        """

        def decorator(optimizer_cls: type[BaseOptimizer]) -> type[BaseOptimizer]:
            if name in cls._registry:
                logger.warning("Overwriting registered optimizer '%s'", name)
            cls._registry[name] = optimizer_cls
            return optimizer_cls

        return decorator

    @classmethod
    def create(cls, optimizer_type: str, search_space: SearchSpace, **kwargs: Any) -> BaseOptimizer:
        """Instantiate a registered optimizer.

        Args:
            optimizer_type: Key used in ``@register``.
            search_space: The search space to pass to the optimizer.
            **kwargs: Forwarded to the optimizer constructor.

        Returns:
            A ready-to-use ``BaseOptimizer`` instance.

        Raises:
            KeyError: If *optimizer_type* has not been registered.
        """
        if optimizer_type not in cls._registry:
            available = ", ".join(sorted(cls._registry)) or "(none)"
            raise KeyError(f"Unknown optimizer '{optimizer_type}'. Available: {available}")
        return cls._registry[optimizer_type](search_space=search_space, **kwargs)

    @classmethod
    def list_available(cls) -> list[str]:
        """Return sorted list of registered optimizer names."""
        return sorted(cls._registry)

    @classmethod
    def get_config_schema(cls, optimizer_type: str) -> dict[str, Any]:
        """Return the JSON config schema for a registered optimizer.

        Creates a temporary instance with a dummy search space to call
        ``get_config_schema`` on.

        Args:
            optimizer_type: Registered optimizer name.

        Returns:
            JSON-schema dict.

        Raises:
            KeyError: If *optimizer_type* has not been registered.
        """
        if optimizer_type not in cls._registry:
            available = ", ".join(sorted(cls._registry)) or "(none)"
            raise KeyError(f"Unknown optimizer '{optimizer_type}'. Available: {available}")
        # Instantiate with a minimal empty search space to access the schema
        dummy_space = SearchSpace()
        instance = cls._registry[optimizer_type](search_space=dummy_space)
        return instance.get_config_schema()
