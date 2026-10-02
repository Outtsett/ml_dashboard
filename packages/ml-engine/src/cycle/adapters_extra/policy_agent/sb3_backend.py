"""The Stable-Baselines3 / sb3_contrib policy agents on the tape environment.

    ppo    PPO: clipped surrogate, generalised advantage estimates, several
           optimisation passes over shuffled minibatches of each rollout
    a2c    A2C: ``environment_count`` synchronous copies of the environment
           (each its own seeded episode starts), n-step returns, one batched step
    trpo   sb3_contrib TRPO: the surrogate maximised under a mean KL limit with a
           conjugate-gradient natural gradient and a backtracking line search
    sac    SAC: a position in [-1, 1], twin critics, a learned entropy temperature
    ddpg   DDPG: a deterministic position, Gaussian action noise, Polyak targets
    td3    TD3: twin critics with the minimum target, target-policy smoothing and
           delayed actor updates

The environment is ``bridges.tape.TapeEnvironment`` over the training rows
(``episode_bars`` consecutive rows per episode from a seeded start; the reward
the whole h-bar trade of the decision). Each rollout is one reported epoch
(``bridges.tape.reporter_callback``): checkpoint, the validation score, the
best-validation policy kept. An off-policy agent collects ``rollout_length``
steps, then takes ``rollout_length`` gradient steps.

P(up), read from a float64 copy of the policy (``PolicyReadout``):
    discrete (ppo, a2c, trpo)  pi(long) / (pi(long) + pi(short))
    sac                        Phi(mu / sigma), the Gaussian's mass above 0 before the tanh
    ddpg, td3                  sigmoid(k * the actor's output before the tanh),
                               k >= 0 fitted on validation rows

The policy is saved as its state dict and rebuilt at load from the saved
architecture (observation size, network sizes), so a reload never needs the
environment or the replay buffer.
"""

from __future__ import annotations

import copy
import math

import numpy as np
import torch
from gymnasium import spaces
from scipy.stats import norm
from torch import nn

from cycle.bridges import calibration
from cycle.bridges.tape import TapeEnvironment, reporter_callback
from cycle.bridges.training import ValidationScore

from .readout import OBSERVATION_CLIP, FitContext, greedy_positions, long_share, observation_rows
from .trainers import FIT_THREADS, seeded

ON_POLICY = ("ppo", "a2c", "trpo")
OFF_POLICY = ("sac", "ddpg", "td3")
SB3_VARIANTS = ON_POLICY + OFF_POLICY


def _spaces(input_size: int, variant: str):
    observation = spaces.Box(-OBSERVATION_CLIP, OBSERVATION_CLIP, shape=(int(input_size),), dtype=np.float32)
    action = spaces.Discrete(3) if variant in ON_POLICY else spaces.Box(-1.0, 1.0, (1,), np.float32)
    return observation, action


def _net_arch(parameters: dict) -> list[int]:
    return [int(parameters["hidden_size"])] * int(parameters["layer_count"])


def build_policy(variant: str, architecture: dict) -> nn.Module:
    """The policy network of a variant, rebuilt from its saved architecture."""
    observation, action = _spaces(architecture["input_size"], variant)
    net_arch = list(architecture["net_arch"])

    def schedule(_progress):
        return 0.0

    if variant in ON_POLICY:
        from stable_baselines3.common.policies import ActorCriticPolicy

        return ActorCriticPolicy(observation, action, schedule, net_arch=dict(pi=net_arch, vf=net_arch),
                                 activation_fn=nn.Tanh)
    if variant == "sac":
        from stable_baselines3.sac.policies import SACPolicy

        return SACPolicy(observation, action, schedule, net_arch=net_arch)
    from stable_baselines3.td3.policies import TD3Policy

    return TD3Policy(observation, action, schedule, net_arch=net_arch, n_critics=1 if variant == "ddpg" else 2)


