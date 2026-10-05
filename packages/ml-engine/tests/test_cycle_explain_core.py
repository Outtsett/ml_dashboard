"""The explainer core (``packages/ml-engine/src/cycle/explain/``, ``explain_main.py``,
``scripts/verify_cycle_explain.py``) against real Model Cycle runs.

Two small runs are made in-process on a synthetic MNQ-like 5-minute market
(the market of ``tests/test_cycle_engine.py``, copied): the legacy logistic
regression and the legacy xgboost, on CPU, two folds each, both with their
price model. Then, through the in-process API and through a real
``explain_main.py --serve`` process:

- the manifest, the structure and one bar are complete and schema-valid with
  every kind-specific block left null (the kind modules are switched off here);
- G1: the reloaded model's prediction equals what the engine streamed, to
  1e-12, for every test bar of every fold and both roles;
- the inputs: the model's own scaler, raw columns, training percentiles in
  [0, 1], a window of exactly ``minimum_history`` bars for a sequence model;
- the output chain (P(up) and its logit; target units, scale, points, close);
- refusals: a fold not planned, a model still training, one never saved, no
  price model, a bar in the warm-up, a timestamp with no bar;
- replies never carry NaN; ``releaseRun`` frees the run's files.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq
import pytest

from cycle import explain as explain_package
from cycle.control import ControlState
from cycle.engine import CycleEngine, CycleSettings, MarketData
from cycle.explain import KIND_MODULES, ExplainError, artifacts, common
from cycle.explain.server import Explainer, encode
from cycle.features import FeatureSet
from cycle.models import build_adapter, default_parameters
from cycle.simulate import load_cost_model
from shared import protocol

ENGINE = Path(__file__).resolve().parents[1]
REPOSITORY = ENGINE.parent.parent
EXPLAIN_MAIN = ENGINE / "src" / "cycle" / "explain_main.py"
VERIFY_SCRIPT = REPOSITORY / "scripts" / "verify_cycle_explain.py"
FIXTURES = REPOSITORY / "tests" / "fixtures" / "cycle_explain"
PYTHON = sys.executable
MNQ = load_cost_model("MNQ")
FIRST_MONDAY = int(datetime(2026, 3, 2, tzinfo=timezone.utc).timestamp())
BARS_PER_DAY = 96
HORIZON = 4
FEATURE_NAMES = ["planted_signal", "planted_signal_previous_bar", "noise_first", "noise_second"]


# ═══ a synthetic market and two real runs ══════════════════════════════════


def synthetic_market(calendar_days: int = 49, seed: int = 5) -> tuple[MarketData, FeatureSet]:
    """The market of tests/test_cycle_engine.py: bar t+1 drifts with a causal
    AR(1) signal the model is handed as a feature. The raw columns are an
    affine copy of the inputs so ``inputs.raw`` has something to show."""
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


def make_run(root: Path, key: str, parameters: dict, market) -> Made:
    data, features = market
    model_id = f"cycle_explain_{key}"
    directory = root / model_id
    settings = CycleSettings(
        symbol="MNQ", timeframe="5m", model_id=model_id, model_family=key, model_parameters=parameters,
        artifact_directory=str(directory), train_days=21, validation_fraction=0.2, test_days=7, step_days=0,
        fold_limit=2, expanding_window=False, label_horizon_bars=HORIZON, label_threshold_ticks=1.0, embargo_bars=2,
        long_only=False, holding_bars=0, stop_loss_ticks=0.0, take_profit_ticks=0.0, contracts=1, tuning_trials=0, tuning_mode="reviewed_defaults",
        bars_per_second=0.0, start_paused=False, quiet_bars=True, log_every_batches=100, device="cpu", seed=42,
        land_in_lake=False,
    )
    engine = CycleEngine(settings, data, features, MNQ,
                         lambda values, task="classification": build_adapter(key, values, "cpu", 42, task=task),
                         control=ControlState(0.0, False))
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(protocol, "emit", lambda event: None)
        engine.run()
    return Made(key, directory, engine)


@pytest.fixture(scope="module")
def market():
    return synthetic_market()


@pytest.fixture(scope="module")
def runs(market, tmp_path_factory) -> dict[str, Made]:
    root = tmp_path_factory.mktemp("cycle_explain_runs")
    xgboost = {**default_parameters("xgboost"), "boosting_rounds": 60, "early_stopping_rounds": 20, "max_depth": 3}
    return {
        "logistic_regression": make_run(root, "logistic_regression", default_parameters("logistic_regression"), market),
        "xgboost": make_run(root, "xgboost", xgboost, market),
    }


@pytest.fixture(autouse=True)
def core_only(monkeypatch):
    """The core alone: every kind module switched off, so each block must be null."""
    monkeypatch.setattr(common, "kind_module", lambda kind: None)


def rows_tested(made: Made, fold: int) -> np.ndarray:
    """The rows fold ``fold`` walked."""
    return artifacts.load_fold_index(made.directory, fold)["test"]


def timestamp_of(made: Made, row: int) -> int:
    return int(made.engine.data.timestamps[row])


def predictions(made: Made) -> dict[int, dict]:
    table = pq.read_table(made.directory / "predictions.parquet").to_pylist()
    return {record["timestamp"]: record for record in table}


# ═══ the dispatch contract ═════════════════════════════════════════════════


def test_the_kind_table_covers_every_explain_kind_in_the_registry():
    from cycle import catalog

    kinds = {entry["explainKind"] for entry in catalog.registry()["models"].values()}
    assert kinds <= set(KIND_MODULES)
    assert set(KIND_MODULES) == set(catalog.EXPLAIN_KINDS)
    assert KIND_MODULES["oblivious_trees"] == KIND_MODULES["trees"] == "cycle.explain.trees"


def test_a_kind_module_that_does_not_exist_yet_leaves_its_block_empty(monkeypatch):
    monkeypatch.setitem(KIND_MODULES, "trees", "cycle.explain.no_such_module_for_the_test")
    explain_package._UNAVAILABLE.discard("cycle.explain.no_such_module_for_the_test")
    assert explain_package.kind_module("trees") is None
    assert explain_package.kind_module(None) is None
    assert explain_package.kind_module("not_a_kind") is None


@pytest.mark.parametrize(("key", "role", "link"), [
    ("xgboost", "direction", "logistic"), ("lightgbm", "direction", "logistic"),
    ("random_forest", "direction", "mean_probability"), ("logistic_regression", "direction", "logistic"),
    ("lstm", "direction", "logistic"), ("xgboost", "price", "identity"),
    ("ridge_regression", "direction", "logistic_curve"), ("probit_regression", "direction", "probit"),
    ("support_vector_machine", "direction", "logistic_curve"), ("k_nearest_neighbors", "direction", "vote"),
    ("naive_bayes", "direction", "posterior"), ("calibrated_classifier", "direction", "calibration_map"),
    ("extra_trees", "direction", "mean_probability"), ("gradient_boosting_machine", "direction", "logistic"),
    ("catboost", "direction", "logistic"), ("stacked_generalization", "direction", "logistic"),
    ("recurrent_network", "direction", "logistic"), ("ridge_regression", "price", "identity"),
])
def test_the_link_comes_from_the_registry(key, role, link):
    from cycle import catalog

    assert common.link_for(catalog.entry(key), key, role) == link


# ═══ in-process: manifest, structure, bar ══════════════════════════════════


def test_the_manifest_lists_every_fold_as_ready(runs):
    made = runs["xgboost"]
    manifest = Explainer().manifest(str(made.directory))
    written = json.loads((made.directory / "explain" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["available"] is True and manifest["reason"] is None
    assert manifest["modelId"] == "cycle_explain_xgboost" and manifest["modelKey"] == "xgboost"
    assert manifest["explainKind"] == "trees" and manifest["directionMode"] == "classifier"
    assert manifest["hasPriceModel"] is True and manifest["sequenceLength"] == 1
    assert manifest["featureNames"] == FEATURE_NAMES
    assert manifest["featureDisplayNames"] == [name.replace("_", " ") for name in FEATURE_NAMES]
    assert [(f["foldIndex"], f["testStart"], f["testEnd"]) for f in manifest["folds"]] == \
        [(f["foldIndex"], f["testStart"], f["testEnd"]) for f in written["folds"]]
    assert all(f["direction"] == "ready" and f["price"] == "ready" for f in manifest["folds"])
    fold = manifest["folds"][1]
    assert artifacts.fold_for_timestamp(manifest, fold["testStart"]) == 1
    assert artifacts.fold_for_timestamp(manifest, 0) is None


def test_a_run_without_explain_files_is_not_available(tmp_path):
    (tmp_path / "old_run").mkdir()
    manifest = artifacts.manifest(tmp_path / "old_run")
    assert manifest["available"] is False and "before Inside the model existed" in manifest["reason"]
    with pytest.raises(ExplainError, match="before Inside the model existed"):
        Explainer().structure(str(tmp_path / "old_run"), 0, "direction")


@pytest.mark.parametrize("key", ["logistic_regression", "xgboost"])
@pytest.mark.parametrize("role", ["direction", "price"])
def test_the_structure_names_the_kind_and_link_and_leaves_every_block_empty(runs, key, role):
    made = runs[key]
    structure = Explainer().structure(str(made.directory), 1, role)
    assert structure["modelId"] == made.directory.name and structure["foldIndex"] == 1 and structure["role"] == role
    assert structure["explainKind"] == ("linear" if key == "logistic_regression" else "trees")
    assert structure["link"] == ("identity" if role == "price" else "logistic")
    assert structure["baseValue"] is None and structure["logisticCurve"] is None
    for block in common.STRUCTURE_BLOCKS:
        assert structure[block] is None


@pytest.mark.parametrize("key", ["logistic_regression", "xgboost"])
@pytest.mark.parametrize("role", ["direction", "price"])
def test_g1_the_reloaded_model_reproduces_every_streamed_prediction(runs, key, role):
    made = runs[key]
    explainer = Explainer()
    streamed = predictions(made)
    checked = 0
    for fold in (0, 1):
        context = explainer.context(str(made.directory), fold, role)
        for row in rows_tested(made, fold):
            if not context.valid(int(row)):
                continue
            timestamp = timestamp_of(made, int(row))
            bar = explainer.explain(str(made.directory), fold, role, timestamp)
            record = streamed[timestamp]
            assert record["fold_index"] == fold
            if role == "direction":
                assert bar["streamed"] == record["probability_up"]
            elif record["predicted_move_raw_points"] is None:
                # the horizon crosses a session gap: no forecast was asked for, nothing to hold the reload against
                assert bar["streamed"] is None and record["predicted_close"] is None
                continue
            else:
                # the streamed number is the model's own (unrounded) move; the chart's forecast is its nearest tick
                assert bar["streamed"] == pytest.approx(record["predicted_move_raw_points"] / made.engine.move_scale[row],
                                                        abs=1e-15)
            gate = common.gate_g1(context, bar, "cpu")
            assert gate["tolerance"] == 1e-12
            assert gate["passed"] is True, gate
            checked += 1
    assert checked > 500
    assert explainer.model_loads == 2, "each fold model is loaded once and then served from the cache"


def test_a_bar_explained_by_a_fold_that_did_not_test_it_has_nothing_streamed(runs):
    made = runs["xgboost"]
    row = int(rows_tested(made, 1)[20])
    bar = Explainer().explain(str(made.directory), 0, "direction", timestamp_of(made, row))
    assert bar["foldIndex"] == 0 and bar["streamed"] is None
    assert 0.0 <= bar["engineReload"] <= 1.0


def test_the_direction_bar_carries_the_inputs_and_the_probability_chain(runs, market):
    made = runs["logistic_regression"]
    _, features = market
    row = int(rows_tested(made, 1)[37])
    explainer = Explainer()
    bar = explainer.explain(str(made.directory), 1, "direction", timestamp_of(made, row))
    context = explainer.context(str(made.directory), 1, "direction")
    adapter = context.adapter
    assert bar["timestamp"] == timestamp_of(made, row) and bar["explainKind"] == "linear" and bar["link"] == "logistic"
    # the legacy logistic regression standardises with its training mean and deviation: the core applies it
    assert bar["inputs"]["scaled"] is True
    expected = (features.matrix[row].astype(np.float64) - adapter.mean) / adapter.scale
    np.testing.assert_allclose(bar["inputs"]["values"], expected, rtol=0, atol=1e-12)
    np.testing.assert_array_equal(bar["inputs"]["raw"], features.raw[row].astype(np.float64))
    assert bar["inputs"]["window"] is None
    percentiles = bar["inputs"]["trainingPercentile"]
    assert len(percentiles) == len(FEATURE_NAMES) and all(0.0 <= p <= 1.0 for p in percentiles)
    training = features.matrix[context.index["train"], 0].astype(np.float64)
    value = float(features.matrix[row, 0])
    mid_rank = (np.sum(training < value) + 0.5 * np.sum(training == value)) / training.size
    assert percentiles[0] == pytest.approx(mid_rank, abs=1e-12)
    output = bar["output"]
    probability = output["probabilityUp"]
    assert probability == bar["engineReload"] == bar["streamed"]
    # raw is the log-odds: the margin of the fitted linear model
    margin = float(expected @ adapter.coefficients + adapter.intercept)
    assert output["raw"] == pytest.approx(margin, abs=1e-9)
    assert output["close"] == made.engine.data.close[row]
    assert output["targetUnits"] is None and output["movePoints"] is None and output["predictedClose"] is None
    for block in common.BAR_BLOCKS:
        assert bar[block] is None


def test_the_price_bar_turns_target_units_into_points_and_a_predicted_close(runs):
    made = runs["xgboost"]
    record_by_time = predictions(made)
    row = int(rows_tested(made, 0)[50])
    timestamp = timestamp_of(made, row)
    bar = Explainer().explain(str(made.directory), 0, "price", timestamp)
    output = bar["output"]
    assert bar["link"] == "identity" and bar["inputs"]["scaled"] is False
    assert output["probabilityUp"] is None
    assert output["raw"] == output["targetUnits"] == bar["engineReload"]
    assert output["scale"] == made.engine.move_scale[row]
    assert output["movePoints"] == pytest.approx(output["targetUnits"] * output["scale"], abs=1e-12)
    # the model's own number is the unrounded move; the forecast the chart drew is the nearest tick
    assert output["movePoints"] == pytest.approx(record_by_time[timestamp]["predicted_move_raw_points"], abs=1e-9)
    assert output["movePointsOnTick"] == pytest.approx(record_by_time[timestamp]["predicted_move_points"], abs=1e-9)
    assert output["predictedClose"] == pytest.approx(record_by_time[timestamp]["predicted_close"], abs=1e-9)
    assert abs(output["predictedClose"] / 0.25 - round(output["predictedClose"] / 0.25)) < 1e-9


def test_the_price_role_percentiles_rank_among_the_price_training_rows(runs):
    made = runs["xgboost"]
    context = Explainer().context(str(made.directory), 0, "price")
    np.testing.assert_array_equal(context.training_rows, context.index["price_train"])
    assert context.training_rows.size > 0


# ═══ sequence models read a window ═════════════════════════════════════════


class SequenceStub:
    """Stands in for a sequence model: reads ``length`` bars, predicts a fixed P(up)."""

    def __init__(self, length: int = 5, probability: float = 0.62) -> None:
        self.length = length
        self.probability = probability

    def minimum_history(self) -> int:
        return self.length

    def predict_probability(self, features, index):
        return np.full(len(index), self.probability)

    def predict_value(self, features, index):
        return np.full(len(index), -0.25)


def test_a_sequence_model_shows_the_window_it_read(runs, market):
    made = runs["xgboost"]
    _, features = market
    explainer = Explainer(adapter_loader=lambda directory: SequenceStub(length=5))
    row = int(rows_tested(made, 0)[10])
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, row))
    window = bar["inputs"]["window"]
    assert len(window["timestamps"]) == 5 == len(window["values"])
    assert window["timestamps"][-1] == bar["timestamp"]
    assert window["timestamps"] == [int(t) for t in made.engine.data.timestamps[row - 4:row + 1]]
    np.testing.assert_array_equal(np.array(window["values"]), features.matrix[row - 4:row + 1].astype(np.float64))
    assert all(len(values) == len(FEATURE_NAMES) for values in window["values"])
    assert bar["engineReload"] == pytest.approx(0.62)
    assert bar["output"]["raw"] == pytest.approx(math.log(0.62 / 0.38))
    assert bar["streamed"] != bar["engineReload"], "the stub is not the saved model, so G1 must not pass by accident"
    gate = common.gate_g1(explainer.context(str(made.directory), 0, "direction"), bar, "cpu")
    assert gate["passed"] is False


def test_a_bar_inside_the_warm_up_is_refused_for_a_window_model(runs):
    made = runs["xgboost"]
    explainer = Explainer(adapter_loader=lambda directory: SequenceStub(length=40))
    # rows 0..29 carry NaN inputs: row 45 reads rows 6..45
    with pytest.raises(ExplainError, match="inside the feature warm-up"):
        explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, 45))
    bar = explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, 70))
    assert len(bar["inputs"]["window"]["timestamps"]) == 40


# ═══ refusals ══════════════════════════════════════════════════════════════


def copy_run(made: Made, destination: Path, *, skip: tuple[str, ...] = ()) -> Path:
    """A copy of a run without the entries in ``skip`` (paths relative to the run, with "/")."""

    def ignore(folder, names):
        relative = Path(folder).relative_to(made.directory).as_posix()
        return [name for name in names if (name if relative == "." else f"{relative}/{name}") in skip]

    shutil.copytree(made.directory, destination, ignore=ignore)
    return destination


def test_a_fold_that_is_not_ready_is_refused_with_a_reason(runs, tmp_path):
    made = runs["xgboost"]
    explainer = Explainer()
    with pytest.raises(ExplainError, match="no fold 8"):
        explainer.structure(str(made.directory), 7, "direction")
    with pytest.raises(ExplainError, match="Unknown role"):
        explainer.structure(str(made.directory), 0, "volatility")

    # the run ended without fold 2's direction model: "missing"
    missing = copy_run(made, tmp_path / "missing_run", skip=("fold_1/model.json",))
    assert artifacts.manifest(missing)["folds"][1]["direction"] == "missing"
    with pytest.raises(ExplainError, match="was never saved"):
        explainer.explain(str(missing), 1, "direction", timestamp_of(made, int(rows_tested(made, 1)[5])))

    # the run is still going (no diagnostics.json yet) and fold 2's price model is not saved: "training"
    live = copy_run(made, tmp_path / "live_run", skip=("diagnostics.json", "fold_1/price_model", "predictions.parquet"))
    manifest = artifacts.manifest(live)
    assert manifest["folds"][1]["price"] == "training" and manifest["folds"][1]["direction"] == "ready"
    with pytest.raises(ExplainError, match="still training"):
        explainer.structure(str(live), 1, "price")
    # a live run has streamed nothing to disk yet
    bar = explainer.explain(str(live), 0, "direction", timestamp_of(made, int(rows_tested(made, 0)[5])))
    assert bar["streamed"] is None and bar["engineReload"] is not None

    # a model with no price model: "none"
    no_price = copy_run(made, tmp_path / "no_price_run")
    written = json.loads((no_price / "explain" / "manifest.json").read_text(encoding="utf-8"))
    written["hasPriceModel"] = False
    (no_price / "explain" / "manifest.json").write_text(json.dumps(written), encoding="utf-8")
    assert all(f["price"] == "none" for f in artifacts.manifest(no_price)["folds"])
    with pytest.raises(ExplainError, match="no price model"):
        explainer.structure(str(no_price), 0, "price")


def test_a_timestamp_with_no_bar_and_a_bar_in_the_warm_up_are_refused(runs):
    made = runs["logistic_regression"]
    explainer = Explainer()
    with pytest.raises(ExplainError, match="no bar at"):
        explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, 100) + 7)
    with pytest.raises(ExplainError, match="inside the feature warm-up"):
        explainer.explain(str(made.directory), 0, "direction", timestamp_of(made, 3))


def test_a_model_the_engine_saves_again_is_reloaded(runs, tmp_path):
    made = runs["logistic_regression"]
    run = copy_run(made, tmp_path / "resaved_run")
    explainer = Explainer()
    explainer.structure(str(run), 0, "direction")
    explainer.structure(str(run), 0, "direction")
    assert explainer.model_loads == 1
    model_json = run / "fold_0" / "model.json"
    stat = model_json.stat()
    os.utime(model_json, ns=(stat.st_atime_ns, stat.st_mtime_ns + 5_000_000_000))
    explainer.structure(str(run), 0, "direction")
    assert explainer.model_loads == 2


# ═══ never NaN ═════════════════════════════════════════════════════════════


def test_replies_never_carry_nan(runs, tmp_path):
    assert common.clean({"a": float("nan"), "b": [np.float32("inf"), 1.5, np.int64(3)], "c": (np.bool_(True),)}) == \
        {"a": None, "b": [None, 1.5, 3], "c": [True]}
    # a run whose raw columns were not written (the engine writes NaN): raw reads as null
    made = runs["xgboost"]
    run = copy_run(made, tmp_path / "no_raw_run")
    raw_path = run / "explain" / "raw_features.npy"
    raw = np.load(raw_path)
    with open(raw_path, "wb") as handle:
        np.save(handle, np.full_like(raw, np.nan))
    bar = Explainer().explain(str(run), 0, "direction", timestamp_of(made, int(rows_tested(made, 0)[3])))
    assert bar["inputs"]["raw"] == [None] * len(FEATURE_NAMES)
    text = encode({"id": "x", "ok": True, "result": bar})
    assert "NaN" not in text and "Infinity" not in text
    with pytest.raises(ValueError):
        json.dumps({"x": float("nan")}, allow_nan=False)


def test_the_request_loop_answers_errors_without_stopping(runs):
    made = runs["xgboost"]
    explainer = Explainer()
    reply, stop = explainer.handle({"id": "1", "op": "structure", "runDirectory": str(made.directory), "fold": 9,
                                    "role": "direction"})
    assert reply["ok"] is False and reply["id"] == "1" and "no fold 10" in reply["error"] and not stop
    reply, stop = explainer.handle({"id": "2", "op": "dance"})
    assert reply["ok"] is False and "Unknown operation" in reply["error"] and not stop
    reply, stop = explainer.handle({"id": "3", "op": "explain", "runDirectory": str(made.directory), "fold": 0,
                                    "role": "direction", "timestamp": -5})
    assert reply["ok"] is False and "timestamp" in reply["error"]
    reply, stop = explainer.handle({"id": "4", "op": "tree", "runDirectory": str(made.directory), "fold": 0,
                                    "role": "direction", "tree": 0})
    assert reply["ok"] is False and "no trees to draw" in reply["error"]
    reply, stop = explainer.handle({"id": "5", "op": "exit"})
    assert reply == {"id": "5", "ok": True, "result": {"exiting": True}} and stop


# ═══ the process: JSON lines over stdin / stdout ═══════════════════════════


class Session:
    def __init__(self, cwd: Path, stderr_path: Path) -> None:
        self.stderr_path = stderr_path
        self.stderr = open(stderr_path, "w", encoding="utf-8")  # a file: an unread pipe could fill and block
        environment = {**os.environ, "CUDA_VISIBLE_DEVICES": "", "OMP_NUM_THREADS": "4", "PYTHONUNBUFFERED": "1"}
        self.process = subprocess.Popen([PYTHON, str(EXPLAIN_MAIN), "--serve"], cwd=cwd, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.stderr, text=True, encoding="utf-8",
                                        env=environment)
        self.lines: list[str] = []
        self.count = 0

    def read(self) -> dict:
        line = self.process.stdout.readline()
        assert line, f"the explainer closed stdout; stderr: {self.stderr_path.read_text(encoding='utf-8')[-2000:]}"
        self.lines.append(line)
        return json.loads(line)

    def ask(self, **request) -> dict:
        self.count += 1
        request = {"id": f"q{self.count}", **request}
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()
        reply = self.read()
        assert reply["id"] == request["id"]
        return reply


def test_a_json_lines_session_with_the_real_process(runs, tmp_path):
    made = runs["xgboost"]
    run = copy_run(made, tmp_path / "session_run")
    session = Session(REPOSITORY, tmp_path / "explainer_stderr.txt")
    try:
        ready = session.read()
        # the venv python.exe on Windows is a launcher, so the pid is the interpreter it started
        assert ready["ready"] is True and isinstance(ready["pid"], int) and ready["pid"] > 0
        pong = session.ask(op="ping")
        assert pong["ok"] is True and pong["result"]["pong"] is True
        assert pong["result"]["environment"]["CUDA_VISIBLE_DEVICES"] == ""
        structure = session.ask(op="structure", runDirectory=str(run), fold=0, role="direction")
        assert structure["ok"] is True and structure["result"]["explainKind"] == "trees"
        row = int(rows_tested(made, 0)[12])
        timestamp = timestamp_of(made, row)
        bar = session.ask(op="explain", runDirectory=str(run), fold=0, role="direction", timestamp=timestamp)
        assert bar["ok"] is True
        in_process = Explainer().explain(str(made.directory), 0, "direction", timestamp)
        assert bar["result"]["engineReload"] == in_process["engineReload"] == bar["result"]["streamed"]
        price = session.ask(op="explain", runDirectory=str(run), fold=0, role="price", timestamp=timestamp)
        assert price["ok"] is True and price["result"]["output"]["movePoints"] is not None
        refused = session.ask(op="explain", runDirectory=str(run), fold=5, role="direction", timestamp=timestamp)
        assert refused["ok"] is False and "no fold 6" in refused["error"]
        broken = session.ask(op="nonsense")
        assert broken["ok"] is False
        released = session.ask(op="releaseRun", runDirectory=str(run))
        assert released["ok"] is True and released["result"]["models"] == 2 and released["result"]["inputs"] is True
        # nothing of the run is held open any more: Windows lets the folder be renamed
        moved = run.with_name("session_run_moved")
        run.rename(moved)
        assert moved.is_dir()
        goodbye = session.ask(op="exit")
        assert goodbye == {"id": f"q{session.count}", "ok": True, "result": {"exiting": True}}
        assert session.process.wait(timeout=60) == 0
        assert session.process.stdout.read() == ""
    finally:
        if session.process.poll() is None:
            session.process.kill()
        session.stderr.close()
    for line in session.lines:
        assert "NaN" not in line and "Infinity" not in line
        json.loads(line)


def test_the_process_refuses_to_start_without_serve():
    completed = subprocess.run([PYTHON, str(EXPLAIN_MAIN)], cwd=REPOSITORY, capture_output=True, text=True, timeout=120)
    assert completed.returncode == 2 and completed.stdout == ""


# ═══ the verify script and the schema fixtures ═════════════════════════════


def load_verify_script():
    specification = importlib.util.spec_from_file_location("verify_cycle_explain", VERIFY_SCRIPT)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


@pytest.mark.parametrize("key", ["logistic_regression", "xgboost"])
def test_the_verify_script_passes_g1_and_the_schemas(runs, key, tmp_path):
    verify = load_verify_script()
    summary = verify.verify_run(runs[key].directory, bars=15, seed=3, fixtures=tmp_path / "fixtures")
    assert summary["passed"] is True, summary
    assert summary["gates"]["G1"]["failed"] == 0 and summary["gates"]["G1"]["passed"] == 2 * 2 * 15
    assert summary["gates"]["G1"]["maximumError"] <= 1e-12
    if summary["schema"] is None:
        pytest.skip("node and the repository's tsx are needed to load the zod schemas")
    assert summary["schema"]["failures"] == []
    assert summary["schema"]["counts"] == {"manifest": 1, "structure": 4, "bar": 60}
    written = sorted(path.name for path in (tmp_path / "fixtures").iterdir())
    assert written == ["bar_direction.json", "bar_price.json", "manifest.json", "structure_direction.json",
                       "structure_price.json"]


def test_the_verify_script_runs_from_the_command_line(runs):
    completed = subprocess.run([PYTHON, str(VERIFY_SCRIPT), "--run-directory", str(runs["logistic_regression"].directory),
                                "--bars", "5", "--no-schema", "--json"],
                               cwd=REPOSITORY, capture_output=True, text=True, timeout=300)
    assert completed.returncode == 0, completed.stderr[-2000:]
    summary = json.loads(completed.stdout.strip().splitlines()[-1])
    assert summary["passed"] is True and summary["gates"]["G1"]["passed"] == 2 * 2 * 5


def schema_samples(runs) -> list[tuple[str, str, object]]:
    """One of every reply shape the core makes, for the zod check and the fixtures."""
    logistic, xgboost = runs["logistic_regression"], runs["xgboost"]
    explainer = Explainer()
    window = Explainer(adapter_loader=lambda directory: SequenceStub(length=3))
    row = int(rows_tested(logistic, 0)[8])
    samples: list[tuple[str, str, object]] = [
        ("ready", "ready", {"ready": True, "pid": 4321}),
        ("manifest", "manifest", explainer.manifest(str(logistic.directory))),
        ("structure", "structure_direction", explainer.structure(str(logistic.directory), 0, "direction")),
        ("structure", "structure_price", explainer.structure(str(xgboost.directory), 0, "price")),
        ("bar", "bar_direction", explainer.explain(str(logistic.directory), 0, "direction", timestamp_of(logistic, row))),
        ("bar", "bar_price", explainer.explain(str(xgboost.directory), 0, "price", timestamp_of(xgboost, row))),
        ("bar", "bar_window", window.explain(str(xgboost.directory), 0, "direction", timestamp_of(xgboost, row))),
    ]
    requests = [
        {"id": "r1", "op": "ping"},
        {"id": "r2", "op": "structure", "runDirectory": "data/models/run", "fold": 0, "role": "direction"},
        {"id": "r3", "op": "explain", "runDirectory": "data/models/run", "fold": 0, "role": "price", "timestamp": 1772000000},
        {"id": "r4", "op": "releaseRun", "runDirectory": "data/models/run"},
        {"id": "r5", "op": "exit"},
    ]
    samples += [("request", f"request_{request['op']}", request) for request in requests]
    # a released run that was never loaded: an ok reply with nothing machine-specific in it
    ok, _ = explainer.handle({"id": "r4", "op": "releaseRun", "runDirectory": "data/models/run"})
    refused, _ = explainer.handle({"id": "r6", "op": "structure", "runDirectory": str(logistic.directory), "fold": 9,
                                   "role": "direction"})
    samples += [("reply", "reply_ok", ok), ("reply", "reply_error", refused)]
    return samples


def portable(value, run_directories: list[Path]):
    """A fixture must not carry this machine's temporary paths."""
    text = json.dumps(value)
    for directory in run_directories:
        text = text.replace(json.dumps(str(directory))[1:-1], "data/models/" + directory.name)
    return json.loads(text)


