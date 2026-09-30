"""Support / resistance zones — the ML Dashboard's own definition, in numpy and pandas.

The dashboard's Market chart computes S/R in ``src/client/src/market/lib/chart_overlays.ts``
(``computeSupportResistance``): structural pivots (a high strictly above the ``lookback`` highs on
each side; the mirror for lows), clustered greedily in price order (a pivot joins the current
cluster when it sits within ``tolerance`` of the cluster's running mean; ``tolerance`` = 0.5 x the
mean true range of the bars), clusters with fewer than two pivots dropped, strength = touches /
most touches, the ``max_levels`` most-touched kept. ``compute_support_resistance`` reproduces that
exactly (``tests/test_zones.py`` runs the TypeScript on the same bars and compares).

``zone_features`` is the CAUSAL per-bar version for training and analysis — the training spec's
columns, one definition, the dashboard's:

    support_zone     1 if |low_i  - zone_price_support|    < bandwidth
    resistance_zone  1 if |high_i - zone_price_resistance| < bandwidth
    zone_strength    number of historical touches of that zone (pivots in the cluster, so far)

At every bar it is what the chart draws when its window ends at that bar: the chart loads
``CHART_FETCH_LIMIT[timeframe]`` bars (50,000 on 1m, 25,000 on 5m, ...) and computes on all of them,
so the window is that many bars; a pivot at bar j is known only at the close of bar j + lookback and
enters the zones from that bar; a pivot the chart could not confirm inside its window (fewer than
``lookback`` bars before it in the window) is not counted; pivots that scroll out of the window
leave; the bandwidth is 0.5 x the mean of the window's true ranges (the chart averages its bars
after the first); the clusters are rebuilt on every bar with that bar's bandwidth. Nothing at bar i
reads a later bar. (The chart's window grows to 100,000 bars as it is scrolled back; the features
are the chart at its first load.)
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from numba import njit

PIVOT_LOOKBACK = 5
MAX_LEVELS = 10
BANDWIDTH_TRUE_RANGE_MULTIPLE = 0.5
# the bars the Market chart loads per timeframe (src/client/src/market/lib/timeframes.ts getFetchLimit)
CHART_FETCH_LIMIT = {"1m": 50_000, "5m": 25_000, "15m": 15_000, "30m": 2_000, "1h": 1_500, "4h": 1_000, "1d": 500}
CHART_FETCH_LIMIT_DEFAULT = 250
CHART_WINDOW_BARS = CHART_FETCH_LIMIT["5m"]


def chart_window_bars(timeframe: str) -> int:
    """How many bars the Market chart loads, and computes its levels on, for ``timeframe``."""
    return CHART_FETCH_LIMIT.get(timeframe, CHART_FETCH_LIMIT_DEFAULT)


def true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    """True range of every bar after the first (the first has no previous close): the chart's sum."""
    previous_close = close[:-1]
    return np.maximum.reduce([high[1:] - low[1:], np.abs(high[1:] - previous_close), np.abs(low[1:] - previous_close)])


def structural_pivots(high: np.ndarray, low: np.ndarray, lookback: int = PIVOT_LOOKBACK) -> tuple[np.ndarray, np.ndarray]:
    """Indices of pivot highs (strictly above the ``lookback`` highs on each side) and pivot lows
    (strictly below), in bar order; only bars with ``lookback`` bars on both sides qualify."""
    n = high.size
    if n < 2 * lookback + 1:
        return np.zeros(0, np.int64), np.zeros(0, np.int64)
    is_high = np.ones(n, dtype=bool)
    is_low = np.ones(n, dtype=bool)
    for k in range(1, lookback + 1):
        before_high = np.r_[np.full(k, np.inf), high[:-k]]
        after_high = np.r_[high[k:], np.full(k, np.inf)]
        is_high &= (high > before_high) & (high > after_high)
        before_low = np.r_[np.full(k, -np.inf), low[:-k]]
        after_low = np.r_[low[k:], np.full(k, -np.inf)]
        is_low &= (low < before_low) & (low < after_low)
    inside = np.zeros(n, dtype=bool)
    inside[lookback : n - lookback] = True
    return np.flatnonzero(is_high & inside), np.flatnonzero(is_low & inside)


