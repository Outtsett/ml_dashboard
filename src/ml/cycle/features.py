"""Causal feature matrix for the Model Cycle.

Pipeline, all trailing-window:

1. ``shared.features.compute_features`` on the loaded OHLCV (the registry in
   ``src/config/features.json``).
2. Each feature's own warmup rows (its ``window`` / ``horizon`` parameter) are
   set to NaN — the shared code fills some of them with 0, and an unknown is
   never a value.
3. **Causality is measured, not trusted.** The raw features are recomputed on
   truncated prefixes of the bars; any feature whose row t changes when bars
   after t are removed looks ahead and is dropped (and logged). Constant and
   all-missing features are dropped too.
4. A causal rolling z-score per column: window = ``normalization.lookback``
   (250), ``min_periods == window`` (warmup rows NaN, never 0), population
   standard deviation, clipped to ``normalization.clip`` (±5). A window with
   zero spread gives 0 (the value equals the window mean).

``history_valid(features, m)`` marks the rows a model needing ``m`` rows of
history can predict: rows t-m+1..t all finite.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "features.json"

# Truncation points (fractions of the bar count) used by the causality check.
CAUSALITY_CUTS = (0.35, 0.6, 0.85)


@dataclass
class FeatureSet:
    matrix: np.ndarray                       # float32 (n_bars, n_features)
    names: list[str]
    dropped: dict[str, str] = field(default_factory=dict)   # name -> reason
    lookback: int = 250
    clip: tuple[float, float] = (-5.0, 5.0)


def load_feature_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def normalization_settings(config: dict | None = None) -> tuple[int, tuple[float, float]]:
    config = config or load_feature_config()
    normalization = config.get("normalization", {})
    lookback = int(normalization.get("lookback", 250))
    clip = normalization.get("clip", [-5, 5])
    return lookback, (float(clip[0]), float(clip[1]))


def _warmups(config: dict) -> dict[str, int]:
    warmups: dict[str, int] = {}
    for definition in config["features"]:
        params = definition.get("params", {}) or {}
        warmups[definition["name"]] = int(max(params.get("window", 0), params.get("horizon", 0)))
    return warmups


def _raw_features(ohlcv: dict, warmups: dict[str, int]) -> tuple[np.ndarray, list[str]]:
    from shared.features import compute_features

    engine_input = {
        "open_": np.asarray(ohlcv["open"], dtype=np.float64),
        "high": np.asarray(ohlcv["high"], dtype=np.float64),
        "low": np.asarray(ohlcv["low"], dtype=np.float64),
        "close": np.asarray(ohlcv["close"], dtype=np.float64),
        "volume": np.asarray(ohlcv["volume"], dtype=np.float64),
    }
    matrix, names, _ = compute_features(engine_input, categories=None, n_jobs=1)
    matrix = np.array(matrix, dtype=np.float64, copy=True)
    matrix[~np.isfinite(matrix)] = np.nan
    for column, name in enumerate(names):
        warmup = min(warmups.get(name, 0), matrix.shape[0])
        if warmup:
            matrix[:warmup, column] = np.nan
    return matrix, list(names)


def lookahead_features(ohlcv: dict, full: np.ndarray, names: list[str], warmups: dict[str, int],
                       cuts=CAUSALITY_CUTS) -> dict[str, int]:
    """Names of features whose early rows change when later bars are removed.

    Returns ``{name: first_row_that_differed}``. A causal feature's row t is a
    function of bars <= t only, so it must be identical on every prefix.
    """
    n = full.shape[0]
    failures: dict[str, int] = {}
    for fraction in cuts:
        cut = int(n * fraction)
        if cut < 50:
            continue
        prefix = {key: np.asarray(ohlcv[key])[:cut] for key in ("open", "high", "low", "close", "volume")}
        truncated, truncated_names = _raw_features(prefix, warmups)
        for column, name in enumerate(names):
            if name in failures:
                continue
            if name not in truncated_names:
                failures[name] = 0
                continue
            a = full[:cut, column]
            b = truncated[:, truncated_names.index(name)]
            same = np.isclose(a, b, rtol=1e-7, atol=1e-10, equal_nan=True)
            if not same.all():
                failures[name] = int(np.argmin(same))
    return failures


def rolling_zscore(matrix: np.ndarray, window: int, clip: tuple[float, float]) -> np.ndarray:
    """Causal rolling z-score per column; rows with fewer than ``window``
    finite values in their trailing window are NaN."""
    frame = pd.DataFrame(matrix)
    rolling = frame.rolling(window=window, min_periods=window)
    mean = rolling.mean().to_numpy()
    std = rolling.std(ddof=0).to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        z = (matrix - mean) / std
    flat = np.isfinite(mean) & np.isfinite(matrix) & (std <= 1e-12)
    z[flat] = 0.0
    z[~np.isfinite(mean) | ~np.isfinite(matrix)] = np.nan
    return np.clip(z, clip[0], clip[1])


def build_features(ohlcv: dict, *, check_causality: bool = True) -> FeatureSet:
    """``ohlcv``: dict with open/high/low/close/volume float arrays in time order."""
    config = load_feature_config()
    lookback, clip = normalization_settings(config)
    warmups = _warmups(config)
    raw, names = _raw_features(ohlcv, warmups)
    dropped: dict[str, str] = {}

    registry_names = [definition["name"] for definition in config["features"]]
    for name in registry_names:
        if name not in names:
            dropped[name] = "the shared feature engine could not compute it from OHLCV alone"

    if check_causality:
        for name, row in lookahead_features(ohlcv, raw, names, warmups).items():
            dropped[name] = f"looks ahead: row {row} changed when later bars were removed"

    keep: list[int] = []
    for column, name in enumerate(names):
        if name in dropped:
            continue
        values = raw[:, column]
        finite = values[np.isfinite(values)]
        if finite.size == 0:
            dropped[name] = "no finite values"
            continue
        if float(np.max(finite) - np.min(finite)) == 0.0:
            dropped[name] = "constant over the loaded window"
            continue
        keep.append(column)

    kept_names = [names[column] for column in keep]
    if not keep:
        return FeatureSet(np.empty((raw.shape[0], 0), dtype=np.float32), [], dropped, lookback, clip)
    normalized = rolling_zscore(raw[:, keep], lookback, clip)
    return FeatureSet(normalized.astype(np.float32), kept_names, dropped, lookback, clip)


def history_valid(features: np.ndarray, minimum_history: int) -> np.ndarray:
    """Row t is valid when rows t-minimum_history+1..t are all finite."""
    m = max(1, int(minimum_history))
    n = features.shape[0]
    row_finite = np.all(np.isfinite(features), axis=1) if features.ndim == 2 and features.shape[1] else np.zeros(n, bool)
    counts = np.concatenate([[0], np.cumsum(row_finite.astype(np.int64))])
    valid = np.zeros(n, dtype=bool)
    if n >= m:
        index = np.arange(m - 1, n)
        valid[m - 1:] = (counts[index + 1] - counts[index + 1 - m]) == m
    return valid
