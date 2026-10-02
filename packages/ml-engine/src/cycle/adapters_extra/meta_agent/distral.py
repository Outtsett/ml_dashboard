"""Multitask RL with a shared latent policy: Distral (Teh et al. 2017).

Tasks are regimes: k-means (``cluster_count`` clusters, fitted on the training
span only) over four standardised causal statistics of the bars up to each bar
(log volatility over 20 and ``history_bars`` bars, the trend t-statistic, the
up-bar share; ``common.regime_statistics``). Each regime i has its own policy
pi_i over {short, flat, long}; one shared policy pi_0 is distilled from all of
them. Per bar of regime i the task policy maximises

    sum_a pi_i(a | s) * [ r(s, a) - distillation_weight * (log pi_i(a | s) - log pi_0(a | s))
                          - entropy_coefficient * log pi_i(a | s) ]

(the expected tape reward, next-open fills and a round trip, minus the
divergence from the shared policy, plus entropy), and pi_0 minimises the
cross-entropy of the task policies' action distributions over the pooled bars
(distillation). Both are trained together by Adam; every action's reward is
on the tape, so the expectation is exact.

At prediction the bar's regime is assigned from its own statistics (bars up to
it) and P(up) = pi_regime(long) / (pi_regime(long) + pi_regime(short)); a
regime with fewer than ``MINIMUM_REGIME_BARS`` training bars uses pi_0.
"""

from __future__ import annotations

import numpy as np
import torch
from torch import nn

