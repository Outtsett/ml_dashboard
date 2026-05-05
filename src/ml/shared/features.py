"""
Config-driven feature computation — reads src/config/features.json.

Computes features from raw OHLCV for regime discovery and other ML models.
The feature registry (config/features.json) is the single source of truth for
what features exist, their categories, computation types, and parameters.
"""

import json
import os
import numpy as np
from numba import njit, prange
from joblib import Parallel, delayed

from .normalizer import rolling_zscore as _rolling_zscore_1d
from .microstructure import compute_microstructure_features
from .first_principles import (
    _compute_book_imbalance,
    _compute_absorption_score,
    _compute_closing_strength,
    _compute_vwap_stretch,
    _compute_vwap_distance
)

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


