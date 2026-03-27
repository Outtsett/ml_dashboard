"""Auxiliary label generators: volatility regime and return magnitude buckets."""

from __future__ import annotations

import numpy as np


def generate_vol_regime_labels(
    close: np.ndarray,
    lookback: int = 250,
) -> np.ndarray:
    """Classify each bar into low/medium/high volatility regime.

    Uses trailing realized volatility percentile (no lookahead).
    Returns: 0=low (<33rd pct), 1=medium (33-67), 2=high (>67th pct).
    First lookback bars are NaN (insufficient trailing data).
    """
    n = len(close)
    labels = np.full(n, np.nan)

    # Compute log returns
    log_ret = np.diff(np.log(close))
    log_ret = np.concatenate([[np.nan], log_ret])

    # Trailing rolling std (realized vol)
    vol = np.full(n, np.nan)
    for i in range(lookback, n):
        window = log_ret[i - lookback + 1 : i + 1]
        valid = window[~np.isnan(window)]
        if len(valid) > 1:
            vol[i] = np.std(valid)

    # Trailing percentile rank (no lookahead, excludes current bar)
    for i in range(lookback, n):
        trailing_vol = vol[lookback:i]  # exclude current bar from distribution
        trailing_valid = trailing_vol[~np.isnan(trailing_vol)]
        if len(trailing_valid) < 2:
            continue
        pct = np.searchsorted(np.sort(trailing_valid), vol[i]) / len(trailing_valid)
        if pct < 1.0 / 3.0:
            labels[i] = 0.0
        elif pct < 2.0 / 3.0:
            labels[i] = 1.0
        else:
            labels[i] = 2.0

    return labels


def generate_return_bucket_labels(
    returns_at_exit: np.ndarray,
    n_bins: int = 8,
    bin_edges: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Bucket returns into quantile bins.

    Args:
        returns_at_exit: signed return at barrier exit per bar
        n_bins: number of quantile bins
        bin_edges: pre-computed edges (from training set). If None, computed from data.

    Returns:
        (labels, bin_edges) where labels are 0..n_bins-1 or NaN.
    """
    valid_mask = ~np.isnan(returns_at_exit)
    labels = np.full(len(returns_at_exit), np.nan)

    if bin_edges is None:
        valid_returns = returns_at_exit[valid_mask]
        if len(valid_returns) == 0:
            return labels, np.array([])
        quantiles = np.linspace(0, 100, n_bins + 1)
        bin_edges = np.percentile(valid_returns, quantiles)
        bin_edges[0] = -np.inf
        bin_edges[-1] = np.inf

    indices = np.digitize(returns_at_exit[valid_mask], bin_edges) - 1
    indices = np.clip(indices, 0, n_bins - 1)
    labels[valid_mask] = indices.astype(np.float64)

    return labels, bin_edges