@njit(cache=True)
def _cluster_sorted(prices: np.ndarray, tolerance: float) -> np.ndarray:
    """Cluster id of every price in ``prices`` (ascending): a price joins the current cluster when it
    is within ``tolerance`` of the cluster's running mean, else it starts the next one."""
    n = prices.shape[0]
    ids = np.zeros(n, np.int64)
    if n == 0:
        return ids
    total = prices[0]
    count = 1
    current = 0
    for i in range(1, n):
        mean = total / count
        if abs(prices[i] - mean) <= tolerance:
            total += prices[i]
            count += 1
        else:
            current += 1
            total = prices[i]
            count = 1
        ids[i] = current
    return ids


def cluster_levels(prices: np.ndarray, times: np.ndarray, tolerance: float, minimum_touches: int = 2) -> pd.DataFrame:
    """The chart's ``clusterLevels``: one row per cluster with at least ``minimum_touches`` pivots —
    price (mean of its pivots), touches, strength (touches / most touches), first and last pivot time.
    Rows are in ascending price order, as the TypeScript returns them."""
    if prices.size == 0:
        return pd.DataFrame(columns=["price", "touches", "strength", "first_time", "last_time"])
    order = np.argsort(prices, kind="stable")
    sorted_prices = prices[order].astype(np.float64)
    sorted_times = times[order]
    ids = _cluster_sorted(sorted_prices, float(tolerance))
    frame = pd.DataFrame({"id": ids, "price": sorted_prices, "time": sorted_times})
    grouped = frame.groupby("id", sort=True).agg(price=("price", "mean"), touches=("price", "size"), first_time=("time", "min"), last_time=("time", "max"))
    grouped = grouped[grouped["touches"] >= minimum_touches].reset_index(drop=True)
    if len(grouped) == 0:
        return pd.DataFrame(columns=["price", "touches", "strength", "first_time", "last_time"])
    grouped["strength"] = grouped["touches"] / grouped["touches"].max()
    return grouped[["price", "touches", "strength", "first_time", "last_time"]]


def compute_support_resistance(bars: pd.DataFrame, lookback: int = PIVOT_LOOKBACK, max_levels: int = MAX_LEVELS) -> pd.DataFrame:
    """The chart's ``computeSupportResistance`` on a frame with ``time``, ``high``, ``low``, ``close``:
    every level it would draw, ordered as it orders them (most touches first; resistance before
    support at equal touches, each in ascending price). Not causal: it reads the whole frame, exactly
    as the chart reads its loaded bars."""
    high, low, close = (bars[c].to_numpy(np.float64) for c in ("high", "low", "close"))
    times = bars["time"].to_numpy()
    if high.size < lookback * 2 + 1:
        return pd.DataFrame(columns=["price", "type", "touches", "strength", "first_time", "last_time"])
    high_idx, low_idx = structural_pivots(high, low, lookback)
    tolerance = float(true_range(high, low, close).mean()) * BANDWIDTH_TRUE_RANGE_MULTIPLE
    resistance = cluster_levels(high[high_idx], times[high_idx], tolerance).assign(type="resistance")
    support = cluster_levels(low[low_idx], times[low_idx], tolerance).assign(type="support")
    levels = pd.concat([resistance, support], ignore_index=True)
    if len(levels) == 0:
        return pd.DataFrame(columns=["price", "type", "touches", "strength", "first_time", "last_time"])
    levels = levels.sort_values("touches", ascending=False, kind="stable").head(max_levels).reset_index(drop=True)
    return levels[["price", "type", "touches", "strength", "first_time", "last_time"]]


# ── the causal per-bar walk, in numba ────────────────────────────────────────
@njit(cache=True)
def _insert_sorted(buffer, size, value):
    position = np.searchsorted(buffer[:size], value)
    for k in range(size, position, -1):
        buffer[k] = buffer[k - 1]
    buffer[position] = value
    return size + 1


@njit(cache=True)
def _remove_sorted(buffer, size, value):
    position = np.searchsorted(buffer[:size], value)
    if position >= size or buffer[position] != value:
        return size
    for k in range(position, size - 1):
        buffer[k] = buffer[k + 1]
    return size - 1


