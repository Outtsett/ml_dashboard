"""
Feature cache — sha256-keyed parquet store for engineered feature matrices.

Drops files into ``data/.cache/<hash>.parquet`` plus a JSON sidecar with metadata.
The TypeScript side at ``src/server/cache/parquet.ts`` already scans this directory
on a 10-minute cron and evicts oldest-first when the 2 GB cap is breached, so we
only have to write atomically.

Cache key inputs:
  - symbol, timeframe, date_range (start/end)
  - sorted feature category list
  - mtime of src/config/features.json (auto-invalidates on registry edits)

Layout of a cached parquet:
  Columns: ``ts`` (Int64 epoch-sec), ``f_<name>`` (Float32) for each feature.
  Feature names are also persisted in the JSON sidecar for fast metadata reads.

Sidecar JSON shape::
    {
        "symbol": "MNQ", "timeframe": "5m",
        "date_range": {"start": "...", "end": "..."},
        "categories": ["price_action", "volatility", ...],
        "features_json_mtime_ns": 1730839271234567890,
        "feature_names": [...],
        "n_rows": 412934,
        "created_ms": 1730839272123,
        "writer_pid": 28744
    }
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Callable

import numpy as np
import polars as pl

from .protocol import emit_log

# ─── Paths ────────────────────────────────────────────────────────────────────

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_CACHE_DIR = _PROJECT_ROOT / "data" / ".cache"
_FEATURES_JSON = _PROJECT_ROOT / "src" / "config" / "features.json"


def _ensure_cache_dir() -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _features_json_mtime_ns() -> int:
    try:
        return _FEATURES_JSON.stat().st_mtime_ns
    except FileNotFoundError:
        return 0


def _news_data_version() -> str:
    from .sentiment import data_version

    return data_version()


def _build_key(
    symbol: str,
    timeframe: str,
    date_range: dict | None,
    categories: list[str] | None,
) -> str:
    payload = {
        "symbol": symbol,
        "timeframe": timeframe,
        "date_range": date_range or {},
        "categories": sorted(categories or []),
        "features_json_mtime_ns": _features_json_mtime_ns(),
        # Every matrix carries the mandatory FinBERT family, which changes when
        # news lands or is rescored — without this a cached matrix would keep
        # yesterday's sentiment forever.
        "news_data_version": _news_data_version(),
    }
    blob = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


# ─── Public API ───────────────────────────────────────────────────────────────


def cached_features(
    symbol: str,
    timeframe: str,
    date_range: dict | None,
    categories: list[str] | None,
    compute_fn: Callable[[], tuple[np.ndarray, list[str], np.ndarray]],
) -> tuple[np.ndarray, list[str], np.ndarray]:
    """Return (feature_matrix, feature_names, timestamps), reading from disk on hit.

    On miss, calls ``compute_fn()``, persists the result atomically (write to
    ``<hash>.parquet.tmp`` then ``os.replace``), then returns it.

    Parameters
    ----------
    symbol, timeframe, date_range, categories
        Cache-key inputs. ``date_range`` should be ``None`` or a dict with keys
        ``start`` and ``end`` (ISO date strings). ``categories`` should be the
        feature categories actually used.
    compute_fn
        Zero-arg callable that returns ``(matrix, names, timestamps)`` where
        - ``matrix``      shape ``(n_rows, n_features)`` (any float dtype OK)
        - ``names``       list[str], length ``n_features``
        - ``timestamps``  shape ``(n_rows,)`` in **epoch seconds**

    Returns
    -------
    Same triple, with matrix downcast to float32 and timestamps as int64.
    """
    _ensure_cache_dir()
    key = _build_key(symbol, timeframe, date_range, categories)
    parquet_path = _CACHE_DIR / f"{key}.parquet"
    sidecar_path = _CACHE_DIR / f"{key}.json"

    if parquet_path.exists() and sidecar_path.exists():
        try:
            return _load_cached(parquet_path, sidecar_path)
        except Exception as exc:
            emit_log(
                f"[feature_cache] Load failed for {key[:12]}, recomputing: {exc}",
                level="warning",
            )

    t0 = time.perf_counter()
    matrix, names, timestamps = compute_fn()
    compute_secs = time.perf_counter() - t0

    matrix = np.ascontiguousarray(matrix, dtype=np.float32)
    timestamps = _normalize_timestamps(timestamps)
    if matrix.shape[0] != timestamps.shape[0]:
        raise ValueError(
            f"feature_cache: matrix has {matrix.shape[0]} rows but {timestamps.shape[0]} timestamps"
        )
    if matrix.shape[1] != len(names):
        raise ValueError(f"feature_cache: matrix has {matrix.shape[1]} cols but {len(names)} names")

    _persist(
        parquet_path,
        sidecar_path,
        matrix,
        names,
        timestamps,
        symbol=symbol,
        timeframe=timeframe,
        date_range=date_range,
        categories=categories,
    )

    emit_log(
        f"[feature_cache] Cached {matrix.shape[0]:,} rows x {matrix.shape[1]} features "
        f"({key[:12]}, compute {compute_secs:.1f}s)"
    )
    return matrix, names, timestamps


def cache_path_for(
    symbol: str,
    timeframe: str,
    date_range: dict | None,
    categories: list[str] | None,
) -> Path:
    """Return the canonical parquet path for a given key — used by HPO preloader."""
    _ensure_cache_dir()
    return _CACHE_DIR / f"{_build_key(symbol, timeframe, date_range, categories)}.parquet"


def has_cache(
    symbol: str,
    timeframe: str,
    date_range: dict | None,
    categories: list[str] | None,
) -> bool:
    """True if both parquet and sidecar exist for this key."""
    _ensure_cache_dir()
    key = _build_key(symbol, timeframe, date_range, categories)
    return (_CACHE_DIR / f"{key}.parquet").exists() and (_CACHE_DIR / f"{key}.json").exists()


# ─── Internals ────────────────────────────────────────────────────────────────


def _normalize_timestamps(ts) -> np.ndarray:
    """Coerce timestamps to a 1-D int64 numpy array of epoch seconds."""
    arr = np.asarray(ts)
    if arr.dtype.kind == "M":  # datetime64
        return arr.astype("datetime64[s]").astype("int64")
    if arr.dtype.kind in ("i", "u"):
        sample = int(arr[0]) if arr.size else 0
        if sample > 10**14:
            return (arr // 1_000_000_000).astype("int64")
        if sample > 10**11:
            return (arr // 1000).astype("int64")
        return arr.astype("int64")
    if arr.dtype.kind == "O":
        from datetime import datetime as _dt

        out = np.empty(arr.shape[0], dtype="int64")
        for i, v in enumerate(arr):
            if isinstance(v, _dt):
                out[i] = int(v.timestamp())
            elif hasattr(v, "as_py"):
                out[i] = int(v.as_py().timestamp())
            else:
                out[i] = int(float(str(v)))
        return out
    if arr.dtype.kind == "f":
        return arr.astype("int64")
    raise TypeError(f"feature_cache: unsupported timestamp dtype {arr.dtype}")


def _load_cached(
    parquet_path: Path, sidecar_path: Path
) -> tuple[np.ndarray, list[str], np.ndarray]:
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
    names: list[str] = sidecar["feature_names"]
    df = pl.read_parquet(parquet_path)
    timestamps = df["ts"].to_numpy().astype("int64")
    feat_cols = [f"f_{n}" for n in names]
    matrix = df.select(feat_cols).to_numpy().astype(np.float32)
    return matrix, names, timestamps


def _persist(
    parquet_path: Path,
    sidecar_path: Path,
    matrix: np.ndarray,
    names: list[str],
    timestamps: np.ndarray,
    *,
    symbol: str,
    timeframe: str,
    date_range: dict | None,
    categories: list[str] | None,
) -> None:
    cols: dict[str, np.ndarray] = {"ts": timestamps}
    for i, name in enumerate(names):
        cols[f"f_{name}"] = matrix[:, i]
    df = pl.DataFrame(cols)

    tmp_parquet = parquet_path.with_suffix(".parquet.tmp")
    tmp_sidecar = sidecar_path.with_suffix(".json.tmp")

    df.write_parquet(tmp_parquet, compression="zstd", compression_level=3)
    sidecar_obj = {
        "symbol": symbol,
        "timeframe": timeframe,
        "date_range": date_range or {},
        "categories": sorted(categories or []),
        "features_json_mtime_ns": _features_json_mtime_ns(),
        "feature_names": list(names),
        "n_rows": int(matrix.shape[0]),
        "n_features": int(matrix.shape[1]),
        "created_ms": int(time.time() * 1000),
        "writer_pid": os.getpid(),
    }
    tmp_sidecar.write_text(json.dumps(sidecar_obj, indent=2), encoding="utf-8")

    os.replace(tmp_parquet, parquet_path)
    os.replace(tmp_sidecar, sidecar_path)
