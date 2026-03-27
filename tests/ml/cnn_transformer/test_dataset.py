"""Tests for dict-based OHLCV window dataset."""
import numpy as np
import torch
import pytest

def test_dataset_returns_tuple_of_three(synthetic_ohlcv):
    from ml.cnn_transformer.dataset import OHLCVWindowDataset
    n = len(synthetic_ohlcv["close"])
    labels = {"barrier_class": np.random.choice([-1, 0, 1], n).astype(np.float64)}
    ds = OHLCVWindowDataset(ohlcv=synthetic_ohlcv, labels=labels, start=0, end=n, window_size=32)
    window, lab_dict, mask_dict = ds[0]
    assert isinstance(window, torch.Tensor)
    assert isinstance(lab_dict, dict) and isinstance(mask_dict, dict)
    assert "barrier_class" in lab_dict and "barrier_class" in mask_dict

def test_dataset_window_shape(synthetic_ohlcv):
    from ml.cnn_transformer.dataset import OHLCVWindowDataset
    n = len(synthetic_ohlcv["close"])
    labels = {"barrier_class": np.zeros(n)}
    ds = OHLCVWindowDataset(ohlcv=synthetic_ohlcv, labels=labels, start=0, end=n, window_size=64)
    window, _, _ = ds[0]
    assert window.shape == (64, 5)

def test_dataset_mask_reflects_nan():
    from ml.cnn_transformer.dataset import OHLCVWindowDataset
    n = 100
    ohlcv = {k: np.ones(n) for k in ["open", "high", "low", "close", "volume"]}
    labels_arr = np.ones(n)
    labels_arr[50] = np.nan
    ds = OHLCVWindowDataset(ohlcv=ohlcv, labels={"barrier_class": labels_arr}, start=0, end=n, window_size=10)
    # Index 41: bar_idx = max(0, 10-1) + 41 = 50. Label at bar 50 is NaN.
    _, lab, mask = ds[41]
    assert mask["barrier_class"].item() == False

def test_dataset_no_labels_for_inference():
    from ml.cnn_transformer.dataset import OHLCVWindowDataset
    n = 100
    ohlcv = {k: np.ones(n) for k in ["open", "high", "low", "close", "volume"]}
    ds = OHLCVWindowDataset(ohlcv=ohlcv, labels={}, start=0, end=n, window_size=10)
    window, lab, mask = ds[0]
    assert window.shape == (10, 5)
    assert len(lab) == 0 and len(mask) == 0

def test_dataset_length(synthetic_ohlcv):
    from ml.cnn_transformer.dataset import OHLCVWindowDataset
    n = len(synthetic_ohlcv["close"])
    ds = OHLCVWindowDataset(ohlcv=synthetic_ohlcv, labels={}, start=0, end=n, window_size=128)
    # first valid index is 127, last is n-1, so count = n - 127
    assert len(ds) == n - 127
