"""A Model Cycle run's files, as "Inside the model" reads them.

Layout (written by ``cycle.engine`` / ``cycle.store``; see
``docs/plans/2026-09-26-cycle-catalog-inside-view.md``)::

    data/models/<model_id>/
        explain/manifest.json   written at plan time, after the arrays (a manifest means they are complete)
        explain/<name>.npy      features, raw_features, timestamps, close, move_scale, labels, price_target
        fold_<k>/index.npz      train, validation, test, price_train, price_validation (int64 rows)
        fold_<k>/model.json     the direction model (+ its file), saved right after its fit
        fold_<k>/price_model/   the price model, saved right after its fit
        predictions.parquet     what the engine streamed per test bar (written at the end of the run)
        diagnostics.json        written last: its presence means the run ended

Every array is read with ``np.load`` WITHOUT memory mapping: Windows locks a
mapped file until the mapping is gone, and the server must be able to release
a run (``releaseRun``) so its folder can be deleted. The parquet file is read
into numpy arrays and closed.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import ExplainError

EXPLAIN_DIRECTORY = "explain"
MANIFEST_FILE = "manifest.json"
ARRAY_NAMES = ("features", "raw_features", "timestamps", "close", "move_scale", "labels", "price_target")
INDEX_NAMES = ("train", "validation", "test", "price_train", "price_validation")
ROLES = ("direction", "price")
PRICE_MODEL_DIRECTORY = "price_model"


def normalise(run_directory: str | os.PathLike) -> str:
    """One spelling per run folder, for cache keys."""
    return os.path.normcase(os.path.abspath(os.fspath(run_directory)))


def _mtime(path: Path) -> int | None:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return None


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def model_directory(run_directory: str | os.PathLike, fold: int, role: str) -> Path:
    """Where the engine saves a fold's model for ``role`` (``modelFileFor`` in cycleExplainer.ts)."""
    folder = Path(run_directory) / f"fold_{int(fold)}"
    return folder / PRICE_MODEL_DIRECTORY if role == "price" else folder


def run_finished(run_directory: str | os.PathLike) -> bool:
    return (Path(run_directory) / "diagnostics.json").is_file()


def read_explain_manifest(run_directory: str | os.PathLike) -> dict | None:
    """``explain/manifest.json`` as the engine wrote it, or None when the run has none."""
    path = Path(run_directory) / EXPLAIN_DIRECTORY / MANIFEST_FILE
    if not path.is_file():
        return None
    return _read_json(path)


def fold_status(run_directory: str | os.PathLike, manifest: dict, fold: int, role: str) -> str:
    """"ready" | "training" | "missing" | "none" (explain.ts ``cycleExplainFoldStatusSchema``)."""
    if role == "price" and not manifest.get("hasPriceModel", True):
        return "none"
    if (model_directory(run_directory, fold, role) / "model.json").is_file():
        return "ready"
    return "missing" if run_finished(run_directory) else "training"


def manifest(run_directory: str | os.PathLike) -> dict:
    """The run's ``CycleExplainManifest`` (what Node serves at ``/explain``):
    the engine's manifest plus each fold's readiness per role."""
    run = Path(run_directory)
    model_id = run.name
    written = read_explain_manifest(run)
    if written is None:
        return {
            "modelId": model_id, "available": False,
            "reason": "This run was made before Inside the model existed: it has no explain/ folder.",
            "modelKey": None, "displayName": None, "explainKind": None, "directionMode": None,
            "hasPriceModel": False, "featureNames": [], "featureDisplayNames": [], "sequenceLength": 1,
            "labelHorizonBars": 1, "folds": [],
        }
    missing = [name for name in ARRAY_NAMES if not (run / EXPLAIN_DIRECTORY / f"{name}.npy").is_file()]
    folds = []
    for fold in written.get("folds", []):
        k = int(fold["foldIndex"])
        folds.append({"foldIndex": k, "testStart": int(fold["testStart"]), "testEnd": int(fold["testEnd"]),
                      "direction": fold_status(run, written, k, "direction"),
                      "price": fold_status(run, written, k, "price")})
    return {
        "modelId": written.get("modelId") or model_id,
        "available": not missing,
        "reason": None if not missing else f"The run's model inputs were not written ({', '.join(missing)} missing).",
        "modelKey": written.get("modelKey"),
        "displayName": written.get("displayName"),
        "explainKind": written.get("explainKind"),
        "directionMode": written.get("directionMode"),
        "hasPriceModel": bool(written.get("hasPriceModel", False)),
        "featureNames": list(written.get("featureNames", [])),
        "featureDisplayNames": list(written.get("featureDisplayNames", [])),
        "sequenceLength": max(1, int(written.get("sequenceLength", 1))),
        "labelHorizonBars": max(1, int(written.get("labelHorizonBars", 1))),
        "folds": folds,
    }


