"""PyTorch model families for the Model Cycle, all trained by ONE loop.

Built by `models.build_adapter`, which imports this module lazily so a
tree-only run never loads torch. What is built is a NETWORK KIND, read from
the registry entry's ``network`` (never from the model's key):

    multilayer_perceptron         (Linear -> activation -> Dropout) x layers -> head;
                                  activation GELU, or the entry's activation_function
                                  (tanh | relu | gelu) — feedforward_network
    lstm                          forward-only long short-term memory
    recurrent                     forward-only Elman recurrent network (tanh)
    gated_recurrent_unit          forward-only gated recurrent unit
    attention_recurrent           gated recurrent unit + additive attention pooling
                                  over the window (the weights of the last forward
                                  are kept on the pooling module)
    temporal_convolution_network  causal dilated convolutions
    transformer_encoder           pre-norm encoder with a causal mask

Two constructor forms (`models.build_adapter` binds exactly one):

    NeuralAdapter(family, parameters, device, seed, task=...)       the four legacy
        families (multilayer_perceptron, lstm, temporal_convolution_network,
        transformer_encoder), validated by `models.resolve_parameters`
        exactly as before the registry, so their runs are bitwise the same;
    NeuralAdapter(key, entry, parameters, device, seed, task=...)   every other
        neural registry key, validated by `catalog.resolve_parameters`.

`save` writes the key and the network kind into model.pt and model.json;
`load` maps a model.pt written before them (family only) to its kind.

`trace(features, index)` records, for one bar, every hidden layer's output
(forward hooks on the exact tensor path `predict_*` uses) and the attention
weights, for "Inside the model"; `describe()` is the same without values.

The loop (`NeuralAdapter.fit`):
  * the whole feature matrix is uploaded to the device once (float32); rows
    are gathered by index, a sequence sample for row t is rows t-L+1..t;
  * batches are CONTIGUOUS blocks of the chronologically sorted training
    index; only the order of the blocks is shuffled each epoch (seeded), so
    every batch report names one unbroken time span the chart can highlight;
  * BCEWithLogitsLoss with pos_weight = negatives / positives, AdamW,
    OneCycle learning rate stepped per batch, gradient clipping at 1.0 (the
    reported norm is the pre-clip norm), AMP on CUDA (bfloat16 when the GPU
    supports it, else float16 with a GradScaler);
  * after each epoch the validation index is scored in eval mode; early
    stopping on validation log loss with `patience`; the best weights are
    kept in memory and restored at the end.

As the price model (``task="regression"``) the same networks and the same
loop fit the engine's volatility-scaled forward move with HuberLoss(delta=1.0)
on the raw linear head (no sigmoid, no positive-class weight, no target
clipping: Huber's bounded gradient is the outlier handling). Early stopping
and the restored weights follow the validation HUBER loss; the reported train
and validation losses are mean absolute error in target units (train measured
on the training batches as they are fitted, in train mode) and
``validation_accuracy`` is the accuracy of the predicted sign.

Every network reads only the window it is given, and the sequence networks
are causal inside the window as well: position k of `sequence_output` never
depends on positions after k (causal left-padded convolutions, a causal
attention mask, forward-only recurrent layers). The prediction head reads the
last position, which is the bar being predicted (the attention recurrent
network's head reads the attention-weighted sum of the window's positions,
whose query is the last position).
"""

from __future__ import annotations

# isort: off
import torch  # first: torch before numpy avoids a CUDA initialisation stall on Windows

# isort: on
import copy
import math
import os
import random
import time
from pathlib import Path

import numpy as np
import torch.nn.functional as functional
from torch import nn

from . import catalog
from .adapter import BatchReport, EpochReport, check_index
from .models import (
    _as_index,
    _base_metadata,
    _check_task,
    _require_both_classes,
    _require_varying_target,
    _training_summary,
    _wrong_task_error,
    binary_scores,
    huber_loss,
    regression_scores,
    resolve_parameters,
    write_metadata,
)

_PREDICTION_CHUNK_ROWS = 4096


# ─── networks ──────────────────────────────────────────────────────────────

# Every network kind a registry entry's `network` may name.
BUILTIN_NETWORK_KINDS = (
    "multilayer_perceptron",
    "lstm",
    "temporal_convolution_network",
    "transformer_encoder",
    "recurrent",
    "gated_recurrent_unit",
    "attention_recurrent",
)

# Network kinds that live in their own module (``cycle.networks_extra.<kind>``),
# one per catalog spec the Cycle grew to cover. A module exports:
#     SEQUENCE: bool                       reads a window of `sequence_length` bars
#     ATTENTION: bool                      its trace carries attention weights
#     build(parameters, feature_count) -> torch.nn.Module
#     trace(network, window) -> dict       the shape ``trace_network`` returns (layers, attention, logit)
#     describe(network) -> list[dict]      optional: the layers without values
# A module that is not importable is left out of NETWORK_KINDS (with a warning), so a
# half-built kind never takes the seven built-in ones down with it.
NETWORK_EXTENSION_MODULES: dict[str, str] = {
    "mixture_of_experts": "cycle.networks_extra.mixture_of_experts",
    "recurrent_convolution_hybrid": "cycle.networks_extra.recurrent_convolution_hybrid",
    "hypernetwork": "cycle.networks_extra.hypernetwork",
    "neural_turing_machine": "cycle.networks_extra.neural_turing_machine",
    "dual_pathway": "cycle.networks_extra.dual_pathway",
}


def _load_extensions() -> dict[str, object]:
    import importlib
    import warnings

    loaded: dict[str, object] = {}
    for kind, module_name in NETWORK_EXTENSION_MODULES.items():
        try:
            module = importlib.import_module(module_name)
        except ImportError as error:
            warnings.warn(f"network kind {kind!r} is not available: {error}", stacklevel=2)
            continue
        for attribute in ("SEQUENCE", "ATTENTION", "build", "trace"):
            if not hasattr(module, attribute):
                warnings.warn(f"network kind {kind!r} ({module_name}) lacks {attribute}; left out", stacklevel=2)
                break
        else:
            loaded[kind] = module
    return loaded


