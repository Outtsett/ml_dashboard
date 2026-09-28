"""Model Cycle PyTorch networks (src/ml/cycle/networks.py): network kinds, the
two constructor forms, "Inside the model" traces and the new registry keys.

Every network kind is fitted briefly on one synthetic causal dataset (bar t's
label mixes bar t's features with LAGGED features at t-1 and t-3) and checked
for: causality inside the window (bars after t never move the prediction at
t), single row == batch, a save / `models.load_adapter` round trip, and trace
parity G4 (the head applied to the recorded last activation reproduces the
logit within 1e-5, docs/plans/2026-09-26-cycle-catalog-inside-view.md). The
legacy families are held to the networks that predate the registry (frozen
copies below plus golden LSTM predictions made with the pre-registry module),
and the new keys run one small engine fold on the CPU.
"""

from __future__ import annotations

import inspect
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from torch import nn  # noqa: E402

from cycle import catalog, networks  # noqa: E402
from cycle.adapter import BatchReport, EpochReport  # noqa: E402
from cycle.models import build_adapter, load_adapter, resolve_parameters  # noqa: E402
from cycle.networks import (  # noqa: E402
    BUILTIN_NETWORK_KINDS,
    LEGACY_NETWORKS,
    NETWORK_EXTENSIONS,
    NETWORK_KINDS,
    SEQUENCE_NETWORKS,
    NeuralAdapter,
    build_network,
    head_input,
)

CUDA = torch.cuda.is_available()
SEQUENCE_LENGTH = 8
FEATURE_COUNT = 6

REGISTRY = catalog.registry()["models"]
# the neural registry keys this package builds (everything neural that is not legacy)
NEW_KEYS = tuple(key for key, entry in REGISTRY.items() if entry["adapter"] == "neural")
# one registry key per network kind: the new keys plus the legacy families
KIND_KEYS = {REGISTRY[key]["network"]: key for key in (*NEW_KEYS, *LEGACY_NETWORKS)}

FAST = {"epochs": 8, "batch_size": 64, "patience": 3, "learning_rate": 0.003}
FAST_PARAMETERS = {
    "feedforward_network": {**FAST, "hidden_size": 16, "layer_count": 2, "activation_function": "relu"},
    "recurrent_network": {**FAST, "sequence_length": SEQUENCE_LENGTH, "hidden_size": 16, "layer_count": 2},
    "gated_recurrent_unit": {**FAST, "sequence_length": SEQUENCE_LENGTH, "hidden_size": 16},
    "attention_recurrent_network": {**FAST, "sequence_length": SEQUENCE_LENGTH, "hidden_size": 16,
                                    "layer_count": 2},
    "multilayer_perceptron": {**FAST, "hidden_size": 16},
    "lstm": {**FAST, "sequence_length": SEQUENCE_LENGTH, "hidden_size": 16, "layer_count": 2},
    "temporal_convolution_network": {**FAST, "sequence_length": SEQUENCE_LENGTH, "channel_count": 8},
    "transformer_encoder": {**FAST, "sequence_length": SEQUENCE_LENGTH, "model_dimension": 16,
                            "head_count": 4, "layer_count": 2},
    # the kinds in their own modules (cycle/networks_extra/)
    "mixture_of_experts": {**FAST, "expert_count": 4, "expert_hidden_size": 16, "expert_layer_count": 1,
                           "gate_hidden_size": 8},
    "recurrent_convolution_hybrid": {**FAST, "sequence_length": SEQUENCE_LENGTH, "channel_count": 8,
                                     "kernel_size": 3, "convolution_layer_count": 2, "hidden_size": 16,
                                     "recurrent_layer_count": 1},
    "hypernetwork": {**FAST, "sequence_length": SEQUENCE_LENGTH, "hypernetwork_hidden_size": 16,
                     "target_hidden_size": 8, "context_embedding_size": 8},
    "neural_turing_machine": {**FAST, "sequence_length": SEQUENCE_LENGTH, "controller_hidden_size": 16,
                              "memory_slots": 8, "memory_width": 8, "read_head_count": 1},
    "dual_pathway": {**FAST, "sequence_length": SEQUENCE_LENGTH, "fast_window_bars": 4, "slow_stride": 2,
                     "pathway_hidden_size": 16, "fusion_hidden_size": 16},
}


