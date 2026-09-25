"""Scoreboard metrics for the Model Cycle.

Names are exactly ``CYCLE_METRIC_NAMES`` in ``src/shared/cycle/schema.ts``.
Every undefined number is ``None`` (serialised as null), never 0.

Trading (per-bar, marked to market, costs included):
    sharpe_ratio   = mean(r) / std(r, ddof=1) * sqrt(barsPerYear)      None if < 2 bars or std 0
    sortino_ratio  = mean(r) / sqrt(mean(min(r, 0)^2)) * sqrt(barsPerYear)   None if no negative bar
    maximum_drawdown_usd = largest peak-to-trough fall of equity (starting at 0), a POSITIVE number
    calmar_ratio   = mean(r) * barsPerYear / maximum_drawdown_usd       None if drawdown 0
Trades (closed trades' net USD):
    profit_factor  = gross profit / |gross loss|                         None (+ note) with no losing trade
    expectancy_usd = win_rate * average_win - (1 - win_rate) * |average_loss|
                     (a missing side contributes 0)
Classification (scored bars: label known, outside the threshold, and predicted;
positive class = up):
    accuracy, balanced_accuracy, precision, recall, f1_score, macro_f1_score,
    roc_auc (None with one class), log_loss, brier_score — sklearn semantics.
Baselines:
    majority_class_accuracy — each scored bar predicted as its fold's training
    majority class; buy_and_hold_net_profit_usd — per fold (last close - first
    open) * point value * contracts - one round trip, summed.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

METRIC_NAMES = (
    "net_profit_usd",
    "sharpe_ratio",
    "sortino_ratio",
    "calmar_ratio",
    "maximum_drawdown_usd",
    "profit_factor",
    "win_rate",
    "trade_count",
    "average_trade_usd",
    "expectancy_usd",
    "exposure_fraction",
    "gross_profit_usd",
    "gross_loss_usd",
    "total_cost_usd",
    "accuracy",
    "balanced_accuracy",
    "precision",
    "recall",
    "f1_score",
    "macro_f1_score",
    "roc_auc",
    "log_loss",
    "brier_score",
    "majority_class_accuracy",
    "buy_and_hold_net_profit_usd",
)

MINIMUM_CREDIBLE_TRADES = 30


def _finite(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) else None


# A gap longer than this is a data outage, not a weekend or a holiday.
OUTAGE_DAYS = 4.0


def bars_per_year(timestamps: np.ndarray) -> float:
    """Bars per calendar year measured on the loaded data, over the time the
    data actually covers.

    Weekends and holidays stay in the span — they are part of the calendar the
    annualisation is for — but an outage longer than ``OUTAGE_DAYS`` is taken
    out. Counting it (bars / first-to-last span) shrank the factor whenever a
    window crossed a hole: MNQ 5m over 2025-10-01..2026-03-07 measured 44,317
    against 71,722 on the dense part, which cut every Sharpe and Sortino by
    ×0.79 and Calmar by ×0.62.
    """
    timestamps = np.asarray(timestamps, dtype=np.int64)
    if timestamps.size < 2:
        raise ValueError("need at least two bars to measure bars per year")
    gaps = np.diff(timestamps)
    outage_seconds = int(gaps[gaps > OUTAGE_DAYS * 86400].sum())
    covered_days = (int(timestamps[-1]) - int(timestamps[0]) - outage_seconds) / 86400.0
    if covered_days <= 0:
        raise ValueError("the loaded bars span no time")
    return float(timestamps.size / (covered_days / 365.25))


# ── trading ────────────────────────────────────────────────────────────────


def sharpe_ratio(returns: np.ndarray, periods_per_year: float) -> float | None:
    r = np.asarray(returns, dtype=np.float64)
    if r.size < 2:
        return None
    std = float(np.std(r, ddof=1))
    if std == 0.0 or not math.isfinite(std):
        return None
    return _finite(np.mean(r) / std * math.sqrt(periods_per_year))


def sortino_ratio(returns: np.ndarray, periods_per_year: float) -> float | None:
    r = np.asarray(returns, dtype=np.float64)
    if r.size == 0 or not np.any(r < 0):
        return None
    downside = math.sqrt(float(np.mean(np.minimum(r, 0.0) ** 2)))
    return _finite(np.mean(r) / downside * math.sqrt(periods_per_year))


def maximum_drawdown(returns: np.ndarray) -> float:
    r = np.asarray(returns, dtype=np.float64)
    if r.size == 0:
        return 0.0
    equity = np.concatenate([[0.0], np.cumsum(r)])
    peak = np.maximum.accumulate(equity)
    return float(np.max(peak - equity))


def calmar_ratio(returns: np.ndarray, periods_per_year: float) -> float | None:
    r = np.asarray(returns, dtype=np.float64)
    if r.size == 0:
        return None
    drawdown = maximum_drawdown(r)
    if drawdown == 0.0:
        return None
    return _finite(np.mean(r) * periods_per_year / drawdown)


def trade_statistics(trade_nets: np.ndarray) -> tuple[dict, list[str]]:
    nets = np.asarray(trade_nets, dtype=np.float64)
    notes: list[str] = []
    wins = nets[nets > 0]
    losses = nets[nets < 0]
    count = int(nets.size)
    gross_profit = float(wins.sum())
    gross_loss = float(losses.sum())
    if count == 0:
        notes.append("no closed trades: profit factor, win rate, average trade and expectancy are undefined")
        profit_factor = None
    elif losses.size == 0:
        notes.append("profit factor undefined: no losing trades")
        profit_factor = None
    else:
        profit_factor = gross_profit / abs(gross_loss)
    if 0 < count < MINIMUM_CREDIBLE_TRADES:
        notes.append(f"only {count} closed trades (fewer than {MINIMUM_CREDIBLE_TRADES}): trade statistics are noisy")
    win_rate = wins.size / count if count else None
    average_win = float(wins.mean()) if wins.size else None
    average_loss = float(losses.mean()) if losses.size else None
    if count:
        expectancy = (win_rate or 0.0) * (average_win or 0.0) - (1.0 - (win_rate or 0.0)) * abs(average_loss or 0.0)
    else:
        expectancy = None
    return (
        {
            "profit_factor": _finite(profit_factor),
            "win_rate": _finite(win_rate),
            "trade_count": float(count),
            "average_trade_usd": _finite(nets.mean()) if count else None,
            "expectancy_usd": _finite(expectancy),
            "gross_profit_usd": gross_profit,
            "gross_loss_usd": gross_loss,
        },
        notes,
    )


def distribution(values: np.ndarray) -> dict:
    """The eight-number summary plus count. Skewness and excess kurtosis are
    bias-corrected and None below four values."""
    v = np.asarray(values, dtype=np.float64)
    count = int(v.size)
    out: dict = {"count": count}
    if count == 0:
        for key in ("mean", "median", "standardDeviation", "skewness", "kurtosis",
                    "percentile25", "percentile75", "minimum", "maximum"):
            out[key] = None
        return out
    out["mean"] = _finite(v.mean())
    out["median"] = _finite(np.median(v))
    out["standardDeviation"] = _finite(np.std(v, ddof=1)) if count >= 2 else None
    if count >= 4:
        from scipy.stats import kurtosis, skew

        out["skewness"] = _finite(skew(v, bias=False))
        out["kurtosis"] = _finite(kurtosis(v, fisher=True, bias=False))
    else:
        out["skewness"] = None
        out["kurtosis"] = None
    out["percentile25"] = _finite(np.percentile(v, 25))
    out["percentile75"] = _finite(np.percentile(v, 75))
    out["minimum"] = _finite(v.min())
    out["maximum"] = _finite(v.max())
    return out


# ── classification ─────────────────────────────────────────────────────────


def classification_metrics(actual_up: np.ndarray, predicted_up: np.ndarray, probability_up: np.ndarray) -> dict:
    """``actual_up`` / ``predicted_up``: 1 up, 0 down. Undefined -> None."""
    y = np.asarray(actual_up, dtype=np.int64)
    yhat = np.asarray(predicted_up, dtype=np.int64)
    p = np.asarray(probability_up, dtype=np.float64)
    names = ("accuracy", "balanced_accuracy", "precision", "recall", "f1_score",
             "macro_f1_score", "roc_auc", "log_loss", "brier_score")
    if y.size == 0:
        return {name: None for name in names}
    out: dict = {"accuracy": float(np.mean(y == yhat))}

    recalls = []
    for cls in (0, 1):
        support = np.sum(y == cls)
        if support:
            recalls.append(np.sum((y == cls) & (yhat == cls)) / support)
    out["balanced_accuracy"] = float(np.mean(recalls))

    tp = int(np.sum((y == 1) & (yhat == 1)))
    fp = int(np.sum((y == 0) & (yhat == 1)))
    fn = int(np.sum((y == 1) & (yhat == 0)))
    out["precision"] = tp / (tp + fp) if (tp + fp) else None
    out["recall"] = tp / (tp + fn) if (tp + fn) else None
    out["f1_score"] = 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else None

    per_class = []
    for cls in sorted(set(y.tolist()) | set(yhat.tolist())):
        tpc = int(np.sum((y == cls) & (yhat == cls)))
        fpc = int(np.sum((y != cls) & (yhat == cls)))
        fnc = int(np.sum((y == cls) & (yhat != cls)))
        per_class.append(2 * tpc / (2 * tpc + fpc + fnc))
    out["macro_f1_score"] = float(np.mean(per_class))

    if len(np.unique(y)) < 2:
        out["roc_auc"] = None
    else:
        from sklearn.metrics import roc_auc_score

        out["roc_auc"] = float(roc_auc_score(y, p))
    eps = np.finfo(np.float64).eps
    clipped = np.clip(p, eps, 1 - eps)
    out["log_loss"] = float(-np.mean(y * np.log(clipped) + (1 - y) * np.log(1 - clipped)))
    out["brier_score"] = float(np.mean((p - y) ** 2))
    return {name: _finite(out[name]) for name in names}


# ── scoreboard ─────────────────────────────────────────────────────────────


@dataclass
class ScoreInputs:
    """Everything one scope (running / fold / final) is scored from."""

    bar_net_usd: list[float] = field(default_factory=list)
    bar_exposed: list[bool] = field(default_factory=list)
    trade_nets: list[float] = field(default_factory=list)
    total_cost_usd: float = 0.0
    scored_actual_up: list[int] = field(default_factory=list)
    scored_predicted_up: list[int] = field(default_factory=list)
    scored_probability_up: list[float] = field(default_factory=list)
    scored_majority_up: list[int] = field(default_factory=list)
    buy_and_hold_usd: float | None = None


def scoreboard(inputs: ScoreInputs, periods_per_year: float) -> tuple[dict, dict, list[str]]:
    """Returns (metrics, tradeDistribution, notes)."""
    r = np.asarray(inputs.bar_net_usd, dtype=np.float64)
    metrics: dict = {}
    metrics["net_profit_usd"] = float(r.sum()) if r.size else 0.0
    metrics["sharpe_ratio"] = sharpe_ratio(r, periods_per_year)
    metrics["sortino_ratio"] = sortino_ratio(r, periods_per_year)
    metrics["calmar_ratio"] = calmar_ratio(r, periods_per_year)
    metrics["maximum_drawdown_usd"] = maximum_drawdown(r)
    trades, notes = trade_statistics(np.asarray(inputs.trade_nets, dtype=np.float64))
    metrics.update(trades)
    metrics["exposure_fraction"] = float(np.mean(inputs.bar_exposed)) if len(inputs.bar_exposed) else None
    metrics["total_cost_usd"] = float(inputs.total_cost_usd)
    metrics.update(
        classification_metrics(
            np.asarray(inputs.scored_actual_up), np.asarray(inputs.scored_predicted_up),
            np.asarray(inputs.scored_probability_up),
        )
    )
    if inputs.scored_majority_up:
        metrics["majority_class_accuracy"] = float(
            np.mean(np.asarray(inputs.scored_majority_up) == np.asarray(inputs.scored_actual_up))
        )
    else:
        metrics["majority_class_accuracy"] = None
    metrics["buy_and_hold_net_profit_usd"] = _finite(inputs.buy_and_hold_usd)
    if r.size and metrics["sharpe_ratio"] is None:
        notes.append("Sharpe undefined: fewer than two bars or no variation in per-bar profit")
    if r.size and metrics["sortino_ratio"] is None:
        notes.append("Sortino undefined: no losing bar")
    if not inputs.scored_actual_up:
        notes.append("no scored bars yet: classification metrics are undefined")
    ordered = {name: metrics.get(name) for name in METRIC_NAMES}
    return ordered, distribution(np.asarray(inputs.trade_nets, dtype=np.float64)), notes


def buy_and_hold_usd(first_open: float, last_close: float, point_value: float, contracts: int, round_trip: float) -> float:
    return (float(last_close) - float(first_open)) * point_value * contracts - round_trip * contracts
