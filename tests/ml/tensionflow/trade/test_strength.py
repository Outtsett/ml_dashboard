"""Tests for compute_strength: discrete signal strength from TensionDelta and context."""

from __future__ import annotations

from tensionflow.trade.context import AT_EXTREME, AT_NEUTRAL, AT_VALUE_EDGE, AT_VWAP
from tensionflow.trade.strength import compute_strength


def test_neutral_zone_returns_zero():
    result = compute_strength(
        tension_delta=0.1,
        bullish_thresh=0.3,
        bearish_thresh=-0.3,
        context=AT_NEUTRAL,
    )
    assert result == 0


def test_weak_bullish_returns_plus_one():
    result = compute_strength(
        tension_delta=0.35,
        bullish_thresh=0.3,
        bearish_thresh=-0.3,
        context=AT_NEUTRAL,
    )
    assert result == 1


def test_strong_bullish_returns_plus_two():
    result = compute_strength(
        tension_delta=1.5,
        bullish_thresh=0.3,
        bearish_thresh=-0.3,
        context=AT_NEUTRAL,
    )
    assert result == 2


def test_weak_bearish_returns_minus_one():
    result = compute_strength(
        tension_delta=-0.35,
        bullish_thresh=0.3,
        bearish_thresh=-0.3,
        context=AT_NEUTRAL,
    )
    assert result == -1


def test_strong_bearish_returns_minus_two():
    result = compute_strength(
        tension_delta=-1.5,
        bullish_thresh=0.3,
        bearish_thresh=-0.3,
        context=AT_NEUTRAL,
    )
    assert result == -2


def test_at_extreme_upgrades_weak_to_strong():
    result = compute_strength(
        tension_delta=0.35,
        bullish_thresh=0.3,
        bearish_thresh=-0.3,
        context=AT_EXTREME,
    )
    assert result == 2


def test_at_value_edge_with_high_confluence_upgrades_weak():
    result = compute_strength(
        tension_delta=0.35,
        bullish_thresh=0.3,
        bearish_thresh=-0.3,
        context=AT_VALUE_EDGE,
        confluence=2.5,
    )
    assert result == 2


def test_at_value_edge_without_confluence_no_upgrade():
    result = compute_strength(
        tension_delta=0.35,
        bullish_thresh=0.3,
        bearish_thresh=-0.3,
        context=AT_VALUE_EDGE,
        confluence=1.0,
    )
    assert result == 1


def test_at_vwap_does_not_upgrade():
    result = compute_strength(
        tension_delta=0.35,
        bullish_thresh=0.3,
        bearish_thresh=-0.3,
        context=AT_VWAP,
        confluence=3.0,
    )
    assert result == 1


def test_returns_int():
    result = compute_strength(0.5, 0.3, -0.3, AT_NEUTRAL)
    assert isinstance(result, int)


def test_result_in_valid_set():
    for td in [-2.0, -0.5, 0.0, 0.5, 2.0]:
        result = compute_strength(td, 0.3, -0.3, AT_NEUTRAL)
        assert result in {-2, -1, 0, 1, 2}
