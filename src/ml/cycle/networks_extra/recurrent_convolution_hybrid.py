"""Recurrent-convolution hybrid: the Model Cycle's network kind for the catalog
spec "RNN-CNN Hybrid" (hybrid-composite-architectures-classical-hybrids-rnn-cnn-hybrid).

The spec's sequential configuration: a convolutional feature extractor whose
maps a recurrent network reads in time order, with the recurrent network's
final hidden state feeding a dense output layer. Here, on one window of
``sequence_length`` bars with ``feature_count`` causal features each:

    window (batch, time, features)
      -> transpose -> (batch, features, time)
      -> [causal 1-D convolution -> rectified linear unit -> dropout] x convolution_layer_count
         each convolution left-padded by kernel_size - 1, so its output at bar k
         reads bars <= k only (as TemporalConvolutionNetwork in cycle.networks)
      -> transpose -> (batch, time, channel_count)
      -> gated recurrent unit, recurrent_layer_count layers, forward only
      -> hidden state at the LAST bar (the bar being predicted) -> dropout
      -> head Linear(hidden_size, 1) -> one raw logit per window (batch,)

The raw head output is what ``cycle.networks.NeuralAdapter`` expects from every
network kind: the log-odds of up for the direction model (it applies the
sigmoid) and the target itself for the price model.

Simplifications against the catalog spec, all deliberate:

* The spec's convolutions are 2-D over images (or spectrograms), one image per
  time step; a bar is a feature vector, so the convolutions here are 1-D along
  the bar axis with the features as input channels. A kernel of size k mixes
  each bar with the k - 1 bars before it.
* The spec pools (max-pooling) between convolutions to shrink the maps.
  Pooling along the bar axis would move information across positions and
  break the per-bar causality the Cycle checks, so there is no pooling: every
  layer keeps one position per bar.
* The spec's example recurrent network is an LSTM; this kind uses a gated
  recurrent unit (the design chosen for the Cycle: fewer parameters, same
  forward-only reading). Both read the convolution maps in order and keep a
  running memory.
* The spec's fusion layer (concatenation / attention / dense between the two
  parts) is not built: the recurrent network's last hidden state goes straight
  to the head, the spec's "sequential" configuration.
* The spec trains with cross-entropy over a softmax and mean squared error;
  the Cycle's one training loop (``NeuralAdapter.fit``) trains every kind with
  binary cross-entropy with a positive-class weight on a single logit, and
  Huber loss for the price model. No pretrained backbone: everything is fitted
  from the fold's training rows.

Causality: position k of ``sequence_output`` never depends on positions after
k (left-padded convolutions, a forward-only recurrent stack), and the head
reads the last position. ``trace`` records every convolution layer's output
and every recurrent layer's output for one window (the same tensor path
``forward`` uses, in eval mode) in the shape ``cycle.networks.trace_network``
returns: the last layer's last row is exactly the head's input, so
``NeuralAdapter.apply_head(head_input(trace))`` reproduces the logit (gate G4).
"""

from __future__ import annotations

import torch
import torch.nn.functional as functional
from torch import nn

SEQUENCE = True     # reads a window of `sequence_length` bars
ATTENTION = False   # no attention weights in its trace

# The activation of every convolution layer, named in the layer's trace name
# so the explainer writes it out in full ("rectified linear unit").
ACTIVATION = "relu"

REQUIRED_PARAMETERS = (
    "channel_count", "kernel_size", "convolution_layer_count",
    "hidden_size", "recurrent_layer_count", "dropout",
)


class CausalConvolutionLayer(nn.Module):
    """One 1-D convolution left-padded by kernel_size - 1, so output position k
    reads input positions <= k only, then a rectified linear unit and dropout."""

    def __init__(self, input_channels: int, output_channels: int, kernel_size: int, dropout: float):
        super().__init__()
        self.padding = kernel_size - 1
        self.convolution = nn.Conv1d(input_channels, output_channels, kernel_size)
        self.dropout = nn.Dropout(dropout)

    def forward(self, series: torch.Tensor) -> torch.Tensor:  # (batch, channels, time)
        padded = functional.pad(series, (self.padding, 0))
        return self.dropout(functional.relu(self.convolution(padded)))


class RecurrentConvolutionHybrid(nn.Module):
    """Causal convolution stack -> gated recurrent unit -> head on the last bar.
    Input (batch, time, features); output (batch,), the raw logit."""

    def __init__(self, feature_count: int, channel_count: int, kernel_size: int,
                 convolution_layer_count: int, hidden_size: int, recurrent_layer_count: int,
                 dropout: float):
        super().__init__()
        layers: list[nn.Module] = []
        width = feature_count
        for _ in range(convolution_layer_count):
            layers.append(CausalConvolutionLayer(width, channel_count, kernel_size, dropout))
            width = channel_count
        self.convolutions = nn.ModuleList(layers)
        self.recurrent = nn.GRU(
            channel_count, hidden_size, num_layers=recurrent_layer_count, batch_first=True,
            dropout=dropout if recurrent_layer_count > 1 else 0.0,
        )
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)

    def convolution_output(self, window: torch.Tensor) -> torch.Tensor:
        """The convolution stack's maps, (batch, time, channel_count)."""
        series = window.transpose(1, 2)
        for layer in self.convolutions:
            series = layer(series)
        return series.transpose(1, 2)

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        """The top recurrent layer's hidden state at every bar, (batch, time, hidden_size)."""
        output, _ = self.recurrent(self.convolution_output(window))
        return output

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.head(self.dropout(self.sequence_output(window)[:, -1])).squeeze(-1)


