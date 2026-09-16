"""Bayesian hyperparameter optimizer backed by scikit-optimize.

Supports three surrogate models (Gaussian Process, Random Forest,
Gradient-Boosted Trees) and four acquisition functions.  Registered
as ``"bayesian"`` in the ``OptimizerRegistry``.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable

from skopt import forest_minimize, gbrt_minimize, gp_minimize
from skopt.space import Categorical, Integer, Real
from skopt.utils import use_named_args

# Workaround for scikit-optimize ≤0.10 + scikit-learn ≥1.6 incompatibility:
# GradientBoostingQuantileRegressor is not recognised as a regressor by
# sklearn.base.is_regressor because it lacks __sklearn_tags__.
try:
    from sklearn.base import BaseEstimator as _BaseEstimator
    from sklearn.base import is_regressor as _is_reg
    from skopt.learning.gbrt import GradientBoostingQuantileRegressor as _GBQR

    if not _is_reg(_GBQR()):

        def _sklearn_tags(self):
            tags = _BaseEstimator.__sklearn_tags__(self)
            tags.estimator_type = "regressor"
            return tags

        if _BaseEstimator not in _GBQR.__mro__:
            _GBQR.__bases__ = (_BaseEstimator,) + _GBQR.__bases__
        _GBQR.__sklearn_tags__ = _sklearn_tags
except Exception:  # pragma: no cover – best-effort compatibility shim
    pass

from ..shared.optimizer import (
    BaseOptimizer,
    OptimizationResult,
    OptimizerRegistry,
    SearchDimension,
    SearchSpace,
    TrialResult,
)

logger = logging.getLogger(__name__)

_SURROGATE_FUNCS = {
    "gp": gp_minimize,
    "rf": forest_minimize,
    "gbrt": gbrt_minimize,
}

_VALID_ACQ_FUNCS = {"EI", "LCB", "PI", "gp_hedge"}


def _dimension_to_skopt(dim: SearchDimension):
    """Map a ``SearchDimension`` to the corresponding skopt space."""
    if dim.dim_type == "float":
        prior = "log-uniform" if dim.log_scale else "uniform"
        return Real(dim.low, dim.high, prior=prior, name=dim.name)

    if dim.dim_type == "int":
        prior = "log-uniform" if dim.log_scale else "uniform"
        return Integer(dim.low, dim.high, prior=prior, name=dim.name)

    if dim.dim_type == "categorical":
        return Categorical(dim.choices, name=dim.name)

    if dim.dim_type == "bool":
        return Categorical([True, False], name=dim.name)

    raise ValueError(f"Unsupported dimension type '{dim.dim_type}' for '{dim.name}'")


@OptimizerRegistry.register("bayesian")
class BayesianOptimizer(BaseOptimizer):
    """Bayesian optimiser using ``scikit-optimize`` surrogates.

    Parameters
    ----------
    search_space:
        Hyperparameter search space.
    direction:
        ``'minimize'`` or ``'maximize'``.
    n_trials:
        Number of evaluations.
    method:
        Surrogate model — ``'gp'`` (Gaussian Process, default),
        ``'rf'`` (Random Forest), or ``'gbrt'`` (Gradient-Boosted Trees).
    acq_func:
        Acquisition function — ``'EI'`` (default), ``'LCB'``, ``'PI'``,
        or ``'gp_hedge'``.
    n_initial_points:
        Number of random evaluations before the surrogate kicks in.
    xi:
        Exploration–exploitation trade-off for EI / PI.
    acq_func_kwargs:
        Extra keyword arguments forwarded to the acquisition function.
    seed:
        Random seed for reproducibility.
    n_jobs:
        Parallel workers (passed to skopt).
    timeout:
        Optional wall-clock timeout in seconds.
    callbacks:
        Lifecycle callbacks.
    """

    def __init__(
        self,
        search_space: SearchSpace,
        *,
        direction: str = "minimize",
        n_trials: int = 100,
        method: str = "gp",
        acq_func: str = "EI",
        n_initial_points: int = 10,
        xi: float = 0.01,
        acq_func_kwargs: dict[str, Any] | None = None,
        seed: int = 42,
        n_jobs: int = 1,
        timeout: float | None = None,
        callbacks=None,
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

        if method not in _SURROGATE_FUNCS:
            raise ValueError(
                f"Unknown surrogate method '{method}'. Choose from {sorted(_SURROGATE_FUNCS)}."
            )
        if acq_func not in _VALID_ACQ_FUNCS:
            raise ValueError(
                f"Unknown acquisition function '{acq_func}'. "
                f"Choose from {sorted(_VALID_ACQ_FUNCS)}."
            )

        self.method = method
        self.acq_func = acq_func
        self.n_initial_points = n_initial_points
        self.xi = xi
        self.acq_func_kwargs = acq_func_kwargs or {}

    # -- BaseOptimizer interface ---------------------------------------------

    @property
    def optimizer_type(self) -> str:
        return "bayesian"

    def get_config_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "method": {
                    "type": "string",
                    "enum": ["gp", "rf", "gbrt"],
                    "default": "gp",
                    "description": "Surrogate model type.",
                },
                "acq_func": {
                    "type": "string",
                    "enum": sorted(_VALID_ACQ_FUNCS),
                    "default": "EI",
                    "description": "Acquisition function.",
                },
                "n_initial_points": {
                    "type": "integer",
                    "minimum": 1,
                    "default": 10,
                    "description": "Random evaluations before surrogate modelling.",
                },
                "xi": {
                    "type": "number",
                    "default": 0.01,
                    "description": "Exploration–exploitation trade-off (EI/PI).",
                },
                "acq_func_kwargs": {
                    "type": "object",
                    "default": {},
                    "description": "Extra acquisition function keyword arguments.",
                },
            },
            "additionalProperties": False,
        }

    # -- core optimisation ---------------------------------------------------

    def _optimize(
        self,
        objective_fn: Callable[[dict[str, Any]], float],
    ) -> OptimizationResult:
        # Build skopt dimension list (preserving insertion order)
        dim_names = list(self.search_space.dimensions.keys())
        skopt_dims = [_dimension_to_skopt(self.search_space.dimensions[n]) for n in dim_names]

        sign = -1.0 if self.direction == "maximize" else 1.0
        trials: list[TrialResult] = []
        trial_counter = 0

        @use_named_args(skopt_dims)
        def _objective(**kwargs):
            nonlocal trial_counter
            tid = trial_counter
            trial_counter += 1

            # Cast types back (skopt may return numpy scalars)
            params = self._cast_params(kwargs, dim_names)

            logger.info(
                "[Trial %d/%d] params=%s",
                tid + 1,
                self.n_trials,
                params,
            )
            self._notify_trial_start(tid, params)

            t0 = time.perf_counter()
            error: str | None = None
            score = float("nan")
            try:
                score = float(objective_fn(params))
            except Exception as exc:
                error = str(exc)
                logger.exception("Trial %d failed: %s", tid, exc)

            duration = time.perf_counter() - t0

            result = TrialResult(
                trial_id=tid,
                params=params,
                score=score if error is None else float("inf") * sign,
                duration_sec=duration,
                error=error,
            )
            trials.append(result)

            logger.info(
                "[Trial %d/%d] score=%.6f  (%.2fs)",
                tid + 1,
                self.n_trials,
                result.score,
                duration,
            )
            self._notify_trial_end(result)

            # skopt always minimises — flip sign for maximisation
            return sign * result.score

        minimize_fn = _SURROGATE_FUNCS[self.method]
        logger.info(
            "Bayesian optimisation: method=%s  acq=%s  n_initial=%d  xi=%.4f",
            self.method,
            self.acq_func,
            self.n_initial_points,
            self.xi,
        )

        # skopt takes xi/kappa as top-level kwargs (only meaningful for GP surrogates)
        extra_kw: dict[str, Any] = {}
        if self.method == "gp":
            extra_kw.update(self.acq_func_kwargs)
            if self.acq_func in {"EI", "PI"}:
                extra_kw.setdefault("xi", self.xi)

        minimize_fn(
            _objective,
            dimensions=skopt_dims,
            n_calls=self.n_trials,
            n_initial_points=self.n_initial_points,
            acq_func=self.acq_func,
            n_jobs=self.n_jobs,
            random_state=self.seed,
            **extra_kw,
        )

        return self._build_result(trials)

    # -- helpers -------------------------------------------------------------

    def _cast_params(
        self,
        raw: dict[str, Any],
        dim_names: list[str],
    ) -> dict[str, Any]:
        """Cast numpy scalars back to native Python types."""
        params: dict[str, Any] = {}
        for name in dim_names:
            val = raw[name]
            dim = self.search_space.dimensions[name]
            if dim.dim_type == "int":
                val = int(val)
            elif dim.dim_type == "float":
                val = float(val)
            elif dim.dim_type == "bool":
                val = bool(val)
            params[name] = val
        return params

    def _build_result(self, trials: list[TrialResult]) -> OptimizationResult:
        """Assemble an ``OptimizationResult`` from the collected trials."""
        completed = [t for t in trials if t.error is None and not t.pruned]

        if not completed:
            best = (
                trials[0]
                if trials
                else TrialResult(
                    trial_id=-1,
                    params={},
                    score=float("inf"),
                )
            )
        else:
            if self.direction == "minimize":
                best = min(completed, key=lambda t: t.score)
            else:
                best = max(completed, key=lambda t: t.score)

        return OptimizationResult(
            best_trial=best,
            all_trials=trials,
            best_params=best.params,
            best_score=best.score,
            total_trials=self.n_trials,
            completed_trials=len(completed),
            pruned_trials=sum(1 for t in trials if t.pruned),
            elapsed_sec=0.0,  # filled in by BaseOptimizer.optimize()
            optimizer_type=self.optimizer_type,
            search_space=self.search_space,
        )
