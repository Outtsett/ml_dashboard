"""The encoders the self-supervised variants are built from.

Every encoder reads only what it is given: one feature row, or the causal
window of bars ending at the bar being embedded. None of them normalises
across the batch (no batch normalisation), so a bar's embedding is the same
whether it is computed alone or with others.

    MultilayerEncoder      feature row -> vector (two hidden GELU layers)
    projection_head        the small MLP a siamese method puts after its encoder
    GatedRecurrentEncoder  window -> GRU final state -> vector
    TemporalConvolutionEncoder   window -> dilated 1-D convolutions -> [mean, last] -> vector
    PatchTransformer       window -> patches of ``patch_bars`` bars as tokens (+ a CLS token)
                           -> pre-norm self-attention blocks; takes any subset of tokens
                           with their positions (masked autoencoders, local crops)
    DenseGraphEncoder      the window's bars as graph nodes, dense normalised adjacency
                           (temporal chain + k nearest neighbours by cosine similarity)
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as functional
from torch import nn


class MultilayerEncoder(nn.Module):
    def __init__(self, input_size: int, hidden_size: int, output_size: int) -> None:
        super().__init__()
        self.first = nn.Linear(input_size, hidden_size)
        self.second = nn.Linear(hidden_size, hidden_size)
        self.output = nn.Linear(hidden_size, output_size)

    def forward_with_hidden(self, inputs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        hidden = functional.gelu(self.second(functional.gelu(self.first(inputs))))
        return self.output(hidden), hidden

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.forward_with_hidden(inputs)[0]


def projection_head(input_size: int, hidden_size: int, output_size: int, depth: int = 2) -> nn.Sequential:
    """Linear -> GELU (depth - 1 times) -> Linear."""
    layers: list[nn.Module] = []
    width = input_size
    for _ in range(max(depth - 1, 0)):
        layers += [nn.Linear(width, hidden_size), nn.LayerNorm(hidden_size), nn.GELU()]
        width = hidden_size
    layers.append(nn.Linear(width, output_size))
    return nn.Sequential(*layers)


class GatedRecurrentEncoder(nn.Module):
    def __init__(self, feature_count: int, hidden_size: int, output_size: int) -> None:
        super().__init__()
        self.recurrent = nn.GRU(feature_count, hidden_size, batch_first=True)
        self.output = nn.Linear(hidden_size, output_size)

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        _, last = self.recurrent(window)
        return self.output(last[-1])


class TemporalConvolutionEncoder(nn.Module):
    """Three dilated convolutions (1, 2, 4) over the window; the embedding reads
    the time-mean and the last bar of the top layer, so it sees the arrow of time."""

    def __init__(self, feature_count: int, hidden_size: int, output_size: int) -> None:
        super().__init__()
        self.layers = nn.ModuleList([
            nn.Conv1d(feature_count if index == 0 else hidden_size, hidden_size, kernel_size=3, padding=dilation,
                      dilation=dilation)
            for index, dilation in enumerate((1, 2, 4))
        ])
        self.output = nn.Linear(2 * hidden_size, output_size)

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        hidden = window.transpose(1, 2)
        for layer in self.layers:
            hidden = functional.gelu(layer(hidden))
        return self.output(torch.cat([hidden.mean(dim=2), hidden[:, :, -1]], dim=1))


class AttentionBlock(nn.Module):
    """Pre-norm multi-head self-attention and a GELU feed-forward, written out
    with plain matrix products (no fused kernels, so numerics do not depend on
    the batch size)."""

    def __init__(self, dimension: int, head_count: int) -> None:
        super().__init__()
        if dimension % head_count:
            raise ValueError(f"model_dimension {dimension} must be a multiple of head_count {head_count}")
        self.head_count = head_count
        self.first_norm = nn.LayerNorm(dimension)
        self.query_key_value = nn.Linear(dimension, 3 * dimension)
        self.projection = nn.Linear(dimension, dimension)
        self.second_norm = nn.LayerNorm(dimension)
        self.feed_forward = nn.Sequential(nn.Linear(dimension, 2 * dimension), nn.GELU(), nn.Linear(2 * dimension, dimension))

    def forward(self, tokens: torch.Tensor) -> torch.Tensor:
        batch, count, dimension = tokens.shape
        head_size = dimension // self.head_count
        query, key, value = self.query_key_value(self.first_norm(tokens)).chunk(3, dim=-1)

        def heads(values):
            return values.reshape(batch, count, self.head_count, head_size).transpose(1, 2)

        weights = torch.softmax(heads(query) @ heads(key).transpose(-1, -2) / math.sqrt(head_size), dim=-1)
        attended = (weights @ heads(value)).transpose(1, 2).reshape(batch, count, dimension)
        tokens = tokens + self.projection(attended)
        return tokens + self.feed_forward(self.second_norm(tokens))


class PatchTransformer(nn.Module):
    """The window cut into ``patch_count`` patches of ``patch_bars`` bars (the
    most recent ``patch_count * patch_bars`` bars; the bar being embedded is in
    the last patch), each patch a token, plus a learned CLS token."""

    def __init__(self, feature_count: int, window: int, patch_bars: int, dimension: int, head_count: int,
                 layer_count: int) -> None:
        super().__init__()
        if patch_bars > window:
            raise ValueError(f"patch_bars {patch_bars} is longer than the window of {window} bars")
        self.patch_bars = int(patch_bars)
        self.patch_count = int(window // patch_bars)
        self.used_bars = self.patch_count * self.patch_bars
        self.feature_count = int(feature_count)
        self.dimension = int(dimension)
        self.patch_embedding = nn.Linear(self.patch_bars * feature_count, dimension)
        self.position = nn.Parameter(torch.randn(1, self.patch_count + 1, dimension) * 0.02)
        self.class_token = nn.Parameter(torch.randn(1, 1, dimension) * 0.02)
        self.mask_token = nn.Parameter(torch.zeros(1, 1, dimension))
        self.blocks = nn.ModuleList([AttentionBlock(dimension, head_count) for _ in range(layer_count)])
        self.norm = nn.LayerNorm(dimension)

    def patches(self, window: torch.Tensor) -> torch.Tensor:
        """(B, L, F) -> (B, patch_count, patch_bars * F)."""
        recent = window[:, window.shape[1] - self.used_bars:]
        return recent.reshape(window.shape[0], self.patch_count, self.patch_bars * self.feature_count)

    def encode(self, tokens: torch.Tensor, positions: torch.Tensor | None = None,
               masked: torch.Tensor | None = None) -> tuple[torch.Tensor, torch.Tensor]:
        """``tokens`` (B, T, d) patch embeddings at patch ``positions`` (B, T)
        (all patches in order when None); ``masked`` (B, T) bool replaces a token
        by the mask token. Returns (CLS output (B, d), token outputs (B, T, d))."""
        batch, count, _ = tokens.shape
        if masked is not None:
            tokens = torch.where(masked.unsqueeze(-1), self.mask_token.expand(batch, count, -1), tokens)
        if positions is None:
            position = self.position[:, 1:count + 1]
        else:
            position = self.position[0, 1:][positions]
        tokens = tokens + position
        head = (self.class_token + self.position[:, :1]).expand(batch, -1, -1)
        hidden = torch.cat([head, tokens], dim=1)
        for block in self.blocks:
            hidden = block(hidden)
        hidden = self.norm(hidden)
        return hidden[:, 0], hidden[:, 1:]

    def forward(self, window: torch.Tensor, masked: torch.Tensor | None = None) -> tuple[torch.Tensor, torch.Tensor]:
        return self.encode(self.patch_embedding(self.patches(window)), masked=masked)


def window_adjacency(nodes: torch.Tensor, neighbor_count: int) -> torch.Tensor:
    """(B, L, F) bars -> (B, L, L) 0/1 symmetric adjacency, no self loops: each
    bar to its neighbours in time and to its ``neighbor_count`` most similar bars
    of the same window (cosine similarity). Built from the window alone."""
    batch, count, _ = nodes.shape
    unit = functional.normalize(nodes, dim=-1)
    similarity = unit @ unit.transpose(1, 2)
    eye = torch.eye(count, dtype=torch.bool, device=nodes.device)
    similarity = similarity.masked_fill(eye, float("-inf"))
    adjacency = torch.zeros(batch, count, count, dtype=nodes.dtype, device=nodes.device)
    neighbours = min(int(neighbor_count), count - 1)
    if neighbours > 0:
        index = similarity.topk(neighbours, dim=-1).indices
        adjacency.scatter_(2, index, 1.0)
    chain = torch.diag(torch.ones(count - 1, dtype=nodes.dtype, device=nodes.device), 1)
    adjacency = torch.maximum(adjacency, chain.unsqueeze(0))
    return torch.maximum(adjacency, adjacency.transpose(1, 2))


def normalised_adjacency(adjacency: torch.Tensor) -> torch.Tensor:
    """D^-1/2 (A + I) D^-1/2 (Kipf and Welling)."""
    count = adjacency.shape[-1]
    with_loops = adjacency + torch.eye(count, dtype=adjacency.dtype, device=adjacency.device)
    scale = with_loops.sum(-1).rsqrt()
    return scale.unsqueeze(-1) * with_loops * scale.unsqueeze(-2)


class DenseGraphEncoder(nn.Module):
    """Graph convolutions H <- GELU(A_norm H W) over the window's bars."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int) -> None:
        super().__init__()
        self.layers = nn.ModuleList([nn.Linear(feature_count if index == 0 else hidden_size, hidden_size)
                                     for index in range(max(layer_count, 1))])

    def forward(self, nodes: torch.Tensor, adjacency: torch.Tensor) -> torch.Tensor:
        operator = normalised_adjacency(adjacency)
        hidden = nodes
        for layer in self.layers:
            hidden = functional.gelu(operator @ layer(hidden))
        return hidden


__all__ = ["AttentionBlock", "DenseGraphEncoder", "GatedRecurrentEncoder", "MultilayerEncoder", "PatchTransformer",
           "TemporalConvolutionEncoder", "normalised_adjacency", "projection_head", "window_adjacency"]
