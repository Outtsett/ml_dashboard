"""Structural market context classification from benchmark proximity.

Classifies where the current price sits relative to the key reference levels
(VWAP, Value Area, VWAP bands) using the first 15 signed benchmark distances.
The classification drives context-aware strength upgrades in the strength stage.
"""

from __future__ import annotations

import numpy as np

from ..config import (
    BENCH_VAH,
    BENCH_VAL,
    BENCH_VWAP,
    BENCH_VWAP_LOWER,
    BENCH_VWAP_LOWER_PERM,
    BENCH_VWAP_UPPER,
    BENCH_VWAP_UPPER_PERM,
    CONTEXT_AT_THRESHOLD_TICKS,
    CONTEXT_EXTREME_THRESHOLD_TICKS,
    TICK_SIZE,
)

# ── Context label constants ──────────────────────────────────────────────────

AT_VWAP: str = "AT_VWAP"
AT_VALUE_EDGE: str = "AT_VALUE_EDGE"
AT_EXTREME: str = "AT_EXTREME"
AT_MPD: str = "AT_MPD"
AT_NEUTRAL: str = "AT_NEUTRAL"


def classify_context(benchmarks: np.ndarray, distances: np.ndarray) -> str:
    """Classify the current price context relative to structural benchmarks.

    The first 15 elements of ``distances`` carry the signed distance from the
    current price to each of the 15 benchmarks (in raw price units, same as
    the benchmark array).  The magnitude of each distance is converted to
    ticks by dividing by ``config.TICK_SIZE`` and compared against proximity
    thresholds to determine the structural context label.

    Priority order (highest to lowest):

    1. **AT_MPD** — price is within ``CONTEXT_EXTREME_THRESHOLD_TICKS``
       (8 ticks) of the VWAP Max Permissible Deviation bands
       (indices ``BENCH_VWAP_UPPER_PERM`` = 10, ``BENCH_VWAP_LOWER_PERM`` = 11).
       Institutions stop buying/selling here and start fading.
    2. **AT_EXTREME** — price is within ``CONTEXT_EXTREME_THRESHOLD_TICKS``
       (8 ticks) of the VWAP 2-sigma standard deviation bands
       (indices ``BENCH_VWAP_UPPER`` = 12, ``BENCH_VWAP_LOWER`` = 13).
       Statistical overbought/oversold boundary.
    3. **AT_VALUE_EDGE** — price is within ``CONTEXT_AT_THRESHOLD_TICKS``
       (2 ticks) of VAH (index 7) or VAL (index 8).
    4. **AT_VWAP** — price is within ``CONTEXT_AT_THRESHOLD_TICKS`` (2 ticks)
       of VWAP (index 9).
    5. **AT_NEUTRAL** — none of the above apply.

    Parameters
    ----------
    benchmarks:
        Shape ``(15,)``.  Absolute benchmark price levels (unused for the
        distance calculations here but accepted for API symmetry with callers
        that hold both arrays).
    distances:
        Shape ``(210,)`` or at minimum ``(15,)``.  Signed distances from the
        current price to each benchmark.  Only the first 15 elements are used.
        Positive = price is *above* the benchmark; negative = price is *below*.

    Returns
    -------
    str
        One of ``AT_EXTREME``, ``AT_VALUE_EDGE``, ``AT_VWAP``, or
        ``AT_NEUTRAL``.

    Raises
    ------
    ValueError
        If ``distances`` has fewer than 15 elements.
    """
    if distances.shape[0] < 15:
        raise ValueError(
            f"distances must have at least 15 elements, got {distances.shape[0]}"
        )

    # Extract the first 15 benchmark distances and convert to ticks.
    bench_distances: np.ndarray = np.asarray(distances[:15], dtype=np.float64)
    ticks: np.ndarray = np.abs(bench_distances) / TICK_SIZE

    # 1. AT_MPD: near VWAP Max Permissible Deviation bands.
    #    Institutional hard ceiling — beyond here they fade, not chase.
    if (
        ticks[BENCH_VWAP_UPPER_PERM] <= CONTEXT_EXTREME_THRESHOLD_TICKS
        or ticks[BENCH_VWAP_LOWER_PERM] <= CONTEXT_EXTREME_THRESHOLD_TICKS
    ):
        return AT_MPD

    # 2. AT_EXTREME: near VWAP 2-sigma standard deviation bands.
    #    Statistical overbought/oversold — likely to mean-revert.
    if (
        ticks[BENCH_VWAP_UPPER] <= CONTEXT_EXTREME_THRESHOLD_TICKS
        or ticks[BENCH_VWAP_LOWER] <= CONTEXT_EXTREME_THRESHOLD_TICKS
    ):
        return AT_EXTREME

    # 3. AT_VALUE_EDGE: near VAH or VAL (tight tolerance = 2 ticks).
    if (
        ticks[BENCH_VAH] <= CONTEXT_AT_THRESHOLD_TICKS
        or ticks[BENCH_VAL] <= CONTEXT_AT_THRESHOLD_TICKS
    ):
        return AT_VALUE_EDGE

    # 4. AT_VWAP: near VWAP itself (tight tolerance = 2 ticks).
    if ticks[BENCH_VWAP] <= CONTEXT_AT_THRESHOLD_TICKS:
        return AT_VWAP

    # 5. No structural proximity detected.
    return AT_NEUTRAL
