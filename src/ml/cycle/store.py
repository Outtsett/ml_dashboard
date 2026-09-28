"""Artifacts of a Model Cycle run: ``data/models/<model_id>/`` and the lake.

Written at the end of EVERY fold and again at the end of the run (complete,
stopped or failed), so a crash or a kill later loses at most the fold in
progress. Each write replaces the previous one (the record is idempotent by
run); the lake manifest line for a table is appended once per run.

Local files (full-word column names):
    config.json          the plan (the ``cycle_plan`` event), the run's base parameters, the
                         parameters every fold used, the tuning summaries, the status
    runs_table.parquet   one row: the run (see RUN_COLUMNS)
    bars.parquet         every bar the model read, each once: timestamp, fold, role
                         (context | processed), roll-adjusted OHLCV and the roll adjustment
    predictions.parquet  one row per processed test bar, with the price model's forecast
                         (predicted_move_points, predicted_close on the tick grid,
                         forecast_timestamp) and, once its target bar was walked,
                         forecast_error_points; target_position (wanted at the next open) and
                         position_held (carried through the bar); the bar's net USD and exposure
    fold_<k>/            the direction model and fold_<k>/price_model/ the price model, each
                         saved right after its own fit; fold_<k>/index.npz, written before
                         fitting, holds the rows each was fitted on
    explain/             written at plan time for "Inside the model"
                         (``write_explain_inputs``): manifest.json and the arrays the
                         models read — features.npy, raw_features.npy, timestamps.npy,
                         close.npy, move_scale.npy, labels.npy, price_target.npy
    trades.parquet       one row per trade
    epochs.parquet       one row per training step summary (folds and tuning trials)
    trials.parquet       one row per tuning trial, with its fold
    metrics.parquet      one row per emitted metric, with its fold and trial
    folds.json           fold plans, timings, metrics, model paths, parameters used, tuning
    folds_table.parquet  the same, one row per fold
    scoreboard.json      the final scoreboard
    diagnostics.json     final metrics, folds, device, elapsed seconds, status

Lake (the layout of ``scripts/land_regression_tab_performance.py``):
    s3://derived/model_cycle_runs/recipe=<model_id>/table=<runs|bars|predictions|trades|folds|epochs|trials|metrics>/part-0.parquet
plus one manifest line per table per run in ``meta/ingest_manifests/model_cycle_runs.jsonl``,
which is what defines the dashboard's ``derived_model_cycle_runs_<table>`` views.
The landing runs in-process through ``lake.layout`` (pyarrow, zstd); when that
import fails it runs in the datalake interpreter (``CYCLE_LAKE_PYTHON``, default
``E:/source/repos/datalake/.venv/Scripts/python.exe``). A landing failure is a
warning, never a failed run.
"""

from __future__ import annotations

import json
import os
import subprocess
from typing import TYPE_CHECKING

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from cycle.metrics import METRIC_NAMES as CYCLE_METRIC_NAMES
from cycle.metrics import PRICE_FORECAST_METRIC_NAMES
from shared.protocol import dumps_safe

if TYPE_CHECKING:
    from cycle.engine import CycleEngine

DATASET = "model_cycle_runs"
EXPLAIN_DIRECTORY = "explain"
EXPLAIN_MANIFEST_VERSION = 1
LAKE_TABLES = ("runs", "bars", "predictions", "trades", "folds", "epochs", "trials", "metrics")
DEFAULT_LAKE_PYTHON = "E:/source/repos/datalake/.venv/Scripts/python.exe"

