"""
Primitive computation engine -- computes all trading primitives from raw OHLCV data.

Generates ~60 core primitives across 6 categories (price-derived, OHLC, temporal,
volume, structure, regime cues), then applies 7 standard derivations to each,
producing ~480 total features as a dense (n_bars, n_features) float64 matrix.

All rolling statistics use Numba @njit(cache=True) for performance.
Target: 100K bars in < 10 seconds.

Usage:
    from ml.shared.primitives import compute_primitives, compute_and_normalize_primitives

    ohlcv = load_ohlcv_arrays(symbol, timeframe)
    X, names = compute_primitives(ohlcv, N=20, k=1)
    X_norm, names = compute_and_normalize_primitives(ohlcv, N=20, k=1)
"""

import numpy as np
from numba import njit

# =============================================================================
# Section 1: Building Blocks (Numba JIT)
# =============================================================================


@njit(cache=True)
def _rolling_mean(arr, N):
    """Rolling mean over window N. NaN-safe: skips NaN in sums."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 1 or n < N:
        return out
    s = 0.0
    cnt = 0
    for j in range(N):
        v = arr[j]
        if not np.isnan(v):
            s += v
            cnt += 1
    if cnt > 0:
        out[N - 1] = s / cnt
    for i in range(N, n):
        new_v = arr[i]
        old_v = arr[i - N]
        if not np.isnan(new_v):
            s += new_v
            cnt += 1
        if not np.isnan(old_v):
            s -= old_v
            cnt -= 1
        if cnt > 0:
            out[i] = s / cnt
    return out


@njit(cache=True)
def _rolling_std(arr, N):
    """Rolling standard deviation (sample) over window N."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N:
        return out
    for i in range(N - 1, n):
        m = 0.0
        for j in range(N):
            m += arr[i - N + 1 + j]
        m /= N
        v = 0.0
        for j in range(N):
            d = arr[i - N + 1 + j] - m
            v += d * d
        out[i] = np.sqrt(v / (N - 1))
    return out


@njit(cache=True)
def _rolling_skew(arr, N):
    """Rolling skewness over window N. Uses sample-corrected formula."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 3 or n < N:
        return out
    for i in range(N - 1, n):
        m = 0.0
        for j in range(N):
            m += arr[i - N + 1 + j]
        m /= N
        m2 = 0.0
        m3 = 0.0
        for j in range(N):
            d = arr[i - N + 1 + j] - m
            d2 = d * d
            m2 += d2
            m3 += d2 * d
        m2 /= N
        m3 /= N
        if m2 < 1e-20:
            out[i] = np.nan
        else:
            s = np.sqrt(m2)
            out[i] = (m3 / (s * s * s)) * (N * N) / ((N - 1) * (N - 2))
    return out


@njit(cache=True)
def _rolling_kurtosis(arr, N):
    """Rolling excess kurtosis over window N."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 4 or n < N:
        return out
    for i in range(N - 1, n):
        m = 0.0
        for j in range(N):
            m += arr[i - N + 1 + j]
        m /= N
        m2 = 0.0
        m4 = 0.0
        for j in range(N):
            d = arr[i - N + 1 + j] - m
            d2 = d * d
            m2 += d2
            m4 += d2 * d2
        m2 /= N
        m4 /= N
        if m2 < 1e-20:
            out[i] = np.nan
        else:
            k_raw = m4 / (m2 * m2)
            adj = (N - 1.0) / ((N - 2.0) * (N - 3.0))
            out[i] = adj * ((N + 1.0) * k_raw - 3.0 * (N - 1.0))
    return out


