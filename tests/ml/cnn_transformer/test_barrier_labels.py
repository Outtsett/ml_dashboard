"""Tests for triple barrier label generation."""

import numpy as np
import pytest


def test_compute_atr_basic():
    """ATR of constant-range bars should equal the range."""
    from ml.cnn_transformer.barrier_labels import compute_atr

    n = 30
    close = np.full(n, 100.0)
    high = np.full(n, 105.0)
    low = np.full(n, 95.0)
    atr = compute_atr(high, low, close, period=14)
    # First period-1 bars are NaN warmup; bar period-1 has SMA seed
    assert np.all(np.isnan(atr[:13]))
    assert not np.isnan(atr[13])  # SMA seed at index period-1
    # After warmup, ATR should be ~10.0 (high - low)
    assert np.allclose(atr[13:], 10.0, atol=0.5)


def test_compute_atr_hand_verified():
    """ATR against hand-calculated values (period=3, 6 bars).

    Hand calculation:
        close = [100.0, 102.0, 101.0, 105.0, 103.0, 100.0]
        high  = [103.0, 104.0, 106.0, 107.0, 105.0, 102.0]
        low   = [ 99.0, 100.0, 100.0, 103.0, 100.0,  97.0]

        TR[0] = H-L = 4
        TR[1] = max(104-100, |104-100|, |100-100|) = 4
        TR[2] = max(106-100, |106-102|, |100-102|) = 6
        TR[3] = max(107-103, |107-101|, |103-101|) = max(4,6,2) = 6
        TR[4] = max(105-100, |105-105|, |100-105|) = max(5,0,5) = 5
        TR[5] = max(102-97, |102-103|, |97-103|)   = max(5,1,6) = 6

        SMA seed at idx 2: mean(4,4,6) = 4.6667
        alpha = 1/3
        ATR[3] = 4.6667*(2/3) + 6*(1/3) = 5.1111
        ATR[4] = 5.1111*(2/3) + 5*(1/3) = 5.0741
        ATR[5] = 5.0741*(2/3) + 6*(1/3) = 5.3827
    """
    from ml.cnn_transformer.barrier_labels import compute_atr

    close = np.array([100.0, 102.0, 101.0, 105.0, 103.0, 100.0])
    high = np.array([103.0, 104.0, 106.0, 107.0, 105.0, 102.0])
    low = np.array([99.0, 100.0, 100.0, 103.0, 100.0, 97.0])
    atr = compute_atr(high, low, close, period=3)

    assert np.isnan(atr[0]) and np.isnan(atr[1])
    assert abs(atr[2] - 4.6667) < 0.01
    assert abs(atr[3] - 5.1111) < 0.01
    assert abs(atr[4] - 5.0741) < 0.01
    assert abs(atr[5] - 5.3827) < 0.01


def test_compute_atr_no_lookahead():
    """ATR at bar i must only use bars 0..i."""
    from ml.cnn_transformer.barrier_labels import compute_atr

    n = 50
    high = np.full(n, 105.0)
    low = np.full(n, 95.0)
    close = np.full(n, 100.0)
    high[40] = 200.0
    atr_before = compute_atr(high, low, close, period=14)
    assert atr_before[39] < 15.0


def test_generate_triple_barrier_labels_basic(small_ohlcv):
    """Basic label generation: every bar gets a label or NaN."""
    from ml.cnn_transformer.barrier_labels import generate_triple_barrier_labels

    result = generate_triple_barrier_labels(
        close=small_ohlcv["close"],
        high=small_ohlcv["high"],
        low=small_ohlcv["low"],
        open_=small_ohlcv["open"],
        atr_period=3,
        tp_multiplier=1.5,
        sl_multiplier=1.5,
        vertical_bars=5,
    )
    assert "labels" in result
    assert "exit_bars" in result
    assert "barrier_types" in result
    assert "atr_at_entry" in result
    assert "returns_at_exit" in result
    assert len(result["labels"]) == len(small_ohlcv["close"])
    valid = ~np.isnan(result["labels"])
    assert set(result["labels"][valid].astype(int)).issubset({-1, 0, 1})


def test_generate_triple_barrier_labels_warmup_nan(small_ohlcv):
    """First atr_period-1 bars have NaN labels (no ATR available)."""
    from ml.cnn_transformer.barrier_labels import generate_triple_barrier_labels

    result = generate_triple_barrier_labels(
        close=small_ohlcv["close"],
        high=small_ohlcv["high"],
        low=small_ohlcv["low"],
        open_=small_ohlcv["open"],
        atr_period=3,
        tp_multiplier=1.5,
        sl_multiplier=1.5,
        vertical_bars=5,
    )
    assert np.all(np.isnan(result["labels"][:2]))
    assert not np.isnan(result["labels"][2])


