"""One optimiser per module, each a ``base.Searcher`` over a linear policy.

``searcher_class(variant)`` imports the module only when a fit asks for it,
so importing the adapter pulls in none of scipy.optimize, cma, deap,
pyswarms or scikit-optimize.
"""

from __future__ import annotations

import importlib

SEARCHERS = {
    "basin_hopping": "basin_hopping:BasinHoppingSearcher",
    "differential_evolution": "differential_evolution:DifferentialEvolutionSearcher",
    "cma_es": "cma_es:CovarianceAdaptationSearcher",
    "genetic": "genetic:GeneticSearcher",
    "gradient_descent": "gradient_descent:GradientDescentSearcher",
    "ant_colony": "ant_colony:AntColonySearcher",
    "bayesian": "bayesian:BayesianSearcher",
    "particle_swarm": "particle_swarm:ParticleSwarmSearcher",
    "annealing": "annealing:AnnealingSearcher",
}


def searcher_class(variant: str):
    if variant not in SEARCHERS:
        raise ValueError(f"no linear-policy searcher {variant!r}; known: {', '.join(SEARCHERS)}")
    module_name, class_name = SEARCHERS[variant].split(":")
    module = importlib.import_module(f"{__name__}.{module_name}")
    return getattr(module, class_name)


__all__ = ["SEARCHERS", "searcher_class"]
