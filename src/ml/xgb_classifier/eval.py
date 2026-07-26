"""
Classification + cost-adjusted PnL diagnostics for the XGBoost classifier.

Computes:
  - Discrimination: AUC, log-loss, Brier
  - Calibration: 10-bin reliability curve, ECE, MCE
  - Operating points: hit-rate at threshold p in {0.50, 0.55, 0.60}
  - Cost-adjusted equity: cumulative PnL in dollars, profit factor, hit-rate,
    average win/loss, max drawdown, annualized Sharpe (unitless)

Cost model: src/config/cost_model.json. For unrecognized symbols falls back to
a generic 0.5 bp slippage per side + 0 commission.

All numpy. No pandas. Zero allocations on the hot loops.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_COST_MODEL_PATH = _PROJECT_ROOT / "src" / "config" / "cost_model.json"


# ─── Discrimination ───────────────────────────────────────────────────────────


def auc_score(y_true: np.ndarray, p_up: np.ndarray) -> float:
    """Area under ROC. Uses the rank-based Mann-Whitney equivalence — O(n log n)."""
    y = np.asarray(y_true).astype(np.int8)
    p = np.asarray(p_up).astype(np.float64)
    if y.shape != p.shape:
        raise ValueError("y_true and p_up shape mismatch")
    n_pos = int(y.sum())
    n_neg = y.size - n_pos
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    order = np.argsort(p)
    ranks = np.empty(p.size, dtype=np.float64)
    ranks[order] = np.arange(1, p.size + 1, dtype=np.float64)
    sum_pos_ranks = float(ranks[y == 1].sum())
    auc = (sum_pos_ranks - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)
    return float(auc)


def log_loss(y_true: np.ndarray, p_up: np.ndarray, eps: float = 1e-7) -> float:
    p = np.clip(p_up, eps, 1.0 - eps)
    y = y_true.astype(np.float64)
    return float(-(y * np.log(p) + (1.0 - y) * np.log(1.0 - p)).mean())


def brier_score(y_true: np.ndarray, p_up: np.ndarray) -> float:
    return float(np.mean((p_up - y_true) ** 2))


# ─── Calibration ──────────────────────────────────────────────────────────────


def reliability_curve(
    y_true: np.ndarray,
    p_up: np.ndarray,
    n_bins: int = 10,
) -> dict:
    """Return reliability dict with bin midpoints, observed freq, sample counts.

    Bins are equal-width over [0, 1]. ECE is the sample-weighted mean of
    |observed - predicted| per bin. MCE is the max.
    """
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    bin_idx = np.clip(np.digitize(p_up, edges[1:-1]), 0, n_bins - 1)

    mids = np.zeros(n_bins)
    observed = np.zeros(n_bins)
    predicted = np.zeros(n_bins)
    counts = np.zeros(n_bins, dtype=np.int64)

    for b in range(n_bins):
        mask = bin_idx == b
        n = int(mask.sum())
        counts[b] = n
        mids[b] = (edges[b] + edges[b + 1]) / 2
        if n > 0:
            observed[b] = float(y_true[mask].mean())
            predicted[b] = float(p_up[mask].mean())
        else:
            observed[b] = float("nan")
            predicted[b] = float("nan")

    valid = counts > 0
    if valid.any():
        weights = counts[valid] / counts[valid].sum()
        diffs = np.abs(observed[valid] - predicted[valid])
        ece = float((weights * diffs).sum())
        mce = float(diffs.max())
    else:
        ece, mce = float("nan"), float("nan")

    return {
        "bin_midpoints": mids.tolist(),
        "observed_frequency": observed.tolist(),
        "predicted_frequency": predicted.tolist(),
        "counts": counts.tolist(),
        "ece": ece,
        "mce": mce,
    }


def hit_rate_at(y_true: np.ndarray, p_up: np.ndarray, threshold: float) -> tuple[float, int]:
    """Hit rate among bars where |p - 0.5| crosses (threshold - 0.5).

    For threshold > 0.5: predict up where p_up >= threshold OR predict down
    where p_up <= 1 - threshold; hit-rate = correct / total picks.
    """
    if threshold <= 0.5:
        # All predictions count
        preds = (p_up >= 0.5).astype(np.int8)
        n = preds.size
        if n == 0:
            return float("nan"), 0
        return float((preds == y_true).mean()), int(n)
    up_mask = p_up >= threshold
    dn_mask = p_up <= (1.0 - threshold)
    pick = up_mask | dn_mask
    n = int(pick.sum())
    if n == 0:
        return float("nan"), 0
    preds = up_mask.astype(np.int8)
    correct = int(((preds == y_true) & pick).sum())
    return correct / n, n


# ─── Cost model ───────────────────────────────────────────────────────────────


def _load_cost_model(symbol: str) -> dict:
    try:
        cost = json.loads(_COST_MODEL_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        cost = {}
    s = symbol.upper()
    if s in cost:
        c = cost[s]
        return {
            "round_trip_points": float(c.get("total_round_trip_points", c.get("total_round_trip", 1.0))),
            "point_value": float(c.get("point_value", 1.0)),
        }
    return {"round_trip_points": 0.0, "point_value": 1.0, "fallback_bp": 0.5}


# ─── Trade simulation ─────────────────────────────────────────────────────────


def simulate_pnl(
    close: np.ndarray,
    p_up: np.ndarray,
    threshold: float,
    horizon_bars: int,
    symbol: str,
) -> dict:
    """Trade ON each bar where conviction crosses `threshold`.

    Position rule (one-bar at a time, no compounding inside horizon):
      - p >= threshold        -> long for `horizon_bars` bars, exit at close[i+H]
      - p <= 1-threshold      -> short for `horizon_bars` bars
      - otherwise             -> flat

    Returns dict with cumulative PnL ($), profit factor, hit rate, win/loss
    averages, max drawdown ($ and %), annualized Sharpe of bar returns.
    Sharpe assumes 252 trading days/yr at the bar timeframe — since we don't
    know the timeframe here we just report a unitless ratio; the caller can
    annualize using `bars_per_year`.
    """
    if close.shape != p_up.shape:
        raise ValueError("close and p_up shape mismatch")
    n = close.shape[0]
    cm = _load_cost_model(symbol)
    rtp = cm["round_trip_points"]
    pv = cm["point_value"]
    fallback_bp = cm.get("fallback_bp", 0.0)

    trades_pnl = []
    trade_directions = []
    last_exit = -1
    for i in range(n - horizon_bars):
        if i < last_exit:
            continue
        p = p_up[i]
        if p >= threshold:
            direction = +1
        elif p <= 1.0 - threshold:
            direction = -1
        else:
            continue

        c_in = close[i]
        c_out = close[i + horizon_bars]
        # Points moved (signed by direction)
        move_points = (c_out - c_in) * direction

        if rtp > 0:
            cost_dollars = rtp * pv
        else:
            # Fallback: bp slippage on the entry price
            cost_dollars = (fallback_bp / 10000.0) * c_in * pv

        gross_dollars = move_points * pv
        net = gross_dollars - cost_dollars
        trades_pnl.append(net)
        trade_directions.append(direction)
        last_exit = i + horizon_bars

    pnl_arr = np.asarray(trades_pnl, dtype=np.float64)
    dirs = np.asarray(trade_directions, dtype=np.int8)
    n_trades = pnl_arr.size

    if n_trades == 0:
        return {
            "n_trades": 0,
            "cum_pnl_dollars": 0.0,
            "profit_factor": float("nan"),
            "hit_rate": float("nan"),
            "avg_win_dollars": 0.0,
            "avg_loss_dollars": 0.0,
            "max_drawdown_dollars": 0.0,
            "max_drawdown_pct": 0.0,
            "sharpe_after_costs": 0.0,
            "n_long": 0,
            "n_short": 0,
        }

    cum = np.cumsum(pnl_arr)
    running_peak = np.maximum.accumulate(cum)
    drawdown = cum - running_peak
    max_dd_dollars = float(drawdown.min())  # negative
    peak_at_dd = float(running_peak[drawdown.argmin()])
    max_dd_pct = float(max_dd_dollars / peak_at_dd) if peak_at_dd > 0 else 0.0

    wins = pnl_arr[pnl_arr > 0]
    losses = pnl_arr[pnl_arr < 0]
    profit_factor = float(wins.sum() / abs(losses.sum())) if losses.sum() != 0 else float("inf")
    hit_rate = float((pnl_arr > 0).mean())

    # Sharpe of trade returns (unitless)
    if pnl_arr.std() > 0:
        sharpe_units = float(pnl_arr.mean() / pnl_arr.std() * math.sqrt(n_trades))
    else:
        sharpe_units = 0.0

    return {
        "n_trades": int(n_trades),
        "cum_pnl_dollars": float(cum[-1]),
        "profit_factor": profit_factor,
        "hit_rate": hit_rate,
        "avg_win_dollars": float(wins.mean()) if wins.size else 0.0,
        "avg_loss_dollars": float(losses.mean()) if losses.size else 0.0,
        "max_drawdown_dollars": max_dd_dollars,
        "max_drawdown_pct": max_dd_pct,
        "sharpe_after_costs": sharpe_units,
        "n_long": int((dirs == 1).sum()),
        "n_short": int((dirs == -1).sum()),
        "trade_pnl_dollars": pnl_arr.tolist(),
    }
