"""``DeepValueAgentAdapter``: the DQN family trading the run's price tape.

One adapter, five registry keys that differ only in the flags of
``direction.fixed`` (build plan §1.1, family 2):

    variant   double_target  dueling  noisy  distributional  prioritized_replay  multi_step
    dqn            -            -       -          -                 -                -
    double         x            -       -          -                 -                -
    dueling        x            x       -          -                 -                -
    noisy          -            -       x          -                 -                -
    rainbow        x            x       x          x                 x                x

The environment (``cycle.bridges.tape``): the state is one bar's causal
feature row, the action {short, flat, long}, the reward the whole h-bar trade
of that decision (``RewardTape.position_reward``: next-open fill, exit h bars
later, one round trip of cost, divided by the decision bar's move scale); the
next state is the next training bar. The agent's own position is NOT in the
state, so a bar's prediction never depends on earlier predictions, and the
market does not react to the agent. An epoch is one episode: the agent walks
the training span bar by bar, acting epsilon-greedily (noisy variants: greedy
on noise-perturbed values), storing each step in the replay buffer and taking
one gradient step on a replayed minibatch every ``environment_steps_per_update``
bars; the target network is a copy refreshed every ``target_update_interval``
gradient steps. Scalar variants minimise the importance-weighted Huber loss to
``network.double_q_target``; the distributional one the cross-entropy to
``network.categorical_projection``, priorities being the per-transition loss.

Checkpoint selection: after every epoch the greedy long-or-short choice is
scored on the validation rows' own tape (mean net reward, prices read up to
validation_index[-1] + h); the best epoch's weights are restored. P(up) is the
Boltzmann share of long over {long, short}, sigmoid((Q_long - Q_short) / T),
with the one temperature T fitted on the validation labels
(``bridges.calibration.TemperatureScale``, never flipping the sign).

Prediction reads only the feature row of the bar (float64, noise off, on the
CPU), so it is causal by construction and a single row equals the batch.
"""

from __future__ import annotations

import copy
import math
from pathlib import Path

import numpy as np

from cycle.bridges import persistence
from cycle.bridges.base import BridgeAdapter
from cycle.bridges.calibration import TemperatureScale
from cycle.bridges.tape import RewardTape
from cycle.bridges.training import ValidationScore, run_epochs, score

VARIANT_FLAGS = ("double_target", "dueling", "noisy", "distributional", "prioritized_replay", "multi_step")
REPORTS_PER_EPOCH = 10
CPU_TRAINING_THREADS = 4


def _flag(fixed: dict, name: str) -> bool:
    return bool((fixed or {}).get(name, False))


def return_support(reward_table: np.ndarray, reward_limit: float, discount_factor: float,
                   step_count: int) -> tuple[float, float]:
    """The C51 atoms' range [floor, ceiling] for this tape, from training rewards only.

    A target is R + discount^n * Z(s'), R the sum of n discounted rewards each in
    [-reward_limit, reward_limit]. Flat always earns 0, so a state's value is never
    below 0; above, it is bounded by one full reward plus the discounted hindsight
    value of the training span (the mean over training bars of the best of short,
    flat and long: what no policy beats on average). So

        floor   = -reward_limit * k,     k = 1 + discount + ... + discount^(n-1)
        ceiling =  reward_limit * k + discount^n * (reward_limit + discount * hindsight / (1 - discount))

    A fixed symmetric range would saturate as the discount rises: the values carry
    an offset of about hindsight / (1 - discount) shared by every action (the next
    bar does not depend on the action), and at discount 0.99 that is far past 10."""
    limit = float(reward_limit)
    discount = min(max(float(discount_factor), 0.0), 0.999)
    steps = max(1, int(step_count))
    folded = sum(discount ** power for power in range(steps))
    best = np.clip(np.nanmax(np.asarray(reward_table, dtype=np.float64), axis=1), 0.0, limit)
    hindsight = float(np.mean(best)) if best.size else 0.0
    state_value = limit + discount * hindsight / (1.0 - discount)
    return -limit * folded, limit * folded + discount ** steps * state_value


