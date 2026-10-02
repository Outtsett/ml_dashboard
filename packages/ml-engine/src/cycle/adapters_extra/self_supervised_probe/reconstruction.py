"""Reconstruction pretexts: hide or corrupt part of the input and rebuild it.

    DenoisingAutoencoder    masking noise (cells zeroed) plus Gaussian noise on a
                            feature row; the decoder rebuilds the CLEAN row, corrupted
                            cells weighted up (Vincent et al. 2010)
    MaskedAutoencoder       the window as patch tokens, most of them hidden; the encoder
                            sees ONLY the visible tokens, a light decoder with mask tokens
                            rebuilds the hidden patches (per-patch normalised targets)
    MaskedGraphModeling     the window's bars as graph nodes (temporal chain + k nearest
                            neighbours by cosine similarity, from the window alone); node
                            features masked by a learned token and edges dropped; decoders
                            rebuild the masked nodes (squared error) and the dropped edges
                            against sampled non-edges (binary cross entropy)
    MaskedFeatureModeling   BERT on a feature row: each feature is a token whose value is its
                            training-quantile bin; 15% of tokens masked with the 80/10/10
                            rule, cross entropy on the masked bins
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn.functional as functional
from torch import nn

from .base import Pretext
from .encoders import (
    AttentionBlock,
    DenseGraphEncoder,
    MultilayerEncoder,
    PatchTransformer,
    window_adjacency,
)


def _uniform(shape, like: torch.Tensor, generator: torch.Generator) -> torch.Tensor:
    return torch.rand(shape, generator=generator, device=like.device, dtype=like.dtype)


class DenoisingAutoencoder(Pretext):
    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        hidden, size = int(self.settings["hidden_size"]), int(self.settings["embedding_size"])
        self.encoder = MultilayerEncoder(feature_count, hidden, size)
        self.decoder = MultilayerEncoder(size, hidden, feature_count)

    @property
    def embedding_width(self) -> int:
        return int(self.settings["embedding_size"])

    def embed(self, inputs):
        return self.encoder(inputs)

    def pretext_loss(self, batch, generator, progress):
        masked = _uniform(batch.shape, batch, generator) < float(self.settings["mask_fraction"])
        noise = float(self.settings["noise_standard_deviation"]) * torch.randn(
            batch.shape, generator=generator, device=batch.device, dtype=batch.dtype)
        corrupted = torch.where(masked, torch.zeros_like(batch), batch) + noise
        rebuilt = self.decoder(self.encoder(corrupted))
        weight = 1.0 + float(self.settings["corruption_emphasis"]) * masked.to(batch.dtype)
        loss = (weight * (rebuilt - batch) ** 2).sum() / weight.sum()
        return loss, {}


def _patch_transformer(feature_count: int, window: int, settings: dict) -> PatchTransformer:
    return PatchTransformer(feature_count, window, int(settings["patch_bars"]), int(settings["model_dimension"]),
                            int(settings["head_count"]), int(settings["layer_count"]))


def normalised_patches(patches: torch.Tensor) -> torch.Tensor:
    """Each patch standardised by its own mean and variance (the MAE target)."""
    mean = patches.mean(-1, keepdim=True)
    variance = patches.var(-1, keepdim=True, unbiased=False)
    return (patches - mean) / torch.sqrt(variance + 1e-6)


class MaskedAutoencoder(Pretext):
    windowed = True

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self.encoder = _patch_transformer(feature_count, window, self.settings)
        if self.encoder.patch_count < 2:
            raise ValueError(f"a masked autoencoder needs at least two patches: sequence_length {window} "
                             f"holds {self.encoder.patch_count} patch(es) of {self.settings['patch_bars']} bars")
        decoder_size = int(self.settings["decoder_dimension"])
        head_count = int(self.settings["head_count"]) if decoder_size % int(self.settings["head_count"]) == 0 else 1
        self.decoder_embedding = nn.Linear(int(self.settings["model_dimension"]), decoder_size)
        self.decoder_position = nn.Parameter(torch.randn(1, self.encoder.patch_count, decoder_size) * 0.02)
        self.decoder_mask_token = nn.Parameter(torch.zeros(1, 1, decoder_size))
        self.decoder_blocks = nn.ModuleList([AttentionBlock(decoder_size, head_count)
                                             for _ in range(int(self.settings["decoder_layer_count"]))])
        self.decoder_norm = nn.LayerNorm(decoder_size)
        self.decoder_output = nn.Linear(decoder_size, self.encoder.patch_bars * feature_count)

    @property
    def embedding_width(self) -> int:
        return int(self.settings["model_dimension"])

    def embed(self, inputs):
        return self.encoder(inputs)[1].mean(dim=1)

    def pretext_loss(self, batch, generator, progress):
        encoder = self.encoder
        patches = encoder.patches(batch)
        tokens = encoder.patch_embedding(patches)
        batch_size, patch_count, _ = tokens.shape
        keep_count = int(round(patch_count * (1.0 - float(self.settings["mask_ratio"]))))
        keep_count = min(max(keep_count, 1), patch_count - 1)
        order = torch.argsort(_uniform((batch_size, patch_count), batch, generator), dim=1)
        keep, hidden = order[:, :keep_count], order[:, keep_count:]
        visible = tokens.gather(1, keep.unsqueeze(-1).expand(-1, -1, tokens.shape[-1]))
        _, encoded = encoder.encode(visible, positions=keep)
        decoded = self.decoder_embedding(encoded)
        full = self.decoder_mask_token.expand(batch_size, patch_count, -1).clone()
        full = full.scatter(1, keep.unsqueeze(-1).expand(-1, -1, decoded.shape[-1]), decoded)
        full = full + self.decoder_position
        for block in self.decoder_blocks:
            full = block(full)
        prediction = self.decoder_output(self.decoder_norm(full))
        error = ((prediction - normalised_patches(patches)) ** 2).mean(-1)
        loss = error.gather(1, hidden).mean()
        return loss, {"visible_patches": float(keep_count)}


class MaskedGraphModeling(Pretext):
    windowed = True

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        hidden = int(self.settings["hidden_size"])
        self.mask_token = nn.Parameter(torch.zeros(feature_count))
        self.encoder = DenseGraphEncoder(feature_count, hidden, int(self.settings["layer_count"]))
        self.node_decoder = nn.Linear(hidden, feature_count)

    @property
    def embedding_width(self) -> int:
        return 2 * int(self.settings["hidden_size"])

    def embed(self, inputs):
        nodes = self.encoder(inputs, window_adjacency(inputs, int(self.settings["neighbor_count"])))
        return torch.cat([nodes[:, -1], nodes.mean(dim=1)], dim=-1)

    def pretext_loss(self, batch, generator, progress):
        batch_size, count, _ = batch.shape
        adjacency = window_adjacency(batch, int(self.settings["neighbor_count"]))
        node_masked = _uniform((batch_size, count), batch, generator) < float(self.settings["node_mask_ratio"])
        inputs = torch.where(node_masked.unsqueeze(-1), self.mask_token.expand_as(batch), batch)
        upper = torch.triu(torch.ones(count, count, dtype=torch.bool, device=batch.device), diagonal=1).unsqueeze(0)
        edges = (adjacency > 0) & upper
        dropped = edges & (_uniform((batch_size, count, count), batch, generator) < float(self.settings["edge_mask_ratio"]))
        dropped_both = dropped | dropped.transpose(1, 2)
        nodes = self.encoder(inputs, adjacency * (~dropped_both).to(batch.dtype))
        node_loss = functional.mse_loss(self.node_decoder(nodes)[node_masked], batch[node_masked]) \
            if bool(node_masked.any()) else batch.new_zeros(())
        edge_loss = batch.new_zeros(())
        positive_count = int(dropped.sum())
        if positive_count:
            non_edges = (adjacency == 0) & upper
            rate = positive_count / max(int(non_edges.sum()), 1)
            negatives = non_edges & (_uniform((batch_size, count, count), batch, generator) < rate)
            scores = nodes @ nodes.transpose(1, 2) / float(nodes.shape[-1]) ** 0.5
            chosen = dropped | negatives
            edge_loss = functional.binary_cross_entropy_with_logits(scores[chosen], dropped[chosen].to(batch.dtype))
        loss = node_loss + float(self.settings["edge_loss_weight"]) * edge_loss
        return loss, {"node_loss": float(node_loss.detach()), "edge_loss": float(edge_loss.detach())}


class MaskedFeatureModeling(Pretext):
    """Tokens are the row's features; a token's value is its training-quantile
    bin (``bin_count`` bins per feature, fitted on the pool by ``configure``)."""

    def __init__(self, feature_count, window, parameters, config=None):
        super().__init__(feature_count, window, parameters, config)
        self.bin_count = int(self.settings["bin_count"])
        dimension = int(self.settings["model_dimension"])
        self.register_buffer("edges", torch.full((feature_count, max(self.bin_count - 1, 1)), float("inf")))
        self.register_buffer("column_bin_counts", torch.ones(feature_count, dtype=torch.long))
        self.feature_embedding = nn.Parameter(torch.randn(feature_count, dimension) * 0.02)
        self.value_embedding = nn.Embedding(self.bin_count + 1, dimension)      # the last id is [MASK]
        self.class_token = nn.Parameter(torch.randn(1, 1, dimension) * 0.02)
        self.blocks = nn.ModuleList([AttentionBlock(dimension, int(self.settings["head_count"]))
                                     for _ in range(int(self.settings["layer_count"]))])
        self.norm = nn.LayerNorm(dimension)
        self.output = nn.Linear(dimension, self.bin_count)

    def configure(self, pool_inputs):
        from cycle.bridges.binning import QuantileBins

        values = pool_inputs.detach().cpu().numpy().astype(np.float64)
        for column in range(self.feature_count):
            edges = QuantileBins.fit(values[:, column], self.bin_count).edges
            self.edges[column, : edges.size] = torch.as_tensor(edges, dtype=self.edges.dtype)
            self.column_bin_counts[column] = int(edges.size) + 1

    @property
    def embedding_width(self) -> int:
        return int(self.settings["model_dimension"])

    def codes(self, rows: torch.Tensor) -> torch.Tensor:
        """(B, F) bin index of each feature (the count of its edges <= the value)."""
        return (rows.unsqueeze(-1) >= self.edges.to(rows.dtype)).sum(-1)

    def _encode(self, codes: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        tokens = self.value_embedding(codes) + self.feature_embedding
        head = self.class_token.expand(codes.shape[0], -1, -1).to(tokens.dtype)
        hidden = torch.cat([head, tokens], dim=1)
        for block in self.blocks:
            hidden = block(hidden)
        hidden = self.norm(hidden)
        return hidden[:, 0], hidden[:, 1:]

    def embed(self, inputs):
        return self._encode(self.codes(inputs))[0]

    def pretext_loss(self, batch, generator, progress):
        codes = self.codes(batch)
        draw = _uniform(codes.shape, batch, generator)
        selected = _uniform(codes.shape, batch, generator) < float(self.settings["mask_probability"])
        if not bool(selected.any()):
            selected[0, 0] = True
        random_bins = torch.floor(_uniform(codes.shape, batch, generator)
                                  * self.column_bin_counts.to(batch.dtype)).long()
        corrupted = torch.where(selected & (draw < 0.8), torch.full_like(codes, self.bin_count), codes)
        corrupted = torch.where(selected & (draw >= 0.8) & (draw < 0.9), random_bins, corrupted)
        _, tokens = self._encode(corrupted)
        logits = self.output(tokens)
        valid = torch.arange(self.bin_count, device=batch.device).view(1, 1, -1) < self.column_bin_counts.view(1, -1, 1)
        logits = logits.masked_fill(~valid, -1e9)
        loss = functional.cross_entropy(logits[selected], codes[selected])
        with torch.no_grad():
            accuracy = float((logits[selected].argmax(-1) == codes[selected]).to(batch.dtype).mean())
        return loss, {"masked_bin_accuracy": accuracy}


__all__ = ["DenoisingAutoencoder", "MaskedAutoencoder", "MaskedFeatureModeling", "MaskedGraphModeling",
           "normalised_patches"]
