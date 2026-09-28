"""The recurrent-convolution hybrid network kind
(``src/ml/cycle/networks_extra/recurrent_convolution_hybrid.py``, registry key
``recurrent_convolution_hybrid``).

Checked here: the registry entry loads on the Python side and its search
space is exactly the parameters that carry a ``search`` block; the adapter
builds through ``cycle.models.build_adapter`` for both tasks; the network is
causal inside its window and as a fitted adapter (bars after t never move the
prediction at t); a single row equals the batch; save / load reproduces the
predictions to 1e-6; the trace carries [time, units] layers whose last row the
head turns back into the logit (gate G4); and one Model Cycle fold runs on
REAL MNQ 5-minute bars read from the lake (nothing is written to it), with
the explain gates of ``scripts/verify_cycle_explain.py`` passing on the run.
"""

from __future__ import annotations

import importlib.util
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from cycle import catalog, models  # noqa: E402
from cycle.adapter import BatchReport, EpochReport  # noqa: E402
from cycle.models import build_adapter, load_adapter  # noqa: E402
from cycle.networks import (  # noqa: E402
    ATTENTION_NETWORKS,
    NETWORK_EXTENSIONS,
    SEQUENCE_NETWORKS,
    NeuralAdapter,
    build_network,
    head_input,
)
from cycle.networks_extra import recurrent_convolution_hybrid as hybrid  # noqa: E402

KEY = "recurrent_convolution_hybrid"
KIND = "recurrent_convolution_hybrid"
REPOSITORY = Path(__file__).resolve().parents[1]
VERIFY_SCRIPT = REPOSITORY / "scripts" / "verify_cycle_explain.py"

SEQUENCE_LENGTH = 8
FEATURE_COUNT = 6
FAST = {
    "sequence_length": SEQUENCE_LENGTH, "channel_count": 8, "kernel_size": 3, "convolution_layer_count": 2,
    "hidden_size": 16, "recurrent_layer_count": 2, "dropout": 0.1,
    "epochs": 8, "batch_size": 64, "patience": 3, "learning_rate": 0.003,
}
SEARCHED = {"channel_count", "kernel_size", "convolution_layer_count", "hidden_size", "recurrent_layer_count",
            "dropout", "learning_rate", "weight_decay"}
NEVER_SEARCHED = {"sequence_length", "epochs", "patience", "batch_size"}

# The lake window of the engine run: three weeks of MNQ 5-minute bars (about 4,000),
# of which one walk-forward fold (7 training days, 1 test day) is run.
LAKE_START, LAKE_END = "2025-06-02", "2025-06-21"
ENGINE_PARAMETERS = {
    "sequence_length": 16, "channel_count": 8, "kernel_size": 3, "convolution_layer_count": 2,
    "hidden_size": 12, "recurrent_layer_count": 2, "dropout": 0.1,
    "epochs": 3, "patience": 3, "batch_size": 256,
}


# ─── the registry entry ─────────────────────────────────────────────────────


def test_the_registry_loads_the_entry_from_its_own_file():
    registry = catalog.load_registry()
    assert registry["files"][KEY] == f"{KEY}.json"
    entry = registry["models"][KEY]
    assert entry["catalogSpecId"] == "hybrid-composite-architectures-classical-hybrids-rnn-cnn-hybrid"
    assert (entry["adapter"], entry["implementation"], entry["network"]) == ("neural", "torch", KIND)
    assert entry["runnable"] is True and entry["unavailableReason"] is None
    assert entry["sequence"] is True and entry["price"] is not None
    assert entry["explainKind"] == "neural" and entry["direction"]["probability"] == "network"
    assert entry["preprocess"] == []   # NeuralAdapter applies no scaler: the engine's features are already z-scored
    for name, spec in entry["parameters"].items():
        assert "_" in name or name.isalpha(), name
        assert spec["description"], f"{name} has no description"


def test_the_kind_is_registered_and_marked_as_a_sequence_network_without_attention():
    assert NETWORK_EXTENSIONS[KIND] is hybrid
    assert KIND in SEQUENCE_NETWORKS and KIND not in ATTENTION_NETWORKS
    assert hybrid.SEQUENCE is True and hybrid.ATTENTION is False


class RecordingTrial:
    """An Optuna-shaped trial that records the names it is asked to suggest."""

    def __init__(self) -> None:
        self.names: list[str] = []

    def suggest_categorical(self, name, choices):
        self.names.append(name)
        return choices[0]

    def suggest_int(self, name, low, high, log=False):
        self.names.append(name)
        return low

    def suggest_float(self, name, low, high, log=False):
        self.names.append(name)
        return low


