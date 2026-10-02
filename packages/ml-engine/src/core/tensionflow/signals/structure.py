"""S_structure: structural trade setup from benchmark confluence.

Detects structural setups from benchmark clustering and distance graph
topology using only Level 1 data.  When multiple benchmarks converge near
price, the market is at a structural decision point.  The direction of
price relative to that cluster provides directional bias; the degree of
pairwise benchmark compression modulates conviction.

Output is a single directional scalar in [-1, +1].
"""

import numpy as np

from ..config import BENCHMARKS, DISTANCES, TICK_SIZE

# Price-to-benchmark distances occupy the first 15 slots.
_BENCH_SLICE: int = BENCHMARKS
# Pair distances occupy the remaining 195 slots.
_PAIR_COUNT: int = DISTANCES - BENCHMARKS

# Proximity threshold: a benchmark within this many ticks of price is "nearby".
_NEARBY_TICKS: int = 4
_NEARBY_THRESHOLD: float = TICK_SIZE * _NEARBY_TICKS

# Compression threshold: a pair distance below this is "compressed".
_COMPRESSION_TICKS: int = 8
_COMPRESSION_THRESHOLD: float = TICK_SIZE * _COMPRESSION_TICKS

# Maximum nearby benchmarks that saturate cluster_strength to 1.0.
_CLUSTER_SATURATION: float = 4.0


def compute_structure(benchmarks: np.ndarray, distances: np.ndarray) -> float:
    """Compute S_structure from benchmark distances and pair topology.

    Parameters
    ----------
    benchmarks:
        Shape ``(15,)``.  Raw benchmark price levels (PDH, PDL, ..., TWAP).
        Used only for pair distance extraction; proximity detection uses the
        signed price-to-benchmark distances from ``distances[:15]``.
    distances:
        Shape ``(210,)``.  Full distance vector.  The first 15 entries are
        signed price-to-benchmark distances (positive = price above benchmark);
        entries ``[15:210]`` hold the 195 pairwise benchmark-to-benchmark
        distances.

    Returns
    -------
    float
        Directional structure signal in [-1, +1].  Positive = price above a
        cluster of converging benchmarks (bullish setup); negative = price
        below (bearish setup).  Magnitude increases with cluster density and
        pair compression.
    """
    if benchmarks.shape[0] != BENCHMARKS:
        raise ValueError(f"benchmarks must have shape ({BENCHMARKS},), got {benchmarks.shape}")
    if distances.shape[0] != DISTANCES:
        raise ValueError(f"distances must have shape ({DISTANCES},), got {distances.shape}")

    # ── Cluster strength ────────────────────────────────────────────────────
    # How many benchmarks sit within _NEARBY_TICKS of price?
    # Use distances[:15] (signed price-to-benchmark), NOT raw benchmark prices.
    price_to_bench: np.ndarray = distances[:_BENCH_SLICE].astype(np.float64)
    abs_dist: np.ndarray = np.abs(price_to_bench)
    nearby_mask: np.ndarray = abs_dist <= _NEARBY_THRESHOLD
    nearby_count: int = int(nearby_mask.sum())
    cluster_strength: float = min(nearby_count / _CLUSTER_SATURATION, 1.0)

    # ── Directional bias ────────────────────────────────────────────────────
    # Mean signed distance to nearby benchmarks.  Positive = price above
    # the cluster (bullish).  When no benchmarks are nearby, directional = 0.
    if nearby_count == 0:
        directional: float = 0.0
    else:
        directional = float(np.mean(price_to_bench[nearby_mask]))
        directional = float(
            np.clip(
                directional / _NEARBY_THRESHOLD,
                -1.0,
                1.0,
            )
        )

    # ── Pair compression ────────────────────────────────────────────────────
    # Fraction of pairwise distances that are compressed (benchmarks
    # converging on each other).  Not used in the signal formula directly
    # but available for downstream consumers via the ratio.
    pair_distances: np.ndarray = distances[_BENCH_SLICE:]
    compressed_count: int = int((np.abs(pair_distances) < _COMPRESSION_THRESHOLD).sum())
    compression_ratio: float = compressed_count / float(_PAIR_COUNT)  # noqa: F841

    # ── Composite signal ────────────────────────────────────────────────────
    # directional provides direction; cluster_strength scales magnitude.
    # When cluster_strength = 0 (no nearby benchmarks), signal ≈ 0.
    signal: float = directional * (0.5 + 0.5 * cluster_strength)
    return float(np.clip(signal, -1.0, 1.0))
