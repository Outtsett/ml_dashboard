"""Tests for confluence and alignment entry gates."""

from __future__ import annotations

import pytest

from tensionflow.trade.confluence import compute_confluence, compute_alignment


# ── compute_confluence ──────────────────────────────────────────────────────


def test_all_positive_confluence_equals_sum():
    result = compute_confluence(0.8, 0.6, 0.9, 0.7, 1.0)
    assert result == pytest.approx(0.8 + 0.6 + 0.9 + 0.7 + 1.0)


def test_all_negative_confluence_equals_sum_of_abs():
    result = compute_confluence(-0.8, -0.6, -0.9, -0.7, -1.0)
    assert result == pytest.approx(0.8 + 0.6 + 0.9 + 0.7 + 1.0)


def test_mixed_confluence_sum_majority_side_only():
    # 3 positive (0.8 + 0.6 + 0.9 = 2.3), 2 negative (0.4 + 0.3 = 0.7)
    # Majority is positive → confluence = 2.3
    result = compute_confluence(0.8, 0.6, 0.9, -0.4, -0.3)
    assert result == pytest.approx(2.3)


def test_mixed_confluence_negative_majority():
    # 2 positive (0.1 + 0.2 = 0.3), 3 negative (0.8 + 0.7 + 0.9 = 2.4)
    # Majority is negative → confluence = 2.4
    result = compute_confluence(0.1, -0.8, -0.7, 0.2, -0.9)
    assert result == pytest.approx(2.4)


def test_all_zero_confluence_is_zero():
    result = compute_confluence(0.0, 0.0, 0.0, 0.0, 0.0)
    assert result == pytest.approx(0.0)


def test_max_confluence_is_five():
    result = compute_confluence(1.0, 1.0, 1.0, 1.0, 1.0)
    assert result == pytest.approx(5.0)


def test_max_negative_confluence_is_five():
    result = compute_confluence(-1.0, -1.0, -1.0, -1.0, -1.0)
    assert result == pytest.approx(5.0)


def test_confluence_threshold_1_5_pass():
    # Strong agreement above 1.5 threshold
    result = compute_confluence(0.6, 0.5, 0.5, 0.0, 0.0)
    assert result >= 1.5


def test_confluence_threshold_1_5_fail():
    # Weak agreement below 1.5 threshold
    result = compute_confluence(0.3, 0.2, -0.8, -0.1, 0.0)
    assert result < 1.5 or result >= 1.5  # verify it computes; check actual
    # Negative side: 0.8 + 0.1 = 0.9; positive side: 0.3 + 0.2 = 0.5
    # Majority is negative → confluence = 0.9
    assert result == pytest.approx(0.9)
    assert result < 1.5


def test_confluence_tie_returns_positive_side():
    # Equal magnitude on both sides → pos_sum >= neg_sum returns pos_sum
    result = compute_confluence(0.5, -0.5, 0.0, 0.0, 0.0)
    assert result == pytest.approx(0.5)


# ── compute_alignment ──────────────────────────────────────────────────────


def test_all_positive_alignment_is_one():
    result = compute_alignment(0.8, 0.6, 0.9, 0.7, 1.0)
    assert result == pytest.approx(1.0)


def test_all_negative_alignment_is_one():
    result = compute_alignment(-0.8, -0.6, -0.9, -0.7, -1.0)
    assert result == pytest.approx(1.0)


def test_all_zero_alignment_is_zero():
    result = compute_alignment(0.0, 0.0, 0.0, 0.0, 0.0)
    assert result == pytest.approx(0.0)


def test_three_agree_two_disagree_alignment_0_6():
    # 3 positive, 2 negative → majority = 3 → alignment = 3/5 = 0.6
    result = compute_alignment(0.8, 0.6, 0.9, -0.4, -0.3)
    assert result == pytest.approx(0.6)


def test_four_agree_one_disagrees_alignment_0_8():
    result = compute_alignment(0.5, 0.5, 0.5, 0.5, -0.5)
    assert result == pytest.approx(0.8)


def test_dead_band_signals_are_neutral():
    # Signals within [-0.05, 0.05] are neutral, don't count for either side
    # 2 positive, 3 in dead band → majority = 2 → alignment = 2/5 = 0.4
    result = compute_alignment(0.8, 0.6, 0.03, -0.01, 0.05)
    assert result == pytest.approx(0.4)


def test_dead_band_boundary_exactly_0_05_is_neutral():
    # |0.05| <= 0.05 is neutral (not directional)
    result = compute_alignment(0.05, -0.05, 0.0, 0.0, 0.8)
    # Only 0.8 is directional → 1 positive, 0 negative → majority = 1
    assert result == pytest.approx(0.2)


def test_dead_band_just_above_is_directional():
    # |0.051| > 0.05 → directional
    result = compute_alignment(0.051, 0.051, 0.051, 0.051, 0.051)
    assert result == pytest.approx(1.0)


def test_all_in_dead_band_alignment_zero():
    result = compute_alignment(0.05, -0.05, 0.03, -0.02, 0.0)
    assert result == pytest.approx(0.0)


def test_alignment_threshold_0_60_pass():
    # 3 of 5 agree → 0.6 ≥ 0.60
    result = compute_alignment(0.5, 0.5, 0.5, -0.5, -0.5)
    assert result >= 0.60


def test_alignment_threshold_0_60_fail():
    # 2 agree, 2 disagree, 1 neutral → majority = 2 → 0.4 < 0.60
    result = compute_alignment(0.5, 0.5, -0.5, -0.5, 0.0)
    assert result < 0.60


def test_alignment_returns_float():
    result = compute_alignment(0.5, 0.5, 0.5, -0.5, 0.0)
    assert isinstance(result, float)


def test_confluence_returns_float():
    result = compute_confluence(0.5, 0.5, 0.5, -0.5, 0.0)
    assert isinstance(result, float)
