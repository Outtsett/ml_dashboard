"""Encoder building blocks.

Public API:
    MLPEncoder(in_dim, hidden_dims, out_dim, dropout=0.1, activation='gelu')
    Conv1DEncoder(in_channels, channels, kernel_sizes, dropout=0.1)
    TransformerEncoder(d_model, n_heads, n_layers, d_ff, dropout=0.1, max_seq_len=512)
    TwoStreamPriceVolumeEncoder(window_size=128, d_model_price=112, d_model_vol=16, ...)

TwoStreamPriceVolumeEncoder is a verbatim port of the encoder body of
trading_model/cnn_transformer/model.py::CnnTransformerModel — the price
``Linear(4 -> d_model_price)`` + sinusoidal PE + volume ``Linear(1 -> d_model_vol)``
no-PE + concat + per-window normalize + transformer stack — minus the head
which is templated separately via src.ml.blocks.head.
"""

from __future__ import annotations

import torch
import torch.nn as nn
from src.ml.blocks.attention import PositionalEncoding

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


class MLPEncoder(nn.Module):
    """Sequential ``Linear -> activation -> Dropout`` stack.

    Each hidden layer is ``Linear(prev, hidden_dims[i]) -> act -> Dropout``.
    Final projection ``Linear(prev, out_dim)`` has no activation/dropout
    so downstream heads can apply task-specific output non-linearities.

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


class Conv1DEncoder(nn.Module):
    """1D convolution stack over time-major windows.

    Each block is ``Conv1d -> GELU -> Dropout`` with same-padding so the
    sequence length is preserved across the stack. The number of blocks is
    ``len(channels)`` and ``len(kernel_sizes)`` must match.

    forward contract:
        input:  (B, T, in_channels)  -- bar-major windows; permuted to (B, C, T)
        output: (B, T, channels[-1]) -- permuted back to bar-major
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
            # Same padding for odd kernels; for even kernels, use floor(k/2)
            # which preserves length only when k is odd. Generated templates
            # default to odd kernels (3/5/7) but we tolerate even by truncating.
            pad = k // 2
            blocks.append(nn.Conv1d(prev, c, kernel_size=k, padding=pad))
            blocks.append(nn.GELU())
            if dropout > 0:
                blocks.append(nn.Dropout(dropout))
            prev = c
        self.net = nn.Sequential(*blocks)
        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Conv1d):
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


class TransformerEncoder(nn.Module):
    """Vanilla transformer encoder stack with sinusoidal positional encoding.

    Pre-norm (``norm_first=True``) for stable depth training, GELU activation,
    batch-first throughout. PE is the standard Vaswani sin/cos.

    forward contract:
        input:  (B, T, d_model), optional src_mask (T, T) or (B*H, T, T),
                optional src_key_padding_mask (B, T)
        output: (B, T, d_model)
    """

    def __init__(
        self,
        d_model: int,
        n_heads: int,
        n_layers: int,
        d_ff: int,
        dropout: float = 0.1,
        max_seq_len: int = 512,
    ):
        super().__init__()
        if d_model <= 0:
            raise ValueError(f"d_model must be > 0, got {d_model}")
        if n_heads <= 0 or d_model % n_heads != 0:
            raise ValueError(f"d_model ({d_model}) must be divisible by n_heads ({n_heads})")
        if n_layers <= 0:
            raise ValueError(f"n_layers must be > 0, got {n_layers}")
        if d_ff <= 0:
            raise ValueError(f"d_ff must be > 0, got {d_ff}")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")
        if max_seq_len <= 0:
            raise ValueError(f"max_seq_len must be > 0, got {max_seq_len}")

        self.d_model = d_model
        self.n_heads = n_heads
        self.n_layers = n_layers
        self.d_ff = d_ff
        self.max_seq_len = max_seq_len

        self.pos_enc = PositionalEncoding(d_model=d_model, max_len=max_seq_len)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_ff,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        # norm_first=True (pre-norm) disables the nested-tensor fast path anyway;
        # PyTorch warns on every construction unless that is stated explicitly.
        self.encoder = nn.TransformerEncoder(
            encoder_layer, num_layers=n_layers, enable_nested_tensor=False
        )
        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(
        self,
        x: torch.Tensor,
        src_mask: torch.Tensor | None = None,
        src_key_padding_mask: torch.Tensor | None = None,
    ) -> torch.Tensor:
        # input:  (B, T, d_model)
        # output: (B, T, d_model)
        x = self.pos_enc(x)
        return self.encoder(x, mask=src_mask, src_key_padding_mask=src_key_padding_mask)


