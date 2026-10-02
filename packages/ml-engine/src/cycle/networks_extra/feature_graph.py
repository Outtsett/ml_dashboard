"""Feature-column graphs as a Model Cycle network kind (``network: "feature_graph"``).

Seven catalog specs run on this one kind; ``parameters["graph_layer"]`` picks
the mechanism (each registry entry fixes it to its own value):

    gcn                    Graph Convolutional Network (GCN)
    gat                    Graph Attention Network (GAT)
    message_passing        Graph Neural Network (GNN), learned messages
    graph_lstm             Graph-Augmented LSTM
    transformer_graph      Transformer-GNN Hybrid
    spatiotemporal         Spatiotemporal Fusion Network
    latent_decision_graph  Latent Attention Decision Graph

Trained, saved, loaded and traced by ``cycle.networks.NeuralAdapter`` like
every other kind; registered through ``networks.NETWORK_EXTENSION_MODULES``.

The graph a single instrument has
---------------------------------
The specs build their graph over instruments (currency pairs, index members).
A Model Cycle run holds ONE instrument, so the nodes here are the run's
FEATURE COLUMNS (the F columns of the engine's causal feature matrix) and the
edges are how strongly two columns move together on the TRAINING rows:

* ``prepare(features, train_index, view)`` (the NeuralAdapter hook, called once
  per fit after the network is built) reads ``features[train_index]`` and
  nothing else, computes the Pearson correlation of every pair of columns over
  the training rows whose values are all finite, keeps for every column its
  ``neighbor_count`` strongest partners by absolute correlation, and makes the
  result symmetric (an edge kept by either end is kept). Edge weights are the
  absolute correlations. The (F, F) matrix is the buffer ``adjacency``,
  registered at build with a fixed shape, so ``load_state_dict`` restores it
  and ``prepare`` is never re-run at load. Validation and test rows never
  enter it.
* The normalised adjacency of a graph convolution is
  ``A_hat = D^-1/2 (A + I) D^-1/2`` with ``D`` the row sums of ``A + I``
  (the self-loop keeps a node's own state), computed from the buffer in
  every forward, so a reloaded network uses exactly the saved graph.
* The neighbour mask of the attention and message-passing layers is
  ``A > 0`` (plus the node itself for attention).

Node attributes and readout. Unless the mechanism says otherwise, node i's
attribute vector is its own last ``sequence_length`` values (the window's
column i, oldest bar first), projected to ``hidden_size`` units, plus a learned
embedding of the node's identity (the layers share weights across nodes, so
without it every column would look alike). A graph-level readout joins the
mean over nodes, the maximum over nodes and a learned node-weighted sum, and
a dense layer turns that into the vector the head reads. ``forward(window)``
returns the raw head output (log-odds of up for the direction model, the
target itself for the price model), the convention every kind follows.

The mechanisms
--------------
``gcn``: ``H' = ReLU(A_hat H W)`` for ``layer_count`` layers (Kipf and Welling
2017), dropout between layers.

``gat``: per layer and head k, ``z = W_k h``,
``e_ij = LeakyReLU(a_k . [z_i || z_j])`` over the neighbours of i (and i),
``alpha_ij = softmax_j e_ij`` (dropout on alpha), ``h_i' = ELU(concat_k sum_j
alpha_ij z_j)`` (Velickovic et al. 2018); each head holds
``ceil(hidden_size / head_count)`` units.

``message_passing``: ``m_ij = MLP_message([h_i, h_j])`` for every neighbour j,
an order-free ``aggregation`` (mean, sum or max; a node with no neighbour
aggregates zero), ``h_i' = LayerNorm(h_i + MLP_update([h_i, m_i]))``
(Gilmer et al. 2017).

``graph_lstm``: one LSTM shared by every node runs along the window over the
node's own series (the node axis folded into the batch), its final state plus
the node's identity embedding is mixed over the graph by ``layer_count``
graph convolutions at the final step only (the spec's loose coupling).

``transformer_graph``: every (node, bar) pair is a token (the value projected
to ``model_dimension`` plus node and position embeddings); each hybrid layer is
``h = LayerNorm(h + GraphMessage(h) + CausalTemporalAttention(h))`` then
``h = LayerNorm(h + FFN(h))``, where the attention runs along each node's bars
with a causal mask and the graph message is ``A_hat h W`` across nodes at
every bar (the spec's interleaved local-plus-global layer). The readout reads
the last bar's node states.

``spatiotemporal``: a spatial branch runs ``layer_count`` graph convolutions on
the node values of EVERY bar of the window and reads each bar out to one
vector; a temporal LSTM runs along that sequence of spatial readouts; at the
last bar a learned logistic gate fuses the spatial readout and the LSTM state,
``s = g * h_spatial + (1 - g) * h_temporal`` (the spec's gated fusion).

``latent_decision_graph``: bars are projected to ``latent_dimension`` with
learned positions; ``latent_count`` learned latents cross-attend to the bars;
``message_passing_rounds`` rounds over the soft latent adjacency
``A = softmax(Q K^T / sqrt(d))`` update ``Z = LayerNorm(Z + MLP(A Z W))``; the
mean latent routes through a layered decision graph whose every node sends its
mass to every node of the next layer by a softmax gate at temperature tau
(``decision_depth`` routing steps, ``decision_width`` nodes per layer, so
nodes have several parents: a graph, not a tree). The head is the leaf
logits: ``logit = sum over leaves of mass * theta``. Training adds the
leaf-entropy penalty (``auxiliary_loss``: ``leaf_entropy_weight`` times the
gap between log(leaf count) and the entropy of the batch's mean leaf mass,
which stops the graph collapsing onto one leaf) and anneals tau
geometrically from ``temperature`` to ``final_temperature`` across the
epochs (``on_epoch``). Tau is a buffer, so the weights kept at the best epoch
keep the temperature they were scored with.

Every mechanism reads only the window it is given and the bar being
predicted is its last row: the per-node series, the LSTMs and the causal
temporal attention never read a later position, and the graph is fixed at
fit time from training rows. A missing value in a window (the engine never
hands one; a direct caller might) enters as 0, the z-scored mean.

Exact CPU inference: in eval mode on the CPU the forward runs through a
float64 copy of the network (``float64_copy``, rebuilt whenever a weight
changes), because float32 matrix products take a different kernel for one row
than for many and a bar predicted alone would otherwise differ from the same
bar in a batch in the last bit. Training, and inference on the GPU, stay in
float32 (automatic mixed precision on CUDA, as for every kind).

``trace`` records every hidden layer for one bar (graph attention and latent
adjacency matrices included as layers); the last layer is exactly the head's
input, so ``apply_head(head_input(trace)) == logit`` holds. ``ATTENTION`` is
False: the trace's time-axis attention list stays empty, because the
attention here is over nodes or latents, not bars.
"""

