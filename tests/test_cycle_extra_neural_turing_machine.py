"""Model Cycle network kind ``neural_turing_machine``
(src/ml/cycle/networks_extra/neural_turing_machine.py, registry entry
src/config/cycle_models/neural_turing_machine.json).

Checked: the registry accepts the entry and Optuna suggests exactly the
parameters that carry a search block; ``models.build_adapter`` builds it for
both tasks; the addressing weights are a distribution over the slots; the
network is causal inside its window; fitted on a synthetic causal dataset it
learns, a single row equals the batch, bars after t never move the prediction
at t, save -> ``models.load_adapter`` reproduces the predictions and the trace,
and the trace's last layer is exactly the head's input (gate G4), every read
head's addressing is its own layer and no attention block is carried (the
weights run over memory slots, not bars). Then
one engine fold runs on REAL MNQ 5-minute bars read from the lake (a window of
October 2025, which holds no contract roll), its streamed probabilities are in
[0, 1], the reloaded fold model reproduces them, and ``scripts/verify_cycle_explain.py``
passes every gate on the run.
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from cycle import catalog, networks  # noqa: E402
from cycle.adapter import BatchReport, EpochReport  # noqa: E402
from cycle.models import build_adapter, load_adapter  # noqa: E402
from cycle.networks import (  # noqa: E402
    ATTENTION_NETWORKS,
    SEQUENCE_NETWORKS,
    NeuralAdapter,
    build_network,
    head_input,
)
from cycle.networks_extra import neural_turing_machine as module  # noqa: E402

KEY = "neural_turing_machine"
REPOSITORY = Path(__file__).resolve().parents[1]
VERIFY_SCRIPT = REPOSITORY / "scripts" / "verify_cycle_explain.py"

SEQUENCE_LENGTH = 8
FEATURE_COUNT = 6
FAST = {"sequence_length": SEQUENCE_LENGTH, "controller_hidden_size": 16, "memory_slots": 8, "memory_width": 8,
        "read_head_count": 2, "dropout": 0.1, "epochs": 8, "batch_size": 64, "patience": 3, "learning_rate": 0.003}

# The real-bar engine run: a window of MNQ 5m bars from the lake (no contract roll inside it).
REAL_SYMBOL, REAL_TIMEFRAME = "MNQ", "5m"
REAL_WINDOW = {"start": "2025-10-01", "end": "2025-10-15"}
REAL_PARAMETERS = {"sequence_length": 16, "controller_hidden_size": 32, "memory_slots": 8, "memory_width": 8,
                   "read_head_count": 1, "dropout": 0.1, "epochs": 3, "patience": 3, "batch_size": 128}


# ─── registry ──────────────────────────────────────────────────────────────


def test_the_registry_accepts_the_entry_and_the_kind_is_wired():
    registry = catalog.load_registry()
    assert KEY in registry["models"] and registry["files"][KEY] == f"{KEY}.json"
    entry = catalog.entry(KEY)
    assert (entry["adapter"], entry["implementation"], entry["network"]) == ("neural", "torch", KEY)
    assert entry["sequence"] is True and entry["explainKind"] == "neural" and entry["runnable"] is True
    assert entry["direction"]["probability"] == "network" and entry["price"] is not None
    assert entry["catalogSpecId"] == "neural-network-architectures-memory-routing-architectures-neural-turing-machine"
    assert networks.NETWORK_EXTENSIONS[KEY] is module
    assert KEY in SEQUENCE_NETWORKS and KEY not in ATTENTION_NETWORKS and KEY in networks.NETWORK_KINDS
    for name in entry["parameters"]:
        assert "_" in name or name in ("dropout", "epochs", "patience"), f"{name} is not a full-word name"


class RecordingTrial:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def suggest_categorical(self, name, choices):
        self.calls.append(("categorical", name, tuple(choices)))
        return choices[0]

    def suggest_int(self, name, low, high, log=False):
        self.calls.append(("int", name, low, high, log))
        return low

    def suggest_float(self, name, low, high, log=False):
        self.calls.append(("float", name, low, high, log))
        return low


def test_optuna_suggests_exactly_the_parameters_with_a_search_block():
    trial = RecordingTrial()
    base = catalog.defaults(KEY)
    suggested = catalog.suggest_parameters(trial, KEY, base)
    searched = [call[1] for call in trial.calls]
    assert searched == list(catalog.searchable_parameters(KEY))
    assert searched == ["controller_hidden_size", "memory_slots", "memory_width", "read_head_count", "dropout",
                        "learning_rate", "weight_decay"]
    for never in ("sequence_length", "epochs", "patience", "batch_size"):
        assert never not in searched and suggested[never] == base[never]
    assert ("int", "read_head_count", 1, 2, False) in trial.calls
    assert suggested["controller_hidden_size"] == 32 and suggested["memory_slots"] == 8


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_build_adapter_builds_it_for_both_tasks(task):
    adapter = build_adapter(KEY, catalog.defaults(KEY), "cpu", 42, task=task)
    assert isinstance(adapter, NeuralAdapter)
    assert (adapter.key, adapter.network_kind, adapter.task) == (KEY, KEY, task)
    assert adapter.parameters == catalog.resolve_parameters(KEY, {})
    assert adapter.minimum_history() == catalog.defaults(KEY)["sequence_length"] == 32
    with pytest.raises(ValueError):
        build_adapter(KEY, {"read_head_count": 0}, "cpu", 0)


# ─── the network ───────────────────────────────────────────────────────────


def test_addressing_is_a_distribution_over_the_slots_and_safe_at_zero():
    torch.manual_seed(0)
    memory = torch.randn(3, 8, 5)
    key = torch.randn(3, 2, 5)
    strength = torch.randn(3, 2, 1)
    weights = module.NeuralTuringMachineModule.address(memory, key, strength)
    assert weights.shape == (3, 2, 8) and bool((weights >= 0).all())
    assert torch.allclose(weights.sum(-1), torch.ones(3, 2), atol=1e-6)
    # a zero key or a zero memory gives a finite, uniform weighting
    uniform = module.NeuralTuringMachineModule.address(torch.zeros(1, 8, 5), key[:1], strength[:1])
    assert torch.allclose(uniform, torch.full((1, 2, 8), 1 / 8))
    assert torch.isfinite(module.NeuralTuringMachineModule.address(memory, torch.zeros(3, 2, 5), strength)).all()


def test_the_sequence_output_is_causal_inside_the_window():
    parameters = catalog.resolve_parameters(KEY, FAST)
    torch.manual_seed(0)
    network = build_network(KEY, parameters, FEATURE_COUNT).eval()
    window = torch.randn(3, SEQUENCE_LENGTH, FEATURE_COUNT)
    with torch.no_grad():
        reference = network.sequence_output(window)
        assert reference.shape == (3, SEQUENCE_LENGTH, 16 + 2 * 8)
        for position in (1, 4, SEQUENCE_LENGTH - 1):
            changed = window.clone()
            changed[:, position:] += torch.randn_like(changed[:, position:]) * 10
            output = network.sequence_output(changed)
            assert torch.allclose(output[:, :position], reference[:, :position], atol=1e-5)
            assert not torch.allclose(output[:, position], reference[:, position], atol=1e-5)
        # the memory is reset per window: two identical windows in one batch give the same output
        pair = torch.stack([window[0], window[0]])
        outputs = network(pair)
        assert abs(float(outputs[0]) - float(outputs[1])) <= 1e-6


# ─── synthetic causal data (tests/test_cycle_networks.py) ──────────────────


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


_FITTED: dict[str, NeuralAdapter] = {}


def fitted(data: Dataset, task: str = "classification") -> NeuralAdapter:
    if task not in _FITTED:
        adapter = build_adapter(KEY, FAST, "cpu", 11, task=task)
        labels = data.labels if task == "classification" else data.target
        reporter = Reporter()
        adapter.fit(data.features, labels, data.train_index, data.validation_index, data.timestamps, reporter)
        assert reporter.step_unit == "epoch" and reporter.epochs
        _FITTED[task] = adapter
    return _FITTED[task]


def predict(adapter: NeuralAdapter, features, index) -> np.ndarray:
    method = adapter.predict_probability if adapter.task == "classification" else adapter.predict_value
    return method(features, np.asarray(index, dtype=np.int64))


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_it_learns_the_synthetic_signal(task, dataset):
    adapter = fitted(dataset, task)
    assert adapter.best_iteration is not None and 1 <= adapter.best_iteration <= FAST["epochs"]
    assert adapter.fit_summary["best_epoch"] == adapter.best_iteration
    prediction = predict(adapter, dataset.features, dataset.test_index)
    assert np.all(np.isfinite(prediction))
    if task == "classification":
        assert np.all((prediction >= 0) & (prediction <= 1))
        assert np.mean((prediction >= 0.5) == (dataset.labels[dataset.test_index] >= 0.5)) >= 0.6
    else:
        assert np.corrcoef(prediction, dataset.target[dataset.test_index])[0, 1] >= 0.6


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_bars_after_t_never_move_the_prediction_at_t(task, dataset):
    adapter = fitted(dataset, task)
    generator = np.random.default_rng(3)
    for row in (int(dataset.test_index[10]), int(dataset.test_index[200])):
        perturbed = dataset.features.copy()
        perturbed[row + 1:] = generator.normal(0, 25, perturbed[row + 1:].shape)
        before = predict(adapter, dataset.features, [row])
        assert predict(adapter, perturbed, [row])[0] == before[0]
        rows = [row - 5, row - 1, row]
        np.testing.assert_allclose(predict(adapter, perturbed, rows), predict(adapter, dataset.features, rows),
                                   rtol=0, atol=1e-6)
        # a bar before the window cannot move it either; the bar being predicted does
        outside = dataset.features.copy()
        outside[row - SEQUENCE_LENGTH] += 5.0
        assert predict(adapter, outside, [row])[0] == before[0]
        own_bar = dataset.features.copy()
        own_bar[row] = generator.normal(0, 3, own_bar[row].shape)
        assert predict(adapter, own_bar, [row])[0] != pytest.approx(before[0], abs=1e-9)


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_a_single_row_equals_the_batch(task, dataset):
    adapter = fitted(dataset, task)
    index = dataset.test_index[:300]
    batched = predict(adapter, dataset.features, index)
    assert batched.dtype == np.float64 and batched.shape == index.shape
    assert np.unique(np.round(batched, 4)).size > 10, "predictions are constant"
    for position in (0, 7, 150, 299):
        assert abs(predict(adapter, dataset.features, index[position:position + 1])[0] - batched[position]) < 1e-6


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_save_and_load_reproduce_the_predictions_and_the_trace(task, dataset, tmp_path):
    adapter = fitted(dataset, task)
    adapter.save(str(tmp_path))
    metadata = json.loads((tmp_path / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["network"], metadata["task"]) == ("neural", KEY, KEY, task)
    reloaded = load_adapter(str(tmp_path), device="cpu")
    assert isinstance(reloaded, NeuralAdapter) and reloaded.network_kind == KEY
    assert reloaded.parameters == adapter.parameters and reloaded.best_iteration == adapter.best_iteration
    index = dataset.test_index[:60]
    np.testing.assert_allclose(predict(reloaded, dataset.features, index), predict(adapter, dataset.features, index),
                               rtol=0, atol=1e-6)
    row = int(index[3])
    assert reloaded.trace(dataset.features, row) == adapter.trace(dataset.features, row)


# ─── trace (Inside the model) ───────────────────────────────────────────────


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_the_trace_reproduces_the_logit_from_the_head_input(task, dataset):
    adapter = fitted(dataset, task)
    for row in (int(dataset.test_index[0]), int(dataset.test_index[123])):
        trace = adapter.trace(dataset.features, row)
        assert set(trace) == {"layers", "attention", "logit"} and math.isfinite(trace["logit"])
        assert abs(adapter.apply_head(head_input(trace)) - trace["logit"]) <= 1e-5
        output = predict(adapter, dataset.features, [row])[0]
        if task == "classification":
            assert abs(1.0 / (1.0 + math.exp(-trace["logit"])) - output) <= 1e-6
        else:
            assert abs(trace["logit"] - output) <= 1e-6


def test_the_trace_layers_and_attention_have_the_documented_shapes(dataset):
    adapter = fitted(dataset)
    row = int(dataset.test_index[5])
    trace = adapter.trace(dataset.features, row)
    hidden, slots, width, heads = 16, 8, 8, 2
    expected = [
        ("Controller state", "controller_gated_recurrent_unit", [SEQUENCE_LENGTH, hidden]),
        ("Memory write weights", "memory_write_addressing", [SEQUENCE_LENGTH, slots]),
        ("Memory read weights (head 1)", "memory_read_addressing", [SEQUENCE_LENGTH, slots]),
        ("Memory read weights (head 2)", "memory_read_addressing", [SEQUENCE_LENGTH, slots]),
        ("Memory read vectors", "memory_read", [SEQUENCE_LENGTH, heads * width]),
        ("Controller state with memory reads", "readout", [hidden + heads * width]),
    ]
    assert [(layer["name"], layer["kind"], layer["shape"]) for layer in trace["layers"]] == expected
    for layer in trace["layers"]:
        assert len(layer["values"]) == int(np.prod(layer["shape"]))
        assert all(math.isfinite(value) for value in layer["values"])
    # every addressing row is a distribution over the slots
    for name in ("Memory write weights", "Memory read weights (head 1)", "Memory read weights (head 2)"):
        (layer,) = [layer for layer in trace["layers"] if layer["name"] == name]
        weights = np.asarray(layer["values"]).reshape(layer["shape"])
        assert np.all(weights >= 0) and np.allclose(weights.sum(axis=1), 1.0, atol=1e-6)
    # no attention block: the read weights run over memory slots, not over the window's bars
    assert trace["attention"] == []
    # the read vectors are each head's weights applied to the memory: the heads differ
    first, second = (np.asarray(trace["layers"][index]["values"]).reshape(SEQUENCE_LENGTH, slots) for index in (2, 3))
    assert not np.allclose(first, second)
    # the head input is the last controller state joined with the last read vectors
    states = np.asarray(trace["layers"][0]["values"]).reshape(SEQUENCE_LENGTH, hidden)
    reads = np.asarray(trace["layers"][4]["values"]).reshape(SEQUENCE_LENGTH, heads * width)
    np.testing.assert_array_equal(head_input(trace), np.r_[states[-1], reads[-1]])
    described = adapter.describe()
    assert described["network"] == KEY and described["hasAttention"] is False
    assert described["sequenceLength"] == SEQUENCE_LENGTH
    assert described["layers"] == [{"name": name, "kind": kind, "outputShape": shape} for name, kind, shape in expected]
    assert module.describe(adapter.network, SEQUENCE_LENGTH) == described["layers"]


def test_trace_leaves_the_network_untouched(dataset):
    adapter = fitted(dataset)
    before = {name: value.clone() for name, value in adapter.network.state_dict().items()}
    torch.manual_seed(123)
    expected = torch.rand(3)
    torch.manual_seed(123)
    adapter.trace(dataset.features, int(dataset.test_index[9]))
    assert torch.equal(torch.rand(3), expected)
    assert all(torch.equal(value, adapter.network.state_dict()[name]) for name, value in before.items())


# ─── one engine fold on real MNQ 5m bars from the lake ─────────────────────


def load_verify_script():
    specification = importlib.util.spec_from_file_location("verify_cycle_explain", VERIFY_SCRIPT)
    loaded = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(loaded)
    return loaded


@pytest.fixture(scope="module")
def real_market():
    """MNQ 5m bars of ``REAL_WINDOW`` read from the lake, with the engine's own causal features."""
    from cycle.engine import clean_market_data
    from cycle.features import build_features
    from shared import protocol

    try:
        from shared.data import load_ohlcv_arrays

        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(protocol, "emit", lambda event: None)
            raw = load_ohlcv_arrays(REAL_SYMBOL, REAL_TIMEFRAME, max_bars=0, date_range=REAL_WINDOW)
    except Exception as error:  # noqa: BLE001 - the lake (AIStor on :9100) is a service, not a package
        pytest.skip(f"the lake is not reachable for real {REAL_SYMBOL} bars: {type(error).__name__}: {error}")
    data, dropped = clean_market_data(raw)
    assert dropped == 0 and len(data) > 1_000
    features = build_features(data.as_dict())
    # the orderflow features cannot be computed from OHLCV alone and are dropped (as in main.py);
    # nothing is dropped for looking ahead
    assert features.names and not [name for name, reason in features.dropped.items() if "looks ahead" in reason]
    return data, features


