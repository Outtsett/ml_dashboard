"""Simulated annealing: one Metropolis chain with geometric cooling (own loop).

One epoch is one temperature level of ``moves_per_temperature`` moves. A move
perturbs a random quarter of the coordinates (at least one) by
N(0, ``perturbation_scale``^2), clipped to the weight box, and is accepted
when it lowers the energy (the problem's loss) or else with probability
exp(-dE / T). After the level T <- ``cooling_rate`` x T; when the best energy
has not improved for ``reheat_after`` levels, T is reset to its starting
value ``temperature`` (a reheat) and the chain restarts from the best point.
All draws come from the searcher's seeded generator.
"""

from __future__ import annotations

import math

import numpy as np

from .base import Searcher


class AnnealingSearcher(Searcher):
    name = "simulated annealing"

    def __init__(self, problem, parameters, seed, bound) -> None:
        super().__init__(problem, parameters, seed, bound)
        self.state = np.zeros(self.dimension)
        self.energy = float(self.evaluate(self.state[None, :])[0])
        self.temperature = float(self.parameters["temperature"])
        self.stalled_levels = 0
        self.reheats = 0

    def _step(self) -> None:
        previous_best = self.best_loss
        scale = float(self.parameters["perturbation_scale"])
        changed = max(1, self.dimension // 4)
        accepted = 0
        moves = max(1, int(self.parameters["moves_per_temperature"]))
        for _ in range(moves):
            proposal = self.state.copy()
            coordinates = self.generator.choice(self.dimension, size=changed, replace=False)
            proposal[coordinates] += scale * self.generator.standard_normal(changed)
            proposal = self.clip(proposal)
            energy = float(self.evaluate(proposal[None, :])[0])
            difference = energy - self.energy
            threshold = self.generator.random()
            if math.isfinite(energy) and (difference <= 0 or (
                    self.temperature > 0 and threshold < math.exp(-difference / self.temperature))):
                self.state, self.energy = proposal, energy
                accepted += 1
        self.stalled_levels = 0 if self.best_loss < previous_best else self.stalled_levels + 1
        self.temperature *= float(self.parameters["cooling_rate"])
        if self.stalled_levels >= int(self.parameters["reheat_after"]):
            self.temperature = float(self.parameters["temperature"])
            self.state, self.energy = self.best_theta.copy(), self.best_loss
            self.stalled_levels = 0
            self.reheats += 1
        self.statistics = {"temperature": self.temperature, "acceptance_rate": accepted / moves, "reheats": self.reheats}


__all__ = ["AnnealingSearcher"]
