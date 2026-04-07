"""Tests for compute_momentum: rate-of-change momentum + Bollinger band signal."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.signals.momentum import compute_momentum
from tensionflow.config import BENCHMARKS, BENCH_VWAP, BENCH_TWAP, BENCH_VPOC


def _dist(value: float = 0.0) -> np.ndarray:
    return np.full(BENCHMARKS, value, dtype=np.float32)


def test_no_previous_returns_zero():
    curr = _dist(0.5)
    result = compute_momentum(curr, None, 1.0)
    assert result == 0.0


def test_static_distances_zero_core():
    # No change in distances → core = mean(delta) = 0
    curr = _dist(0.5)
    prev = _dist(0.5)
    # spread_tension = 1.0 → band_state = clip(1 - 1, -1, 1) = 0
    result = compute_momentum(curr, prev, 1.0)
    assert result == pytest.approx(0.0, abs=1e-5)


def test_rising_distances_positive_signal():
    # curr distances > prev for anchor benchmarks → positive core momentum
    prev = _dist(0.0)
    curr = prev.copy()
    curr[BENCH_VWAP] = 0.3
    curr[BENCH_TWAP] = 0.3
    curr[BENCH_VPOC] = 0.3
    result = compute_momentum(curr, prev, 1.0)
    assert result > 0.0


def test_falling_distances_negative_signal():
    prev = _dist(0.3)
    curr = prev.copy()
    curr[BENCH_VWAP] = 0.0
    curr[BENCH_TWAP] = 0.0
    curr[BENCH_VPOC] = 0.0
    result = compute_momentum(curr, prev, 1.0)
    assert result < 0.0


def test_band_expansion_adds_positive_bias():
    # spread_tension > 1.0 → band_state > 0 → positive contribution even with zero core
    curr = _dist(0.5)
    prev = _dist(0.5)
    result_neutral = compute_momentum(curr, prev, 1.0)
    result_expanding = compute_momentum(curr, prev, 2.0)
    assert result_expanding > result_neutral


def test_band_contraction_subtracts():
    curr = _dist(0.5)
    prev = _dist(0.5)
    result_neutral = compute_momentum(curr, prev, 1.0)
    result_contracting = compute_momentum(curr, prev, 0.0)
    assert result_contracting < result_neutral


def test_output_clipped_to_plus_one():
    prev = _dist(-1.0)
    curr = _dist(1.0)
    result = compute_momentum(curr, prev, 3.0)  # max spread too
    assert result <= 1.0


def test_output_clipped_to_minus_one():
    prev = _dist(1.0)
    curr = _dist(-1.0)
    result = compute_momentum(curr, prev, 0.0)
    assert result >= -1.0


def test_returns_float():
    result = compute_momentum(_dist(0.1), _dist(0.0), 1.0)
    assert isinstance(result, float)


def test_wrong_shape_raises():
    bad = np.zeros(5, dtype=np.float32)
    with pytest.raises(ValueError):
        compute_momentum(bad, _dist(0.0), 1.0)


def test_wrong_prev_shape_raises():
    bad = np.zeros(5, dtype=np.float32)
    with pytest.raises(ValueError):
        compute_momentum(_dist(0.0), bad, 1.0)


def test_output_bounded_random_inputs():
    rng = np.random.default_rng(77)
    for _ in range(30):
        curr = rng.uniform(-1, 1, BENCHMARKS).astype(np.float32)
        prev = rng.uniform(-1, 1, BENCHMARKS).astype(np.float32)
        st = float(rng.uniform(0, 3))
        result = compute_momentum(curr, prev, st)
        assert -1.0 <= result <= 1.0
