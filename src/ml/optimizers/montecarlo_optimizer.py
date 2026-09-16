"""Monte Carlo / Random Search optimizer.

Samples hyperparameter configurations using configurable strategies
(pure random, Latin Hypercube, Sobol, Halton) and evaluates them
against an objective function.  No surrogate model or population
dynamics — just sample → evaluate → track best.

Registered as ``"montecarlo"`` in the :class:`OptimizerRegistry`.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Any, Callable

import numpy as np

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

__all__ = ["MonteCarloOptimizer"]

# Valid sampling strategies
_METHODS = {"random", "lhs", "sobol", "halton"}


# ---------------------------------------------------------------------------
# Sampling helpers
# ---------------------------------------------------------------------------


def _generate_unit_samples(
    n_samples: int,
    n_dims: int,
    method: str,
    rng: np.random.Generator,
) -> np.ndarray:
    """Return an (n_samples, n_dims) array of values in [0, 1).

    Parameters
    ----------
    n_samples : int
        Number of sample points to generate.
    n_dims : int
        Dimensionality of each sample.
    method : str
        One of ``'random'``, ``'lhs'``, ``'sobol'``, ``'halton'``.
    rng : numpy.random.Generator
        Seeded RNG for reproducibility.

    Returns
    -------
    np.ndarray
        Shape ``(n_samples, n_dims)`` with values in ``[0, 1)``.
    """
    if n_dims == 0:
        return np.empty((n_samples, 0))

    if method == "random":
        return rng.random((n_samples, n_dims))

    if method == "lhs":
        return _latin_hypercube(n_samples, n_dims, rng)

    # scipy quasi-random sequences
    if method in {"sobol", "halton"}:
        return _qmc_samples(n_samples, n_dims, method, rng)

    raise ValueError(f"Unknown sampling method '{method}'")


def _latin_hypercube(
    n_samples: int,
    n_dims: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Latin Hypercube Sampling — try scipy first, fall back to manual."""
    try:
        from scipy.stats.qmc import LatinHypercube

        sampler = LatinHypercube(d=n_dims, seed=rng)
        return sampler.random(n=n_samples)
    except ImportError:
        logger.info("scipy not available — using manual LHS implementation")

    # Manual LHS: divide [0,1) into n_samples equal strata per dimension,
    # sample uniformly within each stratum, then shuffle columns.
    samples = np.empty((n_samples, n_dims))
    for d in range(n_dims):
        strata = np.arange(n_samples, dtype=np.float64)
        strata = (strata + rng.random(n_samples)) / n_samples
        rng.shuffle(strata)
        samples[:, d] = strata
    return samples


def _qmc_samples(
    n_samples: int,
    n_dims: int,
    method: str,
    rng: np.random.Generator,
) -> np.ndarray:
    """Generate quasi-random samples via scipy.stats.qmc."""
    from scipy.stats.qmc import Halton, Sobol

    if method == "sobol":
        # Sobol requires n = 2^m; generate the next power-of-2 ≥ n_samples
        m = max(1, math.ceil(math.log2(n_samples))) if n_samples > 1 else 1
        sampler = Sobol(d=n_dims, seed=rng)
        raw = sampler.random_base2(m)
        return raw[:n_samples]

    # Halton
    sampler = Halton(d=n_dims, seed=rng)
    return sampler.random(n=n_samples)


# ---------------------------------------------------------------------------
# Dimension → concrete value mapping
# ---------------------------------------------------------------------------