@njit(cache=True)
def _clusters(prices, size, tolerance, means, counts):
    """Clusters of ``prices[:size]`` (ascending) by the running-mean rule; writes the mean and the
    touch count of every cluster with two or more members and returns how many."""
    kept = 0
    if size == 0:
        return kept
    total = prices[0]
    count = 1
    for i in range(1, size + 1):
        if i < size and abs(prices[i] - total / count) <= tolerance:
            total += prices[i]
            count += 1
            continue
        if count >= 2:
            means[kept] = total / count
            counts[kept] = count
            kept += 1
        if i < size:
            total = prices[i]
            count = 1
    return kept


@njit(cache=True)
def _nearest(means, kept_mask, k, value):
    """Index of the kept cluster whose mean is nearest to ``value``; -1 when none is kept."""
    best = -1
    best_distance = np.inf
    for c in range(k):
        if not kept_mask[c]:
            continue
        distance = abs(means[c] - value)
        if distance < best_distance:
            best_distance = distance
            best = c
    return best


@njit(cache=True)
def _zone_walk(high, low, bandwidth, high_idx, low_idx, lookback, window_bars, max_levels,
               zone_price_support, zone_price_resistance, support_zone, resistance_zone,
               support_zone_strength, resistance_zone_strength, support_zone_count, resistance_zone_count):
    n = high.shape[0]
    nh, nl = high_idx.shape[0], low_idx.shape[0]
    highs = np.empty(max(nh, 1), np.float64)
    lows = np.empty(max(nl, 1), np.float64)
    size_h = 0
    size_l = 0
    next_h = 0
    next_l = 0
    head_h = 0
    head_l = 0
    means_h = np.empty(max(nh, 1), np.float64)
    counts_h = np.empty(max(nh, 1), np.int64)
    means_l = np.empty(max(nl, 1), np.float64)
    counts_l = np.empty(max(nl, 1), np.int64)
    for i in range(n):
        # pivots confirmed at this bar enter
        while next_h < nh and high_idx[next_h] + lookback <= i:
            size_h = _insert_sorted(highs, size_h, high[high_idx[next_h]])
            next_h += 1
        while next_l < nl and low_idx[next_l] + lookback <= i:
            size_l = _insert_sorted(lows, size_l, low[low_idx[next_l]])
            next_l += 1
        # pivots the chart could not confirm inside its window leave: it needs lookback bars before them
        if window_bars > 0:
            oldest_countable = i - window_bars + 1 + lookback
            while head_h < next_h and high_idx[head_h] < oldest_countable:
                size_h = _remove_sorted(highs, size_h, high[high_idx[head_h]])
                head_h += 1
            while head_l < next_l and low_idx[head_l] < oldest_countable:
                size_l = _remove_sorted(lows, size_l, low[low_idx[head_l]])
                head_l += 1
        tolerance = bandwidth[i]
        if not np.isfinite(tolerance) or tolerance <= 0:
            continue
        kh = _clusters(highs, size_h, tolerance, means_h, counts_h)
        kl = _clusters(lows, size_l, tolerance, means_l, counts_l)
        keep_h = np.ones(max(kh, 1), np.bool_)
        keep_l = np.ones(max(kl, 1), np.bool_)
        if max_levels > 0 and kh + kl > max_levels:
            # the chart's stable sort by touches over [resistance..., support...], top max_levels
            combined = np.empty(kh + kl, np.int64)
            for c in range(kh):
                combined[c] = -counts_h[c]
            for c in range(kl):
                combined[kh + c] = -counts_l[c]
            order = np.argsort(combined, kind="mergesort")
            for c in range(kh):
                keep_h[c] = False
            for c in range(kl):
                keep_l[c] = False
            for r in range(max_levels):
                index = order[r]
                if index < kh:
                    keep_h[index] = True
                else:
                    keep_l[index - kh] = True
        count_kept_h = 0
        for c in range(kh):
            if keep_h[c]:
                count_kept_h += 1
        count_kept_l = 0
        for c in range(kl):
            if keep_l[c]:
                count_kept_l += 1
        support_zone_count[i] = count_kept_l
        resistance_zone_count[i] = count_kept_h
        s = _nearest(means_l, keep_l, kl, low[i])
        if s >= 0:
            zone_price_support[i] = means_l[s]
            support_zone_strength[i] = counts_l[s]
            if abs(low[i] - means_l[s]) < tolerance:
                support_zone[i] = 1
        r = _nearest(means_h, keep_h, kh, high[i])
        if r >= 0:
            zone_price_resistance[i] = means_h[r]
            resistance_zone_strength[i] = counts_h[r]
            if abs(high[i] - means_h[r]) < tolerance:
                resistance_zone[i] = 1


