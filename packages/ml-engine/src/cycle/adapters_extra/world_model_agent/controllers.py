"""The controllers of the world-model agents: how a state becomes {short, flat, long}.

The reward of a decision at bar t is known for every action once the tape
move m_t (open[t+1+h] - open[t+1], scaled) and the round-trip cost c_t are:
r(short) = -m - c, r(flat) = 0, r(long) = m - c. The market does not react to
the agent, so the reward is the whole consequence of the action and the
agent's own position is not part of its state.

    ActorCriticHead         policy logits over the three actions and a state value.
                            ``actor_critic_loss`` is the advantage actor-critic update with
                            EVERY action's reward (the all-action / expected policy gradient,
                            Ciosek and Whiteson 2018): with the reward of each action known on
                            the tape there is no reason to sample one and score it.
    imagination_actor_critic   Dreamer's behaviour learning: imagined rollouts of the latent
                            prior from real starting states, the reward head's r(a) at every
                            imagined state, a critic on lambda-returns (``trace_decay``) and an
                            actor through the rollout ("dynamics", Dreamer V1) or by REINFORCE
                            with the critic as baseline ("reinforce", V2/V3), optionally with
                            percentile return normalisation (V3)
    LinearController        World Models' C: one linear map [z; h] -> three action scores,
                            searched by CMA-ES (``cma``) against the tape's net reward
    RolloutEncoder          I2A: an LSTM reading an imagined trajectory backwards
    abstract_value_iteration   value iteration on an abstract (clustered) MDP
    PolicyNetwork           the actor of a Stable-Baselines3 PPO policy, copied out of it

P(up) is always the policy's share of long over long + short (``long_share``).
"""

from __future__ import annotations

import numpy as np
import torch
from torch import nn

from .representation import masked_mean, perceptron

SHORT, FLAT, LONG = 0, 1, 2


def action_rewards(move: torch.Tensor, cost: torch.Tensor) -> torch.Tensor:
    """(..., 3) reward of short, flat, long."""
    return torch.stack([-move - cost, torch.zeros_like(move), move - cost], -1)


def long_share(logits: torch.Tensor) -> torch.Tensor:
    """pi(long) / (pi(long) + pi(short)) = sigmoid(logit_long - logit_short)."""
    return torch.sigmoid(logits[..., LONG] - logits[..., SHORT])


