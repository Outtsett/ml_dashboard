"""Conditional TA-Lib strategies (src/ml/ta_strategy/rules.py, bracket.py): the properties their numbers rest on."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

pytest.importorskip("talib")
pytest.importorskip("numba")

from ta_strategy import bracket, rules  # noqa: E402

TICK = 0.25


def run(o, h, l, c, signal, stop_ticks=4.0, session_last=None, reward=2.0):
    n = len(o)
    session_last = np.zeros(n, dtype=np.bool_) if session_last is None else np.asarray(session_last, dtype=np.bool_)
    session_last[-1] = True
    return bracket.simulate(np.asarray(o, float), np.asarray(h, float), np.asarray(l, float), np.asarray(c, float),
                            np.asarray(signal, np.int8), np.full(n, stop_ticks), session_last, np.zeros(n, np.bool_),
                            TICK, reward)


def test_long_hits_target_at_two_to_one():
    # signal at bar 0 close -> enter bar 1 open 100; stop 99 (4 ticks), target 102
    o = [100, 100, 100.5, 101]
    h = [100, 100.5, 102.25, 101]
    l = [100, 99.5, 100.25, 101]
    c = [100, 100.25, 102, 101]
    e_i, x_i, side, e_p, x_p, st, why, rolls = run(o, h, l, c, [1, 0, 0, 0])
    assert (e_i[0], x_i[0], side[0], e_p[0], x_p[0], why[0]) == (1, 2, 1, 100.0, 102.0, bracket.EXIT_TARGET)


def test_both_levels_in_one_bar_is_a_stop():
    o = [100, 100, 100]
    h = [100, 102.5, 100]
    l = [100, 98.5, 100]
    c = [100, 100, 100]
    *_, x_p, _, why, _ = run(o, h, l, c, [1, 0, 0])
    assert why[0] == bracket.EXIT_STOP and x_p[0] == 99.0


def test_gap_through_the_stop_fills_at_the_open():
    o = [100, 100, 97.0]
    h = [100, 100.5, 97.5]
    l = [100, 99.5, 96.5]
    c = [100, 100.25, 97]
    *_, x_p, _, why, _ = run(o, h, l, c, [1, 0, 0])
    assert why[0] == bracket.EXIT_STOP and x_p[0] == 97.0


def test_short_and_session_end_exit():
    o = [100, 100, 100, 100]
    h = [100, 100.5, 100.5, 100.5]
    l = [100, 99.5, 99.5, 99.5]
    c = [100, 100, 99.75, 100]
    session_last = [False, False, True, False]
    *_, side, e_p, x_p, _, why, _ = run(o, h, l, c, [-1, 0, 0, 0], session_last=session_last)[:8]
    assert side[0] == -1 and why[0] == bracket.EXIT_SESSION_END and x_p[0] == 99.75


def test_no_entry_on_a_session_last_bar_and_signals_ignored_while_in_a_trade():
    o = [100] * 6
    h = [100.5] * 6
    l = [99.5] * 6
    c = [100] * 6
    e_i, *_ = run(o, h, l, c, [1, 1, 1, 0, 0, 0], session_last=[True, False, False, False, False, False])
    # bar 0 is a session's last bar -> no entry from its signal; bar 1's signal enters at bar 2; bar 2's is ignored
    assert e_i.tolist() == [2]


def random_frame(n=3000, seed=1):
    rng = np.random.default_rng(seed)
    c = 10000 + np.cumsum(rng.normal(0, 5, n))
    o = c + rng.normal(0, 2, n)
    h = np.maximum(o, c) + rng.gamma(2, 2, n)
    l = np.minimum(o, c) - rng.gamma(2, 2, n)
    return pd.DataFrame({"timestamp": 1_600_000_000 + 3600 * np.arange(n), "open": o, "high": h, "low": l, "close": c,
                         "volume": rng.integers(100, 2000, n).astype(float)})


ALL_RULES = [
    rules.make_rule("ema_cross", fast=9, slow=21), rules.make_rule("macd_cross", fast=12, slow=26, signal=9),
    rules.make_rule("rsi_reversal", period=14, low=30, high=70), rules.make_rule("rsi_momentum", period=14, level=60),
    rules.make_rule("bollinger_breakout", period=20, width=2.0), rules.make_rule("bollinger_reversion", period=20, width=2.0),
    rules.make_rule("donchian_breakout", period=20), rules.make_rule("keltner_breakout", period=20, multiple=2.0),
    rules.make_rule("stochastic_cross", k=14, d=3, low=20, high=80), rules.make_rule("cci_cross", period=20, level=100),
    rules.make_rule("williams_reversal", period=14, low=-80, high=-20),
    rules.make_rule("directional_cross", period=14, adx_minimum=20),
    rules.make_rule("parabolic_sar_flip", acceleration=0.02, maximum=0.2), rules.make_rule("aroon_cross", period=25),
    rules.make_rule("triple_ema_alignment", fast=8, middle=21, slow=55),
    rules.make_rule("engulfing_at_band", period=20, width=2.0),
]


@pytest.mark.parametrize("rule", ALL_RULES, ids=lambda r: r.rule_id)
def test_rules_are_causal_and_fire(rule):
    frame = random_frame()
    full = rule.signal(rules.bars_dict(frame))
    prefix = rule.signal(rules.bars_dict(frame.iloc[:2000]))
    assert np.array_equal(full[:2000], prefix)
    assert (full != 0).sum() > 0


@pytest.mark.parametrize("rule", ALL_RULES, ids=lambda r: r.rule_id)
def test_rules_do_not_change_under_a_roll_shift(rule):
    frame = random_frame()
    shifted = frame.copy()
    for column in ("open", "high", "low", "close"):
        shifted[column] += 2500.0
    a = rule.signal(rules.bars_dict(frame))
    b = rule.signal(rules.bars_dict(shifted))
    assert (a != b).mean() < 0.001, f"{(a != b).sum()} signals change under a shift"


def test_filters():
    frame = random_frame()
    b = rules.bars_dict(frame)
    signal = rules.make_rule("ema_cross", fast=9, slow=21).signal(b)
    minute = np.full(len(frame), 3 * 60)            # 03:00 Pacific: outside regular hours
    assert (rules.apply_filter(signal, "rth", b, minute) == 0).all()
    trend = rules.apply_filter(signal, "trend", b, minute)
    assert set(np.flatnonzero(trend)) <= set(np.flatnonzero(signal))
