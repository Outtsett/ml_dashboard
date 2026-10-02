"""Exact discrete likelihoods of the tokenised row: PixelCNN, PixelRNN, GPT.

The standardised row is a one-dimensional "image" of d columns. Each column is
cut into ``token_bin_count`` tokens at its training-row quantiles
(``QuantileTokens``: edges from training rows only, a value's token is the
count of edges at or below it), and the row's likelihood under class k is the
autoregressive product over the columns in their fixed order:

    log p(tokens | k) = sum_i log p(token_i | token_<i, k)

(the token of a continuous value is its quantile bin; the bin widths are the
same for every class, so they cancel in Bayes' rule).

- ``pixel_cnn``: a stack of gated causal 1-D convolutions (van den Oord et
  al. 2016, Conditional PixelCNN) over the columns shifted right by one (the
  "mask A" first layer), the class embedding added to every gate, a learned
  column-position embedding;
- ``pixel_rnn``: a GRU run over the shifted columns with the class embedding
  at every step (PixelRNN's row LSTM, in one dimension);
- ``generative_transformer``: a decoder-only transformer (GPT) over
  [class token, token_1 .. token_{d-1}] with a causal mask, each position
  predicting the next column's token.

The column order is the feature matrix's own, so the "spatial" neighbourhood a
convolution exploits is arbitrary; the likelihood is exact whatever the order.
"""

from __future__ import annotations

import numpy as np
import torch
from torch import nn
from torch.nn import functional

from .common import TorchDensity


class QuantileTokens(nn.Module):
    """Per-column quantile edges (training rows), padded with +inf to a common width."""

    def __init__(self, dimension: int, token_bin_count: int) -> None:
        super().__init__()
        self.register_buffer("edges", torch.full((dimension, max(1, token_bin_count - 1)), float("inf")))

    @torch.no_grad()
    def fit(self, x: torch.Tensor) -> None:
        values = x.detach().to("cpu").double().numpy()
        width = self.edges.shape[1]
        edges = np.full((values.shape[1], width), np.inf)
        for column in range(values.shape[1]):
            quantiles = np.quantile(values[:, column], np.linspace(0.0, 1.0, width + 2)[1:-1])
            unique = np.unique(quantiles)
            unique = unique[unique < values[:, column].max()]
            edges[column, :unique.size] = unique
        self.edges.copy_(torch.as_tensor(edges, dtype=self.edges.dtype))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return (x.unsqueeze(2) >= self.edges.to(x.dtype).unsqueeze(0)).sum(dim=2).long()


class GatedCausalConvolution(nn.Module):
    def __init__(self, channels: int, kernel_size: int, embedding_size: int) -> None:
        super().__init__()
        self.kernel_size = int(kernel_size)
        self.convolution = nn.Conv1d(channels, 2 * channels, self.kernel_size)
        self.class_projection = nn.Linear(embedding_size, 2 * channels)
        self.output = nn.Conv1d(channels, channels, 1)

    def forward(self, h: torch.Tensor, class_embedding: torch.Tensor) -> torch.Tensor:
        gates = self.convolution(functional.pad(h, (self.kernel_size - 1, 0)))       # causal: left padding only
        gates = gates + self.class_projection(class_embedding).unsqueeze(2)
        signal, gate = gates.chunk(2, dim=1)
        return h + self.output(torch.tanh(signal) * torch.sigmoid(gate))


