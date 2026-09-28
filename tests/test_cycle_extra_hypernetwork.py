"""The Model Cycle's Hypernetwork kind (``src/ml/cycle/networks_extra/hypernetwork.py``,
registry entry ``src/config/cycle_models/hypernetwork.json``).

Checked: the registry accepts the entry and Optuna is offered exactly the
parameters that carry a search block; ``models.build_adapter`` builds it for
both tasks through ``NeuralAdapter``; on a synthetic causal dataset it fits,
bars after t (and bars before the window) never move the prediction at t, one
row equals the batch, save -> ``models.load_adapter`` reproduces predictions,
and the trace's last layer summed is the logit (gate G4). Then one engine fold
on REAL MNQ 5m bars from the lake (skipped when the lake is unreachable):
a ``done`` event, every P(up) in [0, 1], ``predictions.parquet`` written,
causality on the walked bars, and ``scripts/verify_cycle_explain.py`` passing on
the run (what earns ``explainKind: "neural"``).
"""

from __future__ import annotations

import importlib.util
import json
import math
import time
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from cycle import catalog, networks  # noqa: E402
from cycle.adapter import BatchReport, EpochReport  # noqa: E402
from cycle.models import build_adapter, load_adapter  # noqa: E402
from cycle.networks import NeuralAdapter, head_input  # noqa: E402
from cycle.networks_extra import hypernetwork  # noqa: E402

KEY = "hypernetwork"
REPOSITORY = Path(__file__).resolve().parents[1]
VERIFY_SCRIPT = REPOSITORY / "scripts" / "verify_cycle_explain.py"
SEQUENCE_LENGTH = 8
FEATURE_COUNT = 6
FAST = {"epochs": 6, "batch_size": 64, "patience": 3, "learning_rate": 0.003, "sequence_length": SEQUENCE_LENGTH,
        "hypernetwork_hidden_size": 16, "target_hidden_size": 8, "context_embedding_size": 8}
SEARCHED = ("hypernetwork_hidden_size", "target_hidden_size", "context_embedding_size", "dropout",
            "learning_rate", "weight_decay")
NEVER_SEARCHED = ("sequence_length", "epochs", "patience", "batch_size")


# ─── synthetic causal data (tests/test_cycle_networks.py) ───────────────────


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


class RecordingTrial:
    """An Optuna-like trial that records which parameters were suggested."""

    def __init__(self) -> None:
        self.suggested: dict[str, str] = {}

    def suggest_categorical(self, name, choices):
        self.suggested[name] = "categorical"
        return choices[0]

    def suggest_int(self, name, low, high, log=False):
        self.suggested[name] = "int"
        return int(low)

    def suggest_float(self, name, low, high, log=False):
        self.suggested[name] = "float"
        return float(low)


@pytest.fixture(scope="module")
def dataset() -> Dataset:
    return Dataset()


def fitted(dataset: Dataset, task: str) -> tuple[NeuralAdapter, Reporter]:
    adapter = build_adapter(KEY, FAST, "cpu", 42, task=task)
    reporter = Reporter()
    labels = dataset.labels if task == "classification" else dataset.target
    adapter.fit(dataset.features, labels, dataset.train_index, dataset.validation_index, dataset.timestamps, reporter)
    return adapter, reporter


def predict(adapter: NeuralAdapter, features: np.ndarray, index) -> np.ndarray:
    index = np.atleast_1d(np.asarray(index, dtype=np.int64))
    if adapter.task == "regression":
        return adapter.predict_value(features, index)
    return adapter.predict_probability(features, index)


# ─── registry ──────────────────────────────────────────────────────────────


def test_the_registry_accepts_the_entry_and_the_kind_is_registered():
    registry = catalog.load_registry()
    entry = registry["models"][KEY]
    assert registry["files"][KEY] == "hypernetwork.json"
    assert entry["adapter"] == "neural" and entry["network"] == KEY and entry["sequence"] is True
    assert entry["implementation"] == "torch" and entry["price"] is not None
    assert entry["catalogSpecId"] == "neural-network-architectures-memory-routing-architectures-hypernetwork"
    assert KEY in networks.NETWORK_KINDS and KEY in networks.SEQUENCE_NETWORKS and KEY not in networks.ATTENTION_NETWORKS
    assert networks.NETWORK_EXTENSIONS[KEY] is hypernetwork
    for name in entry["parameters"]:   # full words only
        assert name == name.lower() and "_" in name or name in ("dropout", "epochs", "patience")


