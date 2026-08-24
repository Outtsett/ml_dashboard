"""Fusion modules for multimodal composite templates.

Public API:
    ConcatFusion(d_in_list, d_out)
    CrossAttentionFusion(d_query, d_kv_list, n_heads)
    GatedFusion(d_in_list, d_out)

Used by ``composite_multimodal.py.j2`` (W5) which fuses heterogeneous encoder
outputs (price-window encoder + volume-profile encoder + microstructure
encoder, etc.) into a single representation for the head.

All three fusion types:
- accept a sequence of per-modality tensors of shape (B, d_in_i)
- emit a single fused tensor of shape (B, d_out)
"""

from __future__ import annotations

import torch
import torch.nn as nn
from src.ml.blocks.attention import CrossAttention


class ConcatFusion(nn.Module):
    """Concatenate modalities along feature dim, then linear-project to d_out.

    Simplest possible fusion -- baseline for the multimodal composite template.

    forward contract:
        input:  list of N tensors, each (B, d_in_i)
        output: (B, d_out)
    """

    def __init__(self, d_in_list: list[int] | tuple[int, ...], d_out: int):
        super().__init__()
        if len(d_in_list) == 0:
            raise ValueError("d_in_list must have at least one element")
        if any(d <= 0 for d in d_in_list):
            raise ValueError(f"d_in_list must all be > 0, got {d_in_list}")
        if d_out <= 0:
            raise ValueError(f"d_out must be > 0, got {d_out}")

        self.d_in_list = list(d_in_list)
        self.d_out = d_out
        self.proj = nn.Linear(sum(d_in_list), d_out)
        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.xavier_uniform_(self.proj.weight)
        if self.proj.bias is not None:
            nn.init.zeros_(self.proj.bias)

    def forward(self, modalities: list[torch.Tensor]) -> torch.Tensor:
        # input:  N tensors each (B, d_in_i)
        # output: (B, d_out)
        if len(modalities) != len(self.d_in_list):
            raise ValueError(
                f"expected {len(self.d_in_list)} modalities, got {len(modalities)}"
            )
        for i, (m, d) in enumerate(zip(modalities, self.d_in_list)):
            if m.dim() != 2 or m.size(-1) != d:
                raise ValueError(
                    f"modality {i} must be (B, {d}), got {tuple(m.shape)}"
                )
        x = torch.cat(modalities, dim=-1)  # (B, sum_d)
        return self.proj(x)


class CrossAttentionFusion(nn.Module):
    """Query attends over each (k/v) modality; outputs are summed.

    Each modality gets its own ``CrossAttention(d_query, d_kv_i)`` head; the
    fused output is the sum of cross-attended results from each modality
    (linear in modality count, retains query dim). Treats query as a single
    token by adding a length-1 time axis under the hood.

    forward contract:
        input:
            query:      (B, d_query)
            modalities: list of N tensors, each (B, d_kv_i)
        output:
            (B, d_query)
    """

    def __init__(
        self,
        d_query: int,
        d_kv_list: list[int] | tuple[int, ...],
        n_heads: int,
    ):
        super().__init__()
        if d_query <= 0:
            raise ValueError(f"d_query must be > 0, got {d_query}")
        if len(d_kv_list) == 0:
            raise ValueError("d_kv_list must have at least one element")
        if any(d <= 0 for d in d_kv_list):
            raise ValueError(f"d_kv_list must all be > 0, got {d_kv_list}")
        if n_heads <= 0 or d_query % n_heads != 0:
            raise ValueError(
                f"d_query ({d_query}) must be divisible by n_heads ({n_heads})"
            )

        self.d_query = d_query
        self.d_kv_list = list(d_kv_list)
        self.n_heads = n_heads
        self.attns = nn.ModuleList(
            [
                CrossAttention(d_model_q=d_query, d_model_kv=d_kv, n_heads=n_heads)
                for d_kv in d_kv_list
            ]
        )

    def forward(
        self, query: torch.Tensor, modalities: list[torch.Tensor]
    ) -> torch.Tensor:
        # input:  query (B, d_query), modalities[i] (B, d_kv_i)
        # output: (B, d_query)
        if len(modalities) != len(self.d_kv_list):
            raise ValueError(
                f"expected {len(self.d_kv_list)} modalities, got {len(modalities)}"
            )
        if query.dim() != 2 or query.size(-1) != self.d_query:
            raise ValueError(
                f"query must be (B, {self.d_query}), got {tuple(query.shape)}"
            )

        q = query.unsqueeze(1)  # (B, 1, d_query)
        out = torch.zeros_like(query)  # (B, d_query)
        for i, (m, attn) in enumerate(zip(modalities, self.attns)):
            if m.dim() != 2 or m.size(-1) != self.d_kv_list[i]:
                raise ValueError(
                    f"modality {i} must be (B, {self.d_kv_list[i]}), "
                    f"got {tuple(m.shape)}"
                )
            kv = m.unsqueeze(1)             # (B, 1, d_kv_i)
            out = out + attn(q, kv).squeeze(1)
        return out


class GatedFusion(nn.Module):
    """Sigmoid-gated weighted sum across modalities, then linear-project.

    Per modality, a learned ``Linear(d_in_i, 1)`` produces a sigmoid gate; per
    modality, a learned ``Linear(d_in_i, d_out)`` projects into the shared
    output space. The gates re-weight the projections additively -- the
    network can shut off (gate -> 0) any modality. Final ``Linear(d_out, d_out)``
    refines the sum.

    forward contract:
        input:  list of N tensors, each (B, d_in_i)
        output: (B, d_out)
    """

    def __init__(self, d_in_list: list[int] | tuple[int, ...], d_out: int):
        super().__init__()
        if len(d_in_list) == 0:
            raise ValueError("d_in_list must have at least one element")
        if any(d <= 0 for d in d_in_list):
            raise ValueError(f"d_in_list must all be > 0, got {d_in_list}")
        if d_out <= 0:
            raise ValueError(f"d_out must be > 0, got {d_out}")

        self.d_in_list = list(d_in_list)
        self.d_out = d_out
        self.gates = nn.ModuleList([nn.Linear(d, 1) for d in d_in_list])
        self.projs = nn.ModuleList([nn.Linear(d, d_out) for d in d_in_list])
        self.refine = nn.Linear(d_out, d_out)
        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(self, modalities: list[torch.Tensor]) -> torch.Tensor:
        # input:  N tensors each (B, d_in_i)
        # output: (B, d_out)
        if len(modalities) != len(self.d_in_list):
            raise ValueError(
                f"expected {len(self.d_in_list)} modalities, got {len(modalities)}"
            )
        out = None
        for i, m in enumerate(modalities):
            if m.dim() != 2 or m.size(-1) != self.d_in_list[i]:
                raise ValueError(
                    f"modality {i} must be (B, {self.d_in_list[i]}), "
                    f"got {tuple(m.shape)}"
                )
            g = torch.sigmoid(self.gates[i](m))   # (B, 1)
            p = self.projs[i](m)                  # (B, d_out)
            contrib = g * p
            out = contrib if out is None else out + contrib
        return self.refine(out)
