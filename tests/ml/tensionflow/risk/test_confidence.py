"""Tests for compute_confidence and passes_threshold."""

from __future__ import annotations

import pytest

from tensionflow.risk.confidence import compute_confidence, passes_threshold
from tensionflow.config import MIN_CONFIDENCE


def test_zero_inputs_zero_confidence():
    result = compute_confidence(0.0, 0.0, 0.0)
    assert result == pytest.approx(0.0, abs=1e-6)


def test_max_inputs_max_confidence():
    # |d_score|=1.0, |tension_delta|>=1.0, alignment=1.0
    # raw = 0.50 + 0.25 + 0.25 = 1.0
    result = compute_confidence(1.0, 1.0, 1.0)
    assert result == pytest.approx(1.0, abs=1e-6)


def test_max_dscore_no_tension_no_alignment():
    # |d_score|=1.0 -> raw = 0.50
    result = compute_confidence(1.0, 0.0, 0.0)
    assert result == pytest.approx(0.50, abs=1e-6)


def test_no_dscore_max_tension():
    # |tension_delta|>=1.0 -> raw = 0.25
    result = compute_confidence(0.0, 2.0, 0.0)
    assert result == pytest.approx(0.25, abs=1e-6)


def test_alignment_contributes():
    # alignment=1.0 -> raw = 0.25
    result = compute_confidence(0.0, 0.0, 1.0)
    assert result == pytest.approx(0.25, abs=1e-6)


def test_tension_capped_at_one():
    result_large = compute_confidence(0.0, 100.0, 0.0)
    result_one = compute_confidence(0.0, 1.0, 0.0)
    assert result_large == pytest.approx(result_one, abs=1e-6)


def test_negative_d_score_uses_abs():
    pos = compute_confidence(0.5, 0.0, 0.0)
    neg = compute_confidence(-0.5, 0.0, 0.0)
    assert pos == pytest.approx(neg, abs=1e-6)


def test_negative_tension_uses_abs():
    pos = compute_confidence(0.0, 0.5, 0.0)
    neg = compute_confidence(0.0, -0.5, 0.0)
    assert pos == pytest.approx(neg, abs=1e-6)


def test_output_clipped_to_one():
    result = compute_confidence(2.0, 10.0, 1.0)
    assert result <= 1.0


def test_output_nonnegative():
    result = compute_confidence(-5.0, -5.0, 0.0)
    assert result >= 0.0


def test_backward_compatible_without_alignment():
    # Default alignment=0.0
    result = compute_confidence(0.5, 0.5)
    assert isinstance(result, float)
    assert 0.0 <= result <= 1.0


def test_passes_threshold_above_min():
    assert passes_threshold(MIN_CONFIDENCE) is True
    assert passes_threshold(MIN_CONFIDENCE + 0.1) is True


def test_passes_threshold_below_min():
    assert passes_threshold(MIN_CONFIDENCE - 0.01) is False


def test_passes_threshold_zero():
    assert passes_threshold(0.0) is False


def test_returns_float():
    result = compute_confidence(0.5, 0.5, 0.5)
    assert isinstance(result, float)
