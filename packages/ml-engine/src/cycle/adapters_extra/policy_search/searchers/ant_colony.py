"""Ant colony optimisation for continuous domains: ACO_R (Socha and Dorigo, 2008).

The pheromone is a solution archive of ``archive_size`` candidates sorted by
loss; the l-th best carries the weight
    omega_l = exp(-(l - 1)^2 / (2 q^2 k^2)) / (q k sqrt(2 pi)),
q = ``locality`` (small q: the ants follow the best few). Each of the
``population_size`` ants picks an archive member with probability proportional
to omega and samples every coordinate from a Gaussian around it with
    sigma_i = xi * sum_e |s_e,i - s_l,i| / (k - 1),
xi = ``deviation_ratio`` (the pheromone's evaporation: a larger xi forgets the
archive's shape faster). The ants are scored in one matrix product and the
archive keeps the best k of old and new. All draws come from the searcher's
seeded generator.
"""

from __future__ import annotations

import math

import numpy as np

from .base import Searcher


class AntColonySearcher(Searcher):
    name = "ant colony (ACO_R)"

    def __init__(self, problem, parameters, seed, bound) -> None:
        super().__init__(problem, parameters, seed, bound)
        size = max(2, int(self.parameters["archive_size"]))
        self.archive = self.generator.uniform(-self.bound, self.bound, (size, self.dimension))
        self.archive_loss = self.evaluate(self.archive)
        self._sort()
        locality = float(self.parameters["locality"])
        ranks = np.arange(size, dtype=np.float64)
        weights = np.exp(-(ranks ** 2) / (2.0 * locality ** 2 * size ** 2)) / (locality * size * math.sqrt(2.0 * math.pi))
        total = weights.sum()
        self.choice = weights / total if total > 0 and np.isfinite(total) else np.full(size, 1.0 / size)

    def _sort(self) -> None:
        order = np.argsort(np.where(np.isfinite(self.archive_loss), self.archive_loss, np.inf), kind="stable")
        self.archive, self.archive_loss = self.archive[order], self.archive_loss[order]

    def _step(self) -> None:
        size = self.archive.shape[0]
        ants = max(1, int(self.parameters["population_size"]))
        chosen = self.generator.choice(size, size=ants, p=self.choice)
        centres = self.archive[chosen]
        spread = np.abs(self.archive[None, :, :] - centres[:, None, :]).sum(axis=1) / max(size - 1, 1)
        spread = float(self.parameters["deviation_ratio"]) * spread
        candidates = self.clip(centres + spread * self.generator.standard_normal(centres.shape))
        losses = self.evaluate(candidates)
        self.archive = np.vstack([self.archive, candidates])
        self.archive_loss = np.concatenate([self.archive_loss, losses])
        self._sort()
        self.archive, self.archive_loss = self.archive[:size], self.archive_loss[:size]
        self.statistics = {"archive_spread": float(np.mean(np.std(self.archive, axis=0)))}


__all__ = ["AntColonySearcher"]
