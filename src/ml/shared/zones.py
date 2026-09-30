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

A pivot at bar j is known only at the close of bar j + lookback and enters the zones from that bar
on; pivots older than the chart's window (25,000 bars) drop out as they do when the chart scrolls;
the bandwidth is 0.5 x the mean true range of that window; nothing at bar i reads a later bar.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from numba import njit

PIVOT_LOOKBACK = 5
MAX_LEVELS = 10
CHART_WINDOW_BARS = 25_000   # the bars the Market chart loads and computes its levels on
BANDWIDTH_TRUE_RANGE_MULTIPLE = 0.5


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
    as the chart reads its visible bars."""
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


@njit(cache=True)
def _cluster_summary(prices, tolerance, minimum_touches):
    """Cluster ``prices`` (ascending) by the running-mean rule and return the mean price and the
    touch count of every cluster with at least ``minimum_touches`` members, ascending by price."""
    n = prices.shape[0]
    means = np.empty(n, np.float64)
    counts = np.empty(n, np.int64)
    kept = 0
    if n == 0:
        return means[:0], counts[:0]
    total = prices[0]
    count = 1
    for i in range(1, n + 1):
        if i < n and abs(prices[i] - total / count) <= tolerance:
            total += prices[i]
            count += 1
            continue
        if count >= minimum_touches:
            means[kept] = total / count
            counts[kept] = count
            kept += 1
        if i < n:
            total = prices[i]
            count = 1
    return means[:kept], counts[:kept]


@njit(cache=True)
def _nearest_index(sorted_prices, values):
    out = np.empty(values.shape[0], np.int64)
    m = sorted_prices.shape[0]
    for i in range(values.shape[0]):
        v = values[i]
        position = np.searchsorted(sorted_prices, v)
        left = min(max(position - 1, 0), m - 1)
        right = min(max(position, 0), m - 1)
        out[i] = right if abs(sorted_prices[right] - v) < abs(sorted_prices[left] - v) else left
    return out


def _top_levels(means, counts, max_levels):
    """Keep the ``max_levels`` most-touched clusters (ties by ascending price, as the chart's stable
    sort keeps them), returned ascending by price."""
    order = np.argsort(-counts, kind="stable")[:max_levels]
    keep = np.sort(order)
    return means[keep], counts[keep]


def zone_features(
    bars: pd.DataFrame,
    lookback: int = PIVOT_LOOKBACK,
    bandwidth_multiple: float = BANDWIDTH_TRUE_RANGE_MULTIPLE,
    window_bars: int = CHART_WINDOW_BARS,
    max_levels: int | None = MAX_LEVELS,
) -> pd.DataFrame:
    """Causal per-bar zone features on a frame with ``high``, ``low``, ``close`` (and ``time`` if present):
    at every bar, exactly what the chart would draw if its ``window_bars``-bar window ended at that bar.

    The pivots known at bar i are those confirmed by it (a pivot at j is known at bar j + lookback)
    inside the trailing window; the bandwidth is ``bandwidth_multiple`` x the mean true range of that
    window (0 = every bar so far); the pivots are clustered with the chart's running-mean rule and the
    ``max_levels`` most-touched zones are kept (None = every zone with two touches).

    Columns: zone_price_support (nearest support zone to the bar's low), zone_price_resistance
    (nearest resistance zone to the bar's high), support_zone, resistance_zone (the spec's flags),
    support_zone_strength, resistance_zone_strength (touches of those zones), zone_strength (touches
    of the zone being touched; the larger when both), bandwidth, support_zone_count,
    resistance_zone_count, pivot_high, pivot_low (1 on the bar a pivot is CONFIRMED, not the pivot bar)."""
    high, low, close = (bars[c].to_numpy(np.float64) for c in ("high", "low", "close"))
    n = high.size
    out = {
        "zone_price_support": np.full(n, np.nan), "zone_price_resistance": np.full(n, np.nan),
        "support_zone": np.zeros(n, np.int8), "resistance_zone": np.zeros(n, np.int8),
        "support_zone_strength": np.zeros(n, np.int32), "resistance_zone_strength": np.zeros(n, np.int32),
        "zone_strength": np.zeros(n, np.int32), "bandwidth": np.full(n, np.nan),
        "support_zone_count": np.zeros(n, np.int32), "resistance_zone_count": np.zeros(n, np.int32),
        "pivot_high": np.zeros(n, np.int8), "pivot_low": np.zeros(n, np.int8),
    }
    if n < 2 * lookback + 1:
        return _finish(out, bars)
    # bandwidth known at each bar: the chart's mean true range over its window, ending at the bar
    tr = pd.Series(np.r_[np.nan, true_range(high, low, close)])
    # the chart averages the true ranges of its window's bars after the first (window - 1 values)
    mean_tr = tr.expanding().mean().to_numpy() if window_bars <= 0 else tr.rolling(max(window_bars - 1, 1), min_periods=1).mean().to_numpy()
    bandwidth = bandwidth_multiple * mean_tr
    out["bandwidth"] = bandwidth
    high_idx, low_idx = structural_pivots(high, low, lookback)
    confirmed_high = high_idx + lookback   # the bar at whose close the pivot is known
    confirmed_low = low_idx + lookback
    out["pivot_high"][confirmed_high] = 1
    out["pivot_low"][confirmed_low] = 1
    events = np.unique(np.r_[confirmed_high, confirmed_low])
    if events.size == 0:
        return _finish(out, bars)
    bounds = np.r_[events, n]
    high_prices, low_prices = high[high_idx], low[low_idx]
    for e, start in enumerate(events):
        stop = bounds[e + 1]
        tolerance = float(bandwidth[start])
        if not np.isfinite(tolerance) or tolerance <= 0:
            continue
        # pivots known at this bar and still inside the window (the chart's window ends at the bar)
        oldest = start - window_bars + 1 if window_bars > 0 else 0
        hi_known = np.searchsorted(confirmed_high, start, side="right")
        hi_first = np.searchsorted(high_idx, oldest, side="left")
        lo_known = np.searchsorted(confirmed_low, start, side="right")
        lo_first = np.searchsorted(low_idx, oldest, side="left")
        resistance_price, resistance_touches = _cluster_summary(np.sort(high_prices[hi_first:hi_known]), tolerance, 2)
        support_price, support_touches = _cluster_summary(np.sort(low_prices[lo_first:lo_known]), tolerance, 2)
        if max_levels is not None:
            means = np.r_[resistance_price, support_price]
            counts = np.r_[resistance_touches, support_touches]
            kinds = np.r_[np.ones(resistance_price.size, np.int8), np.zeros(support_price.size, np.int8)]
            order = np.argsort(-counts, kind="stable")[:max_levels]
            keep = np.sort(order)
            resistance_price, resistance_touches = means[keep][kinds[keep] == 1], counts[keep][kinds[keep] == 1]
            support_price, support_touches = means[keep][kinds[keep] == 0], counts[keep][kinds[keep] == 0]
        segment = slice(start, stop)
        out["support_zone_count"][segment] = support_price.size
        out["resistance_zone_count"][segment] = resistance_price.size
        band = bandwidth[segment]
        if support_price.size:
            nearest = _nearest_index(support_price, low[segment])
            out["zone_price_support"][segment] = support_price[nearest]
            out["support_zone_strength"][segment] = support_touches[nearest]
            out["support_zone"][segment] = (np.abs(low[segment] - support_price[nearest]) < band).astype(np.int8)
        if resistance_price.size:
            nearest = _nearest_index(resistance_price, high[segment])
            out["zone_price_resistance"][segment] = resistance_price[nearest]
            out["resistance_zone_strength"][segment] = resistance_touches[nearest]
            out["resistance_zone"][segment] = (np.abs(high[segment] - resistance_price[nearest]) < band).astype(np.int8)
    return _finish(out, bars)


def _finish(out: dict, bars: pd.DataFrame) -> pd.DataFrame:
    out["zone_strength"] = np.maximum(out["support_zone_strength"] * out["support_zone"],
                                      out["resistance_zone_strength"] * out["resistance_zone"]).astype(np.int32)
    frame = pd.DataFrame(out)
    if "time" in bars.columns:
        frame.insert(0, "time", bars["time"].to_numpy())
    return frame


def _nearest(sorted_prices: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Index of the price nearest to each value (``sorted_prices`` ascending)."""
    position = np.searchsorted(sorted_prices, values)
    left = np.clip(position - 1, 0, sorted_prices.size - 1)
    right = np.clip(position, 0, sorted_prices.size - 1)
    choose_right = np.abs(sorted_prices[right] - values) < np.abs(sorted_prices[left] - values)
    return np.where(choose_right, right, left)
