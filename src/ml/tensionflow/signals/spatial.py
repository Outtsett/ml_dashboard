"""S_spatial: weighted benchmark distance signal with convergence modifier.

Aggregates 15 normalized price-to-benchmark distances into a single
directional scalar in [-1, +1]. Positive = price above benchmarks (bullish),
negative = price below benchmarks (bearish).

Enhanced to accept optional pair_distances (195 benchmark-pair distances)
for a convergence modifier: when benchmarks cluster (small pair distances),
the signal gains conviction; when they diverge, conviction drops.
"""

import numpy as np

from ..config import BENCHMARKS, SPATIAL_BENCHMARK_WEIGHTS

# Normalize weights at import time in case config does not sum to 1.0.
_WEIGHTS: np.ndarray = SPATIAL_BENCHMARK_WEIGHTS / SPATIAL_BENCHMARK_WEIGHTS.sum()

# Convergence modifier weight: 80% price signal, 20% convergence adjustment.
_PRICE_W: float = 0.80
_CONVERGENCE_W: float = 0.20


def compute_spatial(
    norm_distances: np.ndarray,
    pair_distances: np.ndarray | None = None,
) -> float:
    """Compute S_spatial from normalized benchmark distances.

    Parameters
    ----------
    norm_distances:
        Shape (15,).  Each element is a signed, normalized distance from the
        current price to one benchmark, following the ordering defined by the
        BENCH_* indices in config.  Positive values mean price is *above* the
        benchmark; negative values mean price is *below* it.  Values are
        expected in approximately [-1, +1] before weighting but no hard
        pre-condition is enforced here -- the final clip handles overflow.
    pair_distances:
        Optional shape (195,).  Normalized benchmark-pair distances.  When
        provided, a convergence modifier is applied: high pair uniformity
        (low std) amplifies the signal, high dispersion dampens it.

    Returns
    -------
    float
        Directional signal in [-1, +1].  +1 means price is firmly above all
        high-weight benchmarks; -1 means firmly below.
    """
    if norm_distances.shape[0] != BENCHMARKS:
        raise ValueError(
            f"norm_distances must have shape ({BENCHMARKS},), "
            f"got {norm_distances.shape}"
        )

    price_signal: float = float(np.dot(_WEIGHTS, norm_distances))

    if pair_distances is not None and pair_distances.shape[0] > 0:
        # Convergence: 1.0 when all pair distances are identical (max consensus),
        # approaches 0.0 when they are maximally dispersed.
        pair_std = float(np.std(np.abs(pair_distances)))
        convergence = max(0.0, 1.0 - pair_std)

        # Modulate: convergence amplifies the price signal direction.
        signal = _PRICE_W * price_signal + _CONVERGENCE_W * (price_signal * convergence)
    else:
        signal = price_signal

    return float(np.clip(signal, -1.0, 1.0))
