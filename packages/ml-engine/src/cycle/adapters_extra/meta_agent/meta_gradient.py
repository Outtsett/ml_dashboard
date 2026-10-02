"""Meta policy gradient (Xu, van Hasselt and Silver 2018, "Meta-Gradient
Reinforcement Learning"): an actor-critic whose return is itself learned.

The return the agent learns from has meta-parameters eta:

    G_eta(s, a) = p(a) * sum_{k < h} gamma_eta^k * d_k(s) - |p(a)| * c(s) + r_eta(s, a)

where d_k(s) is the scaled open-to-open move of the k-th bar held (the tape's
next-open fill split bar by bar, FIT ONLY), c(s) the scaled round trip, p(a)
the position of action a in {short, flat, long}, gamma_eta = sigmoid(logit) the
learned discount over the holding bars and r_eta(s, a) a learned auxiliary
reward (a linear map of the features, starting at zero).

The training span is cut into chronological blocks of ``task_block_bars``
bars. For each consecutive pair (b, b + 1), online as the spec's
cross-validation:

1. inner step on block b: theta' = theta + alpha * grad_theta J(theta; eta),
   J the actor-critic objective mean(log pi(a) * (G_eta(s, a) - V(s))) over
   ``action_sample_count`` seeded sampled actions per bar, plus the entropy
   bonus; the graph of this step is kept;
2. outer step on block b + 1: the TRUE objective (the expected extrinsic tape
   reward of theta', gamma = 1, no auxiliary reward) is differentiated through
   theta' with respect to eta, and Adam moves eta;
3. the critic V regresses the sampled returns; theta <- theta'.

P(up) = pi(long) / (pi(long) + pi(short)) of the final policy; there is no
test-time adaptation (the meta-parameters shape training only).
"""

from __future__ import annotations

import math

import numpy as np
import torch
from torch import nn
from torch.func import functional_call

from cycle.adapters_extra.meta_agent.common import (
    POSITIONS,
    as_tensor,
    expected_reward_loss,
    finite_rows,
    group_by_anchor,
    module_state,
    perceptron,
    policy_score,
    realised_rewards,
    restore,
    seeded,
    snapshot,
    softmax_numpy,
    tape_rewards,
    torch_generator,
    up_share,
)
from cycle.adapters_extra.meta_agent.mechanism import Mechanism
from cycle.bridges.tape import RewardTape
from cycle.bridges.training import run_epochs


class MetaParameters(nn.Module):
    def __init__(self, feature_count: int, discount: float) -> None:
        super().__init__()
        discount = min(max(float(discount), 1e-3), 1.0 - 1e-3)
        self.discount_logit = nn.Parameter(torch.tensor(math.log(discount / (1.0 - discount))))
        self.auxiliary = nn.Linear(int(feature_count), 3)
        with torch.no_grad():
            self.auxiliary.weight.zero_()
            self.auxiliary.bias.zero_()

    def discount(self) -> torch.Tensor:
        return torch.sigmoid(self.discount_logit)