from __future__ import annotations

import math

import numpy as np
import torch
import torch.nn.functional as functional
from torch import nn

SEQUENCE = True
ATTENTION = False

GRAPH_LAYERS = ("gcn", "gat", "message_passing", "graph_lstm", "transformer_graph", "spatiotemporal",
                "latent_decision_graph")
AGGREGATIONS = ("mean", "sum", "max")


# ─── the train-span correlation graph ──────────────────────────────────────


def correlation_graph(features: np.ndarray, train_index: np.ndarray, neighbor_count: int) -> np.ndarray:
    """(F, F) float32 symmetric adjacency from the training rows only.

    Pearson correlation of every pair of columns over ``features[train_index]``
    rows that are finite in every column; each column keeps its
    ``neighbor_count`` strongest partners by absolute correlation (ties broken
    by column order), weight = absolute correlation; an edge kept by either end
    is kept (``max(A, A^T)``). A constant column has no edges. No self-loops."""
    features = np.asarray(features)
    column_count = int(features.shape[1])
    adjacency = np.zeros((column_count, column_count), dtype=np.float64)
    train_index = np.asarray(train_index, dtype=np.int64)
    if column_count < 2 or train_index.size == 0:
        return adjacency.astype(np.float32)
    rows = np.asarray(features[train_index], dtype=np.float64)
    rows = rows[np.all(np.isfinite(rows), axis=1)]
    if rows.shape[0] < 3:
        return adjacency.astype(np.float32)
    centred = rows - rows.mean(axis=0)
    spread = np.sqrt(np.sum(centred ** 2, axis=0))
    usable = spread > 1e-12
    standardised = np.zeros_like(centred)
    standardised[:, usable] = centred[:, usable] / spread[usable]
    strength = np.abs(standardised.T @ standardised)
    strength[~usable, :] = 0.0
    strength[:, ~usable] = 0.0
    np.fill_diagonal(strength, 0.0)
    keep = max(0, min(int(neighbor_count), column_count - 1))
    for node in range(column_count):
        if keep == 0:
            break
        order = np.argsort(-strength[node], kind="stable")[:keep]
        order = order[strength[node, order] > 0.0]
        adjacency[node, order] = strength[node, order]
    adjacency = np.maximum(adjacency, adjacency.T)
    return adjacency.astype(np.float32)


def normalised_adjacency(adjacency: torch.Tensor) -> torch.Tensor:
    """D^-1/2 (A + I) D^-1/2, D the row sums of A + I."""
    with_loops = adjacency + torch.eye(adjacency.shape[0], dtype=adjacency.dtype, device=adjacency.device)
    inverse_root = with_loops.sum(dim=1).rsqrt()
    return inverse_root[:, None] * with_loops * inverse_root[None, :]


