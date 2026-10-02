"""The genetic algorithm (DEAP operators), one generation per step.

The chromosome is [F inclusion bits | F real weights | the bias]: the policy's
weight on feature i is bit_i * weight_i, so the GA searches which features
the rule uses as well as how much. Each generation: tournament selection
(``tournament_size``), uniform crossover of the bits and blend crossover of
the reals (``crossover_probability`` per pair), bit-flip and Gaussian
mutation (``mutation_probability`` per gene), the ``elite_count`` best parents
carried over unchanged, and the whole offspring population scored in one
matrix product. Fitness is the problem's loss plus ``feature_penalty`` per
included feature. DEAP draws from Python's ``random``; every generation runs
inside the searcher's private random state.
"""

from __future__ import annotations

import numpy as np

from ..randomness import GlobalRandomState
from .base import Searcher


def _individual_types():
    from deap import base

    class GeneticFitness(base.Fitness):
        weights = (-1.0,)                    # a loss: lower is fitter

    class GeneticIndividual(list):
        def __init__(self, values=()):
            super().__init__(values)
            self.fitness = GeneticFitness()

    return GeneticIndividual


class GeneticSearcher(Searcher):
    name = "genetic algorithm"

    def __init__(self, problem, parameters, seed, bound) -> None:
        super().__init__(problem, parameters, seed, bound)
        self.features = self.problem.feature_count
        self.individual = _individual_types()
        self.random_state = GlobalRandomState(self.seed + 2)
        size = max(4, int(self.parameters["population_size"]))
        with self.random_state.active():
            import random

            self.population = [
                self.individual([float(random.random() < 0.5) for _ in range(self.features)]
                                + [random.uniform(-self.bound, self.bound) for _ in range(self.features + 1)])
                for _ in range(size)
            ]
        self._score(self.population)

    def decode(self, individuals) -> np.ndarray:
        genes = np.asarray([list(individual) for individual in individuals], dtype=np.float64)
        mask = genes[:, :self.features] >= 0.5
        weights = np.where(mask, genes[:, self.features:2 * self.features], 0.0)
        return np.column_stack([weights, genes[:, -1]])

    def _score(self, individuals) -> None:
        thetas = self.decode(individuals)
        active = np.sum(np.abs(thetas[:, :-1]) > 0, axis=1)
        losses = self.problem.loss(thetas) + float(self.parameters["feature_penalty"]) * active
        self.evaluations += len(individuals)
        self.consider(thetas, losses)
        for individual, loss in zip(individuals, losses):
            individual.fitness.values = (float(loss) if np.isfinite(loss) else 1e12,)

    def _step(self) -> None:
        from deap import tools

        size = len(self.population)
        elite_count = min(int(self.parameters["elite_count"]), size)
        crossover = float(self.parameters["crossover_probability"])
        mutation = float(self.parameters["mutation_probability"])
        features = self.features
        with self.random_state.active():
            import random

            elite = [self._clone(individual) for individual in tools.selBest(self.population, elite_count)]
            parents = tools.selTournament(self.population, size - elite_count,
                                          tournsize=int(self.parameters["tournament_size"]))
            offspring = [self._clone(individual) for individual in parents]
            for first, second in zip(offspring[::2], offspring[1::2]):
                if random.random() < crossover:
                    bits_a, bits_b = first[:features], second[:features]
                    tools.cxUniform(bits_a, bits_b, 0.5)
                    reals_a, reals_b = first[features:], second[features:]
                    tools.cxBlend(reals_a, reals_b, 0.5)
                    first[:] = bits_a + reals_a
                    second[:] = bits_b + reals_b
            for child in offspring:
                bits, reals = child[:features], child[features:]
                tools.mutFlipBit(bits, indpb=mutation)
                tools.mutGaussian(reals, mu=0.0, sigma=0.25 * self.bound, indpb=mutation)
                child[:] = [float(bit) for bit in bits] + [float(np.clip(value, -self.bound, self.bound)) for value in reals]
        self._score(offspring)
        self.population = elite + offspring
        losses = np.array([individual.fitness.values[0] for individual in self.population])
        self.statistics = {"population_mean_loss": float(np.mean(losses)),
                           "included_features": int(np.sum(np.abs(self.best_theta[:-1]) > 0))}

    def _clone(self, individual):
        clone = self.individual(list(individual))
        clone.fitness.values = individual.fitness.values
        return clone


__all__ = ["GeneticSearcher"]
