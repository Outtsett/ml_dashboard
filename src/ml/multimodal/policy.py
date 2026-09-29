"""The trading policy: which of the day's bracket candidates are taken.

At every decision bar the model gives, for each head (side x reward multiple),
the probability that the bracket ends in a net win; the policy turns that into
an expected net result in points,

    EV = p x (T - c) - (1 - p) x (S + c + slip)

(T, S the bracket's target and stop distances, c the round-trip cost, slip the
stop's extra tick), and walks the session's decision bars in time order:

- one position at a time: a candidate is eligible only if it enters at or after
  the previous trade's exit;
- at a decision bar, the best-EV eligible head is taken when its EV exceeds
  ``threshold_points`` and fewer than ``max_trades`` trades were taken today;
- **every session trades**: if nothing was taken by ``forced_minute`` (Pacific,
  the decision bar's close), the best-EV head at the first eligible decision
  bar from then on is taken whatever its EV.

All of it is causal: a decision uses only that bar's probabilities and the
outcome of trades already closed.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from multimodal.dataset import Dataset
from multimodal.labels import ROUND_TRIP_COST_POINTS, STOP_SLIPPAGE_POINTS


@dataclass(frozen=True)
class PolicyParameters:
    threshold_points: float = 0.0
    max_trades: int = 3
    forced_minute: int = 10 * 60          # 10:00 Pacific
    heads: tuple[str, ...] = ("long_r2", "short_r2", "long_r3", "short_r3")


def expected_value(p: np.ndarray, stop: np.ndarray, target: np.ndarray) -> np.ndarray:
    return p * (target - ROUND_TRIP_COST_POINTS) - (1.0 - p) * (stop + ROUND_TRIP_COST_POINTS + STOP_SLIPPAGE_POINTS)


def simulate(dataset: Dataset, rows: np.ndarray, probabilities: dict[str, np.ndarray], parameters: PolicyParameters) -> pd.DataFrame:
    """Trades taken on `rows` (indices into the dataset), with each trade's labelled outcome."""
    rows = np.sort(np.asarray(rows))
    heads = [h for h in parameters.heads if h in probabilities]
    ev = np.full((rows.size, len(heads)), -np.inf)
    for j, name in enumerate(heads):
        head = dataset.heads[name]
        p = probabilities[name][rows]
        value = expected_value(p, head.stop_points[rows], head.target_points[rows])
        ev[:, j] = np.where(head.available[rows] & np.isfinite(p), value, -np.inf)
    sessions = dataset.keys["session"].to_numpy()[rows]
    stamps = dataset.keys["decision_timestamp"].to_numpy()[rows]
    minute = (stamps % 86400) // 60 + 5
    trades = []
    start = 0
    while start < rows.size:
        end = start
        while end < rows.size and sessions[end] == sessions[start]:
            end += 1
        taken = 0
        free_at = -np.inf
        for k in range(start, end):
            j = int(np.argmax(ev[k]))
            best = ev[k, j]
            if not np.isfinite(best):
                continue
            head = dataset.heads[heads[j]]
            row = rows[k]
            if head.entry_timestamp[row] < free_at:
                continue
            forced = taken == 0 and minute[k] >= parameters.forced_minute
            if (best > parameters.threshold_points and taken < parameters.max_trades) or forced:
                trades.append({
                    "row": int(row), "session": int(sessions[k]), "decision_timestamp": int(stamps[k]), "head": heads[j],
                    "side": head.side, "reward_multiple": head.reward_multiple, "probability": float(probabilities[heads[j]][row]),
                    "expected_points": float(best), "forced": bool(forced and not best > parameters.threshold_points),
                    "net_points": float(head.net_points[row]), "stop_points": float(head.stop_points[row]),
                    "target_points": float(head.target_points[row]),
                    "entry_timestamp": int(head.entry_timestamp[row]), "exit_timestamp": int(head.exit_timestamp[row]),
                })
                taken += 1
                free_at = head.exit_timestamp[row]
        start = end
    return pd.DataFrame(trades)


def grid() -> list[PolicyParameters]:
    """The policy settings searched, walk-forward, on earlier quarters' out-of-sample predictions only."""
    out = []
    for threshold in (-1.0, 0.0, 1.0, 2.0, 4.0):
        for max_trades in (1, 2, 3, 5):
            for forced in (7 * 60, 9 * 60, 11 * 60):
                for heads in (("long_r2", "short_r2"), ("long_r3", "short_r3"), ("long_r2", "short_r2", "long_r3", "short_r3")):
                    out.append(PolicyParameters(threshold, max_trades, forced, heads))
    return out
