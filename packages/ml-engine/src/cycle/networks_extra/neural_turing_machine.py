"""Neural Turing machine (Graves, Wayne and Danihelka 2014) as a Model Cycle
network kind (``network: "neural_turing_machine"``).

Catalog spec: ``neural-network-architectures-memory-routing-architectures-neural-turing-machine``.
Trained, saved, loaded and traced by ``cycle.networks.NeuralAdapter`` like every
other kind; registered through ``networks.NETWORK_EXTENSION_MODULES``.

What the spec says, and what is built here
------------------------------------------
A controller network steps through the window of ``sequence_length`` bars and,
at every bar, reads from and writes to an external memory matrix through soft,
differentiable addressing; the prediction head reads the controller's last
state together with what was last read from memory.

* **Memory** ``M`` (``memory_slots x memory_width``). Reset at the start of
  every window to a learned initial matrix, initialised to small values (uniform
  in +-1 / sqrt(slots + width)) and reset per forward pass. A memory reset to
  ONE constant would make every slot identical, and content addressing (which
  compares the key with each slot) could then never tell the slots apart, so the
  write of every step would spread evenly over all of them for the whole window;
  a per-slot initial state is what lets the addressing focus.
* **Controller**: a gated recurrent unit cell (``controller_hidden_size``) that
  reads, at bar ``t``, the bar's features concatenated with the read vectors of
  bar ``t - 1`` (zeros before the first bar).
* **Content-based addressing** (the spec's ``w^c``): a head emits a key ``k``
  and a key strength ``beta = softplus(.)``; the weighting over the slots is
  ``softmax(beta * cosine(k, M_i))``, the cosine similarity divided by the
  product of the norms clamped to at least 1e-8, and the softmax taken in
  float32.
* **Write** (one write head, applied BEFORE the read at each bar, as the spec's
  equations are indexed): erase vector ``e = sigmoid(.)`` in [0, 1], add vector
  ``a`` unconstrained; ``M_i <- M_i * (1 - w_i e) + w_i a``.
* **Read** (``read_head_count`` heads): ``r_h = sum_i w_h(i) M_i`` from the
  updated memory; the reads are concatenated.
* **Head**: ``Linear(controller_hidden_size + read_head_count * memory_width, 1)``
  on dropout of the LAST bar's ``[controller state, read vectors]``.

``forward(window)`` -> ``(batch,)`` raw head output (log-odds of up for the
direction model, the target itself for the price model), the convention every
kind follows. ``sequence_output(window)`` is the per-bar ``[controller state,
read vectors]`` (batch, time, units): position ``k`` depends on bars ``<= k``
only, because the loop reads bar ``t`` at step ``t`` and nothing else. The whole
pass runs in float32 even under mixed precision: the addressing softmax and the
erase / add update are the delicate part and half precision is not worth the
risk at these sizes.

``trace`` runs the same pass once for one bar and records, oldest bar first:

    Controller state                         [time, controller_hidden_size]
    Memory write weights                     [time, memory_slots]      the write head's addressing per bar
    Memory read weights (head 1..H)          [time, memory_slots]      one layer per read head
    Memory read vectors                      [time, read_head_count * memory_width]
    Controller state with memory reads       [controller_hidden_size + read_head_count * memory_width]

The last layer is exactly the head's input, so the explainer's gate G4
(``apply_head(head_input(trace)) == logit``) holds. The ``attention`` block is
empty: the read weights run over memory SLOTS, not over the window's bars, and
the Inside view's attention chart labels every weight with a bar of the window,
so slot 3 would read as the third bar. "Which stored slots the model consulted"
is the last row of each ``Memory read weights`` grid, drawn as a heatmap with
bars as columns and slots as rows.

Simplifications versus the spec, plainly: addressing is content-based ONLY —
the interpolation gate, the convolutional location shift and the sharpening
exponent of Graves et al. are omitted, so a head cannot step to a neighbouring
slot or iterate through stored entries in order; one write head (the spec allows
1-2); the controller is a gated recurrent unit cell rather than an LSTM cell;
the memory's final contents are not part of the trace (a slots x width grid
would read as time x units in the Inside view); the defaults (16 slots of width
16, a 64-unit controller, 32 bars) sit below the spec's ranges (32-256 slots,
16-128 width, 64-512 units) because the bar-by-bar loop cannot be fused and the
Cycle replays on the CPU as well as the GPU — the bounds allow the spec's
ranges; the loss is the Cycle's (weighted binary cross-entropy or Huber), not
the spec's cross-entropy / mean squared error; and the DNC / least-recently-used
/ sparse-access variants are not built.
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as functional
from torch import nn

SEQUENCE = True
ATTENTION = False   # the read weights run over memory slots, not bars (see the docstring)

_SIMILARITY_EPSILON = 1e-8

READ_WEIGHTS_NAME = "Memory read weights (head {head})"


class NeuralTuringMachineModule(nn.Module):
    """See the module docstring. Input (batch, time, features); output (batch,)."""

    def __init__(self, feature_count: int, controller_hidden_size: int, memory_slots: int, memory_width: int,
                 read_head_count: int, dropout: float) -> None:
        super().__init__()
        if int(feature_count) < 1:
            raise ValueError(f"feature_count must be at least 1, got {feature_count}")
        for name, value in (("controller_hidden_size", controller_hidden_size), ("memory_slots", memory_slots),
                            ("memory_width", memory_width), ("read_head_count", read_head_count)):
            if int(value) < 1:
                raise ValueError(f"{name} must be at least 1, got {value}")
        self.feature_count = int(feature_count)
        self.controller_hidden_size = int(controller_hidden_size)
        self.memory_slots = int(memory_slots)
        self.memory_width = int(memory_width)
        self.read_head_count = int(read_head_count)
        self.read_width = self.read_head_count * self.memory_width
        self.controller = nn.GRUCell(self.feature_count + self.read_width, self.controller_hidden_size)
        # the write head's parameters per bar: key (W), key strength (1), erase (W), add (W)
        self.write_head = nn.Linear(self.controller_hidden_size, 3 * self.memory_width + 1)
        # every read head's parameters per bar: key (W) and key strength (1)
        self.read_heads = nn.Linear(self.controller_hidden_size, self.read_head_count * (self.memory_width + 1))
        self.initial_memory = nn.Parameter(torch.empty(self.memory_slots, self.memory_width))
        bound = 1.0 / math.sqrt(self.memory_slots + self.memory_width)
        nn.init.uniform_(self.initial_memory, -bound, bound)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(self.controller_hidden_size + self.read_width, 1)

    @staticmethod
    def address(memory: torch.Tensor, key: torch.Tensor, strength: torch.Tensor) -> torch.Tensor:
        """Content-based addressing: ``softmax(softplus(strength) * cosine(key, M_i))``
        over the slots. ``memory`` (batch, slots, width); ``key`` (batch, heads, width);
        ``strength`` (batch, heads, 1) -> weights (batch, heads, slots), each row
        summing to 1."""
        similarity = torch.einsum("bhw,bnw->bhn", key, memory)
        norms = key.norm(dim=-1).unsqueeze(-1) * memory.norm(dim=-1).unsqueeze(1)
        cosine = similarity / norms.clamp_min(_SIMILARITY_EPSILON)
        return torch.softmax(functional.softplus(strength) * cosine, dim=-1)

    def run(self, window: torch.Tensor, record: bool = False) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
        """The whole pass: the raw head output (batch,) and, with ``record``, every
        intermediate ``trace`` reads (``sequence_output`` is always returned)."""
        if window.dim() != 3:
            raise ValueError(
                f"the neural Turing machine reads (batch, time, features) windows, got shape {tuple(window.shape)}"
            )
        with torch.autocast(device_type=window.device.type, enabled=False):
            window = window.float()
            batch, length, _ = window.shape
            width, head_count = self.memory_width, self.read_head_count
            memory = self.initial_memory.float().unsqueeze(0).expand(batch, -1, -1)
            reads = window.new_zeros(batch, self.read_width)
            hidden = window.new_zeros(batch, self.controller_hidden_size)
            outputs: list[torch.Tensor] = []
            states: list[torch.Tensor] = []
            read_vectors: list[torch.Tensor] = []
            read_weights: list[torch.Tensor] = []
            write_weights: list[torch.Tensor] = []
            for step in range(length):
                hidden = self.controller(torch.cat([window[:, step], reads], dim=-1), hidden)
                # write before read, as the spec's equations are indexed
                key, strength, erase, add = self.write_head(hidden).split([width, 1, width, width], dim=-1)
                write_weight = self.address(memory, key.unsqueeze(1), strength.unsqueeze(1)).squeeze(1)
                weight_column = write_weight.unsqueeze(-1)
                memory = memory * (1.0 - weight_column * torch.sigmoid(erase).unsqueeze(1)) \
                    + weight_column * add.unsqueeze(1)
                read_parameters = self.read_heads(hidden).view(batch, head_count, width + 1)
                read_weight = self.address(memory, read_parameters[..., :width], read_parameters[..., width:])
                reads = torch.bmm(read_weight, memory).reshape(batch, self.read_width)
                outputs.append(torch.cat([hidden, reads], dim=-1))
                if record:
                    states.append(hidden)
                    read_vectors.append(reads)
                    read_weights.append(read_weight)
                    write_weights.append(write_weight)
            sequence = torch.stack(outputs, dim=1)
            readout = sequence[:, -1]
            logit = self.head(self.dropout(readout)).squeeze(-1)
        recorded: dict[str, torch.Tensor] = {"sequence": sequence, "readout": readout}
        if record:
            recorded.update({
                "states": torch.stack(states, dim=1),
                "write_weights": torch.stack(write_weights, dim=1),
                "read_weights": torch.stack(read_weights, dim=1),   # (batch, time, heads, slots)
                "read_vectors": torch.stack(read_vectors, dim=1),
                "memory": memory,
            })
        return logit, recorded

    def sequence_output(self, window: torch.Tensor) -> torch.Tensor:
        """Per-bar ``[controller state, read vectors]`` (batch, time, units), causal in the window."""
        return self.run(window)[1]["sequence"]

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        return self.run(window)[0]


def build(parameters: dict, feature_count: int) -> nn.Module:
    """The network for a registry entry with ``network: "neural_turing_machine"``."""
    return NeuralTuringMachineModule(
        int(feature_count),
        int(parameters["controller_hidden_size"]),
        int(parameters["memory_slots"]),
        int(parameters["memory_width"]),
        int(parameters["read_head_count"]),
        float(parameters["dropout"]),
    )


def _layer(name: str, kind: str, tensor: torch.Tensor) -> dict:
    """One recorded layer for batch row 0 (the shape ``networks._layer`` writes)."""
    value = tensor.detach()[0].double().cpu()
    return {"name": name, "kind": kind, "shape": [int(size) for size in value.shape],
            "values": value.reshape(-1).tolist()}


def _layout(network: nn.Module, time: int) -> list[tuple[str, str, list[int]]]:
    """(name, kind, shape) of every traced layer, in order."""
    return [
        ("Controller state", "controller_gated_recurrent_unit", [time, network.controller_hidden_size]),
        ("Memory write weights", "memory_write_addressing", [time, network.memory_slots]),
        *[(READ_WEIGHTS_NAME.format(head=head + 1), "memory_read_addressing", [time, network.memory_slots])
          for head in range(network.read_head_count)],
        ("Memory read vectors", "memory_read", [time, network.read_width]),
        ("Controller state with memory reads", "readout", [network.controller_hidden_size + network.read_width]),
    ]


def layer_names(network: nn.Module) -> tuple[str, ...]:
    return tuple(name for name, _kind, _shape in _layout(network, 0))


def trace(network: nn.Module, window: torch.Tensor) -> dict:
    """``{"layers": [...], "attention": [], "logit": float}`` for a batch-of-one
    window (see the module docstring for the layers). The network must be in eval mode."""
    if network.training:
        raise RuntimeError("trace needs the network in eval mode")
    with torch.no_grad():
        logit, recorded = network.run(window, record=True)
    tensors = (recorded["states"], recorded["write_weights"],
               *[recorded["read_weights"][:, :, head] for head in range(network.read_head_count)],
               recorded["read_vectors"], recorded["readout"])
    layers = [_layer(name, kind, tensor)
              for (name, kind, _shape), tensor in zip(_layout(network, window.shape[1]), tensors)]
    return {"layers": layers, "attention": [], "logit": float(logit.reshape(-1)[0].item())}


def describe(network: nn.Module, sequence_length: int | None = None) -> list[dict]:
    """The traced layers without values: ``[{name, kind, outputShape}]``. The time
    axis is ``sequence_length`` when given, else left as 0 (the adapter's own
    ``describe`` traces a zero window of the right length instead)."""
    return [{"name": name, "kind": kind, "outputShape": shape}
            for name, kind, shape in _layout(network, int(sequence_length or 0))]


__all__ = ["ATTENTION", "READ_WEIGHTS_NAME", "SEQUENCE", "NeuralTuringMachineModule", "build", "describe",
           "layer_names", "trace"]
