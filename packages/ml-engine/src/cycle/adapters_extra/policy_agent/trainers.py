"""The own torch loops of the policy agents (the variants Stable-Baselines3
does not implement as the spec describes).

Every loop trains on ``FitContext.train_rows`` (training-span rows with a known
tape reward), one epoch = one sweep over them, through
``bridges.training.run_epochs``: checkpoint at every epoch start and before
validation, the best-validation weights restored. An action is a draw from a
seeded ``torch.Generator`` (seed, epoch), so a fit is reproducible; the reward
of each action at each row is ``FitContext.reward_table`` (the whole h-bar
trade of a decision, net of the round-trip cost, in move-scale units).

    reinforce                Monte Carlo policy gradient: consecutive episodes
                             of ``episode_bars`` rows, discounted reward-to-go,
                             a moving-average baseline, one step per episode
    vanilla_policy_gradient  ``episodes_per_iteration`` episodes per step,
                             reward-to-go minus a learned value baseline V(s)
                             fitted by regression after each step
    actor_critic             one-step online actor-critic in time order: the TD
                             error r + discount V(s') - V(s) drives the actor,
                             two optimiser groups (actor, critic)
    a3c                      ``worker_count`` workers, each with its own segment
                             of the span and a local copy of the network; in
                             turn each rolls ``rollout_length`` steps with its
                             (stale) copy, pushes its n-step actor-critic
                             gradient into the shared network and re-syncs
    q_prop                   policy gradient with the Q-Prop control variate: an
                             off-policy critic Q(s, a) fitted by TD on a replay
                             of every transition so far; for three discrete
                             actions the control variate's expectation over
                             actions is exact (no Taylor expansion)
    naf                      normalized advantage function: Q(s, a) = V(s) -
                             P(s) (a - mu(s))^2 / 2 by replay TD with a Polyak
                             target, Gaussian exploration decayed over the fit
    modality_policy          the multi-modal reasoning agent: feature-group
                             encoders, cross-modal attention per bar, a GRU over
                             the window; actor-critic with an auxiliary Huber
                             head on the price target
"""

from __future__ import annotations

import contextlib
import copy
import math
import random

import numpy as np
import torch
from torch import nn
from torch.nn import functional

from cycle.bridges import calibration
from cycle.bridges.groups import calendar_channels, modality_groups
from cycle.bridges.tape import ACTION_POSITIONS
from cycle.bridges.training import ValidationScore, run_epochs

from .encoders import (
    ActionValueNetwork,
    CategoricalActorCritic,
    CategoricalPolicy,
    ModalityReasoningNetwork,
    NormalizedAdvantageNetwork,
    ValueNetwork,
    double_copy,
)
from .readout import FitContext, greedy_positions, long_share, observation_rows

REPORT_EVERY_TRANSITIONS = 256
CALENDAR_CHANNEL_COUNT = 4


@contextlib.contextmanager
def seeded(seed: int, threads: int | None = None):
    """Seed torch, numpy and random for the block, then put the process's own
    generators back (a model's fit leaves the engine's randomness untouched).
    ``threads`` caps torch's intra-op threads for the block (a fit of these small
    networks is dominated by per-step overhead: many threads only contend)."""
    random_state = random.getstate()
    numpy_state = np.random.get_state()
    thread_count = torch.get_num_threads()
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(int(seed))
        np.random.seed(int(seed) % (2 ** 32))
        random.seed(int(seed))
        if threads is not None:
            torch.set_num_threads(max(1, int(threads)))
        try:
            yield
        finally:
            torch.set_num_threads(thread_count)
            random.setstate(random_state)
            np.random.set_state(numpy_state)


FIT_THREADS = 1


@contextlib.contextmanager
def thread_cap(threads: int = FIT_THREADS):
    """Cap torch's intra-op threads for the block, then restore the count. A
    prediction here is a few small matrix products: on a busy machine a full
    thread pool spends far longer waking and contending than computing."""
    count = torch.get_num_threads()
    torch.set_num_threads(max(1, int(threads)))
    try:
        yield
    finally:
        torch.set_num_threads(count)


def generator(seed: int, *parts: int) -> torch.Generator:
    value = int(np.random.SeedSequence([int(seed) % (2 ** 32), *[int(part) % (2 ** 32) for part in parts]])
                .generate_state(1)[0])
    return torch.Generator().manual_seed(value)


def numpy_generator(seed: int, *parts: int) -> np.random.Generator:
    return np.random.default_rng([int(seed) % (2 ** 32), *[int(part) % (2 ** 32) for part in parts]])


def reward_to_go(rewards: np.ndarray, discount: float) -> np.ndarray:
    out = np.empty_like(rewards, dtype=np.float64)
    running = 0.0
    for position in range(rewards.shape[0] - 1, -1, -1):
        running = float(rewards[position]) + discount * running
        out[position] = running
    return out


def entropy(logits: torch.Tensor) -> torch.Tensor:
    return torch.distributions.Categorical(logits=logits).entropy()