def test_the_search_space_is_exactly_the_parameters_with_a_search_block():
    entry = catalog.entry(KEY)
    with_search = {name for name, spec in entry["parameters"].items() if spec.get("search")}
    assert with_search == SEARCHED
    assert NEVER_SEARCHED <= set(entry["parameters"]) and not (NEVER_SEARCHED & with_search)
    trial = RecordingTrial()
    suggested = models.suggest_parameters(trial, KEY, catalog.defaults(KEY))
    assert set(trial.names) == SEARCHED and len(trial.names) == len(SEARCHED)
    assert set(suggested) == set(entry["parameters"])
    for name in NEVER_SEARCHED:
        assert suggested[name] == catalog.defaults(KEY)[name]
    assert suggested["channel_count"] == 16 and suggested["convolution_layer_count"] == 1


# ─── construction ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_build_adapter_builds_the_hybrid_for_both_tasks(task):
    adapter = build_adapter(KEY, catalog.defaults(KEY), "cpu", 42, task=task)
    assert isinstance(adapter, NeuralAdapter)
    assert (adapter.key, adapter.family, adapter.task, adapter.network_kind) == (KEY, KEY, task, KIND)
    assert adapter.minimum_history() == catalog.defaults(KEY)["sequence_length"] == 32
    assert adapter.step_unit == "epoch"
    assert adapter.parameters == catalog.resolve_parameters(KEY, catalog.defaults(KEY))


def test_build_network_shapes_and_refusals():
    parameters = catalog.resolve_parameters(KEY, FAST)
    torch.manual_seed(0)
    network = build_network(KIND, parameters, FEATURE_COUNT)
    assert isinstance(network, hybrid.RecurrentConvolutionHybrid)
    assert len(network.convolutions) == 2 and network.recurrent.num_layers == 2
    window = torch.randn(5, SEQUENCE_LENGTH, FEATURE_COUNT)
    with torch.no_grad():
        assert network.convolution_output(window).shape == (5, SEQUENCE_LENGTH, 8)
        assert network.sequence_output(window).shape == (5, SEQUENCE_LENGTH, 16)
        assert network(window).shape == (5,)
    with pytest.raises(ValueError, match="missing parameters"):
        hybrid.build({"channel_count": 8}, FEATURE_COUNT)
    with pytest.raises(ValueError, match="dropout"):
        hybrid.build({**parameters, "dropout": 1.0}, FEATURE_COUNT)
    with pytest.raises(ValueError, match="convolution_layer_count"):
        hybrid.build({**parameters, "convolution_layer_count": 0}, FEATURE_COUNT)
    with pytest.raises(ValueError):
        build_adapter(KEY, {"kernel_size": 1}, "cpu", 0)   # the registry's minimum is 2


def test_sequence_output_is_causal_inside_the_window():
    parameters = catalog.resolve_parameters(KEY, FAST)
    torch.manual_seed(0)
    network = build_network(KIND, parameters, FEATURE_COUNT).eval()
    window = torch.randn(3, SEQUENCE_LENGTH, FEATURE_COUNT)
    with torch.no_grad():
        reference = network.sequence_output(window)
        for position in (1, 4, SEQUENCE_LENGTH - 1):
            changed = window.clone()
            changed[:, position:] += torch.randn_like(changed[:, position:]) * 10
            output = network.sequence_output(changed)
            assert torch.allclose(output[:, :position], reference[:, :position], atol=1e-5)
            assert not torch.allclose(output[:, position], reference[:, position], atol=1e-5)


# ─── a synthetic causal dataset for the fast adapter checks ─────────────────


class Dataset:
    """Bar t's label mixes bar t's features with lagged features at t-1 and t-3."""

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