def test_optuna_is_offered_exactly_the_searchable_parameters():
    assert catalog.searchable_parameters(KEY) == SEARCHED
    trial = RecordingTrial()
    suggested = catalog.suggest_parameters(trial, KEY, catalog.defaults(KEY))
    assert tuple(trial.suggested) == SEARCHED
    for name in NEVER_SEARCHED:
        assert name not in trial.suggested
        assert suggested[name] == catalog.defaults(KEY)[name]
    assert suggested["hypernetwork_hidden_size"] == 32 and suggested["target_hidden_size"] == 16


# ─── the adapter ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_build_adapter_builds_the_hypernetwork_for_both_tasks(task):
    adapter = build_adapter(KEY, catalog.defaults(KEY), "cpu", 42, task=task)
    assert isinstance(adapter, NeuralAdapter)
    assert adapter.network_kind == KEY and adapter.task == task and adapter.step_unit == "epoch"
    assert adapter.minimum_history() == 32 == adapter.sequence_length
    assert adapter.parameters["hypernetwork_hidden_size"] == 64 and adapter.parameters["target_hidden_size"] == 32
    network = networks.build_network(KEY, adapter.parameters, FEATURE_COUNT)
    assert isinstance(network, hypernetwork.HypernetworkModule)
    assert network.generated_count == 32 * FEATURE_COUNT + 32 + 32 + 1
    assert network(torch.zeros(3, 32, FEATURE_COUNT)).shape == (3,)


