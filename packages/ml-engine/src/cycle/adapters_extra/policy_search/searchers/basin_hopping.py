"""Non-convex optimisation: multi-start basin hopping (scipy.optimize.basinhopping).

Each epoch is one restart from a fresh random point: basin hopping alternates
a random perturbation of the current point (``perturbation_scale``) with a
local L-BFGS-B descent on the exact gradient (``Problem.loss_and_gradient``,
at most ``local_iteration_limit`` iterations, inside the weight box), and
accepts the new basin by the Metropolis rule at ``temperature``;
``hop_count`` hops per restart. Restarts land in different basins, so each
epoch's ``current`` is that restart's own optimum (not the running best), and
validation picks the basin that generalises. The share of restarts ending
within 1e-6 of the best objective is logged as how often the best basin is found.
"""

from __future__ import annotations

import math

import numpy as np

from .base import Searcher


class BasinHoppingSearcher(Searcher):
    name = "basin hopping"

    def __init__(self, problem, parameters, seed, bound) -> None:
        super().__init__(problem, parameters, seed, bound)
        self.restart_losses: list[float] = []

    def step(self) -> float:
        from scipy.optimize import basinhopping

        self.generation += 1
        start = self.generator.uniform(-0.5 * self.bound, 0.5 * self.bound, self.dimension)
        bounds = list(zip(self.lower, self.upper))

        def function(theta):
            self.evaluations += 1
            return self.problem.loss_and_gradient(theta)

        result = basinhopping(
            function, start, niter=int(self.parameters["hop_count"]), T=float(self.parameters["temperature"]),
            stepsize=float(self.parameters["perturbation_scale"]),
            minimizer_kwargs={"method": "L-BFGS-B", "jac": True, "bounds": bounds,
                              "options": {"maxiter": int(self.parameters["local_iteration_limit"])}},
            rng=np.random.default_rng([self.seed, 104729, self.generation]),
        )
        theta = self.clip(np.asarray(result.x, dtype=np.float64))
        loss = float(self.problem.loss(theta[None, :])[0])
        self.consider(theta[None, :], np.array([loss]))
        self.current = theta
        self.restart_losses.append(loss)
        finite = np.array([value for value in self.restart_losses if math.isfinite(value)])
        self.statistics = {
            "restart_loss": loss,
            "best_basin_share": float(np.mean(np.abs(finite - finite.min()) <= 1e-6)) if finite.size else None,
        }
        return loss


__all__ = ["BasinHoppingSearcher"]