def test_every_reply_shape_is_schema_valid_and_matches_the_fixtures(runs, tmp_path):
    verify = load_verify_script()
    samples = schema_samples(runs)
    directories = [made.directory for made in runs.values()]
    samples = [(kind, label, portable(value, directories)) for kind, label, value in samples]
    for _, label, value in samples:
        text = json.dumps(value, allow_nan=False)
        assert "NaN" not in text, label
    if os.environ.get("CYCLE_EXPLAIN_WRITE_FIXTURES") == "1":
        FIXTURES.mkdir(parents=True, exist_ok=True)
        for _, label, value in samples:
            (FIXTURES / f"{label}.json").write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    result = verify.zod_validate(samples, tmp_path / "zod")
    if result is None:
        pytest.skip("node and the repository's tsx are needed to load the zod schemas")
    assert result["failures"] == []
    assert result["counts"] == {"ready": 1, "manifest": 1, "structure": 2, "bar": 3, "request": 5, "reply": 2}
    # the committed fixtures are these shapes (their numbers come from this same synthetic run)
    for _, label, value in samples:
        path = FIXTURES / f"{label}.json"
        assert path.is_file(), f"{path} is missing: run with CYCLE_EXPLAIN_WRITE_FIXTURES=1"
        committed = json.loads(path.read_text(encoding="utf-8"))
        assert sorted(committed) == sorted(value) if isinstance(value, dict) else committed == value, label