def test_every_new_neural_key_is_covered_here():
    assert set(NEW_KEYS) == {"feedforward_network", "recurrent_network", "gated_recurrent_unit",
                             "attention_recurrent_network", *NETWORK_EXTENSIONS}
    assert set(KIND_KEYS) == set(NETWORK_KINDS)
    assert set(NETWORK_EXTENSIONS) == {"mixture_of_experts", "recurrent_convolution_hybrid", "hypernetwork",
                                       "neural_turing_machine", "dual_pathway"}


def _returns_every_position(kind: str) -> bool:
    """Whether the kind's network exposes `sequence_output` (one output per bar of
    the window). The kinds that do not are held to causality at the prediction
    level (`test_bars_after_t_never_move_the_prediction_at_t`)."""
    parameters = resolve_parameters(KIND_KEYS[kind], FAST_PARAMETERS[KIND_KEYS[kind]])
    with torch.random.fork_rng(devices=[]):   # building draws initial weights
        return hasattr(build_network(kind, parameters, FEATURE_COUNT), "sequence_output")


PER_POSITION_KINDS = sorted(kind for kind in SEQUENCE_NETWORKS if _returns_every_position(kind))


# ─── synthetic causal data ─────────────────────────────────────────────────

class Dataset:
    def __init__(self, row_count: int = 2400, seed: int = 7) -> None:
        generator = np.random.default_rng(seed)
        features = generator.standard_normal((row_count, FEATURE_COUNT)).astype(np.float32)
        signal = np.zeros(row_count)
        signal[3:] = features[3:, 0] - 0.8 * features[3:, 1] + 0.6 * features[2:-1, 2] + 0.4 * features[:-3, 3]
        labels = (signal + 0.5 * generator.standard_normal(row_count) > 0).astype(np.float32)
        target = (0.8 * signal + 0.3 * generator.standard_normal(row_count)).astype(np.float32)
        for column in (labels, target):
            column[:3] = np.nan
            column[-6:] = np.nan
        features[:5] = np.nan
        self.features = features
        self.labels = labels
        self.target = target
        self.timestamps = (1_700_000_000 + 300 * np.arange(row_count)).astype(np.int64)
        scored = np.flatnonzero(np.isfinite(labels))
        scored = scored[scored >= 5 + SEQUENCE_LENGTH - 1]
        self.train_index = scored[scored < 1500]
        self.validation_index = scored[(scored >= 1510) & (scored < 1900)]
        self.test_index = scored[scored >= 1910]


class Reporter:
    def __init__(self) -> None:
        self.step_unit = None
        self.epochs: list[EpochReport] = []
        self.logs: list[str] = []

    def epoch_started(self, epoch, epoch_count):
        pass

    def batch(self, report):
        assert isinstance(report, BatchReport)

    def epoch_finished(self, report):
        self.epochs.append(report)

    def validating(self, epoch, epoch_count):
        pass

    def checkpoint(self):
        pass

    def log(self, message, level="info"):
        self.logs.append(message)


@pytest.fixture(scope="module")
def dataset() -> Dataset:
    return Dataset()


_FITTED: dict[tuple[str, str, str], NeuralAdapter] = {}


def fitted(key: str, data: Dataset, task: str = "classification", device: str = "cpu") -> NeuralAdapter:
    if (key, task, device) not in _FITTED:
        adapter = build_adapter(key, FAST_PARAMETERS[key], device, 11, task=task)
        labels = data.labels if task == "classification" else data.target
        adapter.fit(data.features, labels, data.train_index, data.validation_index, data.timestamps, Reporter())
        _FITTED[(key, task, device)] = adapter
    return _FITTED[(key, task, device)]


def predict(adapter: NeuralAdapter, features, index) -> np.ndarray:
    method = adapter.predict_probability if adapter.task == "classification" else adapter.predict_value
    return method(features, np.asarray(index, dtype=np.int64))


# ─── construction ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("key", NEW_KEYS)
@pytest.mark.parametrize("task", ["classification", "regression"])
def test_new_keys_build_through_build_adapter_as_their_network_kind(key, task):
    entry = catalog.entry(key)
    adapter = build_adapter(key, {}, "cpu", 0, task=task)
    assert isinstance(adapter, NeuralAdapter)
    assert (adapter.key, adapter.family, adapter.task) == (key, key, task)
    assert adapter.network_kind == entry["network"]
    assert adapter.parameters == catalog.resolve_parameters(key, {})
    expected_history = catalog.defaults(key)["sequence_length"] if entry["sequence"] else 1
    assert adapter.minimum_history() == expected_history
    assert (adapter.network_kind in SEQUENCE_NETWORKS) == entry["sequence"]