class PolicyReadout:
    """The readout of one variant from a policy module of any dtype."""

    def __init__(self, variant: str) -> None:
        self.variant = variant

    def raw(self, policy: nn.Module, observations: np.ndarray) -> np.ndarray:
        """discrete: (rows, 3) action probabilities; sac: (rows, 2) mean and
        standard deviation before the tanh; ddpg / td3: (rows,) the actor's
        output before the tanh."""
        dtype = next(policy.parameters()).dtype
        inputs = torch.as_tensor(observations, dtype=dtype)
        with torch.no_grad():
            if self.variant in ON_POLICY:
                features = policy.features_extractor(inputs)
                logits = policy.action_net(policy.mlp_extractor.forward_actor(features))
                return torch.softmax(logits, dim=-1).double().numpy()
            actor = policy.actor
            features = actor.features_extractor(inputs)
            if self.variant == "sac":
                from stable_baselines3.sac.policies import LOG_STD_MAX, LOG_STD_MIN

                latent = actor.latent_pi(features)
                mean = actor.mu(latent)[:, 0]
                deviation = torch.exp(torch.clamp(actor.log_std(latent)[:, 0], LOG_STD_MIN, LOG_STD_MAX))
                return torch.stack([mean, deviation], dim=1).double().numpy()
            return actor.mu[:-1](features)[:, 0].double().numpy()           # the last module is the tanh

    def probability_and_position(self, policy: nn.Module, observations: np.ndarray, complete: np.ndarray,
                                 temperature: calibration.TemperatureScale | None = None):
        raw = self.raw(policy, observations)
        if self.variant in ON_POLICY:
            probability, position = long_share(raw), greedy_positions(raw)
        elif self.variant == "sac":
            probability = norm.cdf(raw[:, 0] / raw[:, 1])
            position = np.tanh(raw[:, 0])
        else:
            probability = temperature.apply(raw) if temperature is not None else calibration.sigmoid(raw)
            position = np.tanh(raw)
        probability = np.asarray(probability, dtype=np.float64)
        probability[~complete] = np.nan
        return probability, position

    def pre_tanh(self, policy: nn.Module, observations: np.ndarray) -> np.ndarray:
        return self.raw(policy, observations)


