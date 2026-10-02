"""Dual-pathway network as a Model Cycle network kind (``network: "dual_pathway"``).

Catalog spec: ``neural-network-architectures-specialized-modular-networks-dual-pathway-network``
(``Trading/_architecture/educational/algo_models/Neural Network Architectures/
Specialized & Modular Networks/Dual-Pathway Network.md``). Trained, saved,
loaded and traced by ``cycle.networks.NeuralAdapter`` like every other kind;
registered through ``networks.NETWORK_EXTENSION_MODULES``.

What the spec says, and what is built here
------------------------------------------
The spec (SlowFast, Feichtenhofer et al. 2019; two-stream, Simonyan and
Zisserman 2014): two parallel branches read the same tape through different
lenses - a SLOW pathway over a long, coarsely sampled window for context and a
FAST pathway over a short, finely sampled window for reaction - and a fusion
head reads both. Here the two lenses are two temporal views of the ONE window
of ``sequence_length`` bars ``NeuralAdapter`` hands every sequence kind (rows
``t - sequence_length + 1 .. t``), so both views end on the bar being
predicted and both are causal:

* **Fast view**: the last ``fast_window_bars`` bars of the window at full
  resolution (``fast_window_bars`` is clamped to ``sequence_length`` when it is
  larger; ``build`` records the clamp on ``network.fast_window_clamped``).
* **Slow view**: every ``slow_stride``-th bar of the whole window, counted back
  from the last bar (positions ``(L - 1) mod k, ..., L - 1 - k, L - 1``), so the
  view always ends on the bar being predicted and never touches a bar after
  it. Every bar in the view is a closed bar, which is the spec's own rule for
  the resampled pathway.
* **Pathway encoders**: one forward-only gated recurrent unit per pathway,
  ``pathway_hidden_size`` units each; the pathway's final hidden state is its
  pooled output (dropout on each before fusion, as the spec prescribes).
* **Gated fusion** (the spec's "gated fusion alternative"): the two final
  states are concatenated (fast units, then slow units) and multiplied by a
  learned logistic gate ``sigmoid(W_g z + b_g)`` of the same width, so the
  gate values say per bar how much the model leaned on reaction versus context.
* **Fusion perceptron**: ``Linear(2H, fusion_hidden_size) -> GELU -> Dropout``,
  then the head ``Linear(fusion_hidden_size, 1)``.

``forward(window)`` -> ``(batch,)`` raw head output (log-odds of up for the
direction model, the target itself for the price model), the convention every
kind follows. ``forward_detailed`` is the same pass returning its
intermediates; ``trace`` runs it once for one bar and records:

    Fast pathway gated recurrent unit          [fast_window_bars, H]   oldest bar first
    Slow pathway gated recurrent unit          [ceil(L / k), H]        oldest bar first
    Fusion gate (logistic)                     [2H]   fast units then slow units, in (0, 1)
    Fused vector (gelu)                        [fusion_hidden_size]

The last layer is exactly the head's input, so the explainer's gate G4
(``apply_head(head_input(trace)) == logit``) holds. ``attention`` is empty
(``ATTENTION = False``).

Simplifications versus the spec, plainly: the pathways are gated recurrent
units, not the spec's causal convolutional stacks; both pathways share one
width (``pathway_hidden_size``) instead of the spec's capacity ratio that keeps
the fast branch thinner; the two views are cut from the Cycle's one window at
one timeframe (a subsampled view stands in for a coarser timeframe, and the
spec's multi-modal split of price geometry from volume is not built - every
pathway reads every engine feature); fusion happens once, at the head (the
two-stream variant), with no lateral connections between the pathways
mid-computation; no stochastic pathway dropout; and the loss is the Cycle's
(weighted binary cross-entropy or Huber), not the spec's cross-entropy or mean
squared error.
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as functional
from torch import nn

SEQUENCE = True
ATTENTION = False

LAYER_KINDS = ("gated_recurrent_unit", "gated_recurrent_unit", "gate", "dense")


def slow_view_start(window_length: int, stride: int) -> int:
    """The first position of the slow view: every ``stride``-th bar counted back
    from the last bar of a window of ``window_length`` bars."""
    return (window_length - 1) % stride


def slow_view_length(window_length: int, stride: int) -> int:
    return (window_length - 1 - slow_view_start(window_length, stride)) // stride + 1


class DualPathwayNetwork(nn.Module):
    """See the module docstring. Input (batch, time, features); output (batch,)."""

    def __init__(self, feature_count: int, sequence_length: int, fast_window_bars: int, slow_stride: int,
                 pathway_hidden_size: int, fusion_hidden_size: int, dropout: float) -> None:
        super().__init__()
        for name, value, floor in (("feature_count", feature_count, 1), ("sequence_length", sequence_length, 1),
                                   ("fast_window_bars", fast_window_bars, 1), ("slow_stride", slow_stride, 1),
                                   ("pathway_hidden_size", pathway_hidden_size, 1),
                                   ("fusion_hidden_size", fusion_hidden_size, 1)):
            if int(value) < floor:
                raise ValueError(f"{name} must be at least {floor}, got {value}")
        self.feature_count = int(feature_count)
        self.sequence_length = int(sequence_length)
        self.fast_window_clamped = int(fast_window_bars) > self.sequence_length
        self.fast_window_bars = min(int(fast_window_bars), self.sequence_length)
        self.slow_stride = int(slow_stride)
        self.pathway_hidden_size = int(pathway_hidden_size)
        self.fusion_hidden_size = int(fusion_hidden_size)
        hidden = self.pathway_hidden_size
        self.fast_pathway = nn.GRU(self.feature_count, hidden, num_layers=1, batch_first=True)
        self.slow_pathway = nn.GRU(self.feature_count, hidden, num_layers=1, batch_first=True)
        self.pathway_dropout = nn.Dropout(dropout)
        self.gate = nn.Linear(2 * hidden, 2 * hidden)
        self.fusion = nn.Linear(2 * hidden, self.fusion_hidden_size)
        self.fusion_dropout = nn.Dropout(dropout)
        self.head = nn.Linear(self.fusion_hidden_size, 1)

    # ── the two views ──

    def fast_view(self, window: torch.Tensor) -> torch.Tensor:
        """The last ``fast_window_bars`` bars of the window at full resolution."""
        return window[:, -self.fast_window_bars:]

    def slow_view(self, window: torch.Tensor) -> torch.Tensor:
        """Every ``slow_stride``-th bar of the window, ending on its last bar."""
        return window[:, slow_view_start(window.shape[1], self.slow_stride)::self.slow_stride]

    def slow_view_length(self, window_length: int | None = None) -> int:
        return slow_view_length(self.sequence_length if window_length is None else int(window_length), self.slow_stride)

    # ── forward ──

    def forward_detailed(self, window: torch.Tensor) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
        """The forward pass and every intermediate ``trace`` records."""
        if window.dim() != 3:
            raise ValueError(f"the dual-pathway network reads (batch, time, features) windows, got shape {tuple(window.shape)}")
        fast_sequence, _ = self.fast_pathway(self.fast_view(window))
        slow_sequence, _ = self.slow_pathway(self.slow_view(window))
        fast_state = self.pathway_dropout(fast_sequence[:, -1])
        slow_state = self.pathway_dropout(slow_sequence[:, -1])
        concatenated = torch.cat([fast_state, slow_state], dim=-1)
        gate = torch.sigmoid(self.gate(concatenated))
        fused = self.fusion_dropout(functional.gelu(self.fusion(concatenated * gate)))
        logit = self.head(fused).squeeze(-1)
        recorded = {
            "fast_sequence": fast_sequence,
            "slow_sequence": slow_sequence,
            "gate": gate,
            "fused": fused,
        }
        return logit, recorded

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.forward_detailed(window)[0]

    # ── names the trace and the structure view share ──

    def layer_names(self) -> tuple[str, str, str, str]:
        return (
            f"Fast pathway gated recurrent unit (last {self.fast_window_bars} bars at full resolution)",
            f"Slow pathway gated recurrent unit (one bar in every {self.slow_stride} of the {self.sequence_length}-bar window)",
            "Fusion gate (logistic)",
            "Fused vector (gelu)",
        )

    def layer_shapes(self) -> tuple[list[int], list[int], list[int], list[int]]:
        hidden = self.pathway_hidden_size
        return ([self.fast_window_bars, hidden], [self.slow_view_length(), hidden], [2 * hidden], [self.fusion_hidden_size])


def build(parameters: dict, feature_count: int) -> nn.Module:
    """The network for a registry entry with ``network: "dual_pathway"``."""
    return DualPathwayNetwork(
        int(feature_count),
        int(parameters["sequence_length"]),
        int(parameters["fast_window_bars"]),
        int(parameters["slow_stride"]),
        int(parameters["pathway_hidden_size"]),
        int(parameters["fusion_hidden_size"]),
        float(parameters["dropout"]),
    )


def _layer(name: str, kind: str, tensor: torch.Tensor) -> dict:
    """One recorded layer for batch row 0 (the shape ``networks._layer`` writes)."""
    value = tensor.detach()[0].double().cpu()
    return {"name": name, "kind": kind, "shape": [int(size) for size in value.shape],
            "values": value.reshape(-1).tolist()}


def trace(network: nn.Module, window: torch.Tensor) -> dict:
    """``{"layers": [...], "attention": [], "logit": float}`` for a batch-of-one window
    (see the module docstring for the four layers). The network must be in eval mode."""
    if network.training:
        raise RuntimeError("trace needs the network in eval mode")
    with torch.no_grad():
        logit, recorded = network.forward_detailed(window)
    tensors = (recorded["fast_sequence"], recorded["slow_sequence"], recorded["gate"], recorded["fused"])
    layers = [_layer(name, kind, tensor) for name, kind, tensor in zip(network.layer_names(), LAYER_KINDS, tensors)]
    value = float(logit.reshape(-1)[0].item())
    if not math.isfinite(value):
        raise RuntimeError(f"trace: the head output is not finite ({value})")
    return {"layers": layers, "attention": [], "logit": value}


def describe(network: nn.Module) -> list[dict]:
    """The traced layers without values: ``[{name, kind, outputShape}]``."""
    return [{"name": name, "kind": kind, "outputShape": shape}
            for name, kind, shape in zip(network.layer_names(), LAYER_KINDS, network.layer_shapes())]


__all__ = ["ATTENTION", "LAYER_KINDS", "SEQUENCE", "DualPathwayNetwork", "build", "describe",
           "slow_view_length", "slow_view_start", "trace"]
