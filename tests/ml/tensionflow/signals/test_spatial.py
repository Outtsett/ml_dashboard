"""Tests for compute_spatial: weighted benchmark distance signal."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.signals.spatial import compute_spatial
from tensionflow.config import BENCHMARKS, SPATIAL_BENCHMARK_WEIGHTS


def _ones() -> np.ndarray:
    return np.ones(BENCHMARKS, dtype=np.float32)


def _zeros() -> np.ndarray:
    return np.zeros(BENCHMARKS, dtype=np.float32)


def test_all_positive_distances_positive_signal():
    # All benchmarks below price → positive directional signal
    result = compute_spatial(_ones())
    assert result > 0.0


def test_all_negative_distances_negative_signal():
    result = compute_spatial(-_ones())
    assert result < 0.0


def test_zero_distances_zero_signal():
    result = compute_spatial(_zeros())
    assert result == pytest.approx(0.0, abs=1e-6)


def test_output_clipped_to_plus_one():
    # Extreme positive distances → clipped to +1
    big = np.full(BENCHMARKS, 100.0, dtype=np.float32)
    result = compute_spatial(big)
    assert result == pytest.approx(1.0, abs=1e-6)


def test_output_clipped_to_minus_one():
    big = np.full(BENCHMARKS, -100.0, dtype=np.float32)
    result = compute_spatial(big)
    assert result == pytest.approx(-1.0, abs=1e-6)


def test_output_bounded_random_inputs():
    rng = np.random.default_rng(17)
    for _ in range(50):
        dist = rng.uniform(-2.0, 2.0, BENCHMARKS).astype(np.float32)
        result = compute_spatial(dist)
        assert -1.0 <= result <= 1.0


def test_returns_float():
    result = compute_spatial(_zeros())
    assert isinstance(result, float)


def test_wrong_shape_raises():
    bad = np.zeros(10, dtype=np.float32)
    with pytest.raises(ValueError):
        compute_spatial(bad)


def test_vwap_weight_dominates():
    # VWAP (index 9) has the highest weight (0.25).
    # Set only VWAP distance to positive — result should be positive.
    dist = np.zeros(BENCHMARKS, dtype=np.float32)
    dist[9] = 1.0  # BENCH_VWAP = 9
    result = compute_spatial(dist)
    assert result > 0.0


def test_known_value_single_weight():
    # Only index 0 (PDH, weight=0.04) is nonzero, distance=1.0.
    # After weight renorm: signal = weight_0 / sum_weights.
    weights_norm = SPATIAL_BENCHMARK_WEIGHTS / SPATIAL_BENCHMARK_WEIGHTS.sum()
    expected = float(weights_norm[0] * 1.0)
    dist = np.zeros(BENCHMARKS, dtype=np.float32)
    dist[0] = 1.0
    result = compute_spatial(dist)
    assert result == pytest.approx(expected, abs=1e-5)
