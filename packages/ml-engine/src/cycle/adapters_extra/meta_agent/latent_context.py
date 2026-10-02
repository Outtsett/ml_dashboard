"""PEARL (Rakelly et al. 2019): a soft actor-critic conditioned on a probabilistic
task variable inferred from recent experience.

- **Context** of a block of ``adaptation_interval_bars`` bars: the transitions
  realised at the block's first bar (rows r <= anchor - h, at most
  ``context_bars``), each the bar's features with its realised scaled move and
  cost (a transition's reward for any position p is p * move - |p| * cost).
- **Encoder** q(z | c): each transition gives a Gaussian factor (mean and log
  variance per latent dimension); the posterior is their product with the
  unit-Gaussian prior (precisions add). No context gives the prior itself.
- **Critic**: twin Q networks Q(s, z, a) of a continuous position a in (-1, 1).
  The market does not react to the position and the next bar does not depend
  on it, so the soft Q-value is the expected trade reward itself (no
  bootstrap): Q is regressed on the tape reward (next-open fills, round trip)
  of random and policy positions. Each critic is factored the way that reward
  is, Q = a * f(s, z) - |a| * g(s, z) (a learned move and a learned cost), so
  its action gradient is right from the first update. The encoder is trained through the critic
  loss plus ``latent_divergence_weight`` times KL(q(z | c) || N(0, I)), as in PEARL.
- **Actor**: a tanh-squashed Gaussian policy pi(a | s, z) maximising
  min(Q1, Q2) - alpha log pi (alpha = ``entropy_coefficient``), with z held
  fixed (detached), as in PEARL.

Training walks the training span's blocks (tasks) in a seeded random order,
sampling z from each block's posterior. At prediction z is the posterior MEAN
of the bar's block (cached per block) and P(up) = P(a > 0) = Phi(mu / sigma) of
the actor's Gaussian before the squash.
"""

from __future__ import annotations

import math

import numpy as np
import torch
from scipy.special import ndtr
from torch import nn

from cycle.adapters_extra.meta_agent.common import (
    as_tensor,
    context_rows,
    finite_rows,
    group_by_anchor,
    module_state,
    move_and_cost,
    numpy_generator,
    perceptron,
    position_score,
    realised_rewards,
    restore,
    seeded,
    snapshot,
    tape_rewards,
    torch_generator,
)
from cycle.adapters_extra.meta_agent.mechanism import Mechanism
from cycle.bridges.training import run_epochs

LOG_STANDARD_DEVIATION_RANGE = (-5.0, 2.0)
LOG_VARIANCE_RANGE = (-6.0, 6.0)


