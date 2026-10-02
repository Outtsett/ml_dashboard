"""The dynamics blocks of the world-model agents (torch).

    MixtureDensityRecurrent     World Models' memory M: an LSTM over the V latents with a
                                mixture-density head for p(z_{t+1} | z_<=t) and a reward head
    GaussianTransition          a latent transition p(z' | z) (DeepMDP, bisimulation)
    WindowEnvironmentModel      an environment model on the window: the next feature row
                                (Gaussian) and the reward (the scaled tape move); ``step`` rolls
                                the window forward one imagined bar (hybrid agent, I2A, SimPLe)
    DynamicsTransformer         a causally masked transformer over the window's bar tokens plus
                                one candidate-action token: next-row predictions at the bar
                                tokens, the action's reward at the action token
    DifferentialEquationRecurrent   an ODE-RNN (Rubanova et al. 2019): between bars the latent
                                follows dz/dt = f(z), integrated by torchdiffeq over the real
                                elapsed time; at each bar a GRU cell reads the row

As in ``representation``, no block takes the agent's own position as a state
input. The action enters only where the spec needs it (the transformer's
action token), and the reward it predicts is then a function of the action.

``planning_agent`` imports ``DynamicsTransformer`` (read-only).
"""

from __future__ import annotations

import math

import torch
from torch import nn

from .representation import gaussian, masked_mean, perceptron

ACTION_POSITIONS = (-1.0, 0.0, 1.0)                    # short, flat, long


class MixtureDensityRecurrent(nn.Module):
    """LSTM + mixture density network over a sequence of latents."""

    def __init__(self, latent_dimension: int, hidden_size: int, component_count: int) -> None:
        super().__init__()
        self.latent_dimension = int(latent_dimension)
        self.component_count = int(component_count)
        self.state_size = int(hidden_size)
        self.lstm = nn.LSTM(latent_dimension, hidden_size, batch_first=True)
        self.mixture = nn.Linear(hidden_size, self.component_count * (1 + 2 * self.latent_dimension))
        self.reward = nn.Linear(hidden_size, 1)

    def run(self, latents: torch.Tensor) -> torch.Tensor:
        hidden, _ = self.lstm(latents)
        return hidden

    def negative_log_likelihood(self, hidden: torch.Tensor, following: torch.Tensor) -> torch.Tensor:
        """-log p(following | hidden) under the mixture, per position."""
        batch_shape = hidden.shape[:-1]
        parameters = self.mixture(hidden).view(*batch_shape, self.component_count, 1 + 2 * self.latent_dimension)
        log_weight = torch.log_softmax(parameters[..., 0], -1)
        mean, std = gaussian(parameters[..., 1:], 1e-2)
        value = following.unsqueeze(-2)
        log_density = (-0.5 * ((value - mean) / std) ** 2 - torch.log(std) - 0.5 * math.log(2 * math.pi)).sum(-1)
        return -torch.logsumexp(log_weight + log_density, -1)


