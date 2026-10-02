"""trading_env.py -- gymnasium-compatible bar-by-bar trading environment.

W9.a deliverable -- ships the RL substrate that ``rl_dqn`` / ``rl_ppo`` /
``rl_a2c`` Jinja2 templates target.  Lives under ``src.ml.blocks`` because it
is a reusable building block (mirrors the placement of encoders / heads /
gating modules in this package), and so generated RL templates can
``from core.blocks.trading_env import TradingEnv`` exactly the way they
``from core.blocks import MLPEncoder``.

Design contract (cross-domain, do NOT break without bumping template_version):

  Observation space  Box(low=-inf, high=inf, shape=(window_size, n_features),
                        dtype=float32)
                     -- window_size most-recent rows of the feature matrix
                     -- bar at ``bar_index`` is the LAST row of the window
                        (causal -- the policy only sees [t-W+1, t])

  Action space       Discrete(3)
                     0 = hold (no position)
                     1 = long  (+1 contract)
                     2 = short (-1 contract)
                     Single-position, no sizing.  Reversal (e.g. long->short)
                     is treated as an exit + immediate entry and pays two
                     per-side costs on that bar (1.40 * 2 = 2.80 = full
                     round-trip).

  Reward             per-bar PnL net of per-side cost, in DOLLARS:

                        gross_pnl_$ = position_t-1 * (price_t - price_t-1)
                                                   * point_value
                        cost_$      = (sides_traded_t) * cost_per_side_$
                        reward_t    = gross_pnl_$ - cost_$

                     where ``sides_traded_t`` counts EACH transaction the
                     policy makes on bar t:
                        0 -> 0 sides (hold -> hold)
                        0 -> +/-1 -> 1 side (enter)
                        +/-1 -> 0 -> 1 side (exit)
                        +/-1 -> -/+1 -> 2 sides (reverse)

                     Numbers come from cost_model.json (passed in by caller
                     as ``cost_model`` dict).  For MNQ today:
                        point_value     = 2.00
                        total_per_side  = 1.40   (== round_trip/2)

  reset(seed,
        options)     -> (obs, info)   gymnasium 1.0 API.
                     ``options`` may contain ``start_bar`` (int) to override
                     where the episode begins; defaults to ``window_size - 1``
                     so the first observation has a full window.

  step(action)       -> (obs, reward, terminated, truncated, info)
                     terminated = True when bar_index reaches the final bar
                     of the price series.  truncated stays False (no time
                     limit -- callers wrap in a TimeLimit if they want one).

  info               {'pnl': float, 'position': int, 'bar_index': int}
                     ``pnl`` is the realized + unrealized $ pnl ON THIS BAR
                     (== reward, kept named separately so downstream eval
                     code can compute reward-vs-pnl decomposition without
                     re-deriving).

Numpy only -- keep this framework-agnostic.  No torch import.

Authored 2026-05-11 (W9.a ML Studio Workshop redesign).
"""

from __future__ import annotations

from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

# Sentinel "no position" value so callers can compare against
# TradingEnv.POSITION_FLAT explicitly.
POSITION_FLAT = 0
POSITION_LONG = 1
POSITION_SHORT = -1

# Action enum -- keep in sync with action_space = Discrete(3).
ACTION_HOLD = 0
ACTION_LONG = 1
ACTION_SHORT = 2

_ACTION_TO_POSITION: dict[int, int] = {
    ACTION_HOLD: POSITION_FLAT,
    ACTION_LONG: POSITION_LONG,
    ACTION_SHORT: POSITION_SHORT,
}


