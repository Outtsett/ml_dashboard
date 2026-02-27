"""
Feature Computation — raw OHLCV → feature matrix.

Computes 21 core features from price/volume data for regime discovery:
  - Log returns at multiple horizons (1, 5, 10, 20)
  - Realized volatility (rolling std of returns)
  - Range-based (Parkinson) volatility
  - Volume dynamics (ratio to moving average)
  - Price structure (bar range, body ratio, shadow ratios)
  - Rate of change
  - Moving average distance

Also provides rolling z-score normalization.
"""

import numpy as np


def _rolling_stat(arr, window, func):
    """Compute a rolling statistic over an array."""
    result = np.full_like(arr, np.nan, dtype=np.float64)
    for i in range(window, len(arr)):
        result[i] = func(arr[i - window:i])
    return result


def compute_features(table):
    """
    Compute features from raw OHLCV for regime discovery.
    Returns (feature_matrix, feature_names, timestamps).
    """
    close = table.column("close").to_numpy().astype(np.float64)
    high = table.column("high").to_numpy().astype(np.float64)
    low = table.column("low").to_numpy().astype(np.float64)
    volume = table.column("volume").to_numpy().astype(np.float64)
    open_ = table.column("open").to_numpy().astype(np.float64)

    features = {}

    # Returns at multiple horizons
    for h in [1, 5, 10, 20]:
        features[f"return_{h}"] = np.concatenate([np.zeros(h), np.diff(np.log(close + 1e-10), n=h)])

    # Realized volatility (rolling std of returns)
    ret1 = features["return_1"]
    for w in [10, 20, 50]:
        features[f"volatility_{w}"] = _rolling_stat(ret1, w, np.std)

    # Range-based volatility (Parkinson)
    log_hl = np.log(high / (low + 1e-10))
    for w in [10, 20]:
        features[f"parkinson_vol_{w}"] = _rolling_stat(
            log_hl, w, lambda x: np.sqrt(np.mean(x ** 2) / (4 * np.log(2)))
        )

    # Volume dynamics
    vol_safe = np.where(volume > 0, volume, 1.0)
    for w in [10, 20]:
        vol_ma = _rolling_stat(vol_safe, w, np.mean)
        features[f"volume_ratio_{w}"] = vol_safe / np.where(vol_ma > 0, vol_ma, 1.0)

    # Price structure
    bar_range = high - low + 1e-10
    features["bar_range"] = bar_range / (close + 1e-10)
    features["body_ratio"] = np.abs(close - open_) / bar_range
    features["upper_shadow"] = (high - np.maximum(open_, close)) / bar_range
    features["lower_shadow"] = (np.minimum(open_, close) - low) / bar_range

    # Rate of change
    for h in [5, 10, 20]:
        shifted = np.roll(close, h)
        shifted[:h] = close[:h]
        features[f"roc_{h}"] = (close - shifted) / (shifted + 1e-10)

    # Moving average distance
    for w in [10, 20, 50]:
        ma = _rolling_stat(close, w, np.mean)
        features[f"ma_dist_{w}"] = (close - ma) / (ma + 1e-10)

    # Stack into matrix
    names = list(features.keys())
    matrix = np.column_stack([features[n] for n in names])

    # Get timestamps
    ts_col = "timestamp" if "timestamp" in table.column_names else "ts"
    timestamps = table.column(ts_col).to_pylist()

    return matrix, names, timestamps


def normalize_features(X, lookback=250):
    """Rolling z-score normalization. Clips to [-5, 5]."""
    T, D = X.shape
    X_norm = np.full_like(X, np.nan)
    for i in range(lookback, T):
        window = X[max(0, i - lookback):i]
        mu = np.nanmean(window, axis=0)
        sigma = np.nanstd(window, axis=0)
        sigma = np.where(sigma < 1e-10, 1.0, sigma)
        X_norm[i] = (X[i] - mu) / sigma
    X_norm = np.clip(X_norm, -5, 5)
    return X_norm
