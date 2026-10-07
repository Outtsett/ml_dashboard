"""Mixture of experts: the Model Cycle's network kind ``mixture_of_experts``.

Catalog spec ``neural-network-architectures-memory-routing-architectures-mixture-of-experts``
(Jacobs et al. 1991, Shazeer et al. 2017): several small expert networks each
see the same bar, and a gating network decides how much of each expert's
answer to use for that bar:

    G(x)     = softmax(gate(x))                  one weight per expert, summing to 1
    E_i(x)   = expert i's hidden vector          (Linear -> GELU -> Dropout) x expert_layer_count
    mixed(x) = sum over i of G_i(x) * E_i(x)     the gate-weighted mixture
    logit    = head(mixed(x))                    one linear unit

Built by ``cycle.networks.build_network`` through ``NETWORK_EXTENSION_MODULES``
and trained by ``cycle.networks.NeuralAdapter`` unchanged: the module takes
``(batch, feature_count)`` (a non-sequence kind, ``SEQUENCE = False``) and returns
``(batch,)``, the raw head output, and carries the ``head`` attribute
(``nn.Linear(expert_hidden_size, 1)``) that ``NeuralAdapter.apply_head`` reads,
exactly as ``MultilayerPerceptron`` does. The prediction head is linear and
shared, so ``head(sum_i G_i E_i) = sum_i G_i head(E_i) + bias``: the output is
the spec's weighted combination of per-expert answers, with the head's bias.

Simplifications against the spec, stated plainly:

* **Dense soft routing, no top-k.** Every expert scores every bar and the
  softmax weights mix them; the spec's sparse top-k selection (k of N experts,
  renormalised) is not implemented. With 2-8 experts of 32-128 units there is
  no compute to save, and dense mixing keeps the output differentiable in every
  gate weight.
* **No load-balancing loss.** The spec adds lambda * CV(sum G)^2 so every expert
  is used; NeuralAdapter's loop has one task loss, so the term is left out. The
  gate probabilities are recorded per bar (``trace``), so an unused expert is
  visible rather than hidden.
* **One hidden layer in the gate** (``gate_hidden_size`` units, GELU) rather
  than the spec's 1-2 layers.
* **GELU** in the experts (the Cycle's perceptron default) rather than ReLU.

``trace(network, window)`` records, for one bar: the gate probabilities (one
per expert), every expert's hidden vector, the mixed vector (the head's input,
last, as ``head_input`` expects) and the logit, through the same
``components`` call ``forward`` uses. ``describe(network)`` is the same
without values.
"""

from __future__ import annotations

import torch
from torch import nn

SEQUENCE = False       # reads one bar's features, never a window
ATTENTION = False      # the gate weights are over experts, not over bars, so they are not attention

PARAMETER_NAMES = ("expert_count", "expert_hidden_size", "expert_layer_count", "gate_hidden_size", "dropout")