def fold_for_timestamp(manifest_document: dict, timestamp: int) -> int | None:
    """The fold whose test span holds ``timestamp`` (the bar route's default fold), or None."""
    for fold in manifest_document.get("folds", []):
        if int(fold["testStart"]) <= int(timestamp) <= int(fold["testEnd"]):
            return int(fold["foldIndex"])
    return None


def require_ready(run_directory: str | os.PathLike, manifest_document: dict, fold: int, role: str) -> Path:
    """The model folder for (fold, role), or an ExplainError saying why it cannot be read yet."""
    if role not in ROLES:
        raise ExplainError(f"Unknown role {role!r}: use direction or price.")
    planned = [int(f["foldIndex"]) for f in manifest_document.get("folds", [])]
    if int(fold) not in planned:
        raise ExplainError(f"This run has no fold {int(fold) + 1} (it planned {len(planned)}).",
                           f"fold index {fold}; planned indexes {planned}")
    status = fold_status(run_directory, manifest_document, fold, role)
    words = "direction model" if role == "direction" else "price model"
    if status == "none":
        raise ExplainError("This model has no price model: it only predicts the direction.")
    if status == "training":
        raise ExplainError(f"Fold {int(fold) + 1}'s {words} is still training: it is saved the moment its fit ends.",
                           "status training")
    if status == "missing":
        raise ExplainError(f"Fold {int(fold) + 1}'s {words} was never saved: the run ended before its fit finished.",
                           "status missing")
    return model_directory(run_directory, fold, role)


# ─── the run's arrays ──────────────────────────────────────────────────────


def _load_array(path: Path) -> np.ndarray:
    # read through a handle so nothing keeps the file open (never mmap_mode)
    with open(path, "rb") as handle:
        return np.load(handle, allow_pickle=False)


@dataclass
class RunArrays:
    """``explain/`` of one run, loaded into memory."""

    run_directory: str
    manifest: dict
    signature: tuple
    features: np.ndarray
    raw_features: np.ndarray
    timestamps: np.ndarray
    close: np.ndarray
    move_scale: np.ndarray
    labels: np.ndarray
    price_target: np.ndarray
    raw_available: bool = True

    def row_of(self, timestamp: int) -> int:
        stamp = int(timestamp)
        row = int(np.searchsorted(self.timestamps, stamp))
        if row >= self.timestamps.size or int(self.timestamps[row]) != stamp:
            raise ExplainError(f"This run has no bar at {stamp} (epoch seconds).",
                               f"bars span {int(self.timestamps[0])}..{int(self.timestamps[-1])}"
                               if self.timestamps.size else "the run has no bars")
        return row


def explain_signature(run_directory: str | os.PathLike) -> tuple:
    """Modification times of ``explain/`` (tuning can rewrite it with a longer history)."""
    folder = Path(run_directory) / EXPLAIN_DIRECTORY
    return tuple(_mtime(folder / f"{name}.npy") for name in ARRAY_NAMES) + (_mtime(folder / MANIFEST_FILE),)


def load_run_arrays(run_directory: str | os.PathLike) -> RunArrays:
    run = Path(run_directory)
    written = read_explain_manifest(run)
    if written is None:
        raise ExplainError("This run was made before Inside the model existed: it has no explain/ folder.")
    folder = run / EXPLAIN_DIRECTORY
    missing = [name for name in ARRAY_NAMES if not (folder / f"{name}.npy").is_file()]
    if missing:
        raise ExplainError(f"The run's model inputs were not written ({', '.join(missing)} missing).")
    signature = explain_signature(run)
    arrays = {name: _load_array(folder / f"{name}.npy") for name in ARRAY_NAMES}
    count = arrays["timestamps"].shape[0]
    for name, values in arrays.items():
        if values.shape[0] != count:
            raise ExplainError(f"The run's model inputs disagree: {name} has {values.shape[0]} rows, timestamps {count}.")
    raw_available = bool(written.get("rawFeaturesAvailable", True)) and bool(np.isfinite(arrays["raw_features"]).any())
    return RunArrays(run_directory=normalise(run), manifest=written, signature=signature, raw_available=raw_available,
                     **arrays)