def fitted(data: Dataset, task: str) -> NeuralAdapter:
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
        # a bar before the window cannot move it either; the bar itself does
        outside = dataset.features.copy()
        outside[row - SEQUENCE_LENGTH] += 5.0
        assert predict(adapter, outside, [row])[0] == before[0]
        own_bar = dataset.features.copy()
        own_bar[row] = generator.normal(0, 3, own_bar[row].shape)
        assert predict(adapter, own_bar, [row])[0] != pytest.approx(before[0], abs=1e-9)


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_a_single_row_equals_the_batch_and_the_model_learns(task, dataset):
    adapter = fitted(dataset, task)
    index = dataset.test_index[:300]
    batched = predict(adapter, dataset.features, index)
    assert batched.dtype == np.float64 and batched.shape == index.shape
    assert np.unique(np.round(batched, 4)).size > 10, "predictions are constant"
    for position in (0, 7, 150, 299):
        assert abs(predict(adapter, dataset.features, index[position:position + 1])[0] - batched[position]) < 1e-6
    assert adapter.best_iteration is not None and 1 <= adapter.best_iteration <= FAST["epochs"]
    prediction = predict(adapter, dataset.features, dataset.test_index)
    if task == "classification":
        assert np.all((prediction >= 0.0) & (prediction <= 1.0))
        labels = dataset.labels[dataset.test_index]
        assert np.mean((prediction >= 0.5) == (labels >= 0.5)) >= 0.6
    else:
        assert np.corrcoef(prediction, dataset.target[dataset.test_index])[0, 1] >= 0.6


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_save_and_load_reproduce_the_predictions(task, dataset, tmp_path):
    adapter = fitted(dataset, task)
    path = adapter.save(str(tmp_path))
    metadata = json.loads((tmp_path / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["network"], metadata["task"]) == ("neural", KEY, KIND, task)
    state = torch.load(path, map_location="cpu", weights_only=True)
    assert (state["key"], state["network"]) == (KEY, KIND)
    reloaded = load_adapter(str(tmp_path), device="cpu")
    assert isinstance(reloaded, NeuralAdapter) and reloaded.network_kind == KIND and reloaded.task == task
    assert reloaded.parameters == adapter.parameters
    index = dataset.test_index[:80]
    np.testing.assert_allclose(predict(reloaded, dataset.features, index), predict(adapter, dataset.features, index),
                               rtol=0, atol=1e-6)
    row = int(index[3])
    assert reloaded.trace(dataset.features, row) == adapter.trace(dataset.features, row)


# ─── trace (Inside the model) ───────────────────────────────────────────────


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_trace_records_every_layer_and_the_head_reproduces_the_logit(task, dataset):
    adapter = fitted(dataset, task)
    for row in (int(dataset.test_index[0]), int(dataset.test_index[123])):
        trace = adapter.trace(dataset.features, row)
        assert set(trace) == {"layers", "attention", "logit"} and trace["attention"] == []
        assert math.isfinite(trace["logit"])
        names = [layer["name"] for layer in trace["layers"]]
        assert names == ["Causal convolution layer 1 (relu)", "Causal convolution layer 2 (relu)",
                         "Gated recurrent unit layer 1", "Gated recurrent unit layer 2"]
        assert [layer["kind"] for layer in trace["layers"]] == ["convolution"] * 2 + ["gated_recurrent_unit"] * 2
        assert [layer["shape"] for layer in trace["layers"]] == [[SEQUENCE_LENGTH, 8]] * 2 + [[SEQUENCE_LENGTH, 16]] * 2
        for layer in trace["layers"]:
            assert len(layer["values"]) == int(np.prod(layer["shape"]))
            assert all(math.isfinite(value) for value in layer["values"])
        convolution = np.asarray(trace["layers"][0]["values"])
        assert np.all(convolution >= 0.0), "a rectified linear unit output is never negative"
        # G4: the head on the last recorded row is the logit, by the adapter and by hand
        assert abs(adapter.apply_head(head_input(trace)) - trace["logit"]) <= 1e-5
        head = adapter.network.head
        by_hand = float(head.weight.detach().double().numpy()[0] @ head_input(trace) + head.bias.detach().double().numpy()[0])
        assert abs(by_hand - trace["logit"]) <= 1e-5
        output = predict(adapter, dataset.features, [row])[0]
        if task == "classification":
            assert abs(1.0 / (1.0 + math.exp(-trace["logit"])) - output) <= 1e-6
        else:
            assert abs(trace["logit"] - output) <= 1e-6
    described = adapter.describe()
    assert described["network"] == KIND and described["hasAttention"] is False
    assert described["sequenceLength"] == SEQUENCE_LENGTH
    assert described["layers"] == [{"name": layer["name"], "kind": layer["kind"], "outputShape": layer["shape"]}
                                   for layer in trace["layers"]]
    assert hybrid.describe(adapter.network, SEQUENCE_LENGTH) == described["layers"]


def test_the_recorded_recurrent_layers_chain(dataset):
    """Layer 1's recorded output is what the top layer ran on: re-running the top
    layer's weights on it gives the recorded top layer, and the convolution maps
    recorded are what layer 1 read."""
    from torch import nn

    adapter = fitted(dataset, "classification")
    row = int(dataset.test_index[40])
    trace = adapter.trace(dataset.features, row)
    maps, first, second = (np.asarray(layer["values"], dtype=np.float32).reshape(layer["shape"])
                           for layer in trace["layers"][1:])
    module = adapter.network.recurrent
    with torch.no_grad():
        window = torch.from_numpy(dataset.features[row - SEQUENCE_LENGTH + 1:row + 1][None].copy())
        np.testing.assert_allclose(adapter.network.convolution_output(window)[0].numpy(), maps, rtol=0, atol=1e-6)
        top = nn.GRU(module.hidden_size, module.hidden_size, batch_first=True)
        top.load_state_dict({name.replace("_l1", "_l0"): value for name, value in module.state_dict().items()
                             if name.endswith("_l1")})
        rebuilt = top(torch.from_numpy(first)[None])[0][0].numpy()
    np.testing.assert_allclose(rebuilt, second, rtol=0, atol=1e-5)


def test_trace_needs_eval_mode_and_leaves_no_hooks(dataset):
    adapter = fitted(dataset, "classification")
    adapter.trace(dataset.features, int(dataset.test_index[9]))
    assert not adapter.network._forward_hooks and not adapter.network.recurrent._forward_hooks
    assert not any(layer._forward_hooks for layer in adapter.network.convolutions)
    with pytest.raises(RuntimeError, match="eval mode"):
        hybrid.trace(adapter.network.train(), torch.zeros(1, SEQUENCE_LENGTH, FEATURE_COUNT))
    adapter.network.eval()


# ─── one Model Cycle fold on real MNQ bars from the lake ────────────────────


@dataclass
class Run:
    directory: Path
    engine: object
    events: list[dict]
    data: object
    features: object


def load_lake_market():
    """MNQ 5-minute bars and the engine's causal features, exactly as
    ``src/ml/cycle/main.py`` builds them (read-only: nothing is landed)."""
    from cycle.engine import MarketData, clean_market_data
    from cycle.features import build_features
    from cycle.rolls import back_adjust, contract_rows_from_lake, find_rolls
    from shared.data import _serving, load_ohlcv_arrays

    raw = load_ohlcv_arrays("MNQ", "5m", max_bars=0, date_range={"start": LAKE_START, "end": LAKE_END})
    data, _ = clean_market_data(raw)
    rows = contract_rows_from_lake(_serving(), "MNQ", "5m", int(data.timestamps[0]), int(data.timestamps[-1]))
    rolls = find_rolls(data.timestamps, data.open, data.close, rows) if rows else []
    if rolls:
        open_prices, high, low, close, _ = back_adjust(data.open, data.high, data.low, data.close, rolls)
        data = MarketData(timestamps=data.timestamps, open=open_prices, high=high, low=low, close=close,
                          volume=data.volume)
    return data, build_features(data.as_dict())


@pytest.fixture(scope="module")
def lake_run(tmp_path_factory) -> Run:
    from cycle.engine import CycleEngine, CycleSettings
    from cycle.simulate import load_cost_model
    from shared import protocol

    try:
        data, features = load_lake_market()
    except Exception as error:  # noqa: BLE001 - the lake (AIStor on :9100) is not reachable on every machine
        pytest.skip(f"the lake is not reachable for real MNQ bars: {type(error).__name__}: {error}")
    assert len(data) > 2_000, "three weeks of MNQ 5-minute bars"
    directory = tmp_path_factory.mktemp("cycle_hybrid_lake_run") / f"cycle_{KEY}"
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id=f"cycle_{KEY}", model_family=KEY,
        model_parameters=catalog.resolve_parameters(KEY, ENGINE_PARAMETERS), artifact_directory=str(directory),
        train_days=7, validation_fraction=0.2, test_days=1, step_days=0, fold_limit=1, expanding_window=False,
        label_horizon_bars=4, label_threshold_ticks=1.0, embargo_bars=2,
        long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1,
        tuning_trials=0, tuning_mode="reviewed_defaults", bars_per_second=0.0, start_paused=False, quiet_bars=True,
        log_every_batches=100, device="cpu", seed=42, land_in_lake=False,
    )
    events: list[dict] = []
    engine = CycleEngine(settings, data, features, load_cost_model("MNQ"),
                         lambda values, task="classification": build_adapter(KEY, values, "cpu", 42, task=task))
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(protocol, "emit", lambda event: events.append(json.loads(protocol.dumps_safe(event))))
        engine.run()
    return Run(directory, engine, events, data, features)


