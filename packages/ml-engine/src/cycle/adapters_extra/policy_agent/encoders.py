"""The torch networks of the own-loop policy agents.

Every network reads float tensors of any dtype: the loops train in float32 and
the adapter predicts through a float64 copy (``double_copy``), so a row scored
alone equals the same row scored in a batch to double precision.

    MultilayerPerceptron        Linear + Tanh stack
    CategoricalPolicy           logits over {short, flat, long}
    ValueNetwork                a state value V(s)
    ActionValueNetwork          Q(s, a) for the three actions (Q-Prop's critic)
    CategoricalActorCritic      one trunk, a policy head and a value head (A3C)
    NormalizedAdvantageNetwork  V(s), mu(s) and the curvature P(s) of
                                Q(s, a) = V(s) - P(s) (a - mu(s))^2 / 2 (NAF)
    ModalityReasoningNetwork    per-modality encoders, cross-modal attention per
                                bar, a GRU over the window, policy / value /
                                price heads (the multi-modal reasoning agent)
"""

from __future__ import annotations

import copy

import torch
from torch import nn

ACTION_COUNT = 3


class MultilayerPerceptron(nn.Module):
    def __init__(self, input_size: int, hidden_size: int, layer_count: int, output_size: int | None = None) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        width = int(input_size)
        for _ in range(max(1, int(layer_count))):
            layers += [nn.Linear(width, int(hidden_size)), nn.Tanh()]
            width = int(hidden_size)
        if output_size is not None:
            layers.append(nn.Linear(width, int(output_size)))
        self.layers = nn.Sequential(*layers)
        self.output_size = int(output_size) if output_size is not None else width

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.layers(inputs)


class CategoricalPolicy(nn.Module):
    def __init__(self, input_size: int, hidden_size: int, layer_count: int) -> None:
        super().__init__()
        self.network = MultilayerPerceptron(input_size, hidden_size, layer_count, ACTION_COUNT)
        with torch.no_grad():          # a near-uniform first policy (the usual small last-layer init)
            self.network.layers[-1].weight.mul_(0.01)
            self.network.layers[-1].bias.zero_()

    def forward(self, observations: torch.Tensor) -> torch.Tensor:
        return self.network(observations)


class ValueNetwork(nn.Module):
    def __init__(self, input_size: int, hidden_size: int, layer_count: int) -> None:
        super().__init__()
        self.network = MultilayerPerceptron(input_size, hidden_size, layer_count, 1)

    def forward(self, observations: torch.Tensor) -> torch.Tensor:
        return self.network(observations).squeeze(-1)


class ActionValueNetwork(nn.Module):
    def __init__(self, input_size: int, hidden_size: int, layer_count: int) -> None:
        super().__init__()
        self.network = MultilayerPerceptron(input_size, hidden_size, layer_count, ACTION_COUNT)

    def forward(self, observations: torch.Tensor) -> torch.Tensor:
        return self.network(observations)


class CategoricalActorCritic(nn.Module):
    def __init__(self, input_size: int, hidden_size: int, layer_count: int) -> None:
        super().__init__()
        self.trunk = MultilayerPerceptron(input_size, hidden_size, layer_count)
        self.policy_head = nn.Linear(self.trunk.output_size, ACTION_COUNT)
        self.value_head = nn.Linear(self.trunk.output_size, 1)
        with torch.no_grad():
            self.policy_head.weight.mul_(0.01)
            self.policy_head.bias.zero_()

    def forward(self, observations: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        hidden = self.trunk(observations)
        return self.policy_head(hidden), self.value_head(hidden).squeeze(-1)


class NormalizedAdvantageNetwork(nn.Module):
    """Q(s, a) = V(s) - P(s) (a - mu(s))^2 / 2 with one action dimension: the
    lower-triangular L(s) is one entry, exp(l(s)) > 0, and P = L L^T = exp(2 l)."""

    def __init__(self, input_size: int, hidden_size: int, layer_count: int) -> None:
        super().__init__()
        self.trunk = MultilayerPerceptron(input_size, hidden_size, layer_count)
        self.value_head = nn.Linear(self.trunk.output_size, 1)
        self.mean_head = nn.Linear(self.trunk.output_size, 1)
        self.curvature_head = nn.Linear(self.trunk.output_size, 1)

    def heads(self, observations: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """(V(s), mu before the tanh, P(s))."""
        hidden = self.trunk(observations)
        log_diagonal = torch.clamp(self.curvature_head(hidden).squeeze(-1), -5.0, 5.0)
        return self.value_head(hidden).squeeze(-1), self.mean_head(hidden).squeeze(-1), torch.exp(2.0 * log_diagonal)

    def action_value(self, observations: torch.Tensor, actions: torch.Tensor) -> torch.Tensor:
        value, mean_before_tanh, curvature = self.heads(observations)
        return value - 0.5 * curvature * (actions - torch.tanh(mean_before_tanh)) ** 2


class ModalityReasoningNetwork(nn.Module):
    """Input (batch, window, columns): the feature columns followed by the
    calendar channels. ``groups`` lists each modality's column indices."""

    def __init__(self, groups: list[list[int]], embedding_size: int, head_count: int, hidden_size: int) -> None:
        super().__init__()
        self.groups = [list(map(int, columns)) for columns in groups]
        self.encoders = nn.ModuleList(nn.Sequential(nn.Linear(len(columns), embedding_size), nn.GELU())
                                      for columns in self.groups)
        self.modality_embedding = nn.Parameter(torch.zeros(len(self.groups), embedding_size))
        nn.init.normal_(self.modality_embedding, std=0.02)
        self.attention = nn.MultiheadAttention(embedding_size, head_count, batch_first=True)
        self.normalization = nn.LayerNorm(embedding_size)
        self.recurrent = nn.GRU(embedding_size, hidden_size, batch_first=True)
        self.policy_head = nn.Linear(hidden_size, ACTION_COUNT)
        self.value_head = nn.Linear(hidden_size, 1)
        self.price_head = nn.Linear(hidden_size, 1)
        with torch.no_grad():
            self.policy_head.weight.mul_(0.01)
            self.policy_head.bias.zero_()

    def forward(self, windows: torch.Tensor, modality_mask: torch.Tensor | None = None):
        """(policy logits, V(s), the price-target forecast); ``modality_mask``
        (batch, modalities), 0 drops a modality token (training only)."""
        batch, length, _ = windows.shape
        tokens = torch.stack([encoder(windows[..., columns]) for encoder, columns in zip(self.encoders, self.groups)],
                             dim=2) + self.modality_embedding                        # (batch, window, modality, embedding)
        if modality_mask is not None:
            tokens = tokens * modality_mask[:, None, :, None].to(tokens.dtype)
        flat = tokens.reshape(batch * length, len(self.groups), -1)
        attended, _ = self.attention(flat, flat, flat, need_weights=False)
        fused = self.normalization(flat + attended).mean(dim=1).reshape(batch, length, -1)
        _, hidden = self.recurrent(fused)
        state = hidden[-1]
        return self.policy_head(state), self.value_head(state).squeeze(-1), self.price_head(state).squeeze(-1)


def double_copy(module: nn.Module) -> nn.Module:
    """A float64, evaluation-mode copy for prediction."""
    return copy.deepcopy(module).double().eval()


__all__ = ["ACTION_COUNT", "ActionValueNetwork", "CategoricalActorCritic", "CategoricalPolicy", "ModalityReasoningNetwork",
           "MultilayerPerceptron", "NormalizedAdvantageNetwork", "ValueNetwork", "double_copy"]
