"""Evolutionary / Genetic optimizer backed by nevergrad.

Maps the shared ``SearchSpace`` to nevergrad's parametrization and exposes
multiple evolutionary algorithms (CMA-ES, Differential Evolution, PSO, …)
through a single ``@OptimizerRegistry.register("evolutionary")`` entry.

All trial-level control uses nevergrad's **ask / tell** interface so we can
emit SSE events, track timing, and handle maximization transparently.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Any, Callable

import nevergrad as ng

from ..shared.optimizer import (
    BaseOptimizer,
    OptimizationResult,
    OptimizerRegistry,
    SearchDimension,
    SearchSpace,
    TrialResult,
)
from ..shared.protocol import emit_log

logger = logging.getLogger(__name__)

# Algorithms exposed to callers — maps friendly name → nevergrad class name.
_ALGORITHM_MAP: dict[str, str] = {
    "CMA": "CMA",
    "TwoPointsDE": "TwoPointsDE",
    "OnePlusOne": "OnePlusOne",
    "PSO": "PSO",
    "DE": "DE",
    "NGOpt": "NGOpt",
}


def _dim_to_ng_param(dim: SearchDimension, mutation_rate: float | None) -> ng.p.Parameter:
    """Convert a single ``SearchDimension`` into a nevergrad ``Parameter``.

    Args:
        dim: Search dimension specification.
        mutation_rate: Optional mutation sigma override (used for CMA / scalar
            dimensions).

    Returns:
        A nevergrad ``Parameter`` ready to be placed into an
        ``ng.p.Instrumentation``.
    """
    if dim.dim_type == "bool":
        return ng.p.Choice([True, False])

    if dim.dim_type == "categorical":
        assert dim.choices is not None, f"Categorical dim '{dim.name}' has no choices"
        return ng.p.Choice(dim.choices)

    assert dim.low is not None and dim.high is not None, (
        f"Numeric dim '{dim.name}' requires low/high bounds"
    )

    if dim.dim_type == "int":
        if dim.log_scale:
            param = ng.p.Log(lower=dim.low, upper=dim.high, exponent=2.0)
            param.set_integer_casting()
        else:
            param = ng.p.Scalar(lower=dim.low, upper=dim.high)
            param.set_integer_casting()
        return param

    if dim.dim_type == "float":
        if dim.log_scale:
            param = ng.p.Log(lower=dim.low, upper=dim.high, exponent=2.0)
        else:
            param = ng.p.Scalar(lower=dim.low, upper=dim.high)
            if mutation_rate is not None:
                sigma = mutation_rate * (dim.high - dim.low)
                param.set_mutation(sigma=sigma)
        return param

    raise ValueError(f"Unsupported dim_type '{dim.dim_type}' for dim '{dim.name}'")


def _build_parametrization(
    search_space: SearchSpace,
    mutation_rate: float | None,
) -> ng.p.Instrumentation:
    """Convert the full ``SearchSpace`` to an ``ng.p.Instrumentation``."""
    params: dict[str, ng.p.Parameter] = {}
    for dim in search_space:
        params[dim.name] = _dim_to_ng_param(dim, mutation_rate)
    return ng.p.Instrumentation(**params)


@OptimizerRegistry.register("evolutionary")
class EvolutionaryOptimizer(BaseOptimizer):
    """Evolutionary / genetic optimizer using `nevergrad`_ as backend.

    Supports CMA-ES, Differential Evolution, PSO, and more via the
    ``algorithm`` parameter.  Uses nevergrad's **ask / tell** interface for
    fine-grained trial control.

    Extra constructor parameters (beyond ``BaseOptimizer``):
        algorithm: Nevergrad algorithm name (default ``'CMA'``).
        population_size: Population size; ``None`` lets nevergrad decide.
        num_workers: Number of candidates asked in parallel (ask/tell).
        mutation_rate: Fractional sigma applied to continuous scalar dims.

    .. _nevergrad: https://facebookresearch.github.io/nevergrad/
    """

    def __init__(
        self,
        search_space: SearchSpace,
        *,
        direction: str = "minimize",
        n_trials: int = 100,
        n_jobs: int = 1,
        seed: int = 42,
        timeout: float | None = None,
        callbacks: list | None = None,
        algorithm: str = "CMA",
        population_size: int | None = None,
        num_workers: int = 1,
        mutation_rate: float | None = None,
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

        if algorithm not in _ALGORITHM_MAP:
            raise ValueError(
                f"Unknown algorithm '{algorithm}'. "
                f"Choose from: {', '.join(sorted(_ALGORITHM_MAP))}"
            )

        self.algorithm = algorithm
        self.population_size = population_size
        self.num_workers = max(1, num_workers)
        self.mutation_rate = mutation_rate

    # -- BaseOptimizer abstract interface ------------------------------------

    @property
    def optimizer_type(self) -> str:  # noqa: D401
        return "evolutionary"

    def get_config_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "algorithm": {
                    "type": "string",
                    "enum": sorted(_ALGORITHM_MAP),
                    "default": "CMA",
                    "description": "Nevergrad evolutionary algorithm to use.",
                },
                "population_size": {
                    "type": ["integer", "null"],
                    "minimum": 2,
                    "default": None,
                    "description": (
                        "Population size.  None lets nevergrad choose a "
                        "sensible default for the selected algorithm."
                    ),
                },
                "num_workers": {
                    "type": "integer",
                    "minimum": 1,
                    "default": 1,
                    "description": (
                        "Number of candidates to ask in parallel per "
                        "generation (ask/tell parallelism)."
                    ),
                },
                "mutation_rate": {
                    "type": ["number", "null"],
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "default": None,
                    "description": (
                        "Fractional mutation sigma for continuous dims. "
                        "Applied as sigma = mutation_rate × (high − low)."
                    ),
                },
            },
            "additionalProperties": False,
        }

    # -- core optimisation loop ----------------------------------------------

    def _optimize(
        self, objective_fn: Callable[[dict[str, Any]], float]
    ) -> OptimizationResult:
        parametrization = _build_parametrization(self.search_space, self.mutation_rate)

        ng_algo_name = _ALGORITHM_MAP[self.algorithm]
        budget = self.n_trials

        opt_kwargs: dict[str, Any] = {
            "parametrization": parametrization,
            "budget": budget,
            "num_workers": self.num_workers,
        }

        ng_opt = ng.optimizers.registry[ng_algo_name](**opt_kwargs)

        # Seed for reproducibility
        ng_opt.parametrization.random_state.seed(self.seed)

        # Apply population_size if supported and requested
        if self.population_size is not None:
            if hasattr(ng_opt, "llambda"):
                ng_opt.llambda = self.population_size
            else:
                logger.warning(
                    "Algorithm '%s' does not expose a population_size "
                    "(llambda) attribute — ignoring population_size=%d",
                    self.algorithm,
                    self.population_size,
                )

        maximizing = self.direction == "maximize"
        emit_log(
            f"Evolutionary optimizer: algorithm={self.algorithm}, "
            f"budget={budget}, num_workers={self.num_workers}, "
            f"population_size={self.population_size}, "
            f"mutation_rate={self.mutation_rate}, "
            f"direction={self.direction}"
        )
        logger.info(
            "nevergrad optimizer created: algo=%s, budget=%d, "
            "workers=%d, pop_size=%s, mutation_rate=%s",
            self.algorithm,
            budget,
            self.num_workers,
            self.population_size,
            self.mutation_rate,
        )

        all_trials: list[TrialResult] = []
        t_start = time.perf_counter()

        for trial_idx in range(budget):
            # Check wall-clock timeout
            if self.timeout is not None:
                elapsed = time.perf_counter() - t_start
                if elapsed >= self.timeout:
                    logger.info(
                        "Timeout reached (%.1fs >= %.1fs) after %d trials",
                        elapsed,
                        self.timeout,
                        trial_idx,
                    )
                    emit_log(
                        f"Timeout reached after {trial_idx} trials "
                        f"({elapsed:.1f}s)"
                    )
                    break

            candidate = ng_opt.ask()
            params = self._candidate_to_params(candidate)

            self._notify_trial_start(trial_idx, params)
            t_trial = time.perf_counter()

            try:
                score = objective_fn(params)
                loss = -score if maximizing else score
                ng_opt.tell(candidate, loss)

                duration = time.perf_counter() - t_trial
                trial_result = TrialResult(
                    trial_id=trial_idx,
                    params=params,
                    score=score,
                    duration_sec=duration,
                )

                logger.info(
                    "Trial %d/%d — score=%.6f  (loss=%.6f)  %.2fs  params=%s",
                    trial_idx + 1,
                    budget,
                    score,
                    loss,
                    duration,
                    params,
                )
            except Exception as exc:
                duration = time.perf_counter() - t_trial
                # Tell nevergrad the candidate was terrible so it avoids
                # that region.
                ng_opt.tell(candidate, float("inf"))

                trial_result = TrialResult(
                    trial_id=trial_idx,
                    params=params,
                    score=math.inf if not maximizing else -math.inf,
                    duration_sec=duration,
                    error=str(exc),
                )
                logger.warning(
                    "Trial %d/%d FAILED (%.2fs): %s",
                    trial_idx + 1,
                    budget,
                    duration,
                    exc,
                )

            all_trials.append(trial_result)
            self._notify_trial_end(trial_result)

        # -- assemble result -------------------------------------------------
        completed = [t for t in all_trials if t.error is None]
        if not completed:
            raise RuntimeError(
                "All trials failed — cannot determine a best result."
            )

        if maximizing:
            best = max(completed, key=lambda t: t.score)
        else:
            best = min(completed, key=lambda t: t.score)

        total_elapsed = time.perf_counter() - t_start

        logger.info(
            "Evolutionary search complete: %d/%d trials succeeded, "
            "best_score=%.6f in %.1fs",
            len(completed),
            len(all_trials),
            best.score,
            total_elapsed,
        )

        return OptimizationResult(
            best_trial=best,
            all_trials=all_trials,
            best_params=best.params,
            best_score=best.score,
            total_trials=len(all_trials),
            completed_trials=len(completed),
            pruned_trials=0,
            elapsed_sec=total_elapsed,
            optimizer_type=self.optimizer_type,
            search_space=self.search_space,
        )

    # -- helpers -------------------------------------------------------------

    @staticmethod
    def _candidate_to_params(candidate: ng.p.Parameter) -> dict[str, Any]:
        """Extract a flat param dict from a nevergrad candidate."""
        _, kwargs = candidate.args, candidate.kwargs
        return dict(kwargs)
