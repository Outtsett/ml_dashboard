"""Full-batch gradient descent with heavy-ball momentum.

theta <- theta + v,  v <- momentum * v - learning_rate * grad f(theta), over the
WHOLE training span at every step (the gradient is exact: ``Problem.loss_and_gradient``),
the learning rate multiplied by ``learning_rate_decay`` after every step. One
epoch is ``iterations_per_epoch`` steps; ``current`` is the point reached,
so choosing the best epoch on validation is early stopping. Starts at zero.
"""

from __future__ import annotations

import math

import numpy as np

from .base import Searcher


class GradientDescentSearcher(Searcher):
    name = "gradient descent"

    def __init__(self, problem, parameters, seed, bound) -> None:
        super().__init__(problem, parameters, seed, bound)
        self.theta = np.zeros(self.dimension)
        self.velocity = np.zeros(self.dimension)
        self.rate = float(self.parameters["learning_rate"])

    def step(self) -> float:
        self.generation += 1
        momentum = float(self.parameters["momentum"])
        decay = float(self.parameters["learning_rate_decay"])
        loss = math.nan
        norm = math.nan
        for _ in range(max(1, int(self.parameters["iterations_per_epoch"]))):
            loss, gradient = self.problem.loss_and_gradient(self.theta)
            self.evaluations += 1
            norm = float(np.linalg.norm(gradient))
            if not np.all(np.isfinite(gradient)):
                break
            self.velocity = momentum * self.velocity - self.rate * gradient
            self.theta = self.theta + self.velocity
            self.rate *= decay
        loss, gradient = self.problem.loss_and_gradient(self.theta)
        self.consider(self.theta[None, :], np.array([loss]))
        self.current = self.theta.copy()
        self.statistics = {"gradient_norm": float(np.linalg.norm(gradient)), "learning_rate": self.rate,
                           "last_step_gradient_norm": norm}
        return float(loss)


__all__ = ["GradientDescentSearcher"]
