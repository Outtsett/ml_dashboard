"""
Config-driven feature computation — reads src/config/features.json.

Computes features from raw OHLCV for regime discovery and other ML models.
The feature registry (config/features.json) is the single source of truth for
what features exist, their categories, computation types, and parameters.
"""

from __future__ import annotations

import json
import os

import numpy as np
from joblib import Parallel, delayed
from numba import njit, prange

from .microstructure import compute_microstructure_features

# NOTE: first_principles is imported AFTER _rolling_mean/_rolling_std are
# defined below, because first_principles imports those two helpers from this
# module. Moving the import up creates a partially-initialised circular
# import. This deferral is safe because nothing between this comment and the
# import below references first_principles.

@njit(cache=True, parallel=True)
def _rolling_mean(arr, window):
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:window] = np.nan
    cs = np.cumsum(arr)
    for i in prange(window, n):
        out[i] = (cs[i] - (cs[i - window] if i >= window else 0.0)) / window
    return out

@njit(cache=True, parallel=True)
def _rolling_std(arr, window):
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:window] = np.nan
    for i in prange(window, n):
        chunk = arr[i - window + 1 : i + 1]
        out[i] = np.std(chunk)
    return out

# Deferred (see note above) — must come after the @njit definitions of
# _rolling_mean / _rolling_std that first_principles imports.
from .first_principles import (  # noqa: E402
    _compute_absorption_score,
    _compute_book_imbalance,
    _compute_closing_strength,
    _compute_vwap_distance,
    _compute_vwap_stretch,
)


def _compute_log_return(ohlcv, params):
    h = params.get("horizon", 1)
    close = ohlcv["close"]
    ret = np.zeros_like(close)
    ret[h:] = np.log(close[h:] / close[:-h])
    return ret

def _compute_realized_vol(ohlcv, params):
    window = params.get("window", 20)
    close = ohlcv["close"]
    ret = np.zeros_like(close)
    ret[1:] = np.log(close[1:] / close[:-1])
    return _rolling_std(ret, window)

def _compute_parkinson_vol(ohlcv, params):
    window = params.get("window", 20)
    high, low = ohlcv["high"], ohlcv["low"]
    hl_ratio = np.log(high / low) ** 2
    factor = 1.0 / (4.0 * window * np.log(2.0))
    # Rolling sum of hl_ratio
    n = len(high)
    out = np.empty(n, dtype=np.float64)
    out[:window] = np.nan
    cs = np.cumsum(hl_ratio)
    for i in range(window, n):
        s = cs[i] - cs[i - window]
        out[i] = np.sqrt(factor * s)
    return out

def _compute_volume_ratio(ohlcv, params):
    window = params.get("window", 20)
    vol = ohlcv["volume"]
    ma_vol = _rolling_mean(vol, window)
    return np.divide(vol, ma_vol, out=np.zeros_like(vol), where=ma_vol != 0)

def _compute_bar_range(ohlcv, params):
    high, low, close = ohlcv["high"], ohlcv["low"], ohlcv["close"]
    return np.divide(high - low, close, out=np.zeros_like(close), where=close != 0)

def _compute_body_ratio(ohlcv, params):
    open_, high, low, close = ohlcv["open_"], ohlcv["high"], ohlcv["low"], ohlcv["close"]
    hl = high - low
    body = np.abs(close - open_)
    return np.divide(body, hl, out=np.zeros_like(hl), where=hl != 0)

def _compute_upper_shadow(ohlcv, params):
    open_, high, low, close = ohlcv["open_"], ohlcv["high"], ohlcv["low"], ohlcv["close"]
    hl = high - low
    top = np.maximum(open_, close)
    shadow = high - top
    return np.divide(shadow, hl, out=np.zeros_like(hl), where=hl != 0)

def _compute_lower_shadow(ohlcv, params):
    open_, high, low, close = ohlcv["open_"], ohlcv["high"], ohlcv["low"], ohlcv["close"]
    hl = high - low
    bottom = np.minimum(open_, close)
    shadow = bottom - low
    return np.divide(shadow, hl, out=np.zeros_like(hl), where=hl != 0)

def _compute_roc(ohlcv, params):
    h = params.get("horizon", 10)
    close = ohlcv["close"]
    out = np.zeros_like(close)
    out[h:] = (close[h:] - close[:-h]) / close[:-h] * 100
    return out

def _compute_ma_distance(ohlcv, params):
    window = params.get("window", 50)
    close = ohlcv["close"]
    ma = _rolling_mean(close, window)
    return np.divide(close - ma, ma, out=np.zeros_like(ma), where=ma != 0) * 100

COMPUTE_FUNCTIONS = {
    "log_return": _compute_log_return,
    "realized_vol": _compute_realized_vol,
    "parkinson_vol": _compute_parkinson_vol,
    "volume_ratio": _compute_volume_ratio,
    "bar_range": _compute_bar_range,
    "body_ratio": _compute_body_ratio,
    "upper_shadow": _compute_upper_shadow,
    "lower_shadow": _compute_lower_shadow,
    "rate_of_change": _compute_roc,
    "ma_distance": _compute_ma_distance,
    "book_imbalance": _compute_book_imbalance,
    "absorption_score": _compute_absorption_score,
    "closing_strength": _compute_closing_strength,
    "vwap_stretch": _compute_vwap_stretch,
    "vwap_distance": _compute_vwap_distance,
    # "microstructure" handled specially via batch compute
}

