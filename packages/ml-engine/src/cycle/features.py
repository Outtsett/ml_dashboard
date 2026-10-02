"""Causal feature matrix for the Model Cycle.

Pipeline, all trailing-window:

1. ``shared.features.compute_features`` on the loaded OHLCV (the registry in
   ``packages/config/features.json``).
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
5. The FinBERT news-sentiment family (``shared/sentiment.py``) is appended
   AFTER the z-score and exempt from it and from the constant-column drop: it is
   bounded, sparse (a 250-bar z-score of a mostly-quiet series is mostly 0), and
   mandatory — before news coverage begins it is legitimately constant, and a
   model still has to carry it. It needs the bars' symbol, timeframe, open
   timestamps and clock (``MarketContext``); every training run passes them and
   ``require_finbert`` refuses a feature set without the family.

``FeatureSet.raw`` keeps the kept columns as they were before step 4 (the
same warmup NaNs), so "Inside the model" can show a bar's inputs in their own
units beside the z-scores the model read. ``display_names`` gives each feature
its full-word ``displayName`` from ``features.json``.

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
    raw: np.ndarray | None = None            # float32 (n_bars, n_features): the kept columns before the z-score


def load_feature_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def normalization_settings(config: dict | None = None) -> tuple[int, tuple[float, float]]:
    config = config or load_feature_config()
    normalization = config.get("normalization", {})
    lookback = int(normalization.get("lookback", 250))
    clip = normalization.get("clip", [-5, 5])
    return lookback, (float(clip[0]), float(clip[1]))


def display_names(names: list[str], config: dict | None = None) -> list[str]:
    """Each feature's full-word ``displayName`` from ``features.json``; a name
    the registry does not carry reads as its words ("planted_signal" ->
    "planted signal")."""
    config = config or load_feature_config()
    known = {definition["name"]: definition.get("displayName") for definition in config["features"]}
    return [known.get(name) or name.replace("_", " ") for name in names]


def _warmups(config: dict) -> dict[str, int]:
    warmups: dict[str, int] = {}
    for definition in config["features"]:
        params = definition.get("params", {}) or {}
        warmups[definition["name"]] = int(max(params.get("window", 0), params.get("horizon", 0)))
    return warmups


def _raw_features(ohlcv: dict, warmups: dict[str, int]) -> tuple[np.ndarray, list[str]]:
    from shared.features import compute_base_features

    engine_input = {
        "open_": np.asarray(ohlcv["open"], dtype=np.float64),
        "high": np.asarray(ohlcv["high"], dtype=np.float64),
        "low": np.asarray(ohlcv["low"], dtype=np.float64),
        "close": np.asarray(ohlcv["close"], dtype=np.float64),
        "volume": np.asarray(ohlcv["volume"], dtype=np.float64),
    }
    matrix, names, _ = compute_base_features(engine_input, categories=None, n_jobs=1)
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


@dataclass
class MarketContext:
    """What the FinBERT family needs to align news with the bars: the symbol,
    its timeframe, the bar OPEN timestamps (int epoch seconds as loaded) and the
    clock they are stamped in (``shared.sentiment.clock_for``)."""

    symbol: str
    timeframe: str
    timestamps: np.ndarray
    clock: str


def build_features(ohlcv: dict, *, check_causality: bool = True,
                   context: MarketContext | None = None) -> FeatureSet:
    """``ohlcv``: dict with open/high/low/close/volume float arrays in time order.

    ``context`` appends the mandatory FinBERT family (step 5). Every training
    run passes it; synthetic unit tests of the OHLCV mechanics may omit it, and
    ``require_finbert`` is what a run checks before it trains.
    """
    config = load_feature_config()
    lookback, clip = normalization_settings(config)
    warmups = _warmups(config)
    raw, names = _raw_features(ohlcv, warmups)
    dropped: dict[str, str] = {}

    registry_names = [
        definition["name"] for definition in config["features"]
        if not definition["name"].startswith("finbert_")
    ]
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
    if keep:
        normalized = rolling_zscore(raw[:, keep], lookback, clip)
        kept_raw = raw[:, keep]
    else:
        normalized = np.empty((raw.shape[0], 0))
        kept_raw = np.empty((raw.shape[0], 0))

    if context is not None:
        from shared.sentiment import finbert_features

        finbert, finbert_names = finbert_features(
            context.symbol, context.timestamps, timeframe=context.timeframe, clock=context.clock
        )
        normalized = np.column_stack([normalized, finbert])
        kept_raw = np.column_stack([kept_raw, finbert])
        kept_names = kept_names + finbert_names

    return FeatureSet(normalized.astype(np.float32), kept_names, dropped, lookback, clip,
                      raw=kept_raw.astype(np.float32))


FINBERT_MISSING = (
    "this run's features carry no FinBERT columns — FinBERT news sentiment is mandatory in every model "
    "(build_features(..., context=MarketContext(...)), see packages/ml-engine/packages/shared/src/sentiment.py)"
)


def require_finbert(feature_set: FeatureSet) -> None:
    """Raise unless the whole FinBERT family is present. Called by every run
    before training starts."""
    from shared.sentiment import FEATURE_NAMES

    missing = [name for name in FEATURE_NAMES if name not in feature_set.names]
    if missing:
        raise ValueError(f"{FINBERT_MISSING}; missing {missing}")


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
