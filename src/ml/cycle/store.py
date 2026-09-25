"""Artifacts of a Model Cycle run: ``data/models/<model_id>/`` and the lake.

Local files (full-word column names):
    config.json          the plan (the ``cycle_plan`` event) plus the parameters used
    predictions.parquet  one row per processed test bar, with the price model's forecast
                         (predicted_move_points, predicted_close, forecast_timestamp) and,
                         once its target bar was walked, forecast_error_points
    fold_<k>/            the direction model and fold_<k>/price_model/ the price model, each
                         saved right after its own fit; fold_<k>/index.npz, written before
                         fitting, holds the rows each was fitted on
    explain/             written at plan time for "Inside the model"
                         (``write_explain_inputs``): manifest.json and the arrays the
                         models read — features.npy, raw_features.npy, timestamps.npy,
                         close.npy, move_scale.npy, labels.npy, price_target.npy
    trades.parquet       one row per trade
    epochs.parquet       one row per training step summary (folds and tuning trials)
    trials.parquet       one row per tuning trial
    folds.json           fold plans, timings, metrics, model paths
    scoreboard.json      the final scoreboard
    diagnostics.json     final metrics, folds, device, elapsed seconds, stopped flag

Lake (the layout of ``scripts/land_regression_tab_performance.py``):
    s3://derived/model_cycle_runs/recipe=<model_id>/table=<predictions|trades|folds>/part-0.parquet
plus one manifest line per table in ``meta/ingest_manifests/model_cycle_runs.jsonl``.
The ``lake.layout`` writer needs ``upath``, which the dashboard's venv does not
carry, so when the in-process import fails the landing runs in the datalake
interpreter (``CYCLE_LAKE_PYTHON``, default
``E:/source/repos/datalake/.venv/Scripts/python.exe``) — the interpreter that
script's own docstring names. A landing failure is a warning, never a failed run.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import TYPE_CHECKING

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from cycle.metrics import PRICE_FORECAST_METRIC_NAMES
from shared.protocol import dumps_safe

if TYPE_CHECKING:
    from cycle.engine import CycleEngine

DATASET = "model_cycle_runs"
EXPLAIN_DIRECTORY = "explain"
EXPLAIN_MANIFEST_VERSION = 1
LAKE_TABLES = ("predictions", "trades", "folds")
DEFAULT_LAKE_PYTHON = "E:/source/repos/datalake/.venv/Scripts/python.exe"

PREDICTION_COLUMNS = (
    ("timestamp", pa.int64()), ("fold_index", pa.int64()), ("open", pa.float64()), ("high", pa.float64()),
    ("low", pa.float64()), ("close", pa.float64()), ("volume", pa.float64()), ("probability_up", pa.float64()),
    ("predicted_direction", pa.int64()), ("position", pa.int64()), ("equity_usd", pa.float64()),
    ("actual_direction", pa.int64()), ("correct", pa.bool_()),
    # the price model: its forecast made at this bar of the move to (and close at) the bar
    # label_horizon_bars later, and — once that bar was walked — forecast minus actual move
    ("predicted_move_points", pa.float64()), ("predicted_close", pa.float64()), ("forecast_timestamp", pa.int64()),
    ("forecast_error_points", pa.float64()),
)
TRADE_COLUMNS = (
    ("trade_number", pa.int64()), ("fold_index", pa.int64()), ("side", pa.string()), ("contracts", pa.int64()),
    ("entry_timestamp", pa.int64()), ("entry_price", pa.float64()), ("exit_timestamp", pa.int64()),
    ("exit_price", pa.float64()), ("bars_held", pa.int64()), ("probability_up_at_entry", pa.float64()),
    ("gross_profit_usd", pa.float64()), ("cost_usd", pa.float64()), ("net_profit_usd", pa.float64()),
    ("exit_reason", pa.string()),
)
EPOCH_COLUMNS = (
    ("fold_index", pa.int64()), ("trial", pa.int64()), ("model_role", pa.string()), ("epoch", pa.int64()),
    ("epoch_count", pa.int64()),
    ("step_unit", pa.string()), ("train_loss", pa.float64()), ("validation_loss", pa.float64()),
    ("validation_accuracy", pa.float64()), ("validation_f1_score", pa.float64()), ("learning_rate", pa.float64()),
    ("gradient_norm", pa.float64()), ("is_best", pa.bool_()), ("seconds_elapsed", pa.float64()),
)
TRIAL_COLUMNS = (
    ("trial", pa.int64()), ("state", pa.string()), ("objective_name", pa.string()), ("objective_value", pa.float64()),
    ("block_values", pa.string()), ("parameters", pa.string()), ("best_value", pa.float64()), ("best_trial", pa.int64()),
)
FOLD_COLUMNS = (
    ("model_id", pa.string()), ("fold_index", pa.int64()), ("train_start", pa.int64()), ("train_end", pa.int64()),
    ("validation_start", pa.int64()), ("validation_end", pa.int64()), ("test_start", pa.int64()), ("test_end", pa.int64()),
    ("train_bar_count", pa.int64()), ("validation_bar_count", pa.int64()), ("test_bar_count", pa.int64()),
    ("training_seconds", pa.float64()), ("testing_seconds", pa.float64()), ("stopped", pa.bool_()),
    ("metrics", pa.string()), ("model_path", pa.string()),
    ("price_train_bar_count", pa.int64()), ("price_validation_bar_count", pa.int64()),
    ("price_training_seconds", pa.float64()), ("price_model_path", pa.string()),
)


def _clean(value):
    if isinstance(value, float) and value != value:  # NaN
        return None
    return value


def table_from_rows(rows: list[dict], columns) -> pa.Table:
    schema = pa.schema([pa.field(name, kind) for name, kind in columns])
    data = {name: [_clean(row.get(name)) for row in rows] for name, _ in columns}
    return pa.Table.from_pydict(data, schema=schema)


def fold_rows(engine: CycleEngine) -> list[dict]:
    rows = []
    for record in engine.fold_records:
        rows.append({
            "model_id": engine.settings.model_id, "fold_index": record["foldIndex"],
            "train_start": record["trainStart"], "train_end": record["trainEnd"],
            "validation_start": record["validationStart"], "validation_end": record["validationEnd"],
            "test_start": record["testStart"], "test_end": record["testEnd"],
            "train_bar_count": record["trainBarCount"], "validation_bar_count": record["validationBarCount"],
            "test_bar_count": record["testBarCount"], "training_seconds": record.get("trainingSeconds"),
            "testing_seconds": record.get("testingSeconds"), "stopped": bool(record.get("stopped", False)),
            "metrics": dumps_safe(record.get("metrics")), "model_path": record.get("modelPath"),
            "price_train_bar_count": record.get("priceTrainBarCount"),
            "price_validation_bar_count": record.get("priceValidationBarCount"),
            "price_training_seconds": record.get("priceTrainingSeconds"), "price_model_path": record.get("priceModelPath"),
        })
    return rows


def _write_json(path: str, value) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(dumps_safe(value, indent=2))


def _save_array(path: str, values: np.ndarray) -> None:
    # np.save appends ".npy" to a name without it, so write through a handle
    temporary = path + ".tmp"
    with open(temporary, "wb") as handle:
        np.save(handle, values, allow_pickle=False)
    os.replace(temporary, path)


def explain_manifest(engine: CycleEngine, sequence_length: int) -> dict:
    """``explain/manifest.json``: what the explainer and the server need to find
    and label a run's inputs and fold models (``src/shared/cycle/explain.ts``)."""
    from cycle.features import display_names

    s = engine.settings
    names = list(engine.feature_set.names)
    plan = engine.plan or {}
    return {
        "version": EXPLAIN_MANIFEST_VERSION,
        "modelId": s.model_id,
        "modelKey": s.model_family,
        "displayName": engine.display_name,
        "explainKind": engine.explain_kind,
        "directionMode": engine.direction_mode,
        "hasPriceModel": bool(engine.has_price_model),
        "featureNames": names,
        "featureDisplayNames": display_names(names),
        "rawFeaturesAvailable": engine.feature_set.raw is not None,
        "sequenceLength": max(1, int(sequence_length)),
        "labelHorizonBars": int(engine.horizon),
        "volatilityWindowBars": int(engine.volatility_window),
        "symbol": s.symbol,
        "timeframe": s.timeframe,
        "barCount": len(engine.data),
        "folds": [{"foldIndex": fold["foldIndex"], "testStart": fold["testStart"], "testEnd": fold["testEnd"]}
                  for fold in plan.get("folds", [])],
    }


