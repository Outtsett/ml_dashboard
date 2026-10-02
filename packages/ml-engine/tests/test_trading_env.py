"""Unit tests for src.ml.blocks.trading_env.TradingEnv (W9.a).

Numpy-only -- no torch import.  Verifies the gymnasium 1.0 API contract:
reset returns (obs, info), step returns (obs, reward, terminated, truncated,
info), observation shape matches the declared Box, and reward math matches
the cost-aware contract documented in trading_env.py:

    reward_t = position_t * (price_{t+1} - price_t) * point_value
             - sides_traded_t * cost_per_side

where position_t is the action just decided (next-bar fill convention).
"""

from __future__ import annotations

import numpy as np
import pytest
from core.blocks.trading_env import (
    ACTION_HOLD,
    ACTION_LONG,
    ACTION_SHORT,
    POSITION_FLAT,
    POSITION_LONG,
    POSITION_SHORT,
    TradingEnv,
)

# MNQ-shaped cost model (matches packages/config/cost_model.json).
_COST_MODEL = {
    "point_value": 2.00,
    "total_per_side": 1.40,
}


def _make_env(
    *,
    n_bars: int = 100,
    n_features: int = 4,
    window_size: int = 8,
    price_step: float = 1.0,
) -> TradingEnv:
    """Build a deterministic env: features are row indices, prices are a
    linear ramp price_step * t.  Lets us hand-compute expected rewards."""
    rng = np.random.default_rng(42)
    features = rng.standard_normal(size=(n_bars, n_features)).astype(np.float32)
    prices = np.arange(n_bars, dtype=np.float64) * price_step
    return TradingEnv(
        features=features,
        prices=prices,
        cost_model=_COST_MODEL,
        window_size=window_size,
    )


# --------------------------------------------------------------------------- #
# Test 1 -- reset shape contract + gymnasium 1.0 API tuple shape
# --------------------------------------------------------------------------- #


def test_reset_returns_obs_and_info_with_correct_shape() -> None:
    env = _make_env(n_bars=50, n_features=4, window_size=8)

    result = env.reset(seed=0)
    assert isinstance(result, tuple) and len(result) == 2, (
        "gymnasium 1.0 reset must return (obs, info) tuple"
    )
    obs, info = result

    assert isinstance(obs, np.ndarray)
    assert obs.shape == (8, 4), f"expected (window, features) = (8, 4); got {obs.shape}"
    assert obs.dtype == np.float32

    assert isinstance(info, dict)
    assert info["position"] == POSITION_FLAT
    assert info["bar_index"] == 7  # window_size - 1
    assert info["pnl"] == 0.0


# --------------------------------------------------------------------------- #
# Test 2 -- hold action has zero reward (no position + no transaction)
# --------------------------------------------------------------------------- #


def test_hold_action_yields_zero_reward() -> None:
    env = _make_env(n_bars=50, n_features=4, window_size=8, price_step=1.0)
    env.reset(seed=0)

    obs, reward, terminated, truncated, info = env.step(ACTION_HOLD)
    assert reward == 0.0, "hold from flat should pay zero (no position, no cost)"
    assert info["position"] == POSITION_FLAT
    assert not terminated
    assert not truncated
    assert obs.shape == (8, 4)


# --------------------------------------------------------------------------- #
# Test 3 -- long action: reward = price_delta * point_value - cost_per_side
# --------------------------------------------------------------------------- #


def test_long_action_reward_matches_price_delta_minus_cost() -> None:
    """Step from flat with ACTION_LONG. Expected on the first step:

        prev_pos = 0, target_pos = +1, sides = 1 (enter)
        price_delta = price[t+1] - price[t] = 1.0 (linear ramp, step=1.0)
        gross = +1 * 1.0 * 2.00 = 2.00 dollars
        cost  = 1 * 1.40 = 1.40 dollars
        reward = 2.00 - 1.40 = 0.60 dollars
    """
    env = _make_env(n_bars=50, n_features=4, window_size=8, price_step=1.0)
    env.reset(seed=0)

    _obs, reward, _term, _trunc, info = env.step(ACTION_LONG)

    expected = (1.0 * 2.00) - (1 * 1.40)  # = 0.60
    assert reward == pytest.approx(expected, abs=1e-9)
    assert info["position"] == POSITION_LONG
    assert info["bar_index"] == 8  # advanced one bar


