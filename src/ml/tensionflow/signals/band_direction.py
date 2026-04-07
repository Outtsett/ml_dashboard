"""S_band_direction: band direction signal across VWAP, VPOC, and TWAP families.

Replaces the removed S_flow signal.  Evaluates band direction conditions
using only Level 1 (price/volume) data: benchmark values, their tick-over-tick
changes, and normalized price-to-benchmark distances.

Formula:
    S_band = 0.35 * vwap_signal + 0.35 * vpoc_signal + 0.30 * twap_signal

Each sub-signal evaluates a condition table mapping the current price zone and
band dynamics to a directional value in [-1, +1].
"""

from __future__ import annotations

from enum import IntEnum

import numpy as np

from ..config import (
    BENCH_TWAP,
    BENCH_VAH,
    BENCH_VAL,
    BENCH_VPOC,
    BENCH_VWAP,
    BENCH_VWAP_LOWER,
    BENCH_VWAP_UPPER,
    BENCHMARKS,
    TICK_SIZE,
)

# ── Sub-signal weights ──────────────────────────────────────────────────────

W_VWAP: float = 0.35
W_VPOC: float = 0.35
W_TWAP: float = 0.30

# ── Band direction detection threshold (ticks) ─────────────────────────────
# Minimum benchmark movement between ticks to register as directional drift.

_DRIFT_THRESHOLD: float = TICK_SIZE * 0.5


# ── VWAP enums ──────────────────────────────────────────────────────────────


class _VwapZone(IntEnum):
    """Price zone relative to VWAP envelope."""
    ABOVE_UPPER = 0
    VWAP_TO_UPPER = 1
    AT_VWAP = 2
    LOWER_TO_VWAP = 3
    BELOW_LOWER = 4


class _BandDirection(IntEnum):
    """Band width change direction."""
    EXPANDING = 0
    STABLE = 1
    CONTRACTING = 2


# ── VWAP condition table ────────────────────────────────────────────────────
# Rows: _VwapZone (5), Columns: _BandDirection (3).
# Values encode basic directional logic for Phase 4; fully populated Phase 5.
#
#                        EXPANDING    STABLE    CONTRACTING
# ABOVE_UPPER              +0.80      +0.50       +0.20
# VWAP_TO_UPPER            +0.50      +0.30       +0.10
# AT_VWAP                   0.00       0.00        0.00
# LOWER_TO_VWAP            -0.50      -0.30       -0.10
# BELOW_LOWER              -0.80      -0.50       -0.20

_VWAP_TABLE: np.ndarray = np.array(
    [
        [+0.80, +0.50, +0.20],  # ABOVE_UPPER
        [+0.50, +0.30, +0.10],  # VWAP_TO_UPPER
        [+0.00, +0.00, +0.00],  # AT_VWAP
        [-0.50, -0.30, -0.10],  # LOWER_TO_VWAP
        [-0.80, -0.50, -0.20],  # BELOW_LOWER
    ],
    dtype=np.float64,
)


# ── VPOC condition table ────────────────────────────────────────────────────
# Rows: price position (above_vah=0, vah_to_vpoc=1, at_vpoc=2,
#        vpoc_to_val=3, below_val=4)
# Columns: VPOC drift direction (up=0, flat=1, down=2)
#
#                        DRIFT_UP     FLAT     DRIFT_DOWN
# ABOVE_VAH               +0.70     +0.40       +0.10
# VAH_TO_VPOC             +0.40     +0.20        0.00
# AT_VPOC                 +0.10      0.00       -0.10
# VPOC_TO_VAL             -0.40     -0.20        0.00  (note: drift_down from below is less bearish)
# BELOW_VAL               -0.70     -0.40       -0.10

_VPOC_TABLE: np.ndarray = np.array(
    [
        [+0.70, +0.40, +0.10],  # ABOVE_VAH
        [+0.40, +0.20, +0.00],  # VAH_TO_VPOC
        [+0.10, +0.00, -0.10],  # AT_VPOC
        [-0.40, -0.20, +0.00],  # VPOC_TO_VAL
        [-0.70, -0.40, -0.10],  # BELOW_VAL
    ],
    dtype=np.float64,
)


