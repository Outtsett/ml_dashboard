"""RL^2 (Duan et al. 2016; Wang et al. 2016): a recurrent policy whose hidden
state is the learning algorithm.

At every step s of a window of ``sequence_length`` bars ending at the bar being
scored, a GRU cell reads the bar's features together with what the agent
itself did h bars earlier and what that did: its expected position
pi(long) - pi(short) at step s - h and the reward that position has REALISED by
step s (the price target of row s - h, known at s because (s - h) + h = s),
plus a flag saying whether that reward is known (outside the window, across a
session gap). The hidden state therefore accumulates evidence about how its
own recent calls have paid, which is the "fast" learning RL^2 is about; the
"slow" learning is the training of the GRU's weights.

Training maximises the expected tape reward (next-open fills, round trip) of
every step of every training window, differentiating through the recursion
(the expected position fed back is a function of the weights). Every action's
reward is on the tape, so the expected reward sum_a pi(a) r(a) is maximised
exactly instead of estimated by PPO's sampled actions. The hidden state
restarts at every window (a prediction must not depend on how many bars were
scored before it), so a "trial" is one window.

P(up) = pi(long) / (pi(long) + pi(short)) at the window's last step.
"""

from __future__ import annotations

import numpy as np
import torch
from torch import nn

from cycle.adapters_extra.meta_agent.common import (
    LONG,
    SHORT,
    as_tensor,
    batches,
    module_state,
    numpy_generator,
    policy_score,
    realised_rewards,
    restore,
    seeded,
    snapshot,
    softmax_numpy,
    tape_rewards,
    up_share,
)
from cycle.adapters_extra.meta_agent.mechanism import Mechanism
from cycle.bridges.training import run_epochs

FEEDBACK_INPUTS = 3      # previous expected position, its realised reward, known flag


class RecurrentPolicyNetwork(nn.Module):
    def __init__(self, feature_count: int, hidden_size: int) -> None:
        super().__init__()
        self.hidden_size = int(hidden_size)
        self.cell = nn.GRUCell(int(feature_count) + FEEDBACK_INPUTS, self.hidden_size)
        self.head = nn.Linear(self.hidden_size, 3)

    def forward(self, inputs: torch.Tensor, move: torch.Tensor, cost: torch.Tensor, known: torch.Tensor,
                horizon: int) -> torch.Tensor:
        """``inputs`` (B, L, F); ``move`` / ``cost`` / ``known`` (B, L): the realised
        scaled move and cost of each window row (zero where unknown). Returns the
        (B, L, 3) logits of every step."""
        batch, length, _ = inputs.shape
        hidden = inputs.new_zeros(batch, self.hidden_size)
        positions: list[torch.Tensor] = []
        exposures: list[torch.Tensor] = []
        logits: list[torch.Tensor] = []
        empty = inputs.new_zeros(batch, FEEDBACK_INPUTS)
        for step in range(length):
            earlier = step - int(horizon)
            if earlier >= 0:
                flag = known[:, earlier]
                reward = positions[earlier] * move[:, earlier] - exposures[earlier] * cost[:, earlier]
                feedback = torch.stack([positions[earlier] * flag, reward * flag, flag], dim=-1)
            else:
                feedback = empty
            hidden = self.cell(torch.cat([inputs[:, step], feedback], dim=-1), hidden)
            output = self.head(hidden)
            policy = torch.softmax(output, dim=-1)
            positions.append(policy[:, LONG] - policy[:, SHORT])
            exposures.append(policy[:, LONG] + policy[:, SHORT])
            logits.append(output)
        return torch.stack(logits, dim=1)


