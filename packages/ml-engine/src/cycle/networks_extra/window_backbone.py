"""Window backbones: the Model Cycle's network kind for eight catalog specs whose
home is images or continuous time, each re-expressed as a ONE-DIMENSIONAL
network over the window of ``sequence_length`` bars (the spec's own 1-D
variant; there are no pixels):

    backbone              catalog spec
    resnet                Residual Neural Network (ResNet)
    densenet              DenseNet (Densely Connected CNN)
    unet                  U-Net
    vision_transformer    Vision Transformer (ViT)
    capsule               Capsule Network
    slot_attention        Slot Attention Network
    spiking               Spiking Neural Network (SNN)
    neural_ode            Neural Ordinary Differential Equation (Neural ODE)

The registry entry picks one with its one-choice ``backbone`` parameter; every
backbone is trained by the Cycle's one loop (``cycle.networks.NeuralAdapter``:
AdamW, one-cycle learning rate, early stopping on validation loss, the price
model as Huber regression on the same network's raw head output).

Input. ``NeuralAdapter`` appends this module's ``extra_channels(view)`` to the
features, so every window is (batch, time, features + 1): the last column is
the TIME STEP from the previous bar in typical-bar units on a log2 scale
(``time_step_channel``). Only the neural ODE reads it (a session gap is a long
integration); every other backbone drops it and reads the features alone.

Output. ``forward(window)`` returns one raw logit per window, (batch,): the
log-odds of up for the direction model, the target itself for the price model.
Every backbone ends in ``self.head = nn.Linear(width, 1)``, and ``trace``
records the head's input as its LAST layer (a vector, or a [time, units] map
whose last row is the head input), so ``NeuralAdapter.apply_head(head_input(
trace))`` reproduces the logit (gate G4).

Causality. A prediction at bar t reads only the window t-L+1..t, so no bar
after t can move it. Inside the window: convolutions are left-padded (position
k reads positions <= k), downsampling keeps the LAST bar (pairs end at the
newest bar; odd leading bars are cropped), the U-Net's upsampling is shifted so
a fine position reads only coarse positions that end at or before it, and the
recurrent backbones (spiking, neural ODE) run forward in time. The vision
transformer, capsule routing and slot attention mix every bar of the window
with every other, which is causal because the whole window precedes the bar
being predicted; they read the window as one object, as the specs read an
image.

Reproducibility. Nothing is sampled at prediction time (the slots start from
learned vectors, spikes come from direct current input, the ODE uses a
fixed-step solver), and every operation is per window, so one bar scored alone
equals the same bar scored in a batch.

The optional hooks ``NeuralAdapter`` reads (see its docstring):

    capsule          loss_override: margin loss on the class capsule lengths plus
                     the head's own term (binary cross-entropy for the direction
                     model, Huber for the price model)
    slot_attention   auxiliary_loss: reconstruction of the window's features from
                     the slots (spatial-broadcast decoder with competing masks)
    spiking          auxiliary_loss: firing-rate penalty toward a target rate
"""

from __future__ import annotations

import copy
import math

import numpy as np
import torch
import torch.nn.functional as functional
from torch import nn

SEQUENCE = True     # reads a window of `sequence_length` bars
ATTENTION = False   # attention weights (vision transformer, slot attention) are recorded as layers instead

BACKBONES = ("resnet", "densenet", "unet", "vision_transformer", "capsule", "slot_attention", "spiking",
             "neural_ode")
INTEGRATION_METHODS = ("euler", "midpoint", "rk4")   # fixed-step only: an adaptive step would depend on the batch

# Parameters each backbone reads besides the training loop's own (learning_rate, weight_decay,
# batch_size, epochs, patience) and sequence_length.
REQUIRED_PARAMETERS: dict[str, tuple[str, ...]] = {
    "resnet": ("base_channel_count", "stage_count", "residual_block_count", "kernel_size", "dropout"),
    "densenet": ("base_channel_count", "dense_block_count", "layers_per_block", "growth_rate",
                 "compression_factor", "kernel_size", "dropout"),
    "unet": ("base_channel_count", "level_count", "kernel_size", "dropout"),
    "vision_transformer": ("patch_bars", "model_dimension", "head_count", "layer_count", "dropout"),
    "capsule": ("channel_count", "kernel_size", "convolution_layer_count", "primary_capsule_count",
                "primary_capsule_size", "class_capsule_size", "iteration_count", "upper_margin", "lower_margin",
                "absent_class_weight", "dropout"),
    "slot_attention": ("model_dimension", "slot_count", "iteration_count", "reconstruction_weight", "dropout"),
    "spiking": ("hidden_size", "layer_count", "membrane_decay", "spike_threshold", "surrogate_slope",
                "firing_rate_weight", "target_firing_rate", "dropout"),
    "neural_ode": ("hidden_size", "dynamics_hidden_size", "integration_method", "solver_steps", "dropout"),
}

# ─── the time-step channel ─────────────────────────────────────────────────


def time_step_channel(timestamps: np.ndarray) -> np.ndarray:
    """float32 (n, 1): log2(1 + (timestamp[t] - timestamp[t-1]) / typical[t]),
    where typical[t] is the smallest positive bar-to-bar step among bars <= t.
    A regular bar is exactly 1.0; a one-hour break in 5-minute bars is log2(13)
    = 3.7; a weekend about 9.2. Row 0 (no previous bar) is 1.0, and so is any
    row before the first positive step. Causal: row t reads timestamps <= t
    only, so cutting the series after t leaves rows <= t unchanged."""
    stamps = np.asarray(timestamps, dtype=np.int64)
    count = int(stamps.shape[0])
    out = np.ones((count, 1), dtype=np.float32)
    if count < 2:
        return out
    steps = np.diff(stamps).astype(np.float64)                     # steps[t - 1] = ts[t] - ts[t - 1]
    positive = np.where(steps > 0, steps, np.inf)
    typical = np.minimum.accumulate(positive)
    known = np.isfinite(typical)
    ratio = np.ones(count - 1, dtype=np.float64)
    ratio[known] = np.maximum(steps[known], 0.0) / typical[known]
    out[1:, 0] = np.log2(1.0 + ratio).astype(np.float32)
    return out