def test_generate_triple_barrier_labels_tail_nan(small_ohlcv):
    """Last bar cannot have any forward data."""
    from ml.cnn_transformer.barrier_labels import generate_triple_barrier_labels

    result = generate_triple_barrier_labels(
        close=small_ohlcv["close"],
        high=small_ohlcv["high"],
        low=small_ohlcv["low"],
        open_=small_ohlcv["open"],
        atr_period=3,
        tp_multiplier=1.5,
        sl_multiplier=1.5,
        vertical_bars=5,
    )
    assert np.isnan(result["labels"][-1])


def test_generate_triple_barrier_labels_large_tp_forces_timeout(synthetic_ohlcv):
    """Very large TP multiplier should produce mostly timeout (0) labels."""
    from ml.cnn_transformer.barrier_labels import generate_triple_barrier_labels

    result = generate_triple_barrier_labels(
        close=synthetic_ohlcv["close"],
        high=synthetic_ohlcv["high"],
        low=synthetic_ohlcv["low"],
        open_=synthetic_ohlcv["open"],
        atr_period=14,
        tp_multiplier=100.0,
        sl_multiplier=100.0,
        vertical_bars=10,
    )
    valid = ~np.isnan(result["labels"])
    timeouts = (result["labels"][valid] == 0).sum()
    assert timeouts / valid.sum() > 0.8


def test_exit_bars_within_vertical_barrier(synthetic_ohlcv):
    """All exit bars must be <= vertical_bars offset from entry."""
    from ml.cnn_transformer.barrier_labels import generate_triple_barrier_labels

    vb = 20
    result = generate_triple_barrier_labels(
        close=synthetic_ohlcv["close"],
        high=synthetic_ohlcv["high"],
        low=synthetic_ohlcv["low"],
        open_=synthetic_ohlcv["open"],
        atr_period=14,
        tp_multiplier=2.0,
        sl_multiplier=2.0,
        vertical_bars=vb,
    )
    valid = ~np.isnan(result["exit_bars"])
    offsets = result["exit_bars"][valid] - np.arange(len(result["exit_bars"]))[valid]
    assert np.all(offsets >= 1)
    assert np.all(offsets <= vb)


def test_same_bar_dual_hit_resolution():
    """When both barriers hit on same bar, open direction resolves."""
    from ml.cnn_transformer.barrier_labels import generate_triple_barrier_labels

    close = np.array([100.0, 100.0, 100.0])
    high = np.array([105.0, 115.0, 105.0])
    low = np.array([95.0, 85.0, 95.0])
    open_ = np.array([100.0, 105.0, 100.0])

    result = generate_triple_barrier_labels(
        close=close,
        high=high,
        low=low,
        open_=open_,
        atr_period=1,
        tp_multiplier=1.0,
        sl_multiplier=1.0,
        vertical_bars=2,
    )
    assert result["labels"][0] == 1.0

    open_below = np.array([100.0, 95.0, 100.0])
    result2 = generate_triple_barrier_labels(
        close=close,
        high=high,
        low=low,
        open_=open_below,
        atr_period=1,
        tp_multiplier=1.0,
        sl_multiplier=1.0,
        vertical_bars=2,
    )
    assert result2["labels"][0] == -1.0


def test_returns_at_exit_computed(synthetic_ohlcv):
    """returns_at_exit = close[exit_bar] - close[entry_bar]."""
    from ml.cnn_transformer.barrier_labels import generate_triple_barrier_labels

    result = generate_triple_barrier_labels(
        close=synthetic_ohlcv["close"],
        high=synthetic_ohlcv["high"],
        low=synthetic_ohlcv["low"],
        open_=synthetic_ohlcv["open"],
        atr_period=14,
        tp_multiplier=2.0,
        sl_multiplier=2.0,
        vertical_bars=20,
    )
    valid = ~np.isnan(result["exit_bars"])
    for i in np.where(valid)[0][:20]:
        j = int(result["exit_bars"][i])
        expected = synthetic_ohlcv["close"][j] - synthetic_ohlcv["close"][i]
        assert abs(result["returns_at_exit"][i] - expected) < 1e-10
