"""Output heads for generated PyTorch templates.

Public API:
    ClassificationHead(in_dim, n_classes)
    BinaryDirectionHead(in_dim)
    RegressionHead(in_dim, out_dim=1)
    RangeBucketHead(in_dim, n_buckets)   -- mirrors trading_model's range_class
    VariationalHead(in_dim, latent_dim)  -- VAE encoder head with reparameterize()

Heads are intentionally thin: a single ``nn.Linear`` plus the appropriate
output non-linearity (``log_softmax`` for classification, identity for
regression, ``mu/logvar`` split for VAE). Loss is the caller's responsibility
-- pair classification heads with ``F.nll_loss``, regression with ``F.mse_loss``,
VAE with reconstruction + KLD.
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class ClassificationHead(nn.Module):
    """``Linear -> log_softmax`` over ``n_classes`` logits.

    Pair with ``F.nll_loss`` (negative log-likelihood). Returns log-probabilities,
    not raw logits, so downstream code can sum over folds without re-softmaxing.

    forward contract:
        input:  (B, in_dim) or (B, T, in_dim)
        output: (B, n_classes) or (B, T, n_classes) -- log-probabilities
    """

    def __init__(self, in_dim: int, n_classes: int):
        super().__init__()
        if in_dim <= 0:
            raise ValueError(f"in_dim must be > 0, got {in_dim}")
        if n_classes < 2:
            raise ValueError(f"n_classes must be >= 2, got {n_classes}")
        self.in_dim = in_dim
        self.n_classes = n_classes
        self.proj = nn.Linear(in_dim, n_classes)
        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.xavier_uniform_(self.proj.weight)
        if self.proj.bias is not None:
            nn.init.zeros_(self.proj.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (B, in_dim) or (B, T, in_dim)
        # output: (B, n_classes) or (B, T, n_classes)
        return F.log_softmax(self.proj(x), dim=-1)


class BinaryDirectionHead(nn.Module):
    """``Linear(in_dim, 2)`` -- two-class direction (down=0, up=1).

    Returns RAW logits (not log-prob) so the caller can use either
    ``F.cross_entropy`` (which applies log_softmax internally) or peel off
    ``logits[:, 1] - logits[:, 0]`` for a conviction signal as in the
    daily-direction head described in the project CLAUDE.md.

    forward contract:
        input:  (B, in_dim)
        output: (B, 2) -- raw logits
    """

    def __init__(self, in_dim: int):
        super().__init__()
        if in_dim <= 0:
            raise ValueError(f"in_dim must be > 0, got {in_dim}")
        self.in_dim = in_dim
        self.proj = nn.Linear(in_dim, 2)
        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.xavier_uniform_(self.proj.weight)
        if self.proj.bias is not None:
            nn.init.zeros_(self.proj.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (B, in_dim)
        # output: (B, 2)
        return self.proj(x)


class RegressionHead(nn.Module):
    """Plain ``Linear(in_dim, out_dim)`` for regression targets.

    No output non-linearity -- raw real-valued outputs. Pair with
    ``F.mse_loss``, ``F.l1_loss``, or ``F.huber_loss`` per task.

    forward contract:
        input:  (B, in_dim)
        output: (B, out_dim)
    """

    def __init__(self, in_dim: int, out_dim: int = 1):
        super().__init__()
        if in_dim <= 0:
            raise ValueError(f"in_dim must be > 0, got {in_dim}")
        if out_dim <= 0:
            raise ValueError(f"out_dim must be > 0, got {out_dim}")
        self.in_dim = in_dim
        self.out_dim = out_dim
        self.proj = nn.Linear(in_dim, out_dim)
        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.xavier_uniform_(self.proj.weight)
        if self.proj.bias is not None:
            nn.init.zeros_(self.proj.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (B, in_dim)
        # output: (B, out_dim)
        return self.proj(x)


class RangeBucketHead(nn.Module):
    """``Linear -> log_softmax`` over ``n_buckets`` -- next-close range buckets.

    Mirrors trading_model's ``range_class`` head described in the project
    CLAUDE.md (K=21 default, 2pt buckets, headline metric within2pt_acc).
    Functionally identical to ``ClassificationHead`` but the separate name
    documents intent and lets eval helpers dispatch on type.

    forward contract:
        input:  (B, in_dim)
        output: (B, n_buckets) -- log-probabilities
    """

    def __init__(self, in_dim: int, n_buckets: int):
        super().__init__()
        if in_dim <= 0:
            raise ValueError(f"in_dim must be > 0, got {in_dim}")
        if n_buckets < 2:
            raise ValueError(f"n_buckets must be >= 2, got {n_buckets}")
        self.in_dim = in_dim
        self.n_buckets = n_buckets
        self.proj = nn.Linear(in_dim, n_buckets)
        self._init_weights()

    def _init_weights(self) -> None:
        nn.init.xavier_uniform_(self.proj.weight)
        if self.proj.bias is not None:
            nn.init.zeros_(self.proj.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (B, in_dim)
        # output: (B, n_buckets)
        return F.log_softmax(self.proj(x), dim=-1)


class VariationalHead(nn.Module):
    """VAE bottleneck head -- emits ``(mu, logvar)`` and exposes ``reparameterize``.

    Two parallel ``Linear`` projections give the mean and log-variance of the
    diagonal-Gaussian posterior ``q(z | x) = N(mu, exp(logvar))``. The
    reparameterization trick (Kingma & Welling 2014) is exposed as a static
    method so the encoder graph stays differentiable end-to-end.

    forward contract:
        input:  (B, in_dim)
        output: (mu: (B, latent_dim), logvar: (B, latent_dim))
    """

    def __init__(self, in_dim: int, latent_dim: int):
        super().__init__()
        if in_dim <= 0:
            raise ValueError(f"in_dim must be > 0, got {in_dim}")
        if latent_dim <= 0:
            raise ValueError(f"latent_dim must be > 0, got {latent_dim}")
        self.in_dim = in_dim
        self.latent_dim = latent_dim
        self.fc_mu = nn.Linear(in_dim, latent_dim)
        self.fc_logvar = nn.Linear(in_dim, latent_dim)
        self._init_weights()

    def _init_weights(self) -> None:
        for m in (self.fc_mu, self.fc_logvar):
            nn.init.xavier_uniform_(m.weight)
            if m.bias is not None:
                nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        # input:  (B, in_dim)
        # output: (mu (B, latent_dim), logvar (B, latent_dim))
        mu = self.fc_mu(x)
        logvar = self.fc_logvar(x)
        return mu, logvar

    @staticmethod
    def reparameterize(mu: torch.Tensor, logvar: torch.Tensor) -> torch.Tensor:
        """Sample ``z = mu + exp(0.5 * logvar) * eps`` with ``eps ~ N(0, I)``.

        input:  mu, logvar (B, latent_dim)
        output: z (B, latent_dim)
        """
        if mu.shape != logvar.shape:
            raise ValueError(f"mu shape {tuple(mu.shape)} != logvar shape {tuple(logvar.shape)}")
        std = torch.exp(0.5 * logvar)
        eps = torch.randn_like(std)
        return mu + eps * std