def _map_unit_to_value(
    u: float,
    dim: SearchDimension,
    rng: np.random.Generator,
) -> Any:
    """Map a unit-interval value ``u ∈ [0, 1)`` to a concrete parameter.

    Parameters
    ----------
    u : float
        Uniform sample in ``[0, 1)``.
    dim : SearchDimension
        The dimension specification.
    rng : numpy.random.Generator
        RNG used only for the ``'normal'`` distribution (to generate
        a clipped normal from the unit sample via inverse CDF would
        require scipy; instead we resample directly).
    """
    if dim.dim_type == "bool":
        return bool(u >= 0.5)

    if dim.dim_type == "categorical":
        idx = int(u * len(dim.choices))
        idx = min(idx, len(dim.choices) - 1)
        return dim.choices[idx]

    # Numeric: int or float
    low, high = float(dim.low), float(dim.high)
    dist = dim.distribution or "uniform"

    if dim.log_scale or dist == "loguniform":
        if low <= 0:
            raise ValueError(f"Dimension '{dim.name}': log-scale requires low > 0 (got low={low})")
        log_low, log_high = math.log(low), math.log(high)
        value = math.exp(log_low + u * (log_high - log_low))
    elif dist == "normal":
        # Use the RNG directly for a clipped normal so quasi-random
        # sequences still spread coverage across the other dims.
        mu = (low + high) / 2.0
        sigma = (high - low) / 4.0  # ≈ 95 % within [low, high]
        value = float(np.clip(rng.normal(mu, sigma), low, high))
    else:
        # uniform (default)
        value = low + u * (high - low)

    if dim.dim_type == "int":
        if dim.step and dim.step > 1:
            value = int(low + round((value - low) / dim.step) * dim.step)
        else:
            value = int(round(value))
        value = max(int(low), min(int(high), value))

    return value


def _sample_params(
    unit_row: np.ndarray,
    continuous_dims: list[SearchDimension],
    all_dims: list[SearchDimension],
    rng: np.random.Generator,
) -> dict[str, Any]:
    """Build a full parameter dict from a unit-interval sample row.

    Continuous (int/float) dimensions are mapped from the unit row;
    categorical and bool dimensions are sampled independently via *rng*.
    """
    params: dict[str, Any] = {}
    cont_idx = 0
    for dim in all_dims:
        if dim.dim_type in {"int", "float"}:
            u = float(unit_row[cont_idx])
            cont_idx += 1
            params[dim.name] = _map_unit_to_value(u, dim, rng)
        elif dim.dim_type == "bool":
            params[dim.name] = bool(rng.random() >= 0.5)
        elif dim.dim_type == "categorical":
            params[dim.name] = rng.choice(dim.choices)
        else:
            raise ValueError(f"Unsupported dim_type '{dim.dim_type}'")
    return params


# ---------------------------------------------------------------------------
# Optimizer implementation
# ---------------------------------------------------------------------------


