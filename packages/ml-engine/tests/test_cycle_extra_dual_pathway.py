"""The Model Cycle's Dual-pathway network kind (``packages/ml-engine/src/cycle/networks_extra/dual_pathway.py``,
registry entry ``packages/config/cycle_models/dual_pathway.json``).

Checked: the registry accepts the entry and Optuna is offered exactly the
parameters that carry a search block; ``models.build_adapter`` builds it for
both tasks through ``NeuralAdapter``; the two views are what the docstring
says (the fast view is the last bars, the slow view every k-th bar ending on
the last bar, a too-long fast window is clamped); on a synthetic causal
dataset it fits, bars after t (and bars before the window) never move the
prediction at t, one row equals the batch, save -> ``models.load_adapter``
reproduces predictions, and the head applied to the trace's last layer is the
logit (gate G4). Then one engine fold on REAL MNQ 5m bars from the lake
(skipped when the lake is unreachable): a ``done`` event, every P(up) in
[0, 1], ``predictions.parquet`` written, causality on the walked bars, and
``scripts/verify_cycle_explain.py`` passing on the run (what earns
``explainKind: "neural"``).
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
from cycle.networks_extra import dual_pathway  # noqa: E402

KEY = "dual_pathway"
REPOSITORY = Path(__file__).resolve().parents[1]
VERIFY_SCRIPT = REPOSITORY / "scripts" / "verify_cycle_explain.py"
SEQUENCE_LENGTH = 8
FAST_WINDOW = 4
SLOW_STRIDE = 2
FEATURE_COUNT = 6
FAST = {"epochs": 8, "batch_size": 64, "patience": 3, "learning_rate": 0.003, "sequence_length": SEQUENCE_LENGTH,
        "fast_window_bars": FAST_WINDOW, "slow_stride": SLOW_STRIDE, "pathway_hidden_size": 16, "fusion_hidden_size": 16}
SEARCHED = ("fast_window_bars", "slow_stride", "pathway_hidden_size", "fusion_hidden_size", "dropout",
            "learning_rate", "weight_decay", "batch_size")
NEVER_SEARCHED = ("sequence_length", "epochs", "patience")


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
    assert registry["files"][KEY] == "dual_pathway.json"
    assert entry["adapter"] == "neural" and entry["network"] == KEY and entry["sequence"] is True
    assert entry["implementation"] == "torch" and entry["price"] is not None and entry["explainKind"] == "neural"
    assert entry["catalogSpecId"] == "neural-network-architectures-specialized-modular-networks-dual-pathway-network"
    assert KEY in networks.NETWORK_KINDS and KEY in networks.SEQUENCE_NETWORKS and KEY not in networks.ATTENTION_NETWORKS
    assert networks.NETWORK_EXTENSIONS[KEY] is dual_pathway
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
    assert suggested["fast_window_bars"] == 8 and suggested["slow_stride"] == 2
    assert suggested["pathway_hidden_size"] == 32 and suggested["fusion_hidden_size"] == 32


# ─── the network ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("task", ["classification", "regression"])
def test_build_adapter_builds_the_dual_pathway_network_for_both_tasks(task):
    adapter = build_adapter(KEY, catalog.defaults(KEY), "cpu", 42, task=task)
    assert isinstance(adapter, NeuralAdapter)
    assert adapter.network_kind == KEY and adapter.task == task and adapter.step_unit == "epoch"
    assert adapter.minimum_history() == 64 == adapter.sequence_length
    assert adapter.parameters["fast_window_bars"] == 16 and adapter.parameters["slow_stride"] == 4
    network = networks.build_network(KEY, adapter.parameters, FEATURE_COUNT)
    assert isinstance(network, dual_pathway.DualPathwayNetwork)
    assert network.fast_window_bars == 16 and network.slow_view_length() == 16 and not network.fast_window_clamped
    assert network(torch.zeros(3, 64, FEATURE_COUNT)).shape == (3,)


def test_the_two_views_end_on_the_last_bar_and_a_long_fast_window_is_clamped():
    network = dual_pathway.build({**FAST, "dropout": 0.0}, FEATURE_COUNT).eval()
    window = torch.arange(SEQUENCE_LENGTH, dtype=torch.float32)[None, :, None].expand(1, SEQUENCE_LENGTH, FEATURE_COUNT)
    assert network.fast_view(window)[0, :, 0].tolist() == [4.0, 5.0, 6.0, 7.0]
    assert network.slow_view(window)[0, :, 0].tolist() == [1.0, 3.0, 5.0, 7.0]
    # the slow view always ends on the last bar, whatever the remainder of the division
    for length, stride in ((64, 4), (64, 8), (63, 4), (16, 3), (5, 8)):
        start = dual_pathway.slow_view_start(length, stride)
        positions = list(range(start, length, stride))
        assert positions[-1] == length - 1 and len(positions) == dual_pathway.slow_view_length(length, stride)
        assert all(0 <= position < length for position in positions)
    clamped = dual_pathway.build({**FAST, "dropout": 0.0, "fast_window_bars": 100}, FEATURE_COUNT)
    assert clamped.fast_window_bars == SEQUENCE_LENGTH and clamped.fast_window_clamped
    # the fusion gate sits in (0, 1) and the trace's four layers have the documented shapes
    trace = dual_pathway.trace(network, torch.randn(1, SEQUENCE_LENGTH, FEATURE_COUNT))
    assert [layer["kind"] for layer in trace["layers"]] == list(dual_pathway.LAYER_KINDS)
    assert [layer["shape"] for layer in trace["layers"]] == [[FAST_WINDOW, 16], [4, 16], [32], [16]]
    assert all(0.0 < value < 1.0 for value in trace["layers"][2]["values"])


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
        inside[row - 1] += 2.0   # inside the fast view
        assert predict(adapter, inside, [row])[0] != pytest.approx(predict(adapter, dataset.features, [row])[0], abs=1e-6)
        slow_only = dataset.features.copy()
        slow_only[row - SEQUENCE_LENGTH + 2] += 2.0   # window position 1: in the slow view (1, 3, 5, 7), not the fast view (4..7)
        assert predict(adapter, slow_only, [row])[0] != pytest.approx(predict(adapter, dataset.features, [row])[0], abs=1e-6)
        unread = dataset.features.copy()
        unread[row - SEQUENCE_LENGTH + 1] += 2.0   # window position 0: in neither view, so it cannot move the prediction
        assert predict(adapter, unread, [row])[0] == pytest.approx(predict(adapter, dataset.features, [row])[0], abs=1e-6)
    # save / load
    folder = tmp_path / task
    path = adapter.save(str(folder))
    assert Path(path).name == "model.pt"
    metadata = json.loads((folder / "model.json").read_text(encoding="utf-8"))
    assert (metadata["adapter"], metadata["key"], metadata["network"], metadata["task"]) == ("neural", KEY, KEY, task)
    reloaded = load_adapter(str(folder))
    assert isinstance(reloaded, NeuralAdapter) and reloaded.network_kind == KEY and reloaded.task == task
    np.testing.assert_allclose(predict(reloaded, dataset.features, rows), batch, atol=1e-6)
    # trace: four layers, the head on the last one is the logit (gate G4), the logit is the prediction
    trace = adapter.trace(dataset.features, int(rows[0]))
    assert [layer["name"] for layer in trace["layers"]] == list(adapter.network.layer_names())
    assert trace["attention"] == []
    shapes = [layer["shape"] for layer in trace["layers"]]
    assert shapes == [[FAST_WINDOW, 16], [4, 16], [32], [16]]
    for layer in trace["layers"]:
        assert len(layer["values"]) == math.prod(layer["shape"]) and all(math.isfinite(v) for v in layer["values"])
    assert adapter.apply_head(head_input(trace)) == pytest.approx(trace["logit"], abs=1e-5)
    expected = trace["logit"] if task == "regression" else 1.0 / (1.0 + math.exp(-trace["logit"]))
    assert expected == pytest.approx(batch[0], abs=1e-6)
    described = adapter.describe()
    assert described["network"] == KEY and described["sequenceLength"] == SEQUENCE_LENGTH and described["hasAttention"] is False
    assert [layer["outputShape"] for layer in described["layers"]] == shapes
    assert [layer["outputShape"] for layer in dual_pathway.describe(adapter.network)] == shapes


# ─── one engine fold on real MNQ 5m bars from the lake ─────────────────────


def load_real_market():
    """About 2,200 MNQ 5m bars ending 2025-12-10 (before the December roll), from the lake."""
    from cycle.engine import clean_market_data
    from cycle.features import build_features

    try:
        from shared.data import load_ohlcv_arrays

        raw = load_ohlcv_arrays("MNQ", "5m", max_bars=2200, date_range={"end": "2025-12-10"})
    except Exception as error:  # noqa: BLE001 - the lake (AIStor on :9100) may not be up on this machine
        pytest.skip(f"the lake is not reachable: {error}")
    data, _ = clean_market_data(raw)
    if len(data) < 1800:
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
    parameters = {**catalog.defaults(KEY), "epochs": 4, "patience": 3, "batch_size": 128, "sequence_length": 32,
                  "fast_window_bars": 8, "slow_stride": 4, "pathway_hidden_size": 32, "fusion_hidden_size": 16}
    directory = tmp_path / "cycle_extra_dual_pathway"
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id="cycle_extra_dual_pathway", model_family=KEY,
        model_parameters=parameters, artifact_directory=str(directory),
        train_days=3, validation_fraction=0.2, test_days=1, step_days=0, fold_limit=1, expanding_window=False,
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
    processed = [event for event in events if event["type"] == "cycle_bars" and event.get("role") == "processed"]
    assert processed
    walked = 0
    for event in processed:
        for probability in event["probabilityUp"]:
            assert probability is None or 0.0 <= probability <= 1.0, probability
            walked += 1
    assert walked > 0
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
    fit = direction.fit_summary
    print(f"[smoke] dual_pathway MNQ 5m: {engine.folds[0].train_index.size} rows fitted, "
          f"{seconds:.1f} s, final accuracy {final['metrics'].get('accuracy')}, log loss {final['metrics'].get('log_loss')}, "
          f"best validation log loss {fit.get('best_validation_loss')}")