def load_fold_index(run_directory: str | os.PathLike, fold: int) -> dict[str, np.ndarray]:
    path = Path(run_directory) / f"fold_{int(fold)}" / "index.npz"
    if not path.is_file():
        raise ExplainError(f"Fold {int(fold) + 1} has no row index yet (fold_{int(fold)}/index.npz).")
    with open(path, "rb") as handle, np.load(handle, allow_pickle=False) as stored:
        return {name: np.asarray(stored[name], dtype=np.int64).copy() if name in stored.files
                else np.empty(0, dtype=np.int64) for name in INDEX_NAMES}


def model_signature(directory: Path) -> tuple:
    """(relative path, mtime, size) of every file under a model folder — the cache key of a loaded model."""
    entries = []
    if directory.is_dir():
        for root, _, files in os.walk(directory):
            for name in sorted(files):
                path = Path(root) / name
                try:
                    stat = path.stat()
                except OSError:
                    continue
                entries.append((str(path.relative_to(directory)), stat.st_mtime_ns, stat.st_size))
    entries.sort()
    return tuple(entries)


def read_model_metadata(directory: Path) -> dict:
    return _read_json(directory / "model.json")


def read_run_settings(run_directory: str | os.PathLike) -> dict:
    """``config.json`` ``settings`` (the plan device, seed, ...), or {} before the run ended."""
    path = Path(run_directory) / "config.json"
    if not path.is_file():
        return {}
    try:
        return dict(_read_json(path).get("settings") or {})
    except (ValueError, OSError):
        return {}


# ─── what the engine streamed ──────────────────────────────────────────────


@dataclass
class StreamedPredictions:
    """``predictions.parquet`` columns, keyed by row of the explain arrays."""

    signature: int | None
    fold_by_row: dict[int, int]
    probability_up: dict[int, float | None]
    predicted_move_points: dict[int, float | None]


def load_streamed(run_directory: str | os.PathLike, timestamps: np.ndarray) -> StreamedPredictions | None:
    """What the engine streamed per test bar; None while the run is live (the
    file is written when it ends). ``probability_up`` is P(up) exactly as
    traded (clamped to [0, 1]); ``predicted_move_points`` is the price model's
    output times ``move_scale`` at that bar, in points."""
    path = Path(run_directory) / "predictions.parquet"
    if not path.is_file():
        return None
    import pyarrow.parquet as pq

    signature = _mtime(path)
    with open(path, "rb") as handle:
        table = pq.read_table(handle, columns=["timestamp", "fold_index", "probability_up", "predicted_move_points"])
    stamps = table.column("timestamp").to_pylist()
    folds = table.column("fold_index").to_pylist()
    probabilities = table.column("probability_up").to_pylist()
    moves = table.column("predicted_move_points").to_pylist()
    del table
    rows = np.searchsorted(timestamps, np.asarray(stamps, dtype=np.int64))
    fold_by_row: dict[int, int] = {}
    probability_up: dict[int, float | None] = {}
    predicted_move_points: dict[int, float | None] = {}
    for position, stamp in enumerate(stamps):
        row = int(rows[position])
        if row >= timestamps.size or int(timestamps[row]) != int(stamp):
            continue
        fold_by_row[row] = int(folds[position])
        probability_up[row] = _finite(probabilities[position])
        predicted_move_points[row] = _finite(moves[position])
    return StreamedPredictions(signature, fold_by_row, probability_up, predicted_move_points)


def _finite(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def streamed_signature(run_directory: str | os.PathLike) -> int | None:
    return _mtime(Path(run_directory) / "predictions.parquet")


__all__ = [
    "ARRAY_NAMES", "INDEX_NAMES", "RunArrays", "StreamedPredictions", "explain_signature", "fold_for_timestamp",
    "fold_status", "load_fold_index", "load_run_arrays", "load_streamed", "manifest", "model_directory",
    "model_signature", "normalise", "read_explain_manifest", "read_model_metadata", "read_run_settings",
    "require_ready", "run_finished", "streamed_signature",
]
