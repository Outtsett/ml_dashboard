"""Tests for extract_derived: C-engine pre-computed field range conditioning."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.config import (
    F_AGGRESSOR_RATIO,
    F_COMPOSITE_TENSION,
    F_MOMENTUM_SCORE,
    F_SIZE_RATIO,
    F_SPREAD_TENSION,
    F_TICK_DIRECTION,
    RAW_FIELDS,
    SHMEM_LEVELS,
)
from tensionflow.features.derived import extract_derived


def _make_features(fill: float = 0.0) -> np.ndarray:
    return np.full((RAW_FIELDS, SHMEM_LEVELS), fill, dtype=np.float64)


def test_output_keys_present():
    features = _make_features()
    result = extract_derived(features)
    expected = {
        "aggressor_ratio", "tick_direction", "volume_percentile",
        "size_ratio", "spread_tension", "toxicity", "momentum_score",
        "composite_tension",
    }
    assert set(result.keys()) == expected


def test_size_ratio_clipped_at_five():
    # size_ratio = 10.0 (above 5) → clipped to 5 / 5 = 1.0
    features = _make_features(0.0)
    features[F_SIZE_RATIO, :] = 10.0
    result = extract_derived(features)
    assert np.allclose(result["size_ratio"], 1.0, atol=1e-6)


def test_size_ratio_zero_stays_zero():
    features = _make_features(0.0)
    result = extract_derived(features)
    assert np.allclose(result["size_ratio"], 0.0, atol=1e-6)


def test_size_ratio_half_maps_to_point_one():
    # size_ratio = 2.5 → 2.5 / 5 = 0.5
    features = _make_features(0.0)
    features[F_SIZE_RATIO, :] = 2.5
    result = extract_derived(features)
    assert np.allclose(result["size_ratio"], 0.5, atol=1e-6)


def test_spread_tension_clipped_at_five():
    features = _make_features(0.0)
    features[F_SPREAD_TENSION, :] = 99.0
    result = extract_derived(features)
    assert np.allclose(result["spread_tension"], 1.0, atol=1e-6)


def test_spread_tension_two_point_five_maps_to_half():
    features = _make_features(0.0)
    features[F_SPREAD_TENSION, :] = 2.5
    result = extract_derived(features)
    assert np.allclose(result["spread_tension"], 0.5, atol=1e-6)


def test_momentum_score_clipped_at_ten():
    features = _make_features(0.0)
    features[F_MOMENTUM_SCORE, :] = 100.0
    result = extract_derived(features)
    assert np.allclose(result["momentum_score"], 1.0, atol=1e-6)


def test_momentum_score_five_maps_to_half():
    features = _make_features(0.0)
    features[F_MOMENTUM_SCORE, :] = 5.0
    result = extract_derived(features)
    assert np.allclose(result["momentum_score"], 0.5, atol=1e-6)


def test_aggressor_ratio_passthrough():
    features = _make_features(0.0)
    features[F_AGGRESSOR_RATIO, :] = 0.75
    result = extract_derived(features)
    assert np.allclose(result["aggressor_ratio"], 0.75, atol=1e-6)


def test_tick_direction_passthrough():
    features = _make_features(0.0)
    features[F_TICK_DIRECTION, :] = -0.5
    result = extract_derived(features)
    assert np.allclose(result["tick_direction"], -0.5, atol=1e-6)


def test_composite_tension_passthrough():
    features = _make_features(0.0)
    features[F_COMPOSITE_TENSION, :] = 0.3
    result = extract_derived(features)
    assert np.allclose(result["composite_tension"], 0.3, atol=1e-6)


def test_output_dtype_float32():
    features = _make_features(1.0)
    result = extract_derived(features)
    for key in result:
        assert result[key].dtype == np.float32, f"{key} has dtype {result[key].dtype}"


def test_output_shape():
    features = _make_features(0.5)
    result = extract_derived(features)
    for key in result:
        assert result[key].shape == (SHMEM_LEVELS,), f"{key} shape {result[key].shape}"


def test_wrong_shape_raises():
    bad = np.zeros((5, SHMEM_LEVELS), dtype=np.float64)
    with pytest.raises(ValueError):
        extract_derived(bad)