class RecurrentMetaPolicy(Mechanism):
    def __init__(self, key, parameters, seed, task, feature_count) -> None:
        super().__init__(key, parameters, seed, task, feature_count)
        self.length = int(self.parameters["sequence_length"])
        self.network = seeded(self.seed, lambda: RecurrentPolicyNetwork(self.feature_count,
                                                                          int(self.parameters["hidden_size"])))

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return int(parameters["sequence_length"])

    def _inputs(self, features: np.ndarray, rows: np.ndarray):
        """(windows, move, cost, known) tensors for windows ending at ``rows``
        (every row must have row - L + 1 >= 0)."""
        offsets = np.arange(-self.length + 1, 1, dtype=np.int64)
        index = rows[:, None] + offsets[None, :]
        realised = realised_rewards(self.view, index.reshape(-1)).reshape(index.shape[0], self.length, 3)
        move = (realised[..., LONG] - realised[..., SHORT]) / 2.0
        cost = -(realised[..., LONG] + realised[..., SHORT]) / 2.0
        known = np.isfinite(move) & np.isfinite(cost)
        return (as_tensor(features[index]), as_tensor(np.where(known, move, 0.0)),
                as_tensor(np.where(known, cost, 0.0)), as_tensor(known.astype(np.float64)))

    def _usable(self, features: np.ndarray, rows: np.ndarray, first_row: int = 0) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        start = rows - self.length + 1
        keep = (start >= first_row) & (rows < features.shape[0])
        keep[keep] = np.all(np.isfinite(features[rows[keep][:, None] + np.arange(-self.length + 1, 1)]), axis=(1, 2))
        return keep

    def _policy(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        out = np.full((rows.size, 3), np.nan)
        keep = self._usable(features, rows)
        if keep.any():
            with torch.no_grad():
                logits = self.network(*self._inputs(features, rows[keep]), int(self.view.horizon))
            out[keep] = softmax_numpy(logits[:, -1])
        return out

    def predict(self, features, rows) -> np.ndarray:
        self.require_view()
        return up_share(self._policy(features, rows))

    def fit(self, features, labels, train_index, validation_index, reporter) -> dict:
        p = self.parameters
        train = np.asarray(train_index, dtype=np.int64)
        validation = np.asarray(validation_index, dtype=np.int64)
        first, last = int(train[0]), int(train[-1])
        span = np.arange(first, last + 1, dtype=np.int64)
        tape = tape_rewards(self.view, train, span)            # by row - first
        ends = train[self._usable(features, train, first)]
        if ends.size == 0:
            raise ValueError(f"{self.key}: no training window of {self.length} bars inside the training span")
        horizon = int(self.view.horizon)
        optimizer = torch.optim.Adam(self.network.parameters(), lr=float(p["learning_rate"]))
        entropy = float(p["entropy_coefficient"])
        offsets = np.arange(-self.length + 1, 1, dtype=np.int64)
        reporter.log(f"{self.key}: {ends.size} training windows of {self.length} bars")

        def train_epoch(epoch: int, report_batch) -> float:
            generator = numpy_generator(self.seed, epoch)
            groups = batches(ends, int(p["batch_size"]), generator)
            losses = []
            for number, group in enumerate(groups, start=1):
                rewards = tape[(group[:, None] + offsets[None, :]) - first]           # (B, L, 3)
                known = np.all(np.isfinite(rewards), axis=-1)
                logits = self.network(*self._inputs(features, group), horizon)
                mask = as_tensor(known.astype(np.float64))
                rewards_tensor = as_tensor(np.where(known[..., None], rewards, 0.0))
                log_policy = torch.log_softmax(logits, dim=-1)
                policy = log_policy.exp()
                value = ((policy * rewards_tensor).sum(-1) * mask).sum() / mask.sum().clamp_min(1.0)
                spread = (-(policy * log_policy).sum(-1) * mask).sum() / mask.sum().clamp_min(1.0)
                loss = -(value + entropy * spread)
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                losses.append(float(loss.detach()))
                report_batch(number, len(groups), int(group.min()), int(group.max()), losses[-1])
            return float(np.mean(losses))

        def validate(epoch: int):
            policy = self._policy(features, validation)
            return policy_score(policy, np.asarray(labels)[validation], realised_rewards(self.view, validation))

        summary = run_epochs(reporter, epoch_count=int(p["epochs"]), train_index=train, train_epoch=train_epoch,
                             validate=validate if validation.size else None,
                             snapshot=lambda: snapshot(self.network), restore=lambda state: restore(state, self.network),
                             patience=int(p["patience"]), name=self.key)
        summary["window_count"] = int(ends.size)
        return summary

    def state(self) -> dict:
        return {"network": module_state(self.network)}

    def load_state(self, state: dict) -> None:
        self.network.load_state_dict(state["network"])


__all__ = ["RecurrentMetaPolicy", "RecurrentPolicyNetwork"]