@OptimizerRegistry.register("montecarlo")
class MonteCarloOptimizer(BaseOptimizer):
    """Monte Carlo / Random Search optimizer.

    Samples hyperparameter configurations using the selected ``method``
    and evaluates each one against the objective function.  Supports
    pure random sampling, Latin Hypercube, Sobol, and Halton sequences.

    Parameters
    ----------
    search_space : SearchSpace
        Dimensions to search over.
    method : str
        Sampling strategy: ``'random'``, ``'lhs'``, ``'sobol'``,
        or ``'halton'``.  Default ``'random'``.
    direction : str
        ``'minimize'`` or ``'maximize'``.
    n_trials : int
        Number of configurations to evaluate.
    seed : int
        Random seed for reproducibility.
    **kwargs
        Forwarded to :class:`BaseOptimizer`.
    """

    def __init__(
        self,
        search_space: SearchSpace,
        *,
        method: str = "random",
        direction: str = "minimize",
        n_trials: int = 100,
        seed: int = 42,
        **kwargs: Any,
    ) -> None:
        if method not in _METHODS:
            raise ValueError(f"Unknown sampling method '{method}'. Choose from {sorted(_METHODS)}.")
        super().__init__(
            search_space=search_space,
            direction=direction,
            n_trials=n_trials,
            seed=seed,
            **kwargs,
        )
        self.method = method

    # -- BaseOptimizer interface ---------------------------------------------

    @property
    def optimizer_type(self) -> str:  # noqa: D401
        return "montecarlo"

    def get_config_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "method": {
                    "type": "string",
                    "enum": sorted(_METHODS),
                    "default": "random",
                    "description": (
                        "Sampling strategy: 'random' (uniform), "
                        "'lhs' (Latin Hypercube), 'sobol' (Sobol sequence), "
                        "or 'halton' (Halton sequence)."
                    ),
                },
                "n_trials": {
                    "type": "integer",
                    "minimum": 1,
                    "default": 100,
                    "description": "Number of random configurations to evaluate.",
                },
                "seed": {
                    "type": "integer",
                    "default": 42,
                    "description": "Random seed for reproducibility.",
                },
            },
            "additionalProperties": False,
        }

    # -- core loop -----------------------------------------------------------

    def _optimize(
        self,
        objective_fn: Callable[[dict[str, Any]], float],
    ) -> OptimizationResult:
        rng = np.random.default_rng(self.seed)
        all_dims = list(self.search_space)
        continuous_dims = self.search_space.continuous_dims
        n_cont = len(continuous_dims)

        # Pre-generate unit samples for continuous dimensions
        unit_samples = _generate_unit_samples(
            self.n_trials,
            n_cont,
            self.method,
            rng,
        )

        logger.info(
            "MonteCarloOptimizer: method=%s, n_trials=%d, "
            "continuous_dims=%d, categorical/bool_dims=%d, seed=%d",
            self.method,
            self.n_trials,
            n_cont,
            len(all_dims) - n_cont,
            self.seed,
        )
        emit_log(
            f"Monte Carlo search: method={self.method}, "
            f"{self.n_trials} trials, {len(all_dims)} dimensions"
        )

        trials: list[TrialResult] = []
        best_score: float | None = None
        best_trial: TrialResult | None = None
        t_total = time.perf_counter()

        for i in range(self.n_trials):
            # Check wall-clock timeout
            if self.timeout and (time.perf_counter() - t_total) >= self.timeout:
                logger.info(
                    "Timeout reached (%.1fs) after %d/%d trials",
                    self.timeout,
                    i,
                    self.n_trials,
                )
                emit_log(f"Timeout after {i} trials")
                break

            params = _sample_params(unit_samples[i], continuous_dims, all_dims, rng)

            self._notify_trial_start(i, params)
            t0 = time.perf_counter()

            error: str | None = None
            score = float("inf") if self.direction == "minimize" else float("-inf")

            try:
                score = float(objective_fn(params))
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
                logger.warning("Trial %d failed: %s", i, error)

            duration = time.perf_counter() - t0

            trial = TrialResult(
                trial_id=i,
                params=params,
                score=score,
                duration_sec=duration,
                error=error,
            )
            trials.append(trial)
            self._notify_trial_end(trial)

            # Track best
            if error is None:
                is_better = (
                    best_score is None
                    or (self.direction == "minimize" and score < best_score)
                    or (self.direction == "maximize" and score > best_score)
                )
                if is_better:
                    best_score = score
                    best_trial = trial

            # Verbose per-trial logging
            best_str = f"{best_score:.6f}" if best_score is not None else "N/A"
            status = "ERROR" if error else "OK"
            logger.info(
                "Trial %d/%d [%s] score=%.6f best=%s (%.3fs) params=%s",
                i + 1,
                self.n_trials,
                status,
                score,
                best_str,
                duration,
                params,
            )

        elapsed = time.perf_counter() - t_total

        # Fallback if all trials errored
        if best_trial is None:
            best_trial = (
                trials[0]
                if trials
                else TrialResult(
                    trial_id=-1,
                    params={},
                    score=float("nan"),
                )
            )
            best_score = best_trial.score

        completed = [t for t in trials if t.error is None]
        emit_log(
            f"Monte Carlo complete: {len(completed)}/{len(trials)} trials OK, "
            f"best={best_score:.6f} in {elapsed:.1f}s"
        )

        return OptimizationResult(
            best_trial=best_trial,
            all_trials=trials,
            best_params=best_trial.params,
            best_score=best_score,
            total_trials=self.n_trials,
            completed_trials=len(completed),
            pruned_trials=0,
            elapsed_sec=elapsed,
            optimizer_type=self.optimizer_type,
            search_space=self.search_space,
        )