# ── TWAP condition table ────────────────────────────────────────────────────
# Rows: deviation zone (far_above=0, above=1, at=2, below=3, far_below=4)
# Columns: TWAP momentum direction (up=0, flat=1, down=2)
#
#                        MOM_UP      FLAT      MOM_DOWN
# FAR_ABOVE              +0.60     +0.30       -0.10
# ABOVE                  +0.40     +0.20       -0.05
# AT_TWAP                +0.10      0.00       -0.10
# BELOW                  -0.40     -0.20       +0.05
# FAR_BELOW              -0.60     -0.30       +0.10

_TWAP_TABLE: np.ndarray = np.array(
    [
        [+0.60, +0.30, -0.10],  # FAR_ABOVE
        [+0.40, +0.20, -0.05],  # ABOVE
        [+0.10, +0.00, -0.10],  # AT_TWAP
        [-0.40, -0.20, +0.05],  # BELOW
        [-0.60, -0.30, +0.10],  # FAR_BELOW
    ],
    dtype=np.float64,
)

# ── TWAP deviation thresholds (ticks from TWAP) ────────────────────────────

_TWAP_FAR_TICKS: float = 8.0 * TICK_SIZE
_TWAP_NEAR_TICKS: float = 2.0 * TICK_SIZE

# ── VWAP zone proximity threshold ──────────────────────────────────────────

_VWAP_AT_TICKS: float = 1.0 * TICK_SIZE


# ── Internal helpers ────────────────────────────────────────────────────────


def _classify_vwap_zone(
    price_to_vwap: float,
    price_to_upper: float,
    price_to_lower: float,
) -> _VwapZone:
    """Classify current price into a VWAP envelope zone.

    Parameters
    ----------
    price_to_vwap:
        Signed distance from price to VWAP (positive = price above VWAP).
    price_to_upper:
        Signed distance from price to VWAP upper band (positive = above upper).
    price_to_lower:
        Signed distance from price to VWAP lower band (positive = above lower).
    """
    if abs(price_to_vwap) <= _VWAP_AT_TICKS:
        return _VwapZone.AT_VWAP
    if price_to_upper > 0.0:
        return _VwapZone.ABOVE_UPPER
    if price_to_vwap > 0.0:
        return _VwapZone.VWAP_TO_UPPER
    if price_to_lower < 0.0:
        return _VwapZone.BELOW_LOWER
    return _VwapZone.LOWER_TO_VWAP


def _classify_band_direction(
    curr_upper: float,
    curr_lower: float,
    prev_upper: float,
    prev_lower: float,
) -> _BandDirection:
    """Classify VWAP band width change as expanding, stable, or contracting.

    Parameters
    ----------
    curr_upper, curr_lower:
        Current tick VWAP upper and lower band values.
    prev_upper, prev_lower:
        Previous tick VWAP upper and lower band values.
    """
    curr_width = curr_upper - curr_lower
    prev_width = prev_upper - prev_lower
    delta = curr_width - prev_width

    if delta > _DRIFT_THRESHOLD:
        return _BandDirection.EXPANDING
    if delta < -_DRIFT_THRESHOLD:
        return _BandDirection.CONTRACTING
    return _BandDirection.STABLE