class TokenModel(nn.Module):
    """Logits (n, d, token_bin_count) of every column's token given the earlier columns and the class."""

    def __init__(self, dimension: int, class_count: int, token_bin_count: int, backbone: str, hidden_size: int,
                 layer_count: int, kernel_size: int, embedding_size: int, head_count: int, dropout: float) -> None:
        super().__init__()
        self.backbone = backbone
        self.tokens = QuantileTokens(dimension, token_bin_count)
        self.token_embedding = nn.Embedding(token_bin_count, hidden_size)
        self.position_embedding = nn.Parameter(torch.zeros(dimension, hidden_size))
        nn.init.normal_(self.position_embedding, std=0.02)
        self.class_embedding = nn.Embedding(class_count, embedding_size if backbone != "generative_transformer" else hidden_size)
        if backbone == "pixel_cnn":
            self.start = nn.Parameter(torch.zeros(hidden_size))
            self.layers = nn.ModuleList(GatedCausalConvolution(hidden_size, kernel_size, embedding_size)
                                        for _ in range(max(1, layer_count)))
        elif backbone == "pixel_rnn":
            self.start = nn.Parameter(torch.zeros(hidden_size))
            self.recurrent = nn.GRU(hidden_size + embedding_size, hidden_size, num_layers=max(1, layer_count),
                                    batch_first=True)
        elif backbone == "generative_transformer":
            heads = int(head_count) if hidden_size % int(head_count) == 0 else 1
            layer = nn.TransformerEncoderLayer(hidden_size, heads, dim_feedforward=4 * hidden_size, dropout=dropout,
                                               activation="gelu", batch_first=True, norm_first=True)
            self.transformer = nn.TransformerEncoder(layer, max(1, layer_count), enable_nested_tensor=False)
            self.register_buffer("causal_mask", torch.triu(torch.full((dimension, dimension), float("-inf")), diagonal=1))
            self.final_norm = nn.LayerNorm(hidden_size)
        else:
            raise ValueError(f"unknown autoregressive backbone {backbone!r}")
        self.head = nn.Linear(hidden_size, token_bin_count)

    def logits(self, tokens: torch.Tensor, classes: torch.Tensor) -> torch.Tensor:
        count, dimension = tokens.shape
        embedded = self.token_embedding(tokens)                                   # (n, d, H)
        class_embedding = self.class_embedding(classes)
        if self.backbone == "generative_transformer":
            # [class token, token_1 .. token_{d-1}]: position i predicts token_{i+1}
            sequence = torch.cat([class_embedding.unsqueeze(1), embedded[:, :-1]], dim=1) + self.position_embedding
            mask = self.causal_mask.to(sequence.dtype)
            hidden = self.final_norm(self.transformer(sequence, mask=mask))
            return self.head(hidden)
        start = self.start.to(embedded.dtype).reshape(1, 1, -1).expand(count, 1, -1)
        shifted = torch.cat([start, embedded[:, :-1]], dim=1) + self.position_embedding   # position i sees tokens < i
        if self.backbone == "pixel_cnn":
            hidden = shifted.transpose(1, 2)
            for layer in self.layers:
                hidden = layer(hidden, class_embedding)
            return self.head(hidden.transpose(1, 2))
        steps = torch.cat([shifted, class_embedding.unsqueeze(1).expand(count, dimension, -1)], dim=2)
        hidden, _ = self.recurrent(steps)
        return self.head(hidden)

    def log_likelihood(self, x: torch.Tensor, classes: torch.Tensor) -> torch.Tensor:
        tokens = self.tokens(x)
        log_probability = functional.log_softmax(self.logits(tokens, classes), dim=2)
        return log_probability.gather(2, tokens.unsqueeze(2)).squeeze(2).sum(dim=1)


class AutoregressiveTokens(TorchDensity):
    def __init__(self, dimension, class_count, parameters, seed, backbone: str | None = None) -> None:
        super().__init__(dimension, class_count, parameters, seed)
        self.backbone = backbone or str(parameters.get("autoregressive_backbone", "pixel_cnn"))

    def build(self) -> nn.Module:
        p = self.parameters
        return TokenModel(self.dimension, self.class_count, int(p["token_bin_count"]), self.backbone,
                          int(p["hidden_size"]), int(p["layer_count"]), int(p.get("kernel_size", 3)),
                          int(p.get("embedding_size", 16)), int(p.get("head_count", 4)), float(p.get("dropout", 0.0)))

    def prepare(self, network, x, y, context) -> None:
        network.tokens.fit(x)

    def loss(self, network, x, y):
        return -network.log_likelihood(x, y).mean() / self.dimension

    def class_scores(self, network, x):
        return torch.stack([network.log_likelihood(x, torch.full((x.shape[0],), k, dtype=torch.long, device=x.device))
                            for k in range(self.class_count)], dim=1)


class GenerativeTransformer(AutoregressiveTokens):
    def __init__(self, dimension, class_count, parameters, seed) -> None:
        super().__init__(dimension, class_count, parameters, seed, backbone="generative_transformer")


__all__ = ["AutoregressiveTokens", "GenerativeTransformer", "QuantileTokens", "TokenModel"]