def _load_feature_config():
    config_path = os.path.join(os.path.dirname(__file__), "..", "..", "config", "features.json")
    with open(config_path, "r") as f:
        return json.load(f)

def _extract_arrays(data):
    # Expects list of dicts or dict of lists
    if isinstance(data, dict) and "close" in data:
        return data, data.get("timestamp")
    
    # Convert list of OHLCV objects to dict of arrays
    return {
        "open_": np.array([d.get("open", d.get("open_")) for d in data], dtype=np.float64),
        "high": np.array([d["high"] for d in data], dtype=np.float64),
        "low": np.array([d["low"] for d in data], dtype=np.float64),
        "close": np.array([d["close"] for d in data], dtype=np.float64),
        "volume": np.array([d.get("volume", 0) for d in data], dtype=np.float64),
    }, np.array([d.get("timestamp", 0) for d in data])

def _safe_compute(feat_def, ohlcv):
    f_type = feat_def["type"]
    if f_type not in COMPUTE_FUNCTIONS:
        return feat_def["name"], None
    try:
        arr = COMPUTE_FUNCTIONS[f_type](ohlcv, feat_def.get("params", {}))
        return feat_def["name"], arr
    except Exception:
        return feat_def["name"], None

def compute_features(data, categories=None, n_jobs=1):
    config = _load_feature_config()
    ohlcv, timestamps = _extract_arrays(data)
    feature_defs = [f for f in config["features"] if not categories or f["category"] in categories]

    # Handle microstructure features separately (batch call)
    micro_defs = [f for f in feature_defs if f["type"] == "microstructure"]
    other_defs = [f for f in feature_defs if f["type"] != "microstructure"]

    results = Parallel(n_jobs=n_jobs, prefer="threads")(
        delayed(_safe_compute)(f, ohlcv) for f in other_defs
    )
    features = {name: arr for name, arr in results if arr is not None}

    if micro_defs:
        micro_cache = compute_microstructure_features(ohlcv["high"], ohlcv["low"], ohlcv["close"])
        for f in micro_defs:
            name = f["name"]
            if name in micro_cache:
                features[name] = micro_cache[name]

    feature_names = [f["name"] for f in feature_defs if f["name"] in features]
    matrix = np.column_stack([features[n] for n in feature_names])

    return matrix, feature_names, timestamps


# --------------------------------------------------------------------------- #
# Public OHLCV -> feature pipeline with parquet cache.
#
# Hoisted from src/ml/xgb_classifier/main.py::_load_features_with_cache
# (W2.c, 2026-05-10) so every generated atomic model template can import the
# same helper instead of duplicating the 25-line body inline.
#
# Cross-domain contract — DO NOT change the return tuple shape without
# updating every caller (xgb_classifier + every templates/architectures/*.j2
# that uses load_features). Returns are positional:
#   (matrix, names, timestamps_epoch_s, raw_ohlcv)
# matching the existing xgb_classifier call site.
# --------------------------------------------------------------------------- #


def load_features_with_cache(
    symbol: str,
    timeframe: str,
    date_range: dict | None,
    categories: list[str] | None,
    max_bars: int,
) -> tuple[np.ndarray, list[str], np.ndarray, dict]:
    """Load OHLCV + compute features (cached) and also return raw OHLCV for labeling.

    Parameters
    ----------
    symbol, timeframe : str
        Passed straight through to ``load_ohlcv_arrays``.
    date_range : dict | None
        Optional ``{"start": ISO, "end": ISO}`` slice, forwarded to both the
        OHLCV loader and the feature cache key.
    categories : list[str] | None
        Feature category whitelist (None == all categories from the registry).
    max_bars : int
        Hard cap on bar count returned from QuestDB / parquet repo (0 == no cap).

    Returns
    -------
    matrix : np.ndarray
        Float32 feature matrix, shape (n_bars, n_features).
    names : list[str]
        Column names for ``matrix``.
    timestamps : np.ndarray
        Int64 epoch-second timestamps, shape (n_bars,).
    raw : dict
        Raw OHLCV arrays (open/high/low/close/volume/timestamp) — needed by the
        caller for label generation since labels run against price levels, not
        engineered features.
    """
    # Local imports keep the module-level surface small + avoid pulling
    # questdb/polars on consumers that only want the compute_features helper.
    from .data import load_ohlcv_arrays
    from .feature_cache import cached_features

    raw = load_ohlcv_arrays(symbol, timeframe, max_bars=max_bars, date_range=date_range)

    def _compute() -> tuple[np.ndarray, list[str], np.ndarray]:
        # Translate to the feature engine's expected dict shape (`open_` not `open`).
        ohlcv = {
            "open_": raw["open"], "high": raw["high"], "low": raw["low"],
            "close": raw["close"], "volume": raw["volume"],
        }
        matrix, names, _ts = compute_features(ohlcv, categories=categories, n_jobs=1)
        # Use the OHLCV timestamps; the feature engine returns None for dict input.
        ts_arr = np.asarray([t.timestamp() if hasattr(t, "timestamp") else float(t)
                             for t in raw["timestamp"]], dtype=np.int64)
        return matrix.astype(np.float32), list(names), ts_arr

    matrix, names, timestamps = cached_features(
        symbol=symbol, timeframe=timeframe, date_range=date_range,
        categories=categories, compute_fn=_compute,
    )
    return matrix, names, timestamps, raw

