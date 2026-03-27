"""Tests for auxiliary label generators."""

import numpy as np
import pytest


def test_vol_regime_labels_three_classes(synthetic_ohlcv):
    """Vol regime produces exactly 3 classes: 0=low, 1=med, 2=high."""
    from ml.cnn_transformer.auxiliary_labels import generate_vol_regime_labels

    labels = generate_vol_regime_labels(synthetic_ohlcv["close"], lookback=250)
    valid = ~np.isnan(labels)
    assert set(labels[valid].astype(int)) == {0, 1, 2}


def test_vol_regime_labels_warmup_nan(synthetic_ohlcv):
    """First lookback bars are NaN (not enough trailing data)."""
    from ml.cnn_transformer.auxiliary_labels import generate_vol_regime_labels

    labels = generate_vol_regime_labels(synthetic_ohlcv["close"], lookback=250)
    assert np.all(np.isnan(labels[:250]))


def test_vol_regime_labels_no_lookahead(synthetic_ohlcv):
    """Label at bar i depends only on bars 0..i."""
    from ml.cnn_transformer.auxiliary_labels import generate_vol_regime_labels

    labels_full = generate_vol_regime_labels(synthetic_ohlcv["close"], lookback=250)
    labels_trunc = generate_vol_regime_labels(synthetic_ohlcv["close"][:500], lookback=250)
    # Labels for bars 250..499 must match
    np.testing.assert_array_equal(labels_full[250:500], labels_trunc[250:500])


def test_return_bucket_labels_eight_classes():
    """Return bucket produces 8 classes from quantile binning."""
    from ml.cnn_transformer.auxiliary_labels import generate_return_bucket_labels

    rng = np.random.default_rng(42)
    returns = rng.normal(0, 1.0, 1000)
    labels, bin_edges = generate_return_bucket_labels(returns, n_bins=8)
    valid = ~np.isnan(labels)
    unique = set(labels[valid].astype(int))
    assert unique == set(range(8))
    assert len(bin_edges) == 9  # n_bins + 1 edges


def test_return_bucket_labels_nan_passthrough():
    """NaN returns produce NaN labels."""
    from ml.cnn_transformer.auxiliary_labels import generate_return_bucket_labels

    returns = np.array([1.0, np.nan, -1.0, 0.5, np.nan])
    labels, _ = generate_return_bucket_labels(returns, n_bins=4)
    assert np.isnan(labels[1])
    assert np.isnan(labels[4])
    assert not np.isnan(labels[0])


def test_return_bucket_labels_precomputed_edges():
    """Pre-computed bin edges from training set applied to new data."""
    from ml.cnn_transformer.auxiliary_labels import generate_return_bucket_labels

    rng = np.random.default_rng(42)
    train_returns = rng.normal(0, 1.0, 500)
    _, bin_edges = generate_return_bucket_labels(train_returns, n_bins=8)

    # Apply training edges to validation data
    val_returns = rng.normal(0, 1.0, 200)
    val_labels, _ = generate_return_bucket_labels(val_returns, n_bins=8, bin_edges=bin_edges)
    valid = ~np.isnan(val_labels)
    assert valid.sum() == 200
    assert all(0 <= val_labels[valid].astype(int)) and all(val_labels[valid].astype(int) < 8)