class ActorCriticHead(nn.Module):
    def __init__(self, state_size: int, hidden_size: int) -> None:
        super().__init__()
        self.policy = perceptron(state_size, hidden_size, 3, 1)
        self.value = perceptron(state_size, hidden_size, 1, 1)

    def forward(self, state: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return self.policy(state), self.value(state).squeeze(-1)


def actor_critic_loss(head: ActorCriticHead, state: torch.Tensor, move: torch.Tensor, cost: torch.Tensor,
                      mask: torch.Tensor, entropy_coefficient: float, weight: torch.Tensor | None = None) -> torch.Tensor:
    """All-action advantage actor-critic on known rewards (see the module docstring)."""
    logits, value = head(state)
    log_policy = torch.log_softmax(logits, -1)
    policy = log_policy.exp()
    rewards = action_rewards(move, cost)
    expected = (policy * rewards).sum(-1)
    advantage = rewards - value.detach().unsqueeze(-1)
    actor = -(policy * advantage).sum(-1)
    entropy = -(policy * log_policy).sum(-1)
    critic = (value - expected.detach()) ** 2
    per_row = actor - entropy_coefficient * entropy + 0.5 * critic
    if weight is not None:
        per_row = per_row * weight
    return masked_mean(per_row, mask)


def lambda_returns(rewards: torch.Tensor, values: torch.Tensor, discounts: torch.Tensor, trace_decay: float) -> torch.Tensor:
    """TD(lambda) returns over an imagined trajectory. ``rewards`` and ``discounts`` (B, T),
    ``values`` (B, T + 1) with the bootstrap last; returns (B, T)."""
    steps = rewards.shape[1]
    out = []
    following = values[:, -1]
    for step in reversed(range(steps)):
        following = rewards[:, step] + discounts[:, step] * (
            (1.0 - trace_decay) * values[:, step + 1] + trace_decay * following)
        out.append(following)
    return torch.stack(list(reversed(out)), 1)


def imagination_actor_critic(model, head: ActorCriticHead, start_h: torch.Tensor, start_z: torch.Tensor,
                             cost: torch.Tensor, *, horizon: int, discount_factor: float, trace_decay: float,
                             entropy_coefficient: float, actor_gradient: str, return_normalization: bool,
                             generator: torch.Generator) -> tuple[torch.Tensor, torch.Tensor, dict]:
    """(actor loss, critic loss, diagnostics) from imagined rollouts of ``model``'s prior
    (a ``RecurrentStateSpaceModel``) starting at the given (detached) states.

    The latents do not depend on the action (the market does not react), so a
    rollout is imagined once and every imagined state is scored for every action
    by the reward head: r_k(a) = a * m_hat(s_k) - |a| c. The critic regresses
    V(s_k) on the lambda-return of the actor's own expected rewards; the actor
    maximises the imagined return either through the differentiable reward of
    each action ("dynamics") or by REINFORCE on a sampled action with the critic
    as baseline ("reinforce"), plus the entropy bonus."""
    with torch.no_grad():
        h, z = start_h.detach(), start_z.detach()
        states = [torch.cat([h, z], -1)]
        for _ in range(int(horizon)):
            h, z = model.imagine_step(h, z, generator)
            states.append(torch.cat([h, z], -1))
        states = torch.stack(states, 1)                                         # (B, T + 1, S)
        move = model.reward(states[:, :-1]).squeeze(-1)                         # (B, T)
        continuation = torch.sigmoid(model.continuation(states[:, 1:])).squeeze(-1)
    frozen = states
    logits, values = head(frozen)
    log_policy = torch.log_softmax(logits[:, :-1], -1)
    policy = log_policy.exp()
    rewards = action_rewards(move, cost.unsqueeze(-1).expand_as(move))           # (B, T, 3)
    expected = (policy.detach() * rewards).sum(-1)
    discounts = discount_factor * continuation
    targets = lambda_returns(expected, values.detach(), discounts, trace_decay)
    critic = ((values[:, :-1] - targets) ** 2).mean()
    entropy = -(policy * log_policy).sum(-1)
    advantage = targets - values[:, :-1].detach()
    scale = torch.ones((), dtype=advantage.dtype)
    if return_normalization:
        spread = torch.quantile(targets.detach().flatten(), 0.95) - torch.quantile(targets.detach().flatten(), 0.05)
        scale = torch.clamp(spread, min=1.0)
    if actor_gradient == "reinforce":
        choice = torch.multinomial(policy.detach().reshape(-1, 3), 1, generator=generator).reshape(policy.shape[:-1])
        chosen = log_policy.gather(-1, choice.unsqueeze(-1)).squeeze(-1)
        actor = -(chosen * (advantage / scale)).mean()
    else:
        # dynamics: the gradient of the expected imagined reward through the policy at every step,
        # discounted as the return discounts it (the rollout itself carries no action dependence)
        weights = torch.cumprod(torch.cat([torch.ones_like(discounts[:, :1]), discounts[:, :-1]], 1), 1).detach()
        actor = -((policy * rewards).sum(-1) * weights / scale).mean()
    actor = actor - entropy_coefficient * entropy.mean()
    return actor, critic, {"imagined_return": float(targets[:, 0].mean().detach())}


class LinearController(nn.Module):
    """World Models' controller C: scores = W [z; h] + b."""

    def __init__(self, state_size: int) -> None:
        super().__init__()
        self.state_size = int(state_size)
        self.register_buffer("weight", torch.zeros(3, self.state_size))
        self.register_buffer("bias", torch.zeros(3))

    @property
    def parameter_count(self) -> int:
        return 3 * self.state_size + 3

    def set_vector(self, vector: np.ndarray) -> None:
        vector = torch.as_tensor(np.asarray(vector, dtype=np.float64), dtype=self.weight.dtype)
        self.weight.copy_(vector[: 3 * self.state_size].view(3, self.state_size))
        self.bias.copy_(vector[3 * self.state_size:])

    def forward(self, state: torch.Tensor) -> torch.Tensor:
        return state @ self.weight.T + self.bias


def controller_fitness(vectors: np.ndarray, states: np.ndarray, move: np.ndarray, cost: np.ndarray,
                       entropy_coefficient: float) -> np.ndarray:
    """Mean net reward (plus the entropy bonus) of the softmax policy of each candidate
    controller on the training states; vectorised over the population (P, 3 * S + 3)."""
    state_size = states.shape[1]
    weights = vectors[:, : 3 * state_size].reshape(-1, 3, state_size)
    bias = vectors[:, 3 * state_size:]
    logits = np.einsum("ns,pas->pna", states, weights) + bias[:, None, :]
    logits -= logits.max(-1, keepdims=True)
    policy = np.exp(logits)
    policy /= policy.sum(-1, keepdims=True)
    rewards = np.stack([-move - cost, np.zeros_like(move), move - cost], -1)
    expected = (policy * rewards[None]).sum(-1).mean(-1)
    entropy = -(policy * np.log(np.clip(policy, 1e-12, None))).sum(-1).mean(-1)
    return expected + entropy_coefficient * entropy


class CovarianceMatrixSearch:
    """CMA-ES (``cma``) over a linear controller's parameters, one generation per call.
    ``cma`` samples from numpy's global generator: its state is swapped in and out around
    every call so the search is reproducible and the process's own generator is untouched."""

    def __init__(self, dimension: int, population_size: int, seed: int, initial_step: float = 0.5) -> None:
        import cma

        outer = np.random.get_state()
        try:
            self.strategy = cma.CMAEvolutionStrategy(np.zeros(int(dimension)), float(initial_step), {
                "popsize": int(population_size), "seed": int(seed) % (2 ** 31 - 1) + 1, "verbose": -9,
                "verb_disp": 0, "verb_log": 0, "verb_filenameprefix": "", "CMA_diagonal": False})
            self.random_state = np.random.get_state()
        finally:
            np.random.set_state(outer)
        self.best_vector = np.zeros(int(dimension))
        self.best_fitness = -np.inf

    def generation(self, fitness_function) -> float:
        """One ask / evaluate / tell; returns the generation's best fitness."""
        outer = np.random.get_state()
        try:
            np.random.set_state(self.random_state)
            candidates = np.asarray(self.strategy.ask(), dtype=np.float64)
            fitness = np.asarray(fitness_function(candidates), dtype=np.float64)
            self.strategy.tell(list(candidates), list(-fitness))
            self.random_state = np.random.get_state()
        finally:
            np.random.set_state(outer)
        best = int(np.argmax(fitness))
        if fitness[best] > self.best_fitness:
            self.best_fitness = float(fitness[best])
            self.best_vector = candidates[best].copy()
        return float(fitness[best])


class RolloutEncoder(nn.Module):
    """I2A's rollout encoder: an LSTM over (imagined row, imagined reward), last step first."""

    def __init__(self, feature_count: int, hidden_size: int) -> None:
        super().__init__()
        self.lstm = nn.LSTM(feature_count + 1, hidden_size, batch_first=True)

    def forward(self, rows: torch.Tensor, rewards: torch.Tensor) -> torch.Tensor:
        sequence = torch.cat([rows, rewards.unsqueeze(-1)], -1).flip(1)
        _, (hidden, _) = self.lstm(sequence)
        return hidden[-1]


def abstract_value_iteration(clusters: np.ndarray, rewards: np.ndarray, successors: np.ndarray, cluster_count: int,
                             discount_factor: float, sweeps: int = 200) -> np.ndarray:
    """Q (K, 3) of the abstract MDP: R(k, a) the mean reward of action a over the rows of
    cluster k, P(k' | k) the Laplace-smoothed count of cluster k -> k' over consecutive
    training rows (``successors`` -1 where the next row is unknown or across a gap).
    The transition does not depend on the action (the market does not react)."""
    count = int(cluster_count)
    reward_table = np.zeros((count, 3))
    for cluster in range(count):
        members = clusters == cluster
        if members.any():
            reward_table[cluster] = rewards[members].mean(0)
    transitions = np.ones((count, count))
    known = successors >= 0
    np.add.at(transitions, (clusters[known], successors[known]), 1.0)
    transitions /= transitions.sum(1, keepdims=True)
    value = np.zeros(count)
    q_table = reward_table.copy()
    for _ in range(int(sweeps)):
        q_table = reward_table + discount_factor * (transitions @ value)[:, None]
        updated = q_table.max(1)
        if np.max(np.abs(updated - value)) < 1e-10:
            value = updated
            break
        value = updated
    return q_table


class PolicyNetwork(nn.Module):
    """The actor of an SB3 ``ActorCriticPolicy`` (net_arch pi=[H, H], tanh), copied out."""

    def __init__(self, input_size: int, hidden_size: int) -> None:
        super().__init__()
        self.body = nn.Sequential(nn.Linear(input_size, hidden_size), nn.Tanh(), nn.Linear(hidden_size, hidden_size),
                                  nn.Tanh())
        self.action = nn.Linear(hidden_size, 3)

    def copy_from(self, policy) -> None:
        state = policy.state_dict()
        with torch.no_grad():
            self.body[0].weight.copy_(state["mlp_extractor.policy_net.0.weight"])
            self.body[0].bias.copy_(state["mlp_extractor.policy_net.0.bias"])
            self.body[2].weight.copy_(state["mlp_extractor.policy_net.2.weight"])
            self.body[2].bias.copy_(state["mlp_extractor.policy_net.2.bias"])
            self.action.weight.copy_(state["action_net.weight"])
            self.action.bias.copy_(state["action_net.bias"])

    def forward(self, observation: torch.Tensor) -> torch.Tensor:
        return self.action(self.body(observation))


__all__ = ["ActorCriticHead", "CovarianceMatrixSearch", "FLAT", "LONG", "LinearController", "PolicyNetwork",
           "RolloutEncoder", "SHORT", "abstract_value_iteration", "action_rewards", "actor_critic_loss",
           "controller_fitness", "imagination_actor_critic", "lambda_returns", "long_share"]
