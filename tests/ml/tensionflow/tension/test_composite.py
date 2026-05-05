"""Tests for compute_composite: regime-adaptive D_score aggregation."""

from __future__ import annotations

import pytest

from tensionflow.tension.composite import compute_composite
from tensionflow.config import REGIME_WEIGHTS, REGIME_UNKNOWN, REGIME_VOLATILE


def _default_profile() -> dict:
    return REGIME_WEIGHTS[REGIME_UNKNOWN]


def test_all_zero_signals_zero_dscore():
    result = compute_composite(0.0, 0.0, 0.0, 0.0, 0.0, _default_profile())
    assert result == pytest.approx(0.0, abs=1e-6)


def test_all_one_signals_clipped_to_one():
    result = compute_composite(1.0, 1.0, 1.0, 1.0, 1.0, _default_profile())
    assert result == pytest.approx(1.0, abs=1e-6)


def test_all_minus_one_clipped_to_minus_one():
    result = compute_composite(-1.0, -1.0, -1.0, -1.0, -1.0, _default_profile())
    assert result == pytest.approx(-1.0, abs=1e-6)


def test_weights_applied_correctly():
    profile = _default_profile()
    # Only spatial is nonzero
    expected = profile["spatial"] * 0.5
    result = compute_composite(0.5, 0.0, 0.0, 0.0, 0.0, profile)
    assert result == pytest.approx(expected, abs=1e-5)


def test_weighted_combination_all_signals():
    profile = _default_profile()
    s_sp, s_mo, s_bd, s_vp, s_st = 0.4, 0.3, 0.6, -0.2, 0.1
    expected = (
        profile["spatial"] * s_sp
        + profile["momentum"] * s_mo
        + profile["band_direction"] * s_bd
        + profile["volume_profile"] * s_vp
        + profile["structure"] * s_st
    )
    expected = max(-1.0, min(1.0, expected))
    result = compute_composite(s_sp, s_mo, s_bd, s_vp, s_st, profile)
    assert result == pytest.approx(expected, abs=1e-5)


def test_volatile_regime_spatial_heavy():
    volatile_profile = REGIME_WEIGHTS[REGIME_VOLATILE]
    # s_spatial=1.0, rest=0 -> result = 0.35
    result = compute_composite(1.0, 0.0, 0.0, 0.0, 0.0, volatile_profile)
    assert result == pytest.approx(0.35, abs=1e-5)


def test_output_clipped_positive():
    result = compute_composite(1.0, 1.0, 1.0, 1.0, 1.0, _default_profile())
    assert result <= 1.0


def test_output_clipped_negative():
    result = compute_composite(-1.0, -1.0, -1.0, -1.0, -1.0, _default_profile())
    assert result >= -1.0


def test_returns_float():
    result = compute_composite(0.1, 0.2, 0.3, 0.4, 0.5, _default_profile())
    assert isinstance(result, float)


def test_missing_key_raises_key_error():
    bad_profile = {"spatial": 0.5, "momentum": 0.5}  # missing keys
    with pytest.raises(KeyError):
        compute_composite(0.0, 0.0, 0.0, 0.0, 0.0, bad_profile)
