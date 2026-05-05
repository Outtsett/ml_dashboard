"""Optuna-based hyperparameter optimizer.

Wraps Optuna's study/trial API behind the ``BaseOptimizer`` interface so the
rest of the ML dashboard can drive hyperparameter search without caring about
the backend.  Supports TPE, CMA-ES, Random, and Grid samplers, as well as
Median, SuccessiveHalving, Hyperband, and no-pruner configurations.

Registered as ``"optuna"`` via ``OptimizerRegistry``.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

import optuna
from optuna.samplers import (
    BaseSampler,
    CmaEsSampler,
    GridSampler,
    RandomSampler,
    TPESampler,
)
from optuna.pruners import (
    BasePruner,
    HyperbandPruner,
    MedianPruner,
    SuccessiveHalvingPruner,
)

from ..shared.optimizer import (
    BaseOptimizer,
    OptimizationResult,
    OptimizerCallback,
    OptimizerRegistry,
    SearchDimension,
    SearchSpace,
    TrialResult,
)
from ..shared.protocol import emit_log

logger = logging.getLogger(__name__)

# Suppress Optuna's own verbose logs so our structured logging dominates.
optuna.logging.set_verbosity(optuna.logging.WARNING)

__all__ = ["OptunaOptimizer"]

# ---------------------------------------------------------------------------
# Sampler / Pruner factory helpers
# ---------------------------------------------------------------------------

_SAMPLER_MAP: dict[str, type[BaseSampler]] = {
    "tpe": TPESampler,
    "cmaes": CmaEsSampler,
    "cma-es": CmaEsSampler,
    "random": RandomSampler,
    "grid": GridSampler,
}

_PRUNER_MAP: dict[str, type[BasePruner]] = {
    "median": MedianPruner,
    "successivehalving": SuccessiveHalvingPruner,
    "successive_halving": SuccessiveHalvingPruner,
    "hyperband": HyperbandPruner,
}


def _build_sampler(
    sampler_type: str,
    seed: int | None,
    n_startup_trials: int,
    search_space: SearchSpace,
) -> BaseSampler:
    """Instantiate an Optuna sampler from a short string key."""
    key = sampler_type.lower().replace(" ", "")
    if key not in _SAMPLER_MAP:
        raise ValueError(
            f"Unknown sampler_type '{sampler_type}'. "
            f"Choose from: {', '.join(sorted(_SAMPLER_MAP))}"
        )

    cls = _SAMPLER_MAP[key]

    if cls is GridSampler:
        # GridSampler requires the full discrete search space up-front.
        grid: dict[str, list] = {}
        for dim in search_space:
            if dim.dim_type == "categorical":
                grid[dim.name] = list(dim.choices)  # type: ignore[arg-type]
            elif dim.dim_type == "bool":
                grid[dim.name] = [True, False]
            elif dim.dim_type == "int":
                step = int(dim.step) if dim.step else 1
                grid[dim.name] = list(range(int(dim.low), int(dim.high) + 1, step))  # type: ignore[arg-type]
            elif dim.dim_type == "float":
                if dim.step:
                    import numpy as np
                    grid[dim.name] = np.arange(dim.low, dim.high + dim.step / 2, dim.step).tolist()
                else:
                    # Can't grid-search a continuous float without step.
                    raise ValueError(
                        f"GridSampler requires 'step' for float dimension '{dim.name}'."
                    )
        return GridSampler(grid, seed=seed)

    if cls is TPESampler:
        return TPESampler(seed=seed, n_startup_trials=n_startup_trials)
    if cls is CmaEsSampler:
        return CmaEsSampler(seed=seed, n_startup_trials=n_startup_trials)
    # RandomSampler
    return RandomSampler(seed=seed)


def _build_pruner(pruner_type: str | None, n_startup_trials: int) -> BasePruner | None:
    """Instantiate an Optuna pruner (or ``None``)."""
    if pruner_type is None or pruner_type.lower() == "none":
        return None

    key = pruner_type.lower().replace(" ", "").replace("-", "")
    if key not in _PRUNER_MAP:
        raise ValueError(
            f"Unknown pruner_type '{pruner_type}'. "
            f"Choose from: {', '.join(sorted(_PRUNER_MAP))}, none"
        )

    cls = _PRUNER_MAP[key]
    if cls is MedianPruner:
        return MedianPruner(n_startup_trials=n_startup_trials)
    if cls is SuccessiveHalvingPruner:
        return SuccessiveHalvingPruner()
    # HyperbandPruner
    return HyperbandPruner()


# ---------------------------------------------------------------------------
# Suggest helpers
# ---------------------------------------------------------------------------


def _suggest_param(trial: optuna.Trial, dim: SearchDimension) -> Any:
    """Map a ``SearchDimension`` to the appropriate ``trial.suggest_*`` call."""
    if dim.dim_type == "float":
        kwargs: dict[str, Any] = {"name": dim.name, "low": dim.low, "high": dim.high}
        if dim.step is not None:
            kwargs["step"] = dim.step
        if dim.log_scale:
            kwargs["log"] = True
        return trial.suggest_float(**kwargs)

    if dim.dim_type == "int":
        kwargs = {"name": dim.name, "low": int(dim.low), "high": int(dim.high)}  # type: ignore[arg-type]
        if dim.step is not None:
            kwargs["step"] = int(dim.step)
        if dim.log_scale:
            kwargs["log"] = True
        return trial.suggest_int(**kwargs)

    if dim.dim_type == "categorical":
        return trial.suggest_categorical(dim.name, dim.choices)  # type: ignore[arg-type]

    if dim.dim_type == "bool":
        return trial.suggest_categorical(dim.name, [True, False])

    raise ValueError(f"Unsupported dim_type '{dim.dim_type}' for '{dim.name}'")


# ---------------------------------------------------------------------------
# Optimizer implementation
# ---------------------------------------------------------------------------


@OptimizerRegistry.register("optuna")
class OptunaOptimizer(BaseOptimizer):
    """Optuna-backed hyperparameter optimizer.

    Supports pluggable samplers (TPE, CMA-ES, Random, Grid) and pruners
    (Median, SuccessiveHalving, Hyperband, None).  Parallel trials via
    ``n_jobs`` and optional persistent storage via ``storage``.

    The ``objective_fn`` passed to :meth:`optimize` may return either:

    * A plain ``float`` — the objective value for that trial.
    * A ``dict`` with at least a ``"score"`` key — additional keys are
      stored as trial metrics, and an ``"intermediate_values"`` list
      (if present) is reported to the pruner.

    Args:
        search_space: Parameter search space.
        direction: ``'minimize'`` or ``'maximize'``.
        n_trials: Maximum number of trials.
        n_jobs: Number of parallel workers (``1`` = sequential).
        seed: Random seed for reproducibility.
        timeout: Wall-clock timeout in seconds (``None`` = unlimited).
        callbacks: Lifecycle callbacks (default: ``[SSECallback()]``).
        sampler_type: One of ``'tpe'``, ``'cmaes'``, ``'random'``, ``'grid'``.
        pruner_type: One of ``'median'``, ``'successive_halving'``,
            ``'hyperband'``, ``None`` / ``'none'``.
        study_name: Human-readable study name (auto-generated if omitted).
        n_startup_trials: Trials before the sampler/pruner kicks in.
        storage: Optuna storage URL for persistent studies
            (e.g. ``'sqlite:///study.db'``).  ``None`` = in-memory.
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
        *,
        sampler_type: str = "tpe",
        pruner_type: str | None = "median",
        study_name: str | None = None,
        n_startup_trials: int = 10,
        storage: str | None = None,
    ) -> None:
        super().__init__(
            search_space=search_space,
            direction=direction,
            n_trials=n_trials,
            n_jobs=n_jobs,
            seed=seed,
            timeout=timeout,
            callbacks=callbacks,
        )
        self.sampler_type = sampler_type
        self.pruner_type = pruner_type
        self.study_name = study_name
        self.n_startup_trials = n_startup_trials
        self.storage = storage

        logger.info(
            "OptunaOptimizer configured — sampler=%s  pruner=%s  n_startup=%d  "
            "n_jobs=%d  timeout=%s  storage=%s",
            sampler_type,
            pruner_type,
            n_startup_trials,
            n_jobs,
            timeout,
            storage or "in-memory",
        )

    # -- abstract implementations -------------------------------------------

    @property
    def optimizer_type(self) -> str:  # noqa: D401
        return "optuna"

    def get_config_schema(self) -> dict[str, Any]:
        """JSON Schema for OptunaOptimizer-specific options."""
        return {
            "type": "object",
            "properties": {
                "sampler_type": {
                    "type": "string",
                    "enum": ["tpe", "cmaes", "random", "grid"],
                    "default": "tpe",
                    "description": "Sampling algorithm for the search.",
                },
                "pruner_type": {
                    "type": ["string", "null"],
                    "enum": ["median", "successive_halving", "hyperband", None],
                    "default": "median",
                    "description": "Pruning strategy (null to disable).",
                },
                "n_startup_trials": {
                    "type": "integer",
                    "minimum": 0,
                    "default": 10,
                    "description": "Random trials before sampler/pruner activates.",
                },
                "study_name": {
                    "type": ["string", "null"],
                    "default": None,
                    "description": "Human-readable name for the Optuna study.",
                },
                "storage": {
                    "type": ["string", "null"],
                    "default": None,
                    "description": "Optuna storage URL for persistence.",
                },
                "n_jobs": {
                    "type": "integer",
                    "minimum": 1,
                    "default": 1,
                    "description": "Parallel trial workers.",
                },
                "timeout": {
                    "type": ["number", "null"],
                    "minimum": 0,
                    "default": None,
                    "description": "Wall-clock timeout in seconds.",
                },
            },
            "additionalProperties": False,
        }

    def _optimize(
        self,
        objective_fn: Callable[[dict[str, Any]], float],
    ) -> OptimizationResult:
        """Run Optuna study and return an ``OptimizationResult``."""
        t0 = time.perf_counter()

        sampler = _build_sampler(
            self.sampler_type, self.seed, self.n_startup_trials, self.search_space,
        )
        pruner = _build_pruner(self.pruner_type, self.n_startup_trials)

        study = optuna.create_study(
            study_name=self.study_name,
            direction=self.direction,
            sampler=sampler,
            pruner=pruner if pruner is not None else optuna.pruners.NopPruner(),
            storage=self.storage,
        )

        logger.info(
            "Optuna study '%s' created — sampler=%s  pruner=%s",
            study.study_name,
            type(sampler).__name__,
            type(pruner).__name__ if pruner else "NopPruner",
        )
        emit_log(
            f"Optuna study '{study.study_name}': "
            f"sampler={type(sampler).__name__}, "
            f"pruner={type(pruner).__name__ if pruner else 'None'}, "
            f"n_trials={self.n_trials}, n_jobs={self.n_jobs}"
        )

        # Collected results (thread-safe list for parallel trials)
        trial_results: list[TrialResult] = []
        results_lock = threading.Lock()

        def _objective(trial: optuna.Trial) -> float:
            trial_t0 = time.perf_counter()
            trial_id = trial.number

            # Sample parameters from the search space
            params: dict[str, Any] = {}
            for dim in self.search_space:
                params[dim.name] = _suggest_param(trial, dim)

            logger.info(
                "Trial %d started — params=%s", trial_id, params,
            )
            self._notify_trial_start(trial_id, params)

            score: float
            metrics: dict[str, float] = {}
            pruned = False
            error: str | None = None

            try:
                raw = objective_fn(params)

                # Support dict return with intermediate values for pruning
                if isinstance(raw, dict):
                    score = float(raw["score"])
                    metrics = {
                        k: float(v)
                        for k, v in raw.items()
                        if k not in {"score", "intermediate_values"}
                    }
                    # Report intermediate values so the pruner can act
                    for step, value in enumerate(raw.get("intermediate_values", [])):
                        trial.report(float(value), step)
                        if trial.should_prune():
                            logger.info(
                                "Trial %d pruned at step %d (value=%.6f)",
                                trial_id, step, float(value),
                            )
                            pruned = True
                            raise optuna.TrialPruned()
                else:
                    score = float(raw)

            except optuna.TrialPruned:
                pruned = True
                # Use last reported value or NaN
                score = trial.intermediate_values.get(
                    max(trial.intermediate_values) if trial.intermediate_values else 0,
                    float("nan"),
                )
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
                score = float("inf") if self.direction == "minimize" else float("-inf")
                logger.warning("Trial %d failed — %s", trial_id, error)

            duration = time.perf_counter() - trial_t0

            result = TrialResult(
                trial_id=trial_id,
                params=params,
                score=score,
                metrics=metrics,
                duration_sec=round(duration, 4),
                pruned=pruned,
                error=error,
            )
            with results_lock:
                trial_results.append(result)

            status = "pruned" if pruned else ("error" if error else "ok")
            logger.info(
                "Trial %d finished [%s] in %.2fs — score=%.6f",
                trial_id, status, duration, score,
            )
            self._notify_trial_end(result)

            if pruned:
                raise optuna.TrialPruned()

            return score

        # Run the study
        study.optimize(
            _objective,
            n_trials=self.n_trials,
            n_jobs=self.n_jobs,
            timeout=self.timeout,
            show_progress_bar=False,
        )

        elapsed = time.perf_counter() - t0

        # Sort trial results by trial_id for deterministic ordering
        trial_results.sort(key=lambda r: r.trial_id)

        completed = [t for t in trial_results if not t.pruned and t.error is None]
        pruned_trials = [t for t in trial_results if t.pruned]

        # Determine best trial
        if completed:
            if self.direction == "minimize":
                best_trial = min(completed, key=lambda t: t.score)
            else:
                best_trial = max(completed, key=lambda t: t.score)
        elif trial_results:
            # Fallback: best from whatever we have (including pruned)
            if self.direction == "minimize":
                best_trial = min(trial_results, key=lambda t: t.score)
            else:
                best_trial = max(trial_results, key=lambda t: t.score)
        else:
            # No trials at all (shouldn't happen but be safe)
            best_trial = TrialResult(
                trial_id=-1, params={}, score=float("nan"),
            )

        result = OptimizationResult(
            best_trial=best_trial,
            all_trials=trial_results,
            best_params=best_trial.params,
            best_score=best_trial.score,
            total_trials=len(trial_results),
            completed_trials=len(completed),
            pruned_trials=len(pruned_trials),
            elapsed_sec=round(elapsed, 3),
            optimizer_type=self.optimizer_type,
            search_space=self.search_space,
        )

        logger.info(
            "Optuna study complete — %d trials (%d completed, %d pruned) "
            "in %.1fs.  Best score: %.6f",
            len(trial_results),
            len(completed),
            len(pruned_trials),
            elapsed,
            best_trial.score,
        )
        emit_log(
            f"Optuna study complete: best_score={best_trial.score:.6f}, "
            f"trials={len(trial_results)}, pruned={len(pruned_trials)}, "
            f"elapsed={elapsed:.1f}s"
        )

        return result
