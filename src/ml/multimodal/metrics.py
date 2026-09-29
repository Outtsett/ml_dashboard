"""The acceptance-gate metrics for a set of trades (docs/plans/2026-09-29-multimodal/PLAN.md).

G1 profitable, G2 every session trades, G3 win rate >= 40%, G4 average net win
>= 2x average net loss AND profit factor >= 2, G5 robustness (block-bootstrap
lower bound by session day > 0, >= 75% of quarters positive, still positive
with one more tick of slippage per side).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from multimodal.labels import POINT_VALUE_USD, TICK

WIN_RATE_MINIMUM = 0.40
PAYOFF_MINIMUM = 2.0
PROFIT_FACTOR_MINIMUM = 2.0
QUARTERS_POSITIVE_MINIMUM = 0.75
STRESS_POINTS_PER_TRADE = 2 * TICK       # one more tick per side
BOOTSTRAP_RESAMPLES = 2000


def summary(trades: pd.DataFrame, sessions: np.ndarray, quarters: dict[int, str] | None = None, seed: int = 7) -> dict:
    """Every gate number for the trades taken over `sessions` (all the sessions that could have traded)."""
    sessions = np.unique(np.asarray(sessions, dtype=np.int64))
    out: dict = {"session_count": int(sessions.size), "trade_count": int(len(trades))}
    if trades.empty:
        out.update({"net_profit_usd": 0.0, "sessions_traded_share": 0.0, "win_rate": np.nan, "payoff_ratio": np.nan,
                    "profit_factor": np.nan, "gate": {"G1": False, "G2": False, "G3": False, "G4": False, "G5": False}})
        return out
    net = trades["net_points"].to_numpy(float)
    wins, losses = net[net > 0], net[net <= 0]
    daily = trades.groupby("session")["net_points"].sum().reindex(sessions, fill_value=0.0)
    out["net_profit_points"] = float(net.sum())
    out["net_profit_usd"] = float(net.sum() * POINT_VALUE_USD)
    out["sessions_traded_share"] = float(trades["session"].nunique() / sessions.size)
    out["trades_per_session"] = float(len(trades) / sessions.size)
    out["forced_trade_share"] = float(trades["forced"].mean()) if "forced" in trades else np.nan
    out["win_rate"] = float((net > 0).mean())
    out["average_win_points"] = float(wins.mean()) if wins.size else np.nan
    out["average_loss_points"] = float(-losses.mean()) if losses.size else np.nan
    out["payoff_ratio"] = float(wins.mean() / -losses.mean()) if wins.size and losses.size and losses.mean() < 0 else np.nan
    out["profit_factor"] = float(wins.sum() / -losses.sum()) if losses.size and losses.sum() < 0 else np.nan
    out["expectancy_points"] = float(net.mean())
    out["daily_sharpe_annualised"] = float(daily.mean() / daily.std(ddof=1) * np.sqrt(252)) if daily.std(ddof=1) > 0 else np.nan
    equity = daily.cumsum().to_numpy()
    out["maximum_drawdown_usd"] = float((np.maximum.accumulate(equity) - equity).max() * POINT_VALUE_USD)
    rng = np.random.default_rng(seed)
    draws = rng.integers(0, daily.size, size=(BOOTSTRAP_RESAMPLES, daily.size))
    totals = daily.to_numpy()[draws].sum(axis=1)
    out["bootstrap_total_points_lower_95"] = float(np.quantile(totals, 0.025))
    out["bootstrap_probability_profitable"] = float((totals > 0).mean())
    stressed = net - STRESS_POINTS_PER_TRADE
    out["stressed_net_profit_usd"] = float(stressed.sum() * POINT_VALUE_USD)
    if quarters:
        by_quarter = trades.assign(quarter=trades["session"].map(quarters)).groupby("quarter")["net_points"].sum()
        out["quarters_positive_share"] = float((by_quarter > 0).mean())
        out["quarter_net_points"] = {str(k): float(v) for k, v in by_quarter.items()}
    else:
        out["quarters_positive_share"] = np.nan
    out["gate"] = {
        "G1": out["net_profit_usd"] > 0,
        "G2": out["sessions_traded_share"] >= 1.0,
        "G3": out["win_rate"] >= WIN_RATE_MINIMUM,
        "G4": bool(out["payoff_ratio"] >= PAYOFF_MINIMUM and out["profit_factor"] >= PROFIT_FACTOR_MINIMUM),
        "G5": bool(out["bootstrap_total_points_lower_95"] > 0 and out["stressed_net_profit_usd"] > 0
                   and (np.isnan(out["quarters_positive_share"]) or out["quarters_positive_share"] >= QUARTERS_POSITIVE_MINIMUM)),
    }
    return out
