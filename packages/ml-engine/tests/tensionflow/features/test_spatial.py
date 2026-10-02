"""Tests for normalize_spatial: price-to-benchmark distance normalisation."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.config import BENCH_DH, BENCH_DL, BENCHMARKS, DISTANCES, TICK_SIZE
from tensionflow.features.spatial import normalize_spatial


def _make_benchmarks(dh: float = 20050.0, dl: float = 19950.0) -> np.ndarray:
    """Build a 15-element benchmark array with DH and DL set."""
    bench = np.zeros(BENCHMARKS, dtype=np.float64)
    bench[BENCH_DH] = dh
    bench[BENCH_DL] = dl
    return bench


def test_zero_distances_returns_zeros():
    distances = np.zeros(DISTANCES, dtype=np.float64)
    benchmarks = _make_benchmarks()
    result = normalize_spatial(distances, benchmarks)
    assert result.shape == (BENCHMARKS,)
    assert np.all(result == 0.0)


def test_output_shape():
    distances = np.ones(DISTANCES, dtype=np.float64)
    benchmarks = _make_benchmarks()
    result = normalize_spatial(distances, benchmarks)
    assert result.shape == (BENCHMARKS,)


def test_output_dtype_float32():
    distances = np.ones(DISTANCES, dtype=np.float64)
    benchmarks = _make_benchmarks()
    result = normalize_spatial(distances, benchmarks)
    assert result.dtype == np.float32


def test_positive_distances_clipped_to_one():
    # Distances that are many ATRs away should be clipped to +1
    distances = np.full(DISTANCES, 9999.0, dtype=np.float64)
    benchmarks = _make_benchmarks(dh=20100.0, dl=20000.0)  # ATR = 100
    result = normalize_spatial(distances, benchmarks)
    assert np.all(result[:BENCHMARKS] == pytest.approx(1.0, abs=1e-5))


def test_negative_distances_clipped_to_minus_one():
    distances = np.full(DISTANCES, -9999.0, dtype=np.float64)
    benchmarks = _make_benchmarks(dh=20100.0, dl=20000.0)
    result = normalize_spatial(distances, benchmarks)
    assert np.all(result[:BENCHMARKS] == pytest.approx(-1.0, abs=1e-5))


def test_output_bounded_minus_one_to_one():
    rng = np.random.default_rng(42)
    distances = rng.uniform(-500.0, 500.0, DISTANCES)
    benchmarks = _make_benchmarks()
    result = normalize_spatial(distances, benchmarks)
    assert np.all(result >= -1.0)
    assert np.all(result <= 1.0)


def test_atr_floor_when_dh_equals_dl():
    # When DH == DL, ATR = 0 → floored to TICK_SIZE
    distances = np.full(DISTANCES, TICK_SIZE * 3.0, dtype=np.float64)
    bench = np.zeros(BENCHMARKS, dtype=np.float64)
    bench[BENCH_DH] = 20000.0
    bench[BENCH_DL] = 20000.0  # DH == DL → ATR = 0 → floor to TICK_SIZE
    result = normalize_spatial(distances, bench)
    # distances / TICK_SIZE = 3.0 → clipped to 3 → rescaled to 3/3 = 1.0
    assert np.all(result[:BENCHMARKS] == pytest.approx(1.0, abs=1e-5))


def test_half_atr_distance_maps_to_one_sixth():
    # distance = ATR/2, 3 ATR clip, rescale by 3:
    # norm = (ATR/2) / ATR / 3 = 1/6 ≈ 0.1667
    atr = 100.0
    dh = 20100.0
    dl = dh - atr
    dist_val = atr / 2.0
    distances = np.full(DISTANCES, dist_val, dtype=np.float64)
    benchmarks = _make_benchmarks(dh=dh, dl=dl)
    result = normalize_spatial(distances, benchmarks)
    expected = (dist_val / atr) / 3.0  # = 1/6
    assert np.all(result[:BENCHMARKS] == pytest.approx(expected, abs=1e-5))


def test_raises_on_short_distances():
    distances = np.zeros(10, dtype=np.float64)  # < 15
    benchmarks = _make_benchmarks()
    with pytest.raises(ValueError):
        normalize_spatial(distances, benchmarks)


def test_raises_on_short_benchmarks():
    distances = np.zeros(DISTANCES, dtype=np.float64)
    benchmarks = np.zeros(3, dtype=np.float64)  # too short
    with pytest.raises(ValueError):
        normalize_spatial(distances, benchmarks)
