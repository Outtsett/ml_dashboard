"""Tests for compute_tension_delta: net directional pressure from distance graph."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.config import DISTANCES
from tensionflow.tension.delta import compute_tension_delta


def _make_distances(value: float) -> np.ndarray:
    return np.full(DISTANCES, value, dtype=np.float32)


def test_zero_distances_zero_delta():
    _up, _dn, delta = compute_tension_delta(_make_distances(0.0), 0.0)
    assert delta == pytest.approx(0.0, abs=1e-9)


def test_all_positive_distances_positive_delta():
    _up, _dn, delta = compute_tension_delta(_make_distances(10.0), 0.0)
    assert delta > 0.0


def test_all_negative_distances_negative_delta():
    _up, _dn, delta = compute_tension_delta(_make_distances(-10.0), 0.0)
    assert delta < 0.0


def test_positive_dscore_amplifies_upzone():
    dist = np.concatenate([np.full(105, 5.0), np.full(105, -5.0)]).astype(np.float32)
    _u1, _d1, result_neutral = compute_tension_delta(dist, 0.0)
    _u2, _d2, result_bullish = compute_tension_delta(dist, 1.0)
    assert result_bullish > result_neutral


def test_negative_dscore_amplifies_downzone():
    dist = np.concatenate([np.full(105, 5.0), np.full(105, -5.0)]).astype(np.float32)
    _u1, _d1, result_neutral = compute_tension_delta(dist, 0.0)
    _u2, _d2, result_bearish = compute_tension_delta(dist, -1.0)
    assert result_bearish < result_neutral


def test_wrong_shape_raises():
    with pytest.raises(ValueError):
        compute_tension_delta(np.zeros(10, dtype=np.float32), 0.0)


def test_custom_edge_weights():
    dist = _make_distances(5.0)
    weights = np.ones(DISTANCES, dtype=np.float64) / DISTANCES
    _up, _dn, delta = compute_tension_delta(dist, 0.0, edge_weights=weights)
    assert delta > 0.0


def test_returns_tuple_of_three_floats():
    result = compute_tension_delta(_make_distances(1.0), 0.5)
    assert isinstance(result, tuple)
    assert len(result) == 3
    upzone, downzone, delta = result
    assert isinstance(upzone, float)
    assert isinstance(downzone, float)
    assert isinstance(delta, float)


def test_upzone_downzone_sum_to_components():
    dist = np.concatenate([np.full(105, 5.0), np.full(105, -5.0)]).astype(np.float32)
    upzone, downzone, delta = compute_tension_delta(dist, 0.0)
    assert upzone >= 0.0
    assert downzone >= 0.0
    assert delta == pytest.approx(upzone - downzone, abs=1e-9)
