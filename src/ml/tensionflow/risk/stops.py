"""Stop and target distances derived from benchmark structure.

Computes structurally grounded stop and target levels in ticks by scanning
the benchmark array for the nearest support/resistance levels on each side of
VWAP.  Distances are expressed in ticks (positive scalars) relative to the
current VWAP reference.
"""

from __future__ import annotations

import numpy as np

from ..config import (
    BENCH_DH,
    BENCH_DL,
    BENCH_PDH,
    BENCH_PDL,
    BENCH_VAH,
    BENCH_VAL,
    BENCH_VWAP,
    BENCH_VWAP_LOWER,
    BENCH_VWAP_UPPER,
    MIN_STOP_TICKS,
    TICK_SIZE,
)

# Resistance levels (above VWAP) — used as targets for LONG, stops for SHORT.
_RESISTANCE_INDICES: tuple[int, ...] = (BENCH_VAH, BENCH_DH, BENCH_VWAP_UPPER, BENCH_PDH)

# Support levels (below VWAP) — used as stops for LONG, targets for SHORT.
_SUPPORT_INDICES: tuple[int, ...] = (BENCH_VAL, BENCH_DL, BENCH_VWAP_LOWER, BENCH_PDL)


def compute_stops(
    signal: int,
    benchmarks: np.ndarray,
) -> tuple[float, float]:
    """Compute stop and target distances in ticks from benchmark structure.

    For a LONG signal the logic is:

    * **Target** — the *nearest* resistance level strictly above VWAP among
      ``{VAH, DH, VWAP_UPPER, PDH}``.  The nearest one represents the first
      structural obstacle the price must clear.
    * **Stop** — the *nearest* support level strictly below VWAP among
      ``{VAL, DL, VWAP_LOWER, PDL}``.  The nearest one is the first line of
      structural support that, if broken, invalidates the setup.

    For a SHORT signal the target and stop benchmarks are swapped:

    * **Target** — nearest support below VWAP (same set as LONG stop).
    * **Stop** — nearest resistance above VWAP (same set as LONG target).

    All distances are converted to ticks via ``abs(level − vwap) / TICK_SIZE``
    and floored at ``config.MIN_STOP_TICKS`` (4.0 ticks / 1 MNQ point) to
    prevent degenerate zero-tick stops when a benchmark coincides with VWAP.

    Parameters
    ----------
    signal:
        Active position direction: ``+1`` or ``+2`` for LONG, ``-1`` or
        ``-2`` for SHORT.  Any non-zero value is treated directionally; zero
        returns ``(0.0, 0.0)``.
    benchmarks:
        Shape ``(15,)``.  Absolute benchmark price levels in instrument
        native units (e.g. NQ points).  Order follows ``BENCH_*`` indices
        in config.

    Returns
    -------
    tuple[float, float]
        ``(stop_ticks, target_ticks)``.  Both values are non-negative scalars
        in ticks.  Returns ``(0.0, 0.0)`` when signal is 0 (flat).

    Raises
    ------
    ValueError
        If ``benchmarks`` does not have at least 15 elements.
    """
    if signal == 0:
        return 0.0, 0.0

    if benchmarks.shape[0] < 15:
        raise ValueError(
            f"benchmarks must have at least 15 elements, got {benchmarks.shape[0]}"
        )

    bench = np.asarray(benchmarks, dtype=np.float64)
    vwap: float = float(bench[BENCH_VWAP])

    # Collect candidate resistance levels (those above VWAP).
    resistance_levels = [
        float(bench[i]) for i in _RESISTANCE_INDICES if float(bench[i]) > vwap
    ]

    # Collect candidate support levels (those below VWAP).
    support_levels = [
        float(bench[i]) for i in _SUPPORT_INDICES if float(bench[i]) < vwap
    ]

    def _ticks_to(levels: list[float], nearest: bool) -> float:
        """Convert benchmark levels to tick distances, pick nearest or farthest."""
        if not levels:
            return MIN_STOP_TICKS
        distances_ticks = [abs(lvl - vwap) / TICK_SIZE for lvl in levels]
        raw = min(distances_ticks) if nearest else max(distances_ticks)
        return max(raw, MIN_STOP_TICKS)

    is_long: bool = signal > 0

    if is_long:
        # LONG: target = nearest resistance above VWAP; stop = nearest support below.
        target_ticks = _ticks_to(resistance_levels, nearest=True)
        stop_ticks = _ticks_to(support_levels, nearest=True)
    else:
        # SHORT: target = nearest support below VWAP; stop = nearest resistance above.
        target_ticks = _ticks_to(support_levels, nearest=True)
        stop_ticks = _ticks_to(resistance_levels, nearest=True)

    return stop_ticks, target_ticks