class TradingEnv(gym.Env):
    """Bar-by-bar single-position trading environment for RL agents.

    Parameters
    ----------
    features : np.ndarray of shape (T, F)
        Engineered feature matrix.  Row t is the feature vector for bar t.
        Dtype is coerced to float32.
    prices : np.ndarray of shape (T,)
        Close prices in instrument points (NOT dollars).  Indexed the same as
        ``features`` -- prices[t] is the close of bar t.  Reward is computed
        from the *difference* prices[t] - prices[t-1], scaled by
        ``cost_model['point_value']`` to convert points to dollars.
    cost_model : dict
        Dict with at minimum:
            - 'point_value' (float):    $ per 1.0 point move (MNQ: 2.00)
            - 'total_per_side' (float): $ per side traded (MNQ: 1.40)
        Both fields come from packages/config/cost_model.json.  Other keys are
        ignored.
    window_size : int, default 32
        Number of trailing rows the observation exposes.  Episodes start at
        ``bar_index == window_size - 1`` so the very first obs already has a
        full window.

    Notes
    -----
    * Single position only -- the env does not track size or partial fills.
    * ``terminated`` fires when ``bar_index`` reaches ``T - 1``; the policy
      never gets to act on the very last bar because there is no t+1 price
      to mark against.
    * No randomness in step/reset -- ``seed`` is honored only insofar as the
      env's internal RNG is seeded (currently unused, but the call is kept so
      gymnasium's vec wrappers stay happy).
    """

    metadata = {"render_modes": []}

    POSITION_FLAT = POSITION_FLAT
    POSITION_LONG = POSITION_LONG
    POSITION_SHORT = POSITION_SHORT
    ACTION_HOLD = ACTION_HOLD
    ACTION_LONG = ACTION_LONG
    ACTION_SHORT = ACTION_SHORT

    def __init__(
        self,
        features: np.ndarray,
        prices: np.ndarray,
        cost_model: dict,
        window_size: int = 32,
    ) -> None:
        super().__init__()

        features_arr = np.asarray(features, dtype=np.float32)
        prices_arr = np.asarray(prices, dtype=np.float64)

        if features_arr.ndim != 2:
            raise ValueError(f"features must be 2-D (T, F); got shape {features_arr.shape}")
        if prices_arr.ndim != 1:
            raise ValueError(f"prices must be 1-D (T,); got shape {prices_arr.shape}")
        if features_arr.shape[0] != prices_arr.shape[0]:
            raise ValueError(
                f"features rows ({features_arr.shape[0]}) must equal prices "
                f"length ({prices_arr.shape[0]})"
            )
        if window_size < 1:
            raise ValueError(f"window_size must be >= 1; got {window_size}")
        if features_arr.shape[0] < window_size + 1:
            raise ValueError(
                f"need at least window_size+1 ({window_size + 1}) bars; got {features_arr.shape[0]}"
            )
        if not isinstance(cost_model, dict):
            raise TypeError(f"cost_model must be dict; got {type(cost_model)!r}")
        if "point_value" not in cost_model:
            raise KeyError("cost_model missing required key 'point_value'")
        if "total_per_side" not in cost_model:
            raise KeyError("cost_model missing required key 'total_per_side'")

        self._features = features_arr
        self._prices = prices_arr
        self._point_value = float(cost_model["point_value"])
        self._cost_per_side = float(cost_model["total_per_side"])
        self._window_size = int(window_size)
        self._n_features = int(features_arr.shape[1])
        self._n_bars = int(features_arr.shape[0])

        self.observation_space = spaces.Box(
            low=-np.inf,
            high=np.inf,
            shape=(self._window_size, self._n_features),
            dtype=np.float32,
        )
        self.action_space = spaces.Discrete(3)

        # Episode state -- populated by reset().
        self._bar_index: int = 0
        self._position: int = POSITION_FLAT
        self._cumulative_pnl: float = 0.0
        self._np_random: np.random.Generator | None = None

    # ------------------------------------------------------------------ #
    # Public properties
    # ------------------------------------------------------------------ #

    @property
    def window_size(self) -> int:
        return self._window_size

    @property
    def n_features(self) -> int:
        return self._n_features

    @property
    def n_bars(self) -> int:
        return self._n_bars

    @property
    def position(self) -> int:
        return self._position

    @property
    def bar_index(self) -> int:
        return self._bar_index

    @property
    def cumulative_pnl(self) -> float:
        return self._cumulative_pnl

    # ------------------------------------------------------------------ #
    # gymnasium API
    # ------------------------------------------------------------------ #

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict]:
        super().reset(seed=seed)
        if seed is not None:
            self._np_random = np.random.default_rng(seed)

        # Allow caller to override the starting bar (eval / replay use cases).
        start_bar = self._window_size - 1
        if options is not None and "start_bar" in options:
            requested = int(options["start_bar"])
            if requested < self._window_size - 1:
                raise ValueError(
                    f"start_bar must be >= window_size-1 ({self._window_size - 1}); got {requested}"
                )
            if requested >= self._n_bars - 1:
                raise ValueError(
                    f"start_bar must be < n_bars-1 ({self._n_bars - 1}); got {requested}"
                )
            start_bar = requested

        self._bar_index = start_bar
        self._position = POSITION_FLAT
        self._cumulative_pnl = 0.0

        obs = self._build_obs()
        info = self._build_info(last_reward=0.0)
        return obs, info

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict]:
        if not self.action_space.contains(int(action)):
            raise ValueError(
                f"invalid action {action!r}; must be one of "
                f"{ACTION_HOLD}/{ACTION_LONG}/{ACTION_SHORT}"
            )

        target_position = _ACTION_TO_POSITION[int(action)]
        prev_position = self._position

        # Sides traded on this bar:
        #   0 -> 0       : 0 sides
        #   0 -> +/-1    : 1 side (enter)
        #   +/-1 -> 0    : 1 side (exit)
        #   +/-1 -> -/+1 : 2 sides (reverse)
        if prev_position == target_position:
            sides_traded = 0
        elif prev_position == POSITION_FLAT or target_position == POSITION_FLAT:
            sides_traded = 1
        else:
            sides_traded = 2

        # Price delta from current bar to NEXT bar (where we mark to).
        # Position held during [t, t+1] is the action just decided.
        # We compute pnl on the *previous* position, then advance bar, then
        # update position.  This matches the contract documented in the
        # docstring: reward_t = position_{t-1} * (price_t - price_{t-1}) * pv.
        #
        # Concretely: at decision time bar_index == t. We:
        #   1. apply the action -> position transitions prev_position -> target
        #   2. advance to bar_index == t+1
        #   3. compute reward = target_position * (price_{t+1} - price_t) * pv
        #                       - sides_traded * cost_per_side
        # This is the "next-bar fill" convention (act at close of t, fill at
        # close of t, mark to close of t+1).
        next_bar = self._bar_index + 1
        if next_bar >= self._n_bars:
            # Defensive: terminated should have fired previously, but if a
            # caller somehow steps past the end, emit zero reward and stay
            # terminated.
            obs = self._build_obs()
            info = self._build_info(last_reward=0.0)
            return obs, 0.0, True, False, info

        price_now = self._prices[self._bar_index]
        price_next = self._prices[next_bar]
        price_delta_points = float(price_next - price_now)

        gross_pnl_dollars = float(target_position) * price_delta_points * self._point_value
        cost_dollars = float(sides_traded) * self._cost_per_side
        reward = gross_pnl_dollars - cost_dollars

        # Advance state.
        self._position = target_position
        self._bar_index = next_bar
        self._cumulative_pnl += reward

        terminated = self._bar_index >= self._n_bars - 1
        truncated = False

        obs = self._build_obs()
        info = self._build_info(last_reward=reward)
        return obs, float(reward), bool(terminated), bool(truncated), info

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #

    def _build_obs(self) -> np.ndarray:
        """Return the rolling window ending at (and including) bar_index."""
        lo = self._bar_index - self._window_size + 1
        hi = self._bar_index + 1
        window = self._features[lo:hi]
        # Defensive copy so downstream mutations don't poison the env state.
        return np.ascontiguousarray(window, dtype=np.float32)

    def _build_info(self, *, last_reward: float) -> dict:
        return {
            "pnl": float(last_reward),
            "position": int(self._position),
            "bar_index": int(self._bar_index),
            "cumulative_pnl": float(self._cumulative_pnl),
        }
