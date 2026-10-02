"""The Q-network of the deep value agents, and the two targets it learns from.

``QNetwork`` maps one bar's causal feature row to a value per action
(0 short, 1 flat, 2 long, ``cycle.bridges.tape.ACTION_POSITIONS``):

    encoder     layer_count x (Linear -> ReLU), width hidden_size
    head        plain:    Linear(hidden, actions * atoms)
                dueling:  value stream  Linear(hidden, hidden) -> ReLU -> Linear(hidden, atoms)
                          advantage     Linear(hidden, hidden) -> ReLU -> Linear(hidden, actions * atoms)
                          Q = V + (A - mean over actions of A)            (Wang et al. 2016)
    noisy       every head layer is a NoisyLinear (Fortunato et al. 2018): factorised Gaussian noise
                w = mu + sigma * f(e_out) f(e_in)^T, f(x) = sign(x) sqrt(|x|); the noise is drawn only
                by ``reset_noise`` and applied only in training mode, so prediction reads the mean weights
    atoms       1 = one expected value per action (DQN); N > 1 = a categorical distribution over N fixed
                return atoms on [value_floor, value_limit] (default floor -value_limit; C51, Bellemare
                et al. 2017), the dueling
                recombination applied to the logits of every atom before the softmax

``double_q_target`` and ``categorical_projection`` are the two Bellman targets
(Double DQN's decoupled one included), written as plain functions so the
tests can check them against a hand calculation. ``QNetwork`` and the targets
are exported read-only for ``hierarchical_agent``.
"""

from __future__ import annotations

import math

import torch
from torch import nn
from torch.nn import functional

ACTION_COUNT = 3
SHORT, FLAT, LONG = 0, 1, 2


def _scaled_noise(size: int, generator: torch.Generator) -> torch.Tensor:
    """f(x) = sign(x) sqrt(|x|) of standard normal draws (the factorised-noise transform)."""
    draw = torch.randn(size, generator=generator)
    return draw.sign() * draw.abs().sqrt()


class NoisyLinear(nn.Module):
    """A linear layer with learned, factorised Gaussian weight noise. The noise
    buffers are not saved (``persistent=False``): a reloaded layer predicts with
    its mean weights, like every layer in evaluation mode."""

    def __init__(self, input_size: int, output_size: int, initial_noise_scale: float = 0.5) -> None:
        super().__init__()
        self.input_size = int(input_size)
        self.output_size = int(output_size)
        bound = 1.0 / math.sqrt(self.input_size)
        self.weight_mean = nn.Parameter(torch.empty(self.output_size, self.input_size).uniform_(-bound, bound))
        self.bias_mean = nn.Parameter(torch.empty(self.output_size).uniform_(-bound, bound))
        noise = float(initial_noise_scale) / math.sqrt(self.input_size)
        self.weight_noise_scale = nn.Parameter(torch.full((self.output_size, self.input_size), noise))
        self.bias_noise_scale = nn.Parameter(torch.full((self.output_size,), noise))
        self.register_buffer("input_noise", torch.zeros(self.input_size), persistent=False)
        self.register_buffer("output_noise", torch.zeros(self.output_size), persistent=False)

    def reset_noise(self, generator: torch.Generator) -> None:
        device = self.weight_mean.device
        self.input_noise.copy_(_scaled_noise(self.input_size, generator).to(device))
        self.output_noise.copy_(_scaled_noise(self.output_size, generator).to(device))

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        if not self.training:
            return functional.linear(inputs, self.weight_mean, self.bias_mean)
        weight = self.weight_mean + self.weight_noise_scale * torch.outer(self.output_noise, self.input_noise)
        bias = self.bias_mean + self.bias_noise_scale * self.output_noise
        return functional.linear(inputs, weight, bias)