def _evaluate_vwap_conditions(
    benchmarks: np.ndarray,
    prev_benchmarks: np.ndarray,
    distances: np.ndarray,
) -> float:
    """Evaluate VWAP family conditions and return sub-signal in [-1, +1].

    Uses the signed distance from price to VWAP, upper, and lower bands to
    classify the price zone, then compares current and previous band widths
    to determine band direction.  Looks up the condition table for the
    directional output.

    Parameters
    ----------
    benchmarks:
        Current tick benchmark values, shape (15,).
    prev_benchmarks:
        Previous tick benchmark values, shape (15,).
    distances:
        Normalized signed distances from price to each benchmark, shape (210,).
        The first 15 elements correspond to the raw benchmark distances at
        index ``bench_idx * 14 + 0`` stride, but for this signal we only need
        the direct benchmark-to-price relationship.  We approximate using the
        benchmark values directly and the VWAP value as price proxy.
    """
    # Price-to-benchmark signed distances.
    # distances array layout: pairwise (15 choose 2 = 105) or (15*14 = 210).
    # For the VWAP family we use benchmark values directly.
    # Price ~ VWAP + distance_to_vwap.  Since we know VWAP and the band values,
    # we can derive price position from benchmark-to-benchmark relationships.
    vwap = benchmarks[BENCH_VWAP]
    upper = benchmarks[BENCH_VWAP_UPPER]
    lower = benchmarks[BENCH_VWAP_LOWER]

    prev_upper = prev_benchmarks[BENCH_VWAP_UPPER]
    prev_lower = prev_benchmarks[BENCH_VWAP_LOWER]

    # Estimate price from distance array: distance[BENCH_VWAP] is the raw
    # signed price-to-VWAP distance in price units (e.g. -2.50 means price
    # is 2.50 below VWAP).  A positive distance means price > VWAP.
    dist_to_vwap = float(distances[BENCH_VWAP]) if distances.shape[0] > BENCH_VWAP else 0.0

    # Reconstruct approximate price for zone classification.
    price_approx = vwap + dist_to_vwap

    price_to_vwap = price_approx - vwap
    price_to_upper = price_approx - upper
    price_to_lower = price_approx - lower

    zone = _classify_vwap_zone(price_to_vwap, price_to_upper, price_to_lower)
    direction = _classify_band_direction(upper, lower, prev_upper, prev_lower)

    return float(_VWAP_TABLE[int(zone), int(direction)])


def _classify_vpoc_zone(
    price_approx: float,
    vpoc: float,
    vah: float,
    val: float,
) -> int:
    """Classify price position relative to VPOC / value area.

    Returns row index into _VPOC_TABLE:
        0 = above VAH, 1 = VAH to VPOC, 2 = at VPOC,
        3 = VPOC to VAL, 4 = below VAL.
    """
    if abs(price_approx - vpoc) <= _VWAP_AT_TICKS:
        return 2  # AT_VPOC
    if price_approx > vah:
        return 0  # ABOVE_VAH
    if price_approx > vpoc:
        return 1  # VAH_TO_VPOC
    if price_approx < val:
        return 4  # BELOW_VAL
    return 3  # VPOC_TO_VAL


def _classify_vpoc_drift(
    vpoc: float,
    prev_vpoc: float,
) -> int:
    """Classify VPOC drift direction.

    Returns column index into _VPOC_TABLE:
        0 = drifting up, 1 = flat, 2 = drifting down.
    """
    delta = vpoc - prev_vpoc
    if delta > _DRIFT_THRESHOLD:
        return 0  # DRIFT_UP
    if delta < -_DRIFT_THRESHOLD:
        return 2  # DRIFT_DOWN
    return 1  # FLAT


def _evaluate_vpoc_conditions(
    benchmarks: np.ndarray,
    prev_benchmarks: np.ndarray,
    distances: np.ndarray,
) -> float:
    """Evaluate VPOC / value area conditions and return sub-signal in [-1, +1].

    Considers price position relative to VPOC, VAH, VAL and the tick-over-tick
    drift of VPOC itself to determine directional bias.

    Parameters
    ----------
    benchmarks:
        Current tick benchmark values, shape (15,).
    prev_benchmarks:
        Previous tick benchmark values, shape (15,).
    distances:
        Normalized signed distances, shape (210,).
    """
    vpoc = benchmarks[BENCH_VPOC]
    vah = benchmarks[BENCH_VAH]
    val = benchmarks[BENCH_VAL]
    vwap = benchmarks[BENCH_VWAP]
    upper = benchmarks[BENCH_VWAP_UPPER]
    lower = benchmarks[BENCH_VWAP_LOWER]

    prev_vpoc = prev_benchmarks[BENCH_VPOC]

    # Reconstruct approximate price (same method as VWAP evaluator).
    dist_to_vwap = float(distances[BENCH_VWAP]) if distances.shape[0] > BENCH_VWAP else 0.0
    price_approx = vwap + dist_to_vwap

    zone_row = _classify_vpoc_zone(price_approx, vpoc, vah, val)
    drift_col = _classify_vpoc_drift(vpoc, prev_vpoc)

    return float(_VPOC_TABLE[zone_row, drift_col])