# ─── shared blocks ─────────────────────────────────────────────────────────


class NodeReadout(nn.Module):
    """Graph-level readout: [mean over nodes, max over nodes, learned node-weighted
    sum] -> Linear -> GELU -> Dropout. Input (batch, nodes, width); output (batch, out)."""

    def __init__(self, node_count: int, width: int, out_width: int, dropout: float) -> None:
        super().__init__()
        self.node_weights = nn.Parameter(torch.full((node_count,), 1.0 / max(node_count, 1)))
        self.dense = nn.Linear(3 * width, out_width)
        self.dropout = nn.Dropout(dropout)

    def forward(self, nodes: torch.Tensor) -> torch.Tensor:
        pooled = torch.cat([
            nodes.mean(dim=1),
            nodes.max(dim=1).values,
            torch.einsum("n,bnh->bh", self.node_weights, nodes),
        ], dim=-1)
        return self.dropout(functional.gelu(self.dense(pooled)))


class GraphConvolutionLayer(nn.Module):
    """H' = ReLU(A_hat H W)."""

    def __init__(self, in_width: int, out_width: int) -> None:
        super().__init__()
        self.linear = nn.Linear(in_width, out_width)

    def forward(self, nodes: torch.Tensor, adjacency_hat: torch.Tensor) -> torch.Tensor:
        return functional.relu(self.linear(torch.einsum("ij,...jh->...ih", adjacency_hat, nodes)))


