"""Tests for compute_band_direction: VWAP/VPOC/TWAP band direction signal."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.config import (
    BENCH_TWAP,
    BENCH_VAH,
    BENCH_VAL,
    BENCH_VPOC,
    BENCH_VWAP,
    BENCH_VWAP_LOWER,
    BENCH_VWAP_UPPER,
    BENCHMARKS,
)
from tensionflow.signals.band_direction import compute_band_direction

# ── Helpers ─────────────────────────────────────────────────────────────────

_DISTANCES_LEN: int = 210


def _bench(
    vwap: float = 5000.0,
    upper: float = 5010.0,
    lower: float = 4990.0,
    vpoc: float = 5002.0,
    vah: float = 5008.0,
    val: float = 4992.0,
    twap: float = 5001.0,
) -> np.ndarray:
    """Build a benchmark array with sensible defaults for MNQ-like prices."""
    b = np.zeros(BENCHMARKS, dtype=np.float64)
    b[0] = 5050.0   # PDH
    b[1] = 4950.0   # PDL
    b[2] = 4960.0   # PDS
    b[3] = 5000.0   # PDC
    b[4] = 5020.0   # DH
    b[5] = 4980.0   # DL
    b[BENCH_VPOC] = vpoc
    b[BENCH_VAH] = vah
    b[BENCH_VAL] = val
    b[BENCH_VWAP] = vwap
    b[10] = upper + 5.0  # VWAP upper perm
    b[11] = lower - 5.0  # VWAP lower perm
    b[BENCH_VWAP_UPPER] = upper
    b[BENCH_VWAP_LOWER] = lower
    b[BENCH_TWAP] = twap
    return b


def _dist(vwap_dist: float = 0.0) -> np.ndarray:
    """Build a distances array with a specific VWAP distance.

    The VWAP distance (index BENCH_VWAP=9) is a raw price offset:
    price_approx = VWAP + vwap_dist.  Use values in price units
    (e.g. 15.0 to place price 15 points above VWAP).
    """
    d = np.zeros(_DISTANCES_LEN, dtype=np.float32)
    d[BENCH_VWAP] = vwap_dist
    return d


# ── Core behavior ───────────────────────────────────────────────────────────


def test_no_previous_returns_zero():
    """First tick: no previous benchmarks available, return neutral."""
    result = compute_band_direction(_bench(), None, _dist())
    assert result == 0.0


def test_returns_float():
    result = compute_band_direction(_bench(), _bench(), _dist())
    assert isinstance(result, float)


def test_output_bounded_to_plus_minus_one():
    """Output must always be in [-1, +1] for any input combination."""
    rng = np.random.default_rng(42)
    for _ in range(50):
        curr = rng.uniform(4900, 5100, BENCHMARKS).astype(np.float64)
        prev = rng.uniform(4900, 5100, BENCHMARKS).astype(np.float64)
        dists = rng.uniform(-2.0, 2.0, _DISTANCES_LEN).astype(np.float32)
        result = compute_band_direction(curr, prev, dists)
        assert -1.0 <= result <= 1.0


# ── VWAP sub-signal directional tests ──────────────────────────────────────


def test_price_above_vwap_expanding_bands_positive():
    """Price above upper VWAP band + expanding bands -> bullish signal."""
    # Current: wider bands than previous
    curr = _bench(vwap=5000.0, upper=5012.0, lower=4988.0)
    prev = _bench(vwap=5000.0, upper=5008.0, lower=4992.0)
    # Raw price offset: price = 5000 + 15 = 5015, above upper band (5012)
    dists = _dist(vwap_dist=15.0)
    result = compute_band_direction(curr, prev, dists)
    assert result > 0.0


def test_price_below_vwap_contracting_bands_negative():
    """Price below lower VWAP band + contracting bands -> bearish signal."""
    # Current: narrower bands than previous
    curr = _bench(vwap=5000.0, upper=5006.0, lower=4994.0)
    prev = _bench(vwap=5000.0, upper=5010.0, lower=4990.0)
    # Raw price offset: price = 5000 - 15 = 4985, below lower band (4994)
    dists = _dist(vwap_dist=-15.0)
    result = compute_band_direction(curr, prev, dists)
    assert result < 0.0


def test_price_at_vwap_returns_near_zero():
    """Price right at VWAP with stable bands -> signal near zero."""
    curr = _bench(vwap=5000.0, upper=5010.0, lower=4990.0)
    prev = _bench(vwap=5000.0, upper=5010.0, lower=4990.0)
    dists = _dist(vwap_dist=0.0)
    result = compute_band_direction(curr, prev, dists)
    assert abs(result) < 0.15


# ── VPOC sub-signal tests ──────────────────────────────────────────────────


def test_vpoc_drifting_up_price_above_bullish():
    """VPOC drifting upward + price above VAH -> bullish component."""
    curr = _bench(vpoc=5005.0, vah=5008.0, val=4992.0)
    prev = _bench(vpoc=5000.0, vah=5008.0, val=4992.0)
    # Raw price offset: price = 5000 + 12 = 5012, above VAH (5008)
    dists = _dist(vwap_dist=12.0)
    result = compute_band_direction(curr, prev, dists)
    assert result > 0.0


def test_vpoc_drifting_down_price_below_bearish():
    """VPOC drifting downward + price below VAL -> bearish component."""
    curr = _bench(vpoc=4995.0, vah=5008.0, val=4992.0)
    prev = _bench(vpoc=5002.0, vah=5008.0, val=4992.0)
    # Raw price offset: price = 5000 - 12 = 4988, below VAL (4992)
    dists = _dist(vwap_dist=-12.0)
    result = compute_band_direction(curr, prev, dists)
    assert result < 0.0


# ── TWAP sub-signal tests ──────────────────────────────────────────────────


def test_twap_positive_momentum_price_above_bullish():
    """TWAP momentum up + price above TWAP -> bullish component."""
    curr = _bench(twap=5003.0)
    prev = _bench(twap=5000.0)
    # Raw price offset: price = 5000 + 10 = 5010, above TWAP (5003)
    dists = _dist(vwap_dist=10.0)
    result = compute_band_direction(curr, prev, dists)
    assert result > 0.0


def test_twap_negative_momentum_price_below_bearish():
    """TWAP momentum down + price below TWAP -> bearish component."""
    curr = _bench(twap=4997.0)
    prev = _bench(twap=5001.0)
    # Raw price offset: price = 5000 - 10 = 4990, below TWAP (4997)
    dists = _dist(vwap_dist=-10.0)
    result = compute_band_direction(curr, prev, dists)
    assert result < 0.0


# ── Edge cases ──────────────────────────────────────────────────────────────


def test_zero_distances_no_crash():
    """All-zero distance array should not raise."""
    curr = _bench()
    prev = _bench()
    dists = np.zeros(_DISTANCES_LEN, dtype=np.float32)
    result = compute_band_direction(curr, prev, dists)
    assert -1.0 <= result <= 1.0


def test_identical_benchmarks_near_zero():
    """Identical current and previous benchmarks: no drift, signal near zero."""
    curr = _bench()
    prev = _bench()
    dists = _dist(vwap_dist=0.0)
    result = compute_band_direction(curr, prev, dists)
    assert abs(result) < 0.15


def test_wrong_benchmark_shape_raises():
    bad = np.zeros(10, dtype=np.float64)
    with pytest.raises(ValueError):
        compute_band_direction(bad, _bench(), _dist())


def test_wrong_prev_benchmark_shape_raises():
    bad = np.zeros(5, dtype=np.float64)
    with pytest.raises(ValueError):
        compute_band_direction(_bench(), bad, _dist())


def test_extreme_distance_values_still_bounded():
    """Extreme distance values should still produce output in [-1, +1]."""
    curr = _bench()
    prev = _bench()
    dists = np.full(_DISTANCES_LEN, 100.0, dtype=np.float32)
    result = compute_band_direction(curr, prev, dists)
    assert -1.0 <= result <= 1.0


def test_all_benchmarks_zero_no_crash():
    """Zero benchmarks (not yet established) should not raise."""
    curr = np.zeros(BENCHMARKS, dtype=np.float64)
    prev = np.zeros(BENCHMARKS, dtype=np.float64)
    dists = np.zeros(_DISTANCES_LEN, dtype=np.float32)
    result = compute_band_direction(curr, prev, dists)
    assert -1.0 <= result <= 1.0


def test_symmetry_opposite_distances():
    """Opposite distance signs should produce opposite-sign signals."""
    curr = _bench(vwap=5000.0, upper=5012.0, lower=4988.0)
    prev = _bench(vwap=5000.0, upper=5008.0, lower=4992.0)
    result_bull = compute_band_direction(curr, prev, _dist(vwap_dist=15.0))
    result_bear = compute_band_direction(curr, prev, _dist(vwap_dist=-15.0))
    # Bullish should be greater than bearish
    assert result_bull > result_bear