class Expert(nn.Module):
    """(Linear -> GELU -> Dropout) x layer_count: (batch, feature_count) -> (batch, hidden_size)."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, dropout: float) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        width = feature_count
        for _ in range(layer_count):
            layers += [nn.Linear(width, hidden_size), nn.GELU(), nn.Dropout(dropout)]
            width = hidden_size
        self.body = nn.Sequential(*layers)

    def forward(self, rows: torch.Tensor) -> torch.Tensor:
        return self.body(rows)


class GatingNetwork(nn.Module):
    """Linear -> GELU -> Linear -> softmax over the experts. The probabilities are
    computed in float32 whatever the autocast dtype, like the attention pooling."""

    def __init__(self, feature_count: int, hidden_size: int, expert_count: int) -> None:
        super().__init__()
        self.body = nn.Sequential(nn.Linear(feature_count, hidden_size), nn.GELU(), nn.Linear(hidden_size, expert_count))

    def forward(self, rows: torch.Tensor) -> torch.Tensor:
        return torch.softmax(self.body(rows).float(), dim=-1)


class MixtureOfExperts(nn.Module):
    """Gate-weighted mixture of expert networks with one linear head. Input
    (batch, feature_count); output (batch,), the raw head output."""

    def __init__(self, feature_count: int, expert_count: int, expert_hidden_size: int, expert_layer_count: int,
                 gate_hidden_size: int, dropout: float) -> None:
        super().__init__()
        for name, value in (("feature_count", feature_count), ("expert_count", expert_count),
                            ("expert_hidden_size", expert_hidden_size), ("expert_layer_count", expert_layer_count),
                            ("gate_hidden_size", gate_hidden_size)):
            if int(value) < 1:
                raise ValueError(f"mixture_of_experts: {name} must be at least 1, got {value!r}")
        if not 0.0 <= float(dropout) < 1.0:
            raise ValueError(f"mixture_of_experts: dropout must be in [0, 1), got {dropout!r}")
        self.feature_count = int(feature_count)
        self.expert_count = int(expert_count)
        self.expert_hidden_size = int(expert_hidden_size)
        self.gate = GatingNetwork(self.feature_count, int(gate_hidden_size), self.expert_count)
        self.experts = nn.ModuleList([
            Expert(self.feature_count, self.expert_hidden_size, int(expert_layer_count), float(dropout))
            for _ in range(self.expert_count)
        ])
        self.head = nn.Linear(self.expert_hidden_size, 1)

    def components(self, rows: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """(gate probabilities (batch, experts), expert outputs (batch, experts, hidden),
        mixed vector (batch, hidden)) - the one tensor path `forward` and `trace` share."""
        if rows.ndim != 2:
            raise ValueError(
                f"mixture_of_experts reads one bar's features, shape (batch, {self.feature_count}); got a tensor of "
                f"shape {tuple(rows.shape)}"
            )
        probabilities = self.gate(rows)
        outputs = torch.stack([expert(rows) for expert in self.experts], dim=1)
        mixed = torch.sum(probabilities.to(outputs.dtype).unsqueeze(-1) * outputs, dim=1)
        return probabilities, outputs, mixed

    def forward(self, rows: torch.Tensor) -> torch.Tensor:
        return self.head(self.components(rows)[2]).squeeze(-1)


def routing(network: nn.Module, rows: torch.Tensor) -> torch.Tensor:
    """The gate's probabilities for a batch of bars, (batch, experts), rows
    summing to 1: which expert each bar was routed to. The same `gate` the
    forward pass uses, so this is exactly the mixing the prediction had."""
    if not isinstance(network, MixtureOfExperts):
        raise TypeError(f"mixture_of_experts.routing: expected a MixtureOfExperts, got {type(network).__name__}")
    return network.gate(rows)


def build(parameters: dict, feature_count: int) -> nn.Module:
    """The network for a registry entry's resolved parameters (full-word names)."""
    missing = [name for name in PARAMETER_NAMES if name not in parameters]
    if missing:
        raise ValueError(f"mixture_of_experts: missing parameters {missing}")
    return MixtureOfExperts(
        int(feature_count), int(parameters["expert_count"]), int(parameters["expert_hidden_size"]),
        int(parameters["expert_layer_count"]), int(parameters["gate_hidden_size"]), float(parameters["dropout"]),
    )


def _layer_names(network: MixtureOfExperts) -> list[tuple[str, str]]:
    """(name, kind) of every traced layer, in order; the last is the head's input."""
    names = [("Gate probabilities over the experts", "gate")]
    names += [(f"Expert {number} hidden output (gelu)", "dense") for number in range(1, network.expert_count + 1)]
    names.append(("Gate-weighted mixture of the experts", "mixture"))
    return names


def _layer(name: str, kind: str, tensor: torch.Tensor) -> dict:
    value = tensor.detach()[0].double().cpu()
    return {"name": name, "kind": kind, "shape": [int(size) for size in value.shape], "values": value.reshape(-1).tolist()}


def trace(network: nn.Module, window: torch.Tensor) -> dict:
    """Run the network once on one bar (a (1, feature_count) tensor, eval mode) and
    record the gate probabilities, each expert's hidden vector, the mixed vector
    and the raw head output, in the shape ``cycle.networks.trace_network`` returns:
    ``{"layers": [{name, kind, shape, values}], "attention": [], "logit": float}``.
    The last layer is exactly the head's input, so ``apply_head(head_input(trace))``
    reproduces the logit (gate G4)."""
    if network.training:
        raise RuntimeError("trace needs the network in eval mode")
    if not isinstance(network, MixtureOfExperts):
        raise TypeError(f"trace expects a MixtureOfExperts, got {type(network).__name__}")
    if window.ndim != 2 or window.shape[0] != 1:
        raise ValueError(f"trace explains one bar: a (1, {network.feature_count}) tensor, got shape {tuple(window.shape)}")
    with torch.no_grad():
        probabilities, outputs, mixed = network.components(window)
        logit = float(network.head(mixed).reshape(-1)[0].item())
    names = _layer_names(network)
    tensors = [probabilities, *[outputs[:, number] for number in range(network.expert_count)], mixed]
    layers = [_layer(name, kind, tensor) for (name, kind), tensor in zip(names, tensors)]
    return {"layers": layers, "attention": [], "logit": logit}


def describe(network: nn.Module) -> list[dict]:
    """The traced layers without values: ``[{name, kind, outputShape}]``."""
    if not isinstance(network, MixtureOfExperts):
        raise TypeError(f"describe expects a MixtureOfExperts, got {type(network).__name__}")
    shapes = [[network.expert_count], *[[network.expert_hidden_size]] * (network.expert_count + 1)]
    return [{"name": name, "kind": kind, "outputShape": shape} for (name, kind), shape in zip(_layer_names(network), shapes)]


__all__ = ["ATTENTION", "SEQUENCE", "Expert", "GatingNetwork", "MixtureOfExperts", "build", "describe", "trace"]