class GraphAttentionLayer(nn.Module):
    """Multi-head graph attention over a neighbour mask; heads concatenated, ELU.
    ``forward`` returns (nodes', attention (batch, heads, nodes, nodes))."""

    def __init__(self, in_width: int, head_count: int, head_width: int, dropout: float) -> None:
        super().__init__()
        self.head_count = int(head_count)
        self.head_width = int(head_width)
        self.project = nn.Linear(in_width, self.head_count * self.head_width, bias=False)
        self.source_score = nn.Parameter(torch.empty(self.head_count, self.head_width))
        self.target_score = nn.Parameter(torch.empty(self.head_count, self.head_width))
        nn.init.xavier_uniform_(self.source_score)
        nn.init.xavier_uniform_(self.target_score)
        self.attention_dropout = nn.Dropout(dropout)

    def forward(self, nodes: torch.Tensor, mask: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        batch, node_count, _ = nodes.shape
        projected = self.project(nodes).view(batch, node_count, self.head_count, self.head_width)
        source = torch.einsum("bnkd,kd->bkn", projected, self.source_score)     # a . z_i
        target = torch.einsum("bnkd,kd->bkn", projected, self.target_score)     # a . z_j
        scores = functional.leaky_relu(source[..., :, None] + target[..., None, :], negative_slope=0.2)
        scores = scores.float().masked_fill(~mask, float("-inf"))
        attention = torch.softmax(scores, dim=-1)
        mixed = torch.einsum("bkij,bjkd->bikd", self.attention_dropout(attention).to(projected.dtype), projected)
        return functional.elu(mixed.reshape(batch, node_count, self.head_count * self.head_width)), attention


class MessagePassingLayer(nn.Module):
    """m_ij = MLP([h_i, h_j]) over neighbours, aggregated, h' = LayerNorm(h + MLP([h, m]))."""

    def __init__(self, width: int, aggregation: str, dropout: float) -> None:
        super().__init__()
        if aggregation not in AGGREGATIONS:
            raise ValueError(f"aggregation must be one of {AGGREGATIONS}, got {aggregation!r}")
        self.aggregation = aggregation
        self.message_receiver = nn.Linear(width, width)
        self.message_sender = nn.Linear(width, width, bias=False)
        self.message_out = nn.Linear(width, width)
        self.update_hidden = nn.Linear(2 * width, width)
        self.update_out = nn.Linear(width, width)
        self.dropout = nn.Dropout(dropout)
        self.norm = nn.LayerNorm(width)

    def forward(self, nodes: torch.Tensor, mask: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        # the first message layer on the concatenation [h_i, h_j] is W_r h_i + W_s h_j + b
        hidden = functional.gelu(self.message_receiver(nodes)[:, :, None, :] + self.message_sender(nodes)[:, None, :, :])
        messages = self.message_out(hidden)                                    # (batch, receiver i, sender j, width)
        weight = mask.to(messages.dtype)[None, :, :, None]
        if self.aggregation == "max":
            aggregated = messages.masked_fill(~mask[None, :, :, None], float("-inf")).amax(dim=2)
            aggregated = torch.where(mask.any(dim=1)[None, :, None], aggregated, torch.zeros_like(aggregated))
        else:
            aggregated = (messages * weight).sum(dim=2)
            if self.aggregation == "mean":
                aggregated = aggregated / mask.sum(dim=1).clamp(min=1).to(messages.dtype)[None, :, None]
        update = self.update_out(self.dropout(functional.gelu(self.update_hidden(torch.cat([nodes, aggregated], dim=-1)))))
        return self.norm(nodes + update), aggregated


# ─── the network ───────────────────────────────────────────────────────────


class FeatureGraphNetwork(nn.Module):
    """See the module docstring. Input (batch, time, features); output (batch,)."""

    def __init__(self, parameters: dict, feature_count: int) -> None:
        super().__init__()
        layer = str(parameters["graph_layer"])
        if layer not in GRAPH_LAYERS:
            raise ValueError(f"graph_layer must be one of {GRAPH_LAYERS}, got {layer!r}")
        self.graph_layer = layer
        self.feature_count = int(feature_count)
        self.sequence_length = int(parameters["sequence_length"])
        if self.feature_count < 1 or self.sequence_length < 1:
            raise ValueError(f"feature_count and sequence_length must be at least 1, got {feature_count}, "
                             f"{self.sequence_length}")
        self.neighbor_count = int(parameters.get("neighbor_count", 0))
        self.dropout_rate = float(parameters["dropout"])
        nodes = self.feature_count
        # the train-span correlation graph: filled by prepare, restored by load_state_dict
        self.register_buffer("adjacency", torch.zeros(nodes, nodes))
        getattr(self, f"_build_{layer}")(parameters)

    # ── construction per mechanism ──

    def _node_encoder(self, width: int) -> None:
        self.node_projection = nn.Linear(self.sequence_length, width)
        self.node_identity = nn.Parameter(torch.randn(self.feature_count, width) * 0.1)
        self.input_dropout = nn.Dropout(self.dropout_rate)

    def _readout_and_head(self, width: int, out_width: int) -> None:
        self.readout = NodeReadout(self.feature_count, width, out_width, self.dropout_rate)
        self.head = nn.Linear(out_width, 1)

    def _build_gcn(self, p: dict) -> None:
        hidden = int(p["hidden_size"])
        self._node_encoder(hidden)
        self.graph_layers = nn.ModuleList([GraphConvolutionLayer(hidden, hidden) for _ in range(int(p["layer_count"]))])
        self.layer_dropout = nn.Dropout(self.dropout_rate)
        self._readout_and_head(hidden, hidden)

    def _build_gat(self, p: dict) -> None:
        hidden = int(p["hidden_size"])
        heads = int(p["head_count"])
        head_width = int(math.ceil(hidden / heads))
        self.head_count = heads
        self.graph_width = heads * head_width
        self._node_encoder(hidden)
        layers = []
        width = hidden
        for _ in range(int(p["layer_count"])):
            layers.append(GraphAttentionLayer(width, heads, head_width, self.dropout_rate))
            width = self.graph_width
        self.graph_layers = nn.ModuleList(layers)
        self.layer_dropout = nn.Dropout(self.dropout_rate)
        self._readout_and_head(width, hidden)

    def _build_message_passing(self, p: dict) -> None:
        hidden = int(p["hidden_size"])
        self.aggregation = str(p["aggregation"])
        self._node_encoder(hidden)
        self.graph_layers = nn.ModuleList([MessagePassingLayer(hidden, self.aggregation, self.dropout_rate)
                                           for _ in range(int(p["layer_count"]))])
        self._readout_and_head(hidden, hidden)

    def _build_graph_lstm(self, p: dict) -> None:
        hidden = int(p["hidden_size"])
        self.node_recurrent = nn.LSTM(1, hidden, num_layers=1, batch_first=True)
        self.node_identity = nn.Parameter(torch.randn(self.feature_count, hidden) * 0.1)
        self.graph_layers = nn.ModuleList([GraphConvolutionLayer(hidden, hidden) for _ in range(int(p["layer_count"]))])
        self.layer_dropout = nn.Dropout(self.dropout_rate)
        self._readout_and_head(hidden, hidden)

    def _build_transformer_graph(self, p: dict) -> None:
        heads = int(p["head_count"])
        dimension = int(math.ceil(int(p["model_dimension"]) / heads) * heads)
        self.model_dimension = dimension
        self.value_projection = nn.Linear(1, dimension)
        self.node_identity = nn.Parameter(torch.randn(self.feature_count, dimension) * 0.02)
        self.position = nn.Parameter(torch.randn(self.sequence_length, dimension) * 0.02)
        self.temporal_attention = nn.ModuleList()
        self.graph_message = nn.ModuleList()
        self.mix_norm = nn.ModuleList()
        self.feedforward = nn.ModuleList()
        self.feedforward_norm = nn.ModuleList()
        for _ in range(int(p["layer_count"])):
            self.temporal_attention.append(nn.MultiheadAttention(dimension, heads, dropout=self.dropout_rate,
                                                                 batch_first=True))
            self.graph_message.append(nn.Linear(dimension, dimension))
            self.mix_norm.append(nn.LayerNorm(dimension))
            self.feedforward.append(nn.Sequential(nn.Linear(dimension, 2 * dimension), nn.GELU(),
                                                  nn.Dropout(self.dropout_rate), nn.Linear(2 * dimension, dimension)))
            self.feedforward_norm.append(nn.LayerNorm(dimension))
        self.layer_dropout = nn.Dropout(self.dropout_rate)
        self.register_buffer("causal_mask", torch.triu(torch.ones(self.sequence_length, self.sequence_length,
                                                                  dtype=torch.bool), diagonal=1), persistent=False)
        self._readout_and_head(dimension, dimension)

    def _build_spatiotemporal(self, p: dict) -> None:
        hidden = int(p["hidden_size"])
        self.value_projection = nn.Linear(1, hidden)
        self.node_identity = nn.Parameter(torch.randn(self.feature_count, hidden) * 0.1)
        self.graph_layers = nn.ModuleList([GraphConvolutionLayer(hidden, hidden) for _ in range(int(p["layer_count"]))])
        self.spatial_readout = NodeReadout(self.feature_count, hidden, hidden, 0.0)
        self.temporal_recurrent = nn.LSTM(hidden, hidden, num_layers=1, batch_first=True)
        self.fusion_gate = nn.Linear(2 * hidden, hidden)
        self.fusion_dropout = nn.Dropout(self.dropout_rate)
        self.head = nn.Linear(hidden, 1)

    def _build_latent_decision_graph(self, p: dict) -> None:
        heads = int(p["head_count"])
        dimension = int(math.ceil(int(p["latent_dimension"]) / heads) * heads)
        self.latent_dimension = dimension
        self.latent_count = int(p["latent_count"])
        self.round_count = int(p["message_passing_rounds"])
        self.decision_depth = int(p["decision_depth"])
        self.decision_width = int(p["decision_width"])
        self.leaf_entropy_weight = float(p["leaf_entropy_weight"])
        self.starting_temperature = float(p["temperature"])
        self.final_temperature = float(p["final_temperature"])
        if self.decision_depth < 1 or self.decision_width < 2:
            raise ValueError("decision_depth must be at least 1 and decision_width at least 2")
        if self.starting_temperature <= 0 or self.final_temperature <= 0:
            raise ValueError("temperature and final_temperature must be positive")
        self.bar_projection = nn.Linear(self.feature_count, dimension)
        self.position = nn.Parameter(torch.randn(self.sequence_length, dimension) * 0.02)
        self.latents = nn.Parameter(torch.randn(self.latent_count, dimension) * 0.02)
        self.cross_attention = nn.MultiheadAttention(dimension, heads, dropout=self.dropout_rate, batch_first=True)
        self.cross_norm = nn.LayerNorm(dimension)
        self.round_query = nn.ModuleList()
        self.round_key = nn.ModuleList()
        self.round_message = nn.ModuleList()
        self.round_mlp = nn.ModuleList()
        self.round_norm = nn.ModuleList()
        for _ in range(self.round_count):
            self.round_query.append(nn.Linear(dimension, dimension, bias=False))
            self.round_key.append(nn.Linear(dimension, dimension, bias=False))
            self.round_message.append(nn.Linear(dimension, dimension, bias=False))
            self.round_mlp.append(nn.Sequential(nn.Linear(dimension, 2 * dimension), nn.GELU(),
                                                nn.Dropout(self.dropout_rate), nn.Linear(2 * dimension, dimension)))
            self.round_norm.append(nn.LayerNorm(dimension))
        self.pooled_dropout = nn.Dropout(self.dropout_rate)
        gates = []
        widths = self.decision_widths()
        for level in range(self.decision_depth):
            gate = nn.Linear(dimension, widths[level] * widths[level + 1])
            nn.init.zeros_(gate.bias)                   # every leaf starts with comparable mass
            gates.append(gate)
        self.decision_gates = nn.ModuleList(gates)
        # the leaf logits theta: logit = sum over leaves of mass * theta
        self.head = nn.Linear(self.decision_width, 1, bias=False)
        nn.init.normal_(self.head.weight, std=0.1)
        self.register_buffer("routing_temperature", torch.tensor(self.starting_temperature))
        self._last_leaf_mass: torch.Tensor | None = None

    def decision_widths(self) -> list[int]:
        """Nodes per layer of the decision graph: the root, then decision_width per layer."""
        return [1] + [self.decision_width] * self.decision_depth

    # ── the NeuralAdapter hooks ──

    @torch.no_grad()
    def prepare(self, features, train_index, view=None) -> None:
        """Fill the adjacency buffer from the TRAINING rows only (``view`` unused)."""
        matrix = correlation_graph(np.asarray(features)[:, : self.feature_count], train_index, self.neighbor_count)
        self.adjacency.copy_(torch.from_numpy(matrix))

    def auxiliary_loss(self) -> torch.Tensor | None:
        """The leaf-entropy penalty of the last training forward (latent decision graph only)."""
        if self.graph_layer != "latent_decision_graph" or self.leaf_entropy_weight <= 0:
            return None
        mass = self._last_leaf_mass
        self._last_leaf_mass = None
        if mass is None:
            return None
        usage = mass.float().mean(dim=0).clamp_min(1e-12)
        entropy = -(usage * usage.log()).sum()
        return self.leaf_entropy_weight * (math.log(self.decision_width) - entropy)

    def on_epoch(self, epoch: int, epoch_count: int) -> None:
        """Anneal the routing temperature geometrically, start -> final across the epochs."""
        if self.graph_layer != "latent_decision_graph":
            return
        share = 0.0 if epoch_count <= 1 else (int(epoch) - 1) / (int(epoch_count) - 1)
        value = self.starting_temperature * (self.final_temperature / self.starting_temperature) ** share
        self.routing_temperature.fill_(value)

    # ── graph views ──

    def adjacency_hat(self) -> torch.Tensor:
        return normalised_adjacency(self.adjacency)

    def neighbour_mask(self, with_self: bool) -> torch.Tensor:
        mask = self.adjacency > 0
        if with_self:
            mask = mask | torch.eye(self.feature_count, dtype=torch.bool, device=mask.device)
        return mask

    # ── forward ──

    def _encode_nodes(self, window: torch.Tensor) -> torch.Tensor:
        """(batch, time, F) -> (batch, F, hidden): each node's own series, projected, plus its identity."""
        series = window.transpose(1, 2)[:, :, -self.sequence_length:]
        return self.input_dropout(functional.gelu(self.node_projection(series) + self.node_identity))

    def forward_detailed(self, window: torch.Tensor, record: bool = True) -> tuple[torch.Tensor, list]:
        """The forward pass and, when ``record``, every intermediate as (name, kind, tensor)."""
        if window.dim() != 3:
            raise ValueError(f"the feature graph reads (batch, time, features) windows, got shape {tuple(window.shape)}")
        window = torch.nan_to_num(window, nan=0.0)
        recorded: list = []
        head_input = getattr(self, f"_forward_{self.graph_layer}")(window, recorded if record else None)
        logit = self.head(head_input).squeeze(-1)
        return logit, recorded

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        if self.training or window.device.type != "cpu" or self._is_float64_copy:
            return self.forward_detailed(window, record=False)[0]
        return self.float64_copy().forward_detailed(window.double(), record=False)[0]

    # ── exact CPU inference ──

    _is_float64_copy = False

    def _state_key(self) -> tuple:
        return tuple((tensor.data_ptr(), tensor._version, str(tensor.device), tensor.dtype)
                     for tensor in (*self.parameters(), *self.buffers()))

    def float64_copy(self) -> FeatureGraphNetwork:
        """A float64 copy of this network in eval mode, rebuilt whenever a weight or buffer
        changes (an optimiser step, ``load_state_dict``, a move). CPU inference runs through
        it: float32 matrix products take a different kernel for one row than for many, so
        one bar alone would differ from the same bar in a batch in the last bit; in float64
        that difference is far below the float32 output's resolution. Held outside the
        module's registry, so it is never part of the state dict."""
        cached = self.__dict__.get("_float64_cache")
        key = self._state_key()
        if cached is not None and cached[0] == key:
            return cached[1]
        object.__setattr__(self, "_float64_cache", None)
        copy_ = _deep_copy(self).double().eval()
        object.__setattr__(copy_, "_is_float64_copy", True)
        object.__setattr__(self, "_float64_cache", (key, copy_))
        return copy_

    @staticmethod
    def _keep(recorded, name: str, kind: str, tensor: torch.Tensor) -> None:
        if recorded is not None:
            recorded.append((name, kind, tensor))

    def _forward_gcn(self, window, recorded):
        nodes = self._encode_nodes(window)
        self._keep(recorded, "Node encoding (each feature's window, gelu)", "graph_nodes", nodes)
        adjacency_hat = self.adjacency_hat()
        for number, layer in enumerate(self.graph_layers, 1):
            nodes = self.layer_dropout(layer(nodes, adjacency_hat))
            self._keep(recorded, f"Graph convolution {number} (relu)", "graph_convolution", nodes)
        readout = self.readout(nodes)
        self._keep(recorded, "Graph readout (gelu)", "dense", readout)
        return readout

    def _forward_gat(self, window, recorded):
        nodes = self._encode_nodes(window)
        self._keep(recorded, "Node encoding (each feature's window, gelu)", "graph_nodes", nodes)
        mask = self.neighbour_mask(with_self=True)
        for number, layer in enumerate(self.graph_layers, 1):
            nodes, attention = layer(nodes, mask)
            nodes = self.layer_dropout(nodes)
            self._keep(recorded, f"Graph attention {number}: coefficients (head, node, neighbour)", "graph_attention",
                       attention)
            self._keep(recorded, f"Graph attention {number} ({self.head_count} heads, elu)", "graph_nodes", nodes)
        readout = self.readout(nodes)
        self._keep(recorded, "Graph readout (gelu)", "dense", readout)
        return readout

    def _forward_message_passing(self, window, recorded):
        nodes = self._encode_nodes(window)
        self._keep(recorded, "Node encoding (each feature's window, gelu)", "graph_nodes", nodes)
        mask = self.neighbour_mask(with_self=False)
        for number, layer in enumerate(self.graph_layers, 1):
            nodes, aggregated = layer(nodes, mask)
            self._keep(recorded, f"Message passing {number}: aggregated messages ({self.aggregation})", "graph_messages",
                       aggregated)
            self._keep(recorded, f"Message passing {number}: updated nodes", "graph_nodes", nodes)
        readout = self.readout(nodes)
        self._keep(recorded, "Graph readout (gelu)", "dense", readout)
        return readout

    def _forward_graph_lstm(self, window, recorded):
        batch, length, node_count = window.shape
        series = window.transpose(1, 2).reshape(batch * node_count, length, 1)
        output, _ = self.node_recurrent(series)
        nodes = output[:, -1].reshape(batch, node_count, -1) + self.node_identity
        self._keep(recorded, "Per-node LSTM final state plus node identity", "graph_nodes", nodes)
        adjacency_hat = self.adjacency_hat()
        for number, layer in enumerate(self.graph_layers, 1):
            nodes = self.layer_dropout(layer(nodes, adjacency_hat))
            self._keep(recorded, f"Graph mixing {number} (graph convolution, relu)", "graph_convolution", nodes)
        readout = self.readout(nodes)
        self._keep(recorded, "Graph readout (gelu)", "dense", readout)
        return readout

    def _forward_transformer_graph(self, window, recorded):
        batch, length, node_count = window.shape
        dimension = self.model_dimension
        tokens = (self.value_projection(window.transpose(1, 2)[..., None])      # (batch, node, time, d)
                  + self.node_identity[None, :, None, :] + self.position[None, None, -length:, :])
        adjacency_hat = self.adjacency_hat()
        mask = self.causal_mask[-length:, -length:]
        for number in range(len(self.temporal_attention)):
            folded = tokens.reshape(batch * node_count, length, dimension)
            temporal, _ = self.temporal_attention[number](folded, folded, folded, attn_mask=mask, need_weights=False)
            temporal = temporal.reshape(batch, node_count, length, dimension)
            message = self.graph_message[number](torch.einsum("ij,bjtd->bitd", adjacency_hat, tokens))
            tokens = self.mix_norm[number](tokens + self.layer_dropout(message) + self.layer_dropout(temporal))
            tokens = self.feedforward_norm[number](tokens + self.layer_dropout(self.feedforward[number](tokens)))
            self._keep(recorded, f"Hybrid layer {number + 1}: last bar's node states", "graph_nodes", tokens[:, :, -1])
        readout = self.readout(tokens[:, :, -1])
        self._keep(recorded, "Graph readout (gelu)", "dense", readout)
        return readout

    def _forward_spatiotemporal(self, window, recorded):
        batch, length, node_count = window.shape
        nodes = functional.gelu(self.value_projection(window[..., None]) + self.node_identity)   # (batch, time, node, h)
        adjacency_hat = self.adjacency_hat()
        for layer in self.graph_layers:
            nodes = layer(nodes, adjacency_hat)
        spatial = self.spatial_readout(nodes.reshape(batch * length, node_count, -1)).reshape(batch, length, -1)
        self._keep(recorded, "Spatial branch: graph readout of every bar", "graph_sequence", spatial)
        temporal, _ = self.temporal_recurrent(spatial)
        self._keep(recorded, "Temporal branch: LSTM over the spatial readouts", "lstm", temporal)
        spatial_last, temporal_last = spatial[:, -1], temporal[:, -1]
        gate = torch.sigmoid(self.fusion_gate(torch.cat([spatial_last, temporal_last], dim=-1)))
        self._keep(recorded, "Fusion gate (logistic, share of the spatial branch)", "gate", gate)
        fused = self.fusion_dropout(gate * spatial_last + (1.0 - gate) * temporal_last)
        self._keep(recorded, "Fused vector", "dense", fused)
        return fused

    def _forward_latent_decision_graph(self, window, recorded):
        batch, length, _ = window.shape
        bars = self.bar_projection(window) + self.position[-length:]
        latents = self.latents[None].expand(batch, -1, -1)
        attended, _ = self.cross_attention(latents, bars, bars, need_weights=False)
        latents = self.cross_norm(latents + attended)
        self._keep(recorded, "Latents after cross-attention to the bars", "latents", latents)
        scale = 1.0 / math.sqrt(self.latent_dimension)
        for number in range(self.round_count):
            query = self.round_query[number](latents)
            key = self.round_key[number](latents)
            adjacency = torch.softmax(torch.einsum("bkd,bjd->bkj", query, key).float() * scale, dim=-1).to(latents.dtype)
            self._keep(recorded, f"Latent graph {number + 1}: soft adjacency (latent, latent)", "graph_attention",
                       adjacency)
            message = self.round_message[number](torch.bmm(adjacency, latents))
            latents = self.round_norm[number](latents + self.round_mlp[number](message))
            self._keep(recorded, f"Latent graph {number + 1}: latents after message passing", "latents", latents)
        pooled = self.pooled_dropout(latents.mean(dim=1))
        self._keep(recorded, "Pooled latent (routing input)", "dense", pooled)
        widths = self.decision_widths()
        mass = torch.ones(batch, 1, dtype=pooled.dtype, device=pooled.device)
        temperature = self.routing_temperature.to(pooled.dtype)
        for level, gate in enumerate(self.decision_gates):
            logits = gate(pooled).view(batch, widths[level], widths[level + 1]).float() / temperature.float()
            routing = torch.softmax(logits, dim=-1).to(pooled.dtype)
            mass = torch.bmm(mass[:, None, :], routing).squeeze(1)
            self._keep(recorded, f"Decision graph layer {level + 1}: path mass", "decision_mass", mass)
        if self.training and torch.is_grad_enabled():
            self._last_leaf_mass = mass
        return mass


def _deep_copy(network: nn.Module) -> nn.Module:
    import copy

    return copy.deepcopy(network)


def build(parameters: dict, feature_count: int) -> nn.Module:
    """The network for a registry entry with ``network: "feature_graph"``."""
    return FeatureGraphNetwork(dict(parameters), int(feature_count))


def _layer(name: str, kind: str, tensor: torch.Tensor) -> dict:
    """One recorded layer for batch row 0 (the shape ``networks._layer`` writes)."""
    value = tensor.detach()[0].double().cpu()
    return {"name": name, "kind": kind, "shape": [int(size) for size in value.shape],
            "values": value.reshape(-1).tolist()}


def trace(network: nn.Module, window: torch.Tensor) -> dict:
    """``{"layers": [...], "attention": [], "logit": float}`` for a batch-of-one window.
    The network must be in eval mode; the last layer is the head's input."""
    if network.training:
        raise RuntimeError("trace needs the network in eval mode")
    exact = window.device.type == "cpu"             # the path CPU predictions take (see float64_copy)
    runner = network.float64_copy() if exact else network
    with torch.no_grad():
        logit, recorded = runner.forward_detailed(window.double() if exact else window, record=True)
    value = float(logit.reshape(-1)[0].item())
    if not math.isfinite(value):
        raise RuntimeError(f"trace: the head output is not finite ({value})")
    return {"layers": [_layer(name, kind, tensor) for name, kind, tensor in recorded], "attention": [], "logit": value}


def describe(network: nn.Module) -> list[dict]:
    """The traced layers without values: ``[{name, kind, outputShape}]`` (from a zero window)."""
    was_training = network.training
    network.eval()
    try:
        device = network.adjacency.device
        zeros = torch.zeros(1, network.sequence_length, network.feature_count, device=device)
        with torch.no_grad():
            _, recorded = network.forward_detailed(zeros, record=True)
    finally:
        network.train(was_training)
    return [{"name": name, "kind": kind, "outputShape": [int(size) for size in tensor.shape[1:]]}
            for name, kind, tensor in recorded]


__all__ = ["AGGREGATIONS", "ATTENTION", "GRAPH_LAYERS", "SEQUENCE", "FeatureGraphNetwork", "build",
           "correlation_graph", "describe", "normalised_adjacency", "trace"]