NETWORK_EXTENSIONS: dict[str, object] = _load_extensions()
NETWORK_KINDS = BUILTIN_NETWORK_KINDS + tuple(NETWORK_EXTENSIONS)
# Kinds that read a window of `sequence_length` bars (every built-in kind but the perceptron).
SEQUENCE_NETWORKS = frozenset(
    (set(BUILTIN_NETWORK_KINDS) - {"multilayer_perceptron"})
    | {kind for kind, module in NETWORK_EXTENSIONS.items() if getattr(module, "SEQUENCE", False)}
)
# Kinds whose trace carries attention weights.
ATTENTION_NETWORKS = frozenset(
    {"transformer_encoder", "attention_recurrent"}
    | {kind for kind, module in NETWORK_EXTENSIONS.items() if getattr(module, "ATTENTION", False)}
)
# The four families that predate the registry, by the network each builds. A
# model.pt saved before the registry names only its family; this maps it.
LEGACY_NETWORKS = {
    "multilayer_perceptron": "multilayer_perceptron",
    "lstm": "lstm",
    "temporal_convolution_network": "temporal_convolution_network",
    "transformer_encoder": "transformer_encoder",
}
ACTIVATION_FUNCTIONS = {"tanh": nn.Tanh, "relu": nn.ReLU, "gelu": nn.GELU}


class MultilayerPerceptron(nn.Module):
    """(Linear -> activation -> Dropout) x layer_count -> Linear(1). Input (batch, features).
    The activation is GELU unless the entry chooses one (feedforward_network)."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, dropout: float,
                 activation: str = "gelu"):
        super().__init__()
        if activation not in ACTIVATION_FUNCTIONS:
            raise ValueError(
                f"activation_function must be one of {', '.join(ACTIVATION_FUNCTIONS)}, got {activation!r}"
            )
        self.activation = activation
        layers: list[nn.Module] = []
        width = feature_count
        for _ in range(layer_count):
            layers += [nn.Linear(width, hidden_size), ACTIVATION_FUNCTIONS[activation](), nn.Dropout(dropout)]
            width = hidden_size
        self.body = nn.Sequential(*layers)
        self.head = nn.Linear(width, 1)

    def forward(self, rows: torch.Tensor) -> torch.Tensor:
        return self.head(self.body(rows)).squeeze(-1)


class _RecurrentSequenceNetwork(nn.Module):
    """A forward-only recurrent stack; the head reads the hidden state at the last bar."""

    def __init__(self, recurrent: nn.RNNBase, hidden_size: int, dropout: float):
        super().__init__()
        self.recurrent = recurrent
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        output, _ = self.recurrent(window)
        return output

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.head(self.dropout(self.sequence_output(window)[:, -1])).squeeze(-1)


def _recurrent_arguments(layer_count: int, dropout: float) -> dict:
    return {"num_layers": layer_count, "batch_first": True, "dropout": dropout if layer_count > 1 else 0.0}


class LongShortTermMemoryNetwork(_RecurrentSequenceNetwork):
    """Forward-only LSTM; the head reads the hidden state at the last bar."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, dropout: float):
        super().__init__(
            nn.LSTM(feature_count, hidden_size, **_recurrent_arguments(layer_count, dropout)),
            hidden_size, dropout,
        )


class ElmanRecurrentNetwork(_RecurrentSequenceNetwork):
    """Forward-only Elman recurrent network: h_t = tanh(W x_t + U h_(t-1) + b)."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, dropout: float):
        super().__init__(
            nn.RNN(feature_count, hidden_size, nonlinearity="tanh",
                   **_recurrent_arguments(layer_count, dropout)),
            hidden_size, dropout,
        )


class GatedRecurrentUnitNetwork(_RecurrentSequenceNetwork):
    """Forward-only gated recurrent unit (update and reset gates, no cell state)."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, dropout: float):
        super().__init__(
            nn.GRU(feature_count, hidden_size, **_recurrent_arguments(layer_count, dropout)),
            hidden_size, dropout,
        )


class AdditiveAttentionPooling(nn.Module):
    """Additive (Bahdanau) attention over a window, queried by its last position:

        score_j   = v · tanh(W_key h_j + W_query h_last + b)
        weights   = softmax over j of score_j          (one weight per bar, summing to 1)
        context   = sum over j of weights_j · h_j

    Every position is at or before the bar being predicted, so the pooling is
    causal. The weights of the last forward call are kept on `last_weights`
    (batch, time), detached."""

    def __init__(self, hidden_size: int):
        super().__init__()
        self.key = nn.Linear(hidden_size, hidden_size, bias=False)
        self.query = nn.Linear(hidden_size, hidden_size)
        self.score = nn.Linear(hidden_size, 1, bias=False)
        self.last_weights: torch.Tensor | None = None

    def forward(self, sequence: torch.Tensor) -> torch.Tensor:  # (batch, time, hidden)
        energy = torch.tanh(self.key(sequence) + self.query(sequence[:, -1:]))
        weights = torch.softmax(self.score(energy).squeeze(-1).float(), dim=-1)
        self.last_weights = weights.detach()
        return torch.bmm(weights.to(sequence.dtype).unsqueeze(1), sequence).squeeze(1)


class AttentionRecurrentNetwork(nn.Module):
    """Gated recurrent unit over the window, then additive attention pooling of
    its outputs; the head reads the pooled context."""

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, dropout: float):
        super().__init__()
        self.recurrent = nn.GRU(feature_count, hidden_size, **_recurrent_arguments(layer_count, dropout))
        self.attention = AdditiveAttentionPooling(hidden_size)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        output, _ = self.recurrent(window)
        return output

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.head(self.dropout(self.attention(self.sequence_output(window)))).squeeze(-1)


