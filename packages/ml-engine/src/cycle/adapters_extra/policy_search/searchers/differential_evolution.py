"""Differential evolution, DE/rand/1/bin (scipy.optimize's solver, one generation per step).

For each target vector a mutant x_r1 + F (x_r2 - x_r3) is built from three
other members (F = ``mutation_scale``), crossed with the target dimension by
dimension with probability ``crossover_probability`` (binomial), and the
trial replaces the target when it scores at least as well. scipy's
``DifferentialEvolutionSolver`` is stepped with ``next()`` so every
generation is one engine epoch; ``vectorized=True`` with ``updating='deferred'``
hands it the whole trial population as one matrix (``Problem.loss``). The
initial population (``population_size`` members) is a seeded Latin hypercube
over the weight box. No polishing: the result is DE's own.
"""

from __future__ import annotations

import numpy as np

from .base import Searcher


class DifferentialEvolutionSearcher(Searcher):
    name = "differential evolution"

    def __init__(self, problem, parameters, seed, bound) -> None:
        super().__init__(problem, parameters, seed, bound)
        from scipy.optimize._differentialevolution import DifferentialEvolutionSolver
        from scipy.stats import qmc

        size = max(5, int(self.parameters["population_size"]))
        sample = qmc.LatinHypercube(d=self.dimension, rng=np.random.default_rng([self.seed, 31337])).random(size)
        initial = self.lower + sample * (self.upper - self.lower)

        def population_loss(columns):
            thetas = np.asarray(columns, dtype=np.float64).T
            return self.evaluate(thetas)

        self.solver = DifferentialEvolutionSolver(
            population_loss, list(zip(self.lower, self.upper)), strategy="rand1bin",
            mutation=float(self.parameters["mutation_scale"]),
            recombination=float(self.parameters["crossover_probability"]),
            rng=np.random.default_rng([self.seed, 27644437]), polish=False, updating="deferred", vectorized=True,
            init=initial, maxiter=10 ** 9, tol=0.0, atol=0.0,
        )

    def _step(self) -> None:
        next(self.solver)
        energies = np.asarray(self.solver.population_energies, dtype=np.float64)
        finite = energies[np.isfinite(energies)]
        self.statistics = {"population_spread": float(np.std(finite)) if finite.size else None,
                           "population_mean_loss": float(np.mean(finite)) if finite.size else None}


__all__ = ["DifferentialEvolutionSearcher"]