def clip_gradients(parameters, norm: float) -> float:
    if norm and norm > 0:
        return float(nn.utils.clip_grad_norm_(list(parameters), float(norm)))
    return float("nan")


def _state(modules: dict[str, nn.Module]) -> dict:
    return {name: copy.deepcopy(module.state_dict()) for name, module in modules.items()}


def _restore(modules: dict[str, nn.Module], state: dict) -> None:
    for name, module in modules.items():
        module.load_state_dict(state[name])


class PolicyTrainer:
    """What every own-loop trainer shares: networks built from an
    ``architecture``, a float64 readout copy, save / load of the weights."""

    variant = ""
    discrete = True

    def __init__(self, parameters: dict, seed: int, architecture: dict) -> None:
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.architecture = dict(architecture)
        self.extra: dict = {}
        with seeded(self.seed):
            self.modules = self.build()
        self._readout: dict[str, nn.Module] | None = None
        self.summary: dict = {}

    # ── what a trainer writes ──
    def build(self) -> dict[str, nn.Module]:
        raise NotImplementedError

    def train(self, context: FitContext) -> dict:
        raise NotImplementedError

    def policy_logits(self, modules: dict[str, nn.Module], observations: torch.Tensor) -> torch.Tensor:
        return modules["policy"](observations)

    # ── shared ──
    @property
    def input_size(self) -> int:
        return int(self.architecture["input_size"])

    def hidden(self) -> tuple[int, int]:
        return int(self.parameters["hidden_size"]), int(self.parameters["layer_count"])

    def fit(self, context: FitContext) -> dict:
        for module in self.modules.values():
            module.train()
        with seeded(self.seed + 1, FIT_THREADS):
            self.summary = self.train(context)
        for module in self.modules.values():
            module.eval()
        self._readout = None
        return self.summary

    def readout_modules(self) -> dict[str, nn.Module]:
        if self._readout is None:
            self._readout = {name: double_copy(module) for name, module in self.modules.items()}
        return self._readout

    def action_probabilities(self, features: np.ndarray, rows, modules=None) -> np.ndarray:
        """(rows, 3) [short, flat, long] probabilities; NaN rows where the feature row is incomplete."""
        modules = modules or self.readout_modules()
        dtype = next(iter(modules.values())).parameters().__next__().dtype
        observations, complete = observation_rows(features, rows)
        with torch.no_grad():
            logits = self.policy_logits(modules, torch.as_tensor(observations, dtype=dtype))
            probabilities = torch.softmax(logits, dim=-1).double().numpy()
        probabilities[~complete] = np.nan
        return probabilities

    def probability(self, features: np.ndarray, rows) -> np.ndarray:
        return long_share(self.action_probabilities(features, rows))

    def validate(self, context: FitContext) -> ValidationScore:
        rows = context.evaluator.rows
        if rows.size == 0:
            return ValidationScore(None, None, None, None)
        probabilities = self.action_probabilities(context.features, rows, self.modules)
        return context.evaluator.classification(long_share(probabilities), greedy_positions(np.nan_to_num(probabilities)))

    def epochs(self, context: FitContext, train_epoch) -> dict:
        return run_epochs(context.reporter, epoch_count=int(self.parameters["training_sweeps"]),
                          train_index=context.train_rows, train_epoch=train_epoch,
                          validate=lambda epoch: self.validate(context), snapshot=lambda: _state(self.modules),
                          restore=lambda state: _restore(self.modules, state), patience=None, name=context.name)

    def observations(self, context: FitContext) -> torch.Tensor:
        values, _ = observation_rows(context.features, context.train_rows)
        return torch.as_tensor(values, dtype=torch.float32)

    def state(self) -> dict:
        return {"architecture": dict(self.architecture), "extra": copy.deepcopy(self.extra),
                "weights": {name: module.state_dict() for name, module in self.modules.items()}}

    @classmethod
    def from_state(cls, parameters: dict, seed: int, state: dict) -> PolicyTrainer:
        trainer = cls(parameters, seed, state["architecture"])
        _restore(trainer.modules, state["weights"])
        trainer.extra = dict(state.get("extra") or {})
        for module in trainer.modules.values():
            module.eval()
        return trainer


def _sample(logits: torch.Tensor, draw: torch.Generator) -> torch.Tensor:
    return torch.multinomial(torch.softmax(logits.detach(), dim=-1), 1, generator=draw).squeeze(-1)


def _log_probability(logits: torch.Tensor, actions: torch.Tensor) -> torch.Tensor:
    return torch.log_softmax(logits, dim=-1).gather(-1, actions[:, None]).squeeze(-1)


# ─── REINFORCE ──────────────────────────────────────────────────────────────


