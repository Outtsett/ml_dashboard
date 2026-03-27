"""Tests for trade simulation and profit factor calculation."""
import numpy as np
import pytest

def test_profit_factor_all_winners():
    from ml.cnn_transformer.evaluate import compute_profit_factor
    trades = [{"net_pnl": 10.0}, {"net_pnl": 5.0}, {"net_pnl": 8.0}]
    pf = compute_profit_factor(trades)
    assert pf == float("inf")

def test_profit_factor_mixed():
    from ml.cnn_transformer.evaluate import compute_profit_factor
    trades = [{"net_pnl": 10.0}, {"net_pnl": -5.0}, {"net_pnl": 8.0}, {"net_pnl": -3.0}]
    pf = compute_profit_factor(trades)
    assert abs(pf - (18.0 / 8.0)) < 1e-6

def test_profit_factor_no_trades():
    from ml.cnn_transformer.evaluate import compute_profit_factor
    assert compute_profit_factor([]) == 0.0

def test_simulate_trades_cost_subtracted():
    from ml.cnn_transformer.evaluate import simulate_barrier_trades
    predictions = np.array([1, -1, 0, 1])
    actual_labels = np.array([1, -1, 0, -1])
    returns_at_exit = np.array([5.0, -3.0, 0.5, -2.0])
    cost_rt = 2.80
    trades = simulate_barrier_trades(predictions, actual_labels, returns_at_exit, cost_rt, point_value=2.0)
    assert len(trades) == 3  # pred=0 skipped
    # Trade 0: pred=+1 (long), return=5.0, raw_pnl=10.0
    assert trades[0]["raw_pnl"] == 5.0 * 2.0
    assert trades[0]["cost"] == cost_rt
    assert trades[0]["net_pnl"] == (5.0 * 2.0) - cost_rt
    # Trade 1: pred=-1 (short), return=-3.0, short profits: -(-3.0)*2.0=6.0
    assert trades[1]["raw_pnl"] == 3.0 * 2.0
    assert trades[1]["net_pnl"] == (3.0 * 2.0) - cost_rt
    # Trade 2: pred=+1 (long), return=-2.0, long loses: -2.0*2.0=-4.0
    assert trades[2]["raw_pnl"] == -2.0 * 2.0
    assert trades[2]["net_pnl"] == (-2.0 * 2.0) - cost_rt

def test_simulate_trades_skips_timeout_predictions():
    from ml.cnn_transformer.evaluate import simulate_barrier_trades
    predictions = np.array([0, 0, 0])
    actual_labels = np.array([1, -1, 0])
    returns_at_exit = np.array([5.0, -3.0, 0.5])
    trades = simulate_barrier_trades(predictions, actual_labels, returns_at_exit, 2.80, 2.0)
    assert len(trades) == 0

def test_compute_sharpe():
    from ml.cnn_transformer.evaluate import compute_sharpe
    trades = [{"net_pnl": 10.0}, {"net_pnl": -5.0}, {"net_pnl": 8.0}, {"net_pnl": -3.0}]
    sharpe = compute_sharpe(trades)
    assert isinstance(sharpe, float)

def test_compute_class_metrics():
    from ml.cnn_transformer.evaluate import compute_class_metrics
    preds = np.array([1, 1, -1, 0, 1, -1])
    actual = np.array([1, -1, -1, 0, 1, 1])
    metrics = compute_class_metrics(preds, actual)
    assert "tp" in metrics and "sl" in metrics and "timeout" in metrics
    assert metrics["tp"]["precision"] == 2.0 / 3.0  # 2 correct out of 3 predicted +1
    assert metrics["sl"]["precision"] == 1.0 / 2.0   # 1 correct out of 2 predicted -1
