"""HyperNetworks for RL: a hypernetwork writes the weights of the policy.

The network is the repository's hypernetwork block
(``cycle.networks_extra.hypernetwork.HypernetworkModule``, imported read-only):
its context is the per-feature mean and spread of the window of
``sequence_length`` bars ending at the bar, from which it GENERATES every
weight and bias of a one-hidden-layer target network (``target_hidden_size``
units) that reads the bar itself. Here that generated network is the policy:
its output is the logit of pi(long) in a {long, short} policy, so the regime
(the window) decides which policy is applied to the bar.

Training maximises the expected tape reward (next-open fills, round trip)
pi(long) * r(long) + pi(short) * r(short) plus the entropy bonus: both
actions' rewards are on the tape, so this IS the policy gradient, computed
exactly instead of from sampled actions, back-propagated through the generated
weights into the hypernetwork. Dropout is off (a bar's prediction must be
reproducible). P(up) = pi(long).
"""

from __future__ import annotations

import numpy as np
import torch

from cycle.adapters_extra.meta_agent.common import (
    LONG,
    SHORT,
    as_tensor,
    batches,
    finite_rows,
    module_state,
    numpy_generator,
    policy_score,
    realised_rewards,
    restore,
    seeded,
    snapshot,
    tape_rewards,
)
from cycle.adapters_extra.meta_agent.mechanism import Mechanism
from cycle.bridges.training import run_epochs
from cycle.networks_extra.hypernetwork import HypernetworkModule


class HypernetworkPolicy(Mechanism):
    def __init__(self, key, parameters, seed, task, feature_count) -> None:
        super().__init__(key, parameters, seed, task, feature_count)
        p = self.parameters
        self.length = int(p["sequence_length"])
        self.network = seeded(self.seed, lambda: HypernetworkModule(
            self.feature_count, int(p["hypernetwork_hidden_size"]), int(p["target_hidden_size"]),
            int(p["context_embedding_size"]), 0.0))

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return int(parameters["sequence_length"])

    def _windows(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        return features[rows[:, None] + np.arange(-self.length + 1, 1, dtype=np.int64)[None, :]]

    def _usable(self, features: np.ndarray, rows: np.ndarray, first_row: int = 0) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        keep = (rows - self.length + 1 >= first_row) & (rows < features.shape[0])
        keep[keep] = np.all(np.isfinite(self._windows(features, rows[keep])), axis=(1, 2))
        return keep

    def _long_probability(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        out = np.full(rows.size, np.nan)
        keep = self._usable(features, rows)
        if keep.any():
            self.network.eval()
            with torch.no_grad():
                out[keep] = torch.sigmoid(self.network(as_tensor(self._windows(features, rows[keep])))).numpy()
        return out

    def predict(self, features, rows) -> np.ndarray:
        return self._long_probability(features, rows)

    def fit(self, features, labels, train_index, validation_index, reporter) -> dict:
        p = self.parameters
        train = np.asarray(train_index, dtype=np.int64)
        validation = np.asarray(validation_index, dtype=np.int64)
        rewards = tape_rewards(self.view, train, train)
        reward_of = dict(zip(train.tolist(), rewards))
        rows = finite_rows(features, train, rewards)
        rows = rows[self._usable(features, rows)]
        if rows.size < 2:
            raise ValueError(f"{self.key}: no training bar has a full window of {self.length} bars and a tape reward")
        optimizer = torch.optim.Adam(self.network.parameters(), lr=float(p["learning_rate"]))
        entropy = float(p["entropy_coefficient"])
        reporter.log(f"{self.key}: the hypernetwork writes a {p['target_hidden_size']}-unit policy per bar, "
                     f"{rows.size} training bars")

        def train_epoch(epoch: int, report_batch) -> float:
            self.network.train()
            groups = batches(rows, int(p["batch_size"]), numpy_generator(self.seed, epoch))
            losses = []
            for number, group in enumerate(groups, start=1):
                table = np.stack([reward_of[int(row)] for row in group])
                logit = self.network(as_tensor(self._windows(features, group)))
                long = torch.sigmoid(logit)
                value = (long * as_tensor(table[:, LONG]) + (1.0 - long) * as_tensor(table[:, SHORT])).mean()
                spread = (torch.nn.functional.softplus(-logit) * long + torch.nn.functional.softplus(logit) * (1.0 - long)).mean()
                loss = -(value + entropy * spread)
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                losses.append(float(loss.detach()))
                report_batch(number, len(groups), int(group.min()), int(group.max()), losses[-1])
            self.network.eval()
            return float(np.mean(losses))

        def validate(epoch: int):
            long = self._long_probability(features, validation)
            policy = np.column_stack([1.0 - long, np.zeros_like(long), long])
            return policy_score(policy, np.asarray(labels)[validation], realised_rewards(self.view, validation))

        summary = run_epochs(reporter, epoch_count=int(p["epochs"]), train_index=train, train_epoch=train_epoch,
                             validate=validate if validation.size else None,
                             snapshot=lambda: snapshot(self.network), restore=lambda state: restore(state, self.network),
                             patience=int(p["patience"]), name=self.key)
        self.network.eval()
        return summary

    def state(self) -> dict:
        return {"network": module_state(self.network)}

    def load_state(self, state: dict) -> None:
        self.network.load_state_dict(state["network"])
        self.network.eval()


__all__ = ["HypernetworkPolicy"]
