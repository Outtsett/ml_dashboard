"""Trade simulation and performance metrics for triple barrier models.

Separated from training loop (SRP). Cost model is injected (DIP).
"""
from __future__ import annotations

import numpy as np


def simulate_barrier_trades(
    predictions: np.ndarray,
    actual_labels: np.ndarray,
    returns_at_exit: np.ndarray,
    cost_round_trip: float,
    point_value: float,
) -> list[dict]:
    """Simulate trades from barrier predictions.

    Only bars where prediction is +1 or -1 generate trades.
    Prediction of 0 (timeout) = no trade.
    For short trades (pred=-1), profit is negated return.
    """
    trades = []
    for i in range(len(predictions)):
        pred = int(predictions[i])
        if pred == 0:
            continue
        if np.isnan(actual_labels[i]) or np.isnan(returns_at_exit[i]):
            continue
        raw_return_pts = returns_at_exit[i]
        if pred == -1:
            raw_return_pts = -raw_return_pts
        raw_pnl = raw_return_pts * point_value
        net_pnl = raw_pnl - cost_round_trip
        trades.append({
            "bar_idx": i, "side": pred, "predicted": pred,
            "actual": int(actual_labels[i]),
            "correct": pred == int(actual_labels[i]),
            "raw_pnl": raw_pnl, "cost": cost_round_trip, "net_pnl": net_pnl,
        })
    return trades


def compute_profit_factor(trades: list[dict]) -> float:
    """Profit factor = gross profit / gross loss. Returns inf if no losses, 0.0 if no trades."""
    if not trades:
        return 0.0
    gross_profit = sum(t["net_pnl"] for t in trades if t["net_pnl"] > 0)
    gross_loss = abs(sum(t["net_pnl"] for t in trades if t["net_pnl"] < 0))
    if gross_loss == 0:
        return float("inf") if gross_profit > 0 else 0.0
    return gross_profit / gross_loss


def compute_sharpe(trades: list[dict], annualize: float = 252.0) -> float:
    """Sharpe ratio from trade P&L series."""
    if len(trades) < 2:
        return 0.0
    pnls = np.array([t["net_pnl"] for t in trades])
    mean = pnls.mean()
    std = pnls.std(ddof=1)
    if std == 0:
        return 0.0
    return float(mean / std * np.sqrt(annualize))


def compute_class_metrics(predictions: np.ndarray, actual_labels: np.ndarray) -> dict[str, dict[str, float]]:
    """Per-class precision and recall for barrier predictions."""
    valid = ~np.isnan(actual_labels) & ~np.isnan(predictions)
    preds = predictions[valid].astype(int)
    actual = actual_labels[valid].astype(int)
    metrics = {}
    for cls, name in [(1, "tp"), (-1, "sl"), (0, "timeout")]:
        pred_pos = (preds == cls).sum()
        actual_pos = (actual == cls).sum()
        true_pos = ((preds == cls) & (actual == cls)).sum()
        precision = true_pos / pred_pos if pred_pos > 0 else 0.0
        recall = true_pos / actual_pos if actual_pos > 0 else 0.0
        metrics[name] = {"precision": float(precision), "recall": float(recall)}
    return metrics