def _classify_twap_zone(deviation: float) -> int:
    """Classify price deviation from TWAP into a zone.

    Returns row index into _TWAP_TABLE:
        0 = far above, 1 = above, 2 = at TWAP, 3 = below, 4 = far below.
    """
    if abs(deviation) <= _TWAP_NEAR_TICKS:
        return 2  # AT_TWAP
    if deviation > _TWAP_FAR_TICKS:
        return 0  # FAR_ABOVE
    if deviation > 0.0:
        return 1  # ABOVE
    if deviation < -_TWAP_FAR_TICKS:
        return 4  # FAR_BELOW
    return 3  # BELOW


def _classify_twap_momentum(twap: float, prev_twap: float) -> int:
    """Classify TWAP momentum direction.

    Returns column index into _TWAP_TABLE:
        0 = momentum up, 1 = flat, 2 = momentum down.
    """
    delta = twap - prev_twap
    if delta > _DRIFT_THRESHOLD:
        return 0  # MOM_UP
    if delta < -_DRIFT_THRESHOLD:
        return 2  # MOM_DOWN
    return 1  # FLAT


def _evaluate_twap_conditions(
    benchmarks: np.ndarray,
    prev_benchmarks: np.ndarray,
    distances: np.ndarray,
) -> float:
    """Evaluate TWAP conditions and return sub-signal in [-1, +1].

    Measures price deviation from TWAP and TWAP's own momentum direction
    to determine directional bias.

    Parameters
    ----------
    benchmarks:
        Current tick benchmark values, shape (15,).
    prev_benchmarks:
        Previous tick benchmark values, shape (15,).
    distances:
        Normalized signed distances, shape (210,).
    """
    twap = benchmarks[BENCH_TWAP]
    prev_twap = prev_benchmarks[BENCH_TWAP]
    vwap = benchmarks[BENCH_VWAP]
    upper = benchmarks[BENCH_VWAP_UPPER]
    lower = benchmarks[BENCH_VWAP_LOWER]

    # Reconstruct approximate price.
    dist_to_vwap = float(distances[BENCH_VWAP]) if distances.shape[0] > BENCH_VWAP else 0.0
    price_approx = vwap + dist_to_vwap

    deviation = price_approx - twap
    zone_row = _classify_twap_zone(deviation)
    mom_col = _classify_twap_momentum(twap, prev_twap)

    return float(_TWAP_TABLE[zone_row, mom_col])


# ── Public API ──────────────────────────────────────────────────────────────


def compute_band_direction(
    benchmarks: np.ndarray,
    prev_benchmarks: np.ndarray | None,
    distances: np.ndarray,
) -> float:
    """Compute S_band_direction from benchmark values and distances.

    Weighted combination of VWAP band direction, VPOC drift/position, and
    TWAP deviation/momentum sub-signals.

    Parameters
    ----------
    benchmarks:
        Current tick benchmark values, shape (15,).  Raw price levels for
        each benchmark (PDH, PDL, ..., TWAP).
    prev_benchmarks:
        Previous tick benchmark values, shape (15,).  ``None`` on the first
        tick, in which case the function returns 0.0 (no direction can be
        inferred without a prior reference).
    distances:
        Normalized signed distances array, shape (210,).  Contains pairwise
        and price-to-benchmark distance information.  The first 15 elements
        at stride positions are used to approximate price position.

    Returns
    -------
    float
        Directional signal in [-1, +1].  Positive = bullish band direction
        (expanding bands with price above key levels, VPOC drifting up,
        positive TWAP momentum).  Negative = bearish.
    """
    if prev_benchmarks is None:
        return 0.0

    if benchmarks.shape[0] != BENCHMARKS:
        raise ValueError(
            f"benchmarks must have shape ({BENCHMARKS},), got {benchmarks.shape}"
        )
    if prev_benchmarks.shape[0] != BENCHMARKS:
        raise ValueError(
            f"prev_benchmarks must have shape ({BENCHMARKS},), got {prev_benchmarks.shape}"
        )

    vwap_signal = _evaluate_vwap_conditions(benchmarks, prev_benchmarks, distances)
    vpoc_signal = _evaluate_vpoc_conditions(benchmarks, prev_benchmarks, distances)
    twap_signal = _evaluate_twap_conditions(benchmarks, prev_benchmarks, distances)

    composite = W_VWAP * vwap_signal + W_VPOC * vpoc_signal + W_TWAP * twap_signal
    return float(np.clip(composite, -1.0, 1.0))
