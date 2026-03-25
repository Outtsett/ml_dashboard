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
from numba import njit, prange

from .normalizer import rolling_zscore as _rolling_zscore_1d  # noqa: F401 — 1D per-column z-score
from .swing import compute_swing_features


# ── Numba-JIT rolling statistics (replaces Python for-loop) ─────────────────

@njit(cache=True, parallel=True)
def _rolling_mean(arr, window):
    """Rolling mean — O(n) via cumsum, Numba-compiled."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:window] = np.nan
    cs = np.cumsum(arr)
    for i in prange(window, n):
        out[i] = (cs[i] - (cs[i - window] if i >= window else 0.0)) / window
    return out


@njit(cache=True, parallel=True)
def _rolling_std(arr, window):
    """Rolling std — two-pass (mean then variance), Numba-compiled."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:window] = np.nan
    for i in prange(window, n):
        s = arr[i - window:i]
        m = 0.0
        for j in range(window):
            m += s[j]
        m /= window
        v = 0.0
        for j in range(window):
            d = s[j] - m
            v += d * d
        out[i] = np.sqrt(v / (window - 1)) if window > 1 else 0.0
    return out


@njit(cache=True, parallel=True)
def _rolling_parkinson(log_hl, window):
    """Rolling Parkinson volatility — Numba-compiled."""
    n = len(log_hl)
    out = np.empty(n, dtype=np.float64)
    out[:window] = np.nan
    inv_4ln2 = 1.0 / (4.0 * np.log(2.0))
    for i in prange(window, n):
        s = 0.0
        for j in range(window):
            v = log_hl[i - window + j]
            s += v * v
        out[i] = np.sqrt(s / window * inv_4ln2)
    return out


# ── Individual compute functions (one per type) ─────────────────────────────
# Each takes **ohlcv (close, high, low, open_, volume) + type-specific params.


def _compute_log_return(close, horizon, **_):
    return np.concatenate([np.zeros(horizon), np.diff(np.log(close + 1e-10), n=horizon)])


def _compute_realized_vol(close, window, **_):
    ret1 = np.concatenate([np.zeros(1), np.diff(np.log(close + 1e-10))])
    return _rolling_std(ret1, window)


def _compute_parkinson_vol(high, low, window, **_):
    log_hl = np.log(high / (low + 1e-10))
    return _rolling_parkinson(log_hl, window)


def _compute_volume_ratio(volume, window, **_):
    vol_safe = np.where(volume > 0, volume, 1.0)
    vol_ma = _rolling_mean(vol_safe, window)
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
    ma = _rolling_mean(close, window)
    return (close - ma) / (np.where(np.isnan(ma), 1.0, ma) + 1e-10)


# ── Dispatch table: type → function ─────────────────────────────────────────

COMPUTE_FUNCTIONS = {
    "log_return": _compute_log_return,
    "realized_vol": _compute_realized_vol,
    "parkinson_vol": _compute_parkinson_vol,
    "volume_ratio": _compute_volume_ratio,
    "bar_range": _compute_bar_range,
    "body_ratio": _compute_body_ratio,
    "upper_shadow": _compute_upper_shadow,
    "lower_shadow": _compute_lower_shadow,
    "rate_of_change": _compute_rate_of_change,
    "ma_distance": _compute_ma_distance,
    # "swing" is handled specially — batch computation via swing.py
}


def _load_feature_config():
    """Read feature registry from src/config/features.json."""
    config_path = os.path.join(os.path.dirname(__file__), "..", "..", "config", "features.json")
    with open(config_path) as f:
        return json.load(f)


def _extract_arrays(data):
    """Extract OHLCV numpy arrays + timestamps from dict or PyArrow table."""
    if isinstance(data, dict):
        # Direct numpy dict from load_ohlcv_arrays()
        close = data["close"].astype(np.float64)
        high = data["high"].astype(np.float64)
        low = data["low"].astype(np.float64)
        volume = data["volume"].astype(np.float64)
        open_ = data["open"].astype(np.float64)
        timestamps = data.get("timestamp", [])
    else:
        # PyArrow table (backward compat)
        close = data.column("close").to_numpy().astype(np.float64)
        high = data.column("high").to_numpy().astype(np.float64)
        low = data.column("low").to_numpy().astype(np.float64)
        volume = data.column("volume").to_numpy().astype(np.float64)
        open_ = data.column("open").to_numpy().astype(np.float64)
        ts_col = "timestamp" if "timestamp" in data.column_names else "ts"
        timestamps = data.column(ts_col).to_pylist()
    ohlcv = dict(close=close, high=high, low=low, volume=volume, open_=open_)
    return ohlcv, timestamps


def compute_features(data, categories=None):
    """
    Config-driven feature computation from raw OHLCV.

    Args:
        data: dict with numpy arrays (from load_ohlcv_arrays) or PyArrow table.
        categories: Optional set/list of category names to include.
                    None = all categories (default, backward compatible).

    Returns (feature_matrix, feature_names, timestamps).
    """
    config = _load_feature_config()
    ohlcv, timestamps = _extract_arrays(data)

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
                swing_cache = compute_swing_features(ohlcv["high"], ohlcv["low"], ohlcv["close"])
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

    return matrix, feature_names, timestamps


def normalize_features(X, lookback=250, clip_range=(-5, 5)):
    """Rolling z-score normalization (2D matrix). Clips to configured range.

    Uses O(1) memory online algorithm per column instead of sliding_window_view
    which allocates O(T*D*lookback) — critical for >500K rows.

    For per-column 1D rolling z-score (used by indicator normalization), see
    ml.shared.normalizer.rolling_zscore (imported as _rolling_zscore_1d).
    """
    T, D = X.shape
    X_norm = np.full_like(X, np.nan)

    if T <= lookback:
        return np.clip(X_norm, clip_range[0], clip_range[1])

    # Try numba-accelerated path (O(n) per column, O(1) memory)
    try:
        from .feature_extract import _rolling_zscore_numba, _HAS_NUMBA
        if _HAS_NUMBA:
            for d in range(D):
                X_norm[:, d] = _rolling_zscore_numba(
                    X[:, d], lookback, clip_range[0], clip_range[1]
                )
            return X_norm
    except ImportError:
        pass

    # Pandas fallback — still O(n) per column, no giant view allocation
    import pandas as pd
    for d in range(D):
        series = pd.Series(X[:, d], dtype=np.float64)
        rolling_mean = series.rolling(lookback, min_periods=5).mean()
        rolling_std = series.rolling(lookback, min_periods=5).std()
        z = (series - rolling_mean) / rolling_std.replace(0, np.nan)
        z = z.clip(clip_range[0], clip_range[1])
        X_norm[:, d] = z.values

    return X_norm
