"""How much of the best development trial is selection luck: the deflated Sharpe ratio and the
probability of backtest overfitting (PBO), over every trial in the ledger.

    s3://derived/multimodal_overfitting/recipe=<date>/table=trials       per-trial daily Sharpe on the shared sessions
    s3://derived/multimodal_overfitting/recipe=<date>/table=summary      deflated Sharpe of the best, PBO

- Daily net P&L per trial on the canonical window's sessions (a session without a trade is 0).
- Deflated Sharpe ratio (Bailey & Lopez de Prado 2014): the probability that the best trial's true
  Sharpe exceeds the expected maximum Sharpe of N trials with no skill, given the variance of the
  trials' Sharpes and the skewness and kurtosis of the best trial's returns.
- PBO by combinatorially symmetric cross-validation (Bailey et al. 2017): the sessions are split into
  S blocks; for every half/half combination the trial that is best in-sample is ranked out of sample;
  PBO is the share of combinations where it falls below the median.

    .venv/Scripts/python.exe scripts/multimodal/overfitting_report.py
"""

from __future__ import annotations

import itertools
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
from scipy import stats

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from multimodal.lake_io import write_table  # noqa: E402

CANONICAL_FIRST_QUARTER = "2021Q2"
BLOCKS = 16
EULER_GAMMA = 0.5772156649


def daily_matrix(connection) -> pd.DataFrame:
    trades = connection.execute(
        "SELECT recipe, session, quarter, net_points FROM derived_multimodal_runs_trades "
        f"WHERE recipe NOT LIKE 'gate_%' AND quarter >= '{CANONICAL_FIRST_QUARTER}'"
    ).df()
    daily = trades.groupby(["session", "recipe"])["net_points"].sum().unstack("recipe")
    # sessions every trial could trade: the union of their traded sessions (every trial trades every session)
    return daily.fillna(0.0).sort_index()


def sharpe(x: np.ndarray) -> float:
    s = x.std(ddof=1)
    return float(x.mean() / s) if s > 0 else 0.0


def deflated_sharpe(best: np.ndarray, sharpes: np.ndarray) -> dict:
    n_trials = sharpes.size
    t = best.size
    sr = sharpe(best)
    variance = float(np.var(sharpes, ddof=1)) if n_trials > 1 else 0.0
    expected_max = np.sqrt(variance) * ((1 - EULER_GAMMA) * stats.norm.ppf(1 - 1 / n_trials)
                                        + EULER_GAMMA * stats.norm.ppf(1 - 1 / (n_trials * np.e))) if n_trials > 1 else 0.0
    skew = float(stats.skew(best))
    kurt = float(stats.kurtosis(best, fisher=False))
    denominator = np.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr ** 2))
    dsr = float(stats.norm.cdf((sr - expected_max) * np.sqrt(t - 1) / denominator))
    return {"best_daily_sharpe": sr, "best_annualised_sharpe": sr * np.sqrt(252), "trials": n_trials,
            "expected_maximum_daily_sharpe_of_null_trials": float(expected_max), "skewness": skew, "kurtosis": kurt,
            "deflated_sharpe_probability": dsr}


def probability_of_backtest_overfitting(matrix: np.ndarray, blocks: int = BLOCKS) -> dict:
    t, n = matrix.shape
    if n < 2:
        return {"pbo": float("nan"), "combinations": 0}
    edges = np.linspace(0, t, blocks + 1).astype(int)
    parts = [np.arange(edges[i], edges[i + 1]) for i in range(blocks)]
    below = 0
    logits = []
    combos = list(itertools.combinations(range(blocks), blocks // 2))
    for combo in combos:
        inside = np.concatenate([parts[i] for i in combo])
        outside = np.concatenate([parts[i] for i in range(blocks) if i not in combo])
        in_sharpe = np.array([sharpe(matrix[inside, j]) for j in range(n)])
        out_sharpe = np.array([sharpe(matrix[outside, j]) for j in range(n)])
        chosen = int(np.argmax(in_sharpe))
        rank = (out_sharpe < out_sharpe[chosen]).sum() + 0.5 * ((out_sharpe == out_sharpe[chosen]).sum() - 1)
        relative = (rank + 1) / (n + 1)
        logits.append(np.log(relative / (1 - relative)))
        below += relative <= 0.5
    return {"pbo": float(below / len(combos)), "combinations": len(combos), "median_logit": float(np.median(logits))}


def main() -> int:
    from lake.serving import connect

    connection = connect(with_bars=False)
    matrix = daily_matrix(connection)
    sharpes = matrix.apply(lambda c: sharpe(c.to_numpy())).sort_values(ascending=False)
    best = sharpes.index[0]
    dsr = deflated_sharpe(matrix[best].to_numpy(), sharpes.to_numpy())
    pbo = probability_of_backtest_overfitting(matrix.to_numpy())
    summary = {"sessions": int(matrix.shape[0]), "best_trial": best, **dsr, **pbo}
    print(json.dumps(summary, indent=1, default=float))
    recipe = f"report_{date.today():%Y_%m_%d}"
    per_trial = pd.DataFrame({"trial": sharpes.index, "daily_sharpe": sharpes.to_numpy(),
                              "annualised_sharpe": sharpes.to_numpy() * np.sqrt(252),
                              "net_points": [float(matrix[c].sum()) for c in sharpes.index]})
    write_table("multimodal_overfitting", recipe, "trials", pa.Table.from_pandas(per_trial, preserve_index=False), source="scripts/multimodal/overfitting_report.py")
    write_table("multimodal_overfitting", recipe, "summary", pa.Table.from_pandas(pd.DataFrame([{"summary_json": json.dumps(summary, default=float)}]), preserve_index=False),
                source="scripts/multimodal/overfitting_report.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