class ReinforceTrainer(PolicyTrainer):
    variant = "reinforce"

    def build(self):
        hidden, layers = self.hidden()
        return {"policy": CategoricalPolicy(self.input_size, hidden, layers)}

    def train(self, context: FitContext) -> dict:
        policy = self.modules["policy"]
        optimizer = torch.optim.Adam(policy.parameters(), lr=float(self.parameters["learning_rate"]))
        observations = self.observations(context)
        rewards_by_action = context.reward_table
        count = observations.shape[0]
        length = max(2, min(int(self.parameters["episode_bars"]), count))
        discount = float(self.parameters["discount_factor"])
        entropy_weight = float(self.parameters["entropy_coefficient"])
        use_baseline = self.parameters.get("reinforce_baseline", "moving_average") == "moving_average"
        baseline = {"value": None}

        def train_epoch(epoch, report_batch):
            order = numpy_generator(self.seed, epoch)
            offset = int(order.integers(0, length))
            edges = [0, *range(offset, count, length), count] if offset else [*range(0, count, length), count]
            episodes = [(start, stop) for start, stop in zip(edges[:-1], edges[1:]) if stop - start >= 2]
            episodes = [episodes[i] for i in order.permutation(len(episodes))]
            draw = generator(self.seed, epoch)
            losses = []
            for number, (start, stop) in enumerate(episodes, 1):
                logits = policy(observations[start:stop])
                actions = _sample(logits, draw)
                rewards = rewards_by_action[np.arange(start, stop), actions.numpy()]
                returns = reward_to_go(rewards, discount)
                reference = baseline["value"] if (use_baseline and baseline["value"] is not None) else 0.0
                advantage = torch.as_tensor(returns - reference, dtype=torch.float32)
                loss = -(_log_probability(logits, actions) * advantage).mean() - entropy_weight * entropy(logits).mean()
                optimizer.zero_grad()
                loss.backward()
                norm = clip_gradients(policy.parameters(), float(self.parameters["gradient_clipping_norm"]))
                optimizer.step()
                if use_baseline:
                    mean_return = float(np.mean(returns))
                    baseline["value"] = mean_return if baseline["value"] is None else \
                        0.9 * baseline["value"] + 0.1 * mean_return
                losses.append(float(loss.detach()))
                report_batch(number, len(episodes), int(context.train_rows[start]), int(context.train_rows[stop - 1]),
                             float(loss.detach()), float(self.parameters["learning_rate"]), norm)
            return float(np.mean(losses)) if losses else None

        return self.epochs(context, train_epoch)


# ─── vanilla policy gradient ────────────────────────────────────────────────


class VanillaPolicyGradientTrainer(PolicyTrainer):
    variant = "vanilla_policy_gradient"

    def build(self):
        hidden, layers = self.hidden()
        return {"policy": CategoricalPolicy(self.input_size, hidden, layers),
                "value": ValueNetwork(self.input_size, hidden, layers)}

    def train(self, context: FitContext) -> dict:
        policy, value = self.modules["policy"], self.modules["value"]
        policy_optimizer = torch.optim.Adam(policy.parameters(), lr=float(self.parameters["learning_rate"]))
        value_optimizer = torch.optim.Adam(value.parameters(), lr=float(self.parameters["critic_learning_rate"]))
        observations = self.observations(context)
        count = observations.shape[0]
        length = max(2, min(int(self.parameters["episode_bars"]), count))
        episodes_per_iteration = int(self.parameters["episodes_per_iteration"])
        iterations = max(1, math.ceil(count / (episodes_per_iteration * length)))
        discount = float(self.parameters["discount_factor"])
        entropy_weight = float(self.parameters["entropy_coefficient"])
        fit_steps = int(self.parameters["baseline_fit_steps"])

        def train_epoch(epoch, report_batch):
            order = numpy_generator(self.seed, epoch)
            draw = generator(self.seed, epoch)
            losses = []
            for iteration in range(1, iterations + 1):
                starts = order.integers(0, count - length + 1, size=episodes_per_iteration)
                index = np.concatenate([np.arange(start, start + length) for start in starts])
                batch = observations[index]
                logits = policy(batch)
                actions = _sample(logits, draw)
                rewards = context.reward_table[index, actions.numpy()]
                returns = np.concatenate([reward_to_go(rewards[i * length:(i + 1) * length], discount)
                                          for i in range(len(starts))])
                returns_tensor = torch.as_tensor(returns, dtype=torch.float32)
                with torch.no_grad():
                    advantage = returns_tensor - value(batch)
                loss = -(_log_probability(logits, actions) * advantage).mean() - entropy_weight * entropy(logits).mean()
                policy_optimizer.zero_grad()
                loss.backward()
                norm = clip_gradients(policy.parameters(), float(self.parameters["gradient_clipping_norm"]))
                policy_optimizer.step()
                for _ in range(fit_steps):            # the baseline, fitted by regression on this batch's returns
                    value_loss = functional.mse_loss(value(batch), returns_tensor)
                    value_optimizer.zero_grad()
                    value_loss.backward()
                    value_optimizer.step()
                losses.append(float(loss.detach()))
                report_batch(iteration, iterations, int(context.train_rows[index.min()]),
                             int(context.train_rows[index.max()]), float(loss.detach()),
                             float(self.parameters["learning_rate"]), norm)
            return float(np.mean(losses))

        return self.epochs(context, train_epoch)


# ─── one-step actor-critic ──────────────────────────────────────────────────


