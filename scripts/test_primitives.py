"""Smoke test + benchmark for primitives computation engine."""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "ml"))

import numpy as np

from shared.primitives import compute_primitives


def make_ohlcv(n, seed=42):
    np.random.seed(seed)
    walk = np.cumsum(np.random.randn(n) * 0.5) + 100
    return {
        "open": walk + np.random.randn(n) * 0.1,
        "high": walk + np.abs(np.random.randn(n) * 0.5),
        "low": walk - np.abs(np.random.randn(n) * 0.5),
        "close": walk + np.random.randn(n) * 0.1,
        "volume": np.abs(np.random.randn(n) * 1000) + 500,
    }


# First run (includes JIT compilation)
ohlcv = make_ohlcv(5000)
t0 = time.time()
X, names = compute_primitives(ohlcv, N=20, k=1)
t1 = time.time()
print(f"Shape: {X.shape}")
print(f"Features: {len(names)}")
print(f"First run (JIT compile): {t1 - t0:.2f}s")
print(f"NaN fraction (bar 300+): {np.isnan(X[300:]).mean():.4f}")
core_count = sum(
    1
    for n in names
    if not any(
        n.endswith(s)
        for s in ["_volatility", "_autocorr", "_change", "_vol_adj", "_skew", "_kurtosis", "_accel"]
    )
)
print(f"Core: {core_count}, Derived: {len(names) - core_count}")

# Cached run
t0 = time.time()
X, names = compute_primitives(ohlcv, N=20, k=1)
t1 = time.time()
print(f"Cached 5K bars: {t1 - t0:.3f}s")

# 100K bars
ohlcv_big = make_ohlcv(100000, seed=0)
t0 = time.time()
X2, _ = compute_primitives(ohlcv_big, N=20, k=1)
t1 = time.time()
print(f"100K bars: {t1 - t0:.2f}s -> {X2.shape}")
print(f"First 15: {names[:15]}")
