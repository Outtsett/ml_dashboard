"""Tests for normalize_volume: z-score normalisation across 60 DOM levels."""

from __future__ import annotations

import numpy as np
import pytest

from tensionflow.config import F_FILTERED_PCT, F_VOLUME, RAW_FIELDS, SHMEM_LEVELS
from tensionflow.features.volume import normalize_volume


def _make_features(fill: float = 0.0) -> np.ndarray:
    return np.full((RAW_FIELDS, SHMEM_LEVELS), fill, dtype=np.float64)


def test_uniform_volume_zscore_near_zero():
    # All levels have the same volume → mean subtraction produces zeros.
    features = _make_features(100.0)
    result = normalize_volume(features)
    assert result["volume_z"].shape == (SHMEM_LEVELS,)
    assert np.allclose(result["volume_z"], 0.0, atol=1e-5)


def test_uniform_buy_vol_zscore_near_zero():
    features = _make_features(50.0)
    result = normalize_volume(features)
    assert np.allclose(result["buy_vol_z"], 0.0, atol=1e-5)


def test_uniform_sell_vol_zscore_near_zero():
    features = _make_features(25.0)
    result = normalize_volume(features)
    assert np.allclose(result["sell_vol_z"], 0.0, atol=1e-5)


def test_one_hot_volume_high_level_scores_high():
    # Put all volume on one level → z-score there is highly positive.
    features = _make_features(0.0)
    features[F_VOLUME, 0] = 1000.0  # only level 0 has volume
    result = normalize_volume(features)
    vol_z = result["volume_z"]
    # Level 0 should have the highest z-score.
    assert vol_z[0] == vol_z.max()
    # It should be significantly positive.
    assert float(vol_z[0]) > 0.5


def test_one_hot_volume_others_negative():
    features = _make_features(0.0)
    features[F_VOLUME, 5] = 5000.0
    result = normalize_volume(features)
    vol_z = result["volume_z"]
    # All other levels should be negative (mean is dragged up by the spike).
    assert np.all(vol_z[:5] <= 0.0)
    assert np.all(vol_z[6:] <= 0.0)


def test_output_keys_present():
    features = _make_features(1.0)
    result = normalize_volume(features)
    expected_keys = {"volume_z", "buy_vol_z", "sell_vol_z", "delta_z", "filtered_pct", "cum_delta_z"}
    assert set(result.keys()) == expected_keys


def test_volume_z_bounded():
    rng = np.random.default_rng(42)
    features = rng.uniform(0, 1000, (RAW_FIELDS, SHMEM_LEVELS))
    result = normalize_volume(features)
    assert np.all(result["volume_z"] >= -1.0)
    assert np.all(result["volume_z"] <= 1.0)


def test_buy_vol_z_bounded():
    rng = np.random.default_rng(7)
    features = rng.uniform(0, 500, (RAW_FIELDS, SHMEM_LEVELS))
    result = normalize_volume(features)
    assert np.all(result["buy_vol_z"] >= -1.0)
    assert np.all(result["buy_vol_z"] <= 1.0)


def test_delta_z_bounded():
    rng = np.random.default_rng(13)
    features = rng.uniform(-200, 200, (RAW_FIELDS, SHMEM_LEVELS))
    result = normalize_volume(features)
    assert np.all(result["delta_z"] >= -1.0)
    assert np.all(result["delta_z"] <= 1.0)


def test_filtered_pct_passthrough_unchanged():
    features = _make_features(0.0)
    features[F_FILTERED_PCT, :] = np.linspace(0.0, 1.0, SHMEM_LEVELS)
    result = normalize_volume(features)
    expected = features[F_FILTERED_PCT].astype(np.float32)
    assert np.allclose(result["filtered_pct"], expected, atol=1e-6)


def test_output_dtype_float32():
    features = _make_features(1.0)
    result = normalize_volume(features)
    for key in result:
        assert result[key].dtype == np.float32, f"{key} dtype is {result[key].dtype}"


def test_wrong_shape_raises():
    bad = np.zeros((10, 60), dtype=np.float64)
    with pytest.raises(ValueError):
        normalize_volume(bad)


def test_wrong_levels_raises():
    bad = np.zeros((RAW_FIELDS, 30), dtype=np.float64)
    with pytest.raises(ValueError):
        normalize_volume(bad)
