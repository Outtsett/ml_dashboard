"""Tests for compute_structure: structural benchmark confluence signal."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.signals.structure import compute_structure
from tensionflow.config import BENCHMARKS, DISTANCES, TICK_SIZE


def _bench(value: float = 0.0) -> np.ndarray:
    return np.full(BENCHMARKS, value, dtype=np.float32)


def _dist(value: float = 0.0) -> np.ndarray:
    return np.full(DISTANCES, value, dtype=np.float32)


def _make(bench_val: float = 0.0, pair_val: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """Build aligned benchmark and distance arrays."""
    benchmarks = np.full(BENCHMARKS, bench_val, dtype=np.float32)
    distances = np.full(DISTANCES, pair_val, dtype=np.float32)
    distances[:BENCHMARKS] = bench_val
    return benchmarks, distances


def test_output_bounded_random_inputs():
    rng = np.random.default_rng(42)
    for _ in range(50):
        b = rng.uniform(-10.0, 10.0, BENCHMARKS).astype(np.float32)
        d = rng.uniform(-10.0, 10.0, DISTANCES).astype(np.float32)
        d[:BENCHMARKS] = b
        result = compute_structure(b, d)
        assert -1.0 <= result <= 1.0


def test_positive_signal_price_above_cluster():
    # All benchmarks slightly below price (positive distance, within 4 ticks).
    bench_val = TICK_SIZE * 2.0  # +0.5 ticks in raw price terms
    benchmarks, distances = _make(bench_val, 0.0)
    result = compute_structure(benchmarks, distances)
    assert result > 0.0


def test_negative_signal_price_below_cluster():
    # All benchmarks slightly above price (negative distance, within 4 ticks).
    bench_val = -TICK_SIZE * 2.0
    benchmarks, distances = _make(bench_val, 0.0)
    result = compute_structure(benchmarks, distances)
    assert result < 0.0


def test_near_zero_when_no_benchmarks_nearby():
    # All benchmarks far away — cluster_strength = 0 → signal ≈ 0.
    bench_val = TICK_SIZE * 100.0  # way beyond 4-tick threshold
    benchmarks, distances = _make(bench_val, 0.0)
    result = compute_structure(benchmarks, distances)
    assert result == pytest.approx(0.0, abs=1e-6)


def test_handles_zero_distances():
    # All zeros: benchmarks at price, pairs at zero.
    benchmarks, distances = _make(0.0, 0.0)
    result = compute_structure(benchmarks, distances)
    # directional = mean([0,...]) / threshold = 0, so signal = 0
    assert result == pytest.approx(0.0, abs=1e-6)


def test_returns_float():
    benchmarks, distances = _make(0.0, 0.0)
    result = compute_structure(benchmarks, distances)
    assert isinstance(result, float)


def test_wrong_benchmark_shape_raises():
    bad = np.zeros(5, dtype=np.float32)
    with pytest.raises(ValueError):
        compute_structure(bad, _dist(0.0))


def test_wrong_distances_shape_raises():
    bad = np.zeros(50, dtype=np.float32)
    with pytest.raises(ValueError):
        compute_structure(_bench(0.0), bad)


def test_cluster_strength_saturates():
    # With all 15 benchmarks nearby, cluster_strength = min(15/4, 1) = 1.0.
    # Signal = directional * (0.5 + 0.5*1.0) = directional * 1.0
    bench_val = TICK_SIZE * 1.0  # 1 tick away — well within threshold
    benchmarks, distances = _make(bench_val, 0.0)
    result = compute_structure(benchmarks, distances)
    # directional = clip(0.25 / 1.0, -1, 1) = 0.25
    expected = 0.25 * (0.5 + 0.5 * 1.0)  # 0.25
    assert result == pytest.approx(expected, abs=1e-5)


def test_partial_cluster_scales_signal():
    # Only 2 of 15 benchmarks nearby (cluster_strength = 2/4 = 0.5).
    benchmarks = np.full(BENCHMARKS, TICK_SIZE * 100.0, dtype=np.float32)
    benchmarks[0] = TICK_SIZE * 2.0  # nearby, positive
    benchmarks[1] = TICK_SIZE * 2.0  # nearby, positive
    distances = np.full(DISTANCES, 0.0, dtype=np.float32)
    distances[:BENCHMARKS] = benchmarks
    result_partial = compute_structure(benchmarks, distances)

    # Compare with all 15 nearby (cluster_strength = 1.0)
    benchmarks_full = np.full(BENCHMARKS, TICK_SIZE * 2.0, dtype=np.float32)
    distances_full = np.full(DISTANCES, 0.0, dtype=np.float32)
    distances_full[:BENCHMARKS] = benchmarks_full
    result_full = compute_structure(benchmarks_full, distances_full)

    # Partial cluster yields a weaker (but still positive) signal.
    assert 0.0 < result_partial < result_full


def test_mixed_directions_cancel():
    # Half benchmarks above, half below — directional near zero.
    benchmarks = np.zeros(BENCHMARKS, dtype=np.float32)
    benchmarks[:7] = TICK_SIZE * 2.0   # positive (price above)
    benchmarks[7:14] = -TICK_SIZE * 2.0  # negative (price below)
    benchmarks[14] = 0.0  # neutral
    distances = np.full(DISTANCES, 0.0, dtype=np.float32)
    distances[:BENCHMARKS] = benchmarks
    result = compute_structure(benchmarks, distances)
    # Should be near zero since positive and negative roughly cancel.
    assert abs(result) < 0.2