PREDICTION_COLUMNS = (
    ("timestamp", pa.int64()), ("fold_index", pa.int64()), ("open", pa.float64()), ("high", pa.float64()),
    ("low", pa.float64()), ("close", pa.float64()), ("volume", pa.float64()), ("probability_up", pa.float64()),
    ("predicted_direction", pa.int64()),
    # target_position: wanted at the next open after acting on this bar; position_held: carried through this bar
    ("target_position", pa.int64()), ("position_held", pa.int64()),
    ("bar_net_profit_usd", pa.float64()), ("exposed", pa.bool_()), ("crosses_gap", pa.bool_()),
    ("equity_usd", pa.float64()),
    ("actual_direction", pa.int64()), ("correct", pa.bool_()),
    # the price model: its forecast made at this bar of the move to (and close at) the bar
    # label_horizon_bars later, and — once that bar was walked — forecast minus actual move
    ("predicted_move_points", pa.float64()),
    # the model's own output x scale before the tick rounding (the explainer's parity gate reads it)
    ("predicted_move_raw_points", pa.float64()),
    ("predicted_close", pa.float64()), ("forecast_timestamp", pa.int64()),
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
    ("fold_index", pa.int64()), ("trial", pa.int64()), ("state", pa.string()), ("objective_name", pa.string()), ("objective_value", pa.float64()),
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
    ("status", pa.string()), ("error", pa.string()), ("parameters", pa.string()),
    ("tuning_objective", pa.string()), ("tuning_trial_count", pa.int64()),
    ("tuning_best_trial", pa.int64()), ("tuning_best_value", pa.float64()),
)
BAR_COLUMNS = (
    ("timestamp", pa.int64()), ("fold_index", pa.int64()), ("role", pa.string()),
    ("open", pa.float64()), ("high", pa.float64()), ("low", pa.float64()), ("close", pa.float64()),
    ("volume", pa.float64()),
    # points added to the raw price by the roll back-adjustment (0 after the last roll)
    ("roll_adjustment_points", pa.float64()),
)
METRIC_COLUMNS = (
    ("metric_name", pa.string()), ("metric_value", pa.float64()), ("iteration", pa.int64()), ("total", pa.int64()),
    ("fold_index", pa.int64()), ("trial", pa.int64()), ("seconds_elapsed", pa.float64()),
)
RUN_SCALAR_COLUMNS = (
    ("model_id", pa.string()), ("recipe", pa.string()), ("status", pa.string()), ("error", pa.string()),
    ("symbol", pa.string()), ("timeframe", pa.string()), ("model_key", pa.string()), ("model_label", pa.string()),
    ("catalog_spec_id", pa.string()), ("implementation", pa.string()), ("direction_mode", pa.string()),
    ("has_price_model", pa.bool_()), ("device", pa.string()), ("device_name", pa.string()),
    ("started_at_timestamp", pa.int64()), ("finished_at_timestamp", pa.int64()), ("elapsed_seconds", pa.float64()),
    ("data_start_timestamp", pa.int64()), ("data_end_timestamp", pa.int64()), ("bar_count", pa.int64()),
    ("bars_per_year", pa.float64()), ("feature_count", pa.int64()), ("feature_names", pa.string()),
    ("label_horizon_bars", pa.int64()), ("label_threshold_ticks", pa.float64()), ("label_gap_multiple", pa.float64()),
    ("gap_crossing_bar_count", pa.int64()), ("purge_bars", pa.int64()), ("embargo_bars", pa.int64()),
    ("train_days", pa.int64()), ("validation_fraction", pa.float64()), ("test_days", pa.int64()),
    ("step_days", pa.int64()), ("fold_limit", pa.int64()), ("expanding_window", pa.bool_()),
    ("fold_count", pa.int64()), ("folds_completed", pa.int64()),
    ("tick_size", pa.float64()), ("tick_value_usd", pa.float64()), ("point_value_usd", pa.float64()),
    ("cost_per_side_usd", pa.float64()), ("round_trip_cost_usd", pa.float64()), ("cost_model_source", pa.string()),
    ("long_only", pa.bool_()), ("holding_bars", pa.int64()), ("stop_loss_ticks", pa.float64()),
    ("take_profit_ticks", pa.float64()), ("contracts", pa.int64()),
    ("tuning_mode", pa.string()), ("tuning_enabled", pa.bool_()), ("tuning_trials_per_fold", pa.int64()),
    ("tuning_budget_seconds", pa.int64()), ("tuning_objective", pa.string()), ("tuning_inner_blocks", pa.int64()),
    ("tuning_pinned_parameters", pa.string()), ("price_adjustment_method", pa.string()), ("roll_count", pa.int64()),
    ("seed", pa.int64()), ("base_parameters", pa.string()), ("plan", pa.string()), ("stopped", pa.bool_()),
    ("closed_trade_count", pa.int64()), ("bars_processed", pa.int64()), ("final_metrics", pa.string()),
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
            "status": record.get("status"), "error": record.get("error"),
            "parameters": dumps_safe(record.get("parameters")) if record.get("parameters") is not None else None,
            "tuning_objective": (record.get("tuning") or {}).get("objective"),
            "tuning_trial_count": (record.get("tuning") or {}).get("trialCount"),
            "tuning_best_trial": (record.get("tuning") or {}).get("bestTrial"),
            "tuning_best_value": (record.get("tuning") or {}).get("bestValue"),
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


def lake_recipe(model_id: str) -> str:
    """Run ids carry the runner key ("xgboost+walk_forward_cycle"); some S3
    clients read "+" in a key as a space, so the lake recipe spells it "_"."""
    return model_id.replace("+", "_")


def roll_adjustment_points(engine: CycleEngine, timestamps: np.ndarray) -> np.ndarray:
    """Points the back-adjustment added to each bar's raw price: the sum of the
    steps of every roll AFTER the bar (bars past the last roll are as traded)."""
    rolls = (engine.price_adjustment or {}).get("rolls") or []
    out = np.zeros(timestamps.shape[0], dtype=np.float64)
    for roll in rolls:
        out[timestamps < int(roll["timestamp"])] += float(roll["gapPoints"])
    return out


def bars_table(engine: CycleEngine) -> pa.Table:
    """Every bar emitted so far, in order, as the model saw it."""
    chunks = engine.bar_chunks
    if not chunks:
        return table_from_rows([], BAR_COLUMNS)
    timestamps = np.concatenate([chunk["timestamp"] for chunk in chunks])
    fold_index = np.concatenate([np.full(chunk["timestamp"].shape[0], -1 if chunk["fold_index"] is None else int(chunk["fold_index"]), dtype=np.int64) for chunk in chunks])
    role = np.concatenate([np.full(chunk["timestamp"].shape[0], chunk["role"], dtype=object) for chunk in chunks])
    columns = {
        "timestamp": pa.array(timestamps, type=pa.int64()),
        "fold_index": pa.array(np.where(fold_index < 0, None, fold_index).tolist(), type=pa.int64()),
        "role": pa.array(role.tolist(), type=pa.string()),
    }
    for name in ("open", "high", "low", "close", "volume"):
        columns[name] = pa.array(np.concatenate([chunk[name] for chunk in chunks]), type=pa.float64())
    columns["roll_adjustment_points"] = pa.array(roll_adjustment_points(engine, timestamps), type=pa.float64())
    return pa.table(columns, schema=pa.schema([pa.field(name, kind) for name, kind in BAR_COLUMNS]))


def run_row(engine: CycleEngine, status: str) -> dict:
    """The one row of the `runs` table (the 30 scoreboard metrics are added as columns)."""
    s = engine.settings
    plan = engine.plan or {}
    cost = plan.get("costModel") or {}
    final_metrics = (engine.final_scoreboard or {}).get("metrics") or {}
    entry = engine.registry_entry or {}
    adjustment = engine.price_adjustment or {"method": "none", "rolls": []}
    row = {
        "model_id": s.model_id, "recipe": lake_recipe(s.model_id), "status": status, "error": engine.failure,
        "symbol": s.symbol, "timeframe": s.timeframe, "model_key": s.model_family,
        "model_label": plan.get("modelLabel") or engine.display_name,
        "catalog_spec_id": entry.get("catalogSpecId"), "implementation": entry.get("implementation"),
        "direction_mode": engine.direction_mode, "has_price_model": bool(engine.has_price_model),
        "device": s.device, "device_name": s.device_name,
        "started_at_timestamp": int(engine.started_wall_clock),
        "finished_at_timestamp": int(_now_epoch()) if status != "running" else None,
        "elapsed_seconds": float(engine.elapsed()),
        "data_start_timestamp": int(engine.data.timestamps[0]), "data_end_timestamp": int(engine.data.timestamps[-1]),
        "bar_count": len(engine.data), "bars_per_year": float(engine.periods_per_year),
        "feature_count": len(engine.feature_set.names), "feature_names": dumps_safe(list(engine.feature_set.names)),
        "label_horizon_bars": int(engine.horizon), "label_threshold_ticks": float(s.label_threshold_ticks),
        "label_gap_multiple": float(s.label_gap_multiple), "gap_crossing_bar_count": int(engine.crosses_gap.sum()),
        "purge_bars": int(engine.horizon), "embargo_bars": int(s.embargo_bars),
        "train_days": int(s.train_days), "validation_fraction": float(s.validation_fraction), "test_days": int(s.test_days),
        "step_days": int(s.resolved_step_days), "fold_limit": int(s.fold_limit), "expanding_window": bool(s.expanding_window),
        "fold_count": int(engine.fold_count),
        "folds_completed": sum(1 for record in engine.fold_records if record.get("status") == "complete"),
        "tick_size": float(engine.cost.tick_size), "tick_value_usd": float(engine.cost.tick_value),
        "point_value_usd": float(engine.cost.point_value),
        "cost_per_side_usd": float(cost.get("costPerSideUsd", engine.cost.cost_per_side * s.contracts)),
        "round_trip_cost_usd": float(cost.get("roundTripCostUsd", engine.cost.round_trip * s.contracts)),
        "cost_model_source": engine.cost.source,
        "long_only": bool(s.long_only), "holding_bars": int(s.resolved_holding_bars),
        "stop_loss_ticks": float(s.stop_loss_ticks), "take_profit_ticks": float(s.take_profit_ticks), "contracts": int(s.contracts),
        "tuning_mode": s.tuning_mode, "tuning_enabled": bool(s.tuning_enabled),
        "tuning_trials_per_fold": int(s.resolved_tuning_trials), "tuning_budget_seconds": int(s.tuning_budget_seconds),
        "tuning_objective": s.tuning_objective, "tuning_inner_blocks": int(s.tuning_folds),
        "tuning_pinned_parameters": ",".join(s.pinned_parameters),
        "price_adjustment_method": adjustment.get("method"), "roll_count": len(adjustment.get("rolls") or []),
        "seed": int(s.seed), "base_parameters": dumps_safe(engine.parameters), "plan": dumps_safe(plan) if plan else None,
        "stopped": bool(engine.stopped),
        "closed_trade_count": sum(1 for trade in engine.trades.values() if not trade.is_open),
        "bars_processed": len(engine.prediction_rows), "final_metrics": dumps_safe(final_metrics) if final_metrics else None,
    }
    for name in CYCLE_METRIC_NAMES:
        value = final_metrics.get(name)
        row[name] = None if value is None else float(value)
    return row


def run_columns():
    return RUN_SCALAR_COLUMNS + tuple((name, pa.float64()) for name in CYCLE_METRIC_NAMES)


def _now_epoch() -> float:
    import time

    return time.time()


def write_run(engine: CycleEngine, final: bool = True) -> dict:
    """Write every artifact and land every table; returns the done-diagnostics.
    ``final=False`` is the fold-boundary write (status ``running``)."""
    s = engine.settings
    status = engine.run_status if final else "running"
    directory = s.artifact_directory
    os.makedirs(directory, exist_ok=True)
    predictions = table_from_rows(list(engine.prediction_rows.values()), PREDICTION_COLUMNS)
    trades = table_from_rows([trade.to_row() for trade in sorted(engine.trades.values(), key=lambda t: t.number)], TRADE_COLUMNS)
    epochs = table_from_rows(engine.epoch_records, EPOCH_COLUMNS)
    trials = table_from_rows(engine.trial_records, TRIAL_COLUMNS)
    metrics = table_from_rows(engine.metric_records, METRIC_COLUMNS)
    folds = table_from_rows(fold_rows(engine), FOLD_COLUMNS)
    bars = bars_table(engine)
    runs = table_from_rows([run_row(engine, status)], run_columns())
    paths = {
        "runs": os.path.join(directory, "runs_table.parquet"),
        "bars": os.path.join(directory, "bars.parquet"),
        "predictions": os.path.join(directory, "predictions.parquet"),
        "trades": os.path.join(directory, "trades.parquet"),
        "epochs": os.path.join(directory, "epochs.parquet"),
        "trials": os.path.join(directory, "trials.parquet"),
        "metrics": os.path.join(directory, "metrics.parquet"),
        "folds": os.path.join(directory, "folds_table.parquet"),
    }
    for name, table in (("runs", runs), ("bars", bars), ("predictions", predictions), ("trades", trades),
                        ("epochs", epochs), ("trials", trials), ("metrics", metrics), ("folds", folds)):
        pq.write_table(table, paths[name], compression="zstd")

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
    config = {"plan": engine.plan, "status": status, "error": engine.failure,
              "baseParameters": engine.parameters,
              "parametersByFold": {str(k): v for k, v in engine.fold_parameters.items()},
              "tuning": {
                  "mode": s.tuning_mode, "enabled": bool(s.tuning_enabled), "trialsPerFold": int(s.resolved_tuning_trials),
                  "budgetSeconds": int(s.tuning_budget_seconds), "objective": s.tuning_objective,
                  "innerBlockCount": int(s.tuning_folds), "pinned": list(s.pinned_parameters),
                  "perFold": {str(k): v for k, v in engine.tuning_summaries.items()},
              },
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
        "status": status,
        "error": engine.failure,
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
        "tuning": config["tuning"],
        "baseParameters": engine.parameters,
        "parametersByFold": config["parametersByFold"],
        "artifactDirectory": directory,
        "lake": None,
    }
    if s.land_in_lake:
        diagnostics["lake"] = land_tables(engine, {name: paths[name] for name in LAKE_TABLES})
    _write_json(os.path.join(directory, "diagnostics.json"), diagnostics)
    engine.log(f"[save] {'artifacts' if final else 'the record so far'} written to {directory}", "info" if final else "debug")
    return diagnostics


MANIFEST_APPEND_ATTEMPTS = 3


def _read_manifest(filesystem, key: str) -> str:
    """The manifest object's text, or "" when there is no object yet."""
    from pyarrow import fs

    if filesystem.get_file_info(key).type == fs.FileType.NotFound:
        return ""
    with filesystem.open_input_stream(key) as source:
        return source.read().decode("utf-8")


def _append_manifest_line(dataset: str, line: str) -> None:
    """Append one line to ``meta/ingest_manifests/<dataset>.jsonl``.

    An object store has no append, and the dashboard's environment has no
    ``s3fs`` (so ``UPath.open("a")`` raises there): the object is read, the line
    added and the whole object written back through the same pyarrow filesystem
    the tables use. Two runs landing at the same moment can overwrite each
    other, so the line is read back and appended again when it is missing."""
    from lake.layout import INGEST_MANIFESTS, arrow_fs, arrow_key

    key = arrow_key(INGEST_MANIFESTS / f"{dataset}.jsonl")
    filesystem = arrow_fs()
    for _attempt in range(MANIFEST_APPEND_ATTEMPTS):
        existing = _read_manifest(filesystem, key)
        if line in existing.splitlines():
            return
        body = existing if existing == "" or existing.endswith("\n") else existing + "\n"
        with filesystem.open_output_stream(key) as sink:
            sink.write((body + line + "\n").encode("utf-8"))
    if line not in _read_manifest(filesystem, key).splitlines():
        raise RuntimeError(f"the manifest line was overwritten {MANIFEST_APPEND_ATTEMPTS} times: {key}")


def _land_job(job: dict) -> dict:
    """Write each table to the lake and append a manifest line for the tables
    named in ``job["manifest_for"]``. Needs ``lake.layout`` (the datalake package
    with ``upath``); the subprocess path runs this same function in the
    datalake interpreter when the dashboard's does not have it."""
    from datetime import datetime, timezone

    from lake.layout import arrow_fs, arrow_key, derived_root
    from lake.writer import COMPRESSION, COMPRESSION_LEVEL

    out: dict = {}
    for name, path in job["tables"].items():
        table = pq.read_table(path)
        root = derived_root(job["dataset"], job["recipe"]) / f"table={name}"
        key = arrow_key(root / "part-0.parquet")
        with arrow_fs().open_output_stream(key) as sink:
            pq.write_table(table, sink, compression=COMPRESSION, compression_level=COMPRESSION_LEVEL)
        size = arrow_fs().get_file_info(key).size
        manifest = "already written"
        if name in job["manifest_for"]:
            entry = {"written_at": datetime.now(timezone.utc).isoformat(), "dataset": job["dataset"], "table": name,
                     "zone": "derived", "recipe": job["recipe"], "source": job["source"], "rows": table.num_rows,
                     "duplicates_removed": 0, "file_count": 1, "bytes": size, "ts_min": None, "ts_max": None}
            try:
                _append_manifest_line(job["dataset"], json.dumps(entry))
                manifest = "written"
            except Exception as error:  # noqa: BLE001
                manifest = f"not written: {error}"
        out[name] = {"uri": "s3://" + key, "rows": table.num_rows, "bytes": size, "manifest": manifest}
    return out


# Runs in the datalake interpreter: argv[1] is a JSON job.
_LANDING_SCRIPT = r"""
import json, sys
sys.path.insert(0, %r)
from cycle.store import _land_job
print(json.dumps(_land_job(json.loads(sys.argv[1]))))
""" % os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def land_tables(engine: CycleEngine, tables: dict[str, str]) -> dict | None:
    """Land ``tables`` (name -> local parquet path) under this run's recipe.
    The manifest line for a table is written the first time this run lands it;
    later landings of the same table replace the object only."""
    s = engine.settings
    job = {"dataset": DATASET, "recipe": lake_recipe(s.model_id), "tables": tables,
           "manifest_for": [name for name in tables if name not in engine.landed_tables],
           "source": f"model cycle run {s.model_id} ({s.model_family}, {s.symbol} {s.timeframe})"}
    try:
        try:
            import lake.layout  # noqa: F401
            import lake.writer  # noqa: F401
            in_process = True
        except ImportError:
            in_process = False
        if in_process:
            result = _land_job(job)
        else:
            interpreter = os.environ.get("CYCLE_LAKE_PYTHON", DEFAULT_LAKE_PYTHON)
            completed = subprocess.run(
                [interpreter, "-c", _LANDING_SCRIPT, json.dumps(job)],
                capture_output=True, text=True, timeout=600, stdin=subprocess.DEVNULL,
            )
            if completed.returncode != 0:
                tail = (completed.stderr or completed.stdout).strip().splitlines()[-1:] or ["no output"]
                raise RuntimeError(f"landing exited {completed.returncode}: {tail[0]}")
            result = json.loads(completed.stdout.strip().splitlines()[-1])
        for name, info in result.items():
            if info["manifest"] == "written":
                engine.landed_tables.add(name)
            unlisted = info["manifest"].startswith("not written")
            engine.log(f"[save] landed {name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})",
                       "warn" if unlisted else "debug")
        return result
    except Exception as error:  # noqa: BLE001 - landing never fails the run
        engine.log(f"[save] could not land the run in the lake: {type(error).__name__}: {error}", "warn")
        return None
