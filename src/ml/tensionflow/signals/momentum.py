"""S_momentum: rate-of-change momentum + Bollinger band state signal.

Combines the tick-over-tick velocity of key benchmarks (VWAP, TWAP, VPOC)
with a spread-tension band state into a single directional scalar in [-1, +1].
"""

import numpy as np

from ..config import (
    BENCH_TWAP,
    BENCH_VPOC,
    BENCH_VWAP,
    BENCHMARKS,
    MOMENTUM_W_BAND,
    MOMENTUM_W_CORE,
)

# Indices of the three anchor benchmarks used for core momentum.
_CORE_INDICES: tuple[int, ...] = (BENCH_VWAP, BENCH_TWAP, BENCH_VPOC)


def compute_momentum(
    norm_distances: np.ndarray,
    prev_distances: np.ndarray | None,
    spread_tension: float,
) -> float:
    """Compute S_momentum from benchmark distance delta and band state.

    Parameters
    ----------
    norm_distances:
        Current tick's normalized distances from price to each of the 15
        benchmarks, shape (15,).  Positive = price above benchmark.
    prev_distances:
        Previous tick's normalized distances, same shape (15,).  When ``None``
        (first tick seen), the function returns 0.0 because no velocity can be
        computed.
    spread_tension:
        Scalar band-width tension value from the normalizer, where 1.0 means
        bands are at their baseline width.  Values > 1.0 indicate expansion
        (trending / volatile), values < 1.0 indicate contraction (coiling).
        Passed in already normalized; no further scaling is applied here.

    Returns
    -------
    float
        Directional momentum signal in [-1, +1].  Positive = benchmarks
        recently moved downward relative to price (bullish momentum);
        negative = benchmarks moved upward relative to price (bearish).

    Notes
    -----
    Formula:
        core       = mean(norm_distances[VWAP, TWAP, VPOC]
                          - prev_distances[VWAP, TWAP, VPOC])
        band_state = clip(spread_tension - 1.0, -1, +1)
        S_momentum = clip(MOMENTUM_W_CORE * core
                          + MOMENTUM_W_BAND * band_state, -1, +1)

    ``core`` captures directional drift of the three most informative
    anchors: VWAP (volume-weighted fair value), TWAP (time-weighted anchor),
    and VPOC (highest-volume price).  An increase in distance means price
    moved *away* from — or the benchmarks moved *toward* — price, so the
    sign is preserved as-is for a bullish interpretation.

    ``band_state`` uses Bollinger band tension as a regime modifier: expanding
    bands (> 1.0) add positive momentum bias (directional breakout context),
    contracting bands (< 1.0) subtract (mean-reversion context).
    """
    if prev_distances is None:
        return 0.0

    if norm_distances.shape[0] != BENCHMARKS or prev_distances.shape[0] != BENCHMARKS:
        raise ValueError(
            f"norm_distances and prev_distances must have shape ({BENCHMARKS},), "
            f"got {norm_distances.shape} and {prev_distances.shape}"
        )

    delta: np.ndarray = norm_distances[list(_CORE_INDICES)] - prev_distances[list(_CORE_INDICES)]
    core: float = float(np.mean(delta))

    band_state: float = float(np.clip(spread_tension - 1.0, -1.0, 1.0))

    signal: float = MOMENTUM_W_CORE * core + MOMENTUM_W_BAND * band_state
    return float(np.clip(signal, -1.0, 1.0))
