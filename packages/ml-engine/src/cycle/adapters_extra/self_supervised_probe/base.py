"""The pretext contract every self-supervised variant follows, and the losses they share.

A variant is a ``Pretext`` (a ``torch.nn.Module``) that the adapter drives:

    Pretext(feature_count, window, parameters, config)   built under a seeded RNG
    plan_config(pool_inputs, feature_names, parameters, seed) -> dict   (classmethod;
                               a JSON-able plan read from the pool, e.g. a column split)
    configure(pool_inputs)     buffers fitted on the pool (e.g. token bin edges)
    pretext_loss(batch, generator, progress) -> (loss, {name: float})
    after_step(progress)       momentum-teacher updates
    embed(inputs) -> (B, embedding_width)   the frozen representation the probe reads

``inputs`` are the adapter's standardised features: ``(B, F)`` for a row
variant, ``(B, window, F)`` for a window variant (the causal window ending at
the bar). A pretext batch is the same, except that a variant with
``future_steps = K`` receives ``(B, window + K, F)``: the window ending at the
anchor bar followed by the next K bars, all inside the training span (the
adapter checks that bound; see ``adapter.py``).

Every random draw of a pretext (augmentations, masks, crops) comes from the
``generator`` the adapter passes, seeded per fit, so two fits on the same rows
are bit-identical. ``embed`` draws nothing: a bar's embedding is a function of
its window alone.
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as functional
from torch import nn


class Pretext(nn.Module):
    #: reads a window of ``sequence_length`` bars (else one feature row)
    windowed = False
    #: bars after the anchor a pretext batch carries (future targets inside the training span)
    future_steps = 0
    #: "adamw", or "sgd" (SimSiam's SGD with momentum and cosine decay)
    optimizer_kind = "adamw"

    def __init__(self, feature_count: int, window: int, parameters: dict, config: dict | None = None) -> None:
        super().__init__()
        self.feature_count = int(feature_count)
        self.window = int(window)
        self.settings = dict(parameters)
        self.config = dict(config or {})

    # ── set-up read from the pool ──
    @classmethod
    def plan_config(cls, pool_inputs, feature_names, parameters: dict, seed: int) -> dict:
        return {}

    def configure(self, pool_inputs: torch.Tensor) -> None:
        """Fit buffers on the standardised pool (float32 tensor, row or window shape)."""

    # ── the objective ──
    @property
    def embedding_width(self) -> int:
        raise NotImplementedError

    def embed(self, inputs: torch.Tensor) -> torch.Tensor:
        raise NotImplementedError

    def pretext_loss(self, batch: torch.Tensor, generator: torch.Generator, progress: float):
        raise NotImplementedError

    def after_step(self, progress: float) -> None:
        """Called after every optimiser step (momentum teachers update here)."""

    def training_parameters(self) -> list[nn.Parameter]:
        return [parameter for parameter in self.parameters() if parameter.requires_grad]

    def before_optimizer_step(self) -> None:
        """Called between backward and the optimiser step (a variant with its own
        adversarial parameters handles them here)."""

    def describe(self) -> dict:
        """Numbers worth logging once per epoch (plain floats)."""
        return {}


# ─── momentum teachers ─────────────────────────────────────────────────────


def frozen_copy(module: nn.Module) -> nn.Module:
    """A deep copy that receives no gradient (a momentum teacher)."""
    import copy

    teacher = copy.deepcopy(module)
    for parameter in teacher.parameters():
        parameter.requires_grad_(False)
    return teacher


@torch.no_grad()
def ema_update(teacher: nn.Module, student: nn.Module, momentum: float) -> None:
    """teacher <- momentum * teacher + (1 - momentum) * student, parameter by parameter."""
    for target, online in zip(teacher.parameters(), student.parameters()):
        target.mul_(momentum).add_(online.detach(), alpha=1.0 - momentum)
    for target, online in zip(teacher.buffers(), student.buffers()):
        target.copy_(online)


def cosine_momentum(start: float, progress: float) -> float:
    """BYOL's schedule: ``start`` at the first step rising to 1 at the last (cosine)."""
    progress = min(max(float(progress), 0.0), 1.0)
    return 1.0 - (1.0 - float(start)) * (math.cos(math.pi * progress) + 1.0) / 2.0


# ─── shared losses ─────────────────────────────────────────────────────────


def negative_cosine(prediction: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    """-cos(prediction, stop_gradient(target)), averaged over the batch."""
    return -(functional.normalize(prediction, dim=-1) * functional.normalize(target.detach(), dim=-1)).sum(-1).mean()


def info_nce(query: torch.Tensor, key: torch.Tensor, temperature: float,
             negatives: torch.Tensor | None = None) -> torch.Tensor:
    """InfoNCE: row i of ``key`` is the positive of row i of ``query``, every
    other key row (and every row of ``negatives``) a negative."""
    query = functional.normalize(query, dim=-1)
    key = functional.normalize(key, dim=-1)
    logits = query @ key.t()
    if negatives is not None and negatives.shape[0]:
        logits = torch.cat([logits, query @ functional.normalize(negatives, dim=-1).t()], dim=1)
    targets = torch.arange(query.shape[0], device=query.device)
    return functional.cross_entropy(logits / float(temperature), targets)


def nt_xent(first: torch.Tensor, second: torch.Tensor, temperature: float) -> torch.Tensor:
    """SimCLR's normalised-temperature cross entropy over the 2N views: each
    view's positive is the other view of its row, the other 2N - 2 are negatives."""
    count = first.shape[0]
    both = functional.normalize(torch.cat([first, second], dim=0), dim=-1)
    similarity = both @ both.t() / float(temperature)
    similarity = similarity.masked_fill(torch.eye(2 * count, dtype=torch.bool, device=both.device), float("-inf"))
    targets = torch.cat([torch.arange(count, 2 * count), torch.arange(0, count)]).to(both.device)
    return functional.cross_entropy(similarity, targets)


def variance_hinge(embedding: torch.Tensor, floor: float = 1.0) -> torch.Tensor:
    """VICReg's variance term: mean over dimensions of relu(floor - std over the batch)."""
    deviation = torch.sqrt(embedding.var(dim=0, unbiased=False) + 1e-4)
    return functional.relu(floor - deviation).mean()


def batch_deviation(embedding: torch.Tensor) -> float:
    """The mean per-dimension standard deviation of the L2-normalised embedding
    (about 1/sqrt(d) when healthy, 0 when collapsed): the collapse monitor."""
    with torch.no_grad():
        return float(functional.normalize(embedding, dim=-1).std(dim=0, unbiased=False).mean())


__all__ = ["Pretext", "batch_deviation", "cosine_momentum", "ema_update", "frozen_copy", "info_nce",
           "negative_cosine", "nt_xent", "variance_hinge"]
