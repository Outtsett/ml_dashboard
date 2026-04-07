"""Tests for TensionHistory rolling window and adaptive thresholds."""

from __future__ import annotations

import math

import numpy as np

from tensionflow.state.history import TensionHistory
from tensionflow.config import TENSION_HISTORY_WINDOW, THRESHOLD_SIGMA_MULTIPLIER


def test_empty_history_mean_zero():
    h = TensionHistory()
    assert h.mean() == 0.0


def test_empty_history_std_zero():
    # std returns 0.0 when fewer than 2 samples
    h = TensionHistory()
    assert h.std() == 0.0


def test_empty_history_bullish_threshold_zero():
    # mean=0, std=0 → bullish = 0 + 1.2*0 = 0
    h = TensionHistory()
    assert h.bullish_threshold() == 0.0


def test_empty_history_bearish_threshold_zero():
    h = TensionHistory()
    assert h.bearish_threshold() == 0.0


def test_empty_len_zero():
    h = TensionHistory()
    assert len(h) == 0


def test_push_single_mean_equals_value():
    h = TensionHistory()
    h.push(5.0)
    assert h.mean() == 5.0


def test_push_single_std_zero():
    # Only 1 sample — std returns 0.0 (need ≥2)
    h = TensionHistory()
    h.push(5.0)
    assert h.std() == 0.0


def test_push_single_len_one():
    h = TensionHistory()
    h.push(3.7)
    assert len(h) == 1


def test_push_two_mean():
    h = TensionHistory()
    h.push(2.0)
    h.push(4.0)
    assert abs(h.mean() - 3.0) < 1e-9


def test_push_two_std():
    # population std of [2, 4]: mean=3, M2=(2-3)^2+(4-3)^2=2, var=1, std=1
    h = TensionHistory()
    h.push(2.0)
    h.push(4.0)
    assert abs(h.std() - 1.0) < 1e-9


def test_push_full_window_mean_matches_numpy():
    rng = np.random.default_rng(0)
    vals = rng.standard_normal(TENSION_HISTORY_WINDOW).tolist()
    h = TensionHistory()
    for v in vals:
        h.push(v)
    expected_mean = float(np.mean(vals))
    assert abs(h.mean() - expected_mean) < 1e-6


def test_push_full_window_std_matches_numpy():
    rng = np.random.default_rng(1)
    vals = rng.standard_normal(TENSION_HISTORY_WINDOW).tolist()
    h = TensionHistory()
    for v in vals:
        h.push(v)
    # population std (ddof=0)
    expected_std = float(np.std(vals))
    assert abs(h.std() - expected_std) < 1e-5


def test_push_beyond_window_evicts_oldest():
    h = TensionHistory(window=3)
    h.push(1.0)
    h.push(2.0)
    h.push(3.0)
    h.push(10.0)  # evicts 1.0; window should be [2, 3, 10]
    assert len(h) == 3
    expected_mean = (2.0 + 3.0 + 10.0) / 3.0
    assert abs(h.mean() - expected_mean) < 1e-9


def test_bullish_bearish_thresholds_symmetric_around_mean():
    h = TensionHistory()
    for v in [0.0, 0.2, -0.1, 0.3, -0.2]:
        h.push(v)
    mean = h.mean()
    std = h.std()
    assert abs(h.bullish_threshold() - (mean + THRESHOLD_SIGMA_MULTIPLIER * std)) < 1e-9
    assert abs(h.bearish_threshold() - (mean - THRESHOLD_SIGMA_MULTIPLIER * std)) < 1e-9


def test_bullish_threshold_exceeds_bearish():
    h = TensionHistory()
    for v in np.linspace(-1.0, 1.0, 20):
        h.push(float(v))
    assert h.bullish_threshold() >= h.bearish_threshold()


def test_known_sequence_thresholds():
    # Feed 10 identical values of 0.5: mean=0.5, std=0, thresholds both 0.5
    h = TensionHistory()
    for _ in range(10):
        h.push(0.5)
    assert abs(h.bullish_threshold() - 0.5) < 1e-9
    assert abs(h.bearish_threshold() - 0.5) < 1e-9


def test_known_sequence_spread():
    # Feed [0, 2]: mean=1, std=1, bullish=1+1.2=2.2, bearish=1-1.2=-0.2
    h = TensionHistory()
    h.push(0.0)
    h.push(2.0)
    assert abs(h.bullish_threshold() - (1.0 + THRESHOLD_SIGMA_MULTIPLIER * 1.0)) < 1e-9
    assert abs(h.bearish_threshold() - (1.0 - THRESHOLD_SIGMA_MULTIPLIER * 1.0)) < 1e-9