def test_the_engine_run_completes_on_real_bars(lake_run):
    events = lake_run.events
    assert not [event for event in events if event["type"] == "error"]
    assert events[-1]["type"] == "done" and events[-1]["diagnostics"]["stopped"] is False
    (plan,) = [event for event in events if event["type"] == "cycle_plan"]
    assert plan["explainKind"] == "neural" and plan["hasPriceModel"] is True and plan["modelFamily"] == KEY
    assert {event.get("modelRole") for event in events if event["type"] == "cycle_epoch"} == {"direction", "price"}
    processed = [event for event in events if event["type"] == "cycle_bars" and event["role"] == "processed"]
    probabilities = [value for event in processed for value in event["probabilityUp"]]
    assert 100 <= len(probabilities) <= 1_000, "a few hundred test bars"
    known = [value for value in probabilities if value is not None]
    assert known and all(0.0 <= value <= 1.0 for value in known)
    assert len({round(value, 4) for value in known}) > 10, "P(up) is not constant"
    (final,) = [event for event in events if event["type"] == "cycle_scoreboard" and event["scope"] == "final"]
    assert final["metrics"]["accuracy"] is not None and final["metrics"]["log_loss"] is not None
    assert (lake_run.directory / "predictions.parquet").is_file()
    assert (lake_run.directory / "fold_0" / "model.json").is_file()
    assert (lake_run.directory / "fold_0" / "price_model" / "model.json").is_file()
    print(f"\n[{KEY}] final scoreboard: " + ", ".join(
        f"{name} {value:.4f}" for name, value in final["metrics"].items() if value is not None))
    fold_summary = lake_run.engine.folds[0]
    print(f"[{KEY}] fold 0: {fold_summary.train_index.size} training rows, {fold_summary.validation_index.size} "
          f"validation rows, {fold_summary.test_index.size} test bars")