class _CausalConvolutionBlock(nn.Module):
    """Two dilated convolutions, each left-padded by (kernel_size - 1) * dilation
    so output position k sees inputs <= k only, plus a residual connection."""

    def __init__(self, in_channels: int, out_channels: int, kernel_size: int, dilation: int,
                 dropout: float):
        super().__init__()
        self.dilation = dilation
        self.padding = (kernel_size - 1) * dilation
        self.first = nn.Conv1d(in_channels, out_channels, kernel_size, dilation=dilation)
        self.second = nn.Conv1d(out_channels, out_channels, kernel_size, dilation=dilation)
        self.dropout = nn.Dropout(dropout)
        self.residual = (
            nn.Conv1d(in_channels, out_channels, 1) if in_channels != out_channels else nn.Identity()
        )

    def forward(self, series: torch.Tensor) -> torch.Tensor:  # (batch, channels, length)
        hidden = self.dropout(functional.gelu(self.first(functional.pad(series, (self.padding, 0)))))
        hidden = self.dropout(functional.gelu(self.second(functional.pad(hidden, (self.padding, 0)))))
        return functional.gelu(hidden + self.residual(series))


class TemporalConvolutionNetwork(nn.Module):
    """Stack of causal dilated blocks, dilation 2^k; head on the last bar."""

    def __init__(self, feature_count: int, channel_count: int, kernel_size: int,
                 layer_count: int, dropout: float):
        super().__init__()
        blocks = []
        width = feature_count
        for level in range(layer_count):
            blocks.append(
                _CausalConvolutionBlock(width, channel_count, kernel_size, 2 ** level, dropout)
            )
            width = channel_count
        self.blocks = nn.Sequential(*blocks)
        self.head = nn.Linear(channel_count, 1)

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        return self.blocks(window.transpose(1, 2)).transpose(1, 2)

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.head(self.sequence_output(window)[:, -1]).squeeze(-1)


