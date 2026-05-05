"""Tests for evaluate_flip: flip logic with hysteresis gating (L1 only)."""

from __future__ import annotations

import pytest

from tensionflow.trade.flip import evaluate_flip
from tensionflow.state.hysteresis import HysteresisState
from tensionflow.config import (
    ACTION_BUY,
    ACTION_SELL,
    ACTION_FLATTEN,
    ACTION_NONE,
)


def _fresh_hysteresis() -> HysteresisState:
    return HysteresisState()


def test_neutral_zone_exit_flattens():
    hyst = HysteresisState(hysteresis_bars=2)
    hyst.execute_flip(1, 1)
    # Feed 2 neutral bars -> should_exit=True
    evaluate_flip(0, hyst, 0.0, 2)
    signal, action = evaluate_flip(0, hyst, 0.0, 3)
    assert action == ACTION_FLATTEN
    assert signal == 0


def test_no_flip_when_not_crossing_threshold():
    # position=LONG, positive tension delta — no flip
    hyst = _fresh_hysteresis()
    hyst.execute_flip(1, 1)
    signal, action = evaluate_flip(
        signal_strength=1,
        hysteresis=hyst,
        tension_delta=0.5,
        feature_seq=2,
    )
    assert action == ACTION_NONE


def test_returns_tuple_of_two_ints():
    hyst = _fresh_hysteresis()
    result = evaluate_flip(0, hyst, 0.0, 1)
    assert isinstance(result, tuple)
    assert len(result) == 2
    assert isinstance(result[0], int)
    assert isinstance(result[1], int)


def test_flip_long_to_short_via_normal_path():
    # Position LONG, strong negative tension -> should_flip=True via update
    hyst = _fresh_hysteresis()
    hyst.execute_flip(1, 1)
    signal, action = evaluate_flip(
        signal_strength=-2,
        hysteresis=hyst,
        tension_delta=-0.5,  # beyond neutral_zone_threshold=0.3
        feature_seq=2,
    )
    assert action == ACTION_SELL
    assert signal == -2


def test_uninitialised_position_allows_initial_entry_long():
    hyst = _fresh_hysteresis()  # position=0
    signal, action = evaluate_flip(
        signal_strength=2,
        hysteresis=hyst,
        tension_delta=0.5,
        feature_seq=1,
    )
    assert action == ACTION_BUY
    assert signal == 2
    assert hyst.position == 1


def test_uninitialised_position_allows_initial_entry_short():
    hyst = _fresh_hysteresis()  # position=0
    signal, action = evaluate_flip(
        signal_strength=-1,
        hysteresis=hyst,
        tension_delta=-0.5,
        feature_seq=1,
    )
    assert action == ACTION_SELL
    assert signal == -1
    assert hyst.position == -1


def test_uninitialised_position_no_entry_when_strength_zero():
    hyst = _fresh_hysteresis()  # position=0
    signal, action = evaluate_flip(
        signal_strength=0,
        hysteresis=hyst,
        tension_delta=0.0,
        feature_seq=1,
    )
    assert action == ACTION_NONE
    assert signal == 0
    assert hyst.position == 0


def test_flip_short_to_long():
    hyst = _fresh_hysteresis()
    hyst.execute_flip(-1, 1)  # currently SHORT
    signal, action = evaluate_flip(
        signal_strength=2,
        hysteresis=hyst,
        tension_delta=0.5,  # above neutral_zone_threshold
        feature_seq=2,
    )
    assert action == ACTION_BUY
    assert signal == 2


def test_hold_position_in_neutral_zone():
    hyst = _fresh_hysteresis()
    hyst.execute_flip(1, 1)  # currently LONG
    # Tension delta within neutral zone — no flip, no exit yet
    signal, action = evaluate_flip(
        signal_strength=0,
        hysteresis=hyst,
        tension_delta=0.1,  # within +-0.3
        feature_seq=2,
    )
    assert action == ACTION_NONE
    assert signal == 1  # holds LONG position
