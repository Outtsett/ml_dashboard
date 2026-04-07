"""S_volume_profile: directional signal from volume profile structure.

Derives a composite directional scalar in [-1, +1] from three Level 1
volume-profile components: VPOC drift (trend of value), distribution skew
(price position relative to VPOC), and value area width (trending vs ranging).
Replaces the removed S_micro signal.
"""

import numpy as np

from ..config import (
    BENCH_DH,
    BENCH_DL,
    BENCH_VAH,
    BENCH_VAL,
    BENCH_VPOC,
    BENCHMARKS,
    TICK_SIZE,
)

# Component weights.
_W_DRIFT: float = 0.40
_W_SKEW: float = 0.30
_W_WIDTH: float = 0.30

# VPOC drift normalization: full signal at 4 ticks of movement.
_DRIFT_NORM: float = TICK_SIZE * 4.0


def compute_volume_profile(
    benchmarks: np.ndarray,
    prev_benchmarks: np.ndarray | None,
    distances: np.ndarray,
) -> float:
    """Compute S_volume_profile from benchmark arrays and distances.

    Parameters
    ----------
    benchmarks:
        Current tick's benchmark values, shape ``(15,)``.  Raw price levels
        following the ordering defined by the ``BENCH_*`` indices in config.
    prev_benchmarks:
        Previous tick's benchmark values, same shape ``(15,)``.  When ``None``
        (first tick), the function returns 0.0 because VPOC drift cannot be
        computed.
    distances:
        Signed distances from the current price to benchmarks, shape ``(210,)``
        or at minimum ``(15,)``.  Only the first 15 elements (price-to-benchmark)
        are used.  Positive = price above benchmark.  Raw tick distances,
        *not* normalized.

    Returns
    -------
    float
        Directional signal in [-1, +1].  Positive = bullish volume profile
        structure (VPOC rising, price above VPOC, wide value area).  Negative
        = bearish (VPOC falling, price below VPOC, tight value area).

    Notes
    -----
    Formula::

        atr           = max(|DH - DL|, TICK_SIZE)
        drift_signal  = clip((vpoc - prev_vpoc) / (TICK_SIZE * 4), -1, +1)
        skew_signal   = clip(distances[VPOC] / atr, -1, +1)
        width_ratio   = (vah - val) / atr
        width_signal  = clip((width_ratio - 0.5) * 2, -1, +1)
        S_volume_profile = clip(0.40 * drift + 0.30 * skew + 0.30 * width,
                                -1, +1)

    ``drift_signal`` captures trend-of-value: a rising VPOC means buyers are
    establishing value at higher prices.

    ``skew_signal`` captures where price sits relative to the point of control.
    Price above VPOC suggests acceptance of higher value; below suggests
    rejection.

    ``width_signal`` captures whether the market is building a wide (trending,
    directional) or tight (ranging, rotational) value area.  Wide maps to
    positive, tight to negative.
    """
    if prev_benchmarks is None:
        return 0.0

    if benchmarks.shape[0] != BENCHMARKS:
        raise ValueError(
            f"benchmarks must have shape ({BENCHMARKS},), "
            f"got {benchmarks.shape}"
        )
    if prev_benchmarks.shape[0] != BENCHMARKS:
        raise ValueError(
            f"prev_benchmarks must have shape ({BENCHMARKS},), "
            f"got {prev_benchmarks.shape}"
        )
    if distances.shape[0] < BENCHMARKS:
        raise ValueError(
            f"distances must have at least {BENCHMARKS} elements, "
            f"got {distances.shape[0]}"
        )

    # ATR proxy from intraday range.
    atr: float = max(abs(float(benchmarks[BENCH_DH] - benchmarks[BENCH_DL])), TICK_SIZE)

    # ── VPOC drift (0.40) ──────────────────────────────────────────────────
    vpoc: float = float(benchmarks[BENCH_VPOC])
    prev_vpoc: float = float(prev_benchmarks[BENCH_VPOC])
    drift_signal: float = float(np.clip((vpoc - prev_vpoc) / _DRIFT_NORM, -1.0, 1.0))

    # ── Distribution skew (0.30) ───────────────────────────────────────────
    skew_signal: float = float(np.clip(float(distances[BENCH_VPOC]) / atr, -1.0, 1.0))

    # ── Value area width (0.30) ────────────────────────────────────────────
    vah: float = float(benchmarks[BENCH_VAH])
    val: float = float(benchmarks[BENCH_VAL])
    width_ratio: float = (vah - val) / atr
    width_signal: float = float(np.clip((width_ratio - 0.5) * 2.0, -1.0, 1.0))

    # ── Composite ──────────────────────────────────────────────────────────
    signal: float = _W_DRIFT * drift_signal + _W_SKEW * skew_signal + _W_WIDTH * width_signal
    return float(np.clip(signal, -1.0, 1.0))
