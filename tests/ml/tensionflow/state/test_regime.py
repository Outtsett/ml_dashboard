"""Tests for select_weight_profile regime-adaptive weight selector."""

from __future__ import annotations

from tensionflow.state.regime import select_weight_profile
from tensionflow.config import (
    REGIME_UNKNOWN,
    REGIME_VOLATILE,
    REGIME_RANGE,
    REGIME_TREND_UP,
    REGIME_TREND_DOWN,
    REGIME_WEIGHTS,
)

# Expected keys in every weight profile
_KEYS = {"spatial", "momentum", "band_direction", "volume_profile", "structure"}


def _assert_valid_profile(profile: dict) -> None:
    assert set(profile.keys()) == _KEYS
    total = sum(profile.values())
    assert abs(total - 1.0) < 1e-9, f"weights don't sum to 1: {total}"


def test_volatile_markov_returns_high_vol_weights():
    profile = select_weight_profile(REGIME_VOLATILE, REGIME_UNKNOWN)
    _assert_valid_profile(profile)
    assert profile["spatial"] == REGIME_WEIGHTS[REGIME_VOLATILE]["spatial"]
    assert profile["spatial"] == 0.35


def test_range_markov_returns_low_vol_weights():
    profile = select_weight_profile(REGIME_RANGE, REGIME_UNKNOWN)
    _assert_valid_profile(profile)
    assert profile["band_direction"] == REGIME_WEIGHTS[REGIME_RANGE]["band_direction"]
    assert profile["band_direction"] == 0.25


def test_trend_up_markov_returns_trend_weights():
    profile = select_weight_profile(REGIME_TREND_UP, REGIME_UNKNOWN)
    _assert_valid_profile(profile)
    assert profile == REGIME_WEIGHTS[REGIME_TREND_UP]


def test_trend_down_markov_returns_trend_weights():
    profile = select_weight_profile(REGIME_TREND_DOWN, REGIME_UNKNOWN)
    _assert_valid_profile(profile)
    assert profile == REGIME_WEIGHTS[REGIME_TREND_DOWN]


def test_unknown_markov_uses_vol_regime_volatile():
    profile = select_weight_profile(REGIME_UNKNOWN, REGIME_VOLATILE)
    _assert_valid_profile(profile)
    assert profile == REGIME_WEIGHTS[REGIME_VOLATILE]


def test_unknown_markov_uses_vol_regime_range():
    profile = select_weight_profile(REGIME_UNKNOWN, REGIME_RANGE)
    _assert_valid_profile(profile)
    assert profile == REGIME_WEIGHTS[REGIME_RANGE]


def test_unknown_markov_uses_vol_regime_trend_up():
    profile = select_weight_profile(REGIME_UNKNOWN, REGIME_TREND_UP)
    _assert_valid_profile(profile)
    assert profile == REGIME_WEIGHTS[REGIME_TREND_UP]


def test_unknown_markov_uses_vol_regime_trend_down():
    profile = select_weight_profile(REGIME_UNKNOWN, REGIME_TREND_DOWN)
    _assert_valid_profile(profile)
    assert profile == REGIME_WEIGHTS[REGIME_TREND_DOWN]


def test_default_returns_normal_weights_both_unknown():
    profile = select_weight_profile(REGIME_UNKNOWN, REGIME_UNKNOWN)
    _assert_valid_profile(profile)
    assert profile == REGIME_WEIGHTS[REGIME_UNKNOWN]


def test_unrecognised_markov_falls_back_to_vol_regime():
    profile = select_weight_profile(99, REGIME_VOLATILE)
    _assert_valid_profile(profile)
    assert profile == REGIME_WEIGHTS[REGIME_VOLATILE]


def test_unrecognised_both_falls_back_to_unknown():
    profile = select_weight_profile(99, 99)
    _assert_valid_profile(profile)
    assert profile == REGIME_WEIGHTS[REGIME_UNKNOWN]


def test_all_profiles_weights_sum_to_one():
    for regime_id, profile in REGIME_WEIGHTS.items():
        total = sum(profile.values())
        assert abs(total - 1.0) < 1e-9, f"regime {regime_id} weights sum to {total}"
