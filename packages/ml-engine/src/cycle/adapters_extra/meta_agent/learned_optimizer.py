"""Learning to learn by gradient descent by gradient descent (Andrychowicz et al.
2016): a recurrent network that is the optimiser of the trading policy.

- **The optimiser** g_phi is coordinatewise: one small two-layer LSTM, shared
  by every weight of the policy, reads that weight's gradient (preprocessed as
  in the paper, p = 10: (log|g| / p, sign g) when |g| >= e^-p, else
  (-1, e^p g)) and its own hidden state, and outputs the weight's update
  (times 0.1).
- **Meta-training**: each meta-update draws a block of ``task_block_bars``
  training bars and a freshly initialised policy (seeded), unrolls
  ``unroll_steps`` optimiser steps theta_{t+1} = theta_t + g_phi(grad L(theta_t)),
  and moves phi by Adam on the sum of the losses along the trajectory
  (gradients into the optimiser's input are detached, the paper's
  simplification). L is minus the expected tape reward of the policy (every
  action's reward is on the tape) minus the entropy bonus.
- **The trading policy** is then trained BY g_phi (no Adam), ``unroll_steps``
  steps per epoch on the whole training span, continuing from where the last
  epoch left it; the optimiser keeps learning in between, so each epoch is
  ``meta_iteration_count`` meta-updates followed by one stretch of policy fitting.

P(up) = pi(long) / (pi(long) + pi(short)) of the policy the learned optimiser fitted.
"""

from __future__ import annotations

import math

import numpy as np
import torch
from torch import nn
from torch.func import functional_call

from cycle.adapters_extra.meta_agent.common import (
    as_tensor,
    derived_seed,
    expected_reward_loss,
    finite_rows,
    group_by_anchor,
    module_state,
    numpy_generator,
    perceptron,
    policy_score,
    realised_rewards,
    seeded,
    softmax_numpy,
    tape_rewards,
    up_share,
)
from cycle.adapters_extra.meta_agent.mechanism import Mechanism
from cycle.bridges.training import run_epochs

PREPROCESSING = 10.0
OUTPUT_SCALE = 0.1
META_GRADIENT_CLIP = 1.0


class CoordinatewiseOptimizer(nn.Module):
    def __init__(self, hidden_size: int) -> None:
        super().__init__()
        self.hidden_size = int(hidden_size)
        self.first = nn.LSTMCell(2, self.hidden_size)
        self.second = nn.LSTMCell(self.hidden_size, self.hidden_size)
        self.output = nn.Linear(self.hidden_size, 1)

    @staticmethod
    def preprocess(gradient: torch.Tensor) -> torch.Tensor:
        magnitude = gradient.abs()
        large = magnitude >= math.exp(-PREPROCESSING)
        first = torch.where(large, torch.log(magnitude.clamp_min(1e-300)) / PREPROCESSING, -torch.ones_like(gradient))
        second = torch.where(large, torch.sign(gradient), math.exp(PREPROCESSING) * gradient)
        return torch.stack([first, second], dim=-1)

    def initial_state(self, count: int, dtype=torch.float64) -> tuple[torch.Tensor, ...]:
        zeros = torch.zeros(count, self.hidden_size, dtype=dtype)
        return zeros, zeros.clone(), zeros.clone(), zeros.clone()

    def forward(self, gradient: torch.Tensor, state: tuple[torch.Tensor, ...]):
        first_hidden, first_cell = self.first(self.preprocess(gradient), (state[0], state[1]))
        second_hidden, second_cell = self.second(first_hidden, (state[2], state[3]))
        return OUTPUT_SCALE * self.output(second_hidden)[:, 0], (first_hidden, first_cell, second_hidden, second_cell)