def test_the_generated_weights_change_with_the_context():
    torch.manual_seed(0)
    network = hypernetwork.build({**FAST, "dropout": 0.0}, FEATURE_COUNT).eval()
    calm = torch.randn(1, SEQUENCE_LENGTH, FEATURE_COUNT) * 0.2
    wild = torch.randn(1, SEQUENCE_LENGTH, FEATURE_COUNT) * 3.0
    wild[:, -1] = calm[:, -1]   # the same last bar, a different regime
    _, calm_recorded = network.forward_detailed(calm)
    _, wild_recorded = network.forward_detailed(wild)
    assert not torch.allclose(calm_recorded["first_weight_norms"], wild_recorded["first_weight_norms"])
    assert not torch.allclose(network(calm), network(wild))


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_it_fits_causally_and_round_trips(task, dataset, tmp_path):
    adapter, reporter = fitted(dataset, task)
    assert reporter.step_unit == "epoch" and reporter.epochs and any(epoch.is_best for epoch in reporter.epochs)
    assert adapter.fit_summary["best_epoch"] >= 1 and adapter.best_iteration == adapter.fit_summary["best_epoch"]
    rows = dataset.test_index[:40]
    batch = predict(adapter, dataset.features, rows)
    assert batch.shape == (40,) and np.all(np.isfinite(batch))
    if task == "classification":
        assert np.all((batch >= 0.0) & (batch <= 1.0))
        # the planted signal is learned better than chance
        accuracy = float(np.mean((predict(adapter, dataset.features, dataset.test_index) >= 0.5) == (dataset.labels[dataset.test_index] >= 0.5)))
        assert accuracy > 0.6, accuracy
    # one row equals the batch
    for position, row in enumerate(rows[:5]):
        assert predict(adapter, dataset.features, [row])[0] == pytest.approx(batch[position], abs=1e-6)
    # causality: bars after t, and bars before the window, never move the prediction at t
    generator = np.random.default_rng(3)
    for row in rows[:5]:
        altered = dataset.features.copy()
        altered[row + 1:] = generator.standard_normal(altered[row + 1:].shape).astype(np.float32)
        altered[:row - SEQUENCE_LENGTH + 1] = generator.standard_normal(altered[:row - SEQUENCE_LENGTH + 1].shape).astype(np.float32)
        assert predict(adapter, altered, [row])[0] == pytest.approx(predict(adapter, dataset.features, [row])[0], abs=1e-6)
        inside = dataset.features.copy()
        inside[row - 1] += 2.0
        assert predict(adapter, inside, [row])[0] != pytest.approx(predict(adapter, dataset.features, [row])[0], abs=1e-6)
    # save / load
    folder = tmp_path / task
    path = adapter.save(str(folder))
    assert Path(path).name == "model.pt"
    metadata = json.loads((folder / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["network"], metadata["task"]) == ("neural", KEY, KEY, task)
    reloaded = load_adapter(str(folder))
    assert isinstance(reloaded, NeuralAdapter) and reloaded.network_kind == KEY and reloaded.task == task
    np.testing.assert_allclose(predict(reloaded, dataset.features, rows), batch, atol=1e-6)
    # trace: six layers, the last one summed is the logit (gate G4), the logit is the prediction
    trace = adapter.trace(dataset.features, int(rows[0]))
    assert [layer["name"] for layer in trace["layers"]] == list(hypernetwork.LAYER_NAMES)
    assert trace["attention"] == []
    shapes = [layer["shape"] for layer in trace["layers"]]
    assert shapes == [[2 * FEATURE_COUNT], [8], [16], [8], [8], [9]]
    for layer in trace["layers"]:
        assert len(layer["values"]) == math.prod(layer["shape"]) and all(math.isfinite(v) for v in layer["values"])
    assert float(np.sum(head_input(trace))) == pytest.approx(trace["logit"], abs=1e-6)
    assert adapter.apply_head(head_input(trace)) == pytest.approx(trace["logit"], abs=1e-5)
    expected = trace["logit"] if task == "regression" else 1.0 / (1.0 + math.exp(-trace["logit"]))
    assert expected == pytest.approx(batch[0], abs=1e-6)
    described = adapter.describe()
    assert described["network"] == KEY and described["sequenceLength"] == SEQUENCE_LENGTH and described["hasAttention"] is False
    assert [layer["outputShape"] for layer in described["layers"]] == shapes
    assert [layer["outputShape"] for layer in hypernetwork.describe(adapter.network)] == shapes


# ─── one engine fold on real MNQ 5m bars from the lake ─────────────────────


def load_real_market():
    """About 2,500 MNQ 5m bars ending 2025-12-10 (before the December roll), from the lake."""
    from cycle.engine import clean_market_data
    from cycle.features import build_features

    try:
        from shared.data import load_ohlcv_arrays

        raw = load_ohlcv_arrays("MNQ", "5m", max_bars=2500, date_range={"end": "2025-12-10"})
    except Exception as error:  # noqa: BLE001 - the lake (AIStor on :9100) may not be up on this machine
        pytest.skip(f"the lake is not reachable: {error}")
    data, _ = clean_market_data(raw)
    if len(data) < 2000:
        pytest.skip(f"only {len(data)} MNQ 5m bars came back from the lake")
    return data, build_features(data.as_dict())


def load_verify_script():
    specification = importlib.util.spec_from_file_location("verify_cycle_explain", VERIFY_SCRIPT)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def test_one_engine_fold_on_real_mnq_bars(tmp_path, monkeypatch):
    import pyarrow.parquet as pq

    from cycle.engine import CycleEngine, CycleSettings
    from cycle.simulate import load_cost_model
    from shared import protocol

    data, features = load_real_market()
    events: list[dict] = []
    monkeypatch.setattr(protocol, "emit", lambda event: events.append(json.loads(protocol.dumps_safe(event))))
    parameters = {**catalog.defaults(KEY), "epochs": 4, "patience": 3, "batch_size": 128, "sequence_length": 16,
                  "hypernetwork_hidden_size": 32, "target_hidden_size": 16, "context_embedding_size": 8}
    directory = tmp_path / "cycle_extra_hypernetwork"
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id="cycle_extra_hypernetwork", model_family=KEY,
        model_parameters=parameters, artifact_directory=str(directory),
        train_days=4, validation_fraction=0.2, test_days=1, step_days=0, fold_limit=1, expanding_window=False,
        label_horizon_bars=4, label_threshold_ticks=1.0, embargo_bars=2,
        long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1,
        tuning_trials=0, tuning_mode="reviewed_defaults", bars_per_second=0.0, start_paused=False, quiet_bars=True,
        log_every_batches=100, device="cpu", seed=42, land_in_lake=False,
    )
    engine = CycleEngine(settings, data, features, load_cost_model("MNQ"),
                         lambda values, task="classification": build_adapter(KEY, values, "cpu", 42, task=task))
    started = time.perf_counter()
    engine.run()
    seconds = time.perf_counter() - started
    assert not [event for event in events if event["type"] == "error"], [e for e in events if e["type"] == "error"]
    assert events[-1]["type"] == "done"
    (plan,) = [event for event in events if event["type"] == "cycle_plan"]
    assert plan["explainKind"] == "neural" and plan["hasPriceModel"] is True and plan["directionMode"] == "classifier"
    processed = [event for event in events if event["type"] == "cycle_bars" and event["role"] == "processed"]
    assert processed
    walked = sum(len(event["timestamps"]) for event in processed)
    assert walked > 0
    for event in processed:
        assert len(event["probabilityUp"]) == len(event["timestamps"])
        for probability in event["probabilityUp"]:
            assert probability is None or 0.0 <= probability <= 1.0, probability
    (final,) = [event for event in events if event["type"] == "cycle_scoreboard" and event["scope"] == "final"]
    fold = directory / "fold_0"
    metadata = json.loads((fold / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["network"]) == ("neural", KEY, KEY)
    direction = load_adapter(str(fold))
    price = load_adapter(str(fold / "price_model"))
    assert (direction.task, price.task) == ("classification", "regression")
    assert (directory / "predictions.parquet").is_file()
    predictions = pq.read_table(directory / "predictions.parquet").to_pydict()
    rows = {int(stamp): index for index, stamp in enumerate(data.timestamps)}
    checked = 0
    generator = np.random.default_rng(9)
    for stamp, probability in zip(predictions["timestamp"], predictions["probability_up"]):
        if probability is None:
            continue
        row = rows[int(stamp.timestamp()) if hasattr(stamp, "timestamp") else int(stamp)]
        assert 0.0 <= probability <= 1.0
        reloaded = direction.predict_probability(features.matrix, np.array([row]))[0]
        assert abs(reloaded - probability) <= 1e-6
        # causality on the walked bars: later rows altered, the same prediction
        altered = features.matrix.copy()
        altered[row + 1:] = generator.standard_normal(altered[row + 1:].shape).astype(np.float32)
        assert abs(direction.predict_probability(altered, np.array([row]))[0] - probability) <= 1e-6
        checked += 1
        if checked == 20:
            break
    assert checked == 20
    # "Inside the model" on this run: the gates of scripts/verify_cycle_explain.py
    summary = load_verify_script().verify_run(directory, bars=15, seed=0)
    assert summary["passed"], {"failures": summary["failures"], "errors": summary["errors"], "schema": summary.get("schema")}
    assert summary["gates"]["G1"]["failed"] == 0 and summary["gates"]["G4"]["failed"] == 0
    epochs = [event for event in events if event["type"] == "cycle_epoch" and event.get("modelRole") == "direction"]
    assert epochs and {event.get("modelRole") for event in events if event["type"] == "cycle_epoch"} == {"direction", "price"}
    best_validation_log_loss = min(event["validationLoss"] for event in epochs if event.get("validationLoss") is not None)
    metrics = final["metrics"]
    print(f"[smoke] hypernetwork MNQ 5m: {engine.folds[0].train_index.size} training rows fitted over {len(epochs)} epochs, "
          f"{walked} test bars walked, {seconds:.1f} s, best validation log loss {best_validation_log_loss:.4f}, "
          f"test accuracy {metrics['accuracy']:.4f}, test log loss {metrics['log_loss']:.4f}, "
          f"majority-class accuracy {metrics['majority_class_accuracy']:.4f}, net {metrics['net_profit_usd']:.2f} USD")
