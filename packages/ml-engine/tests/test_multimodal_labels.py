"""`packages/ml-engine/src/multimodal/{data,labels}.py` — decision bars and the bracket label.

Every exit rule is checked on hand-built minutes: target, stop, a minute that
touches both (a stop), an open that gaps through a level, the session-end
flatten; the target is wide enough that the net win is at least R x the net
loss after costs; and the ATR at a decision bar never changes when later
minutes are added (causality).
"""

from __future__ import annotations

import numpy as np
import pytest

from multimodal import labels
from multimodal.data import Minutes, decision_bars, session_days

DAY = 86400
MONDAY = 1_717_977_600  # 2024-06-10 00:00 on the Pacific-stamp clock (a Monday)


def minutes_for(path: list[tuple[float, float, float, float]], start_minute: int = 6 * 60 + 30, days_before: int = 1) -> Minutes:
    """RTH minutes: `days_before` flat sessions (to warm the ATR), then `path` as (open, high, low, close) from 06:30."""
    stamps, rows = [], []
    for d in range(days_before):
        for k in range(390):
            stamps.append(MONDAY + d * DAY + (6 * 60 + 30 + k) * 60)
            rows.append((100.0, 101.0, 99.0, 100.0))
    for k, bar in enumerate(path):
        stamps.append(MONDAY + days_before * DAY + (start_minute + k) * 60)
        rows.append(bar)
    arr = np.array(rows, dtype=float)
    ts = np.array(stamps, dtype=np.int64)
    return Minutes(ts, arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3], np.ones(ts.size), session_days(ts), np.array(["MNQM4"] * ts.size), arr[:, 3].copy())


def first_decision(frame, reward, side):
    """The first decision of the LAST session (the earlier sessions only warm the ATR)."""
    last_session = frame["session"].max()
    chosen = frame[(frame["reward_multiple"] == reward) & (frame["side"] == side) & (frame["session"] == last_session)]
    return chosen.sort_values("decision_timestamp").iloc[0]


def test_bracket_distances_leave_a_net_payoff_of_at_least_r():
    stop, target = labels.bracket_distances(np.array([2.0, 23.25, 57.0]), 2.0)
    assert stop[0] == labels.MIN_STOP_TICKS * labels.TICK                       # floored at 4 points
    for s, t in zip(stop, target):
        win = t - labels.ROUND_TRIP_COST_POINTS
        loss = s + labels.ROUND_TRIP_COST_POINTS + labels.STOP_SLIPPAGE_POINTS
        assert win / loss >= 2.0 - 1e-12
        assert abs(t / labels.TICK - round(t / labels.TICK)) < 1e-9          # on the tick grid


def flat_then(path_after_entry):
    """Five flat minutes (the first decision bar, 06:30-06:34) then the given path from 06:35."""
    return [(100.0, 101.0, 99.0, 100.0)] * 5 + path_after_entry


def test_target_stop_both_and_gap_rules():
    atr = 2.0  # every flat bar has range 2 → ATR 2 → stop floored at 4 points
    stop, target = labels.bracket_distances(np.array([atr]), 2.0)
    s, t = float(stop[0]), float(target[0])
    entry = 100.0
    # 1) long target: minute 2 reaches entry + t
    path = flat_then([(entry, entry + 1, entry - 1, entry), (entry, entry + t + 0.25, entry, entry + t)] + [(entry + t,) * 4] * 300)
    out = labels.label(decision_bars(minutes_for(path)))
    row = first_decision(out, 2.0, 1)
    assert row["exit_reason"] == labels.EXIT_TARGET and row["exit_price"] == entry + t
    assert row["net_points"] == pytest.approx(t - labels.ROUND_TRIP_COST_POINTS)
    # the short side of the same path stops out on that minute's high
    short = first_decision(out, 2.0, -1)
    assert short["exit_reason"] == labels.EXIT_STOP and short["exit_price"] == entry + s
    # 2) one minute touching both levels is a stop
    path = flat_then([(entry, entry + t + 1, entry - s - 1, entry)] + [(entry,) * 4] * 300)
    row = first_decision(labels.label(decision_bars(minutes_for(path))), 2.0, 1)
    assert row["exit_reason"] == labels.EXIT_STOP
    assert row["net_points"] == pytest.approx(-s - labels.ROUND_TRIP_COST_POINTS - labels.STOP_SLIPPAGE_POINTS)
    # 3) an open that gaps below the stop fills at that open, worse than the stop
    path = flat_then([(entry, entry + 0.5, entry - 0.5, entry), (entry - s - 3, entry - s - 3, entry - s - 4, entry - s - 3)] + [(entry,) * 4] * 300)
    row = first_decision(labels.label(decision_bars(minutes_for(path))), 2.0, 1)
    assert row["exit_reason"] == labels.EXIT_STOP and row["exit_price"] == entry - s - 3


def test_session_end_flattens_at_the_last_rth_minute():
    path = flat_then([(100.0, 100.5, 99.5, 100.25)] * 385)   # never reaches a level; ends 12:59
    row = first_decision(labels.label(decision_bars(minutes_for(path))), 3.0, 1)
    assert row["exit_reason"] == labels.EXIT_SESSION_END
    assert row["exit_timestamp"] % DAY // 60 == 12 * 60 + 59
    assert row["net_points"] == pytest.approx(0.25 - labels.ROUND_TRIP_COST_POINTS - labels.STOP_SLIPPAGE_POINTS)


def test_decisions_only_between_0635_and_1200_and_atr_is_causal():
    rng = np.random.default_rng(3)
    walk = 100 + np.cumsum(rng.normal(0, 0.5, 390 * 3))
    path = [(p, p + 0.5, p - 0.5, p) for p in walk]
    minutes = minutes_for(path, days_before=0)
    full = decision_bars(minutes).frame
    decisions = full[full["is_decision"]]
    close_minutes = (decisions["timestamp"] % DAY) // 60 + 5
    assert close_minutes.min() >= 6 * 60 + 35 and close_minutes.max() <= 12 * 60
    cut = 390 + 200
    truncated = Minutes(*(getattr(minutes, f)[:cut] for f in Minutes.__dataclass_fields__))
    early = decision_bars(truncated).frame
    n = len(early) - 1   # the last bar of the truncated series may be partial
    assert np.allclose(early["atr_points"].to_numpy()[:n], full["atr_points"].to_numpy()[:n], equal_nan=True)
    assert np.isnan(full["atr_points"].to_numpy()[:19]).all()


def test_a_target_that_is_only_touched_does_not_fill():
    stop, target = labels.bracket_distances(np.array([2.0]), 2.0)
    s, t = float(stop[0]), float(target[0])
    entry = 100.0
    # minute 2 touches the target exactly (no trade-through), then the stop is hit
    path = flat_then([(entry, entry + 0.5, entry - 0.5, entry), (entry, entry + t, entry, entry + t - 1),
                      (entry, entry, entry - s - 0.25, entry - s)] + [(entry,) * 4] * 300)
    row = first_decision(labels.label(decision_bars(minutes_for(path))), 2.0, 1)
    assert row["exit_reason"] == labels.EXIT_STOP


def test_an_incomplete_session_is_left_out():
    # the test session's data stops at 09:30, before the 10:00 minimum: no candidate from it survives
    path = flat_then([(100.0, 100.5, 99.5, 100.0)] * 175)
    out = labels.label(decision_bars(minutes_for(path)))
    assert (out["session"] == out["session"].max()).sum() == 0 or out["decision_timestamp"].max() < MONDAY + DAY
