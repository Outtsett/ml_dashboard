"""Tests for compute_qty: Kelly fraction position sizing."""

from __future__ import annotations

from tensionflow.config import KELLY_SAFETY_FACTOR, MAX_CONTRACTS
from tensionflow.risk.sizing import compute_qty


def test_returns_int():
    result = compute_qty(confidence=0.5)
    assert isinstance(result, int)


def test_minimum_one_contract():
    # Very low confidence → floored at 1
    result = compute_qty(confidence=0.001)
    assert result >= 1


def test_maximum_contracts_not_exceeded():
    # Maximum confidence → capped at MAX_CONTRACTS
    result = compute_qty(confidence=1.0, win_rate=0.99, avg_win=10.0, avg_loss=1.0)
    assert result <= MAX_CONTRACTS


def test_zero_confidence_returns_one():
    # confidence=0 → raw_qty=0 → floored to 1
    result = compute_qty(confidence=0.0)
    assert result == 1


def test_negative_edge_returns_one():
    # win_rate < 0.5 with avg_win == avg_loss → Kelly < 0 → clamped to 0 → returns 1
    result = compute_qty(confidence=1.0, win_rate=0.3, avg_win=1.0, avg_loss=1.0)
    assert result == 1


def test_fair_coin_default_returns_one():
    # win_rate=0.5, avg_win=1.0, avg_loss=1.0 → Kelly=0 → returns 1
    result = compute_qty(confidence=1.0, win_rate=0.5, avg_win=1.0, avg_loss=1.0)
    assert result == 1


def test_high_edge_scales_with_confidence():
    # Positive Kelly with different confidence levels
    low_conf = compute_qty(confidence=0.2, win_rate=0.7, avg_win=2.0, avg_loss=1.0)
    high_conf = compute_qty(confidence=1.0, win_rate=0.7, avg_win=2.0, avg_loss=1.0)
    assert high_conf >= low_conf


def test_known_kelly_value():
    # win_rate=0.6, avg_win=2.0, avg_loss=1.0
    # Kelly = (0.6*2 - 0.4*1) / max(2, 0.01) = (1.2 - 0.4)/2 = 0.4
    # raw_qty = 0.4 * confidence * KELLY_SAFETY_FACTOR * MAX_CONTRACTS
    confidence = 1.0
    kelly = (0.6 * 2.0 - 0.4 * 1.0) / 2.0  # = 0.4
    expected_raw = kelly * confidence * KELLY_SAFETY_FACTOR * MAX_CONTRACTS
    expected = max(1, min(int(expected_raw), MAX_CONTRACTS))
    result = compute_qty(confidence=confidence, win_rate=0.6, avg_win=2.0, avg_loss=1.0)
    assert result == expected


def test_result_in_valid_range():
    for conf in [0.0, 0.3, 0.5, 0.7, 1.0]:
        result = compute_qty(confidence=conf, win_rate=0.65, avg_win=1.5, avg_loss=1.0)
        assert 1 <= result <= MAX_CONTRACTS
