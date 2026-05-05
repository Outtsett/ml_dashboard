"""Particle Swarm Optimizer backed by pyswarms.

Maps the shared ``SearchSpace`` to a continuous PySwarms search and handles
discrete / categorical / boolean dimensions by rounding continuous particle
positions back to valid values after each iteration.

Supports both ``GlobalBestPSO`` (star topology) and ``LocalBestPSO``
(ring topology) via the ``topology`` parameter.

Log-scale dimensions are optimized in log space and converted back before
the objective function is called.
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


# ---------------------------------------------------------------------------
# Dimension mapping helpers
# ---------------------------------------------------------------------------


def _build_bounds(
    dim_order: list[SearchDimension],
) -> tuple[np.ndarray, np.ndarray]:
    """Build lower/upper bound arrays for PySwarms from ordered dimensions.

    Continuous bounds are constructed as follows:
      * ``float`` / ``int``: use ``[low, high]``.  When ``log_scale`` is set
        the bounds are mapped to ``[log(low), log(high)]``.
      * ``categorical``: ``[0, len(choices) - 1]``.
      * ``bool``: ``[0, 1]``.

    Returns:
        ``(min_bound, max_bound)`` each of shape ``(n_dims,)``.
    """
    mins: list[float] = []
    maxs: list[float] = []

    for dim in dim_order:
        if dim.dim_type in {"int", "float"}:
            assert dim.low is not None and dim.high is not None
            lo, hi = float(dim.low), float(dim.high)
            if dim.log_scale:
                if lo <= 0:
                    raise ValueError(
                        f"log_scale requires positive bounds — "
                        f"dim '{dim.name}' has low={lo}"
                    )
                lo, hi = math.log(lo), math.log(hi)
            mins.append(lo)
            maxs.append(hi)
        elif dim.dim_type == "categorical":
            assert dim.choices is not None
            mins.append(0.0)
            maxs.append(float(len(dim.choices) - 1))
        elif dim.dim_type == "bool":
            mins.append(0.0)
            maxs.append(1.0)
        else:
            raise ValueError(f"Unsupported dim_type '{dim.dim_type}' for '{dim.name}'")

    return np.array(mins), np.array(maxs)


def _decode_position(
    position: np.ndarray,
    dim_order: list[SearchDimension],
) -> dict[str, Any]:
    """Convert a single continuous particle position into a param dict.

    Applies rounding, log-space inversion, step snapping, and categorical
    index decoding as needed.

    Args:
        position: 1-D array of length ``n_dims``.
        dim_order: Ordered list of ``SearchDimension`` matching the position.

    Returns:
        Dict mapping parameter names to decoded values.
    """
    params: dict[str, Any] = {}

    for i, dim in enumerate(dim_order):
        val = float(position[i])

        if dim.dim_type == "float":
            if dim.log_scale:
                val = math.exp(val)
            # Clip to original bounds
            val = max(float(dim.low), min(float(dim.high), val))  # type: ignore[arg-type]
            params[dim.name] = val

        elif dim.dim_type == "int":
            if dim.log_scale:
                val = math.exp(val)
            # Snap to step grid when specified
            lo = float(dim.low)  # type: ignore[arg-type]
            hi = float(dim.high)  # type: ignore[arg-type]
            if dim.step is not None and dim.step > 0:
                val = lo + round((val - lo) / dim.step) * dim.step
            val = int(round(val))
            val = max(int(dim.low), min(int(dim.high), val))  # type: ignore[arg-type]
            params[dim.name] = val

        elif dim.dim_type == "categorical":
            assert dim.choices is not None
            idx = int(round(val))
            idx = max(0, min(len(dim.choices) - 1, idx))
            params[dim.name] = dim.choices[idx]

        elif dim.dim_type == "bool":
            params[dim.name] = val >= 0.5

    return params


def _decode_swarm(
    positions: np.ndarray,
    dim_order: list[SearchDimension],
) -> list[dict[str, Any]]:
    """Decode every particle in the swarm (2-D position matrix)."""
    return [_decode_position(positions[p], dim_order) for p in range(positions.shape[0])]


# ---------------------------------------------------------------------------
# PSO Optimizer
# ---------------------------------------------------------------------------


@OptimizerRegistry.register("pso")
class PSOOptimizer(BaseOptimizer):
    """Particle Swarm Optimizer using `pyswarms`_ as backend.

    Operates entirely in continuous space.  Discrete, categorical, and
    boolean dimensions are handled by mapping to a continuous interval and
    rounding decoded positions back to valid values.

    Extra constructor parameters (beyond ``BaseOptimizer``):
        n_particles: Swarm size (default ``30``).
        c1: Cognitive acceleration coefficient (default ``2.0``).
        c2: Social acceleration coefficient (default ``2.0``).
        w: Inertia weight (default ``0.7``).
        topology: ``'global'`` for star topology (``GlobalBestPSO``) or
            ``'local'`` for ring topology (``LocalBestPSO``).
        velocity_clamp: Optional ``(min, max)`` velocity clamp tuple.
        k: Number of neighbours for ``LocalBestPSO`` (default ``3``).
        p: Minkowski p-norm for ``LocalBestPSO`` distance (default ``2``).

    .. _pyswarms: https://pyswarms.readthedocs.io/
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
        n_particles: int = 30,
        c1: float = 2.0,
        c2: float = 2.0,
        w: float = 0.7,
        topology: str = "global",
        velocity_clamp: tuple[float, float] | None = None,
        k: int = 3,
        p: int = 2,
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

        if topology not in {"global", "local"}:
            raise ValueError(
                f"topology must be 'global' or 'local', got '{topology}'"
            )

        self.n_particles = n_particles
        self.c1 = c1
        self.c2 = c2
        self.w = w
        self.topology = topology
        self.velocity_clamp = velocity_clamp
        self.k = k
        self.p = p

    # -- BaseOptimizer abstract interface ------------------------------------

    @property
    def optimizer_type(self) -> str:  # noqa: D401
        return "pso"

    def get_config_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "n_particles": {
                    "type": "integer",
                    "minimum": 2,
                    "default": 30,
                    "description": "Number of particles in the swarm.",
                },
                "c1": {
                    "type": "number",
                    "minimum": 0.0,
                    "default": 2.0,
                    "description": (
                        "Cognitive acceleration coefficient — weight of "
                        "personal best attraction."
                    ),
                },
                "c2": {
                    "type": "number",
                    "minimum": 0.0,
                    "default": 2.0,
                    "description": (
                        "Social acceleration coefficient — weight of "
                        "global/neighbourhood best attraction."
                    ),
                },
                "w": {
                    "type": "number",
                    "minimum": 0.0,
                    "maximum": 1.0,
                    "default": 0.7,
                    "description": "Inertia weight for velocity update.",
                },
                "topology": {
                    "type": "string",
                    "enum": ["global", "local"],
                    "default": "global",
                    "description": (
                        "Swarm topology. 'global' uses star (GlobalBestPSO), "
                        "'local' uses ring (LocalBestPSO)."
                    ),
                },
                "velocity_clamp": {
                    "type": ["array", "null"],
                    "items": {"type": "number"},
                    "minItems": 2,
                    "maxItems": 2,
                    "default": None,
                    "description": (
                        "Optional [min, max] velocity clamp. "
                        "None lets pyswarms use defaults."
                    ),
                },
                "k": {
                    "type": "integer",
                    "minimum": 1,
                    "default": 3,
                    "description": (
                        "Number of neighbours for LocalBestPSO "
                        "(ignored when topology='global')."
                    ),
                },
                "p": {
                    "type": "integer",
                    "enum": [1, 2],
                    "default": 2,
                    "description": (
                        "Minkowski p-norm for LocalBestPSO distance "
                        "(ignored when topology='global')."
                    ),
                },
            },
            "additionalProperties": False,
        }

    # -- core optimisation loop ----------------------------------------------

    def _optimize(
        self, objective_fn: Callable[[dict[str, Any]], float]
    ) -> OptimizationResult:
        from pyswarms.single import GlobalBestPSO, LocalBestPSO

        dim_order = list(self.search_space.dimensions.values())
        n_dims = len(dim_order)

        if n_dims == 0:
            raise ValueError("SearchSpace has no dimensions — nothing to optimise.")

        min_bound, max_bound = _build_bounds(dim_order)
        bounds = (min_bound, max_bound)

        n_iters = max(1, self.n_trials // max(1, self.n_particles))
        maximizing = self.direction == "maximize"

        options = {"c1": self.c1, "c2": self.c2, "w": self.w}
        vel_clamp = (
            tuple(self.velocity_clamp) if self.velocity_clamp is not None else None
        )

        emit_log(
            f"PSO optimizer: topology={self.topology}, "
            f"n_particles={self.n_particles}, n_iters={n_iters}, "
            f"c1={self.c1}, c2={self.c2}, w={self.w}, "
            f"velocity_clamp={vel_clamp}, n_dims={n_dims}, "
            f"direction={self.direction}"
        )
        logger.info(
            "PySwarms optimizer: topology=%s, particles=%d, iters=%d, "
            "dims=%d, c1=%.2f, c2=%.2f, w=%.2f, vel_clamp=%s, "
            "direction=%s, seed=%s",
            self.topology,
            self.n_particles,
            n_iters,
            n_dims,
            self.c1,
            self.c2,
            self.w,
            vel_clamp,
            self.direction,
            self.seed,
        )

        # Log dimension details
        for dim in dim_order:
            logger.info(
                "  dim '%s': type=%s, low=%s, high=%s, step=%s, "
                "log_scale=%s, choices=%s",
                dim.name,
                dim.dim_type,
                dim.low,
                dim.high,
                dim.step,
                dim.log_scale,
                dim.choices,
            )

        # ---- Build the PySwarms optimizer -----------------------------------
        pso_kwargs: dict[str, Any] = {
            "n_particles": self.n_particles,
            "dimensions": n_dims,
            "options": options,
            "bounds": bounds,
        }

        if vel_clamp is not None:
            pso_kwargs["velocity_clamp"] = vel_clamp

        np.random.seed(self.seed)

        if self.topology == "local":
            pso_kwargs["options"]["k"] = self.k
            pso_kwargs["options"]["p"] = self.p
            pso_opt = LocalBestPSO(**pso_kwargs)
            logger.info(
                "Created LocalBestPSO — k=%d, p=%d", self.k, self.p
            )
        else:
            pso_opt = GlobalBestPSO(**pso_kwargs)
            logger.info("Created GlobalBestPSO")

        # ---- Manual iteration loop for SSE events ---------------------------
        # PySwarms' optimize() runs all iterations internally with no
        # per-iteration callback.  We drive the loop ourselves using the
        # lower-level swarm operations so we can emit SSE events after each
        # iteration and build a TrialResult list.

        all_trials: list[TrialResult] = []
        trial_counter = 0
        t_start = time.perf_counter()
        global_best_cost = float("inf")
        global_best_pos: np.ndarray | None = None
        cost_history: list[float] = []

        for iteration in range(n_iters):
            # Check wall-clock timeout
            if self.timeout is not None:
                elapsed = time.perf_counter() - t_start
                if elapsed >= self.timeout:
                    logger.info(
                        "Timeout reached (%.1fs >= %.1fs) at iteration %d/%d",
                        elapsed,
                        self.timeout,
                        iteration,
                        n_iters,
                    )
                    emit_log(
                        f"Timeout after iteration {iteration}/{n_iters} "
                        f"({elapsed:.1f}s)"
                    )
                    break

            t_iter = time.perf_counter()

            # Notify trial start before evaluation
            iter_params = {dim.name: "pending" for dim in self.search_space}
            self._notify_trial_start(trial_counter, iter_params)

            # --- Evaluate every particle in the swarm -----------------------
            positions = pso_opt.swarm.position
            particle_costs = np.full(self.n_particles, float("inf"))

            for p_idx in range(self.n_particles):
                params = _decode_position(positions[p_idx], dim_order)
                try:
                    score = objective_fn(params)
                    # PySwarms always minimises — flip sign for maximisation
                    cost = -score if maximizing else score
                    particle_costs[p_idx] = cost
                except Exception as exc:
                    logger.warning(
                        "Particle %d (iter %d) FAILED: %s",
                        p_idx,
                        iteration,
                        exc,
                    )
                    particle_costs[p_idx] = float("inf")

            # --- Update personal bests --------------------------------------
            # Compare each particle's cost against its personal best
            if iteration == 0:
                pso_opt.swarm.pbest_cost = particle_costs.copy()
                pso_opt.swarm.pbest_pos = positions.copy()
                pso_opt.swarm.current_cost = particle_costs.copy()
            else:
                improved = particle_costs < pso_opt.swarm.pbest_cost
                pso_opt.swarm.pbest_cost[improved] = particle_costs[improved]
                pso_opt.swarm.pbest_pos[improved] = positions[improved]
                pso_opt.swarm.current_cost = particle_costs.copy()

            # Guard: if all particles returned inf, initialise global best
            if global_best_pos is None:
                global_best_pos = swarm_pos[0].copy() if iteration == 0 else pso_opt.swarm.position[0].copy()
                global_best_cost = costs[0] if iteration == 0 else particle_costs[0]

            # --- Update global/neighbourhood best ---------------------------
            if self.topology == "global":
                best_idx = int(np.argmin(pso_opt.swarm.pbest_cost))
                best_cost_this = float(pso_opt.swarm.pbest_cost[best_idx])
                if best_cost_this < global_best_cost:
                    global_best_cost = best_cost_this
                    global_best_pos = pso_opt.swarm.pbest_pos[best_idx].copy()
                pso_opt.swarm.best_cost = global_best_cost
                pso_opt.swarm.best_pos = global_best_pos.copy()
            else:
                # LocalBestPSO — let pyswarms topology compute neighbourhood
                # bests via its ring topology handler.
                try:
                    from pyswarms.backend.topology import Ring
                    ring = Ring(static=False)
                    best_cost_this, best_pos_this = ring.compute_gbest(
                        pso_opt.swarm, p=self.p, k=self.k
                    )
                    best_cost_this = float(best_cost_this)
                    if best_cost_this < global_best_cost:
                        global_best_cost = best_cost_this
                        global_best_pos = best_pos_this.copy()
                    pso_opt.swarm.best_cost = global_best_cost
                    pso_opt.swarm.best_pos = global_best_pos.copy()
                except Exception:
                    # Fallback: global argmin over personal bests
                    best_idx = int(np.argmin(pso_opt.swarm.pbest_cost))
                    best_cost_this = float(pso_opt.swarm.pbest_cost[best_idx])
                    if best_cost_this < global_best_cost:
                        global_best_cost = best_cost_this
                        global_best_pos = pso_opt.swarm.pbest_pos[best_idx].copy()
                    pso_opt.swarm.best_cost = global_best_cost
                    pso_opt.swarm.best_pos = global_best_pos.copy()

            cost_history.append(global_best_cost)

            # --- Compute new velocities & positions -------------------------
            pso_opt.swarm.velocity = _compute_velocity(
                pso_opt.swarm.position,
                pso_opt.swarm.velocity,
                pso_opt.swarm.pbest_pos,
                pso_opt.swarm.best_pos,
                self.w,
                self.c1,
                self.c2,
                vel_clamp,
                min_bound,
                max_bound,
            )
            pso_opt.swarm.position = (
                pso_opt.swarm.position + pso_opt.swarm.velocity
            )
            # Clamp positions within bounds
            pso_opt.swarm.position = np.clip(
                pso_opt.swarm.position, min_bound, max_bound
            )

            # --- Emit SSE event for this iteration --------------------------
            iter_duration = time.perf_counter() - t_iter
            best_params = _decode_position(global_best_pos, dim_order)
            best_score = -global_best_cost if maximizing else global_best_cost

            # Build a TrialResult for the best particle of this iteration
            trial_result = TrialResult(
                trial_id=trial_counter,
                params=best_params,
                score=best_score,
                metrics={
                    "iteration": iteration,
                    "global_best_cost": global_best_cost,
                    "mean_particle_cost": float(np.mean(
                        particle_costs[particle_costs < float("inf")]
                    )) if np.any(particle_costs < float("inf")) else float("inf"),
                    "n_particles_evaluated": int(
                        np.sum(particle_costs < float("inf"))
                    ),
                },
                duration_sec=iter_duration,
            )
            all_trials.append(trial_result)

            self._notify_trial_end(trial_result)

            logger.info(
                "Iteration %d/%d — best_cost=%.6f  best_score=%.6f  "
                "mean_cost=%.6f  %.2fs  params=%s",
                iteration + 1,
                n_iters,
                global_best_cost,
                best_score,
                trial_result.metrics["mean_particle_cost"],
                iter_duration,
                best_params,
            )

            trial_counter += 1

        # ---- Assemble final result -----------------------------------------
        if global_best_pos is None:
            raise RuntimeError(
                "PSO produced no valid results — all particles failed."
            )

        total_elapsed = time.perf_counter() - t_start
        best_params = _decode_position(global_best_pos, dim_order)
        best_score = -global_best_cost if maximizing else global_best_cost

        best_trial = TrialResult(
            trial_id=0,
            params=best_params,
            score=best_score,
        )
        # Find the best trial from our history if possible
        if all_trials:
            if maximizing:
                best_trial = max(all_trials, key=lambda t: t.score)
            else:
                best_trial = min(all_trials, key=lambda t: t.score)

        completed = [t for t in all_trials if t.error is None]

        logger.info(
            "PSO search complete: %d iterations, %d total evaluations, "
            "best_score=%.6f in %.1fs",
            len(all_trials),
            len(all_trials) * self.n_particles,
            best_score,
            total_elapsed,
        )
        emit_log(
            f"PSO complete: {len(all_trials)} iters × "
            f"{self.n_particles} particles = "
            f"{len(all_trials) * self.n_particles} evaluations, "
            f"best_score={best_score:.6f}"
        )

        return OptimizationResult(
            best_trial=best_trial,
            all_trials=all_trials,
            best_params=best_params,
            best_score=best_score,
            total_trials=len(all_trials),
            completed_trials=len(completed),
            pruned_trials=0,
            elapsed_sec=total_elapsed,
            optimizer_type=self.optimizer_type,
            search_space=self.search_space,
        )


# ---------------------------------------------------------------------------
# Velocity computation
# ---------------------------------------------------------------------------


def _compute_velocity(
    position: np.ndarray,
    velocity: np.ndarray,
    pbest_pos: np.ndarray,
    gbest_pos: np.ndarray,
    w: float,
    c1: float,
    c2: float,
    velocity_clamp: tuple[float, float] | None,
    min_bound: np.ndarray,
    max_bound: np.ndarray,
) -> np.ndarray:
    """Compute updated velocity for all particles.

    Standard PSO velocity update::

        v_new = w * v + c1 * r1 * (pbest - pos) + c2 * r2 * (gbest - pos)

    Args:
        position: Current positions ``(n_particles, n_dims)``.
        velocity: Current velocities ``(n_particles, n_dims)``.
        pbest_pos: Personal best positions ``(n_particles, n_dims)``.
        gbest_pos: Global best position ``(n_dims,)``.
        w: Inertia weight.
        c1: Cognitive coefficient.
        c2: Social coefficient.
        velocity_clamp: Optional ``(min, max)`` clamp for velocities.
        min_bound: Lower bounds ``(n_dims,)``.
        max_bound: Upper bounds ``(n_dims,)``.

    Returns:
        Updated velocity array ``(n_particles, n_dims)``.
    """
    r1 = np.random.uniform(size=position.shape)
    r2 = np.random.uniform(size=position.shape)

    cognitive = c1 * r1 * (pbest_pos - position)
    social = c2 * r2 * (gbest_pos - position)
    new_velocity = w * velocity + cognitive + social

    if velocity_clamp is not None:
        new_velocity = np.clip(new_velocity, velocity_clamp[0], velocity_clamp[1])

    return new_velocity