from cycle.adapters_extra.meta_agent.common import (
    as_tensor,
    batches,
    finite_rows,
    module_state,
    numpy_generator,
    perceptron,
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
from cycle.adapters_extra.meta_agent.task_embedding import RegimeStatistics
from cycle.bridges.binning import ClusterStates
from cycle.bridges.training import run_epochs

REGIME_COLUMNS = (0, 1, 2, 3)          # volatility, volatility, trend, up-bar share (not the clock)
MINIMUM_REGIME_BARS = 30


class DistralPolicies(Mechanism):
    def __init__(self, key, parameters, seed, task, feature_count) -> None:
        super().__init__(key, parameters, seed, task, feature_count)
        p = self.parameters
        self.cluster_count = int(p["cluster_count"])
        hidden, layers = int(p["hidden_size"]), int(p["layer_count"])
        self.statistics = RegimeStatistics(int(p["history_bars"]))
        self.policies = nn.ModuleList([seeded(self.seed + 10 + number,
                                              lambda: perceptron(self.feature_count, hidden, layers, 3))
                                       for number in range(self.cluster_count + 1)])     # the last one is pi_0
        self.regimes: ClusterStates | None = None
        self.regime_counts = np.zeros(self.cluster_count, dtype=np.int64)

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return int(parameters["history_bars"])

    def _codes(self, rows: np.ndarray) -> np.ndarray:
        """The regime of each row (-1 for pi_0: unassignable or too rare in training)."""
        matrix = self.statistics(self, rows)[:, list(REGIME_COLUMNS)]
        codes = self.regimes.assign(matrix, np.arange(rows.size))
        rare = np.zeros(codes.shape, dtype=bool)
        rare[codes >= 0] = self.regime_counts[codes[codes >= 0]] < MINIMUM_REGIME_BARS
        codes[rare] = -1
        return codes

    def _logits(self, inputs: torch.Tensor, codes: np.ndarray) -> tuple[torch.Tensor, torch.Tensor]:
        """The acting policy's logits (the regime's, or pi_0's) and pi_0's."""
        shared = self.policies[-1](inputs)
        acting = shared.clone()
        for code in np.unique(codes[codes >= 0]):
            chosen = torch.as_tensor(np.flatnonzero(codes == code))
            acting = acting.index_copy(0, chosen, self.policies[int(code)](inputs[chosen]))
        return acting, shared

    def _policy(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        out = np.full((rows.size, 3), np.nan)
        usable = np.all(np.isfinite(features[rows]), axis=1)
        if usable.any():
            with torch.no_grad():
                acting, _ = self._logits(as_tensor(features[rows[usable]]), self._codes(rows[usable]))
            out[usable] = softmax_numpy(acting)
        return out

    def predict(self, features, rows) -> np.ndarray:
        self.require_view()
        return up_share(self._policy(features, rows))

    def fit(self, features, labels, train_index, validation_index, reporter) -> dict:
        p = self.parameters
        train = np.asarray(train_index, dtype=np.int64)
        validation = np.asarray(validation_index, dtype=np.int64)
        rewards = tape_rewards(self.view, train, train)
        rows = finite_rows(features, train, rewards)
        if rows.size < self.cluster_count:
            raise ValueError(f"{self.key}: {rows.size} usable training bars cannot make {self.cluster_count} regimes")
        reward_of = dict(zip(train.tolist(), rewards))
        self.statistics.fit(self, rows)
        matrix = self.statistics(self, rows)[:, list(REGIME_COLUMNS)]
        self.regimes = ClusterStates.fit(matrix, np.arange(rows.size), self.cluster_count, self.seed)
        assigned = self.regimes.assign(matrix, np.arange(rows.size))
        self.regime_counts = np.bincount(assigned[assigned >= 0], minlength=self.cluster_count).astype(np.int64)
        reporter.log(f"{self.key}: {self.cluster_count} regimes with "
                     + ", ".join(str(int(count)) for count in self.regime_counts) + " training bars")
        optimizer = torch.optim.Adam(self.policies.parameters(), lr=float(p["learning_rate"]))
        distillation = float(p["distillation_weight"])
        entropy = float(p["entropy_coefficient"])

        def train_epoch(epoch: int, report_batch) -> float:
            groups = batches(rows, int(p["batch_size"]), numpy_generator(self.seed, epoch))
            losses = []
            for number, group in enumerate(groups, start=1):
                table = as_tensor(np.stack([reward_of[int(row)] for row in group]))
                acting, shared = self._logits(as_tensor(features[group]), self._codes(group))
                log_task = torch.log_softmax(acting, dim=-1)
                log_shared = torch.log_softmax(shared, dim=-1)
                task = log_task.exp()
                objective = (task * (table - distillation * (log_task - log_shared.detach())
                                     - entropy * log_task)).sum(-1).mean()
                distilled = -(task.detach() * log_shared).sum(-1).mean()
                loss = -objective + distilled
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                losses.append(float(loss.detach()))
                report_batch(number, len(groups), int(group.min()), int(group.max()), losses[-1])
            return float(np.mean(losses))

        def validate(epoch: int):
            return policy_score(self._policy(features, validation), np.asarray(labels)[validation],
                                realised_rewards(self.view, validation))

        summary = run_epochs(reporter, epoch_count=int(p["epochs"]), train_index=train, train_epoch=train_epoch,
                             validate=validate if validation.size else None, snapshot=lambda: snapshot(self.policies),
                             restore=lambda state: restore(state, self.policies), patience=int(p["patience"]),
                             name=self.key)
        summary["regime_bar_counts"] = [int(count) for count in self.regime_counts]
        return summary

    def state(self) -> dict:
        return {"policies": module_state(self.policies), "statistics": self.statistics.state(),
                "regime_centers": torch.as_tensor(self.regimes.centers),
                "regime_columns": [int(column) for column in self.regimes.columns],
                "regime_counts": torch.as_tensor(self.regime_counts)}

    def load_state(self, state: dict) -> None:
        self.policies.load_state_dict(state["policies"])
        self.statistics.load(state["statistics"])
        self.regimes = ClusterStates(state["regime_centers"].numpy().astype(np.float64),
                                     [int(column) for column in state["regime_columns"]])
        self.regime_counts = state["regime_counts"].numpy().astype(np.int64)


__all__ = ["DistralPolicies"]