@pytest.mark.parametrize("family", sorted(LEGACY_NETWORKS))
def test_legacy_families_keep_the_family_constructor(family):
    adapter = build_adapter(family, {}, "cpu", 0)
    assert isinstance(adapter, NeuralAdapter)
    assert (adapter.key, adapter.family, adapter.network_kind) == (family, family, LEGACY_NETWORKS[family])
    assert catalog.entry(family)["network"] == adapter.network_kind


def test_the_two_constructor_forms_bind_unambiguously():
    signature = inspect.signature(NeuralAdapter)
    key = "gated_recurrent_unit"
    entry = catalog.entry(key)
    signature.bind(key, entry, {}, "cpu", 0, task="regression")      # what build_adapter checks
    signature.bind("lstm", {}, "cpu", 0, task="classification")
    assert NeuralAdapter(key, entry, {}, "cpu", 0).network_kind == "gated_recurrent_unit"
    assert NeuralAdapter("lstm", {"sequence_length": 12}, "cpu", 0).minimum_history() == 12
    with pytest.raises(TypeError, match="positional arguments"):
        NeuralAdapter(key, entry, {}, "cpu", 0, 99)
    with pytest.raises(TypeError, match="positional arguments"):
        NeuralAdapter("lstm", {}, "cpu")
    with pytest.raises(TypeError, match="registry entry second"):
        NeuralAdapter(key, {"not": "an entry"}, {}, "cpu", 0)
    with pytest.raises(ValueError, match="not a legacy neural family"):
        NeuralAdapter(key, {}, "cpu", 0)
    with pytest.raises(ValueError, match="not a network kind"):
        NeuralAdapter(key, {**entry, "network": "spiking"}, {}, "cpu", 0)


def test_registry_parameters_are_validated_by_the_registry():
    with pytest.raises(ValueError):
        build_adapter("feedforward_network", {"activation_function": "sigmoid"}, "cpu", 0)
    with pytest.raises(ValueError):
        build_adapter("recurrent_network", {"sequence_length": 2}, "cpu", 0)


@pytest.mark.parametrize(("activation", "module"), [("tanh", nn.Tanh), ("relu", nn.ReLU), ("gelu", nn.GELU)])
def test_the_perceptron_takes_the_chosen_activation_function(activation, module):
    parameters = {"hidden_size": 8, "layer_count": 2, "dropout": 0.0, "activation_function": activation}
    network = build_network("multilayer_perceptron", parameters, FEATURE_COUNT)
    activations = [m for m in network.body if not isinstance(m, (nn.Linear, nn.Dropout))]
    assert len(activations) == 2 and all(type(m) is module for m in activations)
    adapter = build_adapter("feedforward_network", {"activation_function": activation}, "cpu", 0)
    assert adapter.parameters["activation_function"] == activation


def test_the_legacy_perceptron_keeps_gelu_and_an_unknown_activation_is_refused():
    legacy = build_network("multilayer_perceptron", {"hidden_size": 8, "layer_count": 3, "dropout": 0.1}, 4)
    assert [type(m) for m in legacy.body][1::3] == [nn.GELU] * 3
    with pytest.raises(ValueError, match="activation_function"):
        build_network("multilayer_perceptron",
                      {"hidden_size": 8, "layer_count": 1, "dropout": 0.0, "activation_function": "swish"}, 4)
    with pytest.raises(ValueError, match="not a network kind"):
        build_network("multilayer_perceptron_v2", {}, 4)


# ─── the legacy networks are the ones that predate the registry ─────────────

class _FrozenPerceptron(nn.Module):
    """networks.MultilayerPerceptron as it was before network kinds (2026-09-25)."""

    def __init__(self, feature_count, hidden_size, layer_count, dropout):
        super().__init__()
        layers = []
        width = feature_count
        for _ in range(layer_count):
            layers += [nn.Linear(width, hidden_size), nn.GELU(), nn.Dropout(dropout)]
            width = hidden_size
        self.body = nn.Sequential(*layers)
        self.head = nn.Linear(width, 1)

    def forward(self, rows):
        return self.head(self.body(rows)).squeeze(-1)


class _FrozenLongShortTermMemory(nn.Module):
    """networks.LongShortTermMemoryNetwork as it was before network kinds (2026-09-25)."""

    def __init__(self, feature_count, hidden_size, layer_count, dropout):
        super().__init__()
        self.recurrent = nn.LSTM(feature_count, hidden_size, num_layers=layer_count, batch_first=True,
                                 dropout=dropout if layer_count > 1 else 0.0)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)

    def forward(self, window):
        output, _ = self.recurrent(window)
        return self.head(self.dropout(output[:, -1])).squeeze(-1)