class TwoStreamPriceVolumeEncoder(nn.Module):
    """Two-stream price+volume transformer encoder.

    Verbatim port of the encoder body of
    trading_model/cnn_transformer/model.py::CnnTransformerModel: a price stream
    ``Linear(4 -> d_model_price)`` with bar-index sinusoidal PE, a volume stream
    ``Linear(1 -> d_model_vol)`` with no PE, concatenated to width
    ``d_model = d_model_price + d_model_vol`` and fed through a vanilla
    pre-norm transformer encoder stack. Per-window normalization is applied
    on-GPU before projection.

    The output head is intentionally NOT included here -- generated templates
    pair this encoder with whichever ``src.ml.blocks.head.*`` head matches the
    target task.

    forward contract:
        input:
            x_price:  (B, T, 4) -- raw [O, H, L, C] window
            x_volume: (B, T, 1) -- raw V column
        output:
            (B, T, d_model_price + d_model_vol)
    """

    def __init__(
        self,
        window_size: int = 128,
        d_model_price: int = 112,
        d_model_vol: int = 16,
        n_heads: int = 4,
        n_layers: int = 4,
        d_ff: int = 512,
        dropout: float = 0.1,
        use_price_positional_encoding: bool = True,
        volume_log_transform: bool = False,
    ):
        super().__init__()
        if window_size <= 0:
            raise ValueError(f"window_size must be > 0, got {window_size}")
        if d_model_price <= 0 or d_model_vol <= 0:
            raise ValueError(
                f"d_model_price ({d_model_price}) and d_model_vol ({d_model_vol}) must be > 0"
            )
        d_model = d_model_price + d_model_vol
        if d_model % n_heads != 0:
            raise ValueError(
                f"d_model ({d_model}) = d_model_price + d_model_vol = "
                f"{d_model_price} + {d_model_vol} must be divisible by n_heads ({n_heads})"
            )
        if n_layers <= 0 or d_ff <= 0:
            raise ValueError(f"n_layers ({n_layers}) and d_ff ({d_ff}) must be > 0")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")

        self.window_size = window_size
        self.d_model_price = d_model_price
        self.d_model_vol = d_model_vol
        self.d_model = d_model
        self.n_heads = n_heads
        self.n_layers = n_layers
        self.d_ff = d_ff
        self.use_price_positional_encoding = use_price_positional_encoding
        self.volume_log_transform = volume_log_transform

        # Price stream: Linear(4 -> d_model_price) + sinusoidal PE
        self.input_proj_price = nn.Linear(4, d_model_price)
        self.pos_enc_price: nn.Module | None = (
            PositionalEncoding(d_model=d_model_price, max_len=window_size)
            if use_price_positional_encoding
            else None
        )

        # Volume stream: Linear(1 -> d_model_vol), no PE
        self.input_proj_vol = nn.Linear(1, d_model_vol)

        # Transformer over fused tokens (price ++ volume)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_ff,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        # Same pre-norm reason as TransformerEncoderBlock above.
        self.transformer = nn.TransformerEncoder(
            encoder_layer, num_layers=n_layers, enable_nested_tensor=False
        )
        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def normalize_price(self, x_price: torch.Tensor) -> torch.Tensor:
        # x_price: (B, T, 4) raw OHLC; normalize relative to last close per window
        ref_close = x_price[:, -1, 3:4].unsqueeze(1).clamp(min=1e-8)  # (B, 1, 1)
        return (x_price - ref_close) / ref_close

    def normalize_volume(self, x_vol: torch.Tensor) -> torch.Tensor:
        # x_vol: (B, T, 1) raw volume; per-window z-score, optional log1p
        v = x_vol
        if self.volume_log_transform:
            v = torch.log1p(v.clamp(min=0))
        v_mean = v.mean(dim=1, keepdim=True)
        v_std = v.std(dim=1, keepdim=True)
        return (v - v_mean) / (v_std + 1e-8)

    def forward(
        self,
        x_price: torch.Tensor,
        x_volume: torch.Tensor,
    ) -> torch.Tensor:
        # input:  x_price (B, T, 4), x_volume (B, T, 1)
        # output: (B, T, d_model_price + d_model_vol)
        if x_price.dim() != 3 or x_price.size(-1) != 4:
            raise ValueError(f"x_price must be (B, T, 4), got {tuple(x_price.shape)}")
        if x_volume.dim() != 3 or x_volume.size(-1) != 1:
            raise ValueError(f"x_volume must be (B, T, 1), got {tuple(x_volume.shape)}")
        if x_price.size(0) != x_volume.size(0) or x_price.size(1) != x_volume.size(1):
            raise ValueError(
                f"x_price ({tuple(x_price.shape)}) and x_volume "
                f"({tuple(x_volume.shape)}) must agree on batch and time dims"
            )

        price_norm = self.normalize_price(x_price)  # (B, T, 4)
        volume_norm = self.normalize_volume(x_volume)  # (B, T, 1)

        p = self.input_proj_price(price_norm)  # (B, T, d_model_price)
        if self.pos_enc_price is not None:
            p = self.pos_enc_price(p)
        v = self.input_proj_vol(volume_norm)  # (B, T, d_model_vol)

        x_fused = torch.cat([p, v], dim=-1)  # (B, T, d_model)
        return self.transformer(x_fused)  # (B, T, d_model)
