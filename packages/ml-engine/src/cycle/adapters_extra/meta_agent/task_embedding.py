"""Task-aware meta-RL: a policy conditioned on an embedding of the task it is in.

With one instrument, the "task" is the market regime, described causally at
every bar by eight statistics of the bars up to it (``common.regime_statistics``:
log volatility over 20 and ``history_bars`` bars, the trend t-statistic, the
up-bar share, time of day and day of week), standardised with training-span
constants. A task encoder tau turns them into an embedding e; the actor
pi(a | s, e) over {short, flat, long} and the critic V(s, e) read the bar's
features next to it. Training is advantage actor-critic on the tape
(next-open fills, round trip): ``action_sample_count`` seeded actions per
bar, advantage = tape reward - V(s, e), plus the entropy bonus; the encoder
learns through both losses. Validation picks the epoch with the best net reward.

P(up) = pi(long) / (pi(long) + pi(short)).
"""

from __future__ import annotations

import numpy as np
import torch

from cycle.adapters_extra.meta_agent.common import (
    as_tensor,
    batches,
    finite_rows,
    fit_standardisation,
    module_state,
    numpy_generator,
    perceptron,
    policy_score,
    realised_rewards,
    regime_statistics,
    restore,
    seeded,
    snapshot,
    softmax_numpy,
    standardise,
    tape_rewards,
    torch_generator,
    up_share,
)
from cycle.adapters_extra.meta_agent.mechanism import Mechanism
from cycle.bridges.training import run_epochs

STATISTIC_COUNT = 8
VALUE_LOSS_WEIGHT = 0.5


class RegimeStatistics:
    """The standardised regime statistics of a bound view (returns cached per bind)."""

    def __init__(self, history_bars: int) -> None:
        self.history_bars = int(history_bars)
        self.centre = np.zeros(STATISTIC_COUNT)
        self.spread = np.ones(STATISTIC_COUNT)

    def raw(self, mechanism: Mechanism, rows: np.ndarray) -> np.ndarray:
        view = mechanism.require_view()
        if "returns" not in mechanism.cache:
            mechanism.cache["returns"] = view.one_bar_returns()
        return regime_statistics(mechanism.cache["returns"], view.timestamps, rows, self.history_bars)

    def fit(self, mechanism: Mechanism, rows: np.ndarray) -> None:
        self.centre, self.spread = fit_standardisation(self.raw(mechanism, rows))

    def __call__(self, mechanism: Mechanism, rows: np.ndarray) -> np.ndarray:
        return standardise(self.raw(mechanism, rows), self.centre, self.spread)

    def state(self) -> dict:
        return {"centre": torch.as_tensor(self.centre), "spread": torch.as_tensor(self.spread)}

    def load(self, state: dict) -> None:
        self.centre = state["centre"].numpy().astype(np.float64)
        self.spread = state["spread"].numpy().astype(np.float64)


class TaskAwareActorCritic(Mechanism):
    def __init__(self, key, parameters, seed, task, feature_count) -> None:
        super().__init__(key, parameters, seed, task, feature_count)
        p = self.parameters
        embedding, hidden, layers = int(p["task_embedding_size"]), int(p["hidden_size"]), int(p["layer_count"])
        self.statistics = RegimeStatistics(int(p["history_bars"]))
        self.encoder = seeded(self.seed + 1, lambda: perceptron(STATISTIC_COUNT, max(embedding, 4), 1, embedding))
        self.actor = seeded(self.seed + 2, lambda: perceptron(self.feature_count + embedding, hidden, layers, 3))
        self.critic = seeded(self.seed + 3, lambda: perceptron(self.feature_count + embedding, hidden, layers, 1))

    @classmethod
    def minimum_history(cls, parameters: dict) -> int:
        return int(parameters["history_bars"])

    def _joined(self, features: np.ndarray, rows: np.ndarray) -> torch.Tensor:
        embedding = torch.tanh(self.encoder(as_tensor(self.statistics(self, rows))))
        return torch.cat([as_tensor(features[rows]), embedding], dim=-1)

    def _policy(self, features: np.ndarray, rows: np.ndarray) -> np.ndarray:
        rows = np.asarray(rows, dtype=np.int64)
        out = np.full((rows.size, 3), np.nan)
        usable = np.all(np.isfinite(features[rows]), axis=1)
        if usable.any():
            with torch.no_grad():
                out[usable] = softmax_numpy(self.actor(self._joined(features, rows[usable])))
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
        if rows.size < 2:
            raise ValueError(f"{self.key}: no training bar has a known tape reward")
        reward_of = dict(zip(train.tolist(), rewards))
        self.statistics.fit(self, rows)
        modules = (self.encoder, self.actor, self.critic)
        optimizer = torch.optim.Adam([parameter for module in modules for parameter in module.parameters()],
                                     lr=float(p["learning_rate"]))
        samples = max(1, int(p["action_sample_count"]))
        entropy = float(p["entropy_coefficient"])
        reporter.log(f"{self.key}: task embedding of {STATISTIC_COUNT} regime statistics over "
                     f"{self.statistics.history_bars} bars, {rows.size} training bars")

        def train_epoch(epoch: int, report_batch) -> float:
            groups = batches(rows, int(p["batch_size"]), numpy_generator(self.seed, epoch))
            noise = torch_generator(self.seed, epoch)
            losses = []
            for number, group in enumerate(groups, start=1):
                table = as_tensor(np.stack([reward_of[int(row)] for row in group]))
                joined = self._joined(features, group)
                log_policy = torch.log_softmax(self.actor(joined), dim=-1)
                value = self.critic(joined)[:, 0]
                actions = torch.multinomial(log_policy.detach().exp(), samples, replacement=True, generator=noise)
                sampled = table.gather(1, actions)
                advantage = sampled - value.detach()[:, None]
                spread = -(log_policy.exp() * log_policy).sum(-1).mean()
                actor_loss = -(log_policy.gather(1, actions) * advantage).mean() - entropy * spread
                critic_loss = ((value[:, None] - sampled) ** 2).mean()
                loss = actor_loss + VALUE_LOSS_WEIGHT * critic_loss
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
                             validate=validate if validation.size else None, snapshot=lambda: snapshot(*modules),
                             restore=lambda state: restore(state, *modules), patience=int(p["patience"]), name=self.key)
        return summary

    def state(self) -> dict:
        return {"encoder": module_state(self.encoder), "actor": module_state(self.actor),
                "critic": module_state(self.critic), "statistics": self.statistics.state()}

    def load_state(self, state: dict) -> None:
        self.encoder.load_state_dict(state["encoder"])
        self.actor.load_state_dict(state["actor"])
        self.critic.load_state_dict(state["critic"])
        self.statistics.load(state["statistics"])


__all__ = ["RegimeStatistics", "TaskAwareActorCritic"]
