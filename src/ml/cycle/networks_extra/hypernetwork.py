"""Hypernetwork (Ha et al. 2016) as a Model Cycle network kind (``network: "hypernetwork"``).

Catalog spec: ``neural-network-architectures-memory-routing-architectures-hypernetwork``.
Trained, saved, loaded and traced by ``cycle.networks.NeuralAdapter`` like every
other kind; registered through ``networks.NETWORK_EXTENSION_MODULES``.

What the spec says, and what is built here
------------------------------------------
The spec: a hypernetwork ``h`` reads a context ``C`` and GENERATES the weights
``W = h(C)`` of a target network ``f``; the prediction is ``f(X; W)``. Here:

* **Context** ``C`` (the regime the bar sits in): the mean and the standard
  deviation, over the window of ``sequence_length`` bars ending at the bar
  being predicted, of every feature (``2 x feature_count`` values). The window
  is the one ``NeuralAdapter`` hands every sequence kind (rows
  ``t - sequence_length + 1 .. t``), so the context is causal.
* **Hypernetwork** ``h``: ``Linear(2F, context_embedding_size) -> GELU`` (the
  context embedding), ``Linear(., hypernetwork_hidden_size) -> GELU -> Dropout``,
  then one ``Linear`` that emits every generated number at once.
* **Target network** ``f``: a one-hidden-layer perceptron on the LAST bar's
  features, ``target_hidden_size`` units, GELU, dropout, one output. ALL of its
  weights and biases are generated per sample: ``W1 (H x F)``, ``b1 (H)``,
  ``W2 (H)``, ``b2 (1)``. The first layer is applied with ``torch.bmm`` per
  sample; the output layer is applied as the per-unit products ``W2 * hidden``
  summed with ``b2`` (a 1 x H product per sample), which is what the trace shows.
* **Scale**: generated ``W1`` is divided by ``sqrt(F)`` and ``W2`` by
  ``sqrt(H)``, and the generator's bias for the weight slots is drawn
  ``N(0, 1)`` at construction, so at initialisation the target network has the
  LeCun scale of a plain perceptron and the context only modulates it.

``forward(window)`` -> ``(batch,)`` raw head output (log-odds of up for the
direction model, the target itself for the price model), the convention every
kind follows. ``forward_detailed`` is the same pass returning its intermediates;
``trace`` runs it once for one bar and records:

    Context vector                                [2F]
    Context embedding (gelu)                      [E]
    Hypernetwork hidden layer (gelu)              [hypernetwork_hidden_size]
    Generated first-layer weight norm per unit    [H]   ||W1[j, :]|| for each target unit j
    Target hidden layer (gelu)                    [H]
    Target output contributions                   [H + 1]  W2[j] * hidden[j], then b2

The last layer is exactly the head's input: ``network.head`` sums it, so the
explainer's gate G4 (``apply_head(head_input(trace)) == logit``) holds with a
parameter-free head while the generated output weights stay visible in the
trace. ``attention`` is empty (``ATTENTION = False``).

Simplifications versus the spec, plainly: the spec leaves the context free
("volatility, indicators, embeddings") - here it is fixed to the window's
per-feature mean and standard deviation of the engine's own causal features;
the target network is the smallest useful one (one hidden layer, one output)
rather than the spec's 1-5 layers; the spec's HyperLSTM / sparse / transformer
variants are not built; the target reads only the last bar (the context, not
the target, sees the window); and the loss is the Cycle's (weighted binary
cross-entropy or Huber), not the spec's mean squared error.
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as functional
from torch import nn

SEQUENCE = True
ATTENTION = False

LAYER_NAMES = (
    "Context vector (window mean and standard deviation per feature)",
    "Context embedding (gelu)",
    "Hypernetwork hidden layer (gelu)",
    "Generated first-layer weight norm per target unit",
    "Target hidden layer (gelu)",
    "Target output contributions (generated weight times activation, then the generated bias)",
)
LAYER_KINDS = ("context", "dense", "dense", "generated_weights", "dense", "contributions")


class SumHead(nn.Module):
    """The generated output layer, applied: the sum of the per-unit contributions
    and the generated bias. Parameter-free by design: the output weights are
    generated per sample and shown in the trace, not held here."""

    def forward(self, contributions: torch.Tensor) -> torch.Tensor:
        return contributions.sum(-1)


class HypernetworkModule(nn.Module):
    """See the module docstring. Input (batch, time, features); output (batch,)."""

    def __init__(self, feature_count: int, hypernetwork_hidden_size: int, target_hidden_size: int,
                 context_embedding_size: int, dropout: float) -> None:
        super().__init__()
        if feature_count < 1:
            raise ValueError(f"feature_count must be at least 1, got {feature_count}")
        for name, value in (("hypernetwork_hidden_size", hypernetwork_hidden_size),
                            ("target_hidden_size", target_hidden_size),
                            ("context_embedding_size", context_embedding_size)):
            if int(value) < 1:
                raise ValueError(f"{name} must be at least 1, got {value}")
        self.feature_count = int(feature_count)
        self.target_hidden_size = int(target_hidden_size)
        self.hypernetwork_hidden_size = int(hypernetwork_hidden_size)
        self.context_embedding_size = int(context_embedding_size)
        features, hidden = self.feature_count, self.target_hidden_size
        # slots of the generated vector: W1 (H x F), b1 (H), W2 (H), b2 (1)
        self.first_weight_count = hidden * features
        self.generated_count = self.first_weight_count + hidden + hidden + 1
        self.first_layer_scale = 1.0 / math.sqrt(features)
        self.output_layer_scale = 1.0 / math.sqrt(hidden)

        self.embedding = nn.Linear(2 * features, self.context_embedding_size)
        self.hypernetwork_hidden = nn.Linear(self.context_embedding_size, self.hypernetwork_hidden_size)
        self.generator = nn.Linear(self.hypernetwork_hidden_size, self.generated_count)
        self.dropout = nn.Dropout(dropout)
        self.head = SumHead()
        self._initialise_generator()

    def _initialise_generator(self) -> None:
        """At construction the generated target network has the LeCun scale of a
        plain perceptron: the generator's bias carries unit-normal draws for the
        weight slots (scaled by 1/sqrt(fan-in) in the forward) and zeros for the
        bias slots; the context-dependent part starts one tenth of torch's
        default so the context modulates rather than dominates."""
        with torch.no_grad():
            self.generator.weight.mul_(0.1)
            bias = self.generator.bias
            bias.zero_()
            first_end = self.first_weight_count
            bias[:first_end].normal_(0.0, 1.0)
            output_start = first_end + self.target_hidden_size
            output_end = output_start + self.target_hidden_size
            bias[output_start:output_end].normal_(0.0, 1.0)

    def context(self, window: torch.Tensor) -> torch.Tensor:
        """The regime vector: per-feature mean and standard deviation over the window."""
        return torch.cat([window.mean(dim=1), window.std(dim=1, unbiased=False)], dim=-1)

    def forward_detailed(self, window: torch.Tensor) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
        """The forward pass and every intermediate ``trace`` records."""
        if window.dim() != 3:
            raise ValueError(f"the hypernetwork reads (batch, time, features) windows, got shape {tuple(window.shape)}")
        batch = window.shape[0]
        hidden_size, features = self.target_hidden_size, self.feature_count
        context = self.context(window)
        embedding = functional.gelu(self.embedding(context))
        hypernetwork_hidden = self.dropout(functional.gelu(self.hypernetwork_hidden(embedding)))
        generated = self.generator(hypernetwork_hidden)
        first_end = self.first_weight_count
        first_weight = generated[:, :first_end].reshape(batch, hidden_size, features) * self.first_layer_scale
        first_bias = generated[:, first_end:first_end + hidden_size]
        output_start = first_end + hidden_size
        output_weight = generated[:, output_start:output_start + hidden_size] * self.output_layer_scale
        output_bias = generated[:, output_start + hidden_size:]
        last_bar = window[:, -1, :]
        # the generated first layer, one matrix per sample
        pre_activation = torch.bmm(first_weight, last_bar.unsqueeze(-1)).squeeze(-1) + first_bias
        target_hidden = self.dropout(functional.gelu(pre_activation))
        # the generated output layer, one 1 x H row per sample, kept per unit for the trace
        contributions = torch.cat([target_hidden * output_weight, output_bias], dim=-1)
        logit = self.head(contributions)
        recorded = {
            "context": context,
            "embedding": embedding,
            "hypernetwork_hidden": hypernetwork_hidden,
            "first_weight_norms": first_weight.norm(dim=-1),
            "target_hidden": target_hidden,
            "contributions": contributions,
        }
        return logit, recorded

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.forward_detailed(window)[0]


def build(parameters: dict, feature_count: int) -> nn.Module:
    """The network for a registry entry with ``network: "hypernetwork"``."""
    return HypernetworkModule(
        int(feature_count),
        int(parameters["hypernetwork_hidden_size"]),
        int(parameters["target_hidden_size"]),
        int(parameters["context_embedding_size"]),
        float(parameters["dropout"]),
    )


def _layer(name: str, kind: str, tensor: torch.Tensor) -> dict:
    """One recorded layer for batch row 0 (the shape ``networks._layer`` writes)."""
    value = tensor.detach()[0].double().cpu()
    return {"name": name, "kind": kind, "shape": [int(size) for size in value.shape],
            "values": value.reshape(-1).tolist()}


def trace(network: nn.Module, window: torch.Tensor) -> dict:
    """``{"layers": [...], "attention": [], "logit": float}`` for a batch-of-one window
    (see the module docstring for the six layers). The network must be in eval mode."""
    if network.training:
        raise RuntimeError("trace needs the network in eval mode")
    with torch.no_grad():
        logit, recorded = network.forward_detailed(window)
    tensors = (recorded["context"], recorded["embedding"], recorded["hypernetwork_hidden"],
               recorded["first_weight_norms"], recorded["target_hidden"], recorded["contributions"])
    layers = [_layer(name, kind, tensor) for name, kind, tensor in zip(LAYER_NAMES, LAYER_KINDS, tensors)]
    return {"layers": layers, "attention": [], "logit": float(logit.reshape(-1)[0].item())}


def describe(network: nn.Module) -> list[dict]:
    """The traced layers without values: ``[{name, kind, outputShape}]``."""
    shapes = (
        [2 * network.feature_count],
        [network.context_embedding_size],
        [network.hypernetwork_hidden_size],
        [network.target_hidden_size],
        [network.target_hidden_size],
        [network.target_hidden_size + 1],
    )
    return [{"name": name, "kind": kind, "outputShape": shape}
            for name, kind, shape in zip(LAYER_NAMES, LAYER_KINDS, shapes)]


__all__ = ["ATTENTION", "LAYER_KINDS", "LAYER_NAMES", "SEQUENCE", "HypernetworkModule", "SumHead",
           "build", "describe", "trace"]
