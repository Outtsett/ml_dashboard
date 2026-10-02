"""Evolution strategies: CMA-ES (the ``cma`` package), one ask/tell per step.

Each generation samples ``population_size`` candidates from N(m, sigma^2 C),
scores them in one matrix product, and updates the mean from the best half
(weighted recombination), the step size sigma by cumulative path length
control and the covariance C by the rank-one and rank-mu updates. The search
starts at w = 0, b = 0 with sigma = ``initial_step_size`` and stays inside the
weight box (cma's bound transform). ``cma`` draws from numpy's global
generator, so every call runs inside the searcher's private random state.
"""

from __future__ import annotations

import numpy as np

from ..randomness import GlobalRandomState
from .base import Searcher


class CovarianceAdaptationSearcher(Searcher):
    name = "CMA-ES"

    def __init__(self, problem, parameters, seed, bound) -> None:
        super().__init__(problem, parameters, seed, bound)
        import cma

        self.random_state = GlobalRandomState(self.seed + 1)
        options = {"popsize": max(4, int(self.parameters["population_size"])), "seed": self.seed % (2 ** 31 - 2) + 1,
                   "verbose": -9, "bounds": [-self.bound, self.bound], "verb_log": 0, "verb_disp": 0}
        with self.random_state.active():
            self.strategy = cma.CMAEvolutionStrategy(np.zeros(self.dimension),
                                                     float(self.parameters["initial_step_size"]), options)

    def _step(self) -> None:
        with self.random_state.active():
            candidates = self.strategy.ask()
        thetas = self.clip(np.asarray(candidates, dtype=np.float64))
        losses = self.evaluate(thetas)
        with self.random_state.active():
            self.strategy.tell(candidates, [float(value) if np.isfinite(value) else 1e12 for value in losses])
        self.statistics = {"step_size": float(self.strategy.sigma)}


__all__ = ["CovarianceAdaptationSearcher"]