class MetaGradientActorCritic(Mechanism):
    def __init__(self, key, parameters, seed, task, feature_count) -> None:
        super().__init__(key, parameters, seed, task, feature_count)
        p = self.parameters
        hidden, layers = int(p["hidden_size"]), int(p["layer_count"])
        self.policy = seeded(self.seed + 1, lambda: perceptron(self.feature_count, hidden, layers, 3))
        self.critic = seeded(self.seed + 2, lambda: perceptron(self.feature_count, hidden, layers, 1))
        self.meta = seeded(self.seed + 3, lambda: MetaParameters(self.feature_count, float(p["discount_factor"])))

    def _policy(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        out = np.full((rows.size, 3), np.nan)
        usable = np.all(np.isfinite(features[rows]), axis=1)
        if usable.any():
            with torch.no_grad():
                out[usable] = softmax_numpy(self.policy(as_tensor(features[rows[usable]])))
        return out

    def predict(self, features, rows) -> np.ndarray:
        return up_share(self._policy(features, rows))

    def _holding_moves(self, tape: RewardTape, rows: np.ndarray) -> np.ndarray:
        """(n, h) scaled open-to-open move of each held bar (see the module docstring)."""
        horizon = int(tape.holding_bars)
        steps = rows[:, None] + 1 + np.arange(horizon)[None, :]
        with np.errstate(invalid="ignore", divide="ignore"):
            return (tape.open[steps + 1] - tape.open[steps]) / tape.move_scale[rows][:, None]

    def fit(self, features, labels, train_index, validation_index, reporter) -> dict:
        p = self.parameters
        train = np.asarray(train_index, dtype=np.int64)
        validation = np.asarray(validation_index, dtype=np.int64)
        tape = RewardTape.from_view(self.view, train)
        extrinsic = tape_rewards(self.view, train, train)
        rows = finite_rows(features, train, extrinsic)
        where = {int(row): position for position, row in enumerate(train)}
        blocks = []
        for _, block in group_by_anchor(rows, int(p["task_block_bars"])):
            chosen = np.array([where[int(row)] for row in block])
            with np.errstate(invalid="ignore", divide="ignore"):
                cost = tape.round_trip_cost_points / tape.move_scale[block]
            blocks.append({"rows": block, "inputs": as_tensor(features[block]),
                           "moves": as_tensor(self._holding_moves(tape, block)), "cost": as_tensor(cost),
                           "extrinsic": as_tensor(extrinsic[chosen])})
        if len(blocks) < 2:
            raise ValueError(f"{self.key}: the training span holds {len(blocks)} block(s) of "
                             f"{p['task_block_bars']} bars; the meta-gradient needs two consecutive blocks")
        step_size = float(p["learning_rate"])
        entropy = float(p["entropy_coefficient"])
        samples = max(1, int(p["action_sample_count"]))
        meta_optimizer = torch.optim.Adam(self.meta.parameters(), lr=float(p["meta_learning_rate"]))
        critic_optimizer = torch.optim.Adam(self.critic.parameters(), lr=float(p["meta_learning_rate"]) * 3.0)
        positions = as_tensor(POSITIONS)
        reporter.log(f"{self.key}: {len(blocks)} blocks, discount starts at {float(self.meta.discount().detach()):.3f}")

        def train_epoch(epoch: int, report_batch) -> float:
            noise = torch_generator(self.seed, epoch)
            losses = []
            for number in range(1, len(blocks)):
                inner, outer = blocks[number - 1], blocks[number]
                losses.append(self._pair_step(inner, outer, positions, step_size, entropy, samples, noise,
                                              meta_optimizer, critic_optimizer))
                report_batch(number, len(blocks) - 1, int(inner["rows"][0]), int(outer["rows"][-1]), losses[-1])
            return float(np.mean(losses))

        def validate(epoch: int):
            return policy_score(self._policy(features, validation), np.asarray(labels)[validation],
                                realised_rewards(self.view, validation))

        modules = (self.policy, self.critic, self.meta)
        summary = run_epochs(reporter, epoch_count=int(p["epochs"]), train_index=train, train_epoch=train_epoch,
                             validate=validate if validation.size else None, snapshot=lambda: snapshot(*modules),
                             restore=lambda state: restore(state, *modules), patience=int(p["patience"]), name=self.key)
        summary["learned_discount"] = float(self.meta.discount().detach())
        summary["block_count"] = len(blocks)
        reporter.log(f"{self.key}: learned discount {summary['learned_discount']:.3f}")
        return summary

    def _pair_step(self, inner: dict, outer: dict, positions: torch.Tensor, step_size: float, entropy: float,
                   samples: int, noise: torch.Generator, meta_optimizer, critic_optimizer) -> float:
        parameters = {name: value.detach().clone().requires_grad_(True) for name, value in self.policy.named_parameters()}
        inputs = inner["inputs"]
        horizon = inner["moves"].shape[1]
        discount = self.meta.discount()
        weights = discount ** torch.arange(horizon, dtype=inputs.dtype)
        held = (inner["moves"] * weights[None, :]).sum(-1)                         # (n,)
        auxiliary = self.meta.auxiliary(inputs)                                     # (n, 3)
        logits = functional_call(self.policy, parameters, (inputs,))
        log_policy = torch.log_softmax(logits, dim=-1)
        actions = torch.multinomial(log_policy.detach().exp(), samples, replacement=True, generator=noise)  # (n, S)
        position = positions[actions]
        returns = position * held[:, None] - position.abs() * inner["cost"][:, None] + auxiliary.gather(1, actions)
        value = self.critic(inputs)[:, 0]
        advantage = returns - value.detach()[:, None]
        spread = -(log_policy.exp() * log_policy).sum(-1).mean()
        objective = (log_policy.gather(1, actions) * advantage).mean() + entropy * spread
        gradients = torch.autograd.grad(objective, list(parameters.values()), create_graph=True)
        adapted = {name: value + step_size * gradient for (name, value), gradient in zip(parameters.items(), gradients)}
        outer_loss = expected_reward_loss(functional_call(self.policy, adapted, (outer["inputs"],)), outer["extrinsic"], 0.0)
        meta_gradients = torch.autograd.grad(outer_loss, list(self.meta.parameters()), allow_unused=True)
        meta_optimizer.zero_grad()
        for parameter, gradient in zip(self.meta.parameters(), meta_gradients):
            parameter.grad = None if gradient is None else gradient.detach()
        meta_optimizer.step()
        critic_loss = ((value - returns.detach().mean(1)) ** 2).mean()
        critic_optimizer.zero_grad()
        critic_loss.backward()
        critic_optimizer.step()
        with torch.no_grad():
            for name, parameter in self.policy.named_parameters():
                parameter.copy_(adapted[name].detach())
        return float(outer_loss.detach())

    def state(self) -> dict:
        return {"policy": module_state(self.policy), "critic": module_state(self.critic), "meta": module_state(self.meta)}

    def load_state(self, state: dict) -> None:
        self.policy.load_state_dict(state["policy"])
        self.critic.load_state_dict(state["critic"])
        self.meta.load_state_dict(state["meta"])


__all__ = ["MetaGradientActorCritic", "MetaParameters"]
