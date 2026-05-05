"""Tests for compute_stops: stop and target distance computation from benchmarks."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.risk.stops import compute_stops
from tensionflow.config import (
    BENCHMARKS,
    BENCH_VWAP,
    BENCH_VAH,
    BENCH_VAL,
    BENCH_DH,
    BENCH_DL,
    BENCH_VWAP_UPPER,
    BENCH_VWAP_LOWER,
    BENCH_PDH,
    BENCH_PDL,
    MIN_STOP_TICKS,
    TICK_SIZE,
)


def _make_benchmarks(vwap: float = 20000.0) -> np.ndarray:
    bench = np.zeros(BENCHMARKS, dtype=np.float64)
    bench[BENCH_VWAP] = vwap
    # Set structural levels around VWAP
    bench[BENCH_VAH] = vwap + 10.0    # 40 ticks above
    bench[BENCH_VAL] = vwap - 10.0    # 40 ticks below
    bench[BENCH_DH] = vwap + 20.0     # 80 ticks above
    bench[BENCH_DL] = vwap - 20.0     # 80 ticks below
    bench[BENCH_VWAP_UPPER] = vwap + 15.0
    bench[BENCH_VWAP_LOWER] = vwap - 15.0
    bench[BENCH_PDH] = vwap + 25.0
    bench[BENCH_PDL] = vwap - 25.0
    return bench


def test_signal_zero_returns_zero_zero():
    bench = _make_benchmarks()
    stop, target = compute_stops(signal=0, benchmarks=bench)
    assert stop == 0.0
    assert target == 0.0


def test_long_signal_returns_positive_values():
    bench = _make_benchmarks()
    stop, target = compute_stops(signal=1, benchmarks=bench)
    assert stop > 0.0
    assert target > 0.0


def test_short_signal_returns_positive_values():
    bench = _make_benchmarks()
    stop, target = compute_stops(signal=-1, benchmarks=bench)
    assert stop > 0.0
    assert target > 0.0


def test_stop_and_target_at_least_min_stop_ticks():
    bench = _make_benchmarks()
    stop, target = compute_stops(signal=1, benchmarks=bench)
    assert stop >= MIN_STOP_TICKS
    assert target >= MIN_STOP_TICKS


def test_strong_long_same_structure_as_weak_long():
    bench = _make_benchmarks()
    stop1, target1 = compute_stops(signal=1, benchmarks=bench)
    stop2, target2 = compute_stops(signal=2, benchmarks=bench)
    assert stop1 == pytest.approx(stop2, abs=1e-6)
    assert target1 == pytest.approx(target2, abs=1e-6)


def test_long_target_is_nearest_resistance():
    bench = _make_benchmarks(vwap=20000.0)
    # VAH=20010 is nearest resistance above VWAP
    stop, target = compute_stops(signal=1, benchmarks=bench)
    # Target should be VAH distance: (20010-20000)/0.25 = 40 ticks
    assert target == pytest.approx(40.0, abs=1e-4)


def test_wrong_benchmarks_shape_raises():
    bad = np.zeros(5, dtype=np.float64)
    with pytest.raises(ValueError):
        compute_stops(signal=1, benchmarks=bad)


def test_returns_tuple_of_floats():
    bench = _make_benchmarks()
    result = compute_stops(signal=1, benchmarks=bench)
    assert isinstance(result, tuple)
    assert len(result) == 2
    assert isinstance(result[0], float)
    assert isinstance(result[1], float)


def test_all_benchmarks_above_vwap_uses_min_stop_for_long_stop():
    # All candidate support levels are above VWAP → empty list → MIN_STOP_TICKS
    bench = np.zeros(BENCHMARKS, dtype=np.float64)
    vwap = 20000.0
    bench[BENCH_VWAP] = vwap
    # Set all candidates above VWAP (no support below)
    bench[BENCH_VAH] = vwap + 10
    bench[BENCH_VAL] = vwap + 5
    bench[BENCH_DH] = vwap + 20
    bench[BENCH_DL] = vwap + 15
    bench[BENCH_VWAP_UPPER] = vwap + 8
    bench[BENCH_VWAP_LOWER] = vwap + 3
    bench[BENCH_PDH] = vwap + 30
    bench[BENCH_PDL] = vwap + 25
    stop, target = compute_stops(signal=1, benchmarks=bench)
    # No support below VWAP → stop defaults to MIN_STOP_TICKS
    assert stop == pytest.approx(MIN_STOP_TICKS, abs=1e-6)