def write_explain_inputs(engine: CycleEngine, sequence_length: int) -> str:
    """Write ``explain/`` at plan time: the arrays every fold model reads, one
    row per loaded bar, and the manifest last (a manifest means the arrays are
    complete). Returns the folder."""
    directory = os.path.join(engine.settings.artifact_directory, EXPLAIN_DIRECTORY)
    os.makedirs(directory, exist_ok=True)
    features = np.asarray(engine.features, dtype=np.float32)
    raw = engine.feature_set.raw
    # a feature set built without its raw columns (a test's planted features) writes NaN, and the manifest says so
    raw = np.full(features.shape, np.nan, dtype=np.float32) if raw is None else np.asarray(raw, dtype=np.float32)
    arrays = {
        "features": features,
        "raw_features": raw,
        "timestamps": np.asarray(engine.data.timestamps, dtype=np.int64),
        "close": np.asarray(engine.data.close, dtype=np.float64),
        "move_scale": np.asarray(engine.move_scale, dtype=np.float64),
        "labels": np.asarray(engine.labels, dtype=np.float32),
        "price_target": np.asarray(engine.price_targets, dtype=np.float32),
    }
    for name, values in arrays.items():
        _save_array(os.path.join(directory, f"{name}.npy"), values)
    _write_json(os.path.join(directory, "manifest.json"), explain_manifest(engine, sequence_length))
    return directory