class GaussianTransition(nn.Module):
    """p(z' | z) = N(mean(z), std(z))."""

    def __init__(self, latent_dimension: int, hidden_size: int) -> None:
        super().__init__()
        self.network = perceptron(latent_dimension, hidden_size, 2 * latent_dimension, 1)

    def forward(self, latent: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return gaussian(self.network(latent), 1e-2)


class WindowEnvironmentModel(nn.Module):
    """Next feature row and reward from the window (the environment model)."""

    def __init__(self, feature_count: int, length: int, hidden_size: int) -> None:
        super().__init__()
        self.feature_count = int(feature_count)
        self.length = int(length)
        self.body = perceptron(self.feature_count * self.length, hidden_size, hidden_size, 1)
        self.next_row = nn.Linear(hidden_size, 2 * self.feature_count)
        self.reward = nn.Linear(hidden_size, 1)

    def forward(self, window: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        body = torch.nn.functional.elu(self.body(window.flatten(1)))
        mean, std = gaussian(self.next_row(body), 1e-2)
        return mean, std, self.reward(body).squeeze(-1)

    def step(self, window: torch.Tensor, noise: torch.Tensor | None = None) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """(the next window, the imagined next row, the reward predicted for the current window)."""
        mean, std, reward = self(window)
        row = mean if noise is None else mean + std * noise
        return torch.cat([window[:, 1:], row.unsqueeze(1)], 1), row, reward

    def loss(self, batch: dict, reward_key: str = "move") -> tuple[torch.Tensor, dict]:
        mean, std, reward = self(batch["window"])
        following = batch["next_series"][:, -1]
        known = batch["next_mask"]
        negative_log_likelihood = (0.5 * ((following - mean) / std) ** 2 + torch.log(std)).sum(-1)
        transition = masked_mean(negative_log_likelihood, known)
        reward_loss = masked_mean((reward - batch[reward_key]) ** 2, batch[reward_key + "_mask"])
        return transition + reward_loss, {"transition": float(transition.detach()), "reward": float(reward_loss.detach())}


class DynamicsTransformer(nn.Module):
    """Bar tokens t-L+1..t and one action token, causally masked."""

    def __init__(self, feature_count: int, length: int, model_dimension: int, head_count: int, layer_count: int) -> None:
        super().__init__()
        self.length = int(length)
        dimension = int(model_dimension)
        self.state_size = dimension
        self.input = nn.Linear(feature_count, dimension)
        self.position = nn.Parameter(torch.zeros(self.length + 1, dimension))
        nn.init.normal_(self.position, std=0.02)
        self.action = nn.Embedding(len(ACTION_POSITIONS), dimension)
        layer = nn.TransformerEncoderLayer(dimension, int(head_count), 2 * dimension, dropout=0.0, batch_first=True)
        self.encoder = nn.TransformerEncoder(layer, int(layer_count), enable_nested_tensor=False)
        self.next_row = nn.Linear(dimension, feature_count)
        self.reward = nn.Linear(dimension, 1)
        self.value = nn.Linear(dimension, 1)
        mask = torch.triu(torch.full((self.length + 1, self.length + 1), float("-inf")), diagonal=1)
        self.register_buffer("causal_mask", mask, persistent=False)

    def forward(self, window: torch.Tensor, actions: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """(bar-token outputs (B, L, D), the action token's output (B, D))."""
        tokens = torch.cat([self.input(window), self.action(actions).unsqueeze(1)], 1) + self.position
        out = self.encoder(tokens, mask=self.causal_mask.to(tokens.dtype), is_causal=True)
        return out[:, :-1], out[:, -1]

    def action_rewards(self, window: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """(predicted reward of each action (B, 3), the bar-token outputs of the first pass)."""
        batch = window.shape[0]
        repeated = window.repeat(len(ACTION_POSITIONS), 1, 1)
        actions = torch.arange(len(ACTION_POSITIONS), device=window.device).repeat_interleave(batch)
        bars, action_token = self(repeated, actions)
        rewards = self.reward(action_token).squeeze(-1).view(len(ACTION_POSITIONS), batch).transpose(0, 1)
        return rewards, bars[:batch]


class DifferentialEquationRecurrent(nn.Module):
    """ODE-RNN over the window, integrating over the real elapsed time between bars."""

    def __init__(self, feature_count: int, hidden_size: int, latent_dimension: int, solver: str = "rk4",
                 step_fraction: float = 0.25) -> None:
        super().__init__()
        self.latent_dimension = int(latent_dimension)
        self.state_size = self.latent_dimension
        self.solver = str(solver)
        self.step_fraction = float(step_fraction)
        self.encoder = nn.Linear(feature_count, latent_dimension)
        self.derivative = perceptron(latent_dimension, hidden_size, latent_dimension, 2, nn.Tanh)
        self.cell = nn.GRUCell(feature_count, latent_dimension)
        self.decoder = perceptron(latent_dimension, hidden_size, feature_count, 1)
        self.reward = perceptron(latent_dimension, hidden_size, 1, 1)
        self.horizon_return = perceptron(latent_dimension, hidden_size, 1, 1)

    def integrate(self, latent: torch.Tensor, span: torch.Tensor) -> torch.Tensor:
        """z after ``span`` bar intervals (per row): dz/ds = span * f(z) on s in [0, 1], a fixed
        grid, so a row's answer does not depend on the other rows of its batch."""
        from torchdiffeq import odeint

        span = span.reshape(-1, 1).to(latent.dtype)

        def field(_time, value):
            return span * self.derivative(value)

        grid = torch.tensor([0.0, 1.0], dtype=latent.dtype, device=latent.device)
        options = {"step_size": self.step_fraction} if self.solver in ("rk4", "euler", "midpoint") else None
        return odeint(field, latent, grid, method=self.solver, options=options)[-1]

    def run(self, window: torch.Tensor, elapsed: torch.Tensor) -> dict:
        """Filter the window; ``predicted`` holds the decoded row predicted for each bar
        from the latent integrated up to it (the first bar has none)."""
        latent = torch.tanh(self.encoder(window[:, 0]))
        latent = self.cell(window[:, 0], latent)
        predicted = [torch.zeros_like(window[:, 0])]
        for step in range(1, window.shape[1]):
            evolved = self.integrate(latent, elapsed[:, step])
            predicted.append(self.decoder(evolved))
            latent = self.cell(window[:, step], evolved)
        return {"latent": latent, "predicted": torch.stack(predicted, 1)}

    def state(self, window: torch.Tensor, elapsed: torch.Tensor) -> torch.Tensor:
        return self.run(window, elapsed)["latent"]

    def forecast(self, latent: torch.Tensor, horizon: int) -> torch.Tensor:
        """The return decoded from the latent integrated ``horizon`` bars ahead."""
        span = torch.full((latent.shape[0],), float(horizon), dtype=latent.dtype, device=latent.device)
        return self.horizon_return(self.integrate(latent, span)).squeeze(-1)

    def loss(self, batch: dict, reward_key: str = "move") -> tuple[torch.Tensor, dict, torch.Tensor]:
        window = batch["window"]
        out = self.run(window, batch["elapsed_series"])
        one_step = ((out["predicted"][:, 1:] - window[:, 1:]) ** 2).sum(-1).mean()
        following = self.decoder(self.integrate(out["latent"], torch.ones(window.shape[0], dtype=window.dtype)))
        next_loss = masked_mean(((following - batch["next_series"][:, -1]) ** 2).sum(-1), batch["next_mask"])
        reward = masked_mean((self.reward(out["latent"]).squeeze(-1) - batch[reward_key]) ** 2,
                             batch[reward_key + "_mask"])
        total = one_step + next_loss + reward
        return total, {"one_step": float(one_step.detach()), "reward": float(reward.detach())}, out["latent"]


__all__ = ["ACTION_POSITIONS", "DifferentialEquationRecurrent", "DynamicsTransformer", "GaussianTransition",
           "MixtureDensityRecurrent", "WindowEnvironmentModel"]
