"""The searcher contract: one generation per ``step()``.

A searcher optimises ``Problem.loss`` over the box [-bound, bound] of the
(w, b) vector of a ``LinearPolicy``. The adapter drives it through the
engine's epoch loop (``cycle.bridges.training.run_epochs``): every epoch calls
``step()`` once (one generation, one temperature level, one restart, one
chunk of gradient steps), then scores ``current`` on the validation rows; the
epoch whose ``current`` scored best on validation is the model kept.

``current`` is, by default, the incumbent: the best candidate on the TRAINING
objective found so far. The incumbents form a sequence that only improves in
sample, so choosing among them on validation is choosing when to stop the
search (a searcher whose epochs are independent, basin hopping's restarts,
sets ``current`` to that epoch's own result instead).
"""

from __future__ import annotations

import math

import numpy as np

from ..objective import Problem


class Searcher:
    name = ""

    def __init__(self, problem: Problem, parameters: dict, seed: int, bound: float) -> None:
        self.problem = problem
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.dimension = int(problem.dimension)
        self.bound = float(bound)
        self.generator = np.random.default_rng([self.seed, 7919])
        self.best_theta = np.zeros(self.dimension)
        self.best_loss = math.inf
        self.current = np.zeros(self.dimension)
        self.generation = 0
        self.evaluations = 0
        self.statistics: dict = {}

    @property
    def lower(self) -> np.ndarray:
        return np.full(self.dimension, -self.bound)

    @property
    def upper(self) -> np.ndarray:
        return np.full(self.dimension, self.bound)

    def clip(self, thetas: np.ndarray) -> np.ndarray:
        return np.clip(thetas, -self.bound, self.bound)

    def evaluate(self, thetas) -> np.ndarray:
        """The population's losses (one matrix product) and the incumbent updated."""
        thetas = np.atleast_2d(np.asarray(thetas, dtype=np.float64))
        losses = np.asarray(self.problem.loss(thetas), dtype=np.float64)
        self.evaluations += int(thetas.shape[0])
        self.consider(thetas, losses)
        return losses

    def consider(self, thetas: np.ndarray, losses: np.ndarray) -> None:
        losses = np.where(np.isfinite(losses), losses, np.inf)
        if losses.size == 0:
            return
        best = int(np.argmin(losses))
        if losses[best] < self.best_loss:
            self.best_loss = float(losses[best])
            self.best_theta = np.array(thetas[best], dtype=np.float64, copy=True)

    def step(self) -> float:
        """Run one generation; return the training loss to report (the incumbent's)."""
        self.generation += 1
        self._step()
        self.current = self.best_theta.copy()
        return self.best_loss

    def _step(self) -> None:
        raise NotImplementedError


__all__ = ["Searcher"]