def test_the_reloaded_fold_model_reproduces_the_walk_and_is_causal_on_real_bars(lake_run):
    import pyarrow.parquet as pq

    direction = load_adapter(str(lake_run.directory / "fold_0"))
    price = load_adapter(str(lake_run.directory / "fold_0" / "price_model"))
    assert (direction.task, price.task) == ("classification", "regression")
    assert direction.network_kind == price.network_kind == KIND
    matrix = lake_run.features.matrix
    predictions = pq.read_table(lake_run.directory / "predictions.parquet").to_pydict()
    rows = {int(stamp): index for index, stamp in enumerate(lake_run.data.timestamps)}
    checked = 0
    generator = np.random.default_rng(5)
    for stamp, probability in zip(predictions["timestamp"], predictions["probability_up"]):
        if probability is None:
            continue
        row = rows[int(stamp.timestamp()) if hasattr(stamp, "timestamp") else int(stamp)]
        reloaded = direction.predict_probability(matrix, np.array([row]))[0]
        assert abs(reloaded - probability) <= 1e-6
        trace = direction.trace(matrix, row)
        assert abs(1.0 / (1.0 + math.exp(-trace["logit"])) - probability) <= 1e-6
        # causality on the real feature matrix: rows after the bar never move its prediction
        perturbed = matrix.copy()
        perturbed[row + 1:] = generator.normal(0, 25, perturbed[row + 1:].shape).astype(np.float32)
        assert direction.predict_probability(perturbed, np.array([row]))[0] == reloaded
        assert price.predict_value(perturbed, np.array([row]))[0] == price.predict_value(matrix, np.array([row]))[0]
        checked += 1
        if checked == 25:
            break
    assert checked == 25


def test_the_explain_gates_pass_on_the_real_run(lake_run):
    """explainKind "neural" is earned: scripts/verify_cycle_explain.py passes on the run."""
    specification = importlib.util.spec_from_file_location("verify_cycle_explain", VERIFY_SCRIPT)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    summary = module.verify_run(lake_run.directory, bars=12, seed=2, schema=True)
    assert summary["passed"] is True, summary
    assert set(summary["gates"]) == {"G1", "G2", "G4"}
    for gate in summary["gates"].values():
        assert gate["failed"] == 0 and gate["passed"] == 2 * 12
    if summary["schema"] is not None:
        assert summary["schema"]["failures"] == []
    print(f"\n[{KEY}] explain gates: " + ", ".join(
        f"{name} {tally['passed']} passed (largest error {tally['maximumError']})"
        for name, tally in sorted(summary["gates"].items()))
        + (" ; schema not checked (node and tsx needed)" if summary["schema"] is None else " ; schema valid"))
