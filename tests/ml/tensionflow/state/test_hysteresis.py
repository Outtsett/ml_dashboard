"""Tests for HysteresisState flip-prevention state machine."""

from __future__ import annotations

import pytest

from tensionflow.state.hysteresis import HysteresisState
from tensionflow.config import HYSTERESIS_BARS, NEUTRAL_ZONE_THRESHOLD


def test_initial_position_zero():
    h = HysteresisState()
    assert h.position == 0


def test_initial_bars_neutral_zero():
    h = HysteresisState()
    assert h.neutral_bars == 0


def test_initial_last_flip_seq_zero():
    h = HysteresisState()
    assert h.last_flip_seq == 0


def test_uninit_position_no_flip_on_strong_signal():
    # position=0 → update never triggers flip or exit
    h = HysteresisState()
    flip, exit_ = h.update(2.0, 1)
    assert not flip
    assert not exit_


def test_flip_long_to_short_negative_td():
    h = HysteresisState()
    h.execute_flip(1, feature_seq=1)
    # Feed strongly negative tension delta — should trigger should_flip
    flip, exit_ = h.update(-NEUTRAL_ZONE_THRESHOLD - 0.1, feature_seq=2)
    assert flip
    assert not exit_


def test_flip_short_to_long_positive_td():
    h = HysteresisState()
    h.execute_flip(-1, feature_seq=1)
    flip, exit_ = h.update(NEUTRAL_ZONE_THRESHOLD + 0.1, feature_seq=2)
    assert flip
    assert not exit_


def test_no_flip_same_direction_long():
    # Already LONG, positive delta — no flip
    h = HysteresisState()
    h.execute_flip(1, feature_seq=1)
    flip, exit_ = h.update(NEUTRAL_ZONE_THRESHOLD + 0.1, feature_seq=2)
    assert not flip


def test_no_flip_same_direction_short():
    # Already SHORT, negative delta — no flip
    h = HysteresisState()
    h.execute_flip(-1, feature_seq=1)
    flip, exit_ = h.update(-NEUTRAL_ZONE_THRESHOLD - 0.1, feature_seq=2)
    assert not flip


def test_neutral_zone_accumulates_bars():
    h = HysteresisState(hysteresis_bars=3)
    h.execute_flip(1, feature_seq=1)
    # Feed 2 neutral bars — should not exit yet
    for seq in range(2, 4):
        flip, exit_ = h.update(0.0, feature_seq=seq)
        assert not exit_, f"expected no exit on neutral bar {seq - 1}"
    assert h.neutral_bars == 2


def test_neutral_zone_exit_on_third_bar():
    h = HysteresisState(hysteresis_bars=3)
    h.execute_flip(1, feature_seq=1)
    flip, exit_ = h.update(0.0, feature_seq=2)
    flip, exit_ = h.update(0.0, feature_seq=3)
    flip, exit_ = h.update(0.0, feature_seq=4)
    assert exit_
    assert not flip


def test_neutral_zone_counter_resets_after_exit():
    h = HysteresisState(hysteresis_bars=3)
    h.execute_flip(1, feature_seq=1)
    for seq in range(2, 5):
        h.update(0.0, feature_seq=seq)
    # After exit, counter should reset
    assert h.neutral_bars == 0


def test_no_premature_exit_non_neutral_resets_counter():
    # 2 neutral bars then 1 non-neutral — counter must reset to 0
    h = HysteresisState(hysteresis_bars=3)
    h.execute_flip(1, feature_seq=1)
    h.update(0.0, feature_seq=2)  # neutral bar 1
    h.update(0.0, feature_seq=3)  # neutral bar 2
    h.update(NEUTRAL_ZONE_THRESHOLD + 0.1, feature_seq=4)  # non-neutral — resets
    assert h.neutral_bars == 0


def test_no_premature_exit_two_then_non_neutral_no_exit():
    h = HysteresisState(hysteresis_bars=3)
    h.execute_flip(1, feature_seq=1)
    h.update(0.0, feature_seq=2)
    h.update(0.0, feature_seq=3)
    flip, exit_ = h.update(NEUTRAL_ZONE_THRESHOLD + 0.1, feature_seq=4)
    assert not exit_


def test_execute_flip_changes_position():
    h = HysteresisState()
    h.execute_flip(1, feature_seq=5)
    assert h.position == 1
    h.execute_flip(-1, feature_seq=10)
    assert h.position == -1


def test_execute_flip_records_seq():
    h = HysteresisState()
    h.execute_flip(1, feature_seq=42)
    assert h.last_flip_seq == 42


def test_execute_flip_resets_neutral_bars():
    h = HysteresisState(hysteresis_bars=3)
    h.execute_flip(1, feature_seq=1)
    h.update(0.0, feature_seq=2)  # neutral_bars = 1
    h.execute_flip(-1, feature_seq=3)     # should reset neutral_bars
    assert h.neutral_bars == 0


def test_execute_flip_invalid_position_raises():
    h = HysteresisState()
    with pytest.raises(ValueError):
        h.execute_flip(0, feature_seq=1)
    with pytest.raises(ValueError):
        h.execute_flip(2, feature_seq=1)


def test_reset_clears_all_state():
    h = HysteresisState()
    h.execute_flip(1, feature_seq=99)
    h.update(0.0, feature_seq=100)
    h.reset()
    assert h.position == 0
    assert h.neutral_bars == 0
    assert h.last_flip_seq == 0


def test_exit_takes_precedence_over_flip():
    # Within the same bar, exit logic fires first (neutral bar triggers exit),
    # so should_flip must be False when should_exit is True
    h = HysteresisState(hysteresis_bars=1)
    h.execute_flip(1, feature_seq=1)
    # 1 neutral bar → should_exit=True; since it's neutral, should_flip cannot be True
    flip, exit_ = h.update(0.0, feature_seq=2)
    assert exit_
    assert not flip


def test_custom_threshold_respected():
    h = HysteresisState(hysteresis_bars=3, neutral_zone_threshold=0.5)
    h.execute_flip(1, feature_seq=1)
    # 0.4 is inside the custom threshold (< 0.5) → neutral
    flip, exit_ = h.update(0.4, feature_seq=2)
    assert not flip
    assert h.neutral_bars == 1