class QNetwork(nn.Module):
    """See the module docstring. ``forward`` returns the expected action values
    (batch, actions); ``log_distribution`` the per-action log probabilities over
    the atoms (batch, actions, atoms) of a distributional network."""

    def __init__(self, input_size: int, hidden_size: int = 128, layer_count: int = 2, *, dueling: bool = False,
                 noisy: bool = False, atom_count: int = 1, value_limit: float = 10.0,
                 initial_noise_scale: float = 0.5, action_count: int = ACTION_COUNT,
                 value_floor: float | None = None) -> None:
        super().__init__()
        if int(layer_count) < 1:
            raise ValueError(f"layer_count must be >= 1, got {layer_count}")
        if int(atom_count) < 1:
            raise ValueError(f"atom_count must be >= 1, got {atom_count}")
        self.input_size = int(input_size)
        self.hidden_size = int(hidden_size)
        self.layer_count = int(layer_count)
        self.dueling = bool(dueling)
        self.noisy = bool(noisy)
        self.atom_count = int(atom_count)
        self.action_count = int(action_count)
        self.value_limit = float(value_limit)
        self.value_floor = -self.value_limit if value_floor is None else float(value_floor)
        if self.atom_count > 1 and not self.value_floor < self.value_limit:
            raise ValueError(f"the support needs value_floor < value_limit, got {self.value_floor} and {self.value_limit}")
        self.initial_noise_scale = float(initial_noise_scale)
        layers: list[nn.Module] = []
        width = self.input_size
        for _ in range(self.layer_count):
            layers += [nn.Linear(width, self.hidden_size), nn.ReLU()]
            width = self.hidden_size

        self.encoder = nn.Sequential(*layers)

        def linear(inputs: int, outputs: int) -> nn.Module:
            return NoisyLinear(inputs, outputs, self.initial_noise_scale) if self.noisy else nn.Linear(inputs, outputs)

        outputs = self.action_count * self.atom_count
        if self.dueling:
            self.value_stream = nn.Sequential(linear(width, self.hidden_size), nn.ReLU(),
                                              linear(self.hidden_size, self.atom_count))
            self.advantage_stream = nn.Sequential(linear(width, self.hidden_size), nn.ReLU(),
                                                  linear(self.hidden_size, outputs))
        else:
            self.head = linear(width, outputs)
        support = torch.linspace(self.value_floor, self.value_limit, self.atom_count) if self.atom_count > 1 \
            else torch.zeros(1)
        self.register_buffer("support", support)

    @property
    def distributional(self) -> bool:
        return self.atom_count > 1

    def architecture(self) -> dict:
        """The constructor arguments (plain values), enough to rebuild the network for its state dict."""
        return {"input_size": self.input_size, "hidden_size": self.hidden_size, "layer_count": self.layer_count,
                "dueling": self.dueling, "noisy": self.noisy, "atom_count": self.atom_count,
                "value_limit": self.value_limit, "initial_noise_scale": self.initial_noise_scale,
                "action_count": self.action_count, "value_floor": self.value_floor}

    def reset_noise(self, generator: torch.Generator) -> None:
        for module in self.modules():
            if isinstance(module, NoisyLinear):
                module.reset_noise(generator)

    def _outputs(self, inputs: torch.Tensor) -> torch.Tensor:
        """(batch, actions, atoms): action values, or per-atom logits of a distributional head."""
        hidden = self.encoder(inputs)
        shape = (-1, self.action_count, self.atom_count)
        if not self.dueling:
            return self.head(hidden).view(shape)
        value = self.value_stream(hidden).view(-1, 1, self.atom_count)
        advantage = self.advantage_stream(hidden).view(shape)
        return value + advantage - advantage.mean(dim=1, keepdim=True)

    def log_distribution(self, inputs: torch.Tensor) -> torch.Tensor:
        if not self.distributional:
            raise TypeError("log_distribution needs a distributional network (atom_count > 1)")
        return torch.log_softmax(self._outputs(inputs), dim=2)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        outputs = self._outputs(inputs)
        if not self.distributional:
            return outputs.squeeze(2)
        return (torch.softmax(outputs, dim=2) * self.support).sum(dim=2)


def double_q_target(rewards: torch.Tensor, done: torch.Tensor, discount: torch.Tensor, next_online: torch.Tensor,
                    next_target: torch.Tensor, double: bool) -> torch.Tensor:
    """The scalar Bellman target y = r + (1 - done) * discount * Q_target(s', a*).

    DQN: a* = argmax_a Q_target(s', a) (the target network selects and evaluates).
    Double DQN: a* = argmax_a Q_online(s', a) (the online network selects, the
    target network evaluates: van Hasselt et al. 2016). ``discount`` is the
    per-transition discount (gamma ** k for a k-step return)."""
    chooser = next_online if double else next_target
    best = chooser.argmax(dim=1, keepdim=True)
    bootstrap = next_target.gather(1, best).squeeze(1)
    return rewards + (1.0 - done) * discount * bootstrap


def categorical_projection(next_probabilities: torch.Tensor, rewards: torch.Tensor, done: torch.Tensor,
                           discount: torch.Tensor, support: torch.Tensor) -> torch.Tensor:
    """Project the distribution r + (1 - done) * discount * Z(s', a*) onto the
    fixed atoms ``support`` (C51, Bellemare et al. 2017, Algorithm 1): each
    shifted atom's mass is split between its two neighbouring support atoms in
    proportion to the distance, clamped to the support's ends. The rows of the
    result each sum to the rows of ``next_probabilities`` (1)."""
    atom_count = int(support.shape[0])
    low, high = float(support[0]), float(support[-1])
    spacing = (high - low) / (atom_count - 1)
    shifted = rewards.unsqueeze(1) + ((1.0 - done) * discount).unsqueeze(1) * support.unsqueeze(0)
    position = (shifted.clamp(low, high) - low) / spacing
    lower = position.floor().long().clamp(0, atom_count - 1)
    upper = position.ceil().long().clamp(0, atom_count - 1)
    upper_share = position - lower.to(position.dtype)
    lower_share = 1.0 - upper_share
    projected = torch.zeros_like(next_probabilities)
    projected.scatter_add_(1, lower, next_probabilities * lower_share)
    projected.scatter_add_(1, upper, next_probabilities * upper_share)
    return projected


__all__ = ["ACTION_COUNT", "FLAT", "LONG", "SHORT", "NoisyLinear", "QNetwork", "categorical_projection",
           "double_q_target"]
