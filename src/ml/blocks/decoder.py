"""Decoder building blocks (mirrors of encoder.py).

Public API:
    MLPDecoder(in_dim, hidden_dims, out_dim, dropout=0.1, activation='gelu')
    Conv1DDecoder(in_channels, channels, kernel_sizes, dropout=0.1)

These exist for autoencoder / VAE templates (W3.b ``pytorch_autoencoder.py.j2``,
``pytorch_vae.py.j2``) which need symmetric reconstruction structures. The
decoders are intentionally simple mirrors -- they do NOT add task-specific
heads, that's the head module's job.
"""

from __future__ import annotations

import torch
import torch.nn as nn

_ACTIVATIONS: dict[str, type[nn.Module]] = {
    "relu": nn.ReLU,
    "gelu": nn.GELU,
    "silu": nn.SiLU,
    "tanh": nn.Tanh,
    "leaky_relu": nn.LeakyReLU,
}


def _resolve_activation(name: str) -> nn.Module:
    name = name.lower()
    if name not in _ACTIVATIONS:
        raise ValueError(f"unknown activation {name!r}; expected one of {sorted(_ACTIVATIONS)}")
    return _ACTIVATIONS[name]()


class MLPDecoder(nn.Module):
    """Mirror of ``MLPEncoder`` -- ``Linear -> activation -> Dropout`` stack.

    Identical structure to ``MLPEncoder`` -- they're mathematically the same;
    the separate name signals reconstruction intent in autoencoder templates.

    forward contract:
        input:  (B, in_dim) or (B, T, in_dim)
        output: (B, out_dim) or (B, T, out_dim)
    """

    def __init__(
        self,
        in_dim: int,
        hidden_dims: list[int] | tuple[int, ...],
        out_dim: int,
        dropout: float = 0.1,
        activation: str = "gelu",
    ):
        super().__init__()
        if in_dim <= 0 or out_dim <= 0:
            raise ValueError(f"in_dim ({in_dim}) and out_dim ({out_dim}) must be > 0")
        if any(h <= 0 for h in hidden_dims):
            raise ValueError(f"hidden_dims must all be > 0, got {hidden_dims}")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")

        self.in_dim = in_dim
        self.out_dim = out_dim
        self.hidden_dims = list(hidden_dims)

        layers: list[nn.Module] = []
        prev = in_dim
        for h in hidden_dims:
            layers.append(nn.Linear(prev, h))
            layers.append(_resolve_activation(activation))
            if dropout > 0:
                layers.append(nn.Dropout(dropout))
            prev = h
        layers.append(nn.Linear(prev, out_dim))
        self.net = nn.Sequential(*layers)
        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (B, in_dim) or (B, T, in_dim)
        # output: (B, out_dim) or (B, T, out_dim)
        return self.net(x)


class Conv1DDecoder(nn.Module):
    """1D transposed-convolution stack -- mirror of ``Conv1DEncoder``.

    Each block is ``ConvTranspose1d -> GELU -> Dropout``. ``stride=1`` and
    ``padding = k // 2`` keeps temporal length invariant when paired with
    odd-kernel encoders, matching the autoencoder reconstruction contract.

    forward contract:
        input:  (B, T, in_channels) bar-major
        output: (B, T, channels[-1]) bar-major
    """

    def __init__(
        self,
        in_channels: int,
        channels: list[int] | tuple[int, ...],
        kernel_sizes: list[int] | tuple[int, ...],
        dropout: float = 0.1,
    ):
        super().__init__()
        if in_channels <= 0:
            raise ValueError(f"in_channels must be > 0, got {in_channels}")
        if len(channels) == 0:
            raise ValueError("channels must have at least one element")
        if len(channels) != len(kernel_sizes):
            raise ValueError(
                f"len(channels) ({len(channels)}) must equal len(kernel_sizes) "
                f"({len(kernel_sizes)})"
            )
        if any(c <= 0 for c in channels):
            raise ValueError(f"channels must all be > 0, got {channels}")
        if any(k <= 0 for k in kernel_sizes):
            raise ValueError(f"kernel_sizes must all be > 0, got {kernel_sizes}")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")

        self.in_channels = in_channels
        self.out_channels = channels[-1]
        self.channels = list(channels)
        self.kernel_sizes = list(kernel_sizes)

        blocks: list[nn.Module] = []
        prev = in_channels
        for c, k in zip(channels, kernel_sizes):
            pad = k // 2
            blocks.append(nn.ConvTranspose1d(prev, c, kernel_size=k, padding=pad))
            blocks.append(nn.GELU())
            if dropout > 0:
                blocks.append(nn.Dropout(dropout))
            prev = c
        self.net = nn.Sequential(*blocks)
        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.ConvTranspose1d):
                nn.init.kaiming_uniform_(m.weight, nonlinearity="relu")
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (B, T, in_channels) bar-major
        # output: (B, T, channels[-1]) bar-major (length preserved with odd kernels)
        x = x.transpose(1, 2)  # (B, C, T)
        x = self.net(x)
        x = x.transpose(1, 2)  # (B, T, C_out)
        return x
