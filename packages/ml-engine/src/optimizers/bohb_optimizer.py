"""BOHB (Bayesian Optimization + HyperBand) optimizer.

Combines TPE-based Bayesian sampling with Hyperband's aggressive early
stopping.  Implemented as a specialised Optuna configuration using
``TPESampler`` + ``HyperbandPruner`` — no HpBandSter dependency required.

The objective function receives an extra ``budget`` key indicating how many
epochs/iterations the trial should run.  Low-budget trials are evaluated
first; only promising candidates are promoted to higher budgets.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Any, Callable

import optuna

from ..shared.optimizer import (
    BaseOptimizer,
    OptimizationResult,
    OptimizerCallback,
    OptimizerRegistry,
    SearchDimension,
    SearchSpace,
    TrialResult,
)
from ..shared.protocol import emit, emit_log

logger = logging.getLogger(__name__)

# Suppress Optuna's own logs so our verbose output isn't drowned out.
optuna.logging.set_verbosity(optuna.logging.WARNING)


@OptimizerRegistry.register("bohb")
class BOHBOptimizer(BaseOptimizer):
    """BOHB optimizer backed by Optuna's TPESampler + HyperbandPruner.

    Args:
        search_space: Hyperparameter search space to explore.
        direction: ``'minimize'`` or ``'maximize'``.
        n_trials: Maximum number of trials.
        n_jobs: Parallel workers (passed to ``study.optimize``).
        seed: Random seed for reproducibility.
        timeout: Optional wall-clock timeout in seconds.
        callbacks: Lifecycle callbacks.
        min_resource: Minimum budget (epochs) assigned to a trial.
        max_resource: Maximum budget (epochs) for a fully-promoted trial.
        reduction_factor: Hyperband reduction factor (η).  Each successive
            rung keeps only ``1/η`` of the trials from the previous rung.
        n_brackets: Number of Hyperband brackets.  When ``None`` the value
            is derived automatically from *min_resource* / *max_resource*.
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
        min_resource: int = 1,
        max_resource: int = 100,
        reduction_factor: int = 3,
        n_brackets: int | None = None,
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
        self.min_resource = min_resource
        self.max_resource = max_resource
        self.reduction_factor = reduction_factor

        # Auto-derive bracket count: floor(log_η(max/min)) + 1
        if n_brackets is None:
            self.n_brackets = (
                int(math.log(max_resource / max(min_resource, 1), reduction_factor)) + 1
            )
        else:
            self.n_brackets = n_brackets

        logger.info(
            "BOHB config — min_resource=%d, max_resource=%d, η=%d, brackets=%d",
            self.min_resource,
            self.max_resource,
            self.reduction_factor,
            self.n_brackets,
        )

    # -- BaseOptimizer interface ---------------------------------------------

    @property
    def optimizer_type(self) -> str:  # noqa: D401
        return "bohb"

    def get_config_schema(self) -> dict[str, Any]:
        """Return JSON-schema for BOHB-specific options."""
        return {
            "type": "object",
            "properties": {
                "min_resource": {
                    "type": "integer",
                    "default": 1,
                    "description": "Minimum budget (epochs) per trial.",
                },
                "max_resource": {
                    "type": "integer",
                    "default": 100,
                    "description": "Maximum budget (epochs) for a fully-promoted trial.",
                },
                "reduction_factor": {
                    "type": "integer",
                    "default": 3,
                    "description": "Hyperband reduction factor (eta).",
                },
                "n_brackets": {
                    "type": ["integer", "null"],
                    "default": None,
                    "description": (
                        "Number of Hyperband brackets. "
                        "Auto-derived from min/max resource when null."
                    ),
                },
            },
            "additionalProperties": False,
        }

    # -- core optimisation ---------------------------------------------------

    def _optimize(
        self,
        objective_fn: Callable[[dict[str, Any]], float],
    ) -> OptimizationResult:
        """Run BOHB via Optuna study with TPESampler + HyperbandPruner."""

        sampler = optuna.samplers.TPESampler(
            seed=self.seed,
            n_startup_trials=max(5, self.n_trials // 10),
        )
        pruner = optuna.pruners.HyperbandPruner(
            min_resource=self.min_resource,
            max_resource=self.max_resource,
            reduction_factor=self.reduction_factor,
        )
        study = optuna.create_study(
            direction=self.direction,
            sampler=sampler,
            pruner=pruner,
        )

        emit_log(
            f"BOHB study created — TPESampler + HyperbandPruner "
            f"(budget {self.min_resource}→{self.max_resource}, "
            f"η={self.reduction_factor}, brackets={self.n_brackets})",
        )

        # Wrap the user's objective so it interacts with Optuna trials.
        # We inject a reporting wrapper so we can track the last step
        # without relying on private Trial internals.
        def _objective(trial: optuna.Trial) -> float:
            params = self._suggest_params(trial)
            budget = self.max_resource  # full budget; pruner truncates early

            # Track the last step reported inside this closure.
            last_reported_step: list[int] = [0]
            _orig_report = trial.report

            def _tracking_report(value: float, step: int) -> None:
                last_reported_step[0] = step
                _orig_report(value, step)

            trial.report = _tracking_report  # type: ignore[assignment]

            self._notify_trial_start(trial.number, {**params, "budget": budget})
            emit_log(
                f"Trial {trial.number} started — budget={budget}, params={params}",
            )

            t0 = time.perf_counter()
            try:
                score = objective_fn({**params, "budget": budget})
            except optuna.TrialPruned:
                duration = time.perf_counter() - t0
                step = last_reported_step[0]
                emit_log(
                    f"Trial {trial.number} PRUNED at step {step} "
                    f"(budget used ≈{step}/{budget}) [{duration:.1f}s]",
                    level="warning",
                )
                emit(
                    {
                        "type": "hpo-trial-pruned",
                        "trialId": trial.number,
                        "prunedAtStep": step,
                        "maxBudget": budget,
                        "params": params,
                    }
                )
                raise  # let Optuna handle the pruned state

            duration = time.perf_counter() - t0
            emit_log(
                f"Trial {trial.number} done — score={score:.6f}, budget={budget} [{duration:.1f}s]",
            )
            return score

        # ---- run study -----------------------------------------------------
        study.optimize(
            _objective,
            n_trials=self.n_trials,
            n_jobs=self.n_jobs,
            timeout=self.timeout,
            show_progress_bar=False,
        )

        # ---- collect results -----------------------------------------------
        return self._collect_results(study)

    # -- parameter suggestion ------------------------------------------------

    def _suggest_params(self, trial: optuna.Trial) -> dict[str, Any]:
        """Map each ``SearchDimension`` to an Optuna ``trial.suggest_*`` call."""
        params: dict[str, Any] = {}
        for dim in self.search_space:
            params[dim.name] = self._suggest_single(trial, dim)
        return params

    @staticmethod
    def _suggest_single(trial: optuna.Trial, dim: SearchDimension) -> Any:
        """Suggest a single hyperparameter value from *dim*."""
        if dim.dim_type == "float":
            kwargs: dict[str, Any] = {
                "name": dim.name,
                "low": dim.low,
                "high": dim.high,
                "log": dim.log_scale,
            }
            if dim.step is not None:
                kwargs["step"] = dim.step
            return trial.suggest_float(**kwargs)

        if dim.dim_type == "int":
            kwargs = {
                "name": dim.name,
                "low": int(dim.low),  # type: ignore[arg-type]
                "high": int(dim.high),  # type: ignore[arg-type]
                "log": dim.log_scale,
            }
            if dim.step is not None:
                kwargs["step"] = int(dim.step)
            return trial.suggest_int(**kwargs)

        if dim.dim_type == "categorical":
            return trial.suggest_categorical(dim.name, dim.choices)  # type: ignore[arg-type]

        if dim.dim_type == "bool":
            return trial.suggest_categorical(dim.name, [True, False])

        raise ValueError(f"Unsupported dimension type: {dim.dim_type!r}")

    # -- result collection ---------------------------------------------------

    def _collect_results(self, study: optuna.Study) -> OptimizationResult:
        """Convert finished Optuna study into an ``OptimizationResult``."""
        all_trials: list[TrialResult] = []

        for t in study.trials:
            pruned = t.state == optuna.trial.TrialState.PRUNED
            failed = t.state == optuna.trial.TrialState.FAIL
            score = t.value if t.value is not None else float("inf")

            metrics: dict[str, float] = {}
            if pruned:
                pruned_step = t.last_step if t.last_step is not None else 0
                metrics["pruned_at_step"] = float(pruned_step)
                metrics["max_budget"] = float(self.max_resource)
                metrics["budget_used_pct"] = (
                    pruned_step / self.max_resource * 100.0 if self.max_resource > 0 else 0.0
                )

            # Include any intermediate values the objective reported.
            if t.intermediate_values:
                metrics["intermediate_steps"] = float(len(t.intermediate_values))

            result = TrialResult(
                trial_id=t.number,
                params=t.params,
                score=score,
                metrics=metrics,
                duration_sec=t.duration.total_seconds() if t.duration else 0.0,
                pruned=pruned,
                error=t.system_attrs.get("fail_reason", "Unknown error") if failed else None,
            )
            all_trials.append(result)
            self._notify_trial_end(result)

        completed = [t for t in all_trials if not t.pruned and t.error is None]
        pruned_trials = [t for t in all_trials if t.pruned]

        if completed:
            if self.direction == "minimize":
                best = min(completed, key=lambda t: t.score)
            else:
                best = max(completed, key=lambda t: t.score)
        elif all_trials:
            # All pruned / failed — pick the least-bad one.
            best = min(all_trials, key=lambda t: t.score)
        else:
            best = TrialResult(trial_id=-1, params={}, score=float("inf"))

        emit_log(
            f"BOHB complete — {len(completed)} completed, "
            f"{len(pruned_trials)} pruned, best={best.score:.6f}",
        )

        return OptimizationResult(
            best_trial=best,
            all_trials=all_trials,
            best_params=best.params,
            best_score=best.score,
            total_trials=len(all_trials),
            completed_trials=len(completed),
            pruned_trials=len(pruned_trials),
            elapsed_sec=0.0,  # filled by BaseOptimizer.optimize()
            optimizer_type=self.optimizer_type,
            search_space=self.search_space,
        )
