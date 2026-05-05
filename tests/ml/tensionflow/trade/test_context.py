"""Tests for classify_context: structural market context classification."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.trade.context import (
    classify_context,
    AT_EXTREME,
    AT_VALUE_EDGE,
    AT_VWAP,
    AT_NEUTRAL,
)
from tensionflow.config import (
    BENCHMARKS,
    DISTANCES,
    TICK_SIZE,
    BENCH_VWAP,
    BENCH_VAH,
    BENCH_VAL,
    BENCH_VWAP_UPPER,
    BENCH_VWAP_LOWER,
    CONTEXT_AT_THRESHOLD_TICKS,
    CONTEXT_EXTREME_THRESHOLD_TICKS,
)


def _make_inputs(distances_15: np.ndarray | None = None) -> tuple:
    benchmarks = np.zeros(BENCHMARKS, dtype=np.float64)
    distances = np.zeros(DISTANCES, dtype=np.float64)
    if distances_15 is not None:
        distances[:15] = distances_15
    return benchmarks, distances


def test_neutral_when_far_from_all():
    # All distances are large → AT_NEUTRAL
    benchmarks, distances = _make_inputs()
    distances[:15] = 100.0  # many ticks away from everything
    result = classify_context(benchmarks, distances)
    assert result == AT_NEUTRAL


def test_at_vwap_within_two_ticks():
    benchmarks, distances = _make_inputs()
    # BENCH_VWAP = 9; set its distance to within 2 ticks
    distances[BENCH_VWAP] = TICK_SIZE * CONTEXT_AT_THRESHOLD_TICKS
    # All others far away
    distances[:BENCH_VWAP] = 100.0
    distances[BENCH_VWAP + 1:15] = 100.0
    result = classify_context(benchmarks, distances)
    assert result == AT_VWAP


def test_at_value_edge_vah():
    benchmarks, distances = _make_inputs()
    distances[:15] = 100.0
    # VAH = index 7; within 2 ticks
    distances[BENCH_VAH] = TICK_SIZE * CONTEXT_AT_THRESHOLD_TICKS
    result = classify_context(benchmarks, distances)
    assert result == AT_VALUE_EDGE


def test_at_value_edge_val():
    benchmarks, distances = _make_inputs()
    distances[:15] = 100.0
    distances[BENCH_VAL] = TICK_SIZE * CONTEXT_AT_THRESHOLD_TICKS
    result = classify_context(benchmarks, distances)
    assert result == AT_VALUE_EDGE


def test_at_extreme_vwap_upper():
    benchmarks, distances = _make_inputs()
    distances[:15] = 100.0
    distances[BENCH_VWAP_UPPER] = TICK_SIZE * CONTEXT_EXTREME_THRESHOLD_TICKS
    result = classify_context(benchmarks, distances)
    assert result == AT_EXTREME


def test_at_extreme_vwap_lower():
    benchmarks, distances = _make_inputs()
    distances[:15] = 100.0
    distances[BENCH_VWAP_LOWER] = TICK_SIZE * CONTEXT_EXTREME_THRESHOLD_TICKS
    result = classify_context(benchmarks, distances)
    assert result == AT_EXTREME


def test_extreme_takes_priority_over_value_edge():
    benchmarks, distances = _make_inputs()
    # Both VWAP_UPPER (extreme) and VAH (value_edge) within threshold
    distances[:15] = 100.0
    distances[BENCH_VWAP_UPPER] = TICK_SIZE  # close to extreme
    distances[BENCH_VAH] = TICK_SIZE          # also close to value edge
    result = classify_context(benchmarks, distances)
    assert result == AT_EXTREME


def test_value_edge_takes_priority_over_vwap():
    benchmarks, distances = _make_inputs()
    distances[:15] = 100.0
    distances[BENCH_VAH] = TICK_SIZE     # value edge
    distances[BENCH_VWAP] = TICK_SIZE   # also at VWAP
    result = classify_context(benchmarks, distances)
    assert result == AT_VALUE_EDGE


def test_raises_on_short_distances():
    benchmarks = np.zeros(BENCHMARKS, dtype=np.float64)
    short_dist = np.zeros(10, dtype=np.float64)
    with pytest.raises(ValueError):
        classify_context(benchmarks, short_dist)


def test_negative_distances_use_abs_for_ticks():
    # Distance can be negative (price below benchmark); abs is taken for tick calc
    benchmarks, distances = _make_inputs()
    distances[:15] = -100.0
    distances[BENCH_VWAP] = -TICK_SIZE  # |dist| = 0.25 ≤ 2 ticks
    distances[BENCH_VWAP_UPPER] = -100.0
    distances[BENCH_VWAP_LOWER] = -100.0
    distances[BENCH_VAH] = -100.0
    distances[BENCH_VAL] = -100.0
    result = classify_context(benchmarks, distances)
    assert result == AT_VWAP