class TransformerEncoderNetwork(nn.Module):
    """Linear projection + learned positions -> pre-norm transformer encoder
    with a causal attention mask -> head on the last token."""

    def __init__(self, feature_count: int, sequence_length: int, model_dimension: int,
                 head_count: int, layer_count: int, dropout: float):
        super().__init__()
        self.projection = nn.Linear(feature_count, model_dimension)
        self.position = nn.Parameter(torch.zeros(1, sequence_length, model_dimension))
        nn.init.normal_(self.position, std=0.02)
        layer = nn.TransformerEncoderLayer(
            model_dimension, head_count, dim_feedforward=4 * model_dimension, dropout=dropout,
            activation="gelu", batch_first=True, norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(
            layer, layer_count, norm=nn.LayerNorm(model_dimension), enable_nested_tensor=False,
        )
        self.register_buffer(
            "causal_mask",
            nn.Transformer.generate_square_subsequent_mask(sequence_length),
            persistent=False,
        )
        self.head = nn.Linear(model_dimension, 1)

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        length = window.shape[1]
        hidden = self.projection(window) + self.position[:, :length]
        mask = self.causal_mask[:length, :length]
        return self.encoder(hidden, mask=mask, is_causal=True)

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.head(self.sequence_output(window)[:, -1]).squeeze(-1)


def build_network(kind: str, parameters: dict, feature_count: int) -> nn.Module:
    """The network of one kind (see NETWORK_KINDS). The legacy family names are
    kinds too, so `build_network(family, ...)` keeps working for them."""
    p = parameters
    if kind == "multilayer_perceptron":
        return MultilayerPerceptron(
            feature_count, p["hidden_size"], p["layer_count"], p["dropout"],
            activation=p.get("activation_function", "gelu"),
        )
    if kind == "lstm":
        return LongShortTermMemoryNetwork(
            feature_count, p["hidden_size"], p["layer_count"], p["dropout"]
        )
    if kind == "recurrent":
        return ElmanRecurrentNetwork(feature_count, p["hidden_size"], p["layer_count"], p["dropout"])
    if kind == "gated_recurrent_unit":
        return GatedRecurrentUnitNetwork(feature_count, p["hidden_size"], p["layer_count"], p["dropout"])
    if kind == "attention_recurrent":
        return AttentionRecurrentNetwork(feature_count, p["hidden_size"], p["layer_count"], p["dropout"])
    if kind == "temporal_convolution_network":
        return TemporalConvolutionNetwork(
            feature_count, p["channel_count"], p["kernel_size"], p["layer_count"], p["dropout"]
        )
    if kind == "transformer_encoder":
        return TransformerEncoderNetwork(
            feature_count, p["sequence_length"], p["model_dimension"], p["head_count"],
            p["layer_count"], p["dropout"],
        )
    extension = NETWORK_EXTENSIONS.get(kind)
    if extension is not None:
        return extension.build(dict(p), int(feature_count))  # type: ignore[attr-defined]
    raise ValueError(f"not a network kind: {kind!r}; the kinds are: {', '.join(NETWORK_KINDS)}")


# ─── trace: every hidden layer for one bar ──────────────────────────────────

# Tolerance for a layer output this module recomputes to read something the
# network's own forward does not expose (lower recurrent layers, attention
# weights) against the output the forward hook recorded.
_RECOMPUTE_TOLERANCE = 1e-4

_RECURRENT_LAYER_NAMES = {
    "lstm": ("Long short-term memory layer", "lstm"),
    "recurrent": ("Recurrent layer", "recurrent"),
    "gated_recurrent_unit": ("Gated recurrent unit layer", "gated_recurrent_unit"),
    "attention_recurrent": ("Gated recurrent unit layer", "gated_recurrent_unit"),
}


def _check_recomputed(what: str, recomputed: torch.Tensor, recorded: torch.Tensor) -> None:
    difference = float((recomputed.float() - recorded.float()).abs().max().item())
    if not math.isfinite(difference) or difference > _RECOMPUTE_TOLERANCE:
        raise RuntimeError(
            f"trace: recomputing {what} differs from the network's own output by {difference:.3g} "
            f"(tolerance {_RECOMPUTE_TOLERANCE:g})"
        )


def _lower_recurrent_layers(module: nn.RNNBase, window: torch.Tensor, top: torch.Tensor) -> list[torch.Tensor]:
    """The output of every layer of a multi-layer recurrent module, [batch, time, units]
    each. torch returns only the top layer, so layer k is re-run as a one-layer module
    of the same type holding layer k's own weights, fed layer k-1's output (dropout
    between layers is off in eval mode); the rebuilt top layer must match `top`, the
    output the forward hook recorded, which is the one returned for it."""
    if module.num_layers == 1:
        return [top]
    outputs = []
    state = module.state_dict()
    current = window
    extra = {"nonlinearity": module.nonlinearity} if isinstance(module, nn.RNN) else {}
    with torch.random.fork_rng(devices=[]):   # building a module draws initial weights
        for layer in range(module.num_layers):
            single = type(module)(current.shape[-1], module.hidden_size, num_layers=1, batch_first=True,
                                  **extra)
            suffix = f"_l{layer}"
            single.load_state_dict({
                name[: -len(suffix)] + "_l0": value for name, value in state.items() if name.endswith(suffix)
            })
            single.eval()
            current, _ = single(current)
            outputs.append(current)
    _check_recomputed("the recurrent layers one at a time", outputs[-1], top)
    outputs[-1] = top
    return outputs


def _transformer_attention(layer: nn.TransformerEncoderLayer, layer_input: torch.Tensor,
                           layer_output: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """Per-head self-attention weights [heads, time, time] of one encoder layer, from its
    own `self_attn` on the inputs the layer received; the layer output rebuilt from them
    must match the one the forward hook recorded."""
    normalised = layer.norm1(layer_input) if layer.norm_first else layer_input
    attended, weights = layer.self_attn(
        normalised, normalised, normalised, attn_mask=mask, need_weights=True, average_attn_weights=False,
    )
    if layer.norm_first:
        residual = layer_input + attended
        rebuilt = residual + layer._ff_block(layer.norm2(residual))
    else:
        residual = layer.norm1(layer_input + attended)
        rebuilt = layer.norm2(residual + layer._ff_block(residual))
    _check_recomputed("an encoder layer from its attention weights", rebuilt, layer_output)
    return weights[0]


def _layer(name: str, kind: str, tensor: torch.Tensor) -> dict:
    """One recorded layer for batch row 0: shape [time, units] or [units], values row-major."""
    value = tensor.detach()[0].double().cpu()
    return {"name": name, "kind": kind, "shape": [int(size) for size in value.shape],
            "values": value.reshape(-1).tolist()}


def trace_network(network: nn.Module, kind: str, window: torch.Tensor) -> dict:
    """Run `network` once on `window` (batch of one, in eval mode) and record every
    hidden layer's output with forward hooks, the attention weights of the last
    position, and the raw head output ("logit": log-odds of up for a direction
    model, the target itself for a price model). The last layer's last row (or
    the last layer itself when it has no time axis) is exactly the head's input."""
    if network.training:
        raise RuntimeError("trace needs the network in eval mode")
    extension = NETWORK_EXTENSIONS.get(kind)
    if extension is not None:
        return extension.trace(network, window)  # type: ignore[attr-defined]
    captured: dict[str, list] = {}
    handles = []

    def keep_output(slot: str):
        def hook(module, inputs, output):
            captured.setdefault(slot, []).append(output[0] if isinstance(output, tuple) else output)
        return hook

    def keep_input(slot: str):
        def hook(module, inputs):
            captured.setdefault(slot, []).append(inputs[0])
        return hook

    layers: list[dict] = []
    attention: list[dict] = []
    try:
        if kind == "multilayer_perceptron":
            for module in network.body:
                if isinstance(module, nn.Dropout):   # the block's output as it flows on
                    handles.append(module.register_forward_hook(keep_output("dense")))
        elif kind in _RECURRENT_LAYER_NAMES:
            handles.append(network.recurrent.register_forward_hook(keep_output("recurrent")))
            if kind == "attention_recurrent":
                handles.append(network.attention.register_forward_hook(keep_output("pooling")))
        elif kind == "temporal_convolution_network":
            for block in network.blocks:
                handles.append(block.register_forward_hook(keep_output("convolution")))
        elif kind == "transformer_encoder":
            handles.append(network.encoder.register_forward_pre_hook(keep_input("projection")))
            for layer in network.encoder.layers:
                handles.append(layer.register_forward_pre_hook(keep_input("encoder_input")))
                handles.append(layer.register_forward_hook(keep_output("encoder_output")))
            if network.encoder.norm is not None:
                handles.append(network.encoder.norm.register_forward_hook(keep_output("final_norm")))
        else:
            raise ValueError(f"not a network kind: {kind!r}")
        with torch.no_grad():
            logit = float(network(window).reshape(-1)[0].item())
            if kind == "multilayer_perceptron":
                activation = getattr(network, "activation", "gelu")
                for number, output in enumerate(captured["dense"], 1):
                    layers.append(_layer(f"Hidden layer {number} ({activation})", "dense", output))
            elif kind in _RECURRENT_LAYER_NAMES:
                (top,) = captured["recurrent"]
                name, layer_kind = _RECURRENT_LAYER_NAMES[kind]
                for number, output in enumerate(_lower_recurrent_layers(network.recurrent, window, top), 1):
                    layers.append(_layer(f"{name} {number}", layer_kind, output))
                if kind == "attention_recurrent":
                    (pooled,) = captured["pooling"]
                    layers.append(_layer("Attention pooling", "attention_pooling", pooled))
                    attention.append({
                        "layer": "Attention pooling", "head": 0,
                        "weights": network.attention.last_weights[0].double().cpu().tolist(),
                    })
            elif kind == "temporal_convolution_network":
                for number, (block, output) in enumerate(zip(network.blocks, captured["convolution"]), 1):
                    layers.append(_layer(
                        f"Causal convolution block {number} (dilation {block.dilation})", "convolution",
                        output.transpose(1, 2),
                    ))
            else:
                (projected,) = captured["projection"]
                layers.append(_layer("Input projection with positions", "projection", projected))
                length = window.shape[1]
                mask = network.causal_mask[:length, :length]
                pairs = zip(network.encoder.layers, captured["encoder_input"], captured["encoder_output"])
                for number, (layer, layer_input, layer_output) in enumerate(pairs, 1):
                    name = f"Encoder layer {number}"
                    layers.append(_layer(name, "transformer_encoder_layer", layer_output))
                    weights = _transformer_attention(layer, layer_input, layer_output, mask)
                    for head in range(weights.shape[0]):
                        attention.append({"layer": name, "head": head,
                                          "weights": weights[head, -1].double().cpu().tolist()})
                if "final_norm" in captured:
                    layers.append(_layer("Final layer normalisation", "layer_norm", captured["final_norm"][0]))
    finally:
        for handle in handles:
            handle.remove()
    return {"layers": layers, "attention": attention, "logit": logit}


def head_input(trace: dict) -> np.ndarray:
    """The vector the head reads, from a trace: the last layer's last row (a
    sequence layer) or the last layer itself (dense, attention pooling)."""
    last = trace["layers"][-1]
    values = np.asarray(last["values"], dtype=np.float64).reshape(last["shape"])
    return values[-1] if values.ndim == 2 else values


# ─── device / seeding ──────────────────────────────────────────────────────

def resolve_device(device: str) -> tuple[str, str | None]:
    """("cuda" | "cpu", note). "auto" picks CUDA when available; an explicit
    "cuda" without a GPU falls back to the CPU with a note."""
    available = torch.cuda.is_available()
    if device == "cuda" and not available:
        return "cpu", "CUDA was requested but no GPU is available; training on the CPU"
    if device in ("auto", "", None):
        return ("cuda" if available else "cpu"), None
    return ("cuda" if device == "cuda" else "cpu"), None


def _seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed % (2 ** 32))
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    # Full float32 precision outside autocast: single-row and batched predictions
    # of the same bar must agree, which TF32 convolutions do not guarantee.
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cuda.matmul.allow_tf32 = False


# ─── adapter ───────────────────────────────────────────────────────────────

_HUBER_DELTA = 1.0


class NeuralAdapter:
    """ModelAdapter for every PyTorch model of the registry (see module docstring).

    Called either way, told apart by the number of positional arguments:

        NeuralAdapter(family, parameters, device, seed, task=...)        legacy family
        NeuralAdapter(key, entry, parameters, device, seed, task=...)    registry key

    Attributes the explainer reads: `.network` (the fitted torch module),
    `.network_kind`, `.key`, `.sequence_length`, `.feature_count`, `.task`,
    `.best_iteration` (the epoch whose weights were kept), and `trace()`."""

    step_unit = "epoch"

    def __init__(self, key: str, *arguments, task: str = "classification") -> None:
        _check_task(task)
        if len(arguments) == 4:
            entry, parameters, device, seed = arguments
            if not isinstance(entry, dict) or "network" not in entry:
                raise TypeError(f"{key}: the registry constructor takes the registry entry second")
            self._configure(key, key, entry["network"], catalog.resolve_parameters(key, parameters),
                            device, seed, task)
        elif len(arguments) == 3:
            parameters, device, seed = arguments
            if key not in LEGACY_NETWORKS:
                raise ValueError(
                    f"not a legacy neural family: {key!r}; registry keys take the constructor "
                    "(key, entry, parameters, device, seed, task)"
                )
            self._configure(key, key, LEGACY_NETWORKS[key], resolve_parameters(key, parameters),
                            device, seed, task)
        else:
            raise TypeError(
                "NeuralAdapter takes (family, parameters, device, seed) or "
                f"(key, entry, parameters, device, seed); got {1 + len(arguments)} positional arguments"
            )

    def _configure(self, key: str, family: str, network_kind: str, parameters: dict, device: str,
                   seed: int, task: str) -> None:
        if network_kind not in NETWORK_KINDS:
            raise ValueError(
                f"{key}: not a network kind: {network_kind!r}; the kinds are: {', '.join(NETWORK_KINDS)}"
            )
        self.key = key
        self.family = family
        self.network_kind = network_kind
        self.task = task
        self.parameters = dict(parameters)
        self.device, device_note = resolve_device(device)
        self.seed = int(seed)
        self.notes: list[str] = [device_note] if device_note else []
        self.sequence_length = (
            int(self.parameters["sequence_length"]) if network_kind in SEQUENCE_NETWORKS else 1
        )
        self.best_iteration: int | None = None
        if network_kind == "transformer_encoder":
            dimension = self.parameters["model_dimension"]
            heads = self.parameters["head_count"]
            if dimension % heads:
                rounded = int(math.ceil(dimension / heads) * heads)
                self.notes.append(
                    f"model_dimension {dimension} is not divisible by head_count {heads}; "
                    f"rounded up to {rounded}"
                )
                self.parameters["model_dimension"] = rounded
        self.network: nn.Module | None = None
        self.feature_count: int | None = None
        self.fit_summary: dict = {}
        self._offsets = np.arange(-self.sequence_length + 1, 1, dtype=np.int64)

    def minimum_history(self) -> int:
        return self.sequence_length

    # ── helpers ──

    def _check_history(self, index: np.ndarray, name: str) -> None:
        if index.size and int(index[0]) < self.sequence_length - 1:
            raise ValueError(
                f"{self.family}: {name} starts at row {int(index[0])} but a prediction needs "
                f"{self.sequence_length} rows of history (first usable row "
                f"{self.sequence_length - 1})"
            )

    def _gather_device(self, matrix: torch.Tensor, rows: torch.Tensor) -> torch.Tensor:
        if self.sequence_length == 1:
            return matrix[rows]
        offsets = torch.arange(-self.sequence_length + 1, 1, device=matrix.device)
        return matrix[rows[:, None] + offsets]

    def _gather_host(self, features: np.ndarray, index: np.ndarray) -> np.ndarray:
        if self.sequence_length == 1:
            return np.ascontiguousarray(features[index], dtype=np.float32)
        return np.ascontiguousarray(features[index[:, None] + self._offsets], dtype=np.float32)

    def _autocast(self):
        if self.device != "cuda":
            return torch.autocast(device_type="cpu", enabled=False)
        return torch.autocast(device_type="cuda", dtype=self._amp_dtype)

    def _output(self, raw: torch.Tensor) -> torch.Tensor:
        """The network's raw head output as this task's prediction: P(up) for
        the direction model, the target itself for the price model."""
        if self.task == "regression":
            return raw
        return torch.sigmoid(raw)

    # ── fit ──

    def fit(self, features, labels, train_index, validation_index, timestamps, reporter):
        reporter.step_unit = self.step_unit
        regression = self.task == "regression"
        train_index = _as_index(train_index)
        validation_index = _as_index(validation_index)
        if train_index.size == 0:
            raise ValueError(f"{self.family}: the training index is empty")
        check_index(features, labels, train_index, "train_index")
        check_index(features, labels, validation_index, "validation_index")
        self._check_history(train_index, "train_index")
        self._check_history(validation_index, "validation_index")
        train_labels = labels[train_index]
        if regression:
            _require_varying_target(self.family, train_labels.astype(np.float64))
        else:
            _require_both_classes(self.family, train_labels)
        for note in self.notes:
            reporter.log(note, "warn")

        _seed_everything(self.seed)
        p = self.parameters
        self.feature_count = int(features.shape[1])
        device = torch.device(self.device)
        network = build_network(self.network_kind, p, self.feature_count).to(device)
        self.network = network

        use_amp = self.device == "cuda"
        self._amp_dtype = (
            torch.bfloat16 if use_amp and torch.cuda.is_bf16_supported() else torch.float16
        )
        scaler = (
            torch.amp.GradScaler("cuda") if use_amp and self._amp_dtype == torch.float16 else None
        )

        matrix = torch.from_numpy(np.ascontiguousarray(features, dtype=np.float32)).to(device)
        label_tensor = torch.from_numpy(
            np.nan_to_num(np.asarray(labels, dtype=np.float32), nan=0.0 if regression else -1.0)
        ).to(device)
        train_rows = torch.from_numpy(train_index).to(device)
        validation_rows = torch.from_numpy(validation_index).to(device)
        validation_labels = labels[validation_index].astype(np.float64)

        if regression:
            positive_weight = None
            loss_function = nn.HuberLoss(delta=_HUBER_DELTA)
        else:
            positives = float(np.sum(train_labels >= 0.5))
            negatives = float(train_labels.size - positives)
            positive_weight = negatives / positives
            loss_function = nn.BCEWithLogitsLoss(
                pos_weight=torch.tensor(positive_weight, dtype=torch.float32, device=device)
            )
        optimizer = torch.optim.AdamW(
            network.parameters(), lr=p["learning_rate"], weight_decay=p["weight_decay"]
        )
        batch_size = min(p["batch_size"], train_index.size)
        blocks = [
            (start, min(start + batch_size, train_index.size))
            for start in range(0, train_index.size, batch_size)
        ]
        batch_count = len(blocks)
        epoch_count = p["epochs"]
        scheduler = torch.optim.lr_scheduler.OneCycleLR(
            optimizer, max_lr=p["learning_rate"], total_steps=epoch_count * batch_count,
            pct_start=0.1,
        )
        block_order_generator = np.random.default_rng(self.seed)

        parameter_count = sum(t.numel() for t in network.parameters())
        precision = (
            f"automatic mixed precision {str(self._amp_dtype).removeprefix('torch.')}"
            + (" with gradient scaling" if scaler else "")
            if use_amp else "float32"
        )
        objective = (
            f"Huber loss (delta {_HUBER_DELTA:g}) on the price target, early stopping on "
            "validation Huber loss, losses reported as mean absolute error"
            if regression else f"positive class weight {positive_weight:.3f}"
        )
        reporter.log(
            f"{self.family} on {self.device} ({precision}): {parameter_count:,} parameters, "
            f"sequence length {self.sequence_length}, {train_index.size} training rows in "
            f"{batch_count} contiguous blocks of up to {batch_size}, "
            f"{validation_index.size} validation rows, {objective}"
        )
        selection_name = "Huber loss" if regression else "log loss"

        best_loss = math.inf
        best_epoch = 0
        best_state = None
        best_reported_loss = None
        epochs_without_improvement = 0
        started = time.perf_counter()
        last_epoch = 0
        for epoch in range(1, epoch_count + 1):
            last_epoch = epoch
            reporter.checkpoint()
            reporter.epoch_started(epoch, epoch_count)
            network.train()
            loss_sum = 0.0
            norm_sum = 0.0
            norm_count = 0
            for batch_number, block in enumerate(block_order_generator.permutation(batch_count), 1):
                reporter.checkpoint()
                batch_started = time.perf_counter()
                start, end = blocks[int(block)]
                rows = train_rows[start:end]
                window = self._gather_device(matrix, rows)
                targets = label_tensor[rows]
                learning_rate = optimizer.param_groups[0]["lr"]
                optimizer.zero_grad(set_to_none=True)
                with self._autocast():
                    logits = network(window)
                loss = loss_function(logits.float(), targets)
                if scaler is not None:
                    scaler.scale(loss).backward()
                    scaler.unscale_(optimizer)
                    norm = torch.nn.utils.clip_grad_norm_(network.parameters(), 1.0)
                    scaler.step(optimizer)
                    scaler.update()
                else:
                    loss.backward()
                    norm = torch.nn.utils.clip_grad_norm_(network.parameters(), 1.0)
                    optimizer.step()
                scheduler.step()
                if regression:
                    # Report mean absolute error (target units), the metric every
                    # price model reports; Huber is what the optimiser minimised.
                    loss_value = float((logits.detach().float() - targets).abs().mean().item())
                else:
                    loss_value = float(loss.item())
                norm_value = float(norm.item())
                if not math.isfinite(norm_value):
                    norm_value_reported = None
                else:
                    norm_value_reported = norm_value
                    norm_sum += norm_value
                    norm_count += 1
                loss_sum += loss_value * (end - start)
                elapsed = max(time.perf_counter() - batch_started, 1e-9)
                reporter.batch(BatchReport(
                    epoch=epoch, epoch_count=epoch_count,
                    batch=batch_number, batch_count=batch_count,
                    span_start_index=int(train_index[start]),
                    span_end_index=int(train_index[end - 1]),
                    train_loss=loss_value if math.isfinite(loss_value) else None,
                    learning_rate=learning_rate,
                    gradient_norm=norm_value_reported,
                    samples_per_second=(end - start) / elapsed,
                ))
            train_loss = loss_sum / train_index.size

            scores = {"loss": None, "accuracy": None, "f1_score": None}
            selection_loss = None
            if validation_index.size:
                reporter.checkpoint()
                reporter.validating(epoch, epoch_count)
                prediction = self._score_device(matrix, validation_rows)
                if regression:
                    regression_score = regression_scores(prediction, validation_labels)
                    scores = {"loss": regression_score["mean_absolute_error"],
                              "accuracy": regression_score["accuracy"], "f1_score": None}
                    selection_loss = huber_loss(prediction, validation_labels, _HUBER_DELTA)
                else:
                    binary = binary_scores(prediction, validation_labels)
                    scores = {"loss": binary["log_loss"], "accuracy": binary["accuracy"],
                              "f1_score": binary["f1_score"]}
                    selection_loss = binary["log_loss"]
            is_best = False
            if selection_loss is not None and selection_loss < best_loss:
                is_best = True
                best_loss = selection_loss
                best_reported_loss = scores["loss"]
                best_epoch = epoch
                best_state = copy.deepcopy(network.state_dict())
                epochs_without_improvement = 0
            elif selection_loss is not None:
                epochs_without_improvement += 1
            stop_now = (
                selection_loss is not None and epochs_without_improvement >= p["patience"]
            )
            reporter.epoch_finished(EpochReport(
                epoch=epoch, epoch_count=epoch_count,
                train_loss=train_loss if math.isfinite(train_loss) else None,
                validation_loss=scores["loss"],
                validation_accuracy=scores["accuracy"],
                validation_f1_score=scores["f1_score"],
                learning_rate=optimizer.param_groups[0]["lr"],
                gradient_norm=(norm_sum / norm_count) if norm_count else None,
                is_best=is_best,
                stopped_early=stop_now and epoch < epoch_count,
            ))
            if stop_now:
                if epoch < epoch_count:
                    reporter.log(
                        f"early stopping after epoch {epoch}: validation {selection_name} has "
                        f"not improved for {p['patience']} epochs (best {best_loss:.4f} at epoch "
                        f"{best_epoch})"
                    )
                break

        if best_state is not None:
            network.load_state_dict(best_state)
            reporter.log(
                f"restored the weights of epoch {best_epoch} (lowest validation {selection_name})"
            )
        else:
            best_epoch = last_epoch
        network.eval()
        del matrix, label_tensor, train_rows, validation_rows
        summary = {
            **_training_summary(train_index, validation_index, timestamps),
            "trained_epochs": last_epoch,
            "best_epoch": best_epoch,
        }
        if regression:
            summary["loss_function"] = f"huber (delta {_HUBER_DELTA:g})"
            summary["best_validation_huber_loss"] = None if math.isinf(best_loss) else best_loss
            summary["best_validation_loss"] = best_reported_loss  # mean absolute error
        else:
            summary["best_validation_loss"] = None if math.isinf(best_loss) else best_loss
            summary["positive_class_weight"] = positive_weight
        summary["parameter_count"] = parameter_count
        summary["fit_seconds"] = time.perf_counter() - started
        self.fit_summary = summary
        self.best_iteration = best_epoch

    def _score_device(self, matrix: torch.Tensor, rows: torch.Tensor) -> np.ndarray:
        """The task's prediction (P(up), or the predicted target) for rows
        already on the device (validation during fit). Runs in float32, like
        `predict_probability` / `predict_value`, so both agree."""
        self.network.eval()
        outputs = []
        with torch.inference_mode():
            for start in range(0, rows.shape[0], _PREDICTION_CHUNK_ROWS):
                chunk = rows[start:start + _PREDICTION_CHUNK_ROWS]
                outputs.append(self._output(self.network(self._gather_device(matrix, chunk))))
        self.network.train()
        return torch.cat(outputs).double().cpu().numpy()

    # ── predict ──

    def _predict(self, features, index, method: str) -> np.ndarray:
        if self.network is None:
            raise RuntimeError(f"{self.family}: {method} called before fit")
        index = _as_index(index)
        if index.size == 0:
            return np.empty(0, dtype=np.float64)
        if int(index.min()) < self.sequence_length - 1:
            raise ValueError(
                f"{self.family}: row {int(index.min())} has fewer than {self.sequence_length} "
                "rows of history"
            )
        network = self.network
        network.eval()
        device = torch.device(self.device)
        outputs = []
        with torch.inference_mode():
            if index.size == 1:
                row = int(index[0])
                window = np.ascontiguousarray(
                    features[row - self.sequence_length + 1:row + 1], dtype=np.float32
                )
                if self.sequence_length == 1:
                    window = window.reshape(1, -1)
                else:
                    window = window[None]
                tensor = torch.from_numpy(window).to(device, non_blocking=False)
                outputs.append(self._output(network(tensor)))
            else:
                for start in range(0, index.size, _PREDICTION_CHUNK_ROWS):
                    chunk = index[start:start + _PREDICTION_CHUNK_ROWS]
                    tensor = torch.from_numpy(self._gather_host(features, chunk)).to(device)
                    outputs.append(self._output(network(tensor)))
        return torch.cat(outputs).double().cpu().numpy()

    def predict_probability(self, features, index):
        if self.task != "classification":
            raise _wrong_task_error(self.family, self.task, "predict_probability")
        return np.clip(self._predict(features, index, "predict_probability"), 0.0, 1.0)

    def predict_value(self, features, index):
        if self.task != "regression":
            raise _wrong_task_error(self.family, self.task, "predict_value")
        return self._predict(features, index, "predict_value")

    # ── trace (Inside the model) ──

    def _window(self, features, row: int) -> torch.Tensor:
        """The single-row input exactly as `_predict` builds it, on the CPU."""
        window = np.ascontiguousarray(features[row - self.sequence_length + 1:row + 1], dtype=np.float32)
        window = window.reshape(1, -1) if self.sequence_length == 1 else window[None]
        return torch.from_numpy(window)

    def _cpu_network(self) -> nn.Module:
        """The fitted network on the CPU in eval mode (a copy when it lives on the GPU)."""
        network = self.network
        if any(parameter.device.type != "cpu" for parameter in network.parameters()):
            network = copy.deepcopy(network).cpu()
        return network.eval()

    def trace(self, features, index) -> dict:
        """How this model turns one bar into its output:

            {"layers": [{"name", "kind", "shape", "values"}],   every hidden layer, in order
             "attention": [{"layer", "head", "weights"}],        the last position's attention
             "logit": float}                                     the raw head output

        One row (`index` is a row number or a one-element index), on the CPU in
        eval mode, through the exact tensor path `predict_*` uses (the same
        window of `sequence_length` rows, no normalisation beyond the engine's
        features). Sequence layers are [time, units] (oldest bar first), dense
        layers [units]; `values` are row-major. The logit is the log-odds of up
        for a direction model (P(up) = 1 / (1 + e^-logit)) and the predicted
        target for a price model. `head_input(trace)` is the vector the head
        read, so `apply_head(head_input(trace))` reproduces the logit."""
        if self.network is None:
            raise RuntimeError(f"{self.family}: trace called before fit")
        rows = _as_index(np.atleast_1d(index))
        if rows.size != 1:
            raise ValueError(f"{self.family}: trace explains one row at a time, got {rows.size}")
        row = int(rows[0])
        if row < self.sequence_length - 1 or row >= len(features):
            raise ValueError(
                f"{self.family}: row {row} is outside the rows a prediction can be made for "
                f"({self.sequence_length - 1} to {len(features) - 1})"
            )
        return trace_network(self._cpu_network(), self.network_kind, self._window(features, row))

    def apply_head(self, activation) -> float:
        """The head applied to one head-input vector (see `head_input`), on the CPU."""
        network = self._cpu_network()
        vector = torch.as_tensor(np.asarray(activation, dtype=np.float32))[None]
        with torch.no_grad():
            return float(network.head(vector).reshape(-1)[0].item())

    def describe(self) -> dict:
        """What the network is, for the structure view: its kind, every traced layer's
        name, kind and output shape (from a trace of an all-zero window), the window
        length and whether a trace carries attention weights."""
        if self.network is None:
            raise RuntimeError(f"{self.family}: describe called before fit")
        zeros = np.zeros((self.sequence_length, int(self.feature_count)), dtype=np.float32)
        traced = trace_network(self._cpu_network(), self.network_kind,
                               self._window(zeros, self.sequence_length - 1))
        return {
            "network": self.network_kind,
            "layers": [{"name": layer["name"], "kind": layer["kind"], "outputShape": layer["shape"]}
                       for layer in traced["layers"]],
            "sequenceLength": self.sequence_length,
            "hasAttention": self.network_kind in ATTENTION_NETWORKS,
        }

    # ── save / load ──

    def save(self, directory: str) -> str:
        if self.network is None:
            raise RuntimeError(f"{self.family}: save called before fit")
        folder = Path(directory)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "model.pt"
        temporary = folder / "model.pt.tmp"
        state = {
            "state_dict": {k: v.detach().cpu() for k, v in self.network.state_dict().items()},
            "key": self.key,
            "family": self.family,
            "network": self.network_kind,
            "task": self.task,
            "parameters": dict(self.parameters),
            "feature_count": self.feature_count,
            "sequence_length": self.sequence_length,
            "best_iteration": self.best_iteration,
        }
        torch.save(state, temporary)
        os.replace(temporary, path)
        metadata = _base_metadata(
            self, path.name,
            {"torch": torch.__version__, "cuda": str(torch.version.cuda)},
        )
        metadata["network"] = self.network_kind
        metadata["sequence_length"] = self.sequence_length
        write_metadata(folder, metadata)
        return str(path)

    @classmethod
    def load(cls, directory: str, device: str = "cpu", metadata: dict | None = None) -> NeuralAdapter:
        """Rebuild a saved network. A legacy family is rebuilt through its own
        constructor, exactly as before the registry (a model.pt that names only
        its family maps to that family's network); a registry key is rebuilt from
        the key, network kind and resolved parameters it saved, so a later
        registry edit cannot change a saved model."""
        state = torch.load(Path(directory) / "model.pt", map_location="cpu", weights_only=True)
        task = state.get("task", "classification")
        key = state.get("key", state["family"])
        if key in LEGACY_NETWORKS:
            adapter = cls(state["family"], state["parameters"], device, 0, task=task)
        else:
            _check_task(task)
            adapter = cls.__new__(cls)
            adapter._configure(key, state["family"], state["network"], state["parameters"], device, 0, task)
        saved_kind = state.get("network", LEGACY_NETWORKS.get(state["family"]))
        if saved_kind != adapter.network_kind:
            raise ValueError(
                f"{directory}: model.pt holds a {saved_kind!r} network but {key!r} builds {adapter.network_kind!r}"
            )
        adapter.feature_count = int(state["feature_count"])
        adapter.best_iteration = state.get("best_iteration")
        network = build_network(adapter.network_kind, adapter.parameters, adapter.feature_count)
        network.load_state_dict(state["state_dict"])
        adapter.network = network.to(torch.device(adapter.device)).eval()
        return adapter