@njit(cache=True)
def _rolling_autocorr(arr, N, k):
    """Rolling autocorrelation at lag k over window N."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if k < 1 or N < k + 2 or n < N:
        return out
    for i in range(N - 1, n):
        start = i - N + 1
        m = 0.0
        for j in range(N):
            m += arr[start + j]
        m /= N
        cov_k = 0.0
        var_ = 0.0
        for j in range(N):
            d0 = arr[start + j] - m
            var_ += d0 * d0
            if j >= k:
                dk = arr[start + j - k] - m
                cov_k += d0 * dk
        if var_ < 1e-20:
            out[i] = np.nan
        else:
            out[i] = cov_k / var_
    return out


@njit(cache=True)
def _rolling_entropy(arr, N, n_bins):
    """Rolling Shannon entropy over histogram of N values binned into n_bins."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N or n_bins < 2:
        return out
    for i in range(N - 1, n):
        start = i - N + 1
        # Find min/max skipping NaN
        wmin = np.inf
        wmax = -np.inf
        valid = 0
        for j in range(N):
            v = arr[start + j]
            if np.isnan(v):
                continue
            valid += 1
            if v < wmin:
                wmin = v
            if v > wmax:
                wmax = v
        if valid < 2:
            continue
        rng = wmax - wmin
        if rng < 1e-20:
            out[i] = 0.0
            continue
        counts = np.zeros(n_bins, dtype=np.float64)
        for j in range(N):
            v = arr[start + j]
            if np.isnan(v):
                continue
            b = int((v - wmin) / rng * (n_bins - 1) + 0.5)
            if b < 0:
                b = 0
            if b >= n_bins:
                b = n_bins - 1
            counts[b] += 1.0
        h = 0.0
        for b in range(n_bins):
            if counts[b] > 0:
                p = counts[b] / N
                h -= p * np.log(p + 1e-30)
        out[i] = h
    return out


@njit(cache=True)
def _rolling_hurst(arr, N):
    """Rolling Hurst exponent via R/S analysis over window N."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 20 or n < N:
        return out
    for i in range(N - 1, n):
        start = i - N + 1
        m = 0.0
        for j in range(1, N):
            m += arr[start + j] - arr[start + j - 1]
        m /= (N - 1)
        cum_dev = 0.0
        max_dev = -1e30
        min_dev = 1e30
        s2 = 0.0
        for j in range(1, N):
            ret_j = arr[start + j] - arr[start + j - 1]
            cum_dev += ret_j - m
            if cum_dev > max_dev:
                max_dev = cum_dev
            if cum_dev < min_dev:
                min_dev = cum_dev
            s2 += (ret_j - m) * (ret_j - m)
        R = max_dev - min_dev
        S = np.sqrt(s2 / (N - 2)) if N > 2 else 0.0
        if S < 1e-20 or R < 1e-20:
            out[i] = np.nan
        else:
            out[i] = np.log(R / S) / np.log(float(N))
    return out


@njit(cache=True)
def _rolling_linreg_slope(arr, N):
    """Rolling OLS slope (linear regression) over window N."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[:] = np.nan
    if N < 2 or n < N:
        return out
    sx = 0.0
    sx2 = 0.0
    for j in range(N):
        sx += j
        sx2 += j * j
    denom = N * sx2 - sx * sx
    if abs(denom) < 1e-20:
        return out
    for i in range(N - 1, n):
        sy = 0.0
        sxy = 0.0
        for j in range(N):
            y = arr[i - N + 1 + j]
            sy += y
            sxy += j * y
        out[i] = (N * sxy - sx * sy) / denom
    return out


@njit(cache=True)
def _first_diff(arr):
    """First difference: X_t - X_{t-1}. First element = 0."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[0] = 0.0
    for i in range(1, n):
        out[i] = arr[i] - arr[i - 1]
    return out


@njit(cache=True)
def _second_diff(arr):
    """Second difference: X_t - 2*X_{t-1} + X_{t-2}. First two elements = 0."""
    n = len(arr)
    out = np.empty(n, dtype=np.float64)
    out[0] = 0.0
    if n > 1:
        out[1] = 0.0
    for i in range(2, n):
        out[i] = arr[i] - 2.0 * arr[i - 1] + arr[i - 2]
    return out
