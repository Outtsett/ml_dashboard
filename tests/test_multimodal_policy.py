"""`src/ml/multimodal/{walkforward,policy,metrics}.py`.

Folds never let a test quarter's rows (or the session before it) into training;
the policy trades every session, never holds two positions, and only takes a
non-forced trade whose expected value clears the threshold; the gate metrics
reproduce hand-computed numbers.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from multimodal import metrics, policy, walkforward
from multimodal.dataset import Dataset, Head

EPOCH_2020 = 18262   # 2020-01-01 as days since the epoch


def sessions(n_days: int) -> np.ndarray:
    days = np.arange(EPOCH_2020, EPOCH_2020 + int(n_days * 1.5))
    weekdays = days[((days + 3) % 7) < 5]
    return weekdays[:n_days]


def test_folds_are_ordered_purged_and_disjoint():
    per_day = 10
    days = sessions(700)
    rows = np.repeat(days, per_day)
    for fold in walkforward.folds(rows):
        train_days, valid_days, test_days = (np.unique(rows[ix]) for ix in (fold.train, fold.validation, fold.test))
        assert train_days.max() < valid_days.min() and valid_days.max() < test_days.min()
        assert np.setdiff1d(days[(days > train_days.max()) & (days < valid_days.min())], []).size >= walkforward.PURGE_SESSIONS
        assert np.setdiff1d(days[(days > valid_days.max()) & (days < test_days.min())], []).size >= walkforward.PURGE_SESSIONS
        assert set(walkforward.quarter_of(test_days)) == {fold.name}


def toy_dataset(n_sessions: int = 5, bars_per_session: int = 6) -> Dataset:
    days = sessions(n_sessions)
    stamps, session_of = [], []
    for day in days:
        for k in range(bars_per_session):
            stamps.append(int(day) * 86400 + (7 * 60 + 5 * k) * 60)   # 07:00, 07:05, ... Pacific-stamp clock
            session_of.append(int(day))
    stamps = np.array(stamps)
    keys = pd.DataFrame({"decision_timestamp": stamps, "session": np.array(session_of)})
    n = stamps.size
    heads = {}
    for name, side in (("long_r2", 1), ("short_r2", -1)):
        net = np.where(np.arange(n) % 2 == 0, 10.0, -5.0) * (1 if side > 0 else -1)
        heads[name] = Head(side=side, reward_multiple=2.0, win=(net > 0).astype(np.int8), net_points=net,
                           stop_points=np.full(n, 5.0), target_points=np.full(n, 12.0),
                           entry_timestamp=stamps + 300, exit_timestamp=stamps + 300 + 600, available=np.ones(n, bool))
    return Dataset(keys=keys, features=pd.DataFrame({"price_x": np.zeros(n)}), heads=heads)


def test_every_session_trades_and_positions_never_overlap():
    data = toy_dataset()
    rows = np.arange(len(data.keys))
    probabilities = {"long_r2": np.full(rows.size, 0.1), "short_r2": np.full(rows.size, 0.1)}   # nothing clears the threshold
    params = policy.PolicyParameters(threshold_points=0.0, max_trades=3, forced_minute=7 * 60 + 15, heads=("long_r2", "short_r2"))
    trades = policy.simulate(data, rows, probabilities, params)
    assert trades["session"].nunique() == data.keys["session"].nunique()        # one forced trade per session
    assert trades["forced"].all()
    for _, day in trades.groupby("session"):
        assert (day["entry_timestamp"].to_numpy()[1:] >= day["exit_timestamp"].to_numpy()[:-1]).all()


def test_a_clear_edge_is_taken_up_to_max_trades():
    data = toy_dataset()
    rows = np.arange(len(data.keys))
    probabilities = {"long_r2": np.full(rows.size, 0.9), "short_r2": np.full(rows.size, 0.1)}
    params = policy.PolicyParameters(threshold_points=0.5, max_trades=2, forced_minute=12 * 60, heads=("long_r2", "short_r2"))
    trades = policy.simulate(data, rows, probabilities, params)
    assert (trades.groupby("session").size() <= 2).all()
    assert (trades["head"] == "long_r2").all() and not trades["forced"].any()
    ev = policy.expected_value(np.array([0.9]), np.array([5.0]), np.array([12.0]))[0]
    assert np.isclose(trades["expected_points"].iloc[0], ev)


def test_gate_metrics_match_hand_computation():
    trades = pd.DataFrame({"session": [1, 1, 2, 3, 4], "net_points": [10.0, -5.0, 12.0, -4.0, 8.0], "forced": [False] * 5})
    s = metrics.summary(trades, np.array([1, 2, 3, 4]))
    assert s["trade_count"] == 5 and s["sessions_traded_share"] == 1.0
    assert np.isclose(s["win_rate"], 3 / 5)
    assert np.isclose(s["payoff_ratio"], (30 / 3) / (9 / 2))
    assert np.isclose(s["profit_factor"], 30 / 9)
    assert np.isclose(s["net_profit_usd"], 21 * 2.0)
    assert s["gate"]["G1"] and s["gate"]["G2"] and s["gate"]["G3"] and s["gate"]["G4"]
    missing_day = metrics.summary(trades[trades["session"] != 4], np.array([1, 2, 3, 4]))
    assert not missing_day["gate"]["G2"]
