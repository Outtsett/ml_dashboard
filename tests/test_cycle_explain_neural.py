"""The neural explainer (``src/ml/cycle/explain/neural.py``) against real Model Cycle runs.

One small run per runnable neural registry key is made in-process on the
synthetic MNQ-like market of ``tests/test_cycle_explain_core.py`` (copied):
CPU, one fold, a few epochs, with its price model. Then, for every key:

- the structure names every layer the trace records, in plain full words, and
  says whether the network carries attention;
- G1: the reloaded model reproduces what the engine streamed (1e-6, torch on
  the CPU; 1e-12 for scikit-learn);
- G2: the link applied to the logit is the reported output (1e-6);
- G4: the head applied to the recorded last activation reproduces the logit
  (1e-5) — for scikit-learn also the library's own predict_proba / predict;
- every attention entry names a recorded layer, its weights sum to 1 per head
  and run over the same positions as ``inputs.window`` (oldest first);
- the window the network read is the one ``inputs.window`` shows;
- layer values fill their shapes; replies carry no NaN and pass the zod schemas.

``CYCLE_EXPLAIN_WRITE_FIXTURES=1`` writes one structure and one bar per key into
``tests/fixtures/cycle_explain/`` (``structure_neural_<key>.json``,
``bar_neural_<key>.json``, plus ``bar_neural_lstm_price.json``) and a
``{manifest, structure, bar}`` bundle per key into
``tests/fixtures/cycle_explain_client_neural/real_<key>.json``.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import pytest

from cycle import catalog
from cycle.control import ControlState
from cycle.engine import CycleEngine, CycleSettings, MarketData
from cycle.explain import KIND_MODULES, artifacts, common, kind_module
from cycle.explain import neural as neural_explainer
from cycle.explain.server import Explainer, encode
from cycle.features import FeatureSet
from cycle.models import build_adapter, default_parameters
from cycle.simulate import load_cost_model
from shared import protocol

REPOSITORY = Path(__file__).resolve().parents[1]
VERIFY_SCRIPT = REPOSITORY / "scripts" / "verify_cycle_explain.py"
FIXTURES = REPOSITORY / "tests" / "fixtures" / "cycle_explain"
CLIENT_FIXTURES = REPOSITORY / "tests" / "fixtures" / "cycle_explain_client_neural"
WRITE_FIXTURES = os.environ.get("CYCLE_EXPLAIN_WRITE_FIXTURES") == "1"
MNQ = load_cost_model("MNQ")
FIRST_MONDAY = int(datetime(2026, 3, 2, tzinfo=timezone.utc).timestamp())
BARS_PER_DAY = 96
HORIZON = 4
FEATURE_NAMES = ["planted_signal", "planted_signal_previous_bar", "noise_first", "noise_second"]
BARS_PER_ROLE = 25

# Small, fast settings per key (CPU, a few epochs); every other parameter is the registry default.
SMALL = {"epochs": 3, "patience": 3, "batch_size": 256}
PARAMETERS = {
    "multilayer_perceptron": {"hidden_size": 16, "layer_count": 2},
    "feedforward_network": {"hidden_size": 16, "layer_count": 2, "activation_function": "tanh"},
    "recurrent_network": {"sequence_length": 12, "hidden_size": 12, "layer_count": 2},
    "gated_recurrent_unit": {"sequence_length": 12, "hidden_size": 12, "layer_count": 1},
    "lstm": {"sequence_length": 12, "hidden_size": 12, "layer_count": 2},
    "attention_recurrent_network": {"sequence_length": 12, "hidden_size": 12, "layer_count": 1},
    "temporal_convolution_network": {"sequence_length": 12, "channel_count": 8, "kernel_size": 3, "layer_count": 2},
    "transformer_encoder": {"sequence_length": 12, "model_dimension": 16, "head_count": 2, "layer_count": 2},
    "multilayer_perceptron_scikit_learn": {"hidden_size": 16, "layer_count": 2, "activation_function": "relu",
                                           "epochs": 6},
}
SEQUENCE_KEYS = {key for key, values in PARAMETERS.items() if "sequence_length" in values}
ATTENTION_KEYS = {"transformer_encoder", "attention_recurrent_network"}
# The layer names each network records (hidden and sequence layers, head excluded), in order.
EXPECTED_LAYER_NAMES = {
    "multilayer_perceptron": ["Hidden layer 1 (Gaussian error linear unit)", "Hidden layer 2 (Gaussian error linear unit)"],
    "feedforward_network": ["Hidden layer 1 (hyperbolic tangent)", "Hidden layer 2 (hyperbolic tangent)"],
    "recurrent_network": ["Recurrent layer 1", "Recurrent layer 2"],
    "gated_recurrent_unit": ["Gated recurrent unit layer 1"],
    "lstm": ["Long short-term memory layer 1", "Long short-term memory layer 2"],
    "attention_recurrent_network": ["Gated recurrent unit layer 1", "Attention pooling"],
    "temporal_convolution_network": ["Causal convolution block 1 (dilation 1)", "Causal convolution block 2 (dilation 2)"],
    "transformer_encoder": ["Input projection with positions", "Encoder layer 1", "Encoder layer 2",
                            "Final layer normalisation"],
    "multilayer_perceptron_scikit_learn": ["Hidden layer 1 (rectified linear unit)", "Hidden layer 2 (rectified linear unit)"],
}


def runnable_neural_keys() -> list[str]:
    models = catalog.registry()["models"]
    return sorted(key for key, entry in models.items() if entry["explainKind"] == "neural" and entry["runnable"])


# ═══ a synthetic market and real runs ══════════════════════════════════════


def synthetic_market(calendar_days: int = 35, seed: int = 5) -> tuple[MarketData, FeatureSet]:
    """The market of tests/test_cycle_explain_core.py: bar t+1 drifts with a causal
    AR(1) signal the model is handed as a feature; the raw columns are an affine
    copy of the inputs."""
    generator = np.random.default_rng(seed)
    stamps: list[int] = []
    for day in range(calendar_days):
        if day % 7 >= 5:
            continue
        opening = FIRST_MONDAY + day * 86_400 + 13 * 3_600 + 30 * 60
        stamps.extend(opening + 300 * np.arange(BARS_PER_DAY))
    timestamps = np.array(stamps, dtype=np.int64)
    count = timestamps.size
    signal = np.zeros(count)
    innovation = generator.standard_normal(count) * math.sqrt(1 - 0.9 ** 2)
    for t in range(1, count):
        signal[t] = 0.9 * signal[t - 1] + innovation[t]
    step = np.zeros(count)
    step[1:] = 1.5 * signal[:-1] + generator.normal(0, 1.5, count - 1)
    tick = MNQ.tick_size
    close = np.round((18_000 + np.cumsum(step)) / tick) * tick
    open_ = np.empty(count)
    open_[0] = 18_000.0
    open_[1:] = close[:-1] + tick * generator.integers(-1, 2, count - 1)
    high = np.maximum(open_, close) + tick * generator.integers(0, 5, count)
    low = np.minimum(open_, close) - tick * generator.integers(0, 5, count)
    volume = generator.integers(50, 2_000, count).astype(np.float64)
    matrix = np.column_stack([
        signal, np.r_[np.nan, signal[:-1]], generator.standard_normal(count), generator.standard_normal(count),
    ]).astype(np.float32)
    matrix[:30] = np.nan
    raw = (matrix * 2.0 + 10.0).astype(np.float32)
    data = MarketData(timestamps, open_, high, low, close, volume)
    return data, FeatureSet(matrix, list(FEATURE_NAMES), raw=raw)


@dataclass
class Made:
    key: str
    directory: Path
    engine: CycleEngine


def make_run(root: Path, key: str, parameters: dict, market, *, train_days: int = 14, test_days: int = 3) -> Made:
    data, features = market
    model_id = f"cycle_explain_neural_{key}"
    directory = root / model_id
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id=model_id, model_family=key, model_parameters=parameters,
        artifact_directory=str(directory), train_days=train_days, validation_fraction=0.2, test_days=test_days,
        step_days=0, fold_limit=1, expanding_window=False, label_horizon_bars=HORIZON, label_threshold_ticks=1.0,
        embargo_bars=2, long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1,
        tuning_trials=0, bars_per_second=0.0, start_paused=False, quiet_bars=True, log_every_batches=100,
        device="cpu", seed=42, land_in_lake=False,
    )
    engine = CycleEngine(settings, data, features, MNQ,
                         lambda values, task="classification": build_adapter(key, values, "cpu", 42, task=task),
                         control=ControlState(0.0, False))
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(protocol, "emit", lambda event: None)
        engine.run()
    return Made(key, directory, engine)


def parameters_for(key: str) -> dict:
    return {**default_parameters(key), **SMALL, **PARAMETERS[key]}


@pytest.fixture(scope="module")
def market():
    return synthetic_market()


@pytest.fixture(scope="module")
def runs(market, tmp_path_factory) -> dict[str, Made]:
    root = tmp_path_factory.mktemp("cycle_explain_neural_runs")
    return {key: make_run(root, key, parameters_for(key), market) for key in PARAMETERS}


def rows_tested(made: Made, fold: int = 0) -> np.ndarray:
    return artifacts.load_fold_index(made.directory, fold)["test"]


def timestamp_of(made: Made, row: int) -> int:
    return int(made.engine.data.timestamps[row])


def sample_rows(made: Made, context, count: int = BARS_PER_ROLE, seed: int = 11) -> list[int]:
    rows = [int(row) for row in rows_tested(made) if context.valid(int(row))]
    generator = np.random.default_rng(seed)
    return sorted(generator.choice(rows, size=min(count, len(rows)), replace=False).tolist())


def load_verify_script():
    specification = importlib.util.spec_from_file_location("verify_cycle_explain", VERIFY_SCRIPT)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


# ═══ the dispatch contract ═════════════════════════════════════════════════


def test_the_neural_kind_is_served_by_this_module():
    assert KIND_MODULES["neural"] == "cycle.explain.neural"
    assert kind_module("neural") is neural_explainer
    for name in ("structure_block", "bar_block", "check"):
        assert callable(getattr(neural_explainer, name))


def test_every_runnable_neural_key_is_covered_here():
    assert set(runnable_neural_keys()) <= set(PARAMETERS)


def test_activations_are_written_in_full_words():
    assert neural_explainer.full_words("Hidden layer 1 (gelu)") == "Hidden layer 1 (Gaussian error linear unit)"
    assert neural_explainer.full_words("Hidden layer 2 (relu)") == "Hidden layer 2 (rectified linear unit)"
    assert neural_explainer.full_words("Encoder layer 1") == "Encoder layer 1"


# ═══ structure ═════════════════════════════════════════════════════════════


@pytest.mark.parametrize("key", sorted(PARAMETERS))
@pytest.mark.parametrize("role", ["direction", "price"])
def test_the_structure_lists_every_layer_in_full_words(runs, key, role):
    made = runs[key]
    structure = Explainer().structure(str(made.directory), 0, role)
    assert structure["explainKind"] == "neural"
    assert structure["link"] == ("identity" if role == "price" else "logistic")
    network = structure["neural"]
    assert network is not None
    assert [layer["name"] for layer in network["layers"]] == EXPECTED_LAYER_NAMES[key]
    assert network["hasAttention"] is (key in ATTENTION_KEYS)
    length = PARAMETERS[key].get("sequence_length", 1)
    assert network["sequenceLength"] == length
    for layer in network["layers"]:
        assert layer["kind"] and all(size > 0 for size in layer["outputShape"])
        if key in SEQUENCE_KEYS and layer["kind"] != "attention_pooling":
            assert layer["outputShape"][0] == length, "a sequence layer is [time, units]"
        for abbreviation in ("gelu", "relu", "tanh", "lstm", "gru"):
            assert f"({abbreviation})" not in layer["name"]
    for block in ("trees", "linear", "neighbors", "naiveBayes", "supportVectors", "calibration", "stacking"):
        assert structure[block] is None


# ═══ bars: G1, G2, G4, attention, the window ═══════════════════════════════


@pytest.fixture(scope="module")
def gate_record():
    """Largest error per gate across every test, for the report printed at the end."""
    record: dict[str, float] = {}
    yield record
    print("\n[neural explainer] largest errors: " + ", ".join(f"{gate} {error:.3g}" for gate, error in sorted(record.items())))


@pytest.mark.parametrize("key", sorted(PARAMETERS))
@pytest.mark.parametrize("role", ["direction", "price"])
def test_every_explained_bar_passes_g1_g2_and_g4(runs, key, role, gate_record):
    made = runs[key]
    explainer = Explainer()
    context = explainer.context(str(made.directory), 0, role)
    streamed_by_time = {record["timestamp"]: record for record in
                        pq.read_table(made.directory / "predictions.parquet").to_pylist()}
    checked = 0
    for row in sample_rows(made, context):
        timestamp = timestamp_of(made, row)
        bar = explainer.explain(str(made.directory), 0, role, timestamp)
        assert timestamp in streamed_by_time and bar["streamed"] is not None
        gates = [common.gate_g1(context, bar, "cpu"), *common.kind_checks(context, row, bar)]
        assert [gate["gate"] for gate in gates] == ["G1", "G2", "G4"]
        for gate in gates:
            assert gate["passed"] is True, gate
            gate_record[gate["gate"]] = max(gate_record.get(gate["gate"], 0.0), gate["error"])
        assert gates[0]["tolerance"] == (1e-12 if key == "multilayer_perceptron_scikit_learn" else 1e-6)
        neural = bar["neural"]
        assert bar["output"]["raw"] == neural["logit"]
        if role == "price":
            assert bar["output"]["targetUnits"] == pytest.approx(neural["logit"], abs=1e-6)
        else:
            assert bar["output"]["probabilityUp"] == pytest.approx(1.0 / (1.0 + math.exp(-neural["logit"])), abs=1e-6)
        checked += 1
    assert checked == BARS_PER_ROLE


@pytest.mark.parametrize("key", sorted(PARAMETERS))
def test_layers_fill_their_shapes_and_match_the_structure(runs, key):
    made = runs[key]
    explainer = Explainer()
    structure = explainer.structure(str(made.directory), 0, "direction")
    context = explainer.context(str(made.directory), 0, "direction")
    row = sample_rows(made, context, count=1)[0]
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
    layers = bar["neural"]["layers"]
    assert [(layer["name"], layer["kind"], layer["shape"]) for layer in layers] == \
        [(layer["name"], layer["kind"], layer["outputShape"]) for layer in structure["neural"]["layers"]]
    for layer in layers:
        assert len(layer["values"]) == math.prod(layer["shape"])
        assert all(isinstance(value, float) and math.isfinite(value) for value in layer["values"])


@pytest.mark.parametrize("key", sorted(PARAMETERS))
def test_the_window_the_network_read_is_the_one_the_inputs_show(runs, market, key):
    made = runs[key]
    _, features = market
    explainer = Explainer()
    context = explainer.context(str(made.directory), 0, "direction")
    row = sample_rows(made, context, count=1)[0]
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
    window = bar["inputs"]["window"]
    if key not in SEQUENCE_KEYS:
        assert window is None
        if key == "multilayer_perceptron_scikit_learn":
            assert bar["inputs"]["scaled"] is True
            expected = context.explained_adapter.scaler.transform(features.matrix[row:row + 1].astype(np.float64))[0]
            np.testing.assert_allclose(bar["inputs"]["values"], expected, rtol=0, atol=1e-12)
        else:
            assert bar["inputs"]["scaled"] is False
            np.testing.assert_array_equal(bar["inputs"]["values"], features.matrix[row].astype(np.float64))
        return
    length = PARAMETERS[key]["sequence_length"]
    assert len(window["timestamps"]) == length and window["timestamps"][-1] == bar["timestamp"]
    assert window["timestamps"] == [int(t) for t in made.engine.data.timestamps[row - length + 1:row + 1]]
    np.testing.assert_array_equal(np.array(window["values"]), features.matrix[row - length + 1:row + 1].astype(np.float64))
    # every sequence layer runs over the same bars, oldest first
    for layer in bar["neural"]["layers"]:
        if len(layer["shape"]) == 2:
            assert layer["shape"][0] == length
    # a bar the window does not read cannot move the output: change the bar before the window starts
    shifted = features.matrix.copy()
    shifted[row - length] += 5.0
    adapter = context.explained_adapter
    assert adapter.trace(shifted, row)["logit"] == adapter.trace(features.matrix, row)["logit"]
    # and the bar being predicted does
    shifted[row] += 5.0
    assert adapter.trace(shifted, row)["logit"] != adapter.trace(features.matrix, row)["logit"]


@pytest.mark.parametrize("key", sorted(ATTENTION_KEYS))
def test_attention_names_its_layer_sums_to_one_and_spans_the_window(runs, key):
    made = runs[key]
    explainer = Explainer()
    context = explainer.context(str(made.directory), 0, "direction")
    length = PARAMETERS[key]["sequence_length"]
    for row in sample_rows(made, context, count=5):
        bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
        names = [layer["name"] for layer in bar["neural"]["layers"]]
        attention = bar["neural"]["attention"]
        assert attention, "an attention network records attention"
        heads = PARAMETERS[key].get("head_count", 1)
        layers_with_attention = sorted({entry["layer"] for entry in attention})
        for layer in layers_with_attention:
            assert layer in names, f"attention layer {layer!r} is not a recorded layer"
            assert sorted(entry["head"] for entry in attention if entry["layer"] == layer) == list(range(heads))
        for entry in attention:
            weights = np.array(entry["weights"])
            assert weights.size == length == len(bar["inputs"]["window"]["timestamps"])
            assert (weights >= 0).all()
            assert weights.sum() == pytest.approx(1.0, abs=1e-6)
        if key == "transformer_encoder":
            assert layers_with_attention == ["Encoder layer 1", "Encoder layer 2"]
        else:
            assert layers_with_attention == ["Attention pooling"]


def test_networks_without_attention_record_none(runs):
    for key in set(PARAMETERS) - ATTENTION_KEYS:
        made = runs[key]
        explainer = Explainer()
        context = explainer.context(str(made.directory), 0, "direction")
        row = sample_rows(made, context, count=1)[0]
        assert explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))["neural"]["attention"] == []


def test_the_scikit_learn_forward_pass_matches_the_library(runs, market):
    """The layers read from coefs_ / intercepts_ reproduce scikit-learn's own
    forward pass (``_forward_pass_fast``) for the classifier and the regressor."""
    made = runs["multilayer_perceptron_scikit_learn"]
    explainer = Explainer()
    _, features = market
    for role in ("direction", "price"):
        context = explainer.context(str(made.directory), 0, role)
        estimator = context.explained_adapter.estimator
        assert type(estimator).__name__ == ("MLPClassifier" if role == "direction" else "MLPRegressor")
        for row in sample_rows(made, context, count=10):
            bar = explainer.explain(str(made.directory), 0, role, timestamp_of(made, row))
            inputs = context.explained_adapter.scaler.transform(features.matrix[row:row + 1].astype(np.float64))
            library = estimator.predict_proba(inputs)[0, 1] if role == "direction" else estimator.predict(inputs)[0]
            logit = bar["neural"]["logit"]
            produced = 1.0 / (1.0 + math.exp(-logit)) if role == "direction" else logit
            assert produced == pytest.approx(float(library), abs=1e-12)
            assert bar["engineReload"] == pytest.approx(float(library), abs=1e-12)
            assert len(bar["neural"]["layers"]) == len(estimator.coefs_) - 1
            if estimator.activation == "relu":
                assert all(value >= 0.0 for layer in bar["neural"]["layers"] for value in layer["values"])


def test_a_broken_head_fails_g4(runs):
    """G4 compares, it does not assume: a head that disagrees with the recorded activation fails."""
    made = runs["lstm"]
    explainer = Explainer()
    context = explainer.context(str(made.directory), 0, "direction")
    row = sample_rows(made, context, count=1)[0]
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
    tampered = json.loads(json.dumps(bar))
    tampered["neural"]["layers"][-1]["values"] = [value + 0.5 for value in tampered["neural"]["layers"][-1]["values"]]
    gates = {gate["gate"]: gate for gate in neural_explainer.check(context, row, tampered)}
    assert gates["G4"]["passed"] is False and gates["G2"]["passed"] is True
    tampered = json.loads(json.dumps(bar))
    tampered["output"]["probabilityUp"] = 1.0 - tampered["output"]["probabilityUp"] + 0.01
    assert {gate["gate"]: gate for gate in neural_explainer.check(context, row, tampered)}["G2"]["passed"] is False


# ═══ the verify script, reply size, schemas and fixtures ═══════════════════


@pytest.mark.parametrize("key", ["lstm", "transformer_encoder", "multilayer_perceptron_scikit_learn"])
def test_the_verify_script_runs_every_gate(runs, key):
    summary = load_verify_script().verify_run(runs[key].directory, bars=8, seed=2, schema=False)
    assert summary["passed"] is True, summary
    assert set(summary["gates"]) == {"G1", "G2", "G4"}
    for gate in summary["gates"].values():
        assert gate["failed"] == 0 and gate["passed"] == 2 * 8


def test_a_large_sequence_network_reply_stays_small(market, tmp_path):
    """Sequence 32 × hidden 128, two layers, nothing downsampled: the reply stays well under a few MB."""
    sizes: dict[str, int] = {}
    big = {
        "lstm": {"sequence_length": 32, "hidden_size": 128, "layer_count": 2, "epochs": 1, "patience": 1},
        "transformer_encoder": {"sequence_length": 32, "model_dimension": 128, "head_count": 4, "layer_count": 2,
                                "epochs": 1, "patience": 1},
    }
    for key, values in big.items():
        made = make_run(tmp_path, key, {**default_parameters(key), **values}, market, train_days=10, test_days=1)
        explainer = Explainer()
        context = explainer.context(str(made.directory), 0, "direction")
        row = sample_rows(made, context, count=1)[0]
        bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
        text = encode({"id": "size", "ok": True, "result": bar})
        sizes[key] = len(text.encode("utf-8"))
        assert sum(len(layer["values"]) for layer in bar["neural"]["layers"]) >= 2 * 32 * 128
        gates = common.kind_checks(context, row, bar)
        assert all(gate["passed"] for gate in gates), gates
    print(f"\n[neural explainer] reply bytes at sequence 32 x width 128: {sizes}")
    assert max(sizes.values()) < 3_000_000


def fixture_samples(runs) -> list[tuple[str, str, dict, dict | None]]:
    """(schema kind, fixture name, reply, manifest) — one structure and one bar per key, plus a price bar."""
    samples = []
    for key in sorted(PARAMETERS):
        made = runs[key]
        explainer = Explainer()
        context = explainer.context(str(made.directory), 0, "direction")
        row = sample_rows(made, context, count=1, seed=3)[0]
        manifest = explainer.manifest(str(made.directory))
        manifest = {**manifest}
        samples.append(("structure", f"structure_neural_{key}", explainer.structure(str(made.directory), 0, "direction"),
                        manifest))
        samples.append(("bar", f"bar_neural_{key}", explainer.explain(str(made.directory), 0, "direction",
                                                                        timestamp_of(made, row)), manifest))
        if key == "lstm":
            samples.append(("bar", "bar_neural_lstm_price",
                            explainer.explain(str(made.directory), 0, "price", timestamp_of(made, row)), manifest))
    return samples


def test_replies_are_schema_valid_nan_free_and_match_the_fixtures(runs, tmp_path):
    verify = load_verify_script()
    samples = fixture_samples(runs)
    for _, name, value, _ in samples:
        text = json.dumps(value, allow_nan=False)
        assert "NaN" not in text and "Infinity" not in text, name
    manifests = {sample[3]["modelKey"]: sample[3] for sample in samples}
    zod_samples = [(kind, name, value) for kind, name, value, _ in samples] + \
        [("manifest", f"manifest {key}", manifest) for key, manifest in manifests.items()]
    if WRITE_FIXTURES:
        FIXTURES.mkdir(parents=True, exist_ok=True)
        for _, name, value, _ in samples:
            (FIXTURES / f"{name}.json").write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        CLIENT_FIXTURES.mkdir(parents=True, exist_ok=True)
        by_key: dict[str, dict] = {}
        for kind, name, value, manifest in samples:
            if name.endswith("_price"):
                continue
            key = name.split("_neural_", 1)[1]
            by_key.setdefault(key, {"manifest": manifest})[kind] = value
        for key, bundle in by_key.items():
            (CLIENT_FIXTURES / f"real_{key}.json").write_text(json.dumps(bundle, allow_nan=False) + "\n", encoding="utf-8")
    result = verify.zod_validate(zod_samples, tmp_path / "zod")
    if result is None:
        pytest.skip("node and the repository's tsx are needed to load the zod schemas")
    assert result["failures"] == []
    assert result["counts"] == {"structure": len(PARAMETERS), "bar": len(PARAMETERS) + 1, "manifest": len(PARAMETERS)}
    for _, name, value, _ in samples:
        path = FIXTURES / f"{name}.json"
        assert path.is_file(), f"{path} is missing: run with CYCLE_EXPLAIN_WRITE_FIXTURES=1"
        committed = json.loads(path.read_text(encoding="utf-8"))
        assert sorted(committed) == sorted(value), name
        if "neural" in committed and committed["neural"] and "layers" in committed["neural"]:
            assert [layer["name"] for layer in committed["neural"]["layers"]] == \
                [layer["name"] for layer in value["neural"]["layers"]], name
    for key in PARAMETERS:
        assert (CLIENT_FIXTURES / f"real_{key}.json").is_file()