class ActorCriticTrainer(PolicyTrainer):
    variant = "actor_critic"

    def build(self):
        hidden, layers = self.hidden()
        return {"policy": CategoricalPolicy(self.input_size, hidden, layers),
                "value": ValueNetwork(self.input_size, hidden, layers)}

    def train(self, context: FitContext) -> dict:
        policy, value = self.modules["policy"], self.modules["value"]
        optimizer = torch.optim.Adam([
            {"params": policy.parameters(), "lr": float(self.parameters["learning_rate"])},
            {"params": value.parameters(), "lr": float(self.parameters["critic_learning_rate"])},
        ])
        observations = self.observations(context)
        count = observations.shape[0]
        discount = float(self.parameters["discount_factor"])
        entropy_weight = float(self.parameters["entropy_coefficient"])
        clip = float(self.parameters["gradient_clipping_norm"])
        parameters = [*policy.parameters(), *value.parameters()]

        def train_epoch(epoch, report_batch):
            draw = generator(self.seed, epoch)
            batch_count = math.ceil(count / REPORT_EVERY_TRANSITIONS)
            running, losses = [], []
            for step in range(count):          # time order, one update per transition
                state = observations[step:step + 1]
                logits = policy(state)
                action = _sample(logits, draw)
                reward = float(context.reward_table[step, int(action)])
                estimate = value(state)
                with torch.no_grad():
                    following = value(observations[step + 1:step + 2]) if step + 1 < count else torch.zeros(1)
                error = reward + discount * following - estimate
                loss = (-_log_probability(logits, action) * error.detach()).sum() + error.pow(2).sum() \
                    - entropy_weight * entropy(logits).sum()
                optimizer.zero_grad()
                loss.backward()
                clip_gradients(parameters, clip)
                optimizer.step()
                running.append(float(loss.detach()))
                if (step + 1) % REPORT_EVERY_TRANSITIONS == 0 or step + 1 == count:
                    first = step + 1 - len(running)
                    report_batch(math.ceil((step + 1) / REPORT_EVERY_TRANSITIONS), batch_count,
                                 int(context.train_rows[first]), int(context.train_rows[step]), float(np.mean(running)),
                                 float(self.parameters["learning_rate"]))
                    losses.append(float(np.mean(running)))
                    running = []
            return float(np.mean(losses))

        return self.epochs(context, train_epoch)


# ─── A3C (round-robin workers with stale weights) ───────────────────────────


class AsynchronousAdvantageTrainer(PolicyTrainer):
    variant = "a3c"

    def build(self):
        hidden, layers = self.hidden()
        return {"network": CategoricalActorCritic(self.input_size, hidden, layers)}

    def policy_logits(self, modules, observations):
        return modules["network"](observations)[0]

    def train(self, context: FitContext) -> dict:
        shared = self.modules["network"]
        optimizer = torch.optim.RMSprop(shared.parameters(), lr=float(self.parameters["learning_rate"]), alpha=0.99,
                                        eps=1e-5)
        observations = self.observations(context)
        count = observations.shape[0]
        workers = max(1, min(int(self.parameters["worker_count"]), count))
        length = max(1, int(self.parameters["rollout_length"]))
        discount = float(self.parameters["discount_factor"])
        entropy_weight = float(self.parameters["entropy_coefficient"])
        value_weight = float(self.parameters["value_loss_coefficient"])
        clip = float(self.parameters["gradient_clipping_norm"])
        segment = count // workers
        cursors = [worker * segment for worker in range(workers)]
        local = [copy.deepcopy(shared) for _ in range(workers)]
        synced_at = [0] * workers          # the shared update count when each worker last re-synced
        updates = {"count": 0, "staleness": []}
        rounds = max(1, math.ceil(count / (workers * length)))

        def train_epoch(epoch, report_batch):
            draw = generator(self.seed, epoch)
            losses = []
            for round_number in range(1, rounds + 1):
                for worker in range(workers):
                    start = cursors[worker]
                    stop = min(start + length, count)
                    network = local[worker]
                    logits, values = network(observations[start:stop])
                    actions = _sample(logits, draw)
                    rewards = context.reward_table[np.arange(start, stop), actions.numpy()]
                    with torch.no_grad():
                        bootstrap = float(network(observations[stop:stop + 1])[1]) if stop < count else 0.0
                    returns = np.empty(stop - start)
                    running = bootstrap
                    for position in range(stop - start - 1, -1, -1):
                        running = float(rewards[position]) + discount * running
                        returns[position] = running
                    advantage = torch.as_tensor(returns, dtype=torch.float32) - values
                    loss = -(_log_probability(logits, actions) * advantage.detach()).mean() \
                        + value_weight * advantage.pow(2).mean() - entropy_weight * entropy(logits).mean()
                    network.zero_grad()
                    loss.backward()
                    clip_gradients(network.parameters(), clip)
                    for target, source in zip(shared.parameters(), network.parameters()):
                        target.grad = None if source.grad is None else source.grad.detach().clone()
                    optimizer.step()                                  # the shared network moves
                    updates["staleness"].append(updates["count"] - synced_at[worker])
                    updates["count"] += 1
                    synced_at[worker] = updates["count"]
                    network.load_state_dict(shared.state_dict())     # this worker re-syncs; the others stay stale
                    cursors[worker] = stop if stop < count else 0
                    losses.append(float(loss.detach()))
                report_batch(round_number, rounds, int(context.train_rows[0]), int(context.train_rows[-1]),
                             float(np.mean(losses[-workers:])), float(self.parameters["learning_rate"]))
            return float(np.mean(losses))

        summary = self.epochs(context, train_epoch)
        staleness = updates["staleness"][workers:]           # after the first round every worker is stale
        summary["mean_staleness_updates"] = float(np.mean(staleness)) if staleness else 0.0
        return summary