def write_fold_index(directory: str, *, train: np.ndarray, validation: np.ndarray, test: np.ndarray,
                     price_train: np.ndarray, price_validation: np.ndarray) -> str:
    """``fold_<k>/index.npz``: the rows each model of the fold is fitted on,
    and the fold's test span, as int64 row numbers into the explain arrays."""
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, "index.npz")
    temporary = path + ".tmp"
    with open(temporary, "wb") as handle:
        np.savez(handle, **{name: np.asarray(rows, dtype=np.int64) for name, rows in (
            ("train", train), ("validation", validation), ("test", test),
            ("price_train", price_train), ("price_validation", price_validation))})
    os.replace(temporary, path)
    return path


def write_run(engine: CycleEngine) -> dict:
    """Write every artifact, land the three tables, return the done-diagnostics."""
    s = engine.settings
    directory = s.artifact_directory
    os.makedirs(directory, exist_ok=True)
    predictions = table_from_rows(list(engine.prediction_rows.values()), PREDICTION_COLUMNS)
    trades = table_from_rows([trade.to_row() for trade in sorted(engine.trades.values(), key=lambda t: t.number)], TRADE_COLUMNS)
    epochs = table_from_rows(engine.epoch_records, EPOCH_COLUMNS)
    trials = table_from_rows(engine.trial_records, TRIAL_COLUMNS)
    folds = table_from_rows(fold_rows(engine), FOLD_COLUMNS)
    paths = {
        "predictions": os.path.join(directory, "predictions.parquet"),
        "trades": os.path.join(directory, "trades.parquet"),
        "epochs": os.path.join(directory, "epochs.parquet"),
        "trials": os.path.join(directory, "trials.parquet"),
    }
    for name, table in (("predictions", predictions), ("trades", trades), ("epochs", epochs), ("trials", trials)):
        pq.write_table(table, paths[name], compression="zstd")
    folds_path = os.path.join(directory, "folds_table.parquet")
    pq.write_table(folds, folds_path, compression="zstd")

    final_metrics = (engine.final_scoreboard or {}).get("metrics") or {}
    price_forecast = {name: final_metrics.get(name) for name in PRICE_FORECAST_METRIC_NAMES}
    price_model = None
    if engine.has_price_model:
        from_price = engine.direction_mode == "from_price"
        price_model = {
            "target": (f"(close[t+{engine.horizon}] - close[t]) divided by the sample standard deviation of the "
                       f"{engine.horizon}-bar moves ending at bars t-{engine.volatility_window - 1}..t, floored at one tick"),
            "horizonBars": int(engine.horizon),
            "volatilityWindowBars": int(engine.volatility_window),
            "parameters": ("the model's own (tuned when tuning is on): the price model IS the direction model, which reads "
                           "P(up) from its forecast through a logistic curve fitted on the validation bars" if from_price else
                           "the direction classifier's (tuned when tuning is on); the price model itself is never tuned"),
            "baseline": "persistence: the no-change forecast, predicted close = this bar's close",
            "finalMetrics": price_forecast,
        }
    config = {"plan": engine.plan, "parametersUsed": engine.parameters, "tuning": engine.tuning_summary,
              "priceModel": price_model,
              "settings": {key: value for key, value in vars(s).items() if key != "model_parameters"}}
    _write_json(os.path.join(directory, "config.json"), config)
    _write_json(os.path.join(directory, "folds.json"), engine.fold_records)
    _write_json(os.path.join(directory, "scoreboard.json"), engine.final_scoreboard)
    diagnostics = {
        "modelFamily": s.model_family,
        "symbol": s.symbol,
        "timeframe": s.timeframe,
        "device": s.device,
        "deviceName": s.device_name,
        "elapsedSeconds": engine.elapsed(),
        "stopped": engine.stopped,
        "barCount": len(engine.data),
        "barsEmitted": len(engine.emitted_timestamps),
        "barsProcessed": len(engine.prediction_rows),
        "testSeconds": engine.test_seconds,
        "testBarsPerSecond": (engine.test_bars / engine.test_seconds) if engine.test_seconds > 0 else None,
        "tradeCount": sum(1 for trade in engine.trades.values() if not trade.is_open),
        "finalMetrics": (engine.final_scoreboard or {}).get("metrics"),
        "priceForecast": price_forecast,
        "folds": [
            {key: record.get(key) for key in ("foldIndex", "trainStart", "trainEnd", "testStart", "testEnd",
                                              "trainingSeconds", "testingSeconds", "modelPath", "metrics",
                                              "priceTrainingSeconds", "priceModelPath")}
            for record in engine.fold_records
        ],
        "tuning": engine.tuning_summary,
        "parametersUsed": engine.parameters,
        "artifactDirectory": directory,
        "lake": None,
    }
    if s.land_in_lake:
        diagnostics["lake"] = land_tables(
            engine, {"predictions": paths["predictions"], "trades": paths["trades"], "folds": folds_path},
        )
    _write_json(os.path.join(directory, "diagnostics.json"), diagnostics)
    engine.log(f"[save] artifacts written to {directory}")
    return diagnostics


