"""Saving and reloading a bridge model.

Every saved Model Cycle model is a folder with ``model.json`` (what
``cycle.models.load_adapter`` reads to pick the class: ``adapter`` = the
family's registry adapter key) plus its own files. ``write_model_json`` builds
the sidecar through ``cycle.models._base_metadata`` — the same fields every
other adapter writes (key, adapter, family, task, parameters, feature_count,
minimum_history, step_unit, seed, device, model_file, saved_at, libraries, the
fit summary) — plus the bridge's ``variant`` and a snapshot of its registry
entry's ``direction`` and ``price`` blocks, so a later registry edit cannot
change what a saved model means.

Writes are atomic (a temporary file, then ``os.replace``): a run stopped
mid-save never leaves a half-written model that reloads. Arrays are saved with
``allow_pickle=False`` and read through a handle (never memory-mapped: Windows
would lock the file). torch and joblib are imported only by the functions that
need them, so a numpy-only bridge never imports torch through this module.
"""

from __future__ import annotations

import importlib.metadata
import json
import os
from pathlib import Path
from typing import Any

import numpy as np

MODEL_JSON = "model.json"
VOLATILE_METADATA = ("saved_at", "fit_seconds")


def _temporary(path: Path) -> Path:
    return path.with_name(path.name + ".tmp")


def save_json(path: str | Path, document: Any) -> Path:
    path = Path(path)
    temporary = _temporary(path)
    temporary.write_text(json.dumps(document, indent=2, default=_json_default), encoding="utf-8")
    os.replace(temporary, path)
    return path


def _json_default(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    return str(value)


def load_json(path: str | Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_arrays(path: str | Path, **arrays: np.ndarray) -> Path:
    path = Path(path)
    temporary = _temporary(path)
    with open(temporary, "wb") as handle:
        np.savez(handle, **{name: np.asarray(values) for name, values in arrays.items()})
    os.replace(temporary, path)
    return path


def load_arrays(path: str | Path) -> dict[str, np.ndarray]:
    with open(path, "rb") as handle, np.load(handle, allow_pickle=False) as stored:
        return {name: np.array(stored[name], copy=True) for name in stored.files}


def save_torch(path: str | Path, state: dict) -> Path:
    import torch

    path = Path(path)
    temporary = _temporary(path)
    torch.save(state, temporary)
    os.replace(temporary, path)
    return path


def load_torch(path: str | Path) -> dict:
    import torch

    return torch.load(Path(path), map_location="cpu", weights_only=True)


def save_joblib(path: str | Path, value: Any) -> Path:
    import joblib

    path = Path(path)
    temporary = _temporary(path)
    joblib.dump(value, temporary)
    os.replace(temporary, path)
    return path


def load_joblib(path: str | Path) -> Any:
    """Unpickles: only for files this process's own ``save_joblib`` wrote into a
    run's artifact folder (a fitted scikit-learn object has no pickle-free
    format). Prefer ``save_arrays`` / ``save_json`` whenever the state is plain."""
    import joblib

    return joblib.load(Path(path))


def library_versions(*distributions: str) -> dict[str, str]:
    """{distribution: installed version} for each name that is installed."""
    versions: dict[str, str] = {}
    for name in distributions:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            continue
    return versions


def entry_snapshot(entry: dict | None) -> dict:
    """The registry blocks that decide what a saved model means."""
    entry = entry or {}
    return {"direction": entry.get("direction"), "price": entry.get("price"), "adapter": entry.get("adapter"),
            "implementation": entry.get("implementation")}


def write_model_json(adapter, directory: str | Path, model_file: str, libraries: dict[str, str],
                     extra: dict | None = None) -> Path:
    """``model.json`` for a fitted bridge adapter (see the module docstring)."""
    from cycle.models import _base_metadata, write_metadata

    folder = Path(directory)
    folder.mkdir(parents=True, exist_ok=True)
    metadata = _base_metadata(adapter, model_file, libraries)
    metadata["variant"] = getattr(adapter, "variant", None)
    metadata["entry"] = entry_snapshot(getattr(adapter, "entry", None))
    metadata["best_iteration"] = getattr(adapter, "best_iteration", None)
    if extra:
        metadata.update(extra)
    return write_metadata(folder, metadata)


def read_model_json(directory: str | Path) -> dict:
    return load_json(Path(directory) / MODEL_JSON)


def comparable_metadata(metadata: dict) -> dict:
    """The metadata without the fields that differ between two identical fits (times)."""
    return {key: value for key, value in metadata.items()
            if key not in VOLATILE_METADATA and not key.endswith("_seconds")}


__all__ = ["MODEL_JSON", "comparable_metadata", "entry_snapshot", "library_versions", "load_arrays", "load_joblib",
           "load_json", "load_torch", "read_model_json", "save_arrays", "save_joblib", "save_json", "save_torch",
           "write_model_json"]
