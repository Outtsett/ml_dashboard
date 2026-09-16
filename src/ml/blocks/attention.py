"""Attention building blocks.

Public API:
    PositionalEncoding(d_model, max_len=5000)
    ALiBiBias(n_heads, max_seq_len)
    MultiHeadSelfAttention(d_model, n_heads, dropout=0.1)
    CrossAttention(d_model_q, d_model_kv, n_heads, dropout=0.1)

PositionalEncoding is the verbatim Vaswani sin/cos encoding lifted from
trading_model/cnn_transformer/model.py::SinusoidalPositionalEncoding.

ALiBiBias implements Press et al. 2022 "Train Short, Test Long" linear-bias
attention prior with the geometric per-head slope schedule m_h = 2^(-8h/H).
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn


class PositionalEncoding(nn.Module):
    """Fixed sinusoidal positional encoding (Vaswani et al. 2017).

    Lifted verbatim from trading_model/cnn_transformer/model.py
    (class SinusoidalPositionalEncoding) with renamed buffer length parameter
    to follow the standard ``max_len`` convention used outside that codebase.

    forward contract:
        input:  (B, T, d_model)
        output: (B, T, d_model)  with sinusoidal PE added in-place-style
    """

    def __init__(self, d_model: int, max_len: int = 5000):
        super().__init__()
        if d_model <= 0:
            raise ValueError(f"d_model must be > 0, got {d_model}")
        if max_len <= 0:
            raise ValueError(f"max_len must be > 0, got {max_len}")

        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float32).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2, dtype=torch.float32) * (-math.log(10000.0) / d_model)
        )
        # If d_model is odd, sin fills ceil(d/2) cols, cos fills floor(d/2) cols.
        pe[:, 0::2] = torch.sin(position * div_term[: pe[:, 0::2].size(1)])
        pe[:, 1::2] = torch.cos(position * div_term[: pe[:, 1::2].size(1)])
        self.register_buffer("pe", pe.unsqueeze(0))  # (1, max_len, d_model)
        self.d_model = d_model
        self.max_len = max_len

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (B, T, d_model)
        # output: (B, T, d_model)
        T = x.size(1)
        if T > self.max_len:
            raise ValueError(
                f"PositionalEncoding sequence length {T} exceeds max_len {self.max_len}"
            )
        return x + self.pe[:, :T]


class ALiBiBias(nn.Module):
    """Attention with Linear Biases (Press, Smith & Lewis 2022).

    Builds a per-head additive attention bias of shape (n_heads, T, T) where
    bias[h, i, j] = -m_h * |i - j| and m_h = 2^(-8 h / H) for h in [1, H].

    The mask is reshaped to (B * n_heads, T, T) on demand to match the layout
    PyTorch's ``nn.MultiheadAttention`` expects when ``need_weights=False``
    and a ``attn_mask`` is supplied per-batch-per-head.

    forward contract:
        input:  batch_size: int, seq_len: int (<= max_seq_len)
        output: (batch_size * n_heads, seq_len, seq_len)
    """

    def __init__(self, n_heads: int, max_seq_len: int):
        super().__init__()
        if n_heads <= 0:
            raise ValueError(f"n_heads must be > 0, got {n_heads}")
        if max_seq_len <= 0:
            raise ValueError(f"max_seq_len must be > 0, got {max_seq_len}")

        self.n_heads = n_heads
        self.max_seq_len = max_seq_len

        h_idx = torch.arange(1, n_heads + 1, dtype=torch.float32)
        slopes = torch.pow(2.0, -8.0 * h_idx / n_heads)  # (H,)
        self.register_buffer("slopes", slopes)

        positions = torch.arange(max_seq_len, dtype=torch.float32)
        # |i - j|: (max_seq_len, max_seq_len)
        delta = (positions.unsqueeze(0) - positions.unsqueeze(1)).abs()
        # bias: (H, max_seq_len, max_seq_len)
        bias = -slopes.view(n_heads, 1, 1) * delta.unsqueeze(0)
        self.register_buffer("bias", bias)

    def forward(self, batch_size: int, seq_len: int) -> torch.Tensor:
        # input:  scalar batch_size, seq_len
        # output: (batch_size * n_heads, seq_len, seq_len)
        if seq_len > self.max_seq_len:
            raise ValueError(f"ALiBiBias seq_len {seq_len} exceeds max_seq_len {self.max_seq_len}")
        if batch_size <= 0:
            raise ValueError(f"batch_size must be > 0, got {batch_size}")
        bias = self.bias[:, :seq_len, :seq_len]  # (H, T, T)
        # broadcast to (B, H, T, T) then reshape to (B*H, T, T)
        bias = bias.unsqueeze(0).expand(batch_size, -1, -1, -1)
        return bias.reshape(batch_size * self.n_heads, seq_len, seq_len)


class MultiHeadSelfAttention(nn.Module):
    """Standard multi-head self-attention with optional additive mask.

    Wrapped around ``nn.MultiheadAttention`` (batch_first=True) for clarity in
    composed templates. Xavier init applied to the projection weights to keep
    gradient norms stable at depth.

    forward contract:
        input:  (B, T, d_model), optional attn_mask (B*H, T, T) or (T, T)
        output: (B, T, d_model)
    """

    def __init__(self, d_model: int, n_heads: int, dropout: float = 0.1):
        super().__init__()
        if d_model <= 0:
            raise ValueError(f"d_model must be > 0, got {d_model}")
        if n_heads <= 0 or d_model % n_heads != 0:
            raise ValueError(f"d_model ({d_model}) must be divisible by n_heads ({n_heads})")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")

        self.d_model = d_model
        self.n_heads = n_heads
        self.attn = nn.MultiheadAttention(
            embed_dim=d_model,
            num_heads=n_heads,
            dropout=dropout,
            batch_first=True,
        )
        self._init_weights()

    def _init_weights(self) -> None:
        if self.attn.in_proj_weight is not None:
            nn.init.xavier_uniform_(self.attn.in_proj_weight)
        if self.attn.in_proj_bias is not None:
            nn.init.zeros_(self.attn.in_proj_bias)
        nn.init.xavier_uniform_(self.attn.out_proj.weight)
        if self.attn.out_proj.bias is not None:
            nn.init.zeros_(self.attn.out_proj.bias)

    def forward(
        self,
        x: torch.Tensor,
        attn_mask: torch.Tensor | None = None,
        key_padding_mask: torch.Tensor | None = None,
    ) -> torch.Tensor:
        # input:  (B, T, d_model)
        # output: (B, T, d_model)
        out, _ = self.attn(
            x,
            x,
            x,
            attn_mask=attn_mask,
            key_padding_mask=key_padding_mask,
            need_weights=False,
        )
        return out


class CrossAttention(nn.Module):
    """Cross-attention from query stream to a separate key/value stream.

    Used by W5 multimodal templates that fuse heterogeneous encoder outputs.
    If ``d_model_q != d_model_kv`` an inline ``nn.Linear`` projects keys/values
    into the query dim before attention is computed.

    forward contract:
        input:  q: (B, T_q, d_model_q), kv: (B, T_kv, d_model_kv)
        output: (B, T_q, d_model_q)
    """

    def __init__(
        self,
        d_model_q: int,
        d_model_kv: int,
        n_heads: int,
        dropout: float = 0.1,
    ):
        super().__init__()
        if d_model_q <= 0 or d_model_kv <= 0:
            raise ValueError(f"d_model_q ({d_model_q}) and d_model_kv ({d_model_kv}) must be > 0")
        if n_heads <= 0 or d_model_q % n_heads != 0:
            raise ValueError(f"d_model_q ({d_model_q}) must be divisible by n_heads ({n_heads})")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")

        self.d_model_q = d_model_q
        self.d_model_kv = d_model_kv
        self.n_heads = n_heads
        self.kv_proj = (
            nn.Linear(d_model_kv, d_model_q) if d_model_kv != d_model_q else nn.Identity()
        )
        self.attn = nn.MultiheadAttention(
            embed_dim=d_model_q,
            num_heads=n_heads,
            dropout=dropout,
            batch_first=True,
        )
        self._init_weights()

    def _init_weights(self) -> None:
        if isinstance(self.kv_proj, nn.Linear):
            nn.init.xavier_uniform_(self.kv_proj.weight)
            if self.kv_proj.bias is not None:
                nn.init.zeros_(self.kv_proj.bias)
        if self.attn.in_proj_weight is not None:
            nn.init.xavier_uniform_(self.attn.in_proj_weight)
        if self.attn.in_proj_bias is not None:
            nn.init.zeros_(self.attn.in_proj_bias)
        nn.init.xavier_uniform_(self.attn.out_proj.weight)
        if self.attn.out_proj.bias is not None:
            nn.init.zeros_(self.attn.out_proj.bias)

    def forward(
        self,
        q: torch.Tensor,
        kv: torch.Tensor,
        attn_mask: torch.Tensor | None = None,
        key_padding_mask: torch.Tensor | None = None,
    ) -> torch.Tensor:
        # input:  q: (B, T_q, d_model_q), kv: (B, T_kv, d_model_kv)
        # output: (B, T_q, d_model_q)
        kv_proj = self.kv_proj(kv)
        out, _ = self.attn(
            q,
            kv_proj,
            kv_proj,
            attn_mask=attn_mask,
            key_padding_mask=key_padding_mask,
            need_weights=False,
        )
        return out