def _positive_integer(parameters: dict, name: str, minimum: int = 1) -> int:
    value = parameters.get(name)
    if value is None:
        raise ValueError(f"recurrent_convolution_hybrid: {name} is required")
    number = float(value)
    if not number.is_integer() or int(number) < minimum:
        raise ValueError(f"recurrent_convolution_hybrid: {name} must be a whole number of at least {minimum}, got {value!r}")
    return int(number)


def build(parameters: dict, feature_count: int) -> nn.Module:
    """The network for one resolved parameter set (see the registry entry
    ``src/config/cycle_models/recurrent_convolution_hybrid.json``)."""
    missing = [name for name in REQUIRED_PARAMETERS if name not in parameters]
    if missing:
        raise ValueError(f"recurrent_convolution_hybrid: missing parameters {missing}")
    dropout = float(parameters["dropout"])
    if not 0.0 <= dropout < 1.0:
        raise ValueError(f"recurrent_convolution_hybrid: dropout must be in [0, 1), got {dropout!r}")
    if int(feature_count) < 1:
        raise ValueError(f"recurrent_convolution_hybrid: feature_count must be at least 1, got {feature_count!r}")
    return RecurrentConvolutionHybrid(
        int(feature_count),
        _positive_integer(parameters, "channel_count"),
        _positive_integer(parameters, "kernel_size"),
        _positive_integer(parameters, "convolution_layer_count"),
        _positive_integer(parameters, "hidden_size"),
        _positive_integer(parameters, "recurrent_layer_count"),
        dropout,
    )


def _networks():
    # Lazy: cycle.networks imports this module while it is itself loading, and
    # its trace helpers (`_layer`, `_lower_recurrent_layers`) keep every kind's
    # trace in one format.
    from .. import networks

    return networks


def _convolution_name(number: int) -> str:
    return f"Causal convolution layer {number} ({ACTIVATION})"


def _recurrent_name(number: int) -> str:
    return f"Gated recurrent unit layer {number}"


def trace(network: nn.Module, window: torch.Tensor) -> dict:
    """Run ``network`` once on ``window`` (a batch of one, eval mode) and record
    every convolution layer's output and every recurrent layer's output as
    [time, units] (oldest bar first), plus the raw head output:

        {"layers": [{"name", "kind", "shape", "values"}], "attention": [], "logit": float}

    The last layer's last row is the head's input."""
    if network.training:
        raise RuntimeError("trace needs the network in eval mode")
    networks = _networks()
    captured: dict[str, list[torch.Tensor]] = {"convolution": [], "recurrent": []}
    handles = []

    def keep(slot: str):
        def hook(module, inputs, output):
            captured[slot].append(output[0] if isinstance(output, tuple) else output)
        return hook

    try:
        for layer in network.convolutions:
            handles.append(layer.register_forward_hook(keep("convolution")))
        handles.append(network.recurrent.register_forward_hook(keep("recurrent")))
        with torch.no_grad():
            logit = float(network(window).reshape(-1)[0].item())
            layers: list[dict] = []
            for number, output in enumerate(captured["convolution"], 1):
                layers.append(networks._layer(_convolution_name(number), "convolution", output.transpose(1, 2)))
            (top,) = captured["recurrent"]
            recurrent_input = captured["convolution"][-1].transpose(1, 2)   # what the recurrent stack read
            for number, output in enumerate(
                networks._lower_recurrent_layers(network.recurrent, recurrent_input, top), 1
            ):
                layers.append(networks._layer(_recurrent_name(number), "gated_recurrent_unit", output))
    finally:
        for handle in handles:
            handle.remove()
    return {"layers": layers, "attention": [], "logit": logit}


def describe(network: nn.Module, sequence_length: int = 1) -> list[dict]:
    """The layers ``trace`` records, without values: name, kind and output shape
    [time, units] for a window of ``sequence_length`` bars."""
    described = []
    for number, layer in enumerate(network.convolutions, 1):
        described.append({"name": _convolution_name(number), "kind": "convolution",
                          "outputShape": [int(sequence_length), int(layer.convolution.out_channels)]})
    for number in range(1, int(network.recurrent.num_layers) + 1):
        described.append({"name": _recurrent_name(number), "kind": "gated_recurrent_unit",
                          "outputShape": [int(sequence_length), int(network.recurrent.hidden_size)]})
    return described


__all__ = ["ACTIVATION", "ATTENTION", "SEQUENCE", "RecurrentConvolutionHybrid", "build", "describe", "trace"]
