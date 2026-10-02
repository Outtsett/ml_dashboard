"""The cross-entropy method over a linear policy (gradient-free policy search).

Policy: scores = W x + b over {short, flat, long}, the action is the highest
score. Parameters theta = (W, b) are drawn from N(mean, spread^2)
(``population_size`` draws per iteration from a seeded generator); each draw is
backtested on the training span's tape (mean net reward per decision, minus
``weight_decay`` times the squared weights) and the top ``elite_fraction``
refit the mean and spread, with ``noise_floor`` added to the spread so the
search does not collapse early. One iteration is one epoch; the checkpoint is
the iteration whose mean policy earned most on the validation tape.

P(up): the belief the search ends with. ``PROBABILITY_DRAWS`` policies drawn
from the final N(mean, spread^2) (a fixed seeded set, the same at every call)
vote at each bar; P(up) = (long votes + 0.5) / (long + short votes + 1).
"""

from __future__ import annotations

import math

import numpy as np

from cycle.bridges.tape import ACTION_POSITIONS
from cycle.bridges.training import ValidationScore, run_epochs

from .readout import FitContext, observation_rows

PROBABILITY_DRAWS = 64


class CrossEntropyMethod:
    variant = "cem"
    discrete = True

    def __init__(self, parameters: dict, seed: int, architecture: dict) -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.architecture = dict(architecture)
        size = (self.input_size + 1) * 3
        self.mean = np.zeros(size)
        self.spread = np.full(size, float(self.parameters["initial_spread"]))
        self.extra: dict = {}
        self.summary: dict = {}

    @property
    def input_size(self) -> int:
        return int(self.architecture["input_size"])

    # ── the linear policy ──
    def _scores(self, observations: np.ndarray, thetas: np.ndarray) -> np.ndarray:
        """(draws, rows, 3) scores of each parameter draw on each observation."""
        size = self.input_size
        weights = thetas[:, : size * 3].reshape(-1, 3, size)
        bias = thetas[:, size * 3:].reshape(-1, 1, 3)
        return np.einsum("rf,daf->dra", observations, weights) + bias

    def _actions(self, observations: np.ndarray, thetas: np.ndarray) -> np.ndarray:
        return np.argmax(self._scores(observations, thetas), axis=2)

    def _fitness(self, observations: np.ndarray, rewards: np.ndarray, thetas: np.ndarray) -> np.ndarray:
        actions = self._actions(observations, thetas)                        # (draws, rows)
        earned = np.take_along_axis(rewards[None, :, :], actions[:, :, None], axis=2)[:, :, 0].mean(axis=1)
        penalty = float(self.parameters["weight_decay"]) * np.sum(thetas[:, : self.input_size * 3] ** 2, axis=1)
        return earned - penalty

    def _probability_draws(self) -> np.ndarray:
        noise = np.random.default_rng([self.seed % (2 ** 32), 7]).standard_normal((PROBABILITY_DRAWS, self.mean.size))
        return self.mean[None, :] + self.spread[None, :] * noise

    # ── the contract ──
    def probability(self, features: np.ndarray, rows) -> np.ndarray:
        observations, complete = observation_rows(features, rows)
        actions = self._actions(observations, self._probability_draws())       # (draws, rows)
        long = np.sum(actions == 2, axis=0).astype(np.float64)
        short = np.sum(actions == 0, axis=0).astype(np.float64)
        out = (long + 0.5) / (long + short + 1.0)
        out[~complete] = np.nan
        return out

    def greedy(self, features: np.ndarray, rows) -> np.ndarray:
        observations, _ = observation_rows(features, rows)
        return ACTION_POSITIONS[self._actions(observations, self.mean[None, :])[0]]

    def validate(self, context: FitContext) -> ValidationScore:
        rows = context.evaluator.rows
        if rows.size == 0:
            return ValidationScore(None, None, None, None)
        return context.evaluator.classification(self.probability(context.features, rows),
                                                self.greedy(context.features, rows))

    def fit(self, context: FitContext) -> dict:
        observations, _ = observation_rows(context.features, context.train_rows)
        rewards = np.asarray(context.reward_table, dtype=np.float64)
        population = max(2, int(self.parameters["population_size"]))
        elite_count = max(1, int(math.ceil(float(self.parameters["elite_fraction"]) * population)))
        noise_floor = float(self.parameters["noise_floor"])
        history = {"best_fitness": []}

        def train_epoch(epoch, report_batch):
            draw = np.random.default_rng([self.seed % (2 ** 32), int(epoch)])
            thetas = self.mean[None, :] + self.spread[None, :] * draw.standard_normal((population, self.mean.size))
            fitness = self._fitness(observations, rewards, thetas)
            elite = thetas[np.argsort(-fitness, kind="stable")[:elite_count]]
            self.mean = elite.mean(axis=0)
            self.spread = np.sqrt(elite.var(axis=0) + noise_floor ** 2)
            history["best_fitness"].append(float(fitness.max()))
            return -float(np.mean(np.sort(fitness)[-elite_count:]))            # minus the elite's mean net reward

        summary = run_epochs(context.reporter, epoch_count=int(self.parameters["iteration_count"]),
                             train_index=context.train_rows, train_epoch=train_epoch,
                             validate=lambda epoch: self.validate(context),
                             snapshot=lambda: (self.mean.copy(), self.spread.copy()),
                             restore=lambda state: self._restore(state), name=context.name)
        summary["best_train_fitness"] = max(history["best_fitness"]) if history["best_fitness"] else None
        self.summary = summary
        return summary

    def _restore(self, state) -> None:
        self.mean, self.spread = state[0].copy(), state[1].copy()

    def state(self) -> dict:
        return {"architecture": dict(self.architecture), "extra": dict(self.extra),
                "arrays": {"mean": self.mean.copy(), "spread": self.spread.copy()}}

    @classmethod
    def from_state(cls, parameters: dict, seed: int, state: dict) -> CrossEntropyMethod:
        method = cls(parameters, seed, state["architecture"])
        method.mean = np.asarray(state["arrays"]["mean"], dtype=np.float64)
        method.spread = np.asarray(state["arrays"]["spread"], dtype=np.float64)
        method.extra = dict(state.get("extra") or {})
        return method


__all__ = ["PROBABILITY_DRAWS", "CrossEntropyMethod"]
