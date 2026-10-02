"""Tests for compute_volume_profile: volume profile structure signal."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.config import (
    BENCH_DH,
    BENCH_DL,
    BENCH_VAH,
    BENCH_VAL,
    BENCH_VPOC,
    BENCHMARKS,
    TICK_SIZE,
)
from tensionflow.signals.volume_profile import compute_volume_profile


def _bench(
    vpoc: float = 20000.0,
    vah: float = 20010.0,
    val: float = 19990.0,
    dh: float = 20020.0,
    dl: float = 19980.0,
) -> np.ndarray:
    """Build a benchmark array with sensible defaults."""
    arr = np.zeros(BENCHMARKS, dtype=np.float32)
    arr[BENCH_VPOC] = vpoc
    arr[BENCH_VAH] = vah
    arr[BENCH_VAL] = val
    arr[BENCH_DH] = dh
    arr[BENCH_DL] = dl
    return arr


def _dist(vpoc_dist: float = 0.0) -> np.ndarray:
    """Build a distances array with only the VPOC distance set."""
    arr = np.zeros(BENCHMARKS, dtype=np.float32)
    arr[BENCH_VPOC] = vpoc_dist
    return arr


# ── Core behavior ───────────────────────────────────────────────────────────


def test_no_prev_benchmarks_returns_zero():
    result = compute_volume_profile(_bench(), None, _dist())
    assert result == 0.0


def test_returns_float():
    result = compute_volume_profile(_bench(), _bench(), _dist())
    assert isinstance(result, float)


def test_static_inputs_zero_signal():
    # Same benchmarks, price at VPOC, VA centered → all components ~0.
    # width_ratio = (vah-val)/atr = 20/40 = 0.5, so width_signal = (0.5-0.5)*2 = 0.
    bench = _bench()
    result = compute_volume_profile(bench, bench, _dist(0.0))
    assert result == pytest.approx(0.0, abs=1e-5)


# ── Boundedness ─────────────────────────────────────────────────────────────


def test_output_clipped_to_plus_one():
    # Extreme bullish: VPOC rising hard, price far above VPOC, wide VA.
    prev = _bench(vpoc=19990.0)
    curr = _bench(vpoc=20010.0, vah=20050.0, val=19970.0, dh=20060.0, dl=19960.0)
    dist = _dist(vpoc_dist=50.0)
    result = compute_volume_profile(curr, prev, dist)
    assert result <= 1.0


def test_output_clipped_to_minus_one():
    # Extreme bearish: VPOC falling hard, price far below VPOC, tight VA.
    prev = _bench(vpoc=20010.0)
    curr = _bench(vpoc=19990.0, vah=19991.0, val=19989.0, dh=20020.0, dl=19980.0)
    dist = _dist(vpoc_dist=-50.0)
    result = compute_volume_profile(curr, prev, dist)
    assert result >= -1.0


def test_output_bounded_random_inputs():
    rng = np.random.default_rng(42)
    for _ in range(50):
        bench = rng.uniform(19500, 20500, BENCHMARKS).astype(np.float32)
        prev = rng.uniform(19500, 20500, BENCHMARKS).astype(np.float32)
        # Ensure DH > DL so ATR is positive.
        bench[BENCH_DH] = max(bench[BENCH_DH], bench[BENCH_DL] + TICK_SIZE)
        prev[BENCH_DH] = max(prev[BENCH_DH], prev[BENCH_DL] + TICK_SIZE)
        dist = rng.uniform(-100, 100, BENCHMARKS).astype(np.float32)
        result = compute_volume_profile(bench, prev, dist)
        assert -1.0 <= result <= 1.0


# ── Directional tests ──────────────────────────────────────────────────────


def test_positive_signal_vpoc_up_price_above():
    # VPOC drifted up by 1 point (4 ticks) → drift_signal = clip(1.0/1.0) = 1.0
    # Price 10 ticks above VPOC → skew_signal = clip(2.5/40) ≈ 0.0625
    # VA width = 20/40 = 0.5, width_signal = 0.0
    prev = _bench(vpoc=20000.0)
    curr = _bench(vpoc=20001.0)
    dist = _dist(vpoc_dist=2.5)  # price above VPOC
    result = compute_volume_profile(curr, prev, dist)
    assert result > 0.0


def test_negative_signal_vpoc_down_price_below():
    # VPOC drifted down by 1 point → drift_signal = -1.0
    # Price below VPOC → skew negative.
    prev = _bench(vpoc=20001.0)
    curr = _bench(vpoc=20000.0)
    dist = _dist(vpoc_dist=-2.5)  # price below VPOC
    result = compute_volume_profile(curr, prev, dist)
    assert result < 0.0


# ── Width component ─────────────────────────────────────────────────────────


def test_wide_va_positive_width_signal():
    # Wide VA: (vah - val) = 60, atr = 40 → width_ratio = 1.5
    # width_signal = clip((1.5 - 0.5) * 2) = clip(2.0) = 1.0
    # With zero drift and zero skew: signal = 0.30 * 1.0 = 0.30.
    bench = _bench(vah=20030.0, val=19970.0)  # 60 wide, atr=40
    result = compute_volume_profile(bench, bench, _dist(0.0))
    assert result == pytest.approx(0.30, abs=1e-5)


def test_tight_va_negative_width_signal():
    # Tight VA: (vah - val) = 2, atr = 40 → width_ratio = 0.05
    # width_signal = clip((0.05 - 0.5) * 2) = clip(-0.9) = -0.9
    # With zero drift and zero skew: signal = 0.30 * -0.9 = -0.27.
    bench = _bench(vah=20001.0, val=19999.0)  # 2 wide, atr=40
    result = compute_volume_profile(bench, bench, _dist(0.0))
    assert result == pytest.approx(0.30 * -0.9, abs=1e-5)


# ── Input validation ───────────────────────────────────────────────────────


def test_wrong_benchmark_shape_raises():
    bad = np.zeros(5, dtype=np.float32)
    with pytest.raises(ValueError):
        compute_volume_profile(bad, _bench(), _dist())


def test_wrong_prev_benchmark_shape_raises():
    bad = np.zeros(5, dtype=np.float32)
    with pytest.raises(ValueError):
        compute_volume_profile(_bench(), bad, _dist())


def test_wrong_distances_shape_raises():
    bad = np.zeros(5, dtype=np.float32)
    with pytest.raises(ValueError):
        compute_volume_profile(_bench(), _bench(), bad)