def _model(variant: str, environment, parameters: dict, seed: int, total_steps: int):
    common = dict(learning_rate=float(parameters["learning_rate"]), gamma=float(parameters["discount_factor"]),
                  seed=int(seed), device="cpu", verbose=0)
    net_arch = _net_arch(parameters)
    rollout = int(parameters["rollout_length"])
    if variant == "ppo":
        from stable_baselines3 import PPO

        return PPO("MlpPolicy", environment, n_steps=rollout, batch_size=int(parameters["batch_size"]),
                   n_epochs=int(parameters["optimization_passes"]), gae_lambda=float(parameters["generalized_advantage_decay"]),
                   clip_range=float(parameters["clip_range"]), ent_coef=float(parameters["entropy_coefficient"]),
                   vf_coef=float(parameters["value_loss_coefficient"]),
                   max_grad_norm=float(parameters["gradient_clipping_norm"]),
                   policy_kwargs=dict(net_arch=dict(pi=net_arch, vf=net_arch), activation_fn=nn.Tanh), **common)
    if variant == "a2c":
        from stable_baselines3 import A2C

        return A2C("MlpPolicy", environment, n_steps=rollout, gae_lambda=1.0,
                   ent_coef=float(parameters["entropy_coefficient"]), vf_coef=float(parameters["value_loss_coefficient"]),
                   max_grad_norm=float(parameters["gradient_clipping_norm"]),
                   policy_kwargs=dict(net_arch=dict(pi=net_arch, vf=net_arch), activation_fn=nn.Tanh), **common)
    if variant == "trpo":
        from sb3_contrib import TRPO

        return TRPO("MlpPolicy", environment, n_steps=rollout, batch_size=int(parameters["batch_size"]),
                    target_kl=float(parameters["trust_region_size"]),
                    cg_max_steps=int(parameters["conjugate_gradient_steps"]),
                    n_critic_updates=int(parameters["critic_updates"]),
                    gae_lambda=float(parameters["generalized_advantage_decay"]),
                    policy_kwargs=dict(net_arch=dict(pi=net_arch, vf=net_arch), activation_fn=nn.Tanh), **common)
    off_policy = dict(buffer_size=max(total_steps + 1, 1000), batch_size=int(parameters["batch_size"]),
                      learning_starts=min(int(parameters["batch_size"]), max(1, total_steps // 10)),
                      tau=float(parameters["target_update_rate"]), train_freq=(rollout, "step"), gradient_steps=rollout,
                      policy_kwargs=dict(net_arch=net_arch))
    if variant == "sac":
        from stable_baselines3 import SAC

        return SAC("MlpPolicy", environment, ent_coef="auto", **off_policy, **common)
    from stable_baselines3.common.noise import NormalActionNoise

    noise = NormalActionNoise(mean=np.zeros(1), sigma=np.full(1, float(parameters["action_noise_scale"])))
    if variant == "ddpg":
        from stable_baselines3 import DDPG

        return DDPG("MlpPolicy", environment, action_noise=noise, **off_policy, **common)
    from stable_baselines3 import TD3

    return TD3("MlpPolicy", environment, action_noise=noise, policy_delay=int(parameters["actor_update_interval"]),
               target_policy_noise=float(parameters["target_smoothing_noise"]),
               target_noise_clip=float(parameters["target_smoothing_clip"]), **off_policy, **common)


class StableBaselinesAgent:
    discrete = True

    def __init__(self, parameters: dict, seed: int, architecture: dict, variant: str) -> None:
        if variant not in SB3_VARIANTS:
            raise ValueError(f"not a Stable-Baselines3 variant: {variant!r}")
        self.parameters = dict(parameters)
        self.seed = int(seed)
        self.variant = variant
        self.discrete = variant in ON_POLICY
        self.architecture = {**architecture, "net_arch": _net_arch(parameters)}
        self.readout = PolicyReadout(variant)
        self.policy: nn.Module | None = None
        self._double: nn.Module | None = None
        self.extra: dict = {}
        self.summary: dict = {}

    # ── fitting ──
    def _environment(self, context: FitContext, offset: int):
        return TapeEnvironment(context.features, context.tape, context.train_rows,
                               action_kind="discrete" if self.discrete else "continuous",
                               episode_length=int(self.parameters["episode_bars"]), reward_mode="horizon",
                               observation_clip=OBSERVATION_CLIP, seed=self.seed + offset)

    def _temperature(self) -> calibration.TemperatureScale | None:
        document = self.extra.get("temperature")
        return calibration.TemperatureScale.from_dict(document) if document else None

    def _score(self, policy: nn.Module, context: FitContext) -> ValidationScore:
        rows = context.evaluator.rows
        if rows.size == 0:
            return ValidationScore(None, None, None, None)
        observations, complete = observation_rows(context.features, rows)
        probability, position = self.readout.probability_and_position(policy, observations, complete)
        return context.evaluator.classification(probability, np.nan_to_num(position))

    def fit(self, context: FitContext) -> dict:
        from stable_baselines3.common.vec_env import DummyVecEnv

        environment_count = int(self.parameters.get("environment_count", 1)) if self.variant == "a2c" else 1
        steps = int(self.parameters["training_sweeps"]) * int(context.train_rows.size)
        rollout = int(self.parameters["rollout_length"]) * environment_count
        rollout_count = max(1, math.ceil(steps / rollout))
        total_steps = rollout_count * rollout
        with seeded(self.seed, FIT_THREADS):
            environment = DummyVecEnv([(lambda offset=offset: self._environment(context, offset))
                                       for offset in range(environment_count)])
            model = _model(self.variant, environment, self.parameters, self.seed, total_steps)
            callback = reporter_callback(context.reporter, rollout_count=rollout_count, train_index=context.train_rows,
                                         evaluate=lambda: self._score(model.policy, context), name=context.name)
            model.learn(total_timesteps=total_steps, callback=callback)
            # the rollouts are scored before their own update, so the policy after the last update is scored here
            final = self._score(model.policy, context).selection
            if final is None or not math.isfinite(final) or final >= callback.best_selection:
                best_rollout = callback.restore_best()
            else:
                best_rollout = callback.rollout + 1
        # a fresh policy object holding only the chosen weights (the trained one keeps references to its
        # optimiser and rollout tensors, which neither deep-copy nor belong in the saved model)
        with seeded(self.seed):
            self.policy = build_policy(self.variant, self.architecture)
        self.policy.load_state_dict(model.policy.state_dict())
        self.policy.eval()
        self._double = None
        if not self.discrete and self.variant != "sac":
            rows = context.evaluator.rows
            observations, complete = observation_rows(context.features, rows)
            raw = self.readout.pre_tanh(self.policy, observations)
            raw[~complete] = np.nan
            self.extra["temperature"] = calibration.TemperatureScale.fit(
                raw, np.asarray(context.labels, dtype=np.float64)[rows]).to_dict()
        self.summary = {"trained_epochs": callback.rollout, "best_epoch": best_rollout, "total_steps": total_steps,
                        "best_selection": None if math.isinf(callback.best_selection) else callback.best_selection}
        return self.summary

    # ── prediction ──
    def _double_policy(self) -> nn.Module:
        if self._double is None:
            self._double = copy.deepcopy(self.policy).double().eval()
        return self._double

    def probability(self, features: np.ndarray, rows) -> np.ndarray:
        observations, complete = observation_rows(features, rows)
        probability, _ = self.readout.probability_and_position(self._double_policy(), observations, complete,
                                                               self._temperature())
        return probability

    # ── persistence ──
    def state(self) -> dict:
        return {"architecture": dict(self.architecture), "extra": dict(self.extra),
                "weights": {"policy": self.policy.state_dict()}}

    @classmethod
    def from_state(cls, parameters: dict, seed: int, state: dict, variant: str) -> StableBaselinesAgent:
        agent = cls(parameters, seed, state["architecture"], variant)
        agent.architecture = dict(state["architecture"])
        with seeded(seed):
            policy = build_policy(variant, agent.architecture)
        policy.load_state_dict(state["weights"]["policy"])
        agent.policy = policy.eval()
        agent.extra = dict(state.get("extra") or {})
        return agent


__all__ = ["OFF_POLICY", "ON_POLICY", "SB3_VARIANTS", "PolicyReadout", "StableBaselinesAgent", "build_policy"]