# ─── Q-Prop ─────────────────────────────────────────────────────────────────


def control_variate(probabilities: torch.Tensor, action_values: torch.Tensor, actions: torch.Tensor,
                    advantage: torch.Tensor, mode: str) -> tuple[torch.Tensor, torch.Tensor]:
    """Q-Prop's control variate for discrete actions: the critic's advantage of
    the taken action, Q(s, a) - sum_b pi(b|s) Q(s, b) (its expectation under the
    policy is exactly 0), and the weight eta per sample: conservative 1 where it
    agrees in sign with the sampled advantage else 0, aggressive +-1 by that
    sign, none 0. Both are constants of the policy step (no gradient)."""
    with torch.no_grad():
        expected = (probabilities.detach() * action_values).sum(-1)
        critic_advantage = action_values.gather(-1, actions[:, None]).squeeze(-1) - expected
        if mode == "conservative":
            weight = (advantage * critic_advantage > 0).to(advantage.dtype)
        elif mode == "aggressive":
            weight = torch.sign(advantage * critic_advantage)
        elif mode == "none":
            weight = torch.zeros_like(advantage)
        else:
            raise ValueError(f"unknown control variate mode {mode!r}")
    return critic_advantage, weight


class QPropTrainer(PolicyTrainer):
    variant = "q_prop"

    def build(self):
        hidden, layers = self.hidden()
        critic = ActionValueNetwork(self.input_size, hidden, layers)
        return {"policy": CategoricalPolicy(self.input_size, hidden, layers),
                "value": ValueNetwork(self.input_size, hidden, layers),
                "critic": critic, "critic_target": copy.deepcopy(critic)}

    def train(self, context: FitContext) -> dict:
        policy, value, critic, target = (self.modules[name] for name in ("policy", "value", "critic", "critic_target"))
        policy_optimizer = torch.optim.Adam(policy.parameters(), lr=float(self.parameters["learning_rate"]))
        value_optimizer = torch.optim.Adam(value.parameters(), lr=float(self.parameters["critic_learning_rate"]))
        critic_optimizer = torch.optim.Adam(critic.parameters(), lr=float(self.parameters["critic_learning_rate"]))
        observations = self.observations(context)
        count = observations.shape[0]
        length = max(2, min(int(self.parameters["rollout_length"]), count))
        iterations = max(1, math.ceil(count / length))
        discount = float(self.parameters["discount_factor"])
        trace = float(self.parameters["generalized_advantage_decay"])
        entropy_weight = float(self.parameters["entropy_coefficient"])
        critic_updates = int(self.parameters["critic_updates"])
        batch_size = int(self.parameters["batch_size"])
        update_rate = float(self.parameters["target_update_rate"])
        mode = self.parameters.get("control_variate_mode", "conservative")
        replay_rows: list[np.ndarray] = []
        replay_actions: list[np.ndarray] = []
        cursor = {"at": 0}
        statistics = {"control_variate_share": []}

        def next_state_values(rows_index: torch.Tensor, network: nn.Module) -> torch.Tensor:
            """Expected Q of the next row under the current policy; 0 past the last row."""
            following = torch.clamp(rows_index + 1, max=count - 1)
            with torch.no_grad():
                probabilities = torch.softmax(policy(observations[following]), dim=-1)
                expected = (probabilities * network(observations[following])).sum(-1)
            return torch.where(rows_index + 1 < count, expected, torch.zeros_like(expected))

        def train_epoch(epoch, report_batch):
            draw = generator(self.seed, epoch)
            sampler = numpy_generator(self.seed, epoch, 1)
            losses = []
            for iteration in range(1, iterations + 1):
                start = cursor["at"]
                stop = min(start + length, count)
                index = np.arange(start, stop)
                batch = observations[start:stop]
                logits = policy(batch)
                actions = _sample(logits, draw)
                rewards = torch.as_tensor(context.reward_table[index, actions.numpy()], dtype=torch.float32)
                replay_rows.append(index)
                replay_actions.append(actions.numpy())
                # generalised advantage estimates with the on-policy value network
                with torch.no_grad():
                    values = value(batch)
                    bootstrap = value(observations[stop:stop + 1])[0] if stop < count else torch.zeros(())
                    following = torch.cat([values[1:], bootstrap.reshape(1)])
                    errors = rewards + discount * following - values
                    advantage = torch.empty_like(errors)
                    running = torch.zeros(())
                    for position in range(errors.shape[0] - 1, -1, -1):
                        running = errors[position] + discount * trace * running
                        advantage[position] = running
                    returns = advantage + values
                    advantage = (advantage - advantage.mean()) / (advantage.std() + 1e-8)
                    action_values = critic(batch)
                probabilities = torch.softmax(logits, dim=-1)
                critic_advantage, weight = control_variate(probabilities, action_values, actions, advantage, mode)
                statistics["control_variate_share"].append(float(weight.abs().mean()))
                # residual on-policy term + the analytic term through the critic
                analytic = (probabilities * action_values).sum(-1)
                loss = -(_log_probability(logits, actions) * (advantage - weight * critic_advantage)).mean() \
                    - (weight * analytic).mean() - entropy_weight * entropy(logits).mean()
                policy_optimizer.zero_grad()
                loss.backward()
                norm = clip_gradients(policy.parameters(), float(self.parameters["gradient_clipping_norm"]))
                policy_optimizer.step()
                for _ in range(max(1, critic_updates // 2)):
                    value_loss = functional.mse_loss(value(batch), returns)
                    value_optimizer.zero_grad()
                    value_loss.backward()
                    value_optimizer.step()
                # the off-policy critic: TD on the replay of every transition so far
                every_row = np.concatenate(replay_rows)
                every_action = np.concatenate(replay_actions)
                for _ in range(critic_updates):
                    pick = sampler.integers(0, every_row.shape[0], size=min(batch_size, every_row.shape[0]))
                    rows_index = torch.as_tensor(every_row[pick])
                    taken = torch.as_tensor(every_action[pick])
                    reward = torch.as_tensor(context.reward_table[every_row[pick], every_action[pick]], dtype=torch.float32)
                    goal = reward + discount * next_state_values(rows_index, target)
                    estimate = critic(observations[rows_index]).gather(-1, taken[:, None]).squeeze(-1)
                    critic_loss = functional.mse_loss(estimate, goal)
                    critic_optimizer.zero_grad()
                    critic_loss.backward()
                    critic_optimizer.step()
                    with torch.no_grad():
                        for slow, fast in zip(target.parameters(), critic.parameters()):
                            slow.mul_(1.0 - update_rate).add_(fast, alpha=update_rate)
                cursor["at"] = stop if stop < count else 0
                losses.append(float(loss.detach()))
                report_batch(iteration, iterations, int(context.train_rows[start]), int(context.train_rows[stop - 1]),
                             float(loss.detach()), float(self.parameters["learning_rate"]), norm)
            return float(np.mean(losses))

        summary = self.epochs(context, train_epoch)
        shares = statistics["control_variate_share"]
        summary["control_variate_share"] = float(np.mean(shares)) if shares else None
        return summary


# ─── NAF ────────────────────────────────────────────────────────────────────


class NormalizedAdvantageTrainer(PolicyTrainer):
    """Continuous position in [-1, 1]; P(up) = sigmoid(k * mu before the tanh),
    k >= 0 fitted on validation rows (``calibration.TemperatureScale``)."""

    variant = "naf"
    discrete = False

    def build(self):
        hidden, layers = self.hidden()
        network = NormalizedAdvantageNetwork(self.input_size, hidden, layers)
        return {"network": network, "network_target": copy.deepcopy(network)}

    def score(self, features: np.ndarray, rows, modules=None) -> np.ndarray:
        """mu(s) before the tanh; NaN where the feature row is incomplete."""
        modules = modules or self.readout_modules()
        network = modules["network"]
        dtype = next(network.parameters()).dtype
        observations, complete = observation_rows(features, rows)
        with torch.no_grad():
            mean = network.heads(torch.as_tensor(observations, dtype=dtype))[1].double().numpy()
        mean[~complete] = np.nan
        return mean

    def probability(self, features: np.ndarray, rows) -> np.ndarray:
        scale = calibration.TemperatureScale.from_dict(self.extra["temperature"])
        return scale.apply(self.score(features, rows))

    def validate(self, context: FitContext) -> ValidationScore:
        rows = context.evaluator.rows
        if rows.size == 0:
            return ValidationScore(None, None, None, None)
        mean = self.score(context.features, rows, self.modules)
        return context.evaluator.classification(calibration.sigmoid(mean), np.tanh(np.nan_to_num(mean)))

    def train(self, context: FitContext) -> dict:
        network, target = self.modules["network"], self.modules["network_target"]
        optimizer = torch.optim.Adam(network.parameters(), lr=float(self.parameters["learning_rate"]))
        observations = self.observations(context)
        count = observations.shape[0]
        chunk = max(1, min(int(self.parameters["rollout_length"]), count))
        sweeps = int(self.parameters["training_sweeps"])
        discount = float(self.parameters["discount_factor"])
        update_rate = float(self.parameters["target_update_rate"])
        updates = int(self.parameters["updates_per_step"])
        batch_size = int(self.parameters["batch_size"])
        noise_start = float(self.parameters["action_noise_scale"])
        replay = {"rows": [], "actions": [], "rewards": []}
        chunk_count = math.ceil(count / chunk)

        def train_epoch(epoch, report_batch):
            noise_draw = numpy_generator(self.seed, epoch, 2)
            sampler = numpy_generator(self.seed, epoch, 3)
            losses = []
            for number, start in enumerate(range(0, count, chunk), 1):
                stop = min(start + chunk, count)
                progress = ((epoch - 1) * count + start) / max(1, sweeps * count)
                noise = noise_start * (1.0 - 0.9 * progress)            # decays to a tenth over the fit
                with torch.no_grad():
                    mean = network.heads(observations[start:stop])[1].double().numpy()
                actions = np.clip(np.tanh(mean) + noise * noise_draw.standard_normal(stop - start), -1.0, 1.0)
                rows = np.arange(start, stop)
                replay["rows"].append(rows)
                replay["actions"].append(actions)
                replay["rewards"].append(context.rewards(actions, context.train_rows[rows]))
                every_row = np.concatenate(replay["rows"])
                every_action = np.concatenate(replay["actions"])
                every_reward = np.concatenate(replay["rewards"])
                for _ in range(updates * (stop - start)):          # updates_per_step replay updates per collected bar
                    pick = sampler.integers(0, every_row.shape[0], size=min(batch_size, every_row.shape[0]))
                    rows_index = torch.as_tensor(every_row[pick])
                    following = torch.clamp(rows_index + 1, max=count - 1)
                    with torch.no_grad():
                        next_value = target.heads(observations[following])[0]
                        next_value = torch.where(rows_index + 1 < count, next_value, torch.zeros_like(next_value))
                        goal = torch.as_tensor(every_reward[pick], dtype=torch.float32) + discount * next_value
                    estimate = network.action_value(observations[rows_index],
                                                    torch.as_tensor(every_action[pick], dtype=torch.float32))
                    loss = functional.mse_loss(estimate, goal)
                    optimizer.zero_grad()
                    loss.backward()
                    clip_gradients(network.parameters(), float(self.parameters["gradient_clipping_norm"]))
                    optimizer.step()
                    with torch.no_grad():
                        for slow, fast in zip(target.parameters(), network.parameters()):
                            slow.mul_(1.0 - update_rate).add_(fast, alpha=update_rate)
                    losses.append(float(loss.detach()))
                report_batch(number, chunk_count, int(context.train_rows[start]), int(context.train_rows[stop - 1]),
                             float(np.mean(losses[-updates:])) if losses else None,
                             float(self.parameters["learning_rate"]))
            return float(np.mean(losses)) if losses else None

        summary = self.epochs(context, train_epoch)
        validation_rows = context.evaluator.rows
        scale = calibration.TemperatureScale.fit(self.score(context.features, validation_rows, self.modules),
                                                 np.asarray(context.labels, dtype=np.float64)[validation_rows])
        self.extra["temperature"] = scale.to_dict()
        return summary


# ─── the multi-modal reasoning agent ────────────────────────────────────────


def modality_columns(feature_names, feature_count: int) -> tuple[list[list[int]], list[str]]:
    """The feature-group modalities of the run's columns plus the calendar
    channels (appended after the features), with their names."""
    names = list(feature_names) if feature_names else []
    if len(names) != feature_count:
        names = [f"column_{column}" for column in range(feature_count)]
    groups = modality_groups(names)
    columns = [list(indices) for indices in groups.values()]
    labels = list(groups)
    columns.append(list(range(feature_count, feature_count + CALENDAR_CHANNEL_COUNT)))
    labels.append("calendar")
    return columns, labels


class ModalityPolicyTrainer(PolicyTrainer):
    """Windows of ``sequence_length`` bars: the feature columns plus the
    calendar channels of each bar's own timestamp."""

    variant = "modality_policy"

    def build(self):
        embedding = int(self.architecture["embedding_size"])
        return {"network": ModalityReasoningNetwork(self.architecture["groups"], embedding,
                                                     int(self.architecture["head_count"]),
                                                     int(self.parameters["hidden_size"]))}

    @property
    def length(self) -> int:
        return int(self.parameters["sequence_length"])

    def windows(self, features: np.ndarray, timestamps: np.ndarray, rows) -> tuple[np.ndarray, np.ndarray]:
        """(rows, window, columns) float64 windows ending at each row, and the
        mask of rows whose whole window is known."""
        rows = np.asarray(rows, dtype=np.int64).reshape(-1)
        length = self.length
        offsets = np.arange(-length + 1, 1)
        index = rows[:, None] + offsets[None, :]
        inside = index >= 0
        safe = np.clip(index, 0, None)
        values = np.asarray(features, dtype=np.float64)[safe]
        calendar = calendar_channels(np.asarray(timestamps)[safe.reshape(-1)]).astype(np.float64)
        windows = np.concatenate([values, calendar.reshape(rows.size, length, CALENDAR_CHANNEL_COUNT)], axis=2)
        complete = inside.all(axis=1) & np.all(np.isfinite(windows), axis=(1, 2))
        windows = np.clip(np.where(np.isfinite(windows), windows, 0.0), -10.0, 10.0)
        return windows, complete

    def outputs(self, features, timestamps, rows, modules=None):
        """(action probabilities (rows, 3), price forecast (rows,)); NaN rows without a complete window."""
        modules = modules or self.readout_modules()
        network = modules["network"]
        dtype = next(network.parameters()).dtype
        windows, complete = self.windows(features, timestamps, rows)
        with torch.no_grad():
            logits, _, price = network(torch.as_tensor(windows, dtype=dtype))
            probabilities = torch.softmax(logits, dim=-1).double().numpy()
            price = price.double().numpy()
        probabilities[~complete] = np.nan
        price[~complete] = np.nan
        return probabilities, price

    def validate(self, context: FitContext) -> ValidationScore:
        rows = context.evaluator.rows
        if rows.size == 0:
            return ValidationScore(None, None, None, None)
        probabilities, price = self.outputs(context.features, context.view.timestamps, rows, self.modules)
        if context.task == "regression":
            return context.evaluator.regression(price)
        return context.evaluator.classification(long_share(probabilities), greedy_positions(np.nan_to_num(probabilities)))

    def train(self, context: FitContext) -> dict:
        network = self.modules["network"]
        optimizer = torch.optim.Adam(network.parameters(), lr=float(self.parameters["learning_rate"]))
        windows, complete = self.windows(context.features, context.view.timestamps, context.train_rows)
        positions = np.flatnonzero(complete)
        if positions.size < 2:
            raise ValueError(f"{context.name}: {positions.size} training rows have a complete window of "
                             f"{self.length} bars; the agent needs at least 2")
        inputs = torch.as_tensor(windows[positions], dtype=torch.float32)
        rows = context.train_rows[positions]
        rewards_by_action = context.reward_table[positions]
        price_targets = np.asarray(context.view.price_targets, dtype=np.float64)[rows]
        has_target = torch.as_tensor(np.isfinite(price_targets))
        price_targets = torch.as_tensor(np.nan_to_num(price_targets), dtype=torch.float32)
        count = positions.size
        batch_size = max(2, min(int(self.parameters["batch_size"]), count))
        batch_count = math.ceil(count / batch_size)
        discount = float(self.parameters["discount_factor"])
        entropy_weight = float(self.parameters["entropy_coefficient"])
        price_weight = float(self.parameters["auxiliary_price_weight"])
        drop = float(self.parameters["modality_dropout"])
        modality_count = len(network.groups)

        def train_epoch(epoch, report_batch):
            order = numpy_generator(self.seed, epoch)
            draw = generator(self.seed, epoch)
            with torch.no_grad():                      # V(s') at the start of the sweep (a slow target)
                network.eval()
                values = torch.cat([network(inputs[start:start + 512])[1] for start in range(0, count, 512)])
                network.train()
            following = torch.cat([values[1:], torch.zeros(1)])
            losses = []
            permutation = order.permutation(count)
            for number, start in enumerate(range(0, count, batch_size), 1):
                pick = permutation[start:start + batch_size]
                pick_tensor = torch.as_tensor(pick)
                mask = torch.as_tensor(order.random((pick.size, modality_count)) >= drop, dtype=torch.float32)
                mask[mask.sum(dim=1) == 0, 0] = 1.0                   # keep at least one modality
                logits, estimate, price = network(inputs[pick_tensor], mask)
                actions = _sample(logits, draw)
                reward = torch.as_tensor(rewards_by_action[pick, actions.numpy()], dtype=torch.float32)
                advantage = reward + discount * following[pick_tensor] - estimate
                loss = -(_log_probability(logits, actions) * advantage.detach()).mean() + 0.5 * advantage.pow(2).mean() \
                    - entropy_weight * entropy(logits).mean()
                known = has_target[pick_tensor]
                if bool(known.any()):
                    loss = loss + price_weight * functional.huber_loss(price[known], price_targets[pick_tensor][known])
                optimizer.zero_grad()
                loss.backward()
                norm = clip_gradients(network.parameters(), float(self.parameters["gradient_clipping_norm"]))
                optimizer.step()
                losses.append(float(loss.detach()))
                report_batch(number, batch_count, int(rows.min()), int(rows.max()), float(loss.detach()),
                             float(self.parameters["learning_rate"]), norm)
            return float(np.mean(losses))

        return self.epochs(context, train_epoch)


TRAINERS: dict[str, type[PolicyTrainer]] = {
    trainer.variant: trainer for trainer in (
        ReinforceTrainer, VanillaPolicyGradientTrainer, ActorCriticTrainer, AsynchronousAdvantageTrainer,
        QPropTrainer, NormalizedAdvantageTrainer, ModalityPolicyTrainer)
}

__all__ = ["ACTION_POSITIONS", "TRAINERS", "ModalityPolicyTrainer", "PolicyTrainer", "control_variate", "modality_columns",
           "reward_to_go", "seeded", "thread_cap"]