# --------------------------------------------------------------------------- #
# Test 4 -- short action: reward = -price_delta * point_value - cost_per_side
# --------------------------------------------------------------------------- #


def test_short_action_reward_matches_negative_price_delta_minus_cost() -> None:
    """Step from flat with ACTION_SHORT on a rising market.

        prev_pos = 0, target_pos = -1, sides = 1 (enter)
        price_delta = +1.0
        gross = -1 * 1.0 * 2.00 = -2.00
        cost  = 1 * 1.40 = 1.40
        reward = -2.00 - 1.40 = -3.40
    """
    env = _make_env(n_bars=50, n_features=4, window_size=8, price_step=1.0)
    env.reset(seed=0)

    _obs, reward, _term, _trunc, info = env.step(ACTION_SHORT)

    expected = (-1.0 * 2.00) - (1 * 1.40)  # = -3.40
    assert reward == pytest.approx(expected, abs=1e-9)
    assert info["position"] == POSITION_SHORT


# --------------------------------------------------------------------------- #
# Test 5 -- episode terminates exactly at the last bar
# --------------------------------------------------------------------------- #


def test_terminates_at_data_end() -> None:
    n_bars = 20
    window = 8
    env = _make_env(n_bars=n_bars, n_features=4, window_size=window, price_step=1.0)
    env.reset(seed=0)

    n_steps_until_done = (n_bars - 1) - (window - 1)  # bar_index 7 -> 19

    terminated = False
    truncated = False
    steps_taken = 0
    for _ in range(n_steps_until_done + 5):
        _obs, _r, terminated, truncated, _info = env.step(ACTION_HOLD)
        steps_taken += 1
        if terminated:
            break

    assert terminated is True, "must terminate before exhausting steps"
    assert truncated is False, "truncated should remain False (no time limit)"
    assert steps_taken == n_steps_until_done


# --------------------------------------------------------------------------- #
# Test 6 -- reversal pays double cost (long -> short = 2 sides)
# --------------------------------------------------------------------------- #


def test_reversal_pays_two_sides_of_cost() -> None:
    """Long then immediately short should pay 2 sides on the reversal bar.

    Step 1 (flat -> long):  sides = 1, cost = 1.40
    Step 2 (long -> short): sides = 2, cost = 2.80
        prev_pos changes flat -> long on step 1, then long -> short on step 2.
        Reward on step 2: target = -1, price_delta = 1.0
            gross = -1 * 1.0 * 2.00 = -2.00
            cost  = 2 * 1.40 = -2.80
            reward = -4.80
    """
    env = _make_env(n_bars=50, n_features=4, window_size=8, price_step=1.0)
    env.reset(seed=0)

    env.step(ACTION_LONG)  # step 1
    _obs, reward, _term, _trunc, info = env.step(ACTION_SHORT)  # step 2

    expected = (-1.0 * 2.00) - (2 * 1.40)  # = -4.80
    assert reward == pytest.approx(expected, abs=1e-9)
    assert info["position"] == POSITION_SHORT


# --------------------------------------------------------------------------- #
# Test 7 -- observation space / action space / cumulative pnl bookkeeping
# --------------------------------------------------------------------------- #


def test_spaces_and_cumulative_pnl_match_per_step_rewards() -> None:
    env = _make_env(n_bars=30, n_features=4, window_size=8, price_step=0.5)

    assert env.observation_space.shape == (8, 4)
    assert env.action_space.n == 3

    env.reset(seed=0)
    rewards: list[float] = []
    for _ in range(10):
        _obs, r, term, _trunc, info = env.step(ACTION_LONG)
        rewards.append(r)
        if term:
            break

    assert info["cumulative_pnl"] == pytest.approx(sum(rewards), abs=1e-9)