@pytest.mark.parametrize(("kind", "frozen", "shape"), [
    ("multilayer_perceptron", _FrozenPerceptron, (5, FEATURE_COUNT)),
    ("lstm", _FrozenLongShortTermMemory, (5, SEQUENCE_LENGTH, FEATURE_COUNT)),
])
def test_legacy_networks_are_built_and_run_exactly_as_before(kind, frozen, shape):
    parameters = {"hidden_size": 16, "layer_count": 2, "dropout": 0.2}
    torch.manual_seed(5)
    reference = frozen(FEATURE_COUNT, 16, 2, 0.2).eval()
    torch.manual_seed(5)
    network = build_network(kind, parameters, FEATURE_COUNT).eval()
    assert reference.state_dict().keys() == network.state_dict().keys()
    for name, value in reference.state_dict().items():
        assert torch.equal(value, network.state_dict()[name]), name
    rows = torch.randn(*shape)
    with torch.no_grad():
        assert torch.equal(reference(rows), network(rows))


# P(up) of the legacy LSTM (FAST_PARAMETERS["lstm"], CPU, seed 11) on the first
# eight test rows of Dataset(), made with the pre-registry networks.py
# (git HEAD 24ef3ba) before network kinds existed.
GOLDEN_LEGACY_LSTM = [
    0.7686180472373962, 0.10862565040588379, 0.7500935196876526, 0.40923136472702026,
    0.17284947633743286, 0.6145878434181213, 0.7770401239395142, 0.42096683382987976,
]


def test_legacy_lstm_predictions_are_unchanged(dataset):
    adapter = fitted("lstm", dataset)
    assert adapter.network_kind == "lstm"
    np.testing.assert_allclose(predict(adapter, dataset.features, dataset.test_index[:8]),
                               GOLDEN_LEGACY_LSTM, rtol=0, atol=1e-6)


# ─── causality, single row, round trip ──────────────────────────────────────

@pytest.mark.parametrize("kind", PER_POSITION_KINDS)
def test_sequence_output_is_causal_inside_the_window(kind):
    parameters = resolve_parameters(KIND_KEYS[kind], FAST_PARAMETERS[KIND_KEYS[kind]])
    torch.manual_seed(0)
    network = build_network(kind, parameters, FEATURE_COUNT).eval()
    window = torch.randn(3, SEQUENCE_LENGTH, FEATURE_COUNT)
    with torch.no_grad():
        reference = network.sequence_output(window)
        for position in (1, 4, SEQUENCE_LENGTH - 1):
            changed = window.clone()
            changed[:, position:] += torch.randn_like(changed[:, position:]) * 10
            output = network.sequence_output(changed)
            assert torch.allclose(output[:, :position], reference[:, :position], atol=1e-5)
            assert not torch.allclose(output[:, position], reference[:, position], atol=1e-5)


@pytest.mark.parametrize("key", NEW_KEYS)
@pytest.mark.parametrize("task", ["classification", "regression"])
def test_bars_after_t_never_move_the_prediction_at_t(key, task, dataset):
    adapter = fitted(key, dataset, task)
    generator = np.random.default_rng(3)
    for row in (int(dataset.test_index[10]), int(dataset.test_index[200])):
        perturbed = dataset.features.copy()
        perturbed[row + 1:] = generator.normal(0, 25, perturbed[row + 1:].shape)
        before = predict(adapter, dataset.features, [row])
        assert predict(adapter, perturbed, [row])[0] == before[0]
        rows = [row - 5, row - 1, row]
        np.testing.assert_allclose(predict(adapter, perturbed, rows), predict(adapter, dataset.features, rows),
                                   rtol=0, atol=1e-6)
        own_bar = dataset.features.copy()
        own_bar[row] = generator.normal(0, 3, own_bar[row].shape)
        assert predict(adapter, own_bar, [row])[0] != pytest.approx(before[0], abs=1e-9)


@pytest.mark.parametrize("key", NEW_KEYS)
@pytest.mark.parametrize("task", ["classification", "regression"])
def test_a_single_row_equals_the_batch(key, task, dataset):
    adapter = fitted(key, dataset, task)
    index = dataset.test_index[:300]
    batched = predict(adapter, dataset.features, index)
    assert batched.dtype == np.float64 and batched.shape == index.shape
    assert np.unique(np.round(batched, 4)).size > 10, "predictions are constant"
    for position in (0, 7, 150, 299):
        assert abs(predict(adapter, dataset.features, index[position:position + 1])[0] - batched[position]) < 1e-6


