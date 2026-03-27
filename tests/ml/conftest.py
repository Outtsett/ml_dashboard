"""Shared fixtures for ML tests."""

import numpy as np
import pytest


@pytest.fixture
def synthetic_ohlcv():
    """Generate 1000 bars of synthetic OHLCV data with realistic structure.

    Prices start at 20000 (MNQ-like), random walk with mean-reverting vol.
    """
    rng = np.random.default_rng(42)
    n = 1000
    close = np.empty(n)
    close[0] = 20000.0
    for i in range(1, n):
        close[i] = close[i - 1] + rng.normal(0, 5.0)
    high = close + rng.uniform(1.0, 10.0, n)
    low = close - rng.uniform(1.0, 10.0, n)
    open_ = close + rng.normal(0, 3.0, n)
    # Ensure OHLC consistency
    high = np.maximum(high, np.maximum(open_, close))
    low = np.minimum(low, np.minimum(open_, close))
    volume = rng.uniform(100, 5000, n)
    return {
        "open": open_.astype(np.float64),
        "high": high.astype(np.float64),
        "low": low.astype(np.float64),
        "close": close.astype(np.float64),
        "volume": volume.astype(np.float64),
    }


@pytest.fixture
def small_ohlcv():
    """10-bar OHLCV for unit tests where exact values matter."""
    return {
        "open":   np.array([100, 102, 101, 105, 103, 100, 98, 101, 104, 106], dtype=np.float64),
        "high":   np.array([103, 104, 106, 107, 105, 102, 101, 105, 107, 108], dtype=np.float64),
        "low":    np.array([99,  100, 100, 103, 100, 97,  96, 99,  102, 104], dtype=np.float64),
        "close":  np.array([102, 101, 105, 103, 100, 98,  101, 104, 106, 105], dtype=np.float64),
        "volume": np.array([500, 600, 550, 700, 650, 800, 750, 600, 550, 500], dtype=np.float64),
    }