# Runs in the datalake interpreter: argv[1] is a JSON job.
_LANDING_SCRIPT = r"""
import json, sys
from datetime import datetime, timezone
import pyarrow.parquet as pq
from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key, derived_root
from lake.writer import COMPRESSION, COMPRESSION_LEVEL
job = json.loads(sys.argv[1])
out = {}
for name, path in job["tables"].items():
    table = pq.read_table(path)
    root = derived_root(job["dataset"], job["recipe"]) / f"table={name}"
    key = arrow_key(root / "part-0.parquet")
    with arrow_fs().open_output_stream(key) as sink:
        pq.write_table(table, sink, compression=COMPRESSION, compression_level=COMPRESSION_LEVEL)
    size = arrow_fs().get_file_info(key).size
    entry = {"written_at": datetime.now(timezone.utc).isoformat(), "dataset": job["dataset"], "table": name,
             "zone": "derived", "recipe": job["recipe"], "source": job["source"], "rows": table.num_rows,
             "duplicates_removed": 0, "file_count": 1, "bytes": size, "ts_min": None, "ts_max": None}
    manifest = "written"
    try:
        with (INGEST_MANIFESTS / f"{job['dataset']}.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")
    except Exception as error:
        manifest = f"not written: {error}"
    out[name] = {"uri": "s3://" + key, "rows": table.num_rows, "bytes": size, "manifest": manifest}
print(json.dumps(out))
"""


def land_tables(engine: CycleEngine, tables: dict[str, str]) -> dict | None:
    s = engine.settings
    # Run ids carry the runner key ("xgboost+walk_forward_cycle"); some S3
    # clients read "+" in a key as a space, so the lake recipe spells it "_".
    job = {"dataset": DATASET, "recipe": s.model_id.replace("+", "_"), "tables": tables,
           "source": f"model cycle run {s.model_id} ({s.model_family}, {s.symbol} {s.timeframe})"}
    try:
        interpreter = sys.executable
        try:
            import lake.layout  # noqa: F401
            import lake.writer  # noqa: F401
        except ImportError:
            interpreter = os.environ.get("CYCLE_LAKE_PYTHON", DEFAULT_LAKE_PYTHON)
        completed = subprocess.run(
            [interpreter, "-c", _LANDING_SCRIPT, json.dumps(job)],
            capture_output=True, text=True, timeout=180, stdin=subprocess.DEVNULL,
        )
        if completed.returncode != 0:
            tail = (completed.stderr or completed.stdout).strip().splitlines()[-1:] or ["no output"]
            raise RuntimeError(f"landing exited {completed.returncode}: {tail[0]}")
        result = json.loads(completed.stdout.strip().splitlines()[-1])
        for name, info in result.items():
            engine.log(f"[save] landed {name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
        return result
    except Exception as error:  # noqa: BLE001 - landing never fails the run
        engine.log(f"[save] could not land the run in the lake: {error}", "warn")
        return None