class ContextEncoder(nn.Module):
    def __init__(self, feature_count: int, hidden_size: int, latent_dimension: int) -> None:
        super().__init__()
        self.latent_dimension = int(latent_dimension)
        self.body = perceptron(int(feature_count) + 2, hidden_size, 2, 2 * self.latent_dimension)

    def forward(self, inputs: torch.Tensor, move: torch.Tensor, cost: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """Posterior mean and variance (each (latent,)) from N transitions."""
        if inputs.shape[0] == 0:
            zeros = inputs.new_zeros(self.latent_dimension)
            return zeros, zeros + 1.0
        output = self.body(torch.cat([inputs, move[:, None], cost[:, None]], dim=-1))
        means = output[:, :self.latent_dimension]
        precisions = torch.exp(-output[:, self.latent_dimension:].clamp(*LOG_VARIANCE_RANGE))
        variance = 1.0 / (1.0 + precisions.sum(0))
        return variance * (means * precisions).sum(0), variance


class ProbabilisticContextActorCritic(Mechanism):
    def __init__(self, key, parameters, seed, task, feature_count) -> None:
        super().__init__(key, parameters, seed, task, feature_count)
        p = self.parameters
        hidden, latent = int(p["hidden_size"]), int(p["latent_dimension"])
        self.latent = latent
        self.interval = int(p["adaptation_interval_bars"])
        self.context_count = int(p["context_bars"])
        features = self.feature_count
        self.encoder = seeded(self.seed + 1, lambda: ContextEncoder(features, hidden, latent))
        self.actor = seeded(self.seed + 2, lambda: perceptron(features + latent, hidden, 2, 2))
        self.critics = nn.ModuleList([seeded(self.seed + 3 + number, lambda: perceptron(features + latent, hidden, 2, 2))
                                      for number in range(2)])

    # ── the task posterior of a block ──
    def _posterior(self, features: np.ndarray, anchor: int, first_row: int):
        rows = context_rows(self.view, features, anchor, self.context_count, first_row)
        move, cost = move_and_cost(realised_rewards(self.view, rows))
        return self.encoder(as_tensor(features[rows]), as_tensor(move), as_tensor(cost))

    def _latent_mean(self, features: np.ndarray, anchor: int, first_row: int) -> torch.Tensor:
        key = (int(anchor), int(first_row))
        if key not in self.cache:
            with torch.no_grad():
                self.cache[key] = self._posterior(features, anchor, first_row)[0]
        return self.cache[key]

    def _actor(self, inputs: torch.Tensor, latent: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        output = self.actor(torch.cat([inputs, latent.expand(inputs.shape[0], -1)], dim=-1))
        return output[:, 0], output[:, 1].clamp(*LOG_STANDARD_DEVIATION_RANGE)

    def _gaussian(self, features: np.ndarray, rows: np.ndarray, first_row: int = 0) -> tuple[np.ndarray, np.ndarray]:
        rows = np.asarray(rows, dtype=np.int64)
        mean = np.full(rows.size, np.nan)
        deviation = np.full(rows.size, np.nan)
        usable = np.all(np.isfinite(features[rows]), axis=1)
        anchors = (rows // self.interval) * self.interval
        for anchor in np.unique(anchors[usable]):
            positions = np.flatnonzero(usable & (anchors == anchor))
            latent = self._latent_mean(features, int(anchor), first_row)
            with torch.no_grad():
                mu, log_deviation = self._actor(as_tensor(features[rows[positions]]), latent[None, :])
            mean[positions] = mu.numpy()
            deviation[positions] = np.exp(log_deviation.numpy())
        return mean, deviation

    @staticmethod
    def _probability_up(mean: np.ndarray, deviation: np.ndarray) -> np.ndarray:
        with np.errstate(invalid="ignore", divide="ignore"):
            out = np.asarray(ndtr(mean / deviation), dtype=np.float64)
        out[~(np.isfinite(mean) & np.isfinite(deviation))] = np.nan
        return out

    def predict(self, features, rows) -> np.ndarray:
        self.require_view()
        return self._probability_up(*self._gaussian(features, rows))

    # ── fitting ──
    def fit(self, features, labels, train_index, validation_index, reporter) -> dict:
        p = self.parameters
        train = np.asarray(train_index, dtype=np.int64)
        validation = np.asarray(validation_index, dtype=np.int64)
        first = int(train[0])
        rewards = tape_rewards(self.view, train, train)
        rows = finite_rows(features, train, rewards)
        reward_by_row = {int(row): position for position, row in enumerate(train)}
        tasks = []
        for anchor, block in group_by_anchor(rows, self.interval):
            move, cost = move_and_cost(rewards[[reward_by_row[int(row)] for row in block]])
            context = context_rows(self.view, features, anchor, self.context_count, first)
            context_move, context_cost = move_and_cost(realised_rewards(self.view, context))
            tasks.append({"rows": block, "inputs": as_tensor(features[block]), "move": as_tensor(move),
                          "cost": as_tensor(cost), "context": (as_tensor(features[context]), as_tensor(context_move),
                                                               as_tensor(context_cost))})
        if not tasks:
            raise ValueError(f"{self.key}: no training bar has a known tape reward")
        rate = float(p["learning_rate"])
        critic_optimizer = torch.optim.Adam([*self.encoder.parameters(), *self.critics.parameters()], lr=rate)
        actor_optimizer = torch.optim.Adam(self.actor.parameters(), lr=rate)
        divergence_weight = float(p["latent_divergence_weight"])
        alpha = float(p["entropy_coefficient"])
        rows_per_step = int(p["batch_size"])
        reporter.log(f"{self.key}: {len(tasks)} tasks (blocks of {self.interval} bars), latent size {self.latent}")

        def train_epoch(epoch: int, report_batch) -> float:
            order = numpy_generator(self.seed, epoch).permutation(len(tasks))
            noise = torch_generator(self.seed, epoch)
            losses = []
            for number, index in enumerate(order, start=1):
                task = tasks[int(index)]
                losses.append(self._task_step(task, critic_optimizer, actor_optimizer, divergence_weight, alpha,
                                              rows_per_step, noise))
                report_batch(number, len(order), int(task["rows"][0]), int(task["rows"][-1]), losses[-1])
            return float(np.mean(losses))

        def validate(epoch: int):
            self.cache = {}
            mean, deviation = self._gaussian(features, validation, first)
            self.cache = {}
            return position_score(self._probability_up(mean, deviation), np.tanh(mean), np.asarray(labels)[validation],
                                  realised_rewards(self.view, validation))

        modules = (self.encoder, self.actor, self.critics)
        summary = run_epochs(reporter, epoch_count=int(p["epochs"]), train_index=train, train_epoch=train_epoch,
                             validate=validate if validation.size else None, snapshot=lambda: snapshot(*modules),
                             restore=lambda state: restore(state, *modules), patience=int(p["patience"]), name=self.key)
        self.cache = {}
        summary["task_count"] = len(tasks)
        return summary

    def _q(self, inputs: torch.Tensor, latent: torch.Tensor, action: torch.Tensor) -> list[torch.Tensor]:
        joined = torch.cat([inputs, latent.expand(inputs.shape[0], -1)], dim=-1)
        values = []
        for critic in self.critics:
            output = critic(joined)
            values.append(action * output[:, 0] - action.abs() * output[:, 1])
        return values

    def _task_step(self, task: dict, critic_optimizer, actor_optimizer, divergence_weight: float, alpha: float,
                   rows_per_step: int, noise: torch.Generator) -> float:
        inputs, move, cost = task["inputs"], task["move"], task["cost"]
        if inputs.shape[0] > rows_per_step:
            chosen = torch.randperm(inputs.shape[0], generator=noise)[:rows_per_step]
            inputs, move, cost = inputs[chosen], move[chosen], cost[chosen]
        count = inputs.shape[0]
        mean, variance = self.encoder(*task["context"])
        latent = (mean + variance.sqrt() * torch.randn(self.latent, generator=noise, dtype=mean.dtype))[None, :]
        divergence = 0.5 * (variance + mean ** 2 - 1.0 - variance.log()).sum()
        with torch.no_grad():
            mu, log_deviation = self._actor(inputs, latent.detach())
            policy_action = torch.tanh(mu + log_deviation.exp() * torch.randn(count, generator=noise, dtype=mu.dtype))
        random_action = torch.rand(count, generator=noise, dtype=mu.dtype) * 2.0 - 1.0
        actions = torch.cat([random_action, policy_action])
        doubled = torch.cat([inputs, inputs])
        reward = actions * torch.cat([move, move]) - actions.abs() * torch.cat([cost, cost])
        critic_loss = sum(((q - reward) ** 2).mean() for q in self._q(doubled, latent, actions)) \
            + divergence_weight * divergence
        critic_optimizer.zero_grad()
        critic_loss.backward()
        critic_optimizer.step()

        fixed = latent.detach()
        mu, log_deviation = self._actor(inputs, fixed)
        deviation = log_deviation.exp()
        raw = mu + deviation * torch.randn(count, generator=noise, dtype=mu.dtype)
        action = torch.tanh(raw)
        log_probability = (-0.5 * ((raw - mu) / deviation) ** 2 - log_deviation - 0.5 * math.log(2.0 * math.pi)
                           - torch.log(1.0 - action ** 2 + 1e-6))
        q_one, q_two = self._q(inputs, fixed, action)
        actor_loss = (alpha * log_probability - torch.minimum(q_one, q_two)).mean()
        actor_optimizer.zero_grad()
        actor_loss.backward()
        actor_optimizer.step()
        return float(critic_loss.detach())

    def state(self) -> dict:
        return {"encoder": module_state(self.encoder), "actor": module_state(self.actor),
                "critics": module_state(self.critics)}

    def load_state(self, state: dict) -> None:
        self.encoder.load_state_dict(state["encoder"])
        self.actor.load_state_dict(state["actor"])
        self.critics.load_state_dict(state["critics"])


__all__ = ["ContextEncoder", "ProbabilisticContextActorCritic"]
