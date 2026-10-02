r"""Land the multimodal training runs' records in the lake for the Training environment study.

The notebook ``Trading/quant/model/notebooks/training_environment.py`` read the
append-only record ``scripts/train_multimodal_direction.py`` writes to
``model/data/training_runs/<run>/``: ``stream.jsonl`` plus one snapshot per kind
(``bars``, ``blocks``, ``embedding_epoch_NNN``, ``layers_epoch_NNN``), as parquet
from the current writer or ``.npz`` from the legacy one. The dashboard's DuckDB
cannot read either, so this job reads every run directory read-only, with the
writer's own ``read_stream`` (``training_stream.py``, loaded by path), and lands
the events and every snapshot the notebook drew as tables under

    s3://derived/study_training_environment/recipe=snapshot_<UTC time>/table=<name>/

which the dashboard serves as ``derived_study_training_environment_<name>``:

    runs                one row per run: status, configuration, label balance, best accuracy
    epochs              train_loss, direction_accuracy, majority_baseline_accuracy, skill, seconds
    block_token_norms   each modality block's mean token norm, per epoch
    batch_losses        the loss on every eighth batch, in stream order
    events              every stream event (the raw stream table)
    bars                the OHLCV the model trained on (the last 4,000 bars)
    blocks              the catalogue of modality blocks: block order, feature order, feature names
    block_features      every modality block as numbers: bar x feature, long format
    embedding_points    the 2-D PCA of the bar tokens, per snapshot epoch
    layer_readings      per layer: output distribution, dead units, gradient norm, per epoch
    layer_activations   a 32 x 32 slice of each layer's real activations, per epoch

A non-finite number lands as NULL, so SQL reads it as "not measured" the way the
notebook's nan-aware statistics did. A recipe is never overwritten: each run of
this job is a new ``snapshot_<time>`` recipe, and the page reads, per run, the
recipe whose ``runs.landed_at`` is latest. Re-run it while a training run is in
progress (or after) to put its newest events in the lake.

Run with the datalake interpreter (it carries ``lake``, pandas and pyarrow):

    E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/training_environment/build.py
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from ta_strategy.store import land, write_local  # noqa: E402

DATASET = "study_training_environment"
MODEL_ROOT = Path(os.environ.get("QUANT_ROOT", "E:/source/repos/ml_dashboard/Trading/quant")) / "model"
DEFAULT_RUNS_ROOT = Path(os.environ.get("TRAINING_RUNS_ROOT", str(MODEL_ROOT / "data" / "training_runs")))
EVENT_DETAIL_CHARACTERS = 2000


def load_read_stream():
    """The writer's own reader, loaded by path (its package imports torch)."""
    path = MODEL_ROOT / "src" / "ml" / "cnn_transformer" / "training_stream.py"
    spec = importlib.util.spec_from_file_location("training_stream", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["training_stream"] = module
    spec.loader.exec_module(module)
    return module.read_stream


def finite(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def load_snapshot(directory: Path, file_name: str) -> dict[str, np.ndarray]:
    """One snapshot as {array name: ndarray}, whichever format the writer used.

    Parquet snapshots are either wide (one column per 1-D array, e.g. ``bars``)
    or long (``array_name``, ``row_index``, ``column_index``, ``value``) with the
    1-D companions in ``<name>__scalars.parquet``; ``.npz`` holds the arrays as
    they were. A stream can name one format while the other is what is on disk.
    """
    base = Path(file_name).stem
    candidates = [directory / file_name, directory / f"{base}.parquet", directory / f"{base}.npz"]
    path = next((candidate for candidate in candidates if candidate.exists()), None)
    if path is None:
        raise FileNotFoundError(f"{directory / file_name}")
    if path.suffix == ".npz":
        with np.load(path, allow_pickle=False) as archive:
            return {name: np.asarray(archive[name]) for name in archive.files}

    frame = pq.read_table(path).to_pandas()
    arrays: dict[str, np.ndarray] = {}
    if {"array_name", "row_index", "column_index", "value"} <= set(frame.columns):
        for name, group in frame.groupby("array_name", sort=False):
            rows = int(group["row_index"].max()) + 1
            columns = int(group["column_index"].max()) + 1
            matrix = np.full((rows, columns), np.nan, dtype=np.float32)
            matrix[group["row_index"].to_numpy(), group["column_index"].to_numpy()] = group["value"].to_numpy()
            arrays[str(name)] = matrix
        companion = directory / f"{path.stem}__scalars.parquet"
        if companion.exists():
            for name, series in pq.read_table(companion).to_pandas().items():
                arrays[str(name)] = series.to_numpy()
    else:
        for name, series in frame.items():
            arrays[str(name)] = series.to_numpy()
    return arrays


def suffix_of(file_name: str) -> str:
    return Path(file_name).suffix.lstrip(".")


def run_tables(run_name: str, directory: Path, read_stream, landed_at: datetime) -> dict[str, list]:
    """Every table's rows for one run: a list of dicts (small tables) or frames (big ones)."""
    events = read_stream(directory)
    started = next((e for e in events if e["type"] == "run_started"), None)
    finished = next((e for e in events if e["type"] == "run_finished"), None)
    epochs = [e for e in events if e["type"] == "epoch"]
    batches = [e for e in events if e["type"] == "batch"]
    if started is None:
        raise RuntimeError(f"{run_name}: the stream has no run_started event")
    config = started["config"]
    counts = started["label_counts"]
    latest = epochs[-1] if epochs else None
    best = max(epochs, key=lambda e: e["metrics"].get("direction_accuracy") or -1.0) if epochs else None
    formats: set[str] = set()
    tables: dict[str, list] = {name: [] for name in (
        "runs", "epochs", "block_token_norms", "batch_losses", "events", "bars", "blocks", "block_features",
        "embedding_points", "layer_readings", "layer_activations")}

    promoted = {"type", "epoch", "batch", "batches", "loss", "file", "elapsed_seconds", "config", "fields"}
    for index, event in enumerate(events):
        detail = json.dumps({k: v for k, v in event.items() if k not in promoted}, default=str)
        tables["events"].append({
            "run_name": run_name, "event_index": index, "event_type": event["type"],
            "epoch": event.get("epoch"), "batch": event.get("batch"), "batch_count": event.get("batches"),
            "loss": finite(event.get("loss")), "snapshot_file": event.get("file"),
            "elapsed_seconds": finite(event.get("elapsed_seconds")),
            "detail": detail if len(detail) <= EVENT_DETAIL_CHARACTERS else detail[:EVENT_DETAIL_CHARACTERS] + "...",
        })

    for event in epochs:
        metrics = event["metrics"]
        tables["epochs"].append({
            "run_name": run_name, "epoch": event["epoch"], "epochs_configured": event["epochs"],
            "train_loss": finite(metrics.get("train_loss")), "direction_accuracy": finite(metrics.get("direction_accuracy")),
            "majority_baseline_accuracy": finite(metrics.get("majority_baseline")), "skill": finite(metrics.get("skill")),
            "seconds": finite(event.get("seconds")),
        })
        for block, value in event["block_norms"].items():
            tables["block_token_norms"].append({"run_name": run_name, "epoch": event["epoch"], "block": block, "token_norm": finite(value)})
    for step, event in enumerate(batches):
        tables["batch_losses"].append({
            "run_name": run_name, "step": step, "epoch": event["epoch"], "batch": event["batch"],
            "batch_count": event["batches"], "loss": finite(event["loss"]),
        })

    bars_event = next((e for e in events if e["type"] == "bars"), None)
    if bars_event is not None:
        formats.add(suffix_of(bars_event["file"]))
        raw = load_snapshot(directory, bars_event["file"])
        timestamps = pd.to_datetime(raw["timestamp"])
        tables["bars"].append(pd.DataFrame({
            "run_name": run_name, "bar_index": np.arange(len(timestamps)), "timestamp": timestamps,
            "open": raw["open"].astype(np.float64), "high": raw["high"].astype(np.float64),
            "low": raw["low"].astype(np.float64), "close": raw["close"].astype(np.float64),
            "volume": raw["volume"].astype(np.float64),
        }))

    blocks_event = next((e for e in events if e["type"] == "blocks"), None)
    if blocks_event is not None:
        formats.add(suffix_of(blocks_event["file"]))
        raw = load_snapshot(directory, blocks_event["file"])
        for block_index, (block, fields) in enumerate(blocks_event["fields"].items()):
            matrix = np.asarray(raw[block], dtype=np.float64)
            if matrix.shape[1] != len(fields):
                raise RuntimeError(f"{run_name}: block {block} has {matrix.shape[1]} columns but {len(fields)} field names")
            for feature_index, feature in enumerate(fields):
                tables["blocks"].append({
                    "run_name": run_name, "block": block, "block_index": block_index, "feature": feature,
                    "feature_index": feature_index, "bar_count": int(matrix.shape[0]),
                })
            tables["block_features"].append(pd.DataFrame({
                "run_name": run_name, "block": block,
                "feature": np.tile(np.asarray(fields, dtype=object), matrix.shape[0]),
                "feature_index": np.tile(np.arange(matrix.shape[1]), matrix.shape[0]),
                "bar_index": np.repeat(np.arange(matrix.shape[0]), matrix.shape[1]),
                "value": np.where(np.isfinite(matrix), matrix, np.nan).reshape(-1),
            }))

    for event in (e for e in events if e["type"] == "embedding"):
        formats.add(suffix_of(event["file"]))
        raw = load_snapshot(directory, event["file"])
        projection = np.asarray(raw["projection"], dtype=np.float64)
        label = np.asarray(raw["label"]).reshape(-1)
        fired = np.asarray(raw["pattern_multihot"]).sum(axis=1)
        tables["embedding_points"].append(pd.DataFrame({
            "run_name": run_name, "epoch": event["epoch"], "point_index": np.arange(len(projection)),
            "component_1": projection[:, 0], "component_2": projection[:, 1],
            "barrier_label": label.astype(np.int64),
            "barrier_outcome": np.where(label == 1, "up first", "down first"),
            "pattern_fired_count": fired.astype(np.int64),
            "pattern_fired": np.where(fired > 0, "fired", "none fired"),
            "variance_explained": finite(event.get("variance_explained")),
        }))

    for event in (e for e in events if e["type"] == "layers"):
        formats.add(suffix_of(event["file"]))
        raw = load_snapshot(directory, event["file"])
        for order, reading in enumerate(event["readings"]):
            name = reading["name"]
            tables["layer_readings"].append({
                "run_name": run_name, "epoch": event["epoch"], "layer_order": order, "layer_name": name,
                "module_type": reading["module_type"], "output_shape": str(list(reading["output_shape"])),
                "parameter_count": reading["parameter_count"],
                "mean": finite(reading["mean"]), "standard_deviation": finite(reading["standard_deviation"]),
                "minimum": finite(reading["minimum"]), "maximum": finite(reading["maximum"]),
                "zero_fraction": finite(reading["zero_fraction"]), "saturated_fraction": finite(reading["saturated_fraction"]),
                # A layer the optimiser never reached carries no entry; the notebook filled it with 0.
                "gradient_norm": finite(event["gradient_norms"].get(name, 0.0)) or 0.0,
            })
            sample = raw.get(name.replace(".", "__"))
            if sample is None:
                continue
            sample = np.asarray(sample, dtype=np.float64)
            tables["layer_activations"].append(pd.DataFrame({
                "run_name": run_name, "epoch": event["epoch"], "layer_name": name,
                "row_index": np.repeat(np.arange(sample.shape[0]), sample.shape[1]),
                "unit_index": np.tile(np.arange(sample.shape[1]), sample.shape[0]),
                "activation": np.where(np.isfinite(sample), sample, np.nan).reshape(-1),
            }))

    modified = datetime.fromtimestamp((directory / "stream.jsonl").stat().st_mtime, tz=timezone.utc).replace(tzinfo=None)
    tables["runs"].append({
        "run_name": run_name, "landed_at": landed_at,
        "status": "finished" if finished else ("running" if latest else "starting"),
        "symbol": config["symbol"], "timeframe": config["timeframe"], "maximum_bars": config["max_bars"],
        "window_bars": config["window"], "horizon_bars": config["horizon"], "barrier_points": config["barrier_points"],
        "epochs_configured": config["epochs"], "batch_size": config["batch_size"], "learning_rate": config["learning_rate"],
        "model_dimension": config["d_model"], "modality_dropout": config["modality_dropout"],
        "train_fraction": config["train_fraction"],
        "up_label_count": counts["up"], "down_label_count": counts["down"], "unresolved_label_count": counts["unresolved"],
        "epochs_seen": len(epochs), "batches_streamed": len(batches), "event_count": len(events),
        "latest_epoch": latest["epoch"] if latest else None,
        "best_direction_accuracy": finite(best["metrics"].get("direction_accuracy")) if best else None,
        "best_epoch": best["epoch"] if best else None,
        "majority_baseline_accuracy": finite(best["metrics"].get("majority_baseline")) if best else None,
        "skill": finite(best["metrics"].get("skill")) if best else None,
        "parameter_count": (finished or {}).get("metrics", {}).get("parameters"),
        "elapsed_seconds": finite((finished or latest or started).get("elapsed_seconds")),
        "stream_modified_at": modified, "snapshot_format": "+".join(sorted(f for f in formats if f)) or None,
    })
    return tables


def assemble(per_run: list[dict[str, list]]) -> dict[str, pd.DataFrame]:
    out: dict[str, pd.DataFrame] = {}
    for name in per_run[0]:
        pieces: list[pd.DataFrame] = []
        rows: list[dict] = []
        for tables in per_run:
            for item in tables[name]:
                if isinstance(item, pd.DataFrame):
                    pieces.append(item)
                else:
                    rows.append(item)
        if rows:
            pieces.append(pd.DataFrame(rows))
        frame = pd.concat(pieces, ignore_index=True) if pieces else pd.DataFrame()
        # Counts that are absent on some rows come out of pandas as floats; keep them integers.
        for column in ("epoch", "batch", "batch_count", "latest_epoch", "best_epoch", "parameter_count"):
            if column in frame.columns:
                frame[column] = frame[column].astype("Int64")
        out[name] = frame
    return out


def recipe_exists(recipe: str) -> bool:
    from lake.layout import arrow_fs, arrow_key, derived_root

    key = arrow_key(derived_root(DATASET, recipe) / "table=runs" / "part-0.parquet")
    return arrow_fs().get_file_info(key).type.name != "NotFound"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--runs-root", default=str(DEFAULT_RUNS_ROOT))
    parser.add_argument("--recipe", default=None, help="default snapshot_<UTC time>")
    parser.add_argument("--dry-run", action="store_true", help="read and print the table sizes, land nothing")
    args = parser.parse_args()

    landed_at = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    recipe = args.recipe or f"snapshot_{landed_at:%Y%m%dT%H%M%SZ}"
    root = Path(args.runs_root)
    directories = sorted(p for p in root.glob("*") if (p / "stream.jsonl").exists())
    if not directories:
        print(f"no run with a stream.jsonl under {root}", file=sys.stderr)
        return 1
    if not args.dry_run and recipe_exists(recipe):
        print(f"recipe {recipe} is already landed under {DATASET}; pass --recipe for a new one", file=sys.stderr)
        return 1

    read_stream = load_read_stream()
    per_run = []
    for directory in directories:
        tables = run_tables(directory.name, directory, read_stream, landed_at)
        per_run.append(tables)
        print(f"read {directory.name}: {tables['runs'][0]['event_count']} events, status {tables['runs'][0]['status']}")
    frames = assemble(per_run)
    for name, frame in frames.items():
        print(f"  {name}: {len(frame):,} rows, {len(frame.columns)} columns")
    if args.dry_run:
        return 0

    with tempfile.TemporaryDirectory() as scratch:
        paths = write_local(frames, scratch)
        source = f"{root} (stream.jsonl and snapshots of {', '.join(d.name for d in directories)}; read by packages/ml-engine/src/studies/training_environment/build.py)"
        landed = land(paths, recipe, source=source, dataset=DATASET)
    for name, detail in landed.items():
        print(f"  landed {name}: {detail['rows']:,} rows, {detail['bytes']:,} bytes, manifest {detail['manifest']}, {detail['uri']}")
    print(f"recipe {recipe}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
