"""Tests for compute_thresholds: adaptive flip threshold with cold-start guard."""

from __future__ import annotations

import pytest

from tensionflow.state.history import TensionHistory
from tensionflow.trade.threshold import compute_thresholds

_DEFAULT_BULLISH = 0.3
_DEFAULT_BEARISH = -0.3
_MIN_HISTORY_SIZE = 10


def test_cold_start_returns_default_bullish():
    h = TensionHistory()
    bullish, _ = compute_thresholds(h)
    assert bullish == _DEFAULT_BULLISH


def test_cold_start_returns_default_bearish():
    h = TensionHistory()
    _, bearish = compute_thresholds(h)
    assert bearish == _DEFAULT_BEARISH


def test_nine_samples_still_returns_defaults():
    h = TensionHistory()
    for i in range(9):
        h.push(float(i) * 0.1)
    bullish, bearish = compute_thresholds(h)
    assert bullish == _DEFAULT_BULLISH
    assert bearish == _DEFAULT_BEARISH


def test_ten_samples_switches_to_adaptive():
    h = TensionHistory()
    for i in range(10):
        h.push(float(i) * 0.1)
    bullish, bearish = compute_thresholds(h)
    # Should now use h.bullish_threshold() / h.bearish_threshold()
    assert bullish == pytest.approx(h.bullish_threshold(), abs=1e-9)
    assert bearish == pytest.approx(h.bearish_threshold(), abs=1e-9)


def test_adaptive_bullish_exceeds_adaptive_bearish():
    h = TensionHistory()
    for v in [0.1, -0.1, 0.2, -0.2, 0.15, -0.15, 0.05, -0.05, 0.12, 0.08]:
        h.push(v)
    bullish, bearish = compute_thresholds(h)
    assert bullish >= bearish


def test_returns_tuple_of_two_floats():
    h = TensionHistory()
    result = compute_thresholds(h)
    assert isinstance(result, tuple)
    assert len(result) == 2
    assert isinstance(result[0], float)
    assert isinstance(result[1], float)


def test_large_history_adaptive_values_differ_from_defaults():
    h = TensionHistory()
    # Feed values that push mean away from 0 so thresholds differ from ±0.3
    for _ in range(20):
        h.push(2.0)
    bullish, bearish = compute_thresholds(h)
    # Mean = 2.0, std = 0 → both thresholds at 2.0, definitely not ±0.3
    assert bullish != _DEFAULT_BULLISH
    assert bearish != _DEFAULT_BEARISH