def extra_channels(view) -> np.ndarray:
    """The hook ``NeuralAdapter`` appends to the features: the time-step channel
    of the bound ``cycle.market.MarketView`` (read at predict time from
    ``timestamps`` only, rows <= t)."""
    return time_step_channel(view.timestamps)


# ─── shared pieces ─────────────────────────────────────────────────────────


class CausalConvolution(nn.Module):
    """A 1-D convolution left-padded by (kernel_size - 1) * dilation: output
    position k reads input positions <= k."""

    def __init__(self, input_channels: int, output_channels: int, kernel_size: int, dilation: int = 1):
        super().__init__()
        self.padding = (kernel_size - 1) * dilation
        self.convolution = nn.Conv1d(input_channels, output_channels, kernel_size, dilation=dilation)

    def forward(self, series: torch.Tensor) -> torch.Tensor:  # (batch, channels, time)
        return self.convolution(functional.pad(series, (self.padding, 0)))


def keep_last_of_pairs(series: torch.Tensor) -> torch.Tensor:
    """Stride-2 subsampling aligned to the NEWEST bar: positions T-1, T-3, ... (the last bar is always kept)."""
    length = series.shape[-1]
    return series[..., (length - 1) % 2::2]


def pool_pairs(series: torch.Tensor, how: str = "average") -> torch.Tensor:
    """Pool neighbouring positions in pairs that END at the newest bar (an odd
    leading position is cropped): coarse position j covers the pair ending at
    fine position 2j + 1 of the cropped series."""
    length = series.shape[-1]
    series = series[..., length % 2:]
    shaped = series.reshape(*series.shape[:-1], series.shape[-1] // 2, 2)
    return shaped.mean(-1) if how == "average" else shaped.amax(-1)


def squash(vectors: torch.Tensor, dimension: int = -1) -> torch.Tensor:
    """Capsule squashing: v = |s|^2 / (1 + |s|^2) * s / |s| (length in [0, 1), direction kept)."""
    squared = (vectors * vectors).sum(dimension, keepdim=True)
    return squared / (1.0 + squared) * vectors / torch.sqrt(squared + 1e-9)


def _record(record: list | None, name: str, kind: str, tensor: torch.Tensor) -> None:
    if record is not None:
        record.append((name, kind, tensor))


class WindowBackbone(nn.Module):
    """Common frame: the time-step channel is split off the window; ``_run``
    is the one tensor path for both ``forward`` and ``trace``.

    Scoring (eval mode, outside automatic mixed precision) runs a float64 copy
    of the network (``scoring_network``, rebuilt whenever a weight changes), so
    a bar scored alone equals the same bar scored in a batch to about 1e-15:
    float32 kernels pick different blockings for different batch sizes and
    differ by ~1e-7. Training runs the float32 network itself."""

    backbone = ""
    reads_time_steps = False

    def __init__(self, feature_count: int):
        super().__init__()
        if int(feature_count) < 2:
            raise ValueError(
                f"window_backbone: the window needs at least one feature plus the time-step channel, got {feature_count} columns"
            )
        self.feature_count = int(feature_count)
        self.input_count = int(feature_count) - 1       # the features, without the time-step channel

    def split(self, window: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return window[..., :-1], window[..., -1]

    def _run(self, window: torch.Tensor, record: list | None) -> torch.Tensor:  # pragma: no cover - abstract
        raise NotImplementedError

    def _weights_signature(self) -> tuple:
        tensors = [*self.parameters(), *self.buffers()]
        return tuple((tensor.data_ptr(), tensor._version, str(tensor.device)) for tensor in tensors)

    def scoring_network(self) -> WindowBackbone:
        """The float64 copy of this network in eval mode, rebuilt when a weight, a buffer or the device changed."""
        cache = self.__dict__.get("_scoring_cache")
        signature = self._weights_signature()
        if cache is not None and cache[0] == signature:
            return cache[1]
        self.__dict__.pop("_scoring_cache", None)
        try:
            shadow = copy.deepcopy(self)
        finally:
            if cache is not None:
                self.__dict__["_scoring_cache"] = cache
        shadow = shadow.double().eval().requires_grad_(False)
        self.__dict__["_scoring_cache"] = (signature, shadow)
        return shadow

    def _scores_in_float64(self, window: torch.Tensor) -> bool:
        return not self.training and not torch.is_autocast_enabled(window.device.type)

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        if self._scores_in_float64(window) and window.dtype != torch.float64:
            return self.scoring_network()._run(window.double(), None)
        return self._run(window, None)


# ─── ResNet ────────────────────────────────────────────────────────────────


class ResidualBlock(nn.Module):
    """y = relu(F(x) + shortcut(x)), F = conv -> batch norm -> relu -> conv -> batch norm (causal
    convolutions). With ``downsample`` the first convolution keeps every second bar ending at the
    newest one (a causal stride 2) and the shortcut is a 1x1 projection of the same bars."""

    def __init__(self, input_channels: int, output_channels: int, kernel_size: int, downsample: bool,
                 dropout: float):
        super().__init__()
        self.downsample = downsample
        self.first = CausalConvolution(input_channels, output_channels, kernel_size)
        self.first_norm = nn.BatchNorm1d(output_channels)
        self.second = CausalConvolution(output_channels, output_channels, kernel_size)
        self.second_norm = nn.BatchNorm1d(output_channels)
        self.dropout = nn.Dropout(dropout)
        self.shortcut = (
            nn.Sequential(nn.Conv1d(input_channels, output_channels, 1), nn.BatchNorm1d(output_channels))
            if downsample or input_channels != output_channels else nn.Identity()
        )

    def forward(self, series: torch.Tensor) -> torch.Tensor:
        hidden = self.first(series)
        if self.downsample:
            hidden = keep_last_of_pairs(hidden)
            series = keep_last_of_pairs(series)
        hidden = self.dropout(functional.relu(self.first_norm(hidden)))
        hidden = self.second_norm(self.second(hidden))
        return functional.relu(hidden + self.shortcut(series))


class ResidualNetwork(WindowBackbone):
    """1-D ResNet: causal stem -> stages of residual blocks (channels double and the bars halve,
    ending at the newest bar, at the first block of every stage after the first while at least
    four bars remain) -> global average pool over the window -> head."""

    backbone = "resnet"

    def __init__(self, feature_count: int, sequence_length: int, base_channel_count: int, stage_count: int,
                 residual_block_count: int, kernel_size: int, dropout: float):
        super().__init__(feature_count)
        self.stem = CausalConvolution(self.input_count, base_channel_count, kernel_size)
        self.stem_norm = nn.BatchNorm1d(base_channel_count)
        blocks: list[nn.Module] = []
        width, length = base_channel_count, int(sequence_length)
        for stage in range(stage_count):
            channels = base_channel_count * 2 ** stage
            for number in range(residual_block_count):
                downsample = stage > 0 and number == 0 and length >= 4
                blocks.append(ResidualBlock(width, channels, kernel_size, downsample, dropout))
                width = channels
                if downsample:
                    length = (length + 1) // 2
        self.blocks = nn.ModuleList(blocks)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(width, 1)

    def _run(self, window, record):
        features, _ = self.split(window)
        series = functional.relu(self.stem_norm(self.stem(features.transpose(1, 2))))
        _record(record, "Causal convolution stem (relu)", "convolution", series.transpose(1, 2))
        for number, block in enumerate(self.blocks, 1):
            series = block(series)
            _record(record, f"Residual block {number} ({series.shape[1]} channels)", "residual_block",
                    series.transpose(1, 2))
        pooled = series.mean(-1)
        _record(record, "Global average pool over the window", "pooling", pooled)
        return self.head(self.dropout(pooled)).squeeze(-1)


# ─── DenseNet ──────────────────────────────────────────────────────────────


class DenseLayer(nn.Module):
    """DenseNet-BC layer: batch norm -> relu -> 1x1 bottleneck (4 x growth) -> batch norm -> relu ->
    causal convolution (growth new channels); its output is concatenated to its input."""

    def __init__(self, input_channels: int, growth_rate: int, kernel_size: int, dropout: float):
        super().__init__()
        self.first_norm = nn.BatchNorm1d(input_channels)
        self.bottleneck = nn.Conv1d(input_channels, 4 * growth_rate, 1)
        self.second_norm = nn.BatchNorm1d(4 * growth_rate)
        self.convolution = CausalConvolution(4 * growth_rate, growth_rate, kernel_size)
        self.dropout = nn.Dropout(dropout)

    def forward(self, series: torch.Tensor) -> torch.Tensor:
        hidden = self.bottleneck(functional.relu(self.first_norm(series)))
        hidden = self.dropout(self.convolution(functional.relu(self.second_norm(hidden))))
        return torch.cat([series, hidden], dim=1)


class Transition(nn.Module):
    """Between dense blocks: batch norm -> relu -> 1x1 compression -> average of bar pairs ending at the newest bar."""

    def __init__(self, input_channels: int, output_channels: int, pool: bool):
        super().__init__()
        self.pool = pool
        self.norm = nn.BatchNorm1d(input_channels)
        self.compression = nn.Conv1d(input_channels, output_channels, 1)

    def forward(self, series: torch.Tensor) -> torch.Tensor:
        series = self.compression(functional.relu(self.norm(series)))
        return pool_pairs(series, "average") if self.pool else series


class DenselyConnectedNetwork(WindowBackbone):
    """1-D DenseNet-BC: causal stem -> dense blocks (each layer reads the concatenation of every
    earlier map in its block) separated by compressing transitions -> batch norm -> relu ->
    global average pool -> head."""

    backbone = "densenet"

    def __init__(self, feature_count: int, sequence_length: int, base_channel_count: int, dense_block_count: int,
                 layers_per_block: int, growth_rate: int, compression_factor: float, kernel_size: int,
                 dropout: float):
        super().__init__(feature_count)
        if not 0.0 < compression_factor <= 1.0:
            raise ValueError(f"window_backbone densenet: compression_factor must be in (0, 1], got {compression_factor}")
        self.stem = CausalConvolution(self.input_count, base_channel_count, kernel_size)
        blocks: list[nn.Module] = []
        transitions: list[nn.Module] = []
        width, length = base_channel_count, int(sequence_length)
        for number in range(dense_block_count):
            layers = []
            for _ in range(layers_per_block):
                layers.append(DenseLayer(width, growth_rate, kernel_size, dropout))
                width += growth_rate
            blocks.append(nn.Sequential(*layers))
            if number < dense_block_count - 1:
                compressed = max(1, int(math.floor(width * compression_factor)))
                pool = length >= 4
                transitions.append(Transition(width, compressed, pool))
                width = compressed
                if pool:
                    length //= 2
        self.blocks = nn.ModuleList(blocks)
        self.transitions = nn.ModuleList(transitions)
        self.final_norm = nn.BatchNorm1d(width)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(width, 1)

    def _run(self, window, record):
        features, _ = self.split(window)
        series = self.stem(features.transpose(1, 2))
        _record(record, "Causal convolution stem", "convolution", series.transpose(1, 2))
        for number, block in enumerate(self.blocks, 1):
            series = block(series)
            _record(record, f"Dense block {number} ({series.shape[1]} channels)", "dense_block", series.transpose(1, 2))
            if number <= len(self.transitions):
                series = self.transitions[number - 1](series)
                _record(record, f"Transition {number} (compression and pair pooling)", "transition",
                        series.transpose(1, 2))
        pooled = functional.relu(self.final_norm(series)).mean(-1)
        _record(record, "Global average pool over the window", "pooling", pooled)
        return self.head(self.dropout(pooled)).squeeze(-1)


# ─── U-Net ─────────────────────────────────────────────────────────────────


class DoubleConvolution(nn.Module):
    """Two causal convolutions, each followed by a rectified linear unit (the U-Net block)."""

    def __init__(self, input_channels: int, output_channels: int, kernel_size: int, dropout: float):
        super().__init__()
        self.first = CausalConvolution(input_channels, output_channels, kernel_size)
        self.second = CausalConvolution(output_channels, output_channels, kernel_size)
        self.dropout = nn.Dropout(dropout)

    def forward(self, series: torch.Tensor) -> torch.Tensor:
        series = self.dropout(functional.relu(self.first(series)))
        return functional.relu(self.second(series))


def causal_upsample(coarse: torch.Tensor) -> torch.Tensor:
    """Nearest-neighbour upsampling by 2, shifted one bar later: fine position p reads the coarse
    position whose pair ENDS at or before p (p >= 1; position 0 reads zeros). The newest fine bar
    (odd, 2J - 1) reads the newest coarse position."""
    repeated = coarse.repeat_interleave(2, dim=-1)
    return functional.pad(repeated, (1, 0))[..., :-1]


class UNetwork(WindowBackbone):
    """1-D U-Net: encoder levels (double causal convolution, then max pooling of bar pairs ending at
    the newest bar, channels doubling), a bottleneck, and decoder levels (causal upsampling,
    concatenation with the encoder's skip map at the same resolution, double convolution) back to
    one position per bar. The oldest bars that do not fill whole 2^level_count groups are cropped;
    the head reads the decoded map's LAST position only."""

    backbone = "unet"

    def __init__(self, feature_count: int, sequence_length: int, base_channel_count: int, level_count: int,
                 kernel_size: int, dropout: float):
        super().__init__(feature_count)
        if int(sequence_length) < 2 ** (level_count + 1):
            raise ValueError(
                f"window_backbone unet: sequence_length {sequence_length} is too short for {level_count} levels "
                f"(needs at least {2 ** (level_count + 1)} bars)"
            )
        self.level_count = int(level_count)
        encoders, decoders = [], []
        width = self.input_count
        for level in range(level_count):
            channels = base_channel_count * 2 ** level
            encoders.append(DoubleConvolution(width, channels, kernel_size, dropout))
            width = channels
        self.encoders = nn.ModuleList(encoders)
        self.bottleneck = DoubleConvolution(width, base_channel_count * 2 ** level_count, kernel_size, dropout)
        width = base_channel_count * 2 ** level_count
        for level in reversed(range(level_count)):
            channels = base_channel_count * 2 ** level
            decoders.append(DoubleConvolution(width + channels, channels, kernel_size, dropout))
            width = channels
        self.decoders = nn.ModuleList(decoders)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(width, 1)

    def _decode(self, window: torch.Tensor, record: list | None) -> torch.Tensor:
        features, _ = self.split(window)
        group = 2 ** self.level_count
        used = (features.shape[1] // group) * group
        if used < group:
            raise ValueError(f"window_backbone unet: a window of {features.shape[1]} bars is shorter than {group}")
        series = features[:, features.shape[1] - used:].transpose(1, 2)
        skips = []
        for level, encoder in enumerate(self.encoders, 1):
            series = encoder(series)
            skips.append(series)
            _record(record, f"Encoder level {level} ({series.shape[1]} channels, {series.shape[2]} bars)", "convolution",
                    series.transpose(1, 2))
            series = pool_pairs(series, "maximum")
        series = self.bottleneck(series)
        _record(record, f"Bottleneck ({series.shape[1]} channels, {series.shape[2]} bars)", "convolution",
                series.transpose(1, 2))
        for number, (decoder, skip) in enumerate(zip(self.decoders, reversed(skips)), 1):
            series = decoder(torch.cat([skip, causal_upsample(series)], dim=1))
            _record(record, f"Decoder level {number} ({series.shape[1]} channels, {series.shape[2]} bars)",
                    "convolution", series.transpose(1, 2))
        return series.transpose(1, 2)

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        """The decoded map, one row per bar of the (cropped) window, (batch, used bars, channels)."""
        return self._decode(window, None)

    def _run(self, window, record):
        decoded = self._decode(window, record)
        return self.head(self.dropout(decoded[:, -1])).squeeze(-1)


# ─── Vision transformer ────────────────────────────────────────────────────


class VisionTransformer(WindowBackbone):
    """ViT over the bar axis: the window is cut into non-overlapping patches of ``patch_bars`` bars
    ending at the newest bar (the oldest bars that do not fill a patch are cropped), each patch is
    flattened and linearly embedded, a learned class token and learned positions are added, pre-norm
    transformer encoder layers attend across the patches, and the class token's final normalised
    output feeds the head."""

    backbone = "vision_transformer"

    def __init__(self, feature_count: int, sequence_length: int, patch_bars: int, model_dimension: int,
                 head_count: int, layer_count: int, dropout: float):
        super().__init__(feature_count)
        if patch_bars > sequence_length:
            raise ValueError(
                f"window_backbone vision_transformer: patch_bars {patch_bars} is longer than the window {sequence_length}"
            )
        if model_dimension % head_count:
            raise ValueError(
                f"window_backbone vision_transformer: model_dimension {model_dimension} is not divisible by head_count {head_count}"
            )
        self.patch_bars = int(patch_bars)
        self.maximum_patches = int(sequence_length) // int(patch_bars)
        self.embedding = nn.Linear(self.input_count * patch_bars, model_dimension)
        self.class_token = nn.Parameter(torch.zeros(1, 1, model_dimension))
        self.position = nn.Parameter(torch.zeros(1, self.maximum_patches + 1, model_dimension))
        nn.init.normal_(self.class_token, std=0.02)
        nn.init.normal_(self.position, std=0.02)
        self.layers = nn.ModuleList(
            nn.TransformerEncoderLayer(model_dimension, head_count, dim_feedforward=4 * model_dimension,
                                       dropout=dropout, activation="gelu", batch_first=True, norm_first=True)
            for _ in range(layer_count)
        )
        self.norm = nn.LayerNorm(model_dimension)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(model_dimension, 1)

    def _run(self, window, record):
        features, _ = self.split(window)
        count = min(features.shape[1] // self.patch_bars, self.maximum_patches)
        if count < 1:
            raise ValueError(f"window_backbone vision_transformer: a window of {features.shape[1]} bars holds no patch")
        used = features[:, features.shape[1] - count * self.patch_bars:]
        patches = used.reshape(used.shape[0], count, self.patch_bars * self.input_count)
        tokens = torch.cat([self.class_token.expand(patches.shape[0], -1, -1), self.embedding(patches)], dim=1)
        tokens = tokens + self.position[:, :count + 1]
        _record(record, f"Patch embeddings with class token ({count} patches of {self.patch_bars} bars)",
                "projection", tokens)
        for number, layer in enumerate(self.layers, 1):
            layer_input = tokens
            tokens = layer(tokens)
            if record is not None:
                from .. import networks

                weights = networks._transformer_attention(layer, layer_input, tokens, None)
                _record(record, f"Class token attention over patches, encoder layer {number} (heads x tokens)",
                        "attention_weights", weights[:, 0][None])
                _record(record, f"Encoder layer {number}", "transformer_encoder_layer", tokens)
        summary = self.norm(tokens[:, 0])
        _record(record, "Class token (final layer normalisation)", "class_token", summary)
        return self.head(self.dropout(summary)).squeeze(-1)


# ─── Capsule network ───────────────────────────────────────────────────────


class CapsuleNetwork(WindowBackbone):
    """Causal convolution stem -> primary capsules (``primary_capsule_count`` capsule types at every
    bar, vectors of ``primary_capsule_size`` squashed into the unit ball) -> a transformation matrix
    per (primary capsule, class) predicts two class capsules, up and down -> ``iteration_count``
    rounds of dynamic routing by agreement -> the class capsules' lengths. The head is a linear map
    of the two lengths, started at 4 x (|v_up| - |v_down|), so the length gap becomes a probability.
    Trained with the margin loss on the lengths (m+ ``upper_margin``, m- ``lower_margin``, absent
    class weight) plus the head's own loss (``loss_override``)."""

    backbone = "capsule"

    def __init__(self, feature_count: int, sequence_length: int, channel_count: int, kernel_size: int,
                 convolution_layer_count: int, primary_capsule_count: int, primary_capsule_size: int,
                 class_capsule_size: int, iteration_count: int, upper_margin: float, lower_margin: float,
                 absent_class_weight: float, dropout: float):
        super().__init__(feature_count)
        if not 0.0 <= lower_margin < upper_margin <= 1.0:
            raise ValueError(
                f"window_backbone capsule: margins must satisfy 0 <= lower_margin < upper_margin <= 1, "
                f"got {lower_margin}, {upper_margin}"
            )
        layers, width = [], self.input_count
        for _ in range(convolution_layer_count):
            layers.append(CausalConvolution(width, channel_count, kernel_size))
            width = channel_count
        self.stem = nn.ModuleList(layers)
        self.primary = CausalConvolution(width, primary_capsule_count * primary_capsule_size, kernel_size)
        self.sequence_length = int(sequence_length)
        self.primary_capsule_count = int(primary_capsule_count)
        self.primary_capsule_size = int(primary_capsule_size)
        capsules = self.sequence_length * self.primary_capsule_count
        self.transform = nn.Parameter(0.05 * torch.randn(capsules, 2, class_capsule_size, primary_capsule_size))
        self.iteration_count = int(iteration_count)
        self.upper_margin = float(upper_margin)
        self.lower_margin = float(lower_margin)
        self.absent_class_weight = float(absent_class_weight)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(2, 1)
        with torch.no_grad():
            self.head.weight.copy_(torch.tensor([[4.0, -4.0]]))
            self.head.bias.zero_()
        self._lengths: torch.Tensor | None = None
        self._task: str | None = None

    def _run(self, window, record):
        features, _ = self.split(window)
        if features.shape[1] != self.sequence_length:
            raise ValueError(
                f"window_backbone capsule: built for windows of {self.sequence_length} bars, got {features.shape[1]}"
            )
        series = features.transpose(1, 2)
        for number, layer in enumerate(self.stem, 1):
            series = self.dropout(functional.relu(layer(series)))
            _record(record, f"Causal convolution stem layer {number} (relu)", "convolution", series.transpose(1, 2))
        primary = self.primary(series)                                        # (batch, types * size, time)
        batch, _, length = primary.shape
        primary = primary.reshape(batch, self.primary_capsule_count, self.primary_capsule_size, length)
        primary = squash(primary.permute(0, 3, 1, 2), -1)                     # (batch, time, types, size)
        _record(record, "Primary capsule lengths (bars x capsule types)", "capsule_lengths",
                primary.norm(dim=-1))
        capsules = primary.reshape(batch, length * self.primary_capsule_count, self.primary_capsule_size)
        predictions = torch.einsum("nkij,bnj->bnki", self.transform, capsules)   # (batch, capsules, 2, size)
        logits = torch.zeros(predictions.shape[:3], dtype=predictions.dtype, device=predictions.device)
        for iteration in range(self.iteration_count):
            coupling = torch.softmax(logits, dim=2)
            outputs = squash((coupling.unsqueeze(-1) * predictions).sum(1), -1)   # (batch, 2, size)
            if iteration < self.iteration_count - 1:
                logits = logits + (predictions * outputs.unsqueeze(1)).sum(-1)
        _record(record, "Class capsules (up, down)", "capsule_poses", outputs)
        lengths = torch.sqrt((outputs * outputs).sum(-1) + 1e-9)
        if self.training:
            self._lengths = lengths          # read (and dropped) by loss_override
        _record(record, "Class capsule lengths (up, down)", "capsule_lengths", lengths)
        return self.head(lengths).squeeze(-1)

    def loss_override(self, outputs: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        """Margin loss on the class capsule lengths plus the head's own term. The direction model's
        targets are exactly 0 or 1 (binary cross-entropy on the head); any other value marks the
        price model (Huber on the head, and the capsules learn the sign of the move). Decided on the
        first training batch and kept for the fit."""
        lengths, self._lengths = self._lengths, None
        if lengths is None:
            raise RuntimeError("window_backbone capsule: loss_override before a training forward pass")
        if self._task is None:
            binary = bool(torch.all((targets == 0) | (targets == 1)).item())
            self._task = "classification" if binary else "regression"
        up = (targets > 0.5) if self._task == "classification" else (targets > 0)
        lengths = lengths.float()
        present = torch.stack([up, ~up], dim=1).to(lengths.dtype)
        margin = (present * functional.relu(self.upper_margin - lengths) ** 2
                  + self.absent_class_weight * (1.0 - present) * functional.relu(lengths - self.lower_margin) ** 2)
        if self._task == "classification":
            head = functional.binary_cross_entropy_with_logits(outputs, targets)
        else:
            head = functional.huber_loss(outputs, targets, delta=1.0)
        return margin.sum(1).mean() + head


# ─── Slot attention ────────────────────────────────────────────────────────


class SlotAttentionNetwork(WindowBackbone):
    """Bars of the window become tokens (a per-bar two-layer perceptron plus a learned position
    counted back from the newest bar); ``slot_count`` slots, started from learned vectors, are
    refined for ``iteration_count`` rounds of slot attention: the softmax runs over the SLOTS, so
    slots compete for bars, then each slot takes the attention-weighted mean of its bars' values and
    is updated by a gated recurrent cell plus a residual perceptron. The slots are read out by a
    permutation-invariant pool (their mean beside a learned attention pool) into the head. A
    spatial-broadcast decoder reconstructs the window's features from the slots with competing
    masks; its error, times ``reconstruction_weight``, is added to the loss (``auxiliary_loss``)."""

    backbone = "slot_attention"

    def __init__(self, feature_count: int, sequence_length: int, model_dimension: int, slot_count: int,
                 iteration_count: int, reconstruction_weight: float, dropout: float):
        super().__init__(feature_count)
        dimension = int(model_dimension)
        self.sequence_length = int(sequence_length)
        self.dimension = dimension
        self.iteration_count = int(iteration_count)
        self.reconstruction_weight = float(reconstruction_weight)
        self.encoder = nn.Sequential(nn.Linear(self.input_count, dimension), nn.ReLU(), nn.Linear(dimension, dimension))
        self.position = nn.Parameter(0.02 * torch.randn(1, self.sequence_length, dimension))
        self.input_norm = nn.LayerNorm(dimension)
        self.slots = nn.Parameter(0.5 * torch.randn(1, int(slot_count), dimension))
        self.slot_norm = nn.LayerNorm(dimension)
        self.query = nn.Linear(dimension, dimension, bias=False)
        self.key = nn.Linear(dimension, dimension, bias=False)
        self.value = nn.Linear(dimension, dimension, bias=False)
        self.update = nn.GRUCell(dimension, dimension)
        self.update_norm = nn.LayerNorm(dimension)
        self.update_perceptron = nn.Sequential(nn.Linear(dimension, 2 * dimension), nn.ReLU(),
                                               nn.Linear(2 * dimension, dimension))
        self.pool_query = nn.Parameter(0.1 * torch.randn(dimension))
        self.decoder = nn.Sequential(nn.Linear(dimension, dimension), nn.ReLU(), nn.Linear(dimension, self.input_count + 1))
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(2 * dimension, 1)
        self._reconstruction_error: torch.Tensor | None = None

    def _run(self, window, record):
        features, _ = self.split(window)
        batch, length, _ = features.shape
        if length > self.sequence_length:
            raise ValueError(
                f"window_backbone slot_attention: built for windows of at most {self.sequence_length} bars, got {length}"
            )
        positions = self.position[:, self.sequence_length - length:]
        tokens = self.input_norm(self.encoder(features) + positions)
        _record(record, "Bar tokens", "embedding", tokens)
        keys, values = self.key(tokens), self.value(tokens)
        slots = self.slots.expand(batch, -1, -1)
        scale = self.dimension ** -0.5
        attention = None
        for iteration in range(1, self.iteration_count + 1):
            previous = slots
            queries = self.query(self.slot_norm(slots))
            scores = torch.einsum("btd,bkd->btk", keys, queries) * scale
            attention = torch.softmax(scores, dim=-1) + 1e-8                   # slots compete for every bar
            weights = attention / attention.sum(dim=1, keepdim=True)          # mean over the bars each slot won
            updates = torch.einsum("btk,btd->bkd", weights, values)
            slots = self.update(updates.reshape(-1, self.dimension), previous.reshape(-1, self.dimension))
            slots = slots.reshape(batch, -1, self.dimension)
            slots = slots + self.update_perceptron(self.update_norm(slots))
            _record(record, f"Slots after iteration {iteration}", "slots", slots)
        _record(record, "Slot attention over bars, last iteration (slots x bars)", "attention_weights",
                attention.transpose(1, 2))
        if self.training and self.reconstruction_weight > 0:
            decoded = self.decoder(slots.unsqueeze(2) + positions.unsqueeze(1))   # (batch, slots, time, features + 1)
            masks = torch.softmax(decoded[..., -1], dim=1)
            rebuilt = (masks.unsqueeze(-1) * decoded[..., :-1]).sum(1)
            self._reconstruction_error = functional.mse_loss(rebuilt.float(), features.float())
        pool = torch.softmax(slots @ self.pool_query, dim=1)
        readout = torch.cat([slots.mean(1), (pool.unsqueeze(-1) * slots).sum(1)], dim=-1)
        _record(record, "Slot readout (mean and attention pool)", "pooling", readout)
        return self.head(self.dropout(readout)).squeeze(-1)

    def auxiliary_loss(self) -> torch.Tensor | None:
        error, self._reconstruction_error = self._reconstruction_error, None
        return None if error is None else self.reconstruction_weight * error


# ─── Spiking network ───────────────────────────────────────────────────────


class ArctangentSpike(torch.autograd.Function):
    """Heaviside step on the forward pass; on the backward pass the derivative of the arctangent
    step (1/pi) arctan(pi/2 * slope * x) + 1/2, i.e. (slope / 2) / (1 + (pi/2 * slope * x)^2)."""

    @staticmethod
    def forward(context, distance: torch.Tensor, slope: float) -> torch.Tensor:
        context.save_for_backward(distance)
        context.slope = slope
        return (distance > 0).to(distance.dtype)

    @staticmethod
    def backward(context, gradient: torch.Tensor):
        (distance,) = context.saved_tensors
        slope = context.slope
        surrogate = (slope / 2.0) / (1.0 + (math.pi / 2.0 * slope * distance) ** 2)
        return gradient * surrogate, None


class SpikingNetwork(WindowBackbone):
    """Leaky integrate-and-fire layers unrolled over the window's bars as simulation steps:
    U[t] = decay * U[t-1] + I[t] - threshold * S[t-1] (reset by subtraction, the reset path
    detached), S[t] = step(U[t] - threshold), trained through the arctangent surrogate gradient.
    The first layer's current is the bar's features through a linear map (direct current input,
    no random spike coding, so a bar is reproducible). The readout integrates the last layer's
    spikes leakily without spiking; its value at the newest bar feeds the head. A firing-rate
    penalty keeps mean activity near ``target_firing_rate`` (``auxiliary_loss``)."""

    backbone = "spiking"

    def __init__(self, feature_count: int, hidden_size: int, layer_count: int, membrane_decay: float,
                 spike_threshold: float, surrogate_slope: float, firing_rate_weight: float,
                 target_firing_rate: float, dropout: float):
        super().__init__(feature_count)
        if not 0.0 < membrane_decay < 1.0:
            raise ValueError(f"window_backbone spiking: membrane_decay must be in (0, 1), got {membrane_decay}")
        if spike_threshold <= 0:
            raise ValueError(f"window_backbone spiking: spike_threshold must be positive, got {spike_threshold}")
        self.currents = nn.ModuleList(
            nn.Linear(self.input_count if layer == 0 else hidden_size, hidden_size) for layer in range(layer_count)
        )
        self.membrane_decay = float(membrane_decay)
        self.spike_threshold = float(spike_threshold)
        self.surrogate_slope = float(surrogate_slope)
        self.firing_rate_weight = float(firing_rate_weight)
        self.target_firing_rate = float(target_firing_rate)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)
        self._firing_rate: torch.Tensor | None = None

    def _run(self, window, record):
        features, _ = self.split(window)
        inputs = self.dropout(features)                                      # dropout on the input current
        rates = []
        for number, current_layer in enumerate(self.currents, 1):
            currents = current_layer(inputs)                                 # (batch, time, hidden)
            membrane = torch.zeros_like(currents[:, 0])
            spikes = torch.zeros_like(currents[:, 0])
            trains = []
            for step in range(currents.shape[1]):
                membrane = self.membrane_decay * membrane + currents[:, step] - self.spike_threshold * spikes.detach()
                spikes = ArctangentSpike.apply(membrane - self.spike_threshold, self.surrogate_slope)
                trains.append(spikes)
            inputs = torch.stack(trains, dim=1)
            rates.append(inputs.mean())
            _record(record, f"Spikes, leaky integrate-and-fire layer {number}", "spikes", inputs)
        readout = torch.zeros_like(inputs[:, 0])
        for step in range(inputs.shape[1]):
            readout = self.membrane_decay * readout + inputs[:, step]
        if self.training:
            self._firing_rate = torch.stack(rates).mean()
        _record(record, "Leaky readout of the last layer's spikes at the newest bar", "membrane", readout)
        return self.head(readout).squeeze(-1)

    def auxiliary_loss(self) -> torch.Tensor | None:
        rate, self._firing_rate = self._firing_rate, None
        if rate is None or self.firing_rate_weight <= 0:
            return None
        return self.firing_rate_weight * (rate.float() - self.target_firing_rate) ** 2


# ─── Neural ODE ────────────────────────────────────────────────────────────


class _Dynamics(nn.Module):
    """dh/ds = step x f(h) with f(h) = tanh(W2 tanh(W1 h + b1) + b2): the hidden state's velocity
    in typical-bar time, integrated over s in [0, 1] and stretched per window by its time step."""

    def __init__(self, hidden_size: int, dynamics_hidden_size: int):
        super().__init__()
        self.first = nn.Linear(hidden_size, dynamics_hidden_size)
        self.second = nn.Linear(dynamics_hidden_size, hidden_size)
        self.step: torch.Tensor | None = None                    # (batch, 1), set before every solve

    def forward(self, time: torch.Tensor, hidden: torch.Tensor) -> torch.Tensor:
        return self.step * torch.tanh(self.second(torch.tanh(self.first(hidden))))


class NeuralOrdinaryDifferentialEquation(WindowBackbone):
    """ODE-RNN over the window (Rubanova et al. 2019): between two bars the hidden state evolves
    continuously under dh/dt = f(h), integrated by torchdiffeq's fixed-step solver over the time
    step between the bars (the time-step channel, in typical-bar units on a log2 scale, so a session
    gap is a longer integration); at each bar a gated recurrent cell absorbs that bar's features.
    The state after the newest bar feeds the head."""

    backbone = "neural_ode"
    reads_time_steps = True

    def __init__(self, feature_count: int, hidden_size: int, dynamics_hidden_size: int, integration_method: str,
                 solver_steps: int, dropout: float):
        super().__init__(feature_count)
        if integration_method not in INTEGRATION_METHODS:
            raise ValueError(
                f"window_backbone neural_ode: integration_method must be one of {INTEGRATION_METHODS}, got {integration_method!r}"
            )
        self.hidden_size = int(hidden_size)
        self.integration_method = integration_method
        self.solver_steps = int(solver_steps)
        self.dynamics = _Dynamics(hidden_size, dynamics_hidden_size)
        self.cell = nn.GRUCell(self.input_count, hidden_size)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)
        self.register_buffer("unit_interval", torch.tensor([0.0, 1.0]), persistent=False)

    def _evolve(self, hidden: torch.Tensor, step: torch.Tensor) -> torch.Tensor:
        """Integrate the hidden state over one time step, in float32 (outside automatic mixed
        precision: the solver's grid and the state stay full precision on the GPU)."""
        from torchdiffeq import odeint

        dtype = torch.float64 if hidden.dtype == torch.float64 else torch.float32
        with torch.autocast(device_type=hidden.device.type, enabled=False):
            hidden = hidden.to(dtype)
            self.dynamics.step = step.to(dtype).clamp(min=0.0).unsqueeze(-1)
            try:
                path = odeint(self.dynamics, hidden, self.unit_interval.to(dtype), method=self.integration_method,
                              options={"step_size": 1.0 / self.solver_steps})
            finally:
                self.dynamics.step = None
        return path[-1]

    def _states(self, window: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        features, steps = self.split(window)
        hidden = torch.zeros(features.shape[0], self.hidden_size, dtype=features.dtype, device=features.device)
        states = []
        for position in range(features.shape[1]):
            if position > 0:
                hidden = self._evolve(hidden, steps[:, position])
            hidden = self.cell(features[:, position], hidden)
            states.append(hidden)
        return torch.stack(states, dim=1), steps

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        """The hidden state right after each bar, (batch, time, hidden_size)."""
        return self._states(window)[0]

    def _run(self, window, record):
        states, steps = self._states(window)
        _record(record, "Time step from the previous bar (typical bars, log2 scale)", "time_step", steps)
        _record(record, "Hidden state after each bar (evolved by the ODE, then updated by the bar)", "ode_state", states)
        return self.head(self.dropout(states[:, -1])).squeeze(-1)


# ─── build / trace ─────────────────────────────────────────────────────────


def _whole(parameters: dict, name: str, minimum: int = 1) -> int:
    value = float(parameters[name])
    if not value.is_integer() or int(value) < minimum:
        raise ValueError(f"window_backbone: {name} must be a whole number of at least {minimum}, got {parameters[name]!r}")
    return int(value)


def build(parameters: dict, feature_count: int) -> WindowBackbone:
    """The backbone named by ``parameters["backbone"]`` for one resolved parameter set
    (``feature_count`` counts the time-step channel)."""
    backbone = parameters.get("backbone")
    if backbone not in BACKBONES:
        raise ValueError(f"window_backbone: backbone must be one of {BACKBONES}, got {backbone!r}")
    missing = [name for name in ("sequence_length", *REQUIRED_PARAMETERS[backbone]) if name not in parameters]
    if missing:
        raise ValueError(f"window_backbone {backbone}: missing parameters {missing}")
    p = parameters
    dropout = float(p["dropout"])
    if not 0.0 <= dropout < 1.0:
        raise ValueError(f"window_backbone: dropout must be in [0, 1), got {dropout!r}")
    length = _whole(p, "sequence_length", 2)
    feature_count = int(feature_count)
    if backbone == "resnet":
        return ResidualNetwork(feature_count, length, _whole(p, "base_channel_count"), _whole(p, "stage_count"),
                               _whole(p, "residual_block_count"), _whole(p, "kernel_size"), dropout)
    if backbone == "densenet":
        return DenselyConnectedNetwork(feature_count, length, _whole(p, "base_channel_count"),
                                       _whole(p, "dense_block_count"), _whole(p, "layers_per_block"),
                                       _whole(p, "growth_rate"), float(p["compression_factor"]),
                                       _whole(p, "kernel_size"), dropout)
    if backbone == "unet":
        return UNetwork(feature_count, length, _whole(p, "base_channel_count"), _whole(p, "level_count"),
                        _whole(p, "kernel_size"), dropout)
    if backbone == "vision_transformer":
        return VisionTransformer(feature_count, length, _whole(p, "patch_bars"), _whole(p, "model_dimension"),
                                 _whole(p, "head_count"), _whole(p, "layer_count"), dropout)
    if backbone == "capsule":
        return CapsuleNetwork(feature_count, length, _whole(p, "channel_count"), _whole(p, "kernel_size"),
                              _whole(p, "convolution_layer_count"), _whole(p, "primary_capsule_count"),
                              _whole(p, "primary_capsule_size"), _whole(p, "class_capsule_size"),
                              _whole(p, "iteration_count"), float(p["upper_margin"]), float(p["lower_margin"]),
                              float(p["absent_class_weight"]), dropout)
    if backbone == "slot_attention":
        return SlotAttentionNetwork(feature_count, length, _whole(p, "model_dimension"), _whole(p, "slot_count"),
                                    _whole(p, "iteration_count"), float(p["reconstruction_weight"]), dropout)
    if backbone == "spiking":
        return SpikingNetwork(feature_count, _whole(p, "hidden_size"), _whole(p, "layer_count"),
                              float(p["membrane_decay"]), float(p["spike_threshold"]), float(p["surrogate_slope"]),
                              float(p["firing_rate_weight"]), float(p["target_firing_rate"]), dropout)
    return NeuralOrdinaryDifferentialEquation(feature_count, _whole(p, "hidden_size"),
                                              _whole(p, "dynamics_hidden_size"), str(p["integration_method"]),
                                              _whole(p, "solver_steps"), dropout)


def _networks():
    # Lazy: cycle.networks imports this module while it is itself loading.
    from .. import networks

    return networks


def trace(network: WindowBackbone, window: torch.Tensor) -> dict:
    """Run ``network`` once on ``window`` (a batch of one, eval mode) through the same tensor path
    ``forward`` uses and record every stage for batch row 0:

        {"layers": [{"name", "kind", "shape", "values"}], "attention": [], "logit": float}

    Maps over the window are [time, units] (oldest bar first); the last layer is the head's input
    (a vector, or a map whose last row is). It runs the float64 scoring copy, as prediction does.
    Attention weights (vision transformer, slot attention)
    are recorded as layers of kind ``attention_weights``."""
    if network.training:
        raise RuntimeError("trace needs the network in eval mode")
    networks = _networks()
    record: list = []
    scoring = network.scoring_network() if window.dtype != torch.float64 else network
    with torch.no_grad():
        logit = float(scoring._run(window.double(), record).reshape(-1)[0].item())
    layers = [networks._layer(name, kind, tensor) for name, kind, tensor in record]
    return {"layers": layers, "attention": [], "logit": logit}


def describe(network: WindowBackbone, sequence_length: int = 1) -> list[dict]:
    """The layers ``trace`` records, without values (from a trace of an all-zero window)."""
    was_training = network.training
    network.eval()
    try:
        device = next(network.parameters()).device
        zeros = torch.zeros(1, int(sequence_length), network.feature_count, device=device)
        traced = trace(network, zeros)
    finally:
        network.train(was_training)
    return [{"name": layer["name"], "kind": layer["kind"], "outputShape": layer["shape"]} for layer in traced["layers"]]


__all__ = [
    "ATTENTION", "BACKBONES", "INTEGRATION_METHODS", "SEQUENCE", "ArctangentSpike", "CapsuleNetwork",
    "DenselyConnectedNetwork", "NeuralOrdinaryDifferentialEquation", "ResidualNetwork", "SlotAttentionNetwork",
    "SpikingNetwork", "UNetwork", "VisionTransformer", "WindowBackbone", "build", "causal_upsample", "describe",
    "extra_channels", "keep_last_of_pairs", "pool_pairs", "squash", "time_step_channel", "trace",
]