class LearnedOptimizerPolicy(Mechanism):
    def __init__(self, key, parameters, seed, task, feature_count) -> None:
        super().__init__(key, parameters, seed, task, feature_count)
        p = self.parameters
        self.template = self._fresh_policy(derived_seed(self.seed, 1))
        self.names = [name for name, _ in self.template.named_parameters()]
        self.shapes = [tuple(value.shape) for _, value in self.template.named_parameters()]
        self.sizes = [int(np.prod(shape)) for shape in self.shapes]
        self.weights = self._flatten(self.template)
        self.optimizer = seeded(self.seed + 5, lambda: CoordinatewiseOptimizer(int(p["optimizer_hidden_size"])))

    def _fresh_policy(self, seed: int) -> nn.Module:
        p = self.parameters
        return seeded(seed, lambda: perceptron(self.feature_count, int(p["hidden_size"]), int(p["layer_count"]), 3))

    @staticmethod
    def _flatten(module: nn.Module) -> torch.Tensor:
        return torch.cat([value.detach().reshape(-1) for value in module.parameters()]).clone()

    def _unflatten(self, flat: torch.Tensor) -> dict:
        pieces = torch.split(flat, self.sizes)
        return {name: piece.reshape(shape) for name, piece, shape in zip(self.names, pieces, self.shapes)}

    def _loss(self, flat: torch.Tensor, inputs: torch.Tensor, rewards: torch.Tensor) -> torch.Tensor:
        logits = functional_call(self.template, self._unflatten(flat), (inputs,))
        return expected_reward_loss(logits, rewards, float(self.parameters["entropy_coefficient"]))

    def _policy(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        out = np.full((rows.size, 3), np.nan)
        usable = np.all(np.isfinite(features[rows]), axis=1)
        if usable.any():
            with torch.no_grad():
                logits = functional_call(self.template, self._unflatten(self.weights), (as_tensor(features[rows[usable]]),))
            out[usable] = softmax_numpy(logits)
        return out

    def predict(self, features, rows) -> np.ndarray:
        return up_share(self._policy(features, rows))

    def fit(self, features, labels, train_index, validation_index, reporter) -> dict:
        p = self.parameters
        train = np.asarray(train_index, dtype=np.int64)
        validation = np.asarray(validation_index, dtype=np.int64)
        rewards = tape_rewards(self.view, train, train)
        rows = finite_rows(features, train, rewards)
        if rows.size < 2:
            raise ValueError(f"{self.key}: no training bar has a known tape reward")
        where = {int(row): position for position, row in enumerate(train)}
        blocks = []
        for _, block in group_by_anchor(rows, int(p["task_block_bars"])):
            if block.size >= 8:
                chosen = [where[int(row)] for row in block]
                blocks.append((block, as_tensor(features[block]), as_tensor(rewards[chosen])))
        if not blocks:
            raise ValueError(f"{self.key}: no training block of {p['task_block_bars']} bars has 8 usable bars")
        whole_inputs = as_tensor(features[rows])
        whole_rewards = as_tensor(rewards[[where[int(row)] for row in rows]])
        unroll = int(p["unroll_steps"])
        iterations = int(p["meta_iteration_count"])
        meta_optimizer = torch.optim.Adam(self.optimizer.parameters(), lr=float(p["learning_rate"]))
        policy_state = self.optimizer.initial_state(int(self.weights.numel()))
        reporter.log(f"{self.key}: a coordinatewise LSTM optimiser for {int(self.weights.numel())} policy weights, "
                     f"{len(blocks)} meta-training blocks")

        def train_epoch(epoch: int, report_batch) -> float:
            nonlocal policy_state
            generator = numpy_generator(self.seed, epoch)
            for iteration in range(1, iterations + 1):
                block, inputs, block_rewards = blocks[int(generator.integers(len(blocks)))]
                meta_loss = self._meta_update(inputs, block_rewards, unroll, meta_optimizer,
                                              derived_seed(self.seed, epoch, iteration))
                report_batch(iteration, iterations + 1, int(block[0]), int(block[-1]), meta_loss)
            loss, policy_state = self._fit_policy(whole_inputs, whole_rewards, unroll, policy_state)
            report_batch(iterations + 1, iterations + 1, int(rows[0]), int(rows[-1]), loss)
            return loss

        def validate(epoch: int):
            return policy_score(self._policy(features, validation), np.asarray(labels)[validation],
                                realised_rewards(self.view, validation))

        def take_snapshot():
            return self.weights.clone(), {name: value.clone() for name, value in self.optimizer.state_dict().items()}

        def put_back(state) -> None:
            self.weights = state[0].clone()
            self.optimizer.load_state_dict(state[1])

        summary = run_epochs(reporter, epoch_count=int(p["epochs"]), train_index=train, train_epoch=train_epoch,
                             validate=validate if validation.size else None, snapshot=take_snapshot, restore=put_back,
                             patience=int(p["patience"]), name=self.key)
        summary["policy_weight_count"] = int(self.weights.numel())
        return summary

    def _meta_update(self, inputs, rewards, unroll: int, meta_optimizer, seed: int) -> float:
        weights = self._flatten(self._fresh_policy(seed)).requires_grad_(True)
        state = self.optimizer.initial_state(int(weights.numel()))
        total = weights.new_zeros(())
        for _ in range(unroll):
            loss = self._loss(weights, inputs, rewards)
            gradient = torch.autograd.grad(loss, weights, retain_graph=True)[0].detach()
            update, state = self.optimizer(gradient, state)
            weights = weights + update
            total = total + self._loss(weights, inputs, rewards)
        meta_loss = total / unroll
        meta_optimizer.zero_grad()
        meta_loss.backward()
        nn.utils.clip_grad_norm_(self.optimizer.parameters(), META_GRADIENT_CLIP)
        meta_optimizer.step()
        return float(meta_loss.detach())

    def _fit_policy(self, inputs, rewards, unroll: int, state):
        weights = self.weights.clone()
        loss_value = math.nan
        for _ in range(unroll):
            leaf = weights.detach().requires_grad_(True)
            loss = self._loss(leaf, inputs, rewards)
            gradient = torch.autograd.grad(loss, leaf)[0].detach()
            with torch.no_grad():
                update, state = self.optimizer(gradient, state)
                weights = leaf.detach() + update
            loss_value = float(loss.detach())
        self.weights = weights.detach()
        return loss_value, tuple(value.detach() for value in state)

    def state(self) -> dict:
        return {"policy_weights": self.weights.detach().clone(), "optimizer": module_state(self.optimizer)}

    def load_state(self, state: dict) -> None:
        self.weights = state["policy_weights"].to(torch.float64)
        self.optimizer.load_state_dict(state["optimizer"])


__all__ = ["CoordinatewiseOptimizer", "LearnedOptimizerPolicy"]
