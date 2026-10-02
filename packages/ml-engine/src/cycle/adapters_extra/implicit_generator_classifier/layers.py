"""Torch building blocks shared by the generators, and their float64 numpy twins.

Every network that is read at prediction time (the posterior classifier, the
adversarial autoencoder's class head, CycleGAN's two translators) is exported
to plain float64 arrays and evaluated with numpy: a saved model needs no
torch to predict, and one row scored alone equals the same row inside a batch
to float64 rounding (a float32 matmul does not guarantee that).

The activation everywhere is the leaky ReLU with slope 0.2 (the GAN default).
"""

from __future__ import annotations

import numpy as np
import torch
from torch import nn

NEGATIVE_SLOPE = 0.2


def spectral(linear: nn.Linear, enabled: bool) -> nn.Module:
    """``linear`` under spectral normalisation (Miyato et al., 2018) when enabled."""
    return nn.utils.parametrizations.spectral_norm(linear) if enabled else linear


def multilayer(input_size: int, hidden_size: int, layer_count: int, output_size: int, *,
               spectral_norm: bool = False) -> nn.Sequential:
    """``layer_count`` hidden Linear + LeakyReLU layers, then a Linear head."""
    layers: list[nn.Module] = []
    size = int(input_size)
    for _ in range(int(layer_count)):
        layers += [spectral(nn.Linear(size, int(hidden_size)), spectral_norm), nn.LeakyReLU(NEGATIVE_SLOPE)]
        size = int(hidden_size)
    layers.append(spectral(nn.Linear(size, int(output_size)), spectral_norm))
    return nn.Sequential(*layers)


class ResidualTranslator(nn.Module):
    """x + f(x): ``block_count`` residual blocks h <- h + W2 leaky(W1 h) (CycleGAN's
    residual generator at tabular scale). Starts near the identity."""

    def __init__(self, feature_count: int, hidden_size: int, block_count: int) -> None:
        super().__init__()
        self.blocks = nn.ModuleList()
        for _ in range(int(block_count)):
            inner = nn.Linear(int(feature_count), int(hidden_size))
            outer = nn.Linear(int(hidden_size), int(feature_count))
            nn.init.zeros_(outer.bias)
            with torch.no_grad():
                outer.weight.mul_(0.1)
            self.blocks.append(nn.Sequential(inner, nn.LeakyReLU(NEGATIVE_SLOPE), outer))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = x
        for block in self.blocks:
            h = h + block(h)
        return h


# ─── export and numpy evaluation ──────────────────────────────────────────


def export_linears(module: nn.Module) -> list[tuple[np.ndarray, np.ndarray]]:
    """(weight, bias) of every Linear in ``module`` in order, float64. Call in
    eval mode: a spectral-normalised weight is read as W / sigma without a
    power-iteration step."""
    out: list[tuple[np.ndarray, np.ndarray]] = []
    with torch.no_grad():
        for child in module.modules():
            if isinstance(child, nn.Linear):
                out.append((child.weight.detach().cpu().double().numpy().copy(),
                            child.bias.detach().cpu().double().numpy().copy()))
    return out


def leaky(values: np.ndarray) -> np.ndarray:
    return np.where(values > 0, values, NEGATIVE_SLOPE * values)


def numpy_forward(layers, x: np.ndarray) -> np.ndarray:
    """The ``multilayer`` network in float64: leaky ReLU after every layer but the last."""
    h = np.asarray(x, dtype=np.float64)
    last = len(layers) - 1
    for position, (weight, bias) in enumerate(layers):
        h = h @ weight.T + bias
        if position < last:
            h = leaky(h)
    return h


def numpy_translate(blocks, x: np.ndarray) -> np.ndarray:
    """``ResidualTranslator`` in float64; ``blocks`` is a list of ((W1, b1), (W2, b2))."""
    h = np.asarray(x, dtype=np.float64)
    for (inner_weight, inner_bias), (outer_weight, outer_bias) in blocks:
        h = h + leaky(h @ inner_weight.T + inner_bias) @ outer_weight.T + outer_bias
    return h


def softmax(logits: np.ndarray) -> np.ndarray:
    logits = np.asarray(logits, dtype=np.float64)
    shifted = logits - logits.max(axis=1, keepdims=True)
    weights = np.exp(shifted)
    return weights / weights.sum(axis=1, keepdims=True)


def layers_to_arrays(prefix: str, layers) -> dict[str, np.ndarray]:
    arrays: dict[str, np.ndarray] = {f"{prefix}_count": np.asarray(len(layers))}
    for position, (weight, bias) in enumerate(layers):
        arrays[f"{prefix}_{position}_weight"] = weight
        arrays[f"{prefix}_{position}_bias"] = bias
    return arrays


def layers_from_arrays(prefix: str, arrays: dict[str, np.ndarray]) -> list[tuple[np.ndarray, np.ndarray]]:
    count = int(arrays[f"{prefix}_count"])
    return [(np.asarray(arrays[f"{prefix}_{position}_weight"], dtype=np.float64),
             np.asarray(arrays[f"{prefix}_{position}_bias"], dtype=np.float64)) for position in range(count)]


__all__ = ["NEGATIVE_SLOPE", "ResidualTranslator", "export_linears", "layers_from_arrays", "layers_to_arrays", "leaky",
           "multilayer", "numpy_forward", "numpy_translate", "softmax", "spectral"]
