"""What every torch density variant shares.

A variant subclasses ``TorchDensity`` and writes:

    build() -> nn.Module                       the network (float32; fixed noise grids as buffers)
    loss(network, x, y) -> scalar tensor       one minibatch's training loss
    class_scores(network, x) -> (n, K)         score_k(x) for every class, deterministic

and may override ``prepare`` (a data-dependent initialisation on the training
rows), ``train_epoch`` (a training step that is not "Adam on ``loss``"),
``epoch_count`` and ``make_optimizer``.

``class_scores`` must be a pure function of the row and the network: no
random draw (a denoising scorer uses the fixed grid registered at build), no
dependence on the other rows of the batch (no batch statistics in eval mode),
so a bar scored alone equals the same bar scored in a batch. The adapter runs
it in float64 on the CPU for every prediction it keeps (``scoring_copy``), so
the one-row and batch results agree to ~1e-15.
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import torch
from torch import nn

LOG_TWO_PI = math.log(2.0 * math.pi)
SCORE_CHUNK_ROWS = 65536          # network evaluations per scoring chunk


def resolve_device(device: str | None) -> str:
    name = str(device or "cpu")
    if name in ("cuda", "auto") and torch.cuda.is_available():
        return "cuda"
    return "cpu"


def activation_layer(name: str = "silu") -> nn.Module:
    return {"silu": nn.SiLU, "tanh": nn.Tanh, "relu": nn.ReLU, "softplus": nn.Softplus}[name]()


def multilayer_perceptron(input_size: int, hidden_size: int, layer_count: int, output_size: int,
                          activation: str = "silu", zero_last: bool = False) -> nn.Sequential:
    """``layer_count`` hidden layers of ``hidden_size`` units, then a linear output."""
    layers: list[nn.Module] = []
    width = input_size
    for _ in range(max(1, int(layer_count))):
        layers += [nn.Linear(width, hidden_size), activation_layer(activation)]
        width = hidden_size
    last = nn.Linear(width, output_size)
    if zero_last:
        nn.init.zeros_(last.weight)
        nn.init.zeros_(last.bias)
    layers.append(last)
    return nn.Sequential(*layers)


def sinusoidal_embedding(values: torch.Tensor, size: int) -> torch.Tensor:
    """(n,) positions in [0, 1] -> (n, size) sine / cosine features (the transformer / DDPM time embedding)."""
    half = max(1, size // 2)
    frequencies = torch.exp(-math.log(10000.0) * torch.arange(half, dtype=values.dtype, device=values.device) / half)
    angles = values.reshape(-1, 1) * 1000.0 * frequencies.reshape(1, -1)
    embedding = torch.cat([torch.sin(angles), torch.cos(angles)], dim=1)
    if embedding.shape[1] < size:
        embedding = torch.cat([embedding, torch.zeros(embedding.shape[0], size - embedding.shape[1],
                                                      dtype=values.dtype, device=values.device)], dim=1)
    return embedding


def fixed_normal(shape: tuple[int, ...], seed: int, salt: int) -> torch.Tensor:
    """A standard-normal tensor that depends only on (seed, salt, shape): the fixed noise grids."""
    generator = torch.Generator().manual_seed((int(seed) * 1_000_003 + int(salt)) % (2 ** 63 - 1))
    return torch.randn(*shape, generator=generator, dtype=torch.float32)


def fixed_uniform(shape: tuple[int, ...], seed: int, salt: int) -> torch.Tensor:
    generator = torch.Generator().manual_seed((int(seed) * 1_000_003 + int(salt)) % (2 ** 63 - 1))
    return torch.rand(*shape, generator=generator, dtype=torch.float32)


def standard_normal_log_density(z: torch.Tensor) -> torch.Tensor:
    return -0.5 * (z ** 2).sum(dim=1) - 0.5 * z.shape[1] * LOG_TWO_PI


def gaussian_log_density(x: torch.Tensor, mean: torch.Tensor, log_variance: torch.Tensor) -> torch.Tensor:
    """Sum over the last axis of log N(x; mean, exp(log_variance))."""
    return -0.5 * (((x - mean) ** 2) * torch.exp(-log_variance) + log_variance + LOG_TWO_PI).sum(dim=-1)


def repeat_classes(x: torch.Tensor, class_count: int) -> tuple[torch.Tensor, torch.Tensor]:
    """Every row once per class: (n*K, d) rows and their (n*K,) class ids, row-major (row, class)."""
    count = x.shape[0]
    rows = x.repeat_interleave(class_count, dim=0)
    classes = torch.arange(class_count, device=x.device).repeat(count)
    return rows, classes


@dataclass
class TrainingContext:
    """What a training step may read besides the labelled minibatch."""
    train_start_row: int
    train_end_row: int
    unlabelled: torch.Tensor | None = None       # standardised training-span rows with no target (EBM real data)
    log: Callable[[str], None] = field(default=lambda message: None)
    #: the reporter's checkpoint: blocks while paused, raises StopRequested on Stop (called between batches)
    checkpoint: Callable[[], None] = field(default=lambda: None)


class TorchDensity:
    """A class-conditional (or joint) density of the standardised feature row; see the module docstring."""

    #: scores are log p(x, k) up to one shared constant (no class prior is added in Bayes' rule)
    joint = False
    #: scores are a denoising / reconstruction surrogate rather than a (bound on a) log-likelihood
    surrogate = False
    #: validation selection: "density" (mean negative true-class score) or "posterior" (log loss)
    selection = "density"

    def __init__(self, dimension: int, class_count: int, parameters: dict, seed: int) -> None:
        self.dimension = int(dimension)
        self.class_count = int(class_count)
        self.parameters = dict(parameters)
        self.seed = int(seed)

    # ── what a variant writes ──
    def build(self) -> nn.Module:
        raise NotImplementedError

    def loss(self, network: nn.Module, x: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
        raise NotImplementedError

    def class_scores(self, network: nn.Module, x: torch.Tensor) -> torch.Tensor:
        raise NotImplementedError

    # ── what a variant may override ──
    def prepare(self, network: nn.Module, x: torch.Tensor, y: torch.Tensor, context: TrainingContext) -> None:
        """A data-dependent initialisation on the TRAINING rows (ActNorm, token edges, a frozen stage)."""

    @property
    def epoch_count(self) -> int:
        return int(self.parameters.get("epochs", 10))

    def make_optimizer(self, network: nn.Module):
        trainable = [parameter for parameter in network.parameters() if parameter.requires_grad]
        return torch.optim.Adam(trainable, lr=float(self.parameters.get("learning_rate", 1e-3)),
                                weight_decay=float(self.parameters.get("weight_decay", 0.0)))

    def train_epoch(self, network: nn.Module, optimizer, x: torch.Tensor, y: torch.Tensor, epoch: int,
                    report_batch, context: TrainingContext) -> float:
        """One pass of minibatch steps on ``loss`` in a seeded shuffled order."""
        batch_size = max(1, int(self.parameters.get("batch_size", 256)))
        order = torch.randperm(x.shape[0], device=x.device)
        batch_count = max(1, math.ceil(x.shape[0] / batch_size))
        total, seen = 0.0, 0
        for batch in range(batch_count):
            if batch:
                context.checkpoint()
            rows = order[batch * batch_size:(batch + 1) * batch_size]
            if rows.numel() == 0:
                continue
            optimizer.zero_grad(set_to_none=True)
            value = self.loss(network, x[rows], y[rows])
            if not torch.isfinite(value):
                context.log(f"skipped a batch with a non-finite loss (epoch {epoch}, batch {batch + 1})")
                continue
            value.backward()
            norm = float(torch.nn.utils.clip_grad_norm_(network.parameters(), 10.0))
            optimizer.step()
            total += float(value.detach()) * rows.numel()
            seen += rows.numel()
            report_batch(batch + 1, batch_count, context.train_start_row, context.train_end_row, float(value.detach()),
                         learning_rate=optimizer.param_groups[0]["lr"], gradient_norm=norm)
        return total / seen if seen else float("nan")

    # ── scoring plumbing ──
    def score_rows(self, network: nn.Module, x: torch.Tensor, evaluations_per_row: int = 1) -> torch.Tensor:
        """``class_scores`` in chunks so a large validation span does not exhaust memory."""
        chunk = max(1, SCORE_CHUNK_ROWS // max(1, evaluations_per_row * self.class_count))
        if x.shape[0] <= chunk:
            return self.class_scores(network, x)
        return torch.cat([self.class_scores(network, x[start:start + chunk]) for start in range(0, x.shape[0], chunk)])

    @property
    def evaluations_per_row(self) -> int:
        """Network evaluations per row and class when scoring (the noise-grid size of a denoising scorer)."""
        return 1


def scoring_copy(network: nn.Module) -> nn.Module:
    """A float64 CPU copy in eval mode, with gradients off (every kept prediction runs through it)."""
    duplicate = copy.deepcopy(network).to("cpu").double().eval()
    for parameter in duplicate.parameters():
        parameter.requires_grad_(False)
    return duplicate


def state_snapshot(network: nn.Module) -> dict:
    return {name: value.detach().clone() for name, value in network.state_dict().items()}


def to_numpy(values: torch.Tensor) -> np.ndarray:
    return values.detach().to("cpu").double().numpy()


__all__ = ["LOG_TWO_PI", "TorchDensity", "TrainingContext", "activation_layer", "fixed_normal", "fixed_uniform",
           "gaussian_log_density", "multilayer_perceptron", "repeat_classes", "resolve_device", "scoring_copy",
           "sinusoidal_embedding", "standard_normal_log_density", "state_snapshot", "to_numpy"]
