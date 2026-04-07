"""Spatial feature normalisation: benchmark distances -> [-1, +1].

Normalises the 210-element distance vector by an ATR proxy derived from the
daily high/low benchmarks.  Returns both the first 15 price-to-benchmark
distances (for S_spatial weighting) and the full 195 benchmark-pair distances
(for convergence/divergence analysis in S_structure).
"""

from __future__ import annotations

import numpy as np

from ..config import (
    BENCH_DH,
    BENCH_DL,
    TICK_SIZE,
    BENCHMARKS,
    DISTANCES,
)

# Number of price-to-benchmark distances at the front of the distance vector.
_N_PRICE_BENCH: int = BENCHMARKS  # 15
_N_PAIR_BENCH: int = DISTANCES - BENCHMARKS  # 195


def normalize_spatial(distances: np.ndarray, benchmarks: np.ndarray) -> np.ndarray:
    """Normalise price-to-benchmark distances to the interval [-1, +1].

    The ATR proxy is computed as abs(benchmarks[BENCH_DH] - benchmarks[BENCH_DL]).
    This gives an intraday range in price units.  Each of the 15 price-to-
    benchmark distances is divided by this ATR, then clipped to [-3, 3] (three
    ATR multiples), then linearly rescaled to [-1, 1].

    Clipping at ±3 ATR before rescaling ensures that extreme outliers (e.g.
    price many ATRs away from a stale PDH benchmark) do not compress the useful
    mid-range signal into a tiny band around zero.

    Args:
        distances: (210,) float64 array from shared memory.  The first 15
                   elements are the signed price-to-benchmark distances in price
                   units (positive = price above benchmark).
        benchmarks: (15,) float64 array containing benchmark price levels
                    ordered by the BENCH_* indices defined in config.

    Returns:
        (15,) float32 array of normalised distances in [-1, +1], one per
        benchmark level.  Values are ordered identically to the BENCH_* index
        sequence so they can be directly multiplied by SPATIAL_BENCHMARK_WEIGHTS.

    Raises:
        ValueError: If distances has fewer than 15 elements or benchmarks has
                    fewer than max(BENCH_DH, BENCH_DL) + 1 elements.
    """
    if distances.shape[0] < _N_PRICE_BENCH:
        raise ValueError(
            f"distances must have at least {_N_PRICE_BENCH} elements, "
            f"got {distances.shape[0]}"
        )
    required_bench = max(BENCH_DH, BENCH_DL) + 1
    if benchmarks.shape[0] < required_bench:
        raise ValueError(
            f"benchmarks must have at least {required_bench} elements, "
            f"got {benchmarks.shape[0]}"
        )

    # ATR proxy: intraday high-low range, floored at one tick to avoid /0.
    atr = abs(float(benchmarks[BENCH_DH]) - float(benchmarks[BENCH_DL]))
    atr = max(atr, TICK_SIZE)

    # Slice the first 15 price-to-benchmark distances.
    raw: np.ndarray = distances[:_N_PRICE_BENCH].astype(np.float32)

    # Normalise by ATR, clip to [-3, 3], rescale to [-1, 1].
    normalised = raw / np.float32(atr)
    normalised = np.clip(normalised, -3.0, 3.0)
    normalised = normalised / np.float32(3.0)

    # Guard against NaN/inf from stale or zero shared-memory reads.
    normalised = np.nan_to_num(normalised, nan=0.0, posinf=0.0, neginf=0.0)

    return normalised  # shape (15,), dtype float32


def normalize_spatial_full(
    distances: np.ndarray, benchmarks: np.ndarray
) -> dict[str, np.ndarray]:
    """Normalise both price-to-benchmark (15) and pair (195) distances.

    Uses the same ATR proxy and clip-rescale as :func:`normalize_spatial` but
    returns both halves of the 210-element distance vector in a dict.

    Args:
        distances: (210,) float array from shared memory.
        benchmarks: (15,) float64 array of benchmark price levels.

    Returns:
        Dict with keys:

        - ``"price_to_bench"`` — (15,) float32 array, same as
          :func:`normalize_spatial` output.
        - ``"pair_distances"`` — (195,) float32 array of normalised
          benchmark-pair distances in [-1, +1].
    """
    price_to_bench = normalize_spatial(distances, benchmarks)

    # ATR proxy (same as above).
    atr = abs(float(benchmarks[BENCH_DH]) - float(benchmarks[BENCH_DL]))
    atr = max(atr, TICK_SIZE)

    # Normalise the remaining 195 benchmark-pair distances.
    n_pairs = min(_N_PAIR_BENCH, distances.shape[0] - _N_PRICE_BENCH)
    if n_pairs > 0:
        raw_pairs = distances[_N_PRICE_BENCH : _N_PRICE_BENCH + n_pairs].astype(
            np.float32
        )
        pair_normalised = raw_pairs / np.float32(atr)
        pair_normalised = np.clip(pair_normalised, -3.0, 3.0)
        pair_normalised = pair_normalised / np.float32(3.0)
        pair_normalised = np.nan_to_num(
            pair_normalised, nan=0.0, posinf=0.0, neginf=0.0
        )
    else:
        pair_normalised = np.zeros(_N_PAIR_BENCH, dtype=np.float32)

    return {
        "price_to_bench": price_to_bench,
        "pair_distances": pair_normalised,
    }