class DeepValueAgentAdapter(BridgeAdapter):
    step_unit = "epoch"
    model_file = "model.pt"

    def __init__(self, key: str, entry: dict, parameters: dict, device: str, seed: int,
                 task: str = "classification") -> None:
        super().__init__(key, entry, parameters, device, seed, task)
        if task != "classification":
            raise TypeError(f"{key}: the deep value agents have no price model (their Q gap is not a move)")
        self._state: dict | None = None
        self._architecture: dict | None = None
        self._temperature = TemperatureScale(0.0, 0)
        self._inference = None

    # ── configuration ──
    @property
    def flags(self) -> dict[str, bool]:
        fixed = ((self.entry or {}).get("direction") or {}).get("fixed") or {}
        return {name: _flag(fixed, name) for name in VARIANT_FLAGS}

    def _parameter(self, name: str, default):
        value = self.parameters.get(name, default)
        return default if value is None else value

    def minimum_history(self) -> int:
        return 1

    def _library_versions(self) -> dict[str, str]:
        return persistence.library_versions("numpy", "torch")

    def _training_device(self) -> str:
        import torch

        if self.device.startswith("cuda") and torch.cuda.is_available():
            return self.device
        return "cpu"

    # ── fit ──
    def _fit(self, features, labels, train_index, validation_index, timestamps, reporter) -> None:
        import torch

        # a few-hundred-unit network on the CPU is fastest on a few threads (measured: 12 threads ran a
        # Rainbow epoch in 4 s, 1-4 threads in 3 s, identical weights); the setting is put back afterwards
        previous_threads = torch.get_num_threads()
        if self._training_device() == "cpu":
            torch.set_num_threads(min(previous_threads, CPU_TRAINING_THREADS))
        try:
            self._fit_agent(features, labels, train_index, validation_index, reporter)
        finally:
            torch.set_num_threads(previous_threads)

    def _fit_agent(self, features, labels, train_index, validation_index, reporter) -> None:
        import torch

        from .network import FLAT, LONG, SHORT, QNetwork, categorical_projection, double_q_target
        from .replay import ReplayBuffer

        view = self.require_market()
        flags = self.flags
        features = np.asarray(features)
        labels = np.asarray(labels, dtype=np.float64)
        horizon = int(view.horizon)

        # the training tape: prices up to train_index[-1] + h + 1, which the purge keeps before validation
        tape = RewardTape.from_view(view, train_index)
        rows = train_index[np.all(np.isfinite(features[train_index]), axis=1)]
        rows = tape.usable_rows(rows)
        if rows.size < 2:
            raise ValueError(f"{self.key}: {rows.size} training bars have a known reward; the agent needs at least 2")
        reward_table = np.zeros((rows.size, 3), dtype=np.float64)
        reward_table[:, SHORT] = tape.position_reward(rows, -1.0)
        reward_table[:, LONG] = tape.position_reward(rows, 1.0)
        observations = np.asarray(features[rows], dtype=np.float32)
        # an episode segment ends where the next usable bar is not the next bar (a gap, a break, a hole)
        segment_end = np.append(np.diff(rows) != 1, True)

        # the validation tape: prices up to validation_index[-1] + h, never later
        validation = validation_index[np.all(np.isfinite(features[validation_index]), axis=1)] \
            if validation_index.size else validation_index
        validation_rewards = np.full((validation.size, 3), np.nan)
        if validation.size:
            validation_tape = RewardTape.from_view(view, known_until=int(validation[-1]) + horizon)
            validation_rewards[:, SHORT] = validation_tape.position_reward(validation, -1.0)
            validation_rewards[:, FLAT] = 0.0
            validation_rewards[:, LONG] = validation_tape.position_reward(validation, 1.0)
        validation_observations = np.asarray(features[validation], dtype=np.float32)
        validation_labels = labels[validation]

        hidden_size = int(self._parameter("hidden_size", 128))
        layer_count = int(self._parameter("layer_count", 2))
        learning_rate = float(self._parameter("learning_rate", 5e-4))
        batch_size = int(self._parameter("batch_size", 64))
        epoch_count = int(self._parameter("epochs", 20))
        patience = int(self._parameter("patience", 5))
        discount_factor = float(self._parameter("discount_factor", 0.9))
        replay_capacity = int(self._parameter("replay_capacity", 50_000))
        target_update_interval = max(1, int(self._parameter("target_update_interval", 250)))
        steps_per_update = max(1, int(self._parameter("environment_steps_per_update", 4)))
        gradient_norm_limit = float(self._parameter("gradient_norm_limit", 10.0))
        exploration_start = float(self._parameter("exploration_start", 1.0))
        exploration_end = float(self._parameter("exploration_end", 0.05))
        exploration_decay_fraction = float(self._parameter("exploration_decay_fraction", 0.5))
        initial_noise_scale = float(self._parameter("initial_noise_scale", 0.5))
        atom_count = int(self._parameter("atom_count", 51)) if flags["distributional"] else 1
        reward_limit = float(self._parameter("value_limit", 5.0))
        step_count = int(self._parameter("return_step_count", 3)) if flags["multi_step"] else 1
        value_floor, value_ceiling = return_support(reward_table, reward_limit, discount_factor, step_count)
        priority_exponent = float(self._parameter("priority_exponent", 0.5))
        importance_sampling_start = float(self._parameter("importance_sampling_start", 0.4))

        device = self._training_device()
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(self.seed)
            online = QNetwork(int(features.shape[1]), hidden_size, layer_count, dueling=flags["dueling"],
                              noisy=flags["noisy"], atom_count=atom_count, value_limit=value_ceiling,
                              value_floor=value_floor, initial_noise_scale=initial_noise_scale)
        target = copy.deepcopy(online)
        online.to(device)
        target.to(device)
        # the target network stays in training mode: it has no dropout or batch norm, so the mode only
        # switches its noisy layers on, and a noisy target draws its own noise sample for every update
        # (Fortunato et al. 2018: "target.resample() then target(next_state)")
        target.train()
        optimizer = torch.optim.Adam(online.parameters(), lr=learning_rate)
        noise_generator = torch.Generator().manual_seed(self.seed + 1)
        generator = np.random.default_rng((self.seed, 17))
        replay = ReplayBuffer(replay_capacity, int(features.shape[1]), generator,
                              prioritized=flags["prioritized_replay"], priority_exponent=priority_exponent,
                              step_count=step_count, discount_factor=discount_factor)
        total_steps = epoch_count * rows.size
        total_updates = max(1, total_steps // steps_per_update)
        counters = {"steps": 0, "updates": 0}

        def tensor(values, dtype=torch.float32):
            return torch.as_tensor(np.asarray(values), dtype=dtype, device=device)

        def exploration_rate() -> float:
            if flags["noisy"]:
                return 0.0
            decay_steps = max(1.0, exploration_decay_fraction * total_steps)
            share = min(1.0, counters["steps"] / decay_steps)
            return exploration_start + share * (exploration_end - exploration_start)

        def update() -> float:
            beta = importance_sampling_start + (1.0 - importance_sampling_start) * min(
                1.0, counters["updates"] / total_updates)
            batch = replay.sample(batch_size, beta)
            state, next_state = tensor(batch["observations"]), tensor(batch["next_observations"])
            action = tensor(batch["actions"], torch.int64)
            reward, done = tensor(batch["rewards"]), tensor(batch["done"])
            discount, weight = tensor(batch["discounts"]), tensor(batch["weights"])
            if flags["noisy"]:
                online.reset_noise(noise_generator)
                target.reset_noise(noise_generator)
            with torch.no_grad():
                next_online = online(next_state)
                if atom_count > 1:
                    next_target_values = target(next_state)
                    chooser = next_online if flags["double_target"] else next_target_values
                    best = chooser.argmax(dim=1)
                    next_distribution = target.log_distribution(next_state).exp()[torch.arange(best.shape[0]), best]
                    projected = categorical_projection(next_distribution, reward, done, discount, online.support)
                else:
                    goal = double_q_target(reward, done, discount, next_online, target(next_state),
                                           flags["double_target"])
            if atom_count > 1:
                taken = online.log_distribution(state)[torch.arange(action.shape[0]), action]
                per_transition = -(projected * taken).sum(dim=1)
                priority = per_transition.detach()
            else:
                value = online(state).gather(1, action.unsqueeze(1)).squeeze(1)
                per_transition = torch.nn.functional.huber_loss(value, goal, reduction="none")
                priority = (value - goal).detach().abs()
            loss = (weight * per_transition).mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(online.parameters(), gradient_norm_limit)
            optimizer.step()
            replay.update_priorities(batch["indices"], priority.cpu().numpy())
            counters["updates"] += 1
            if counters["updates"] % target_update_interval == 0:
                target.load_state_dict(online.state_dict())
            return float(loss.item())

        def gaps(model_observations: np.ndarray) -> np.ndarray:
            if model_observations.shape[0] == 0:
                return np.empty(0)
            online.eval()
            with torch.no_grad():
                values = online(tensor(model_observations)).cpu().numpy().astype(np.float64)
            online.train()
            return values[:, LONG] - values[:, SHORT]

        def train_epoch(epoch: int, report_batch) -> float | None:
            online.train()
            losses: list[float] = []
            chunk_losses: list[float] = []
            updates_per_epoch = max(1, math.ceil(rows.size / steps_per_update))
            report_every = max(1, math.ceil(updates_per_epoch / REPORTS_PER_EPOCH))
            report_count = max(1, math.ceil(updates_per_epoch / report_every))
            reported = 0
            chunk_start = 0
            for start in range(0, rows.size, steps_per_update):
                stop = min(rows.size, start + steps_per_update)
                if flags["noisy"]:
                    online.reset_noise(noise_generator)
                with torch.no_grad():
                    greedy = online(tensor(observations[start:stop])).argmax(dim=1).cpu().numpy()
                for offset, position in enumerate(range(start, stop)):
                    action = int(greedy[offset])
                    if generator.random() < exploration_rate():
                        action = int(generator.integers(0, 3))
                    done = bool(segment_end[position])
                    following = observations[position] if done else observations[position + 1]
                    replay.add(observations[position], action, reward_table[position, action], following, done)
                    counters["steps"] += 1
                if len(replay) >= batch_size:
                    chunk_losses.append(update())
                if chunk_losses and (len(chunk_losses) >= report_every or stop == rows.size):
                    reported += 1
                    losses.extend(chunk_losses)
                    report_batch(reported, max(report_count, reported), int(rows[chunk_start]), int(rows[stop - 1]),
                                 float(np.mean(chunk_losses)), learning_rate=learning_rate)
                    chunk_losses = []
                    chunk_start = stop
            return float(np.mean(losses)) if losses else None

        best: dict = {}

        def validate(epoch: int) -> ValidationScore:
            gap = gaps(validation_observations)
            temperature = TemperatureScale.fit(gap, validation_labels)
            probability = temperature.apply(gap)
            result = score("classification", probability, validation_labels)
            chosen = np.where(gap >= 0.0, validation_rewards[:, LONG], validation_rewards[:, SHORT]) \
                if gap.size else np.empty(0)
            known = np.isfinite(chosen)
            net_reward = float(np.mean(chosen[known])) if known.any() else None
            best.setdefault("net_rewards", {})[epoch] = net_reward
            selection = -net_reward if net_reward is not None else result.selection
            return ValidationScore(result.loss, result.accuracy, result.f1_score, selection)

        def snapshot():
            return {name: value.detach().cpu().clone() for name, value in online.state_dict().items()}

        def restore(state) -> None:
            online.load_state_dict(state)

        summary = run_epochs(reporter, epoch_count=epoch_count, train_index=rows, train_epoch=train_epoch,
                             validate=validate if validation.size else None, snapshot=snapshot, restore=restore,
                             patience=patience, name=self.key)
        self._state = snapshot()
        self._architecture = online.architecture()
        self._inference = None
        self._temperature = TemperatureScale.fit(gaps(validation_observations), validation_labels)
        net_reward = (best.get("net_rewards") or {}).get(summary["best_epoch"])
        noise_scales = [float(parameter.detach().abs().mean()) for name, parameter in online.named_parameters()
                        if name.endswith("noise_scale")]
        mean_noise_scale = float(np.mean(noise_scales)) if noise_scales else None
        reporter.log(f"{self.key}: {self.variant} agent, {counters['steps']} steps, {counters['updates']} gradient "
                     f"updates, best epoch {summary['best_epoch']}, validation net reward per decision "
                     f"{'n/a' if net_reward is None else f'{net_reward:.4f}'} (scaled), inverse temperature "
                     f"{self._temperature.inverse_temperature:.4f}"
                     + (f", return atoms on [{value_floor:.2f}, {value_ceiling:.2f}]" if atom_count > 1 else "")
                     + (f", mean noise scale {mean_noise_scale:.4f}" if mean_noise_scale is not None else ""))
        self.best_iteration = int(summary["best_epoch"])
        self.fit_summary = {
            "trained_epochs": int(summary["trained_epochs"]), "best_epoch": int(summary["best_epoch"]),
            "environment_steps": int(counters["steps"]), "gradient_updates": int(counters["updates"]),
            "training_decision_rows": int(rows.size), "validation_net_reward": net_reward,
            "inverse_temperature": float(self._temperature.inverse_temperature),
            "mean_noise_scale": mean_noise_scale,
            "return_support": [float(value_floor), float(value_ceiling)] if atom_count > 1 else None,
        }

    # ── predict ──
    def _network(self):
        if self._inference is None:
            import torch

            from .network import QNetwork

            with torch.random.fork_rng(devices=[]):
                network = QNetwork(**self._architecture)
            network.load_state_dict({name: value.double() if value.is_floating_point() else value
                                     for name, value in self._state.items()})
            network = network.double().eval()
            self._inference = network
        return self._inference

    def action_values(self, features, index) -> np.ndarray:
        """float64 (rows, 3) expected values of short, flat, long (NaN rows where a feature is missing)."""
        import torch

        from .network import ACTION_COUNT

        index = np.asarray(index, dtype=np.int64).reshape(-1)
        rows = np.asarray(features[index], dtype=np.float64)
        known = np.all(np.isfinite(rows), axis=1)
        out = np.full((index.size, ACTION_COUNT), np.nan)
        if known.any():
            with torch.no_grad():
                out[known] = self._network()(torch.from_numpy(rows[known])).numpy()
        return out

    def _predict_probability(self, features, index) -> np.ndarray:
        from .network import LONG, SHORT

        values = self.action_values(features, index)
        return self._temperature.apply(values[:, LONG] - values[:, SHORT])

    # ── save / load ──
    def _save_state(self, folder: Path) -> str:
        persistence.save_torch(folder / self.model_file, {
            "state": self._state, "architecture": dict(self._architecture),
            "calibration": self._temperature.to_dict(), "flags": self.flags,
        })
        return self.model_file

    def _load_state(self, folder: Path, metadata: dict) -> None:
        stored = persistence.load_torch(folder / metadata.get("model_file", self.model_file))
        self._state = dict(stored["state"])
        self._architecture = dict(stored["architecture"])
        self._temperature = TemperatureScale.from_dict(stored["calibration"])
        self._inference = None


__all__ = ["DeepValueAgentAdapter", "VARIANT_FLAGS", "return_support"]