@pytest.mark.parametrize("key", NEW_KEYS)
@pytest.mark.parametrize("task", ["classification", "regression"])
def test_new_keys_learn_and_report_epochs(key, task, dataset):
    adapter = fitted(key, dataset, task)
    assert adapter.best_iteration is not None and 1 <= adapter.best_iteration <= FAST["epochs"]
    assert adapter.fit_summary["best_epoch"] == adapter.best_iteration
    prediction = predict(adapter, dataset.features, dataset.test_index)
    if task == "classification":
        labels = dataset.labels[dataset.test_index]
        assert np.mean((prediction >= 0.5) == (labels >= 0.5)) >= 0.6
    else:
        target = dataset.target[dataset.test_index]
        assert np.corrcoef(prediction, target)[0, 1] >= 0.6


@pytest.mark.parametrize("key", NEW_KEYS)
@pytest.mark.parametrize("task", ["classification", "regression"])
def test_save_and_load_through_the_models_module(key, task, dataset, tmp_path):
    adapter = fitted(key, dataset, task)
    path = adapter.save(str(tmp_path))
    metadata = json.loads((tmp_path / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["family"], metadata["task"]) == ("neural", key, key, task)
    assert metadata["network"] == catalog.entry(key)["network"]
    assert metadata["sequence_length"] == adapter.sequence_length
    state = torch.load(path, map_location="cpu", weights_only=True)
    assert (state["key"], state["network"], state["best_iteration"]) == (key, adapter.network_kind,
                                                                        adapter.best_iteration)
    assert not list(tmp_path.glob("*.tmp*"))

    reloaded = load_adapter(str(tmp_path), device="cpu")
    assert isinstance(reloaded, NeuralAdapter)
    assert (reloaded.key, reloaded.network_kind, reloaded.task) == (key, adapter.network_kind, task)
    assert reloaded.parameters == adapter.parameters and reloaded.best_iteration == adapter.best_iteration
    index = dataset.test_index[:60]
    assert np.array_equal(predict(reloaded, dataset.features, index), predict(adapter, dataset.features, index))
    row = int(index[3])
    assert reloaded.trace(dataset.features, row) == adapter.trace(dataset.features, row)


def test_a_legacy_model_saved_before_network_kinds_still_loads(dataset, tmp_path):
    adapter = fitted("lstm", dataset)
    adapter.save(str(tmp_path))
    metadata = json.loads((tmp_path / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["network"]) == ("legacy", "lstm", "lstm")
    # rewrite both files the way the pre-registry module wrote them
    state = torch.load(tmp_path / "model.pt", map_location="cpu", weights_only=True)
    for name in ("key", "network", "best_iteration"):
        del state[name]
    torch.save(state, tmp_path / "model.pt")
    for name in ("key", "adapter", "network"):
        del metadata[name]
    (tmp_path / "model.json").write_text(json.dumps(metadata), encoding="utf-8")
    reloaded = load_adapter(str(tmp_path))
    assert (reloaded.key, reloaded.family, reloaded.network_kind) == ("lstm", "lstm", "lstm")
    index = dataset.test_index[:20]
    assert np.array_equal(predict(reloaded, dataset.features, index), predict(adapter, dataset.features, index))


# ─── trace (Inside the model) ───────────────────────────────────────────────

@pytest.mark.parametrize("kind", NETWORK_KINDS)
@pytest.mark.parametrize("task", ["classification", "regression"])
def test_trace_reproduces_the_logit_from_the_last_activation(kind, task, dataset):
    """G4: the head applied to the recorded last activation reproduces the logit (1e-5),
    and the logit is what predict_* returned for the same bar."""
    adapter = fitted(KIND_KEYS[kind], dataset, task)
    for row in (int(dataset.test_index[0]), int(dataset.test_index[123])):
        trace = adapter.trace(dataset.features, row)
        assert set(trace) == {"layers", "attention", "logit"}
        assert math.isfinite(trace["logit"])
        assert abs(adapter.apply_head(head_input(trace)) - trace["logit"]) <= 1e-5
        # the same numbers through the head's own weights, by hand
        head = adapter.network.head
        if isinstance(head, nn.Linear):
            by_hand = float(head.weight.detach().double().cpu().numpy()[0] @ head_input(trace)
                            + head.bias.detach().double().cpu().numpy()[0])
        else:   # the hypernetwork's generated output layer: parameter-free, the sum of its contributions
            assert not list(head.parameters())
            by_hand = float(head_input(trace).sum())
        assert abs(by_hand - trace["logit"]) <= 1e-5
        output = predict(adapter, dataset.features, [row])[0]
        if task == "classification":
            assert abs(1.0 / (1.0 + math.exp(-trace["logit"])) - output) <= 1e-6
        else:
            assert abs(trace["logit"] - output) <= 1e-6


@pytest.mark.parametrize("kind", NETWORK_KINDS)
def test_trace_layers_have_their_shapes_and_describe_matches(kind, dataset):
    adapter = fitted(KIND_KEYS[kind], dataset)
    trace = adapter.trace(dataset.features, np.array([int(dataset.test_index[5])]))
    assert trace["layers"], "no hidden layer recorded"
    for layer in trace["layers"]:
        assert set(layer) == {"name", "kind", "shape", "values"}
        assert len(layer["values"]) == int(np.prod(layer["shape"]))
        assert all(math.isfinite(value) for value in layer["values"])
        if kind not in BUILTIN_NETWORK_KINDS:
            assert 1 <= len(layer["shape"]) <= 2
        elif kind in SEQUENCE_NETWORKS and layer["kind"] != "attention_pooling":
            assert len(layer["shape"]) == 2 and layer["shape"][0] == SEQUENCE_LENGTH
        else:
            assert len(layer["shape"]) == 1
    described = adapter.describe()
    assert described["network"] == kind and described["sequenceLength"] == adapter.sequence_length
    # the declared flag is what a trace actually carries
    assert described["hasAttention"] == bool(trace["attention"])
    for entry in trace["attention"]:
        weights = np.asarray(entry["weights"])
        assert np.all(weights >= 0) and weights.sum() == pytest.approx(1.0, abs=1e-5)
    assert described["layers"] == [{"name": layer["name"], "kind": layer["kind"], "outputShape": layer["shape"]}
                                   for layer in trace["layers"]]
    if kind not in BUILTIN_NETWORK_KINDS:
        return   # the layer count of an extension kind is its own module's test
    parameters = adapter.parameters
    expected_count = {
        "multilayer_perceptron": parameters.get("layer_count"),
        "lstm": parameters.get("layer_count"),
        "recurrent": parameters.get("layer_count"),
        "gated_recurrent_unit": parameters.get("layer_count"),
        "attention_recurrent": parameters.get("layer_count", 0) + 1,
        "temporal_convolution_network": parameters.get("layer_count"),
        "transformer_encoder": parameters.get("layer_count", 0) + 2,
    }[kind]
    assert len(trace["layers"]) == expected_count


def test_multi_layer_recurrent_traces_record_every_layer(dataset):
    """Layer 1's recorded output is the input the top layer ran on: re-running the
    top layer's weights on it gives the recorded top layer."""
    adapter = fitted("recurrent_network", dataset)
    trace = adapter.trace(dataset.features, int(dataset.test_index[40]))
    first, second = (np.asarray(layer["values"], dtype=np.float32).reshape(layer["shape"])
                     for layer in trace["layers"])
    module = adapter.network.recurrent
    top = nn.RNN(module.hidden_size, module.hidden_size, nonlinearity="tanh", batch_first=True)
    top.load_state_dict({name.replace("_l1", "_l0"): value for name, value in module.state_dict().items()
                         if name.endswith("_l1")})
    with torch.no_grad():
        rebuilt = top(torch.from_numpy(first)[None])[0][0].numpy()
    np.testing.assert_allclose(rebuilt, second, rtol=0, atol=1e-5)


def test_transformer_attention_is_per_layer_and_head_for_the_last_position(dataset):
    adapter = fitted("transformer_encoder", dataset)
    trace = adapter.trace(dataset.features, int(dataset.test_index[17]))
    layers, heads = adapter.parameters["layer_count"], adapter.parameters["head_count"]
    assert [(entry["layer"], entry["head"]) for entry in trace["attention"]] == [
        (f"Encoder layer {layer}", head) for layer in range(1, layers + 1) for head in range(heads)]
    for entry in trace["attention"]:
        weights = np.asarray(entry["weights"])
        assert weights.shape == (SEQUENCE_LENGTH,) and np.all(weights >= 0)
        assert weights.sum() == pytest.approx(1.0, abs=1e-5)
    # averaged over heads, the first layer's weights are what its own attention module returns
    network = adapter.network.eval()
    window = torch.from_numpy(dataset.features[int(dataset.test_index[17]) - SEQUENCE_LENGTH + 1:
                                               int(dataset.test_index[17]) + 1][None].copy())
    with torch.no_grad():
        hidden = network.projection(window) + network.position[:, :SEQUENCE_LENGTH]
        layer = network.encoder.layers[0]
        normalised = layer.norm1(hidden)
        _, averaged = layer.self_attn(normalised, normalised, normalised,
                                      attn_mask=network.causal_mask[:SEQUENCE_LENGTH, :SEQUENCE_LENGTH],
                                      need_weights=True, average_attn_weights=True)
    first_layer = np.mean([entry["weights"] for entry in trace["attention"][:heads]], axis=0)
    np.testing.assert_allclose(first_layer, averaged[0, -1].numpy(), rtol=0, atol=1e-6)


def test_attention_recurrent_trace_carries_the_pooling_weights_of_that_forward(dataset):
    adapter = fitted("attention_recurrent_network", dataset)
    row = int(dataset.test_index[33])
    trace = adapter.trace(dataset.features, row)
    (entry,) = trace["attention"]
    assert (entry["layer"], entry["head"]) == ("Attention pooling", 0)
    weights = np.asarray(entry["weights"])
    assert weights.shape == (SEQUENCE_LENGTH,) and weights.sum() == pytest.approx(1.0, abs=1e-6)
    np.testing.assert_allclose(weights, adapter.network.attention.last_weights[0].numpy(), rtol=0, atol=0)
    # the pooled vector is the weighted sum of the top recurrent layer's positions
    top = np.asarray(trace["layers"][-2]["values"]).reshape(trace["layers"][-2]["shape"])
    pooled = np.asarray(trace["layers"][-1]["values"])
    np.testing.assert_allclose(weights @ top, pooled, rtol=0, atol=1e-5)


@pytest.mark.parametrize("kind", ["transformer_encoder", "recurrent"])
def test_a_recomputed_layer_that_disagrees_with_the_forward_is_refused(kind, dataset, monkeypatch):
    adapter = fitted(KIND_KEYS[kind], dataset)
    monkeypatch.setattr(networks, "_RECOMPUTE_TOLERANCE", -1.0)
    with pytest.raises(RuntimeError, match="differs from the network's own output"):
        adapter.trace(dataset.features, int(dataset.test_index[0]))


def test_trace_refuses_what_it_cannot_explain(dataset):
    adapter = fitted("gated_recurrent_unit", dataset)
    with pytest.raises(ValueError, match="one row at a time"):
        adapter.trace(dataset.features, dataset.test_index[:2])
    with pytest.raises(ValueError, match="outside the rows"):
        adapter.trace(dataset.features, SEQUENCE_LENGTH - 2)
    with pytest.raises(ValueError, match="outside the rows"):
        adapter.trace(dataset.features, len(dataset.features))
    unfitted = build_adapter("gated_recurrent_unit", {}, "cpu", 0)
    with pytest.raises(RuntimeError, match="before fit"):
        unfitted.trace(dataset.features, 100)


def test_trace_leaves_the_random_state_and_the_network_untouched(dataset):
    adapter = fitted("lstm", dataset)
    before = {name: value.clone() for name, value in adapter.network.state_dict().items()}
    torch.manual_seed(123)
    expected = torch.rand(3)
    torch.manual_seed(123)
    adapter.trace(dataset.features, int(dataset.test_index[9]))
    assert torch.equal(torch.rand(3), expected)
    assert all(torch.equal(value, adapter.network.state_dict()[name]) for name, value in before.items())
    assert not adapter.network._forward_hooks and not adapter.network.recurrent._forward_hooks


@pytest.mark.skipif(not CUDA, reason="no CUDA device")
def test_a_network_fitted_on_the_gpu_is_traced_on_the_cpu(dataset):
    adapter = fitted("attention_recurrent_network", dataset, device="cuda")
    row = int(dataset.test_index[50])
    trace = adapter.trace(dataset.features, row)
    assert next(adapter.network.parameters()).device.type == "cuda"
    assert abs(adapter.apply_head(head_input(trace)) - trace["logit"]) <= 1e-5
    probability = adapter.predict_probability(dataset.features, np.array([row]))[0]
    assert abs(1.0 / (1.0 + math.exp(-trace["logit"])) - probability) <= 1e-4


# ─── one engine fold per new key ────────────────────────────────────────────

def synthetic_engine_inputs():
    from cycle.engine import MarketData
    from cycle.features import FeatureSet
    from cycle.simulate import load_cost_model

    cost = load_cost_model("MNQ")
    generator = np.random.default_rng(5)
    first_monday = int(datetime(2026, 3, 2, tzinfo=timezone.utc).timestamp())
    stamps = []
    for day in range(40):
        if day % 7 >= 5:
            continue
        opening = first_monday + day * 86_400 + 13 * 3_600 + 30 * 60
        stamps.extend(opening + 300 * np.arange(96))
    timestamps = np.array(stamps, dtype=np.int64)
    count = timestamps.size
    signal = np.zeros(count)
    innovation = generator.standard_normal(count) * math.sqrt(1 - 0.9 ** 2)
    for t in range(1, count):
        signal[t] = 0.9 * signal[t - 1] + innovation[t]
    step = np.zeros(count)
    step[1:] = 1.5 * signal[:-1] + generator.normal(0, 1.5, count - 1)
    tick = cost.tick_size
    close = np.round((18_000 + np.cumsum(step)) / tick) * tick
    open_ = np.r_[18_000.0, close[:-1] + tick * generator.integers(-1, 2, count - 1)]
    high = np.maximum(open_, close) + tick * generator.integers(0, 5, count)
    low = np.minimum(open_, close) - tick * generator.integers(0, 5, count)
    volume = generator.integers(50, 2_000, count).astype(np.float64)
    matrix = np.column_stack([signal, np.r_[np.nan, signal[:-1]], generator.standard_normal(count),
                              generator.standard_normal(count)]).astype(np.float32)
    matrix[:30] = np.nan
    names = ["planted_signal", "planted_signal_previous_bar", "noise_first", "noise_second"]
    return MarketData(timestamps, open_, high, low, close, volume), FeatureSet(matrix, names), cost


@pytest.mark.parametrize("key", NEW_KEYS)
def test_a_new_key_runs_one_engine_fold_on_the_cpu(key, tmp_path, monkeypatch):
    from cycle.engine import CycleEngine, CycleSettings
    from shared import protocol

    events: list[dict] = []
    monkeypatch.setattr(protocol, "emit", lambda event: events.append(json.loads(protocol.dumps_safe(event))))
    data, features, cost = synthetic_engine_inputs()
    parameters = {**FAST_PARAMETERS[key], "epochs": 2}
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id=f"cycle_networks_{key}", model_family=key,
        model_parameters=parameters, artifact_directory=str(tmp_path),
        train_days=14, validation_fraction=0.2, test_days=3, step_days=0, fold_limit=1, expanding_window=False,
        label_horizon_bars=4, label_threshold_ticks=1.0, embargo_bars=2,
        long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1,
        tuning_trials=0, tuning_mode="reviewed_defaults", bars_per_second=0.0, start_paused=False, quiet_bars=True, log_every_batches=1,
        device="cpu", seed=42, land_in_lake=False,
    )
    factory = lambda parameters, task="classification": build_adapter(key, parameters, "cpu", 42, task=task)  # noqa: E731
    CycleEngine(settings, data, features, cost, factory).run()
    assert events[-1]["type"] == "done", [e for e in events if e["type"] in ("error", "log")][-5:]
    assert not [e for e in events if e["type"] == "error"]
    (plan,) = [e for e in events if e["type"] == "cycle_plan"]
    assert plan["explainKind"] == "neural" and plan["hasPriceModel"] is True
    roles = {e.get("modelRole") for e in events if e["type"] == "cycle_epoch"}
    assert roles == {"direction", "price"}
    fold = Path(tmp_path) / "fold_0"
    metadata = json.loads((fold / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["network"]) == ("neural", key, catalog.entry(key)["network"])
    direction = load_adapter(str(fold))
    price = load_adapter(str(fold / "price_model"))
    assert (direction.task, price.task) == ("classification", "regression")
    # the reloaded fold model reproduces what the walk streamed for its test bars
    import pyarrow.parquet as pq

    predictions = pq.read_table(tmp_path / "predictions.parquet").to_pydict()
    rows = {int(stamp): index for index, stamp in enumerate(data.timestamps)}
    checked = 0
    for stamp, probability in zip(predictions["timestamp"], predictions["probability_up"]):
        if probability is None:
            continue
        row = rows[int(stamp.timestamp()) if hasattr(stamp, "timestamp") else int(stamp)]
        reloaded = direction.predict_probability(features.matrix, np.array([row]))[0]
        assert abs(reloaded - probability) <= 1e-6
        trace = direction.trace(features.matrix, row)
        assert abs(1.0 / (1.0 + math.exp(-trace["logit"])) - probability) <= 1e-6
        checked += 1
        if checked == 25:
            break
    assert checked == 25