def zone_features(
    bars: pd.DataFrame,
    lookback: int = PIVOT_LOOKBACK,
    bandwidth_multiple: float = BANDWIDTH_TRUE_RANGE_MULTIPLE,
    window_bars: int = CHART_WINDOW_BARS,
    max_levels: int | None = MAX_LEVELS,
) -> pd.DataFrame:
    """Causal per-bar zone features on a frame with ``high``, ``low``, ``close`` (and ``time`` if present):
    at every bar, what the chart draws when its ``window_bars``-bar window ends at that bar (module
    docstring). ``window_bars`` 0 = every bar so far; ``max_levels`` None = every zone with two touches.

    Columns: zone_price_support (nearest support zone to the bar's low), zone_price_resistance
    (nearest resistance zone to the bar's high), support_zone, resistance_zone (the spec's flags),
    support_zone_strength, resistance_zone_strength (touches of those zones), zone_strength (touches
    of the zone being touched; the larger when both), bandwidth_points, support_zone_count,
    resistance_zone_count, pivot_high, pivot_low (1 on the bar a pivot is CONFIRMED, not the pivot bar)."""
    high, low, close = (np.ascontiguousarray(bars[c].to_numpy(np.float64)) for c in ("high", "low", "close"))
    n = high.size
    out = {
        "zone_price_support": np.full(n, np.nan), "zone_price_resistance": np.full(n, np.nan),
        "support_zone": np.zeros(n, np.int8), "resistance_zone": np.zeros(n, np.int8),
        "support_zone_strength": np.zeros(n, np.int64), "resistance_zone_strength": np.zeros(n, np.int64),
        "zone_strength": np.zeros(n, np.int64), "bandwidth_points": np.full(n, np.nan),
        "support_zone_count": np.zeros(n, np.int64), "resistance_zone_count": np.zeros(n, np.int64),
        "pivot_high": np.zeros(n, np.int8), "pivot_low": np.zeros(n, np.int8),
    }
    if n < 2 * lookback + 1:
        return _finish(out, bars)
    # the chart averages the true ranges of its window's bars after the first (window - 1 values)
    tr = pd.Series(np.r_[np.nan, true_range(high, low, close)])
    mean_tr = tr.expanding().mean().to_numpy() if window_bars <= 0 else tr.rolling(max(window_bars - 1, 1), min_periods=1).mean().to_numpy()
    bandwidth = np.ascontiguousarray(bandwidth_multiple * mean_tr)
    out["bandwidth_points"] = bandwidth
    high_idx, low_idx = structural_pivots(high, low, lookback)
    out["pivot_high"][high_idx + lookback] = 1
    out["pivot_low"][low_idx + lookback] = 1
    _zone_walk(high, low, bandwidth, high_idx.astype(np.int64), low_idx.astype(np.int64), int(lookback), int(window_bars),
               int(max_levels or 0), out["zone_price_support"], out["zone_price_resistance"], out["support_zone"], out["resistance_zone"],
               out["support_zone_strength"], out["resistance_zone_strength"], out["support_zone_count"], out["resistance_zone_count"])
    return _finish(out, bars)


def _finish(out: dict, bars: pd.DataFrame) -> pd.DataFrame:
    out["zone_strength"] = np.maximum(out["support_zone_strength"] * out["support_zone"],
                                      out["resistance_zone_strength"] * out["resistance_zone"]).astype(np.int64)
    frame = pd.DataFrame(out)
    if "time" in bars.columns:
        frame.insert(0, "time", bars["time"].to_numpy())
    return frame
