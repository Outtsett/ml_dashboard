"""
Config-driven feature computation — reads src/config/features.json.

Computes features from raw OHLCV for regime discovery and other ML models.
The feature registry (config/features.json) is the single source of truth for
what features exist, their categories, computation types, and parameters.

Adding a new feature:
  1. Add entry to config/features.json
  2. If new computation type: add function here + register in COMPUTE_FUNCTIONS
  3. No other files need to change — downstream (SHAP, regime stats, diagnostics)
     automatically adapt via the feature_names list.

Also provides rolling z-score normalization (params configurable via features.json).
"""

import json
import os
import numpy as np

from .swing import compute_swing_features


def _rolling_stat(arr, window, func):
    """Compute a rolling statistic over an array."""
    result = np.full_like(arr, np.nan, dtype=np.float64)
    for i in range(window, len(arr)):
        result[i] = func(arr[i - window:i])
    return result


# ── Individual compute functions (one per type) ─────────────────────────────
# Each takes **ohlcv (close, high, low, open_, volume) + type-specific params.

def _compute_log_return(close, horizon, **_):
    return np.concatenate([np.zeros(horizon), np.diff(np.log(close + 1e-10), n=horizon)])


def _compute_realized_vol(close, window, **_):
    ret1 = np.concatenate([np.zeros(1), np.diff(np.log(close + 1e-10))])
    return _rolling_stat(ret1, window, np.std)


def _compute_parkinson_vol(high, low, window, **_):
    log_hl = np.log(high / (low + 1e-10))
    return _rolling_stat(
        log_hl, window, lambda x: np.sqrt(np.mean(x ** 2) / (4 * np.log(2)))
    )


def _compute_volume_ratio(volume, window, **_):
    vol_safe = np.where(volume > 0, volume, 1.0)
    vol_ma = _rolling_stat(vol_safe, window, np.mean)
    return vol_safe / np.where(vol_ma > 0, vol_ma, 1.0)


def _compute_bar_range(high, low, close, **_):
    return (high - low + 1e-10) / (close + 1e-10)


def _compute_body_ratio(open_, high, low, close, **_):
    bar_range = high - low + 1e-10
    return np.abs(close - open_) / bar_range


def _compute_upper_shadow(open_, high, low, close, **_):
    bar_range = high - low + 1e-10
    return (high - np.maximum(open_, close)) / bar_range


def _compute_lower_shadow(open_, high, low, close, **_):
    bar_range = high - low + 1e-10
    return (np.minimum(open_, close) - low) / bar_range


def _compute_rate_of_change(close, horizon, **_):
    shifted = np.roll(close, horizon)
    shifted[:horizon] = close[:horizon]
    return (close - shifted) / (shifted + 1e-10)


def _compute_ma_distance(close, window, **_):
    ma = _rolling_stat(close, window, np.mean)
    return (close - ma) / (ma + 1e-10)


# ── Dispatch table: type → function ─────────────────────────────────────────

COMPUTE_FUNCTIONS = {
    "log_return":     _compute_log_return,
    "realized_vol":   _compute_realized_vol,
    "parkinson_vol":  _compute_parkinson_vol,
    "volume_ratio":   _compute_volume_ratio,
    "bar_range":      _compute_bar_range,
    "body_ratio":     _compute_body_ratio,
    "upper_shadow":   _compute_upper_shadow,
    "lower_shadow":   _compute_lower_shadow,
    "rate_of_change": _compute_rate_of_change,
    "ma_distance":    _compute_ma_distance,
    # "swing" is handled specially — batch computation via swing.py
}


def _load_feature_config():
    """Read feature registry from config/features.json."""
    config_path = os.path.join(
        os.path.dirname(__file__), "..", "config", "features.json"
    )
    with open(config_path) as f:
        return json.load(f)


def compute_features(table, categories=None):
    """
    Config-driven feature computation from raw OHLCV.

    Args:
        table: PyArrow table with open, high, low, close, volume, timestamp columns.
        categories: Optional set/list of category names to include.
                    None = all categories (default, backward compatible).

    Returns (feature_matrix, feature_names, timestamps).
    """
    config = _load_feature_config()

    close  = table.column("close").to_numpy().astype(np.float64)
    high   = table.column("high").to_numpy().astype(np.float64)
    low    = table.column("low").to_numpy().astype(np.float64)
    volume = table.column("volume").to_numpy().astype(np.float64)
    open_  = table.column("open").to_numpy().astype(np.float64)
    ohlcv  = dict(close=close, high=high, low=low, volume=volume, open_=open_)

    features = {}
    feature_names = []

    # Swing features are batch-computed once, then individual outputs distributed
    swing_cache = None

    for feat_def in config["features"]:
        cat = feat_def["category"]
        if categories and cat not in categories:
            continue

        feat_type = feat_def["type"]
        feat_name = feat_def["name"]

        if feat_type == "swing":
            # Compute swing batch once, distribute individual outputs
            if swing_cache is None:
                swing_cache = compute_swing_features(high, low, close)
            if feat_name in swing_cache:
                features[feat_name] = swing_cache[feat_name]
                feature_names.append(feat_name)
        else:
            compute_fn = COMPUTE_FUNCTIONS.get(feat_type)
            if compute_fn is None:
                raise ValueError(f"Unknown feature type: {feat_type}")
            result = compute_fn(**ohlcv, **feat_def.get("params", {}))
            features[feat_name] = result
            feature_names.append(feat_name)

    matrix = np.column_stack([features[n] for n in feature_names])

    ts_col = "timestamp" if "timestamp" in table.column_names else "ts"
    timestamps = table.column(ts_col).to_pylist()

    return matrix, feature_names, timestamps


def normalize_features(X, lookback=250, clip_range=(-5, 5)):
    """Rolling z-score normalization. Clips to configured range."""
    T, D = X.shape
    X_norm = np.full_like(X, np.nan)
    for i in range(lookback, T):
        window = X[max(0, i - lookback):i]
        mu = np.nanmean(window, axis=0)
        sigma = np.nanstd(window, axis=0)
        sigma = np.where(sigma < 1e-10, 1.0, sigma)
        X_norm[i] = (X[i] - mu) / sigma
    X_norm = np.clip(X_norm, clip_range[0], clip_range[1])
    return X_norm
