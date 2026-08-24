"""Gating modules for Mixture-of-Experts (MoE) composite templates.

Public API:
    TopKGating(d_model, n_experts, k=1, temperature=1.0)
    SoftmaxGating(d_model, n_experts, temperature=1.0)
    HashGating(n_experts, hash_dim)

Used by ``composite_moe.py.j2`` (W5). Each gate maps an input representation
to a per-expert routing distribution over ``n_experts`` experts.

References:
- Shazeer et al. 2017 "Outrageously Large Neural Networks" (Top-K gating)
- Fedus et al. 2022 "Switch Transformer" (Top-1 routing variant of TopK with k=1)
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class TopKGating(nn.Module):
    """Top-K gating with softmax over the selected experts.

    Maps ``x`` through a single ``Linear(d_model, n_experts)``, divides by
    ``temperature``, picks the top-K logits per token, and softmaxes within
    that set so the K returned weights sum to 1. The ``gates`` tensor is the
    full per-expert distribution (zeros for unselected) for diagnostics.

    forward contract:
        input:  (B, d_model)
        output:
            gates:          (B, n_experts) -- softmax weights, zeros off the top-K
            top_k_idx:      (B, k)         -- expert indices in [0, n_experts)
            top_k_weights:  (B, k)         -- weights matching ``top_k_idx``
    """

    def __init__(
        self,
        d_model: int,
        n_experts: int,
        k: int = 1,
        temperature: float = 1.0,
    ):
        super().__init__()
        if d_model <= 0:
            raise ValueError(f"d_model must be > 0, got {d_model}")
        if n_experts <= 0:
            raise ValueError(f"n_experts must be > 0, got {n_experts}")
        if not 1 <= k <= n_experts:
            raise ValueError(f"k must be in [1, n_experts={n_experts}], got {k}")
        if temperature <= 0:
            raise ValueError(f"temperature must be > 0, got {temperature}")

        self.d_model = d_model
        self.n_experts = n_experts
        self.k = k
        self.temperature = float(temperature)
        self.proj = nn.Linear(d_model, n_experts)
        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.xavier_uniform_(self.proj.weight)
        if self.proj.bias is not None:
            nn.init.zeros_(self.proj.bias)

    def forward(
        self, x: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        # input:  (B, d_model)
        # output: gates (B, n_experts), top_k_idx (B, k), top_k_weights (B, k)
        logits = self.proj(x) / self.temperature  # (B, n_experts)
        top_k_logits, top_k_idx = logits.topk(self.k, dim=-1)
        top_k_weights = F.softmax(top_k_logits, dim=-1)  # (B, k)
        gates = torch.zeros_like(logits).scatter_(
            dim=-1, index=top_k_idx, src=top_k_weights
        )
        return gates, top_k_idx, top_k_weights


class SoftmaxGating(nn.Module):
    """Full softmax gating -- every expert gets a non-zero weight.

    No sparsity. Cheaper to train and more stable than top-K for small
    expert counts. Pair with weighted-sum ensembling in the composite
    template body.

    forward contract:
        input:  (B, d_model)
        output: (B, n_experts) -- softmax routing distribution
    """

    def __init__(
        self,
        d_model: int,
        n_experts: int,
        temperature: float = 1.0,
    ):
        super().__init__()
        if d_model <= 0:
            raise ValueError(f"d_model must be > 0, got {d_model}")
        if n_experts <= 0:
            raise ValueError(f"n_experts must be > 0, got {n_experts}")
        if temperature <= 0:
            raise ValueError(f"temperature must be > 0, got {temperature}")

        self.d_model = d_model
        self.n_experts = n_experts
        self.temperature = float(temperature)
        self.proj = nn.Linear(d_model, n_experts)
        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.xavier_uniform_(self.proj.weight)
        if self.proj.bias is not None:
            nn.init.zeros_(self.proj.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (B, d_model)
        # output: (B, n_experts)
        return F.softmax(self.proj(x) / self.temperature, dim=-1)


class HashGating(nn.Module):
    """Deterministic input-hashing routing -- no learned parameters.

    Hashes the first ``hash_dim`` features of each input vector via a fixed
    random projection (registered as a non-trainable buffer). The argmax
    of the hash determines the expert; weight is 1.0 on that expert. Useful
    for sharding workloads across experts without a learned router.

    forward contract:
        input:  (B, d_in) where d_in >= hash_dim
        output: (B, n_experts) -- one-hot routing
    """

    def __init__(self, n_experts: int, hash_dim: int, seed: int = 0):
        super().__init__()
        if n_experts <= 0:
            raise ValueError(f"n_experts must be > 0, got {n_experts}")
        if hash_dim <= 0:
            raise ValueError(f"hash_dim must be > 0, got {hash_dim}")

        self.n_experts = n_experts
        self.hash_dim = hash_dim

        # Fixed random hashing matrix; deterministic given seed.
        gen = torch.Generator().manual_seed(int(seed))
        H = torch.randn(hash_dim, n_experts, generator=gen)
        self.register_buffer("H", H)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (B, d_in) where d_in >= hash_dim
        # output: (B, n_experts) one-hot
        if x.size(-1) < self.hash_dim:
            raise ValueError(
                f"HashGating input feature dim ({x.size(-1)}) "
                f"must be >= hash_dim ({self.hash_dim})"
            )
        # Use first hash_dim features for routing; deterministic per input.
        h = x[..., : self.hash_dim] @ self.H  # (B, n_experts)
        idx = h.argmax(dim=-1)               # (B,)
        return F.one_hot(idx, num_classes=self.n_experts).to(dtype=x.dtype)