def test_an_engine_fold_runs_on_real_bars_and_the_explainer_gates_pass(real_market, tmp_path, monkeypatch):
    import pyarrow.parquet as pq

    from cycle.engine import CycleEngine, CycleSettings
    from cycle.simulate import load_cost_model
    from shared import protocol

    data, features = real_market
    events: list[dict] = []
    monkeypatch.setattr(protocol, "emit", lambda event: events.append(json.loads(protocol.dumps_safe(event))))
    directory = tmp_path / f"cycle_extra_{KEY}"
    settings = CycleSettings(
        symbol=REAL_SYMBOL, timeframe=REAL_TIMEFRAME, model_id=directory.name, model_family=KEY,
        model_parameters=catalog.resolve_parameters(KEY, REAL_PARAMETERS), artifact_directory=str(directory),
        train_days=5, validation_fraction=0.2, test_days=1, step_days=0, fold_limit=1, expanding_window=False,
        label_horizon_bars=4, label_threshold_ticks=1.0, embargo_bars=2, long_only=False, holding_bars=0,
        stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1, tuning_trials=0, tuning_mode="reviewed_defaults",
        bars_per_second=0.0, start_paused=False, quiet_bars=True, log_every_batches=100, device="cpu", seed=42,
        land_in_lake=False,
    )
    engine = CycleEngine(settings, data, features, load_cost_model(REAL_SYMBOL),
                         lambda values, task="classification": build_adapter(KEY, values, "cpu", 42, task=task))
    engine.run()
    assert not [event for event in events if event["type"] == "error"], [e for e in events if e["type"] == "error"]
    assert events[-1]["type"] == "done"
    (plan,) = [event for event in events if event["type"] == "cycle_plan"]
    assert plan["explainKind"] == "neural" and plan["hasPriceModel"] is True
    assert {event.get("modelRole") for event in events if event["type"] == "cycle_epoch"} == {"direction", "price"}
    processed = [event for event in events if event["type"] == "cycle_bars" and event["role"] == "processed"]
    assert processed, "no processed bars"
    streamed_probabilities = [probability for event in processed for probability in event["probabilityUp"]]
    assert streamed_probabilities and all(
        probability is None or 0.0 <= probability <= 1.0 for probability in streamed_probabilities
    )
    (final,) = [event for event in events if event["type"] == "cycle_scoreboard" and event["scope"] == "final"]
    assert final["metrics"]["accuracy"] is not None and final["metrics"]["log_loss"] is not None
    assert engine.fold_count == 1

    # predictions.parquet is written and the reloaded fold model reproduces what the walk streamed
    predictions = pq.read_table(directory / "predictions.parquet").to_pydict()
    assert predictions["timestamp"]
    fold = directory / "fold_0"
    direction = load_adapter(str(fold))
    price = load_adapter(str(fold / "price_model"))
    assert (direction.task, price.task, direction.network_kind) == ("classification", "regression", KEY)
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
        # causality on the real features: bars after the row never move it
        perturbed = features.matrix.copy()
        perturbed[row + 1:] = 25.0
        assert direction.predict_probability(perturbed, np.array([row]))[0] == reloaded
        checked += 1
        if checked == 10:
            break
    assert checked == 10

    # the Inside-the-model gates (G1, G2, G4) on the run, the way the verify script runs them
    summary = load_verify_script().verify_run(directory, bars=8, seed=2, schema=False)
    assert summary["passed"] is True, summary
    assert set(summary["gates"]) == {"G1", "G2", "G4"}
    for gate in summary["gates"].values():
        assert gate["failed"] == 0 and gate["passed"] == 2 * 8
    print(f"\n[{KEY}] real {REAL_SYMBOL} {REAL_TIMEFRAME} bars {len(data)}, fitted rows "
          f"{engine.folds[0].train_index.size}, final metrics {final['metrics']}, "
          f"direction fit {direction.fit_summary if direction.fit_summary else 'reloaded'}")
