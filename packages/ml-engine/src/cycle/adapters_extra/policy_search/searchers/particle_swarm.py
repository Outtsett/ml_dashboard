"""Particle swarm optimisation, global best (pyswarms' backend), one iteration per step.

Each particle's velocity is v <- w v + c1 r1 (personal best - x) + c2 r2
(swarm best - x), w = ``inertia_weight``, c1 = ``cognitive_coefficient``,
c2 = ``social_coefficient``, r1 and r2 uniform draws, clamped to
+-``velocity_clamp`` x the weight bound; positions stay in the weight box
(pyswarms' periodic boundary handler). The whole swarm is scored in one
matrix product. pyswarms draws from numpy's global generator, so every
iteration runs inside the searcher's private random state.
"""

from __future__ import annotations

import numpy as np

from ..randomness import GlobalRandomState
from .base import Searcher


class ParticleSwarmSearcher(Searcher):
    name = "particle swarm"

    def __init__(self, problem, parameters, seed, bound) -> None:
        super().__init__(problem, parameters, seed, bound)
        from pyswarms import backend
        from pyswarms.backend.handlers import BoundaryHandler, VelocityHandler
        from pyswarms.backend.topology import Star

        self.backend = backend
        self.topology = Star()
        self.velocity_handler = VelocityHandler(strategy="unmodified")
        self.boundary_handler = BoundaryHandler(strategy="periodic")
        self.box = (self.lower, self.upper)
        limit = float(self.parameters["velocity_clamp"]) * self.bound
        self.clamp = (-limit, limit)
        self.random_state = GlobalRandomState(self.seed + 3)
        options = {"c1": float(self.parameters["cognitive_coefficient"]),
                   "c2": float(self.parameters["social_coefficient"]), "w": float(self.parameters["inertia_weight"])}
        with self.random_state.active():
            self.swarm = backend.create_swarm(n_particles=max(2, int(self.parameters["population_size"])),
                                              dimensions=self.dimension, options=options, bounds=self.box,
                                              clamp=self.clamp)
        self.swarm.current_cost = self.evaluate(self.swarm.position)
        self.swarm.pbest_pos = self.swarm.position.copy()
        self.swarm.pbest_cost = self.swarm.current_cost.copy()
        with self.random_state.active():
            self.swarm.best_pos, self.swarm.best_cost = self.topology.compute_gbest(self.swarm)

    def _step(self) -> None:
        with self.random_state.active():
            self.swarm.velocity = self.topology.compute_velocity(self.swarm, self.clamp, self.velocity_handler, self.box)
            self.swarm.position = self.topology.compute_position(self.swarm, self.box, self.boundary_handler)
        self.swarm.current_cost = self.evaluate(self.swarm.position)
        with self.random_state.active():
            self.swarm.pbest_pos, self.swarm.pbest_cost = self.backend.compute_pbest(self.swarm)
            self.swarm.best_pos, self.swarm.best_cost = self.topology.compute_gbest(self.swarm)
        self.statistics = {"swarm_spread": float(np.mean(np.std(self.swarm.position, axis=0))),
                           "swarm_best_loss": float(self.swarm.best_cost)}


__all__ = ["ParticleSwarmSearcher"]
