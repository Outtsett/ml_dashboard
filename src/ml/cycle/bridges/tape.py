"""The reward tape: what a position taken at a bar's close earns, the way the
Model Cycle's own simulator (``cycle.simulate``) would book it.

Conventions (``cycle.simulate``'s, restated so an agent's reward and the
run's trades are the same arithmetic):

- a decision is taken at bar t's CLOSE and filled at bar t+1's OPEN;
- one round trip of one contract costs ``round_trip_cost_points`` points
  (``cost.round_trip / cost.point_value``: two fills), so a fill of |position|
  contracts costs ``|position| * round_trip_cost_points / 2``, and a reversal
  is two fills;
- held for ``holding_bars`` bars (default: the label horizon h), a position
  exits at the open after its last bar: entry open[t+1], exit open[t+1+H].

Two rewards, both in points and in "scaled" units (points divided by the
causal ``move_scale`` at the decision bar, so rewards are roughly unit scale
in every volatility regime, like the price target):

    position_points(t, p) = p * (open[t+1+H] - open[t+1]) - |p| * round_trip_cost_points
        the whole trade of a decision at t (``simulate``'s trade net / point value);
    step_points(t, p_prev, p) = p_prev * (open[t+1] - close[t]) + p * (close[t+1] - open[t+1])
                                - |p - p_prev| * round_trip_cost_points / 2
        the bar-(t+1) mark to market of switching from p_prev to p at t's close
        (``simulate``'s per-bar net with ``holding_bars = 1``, no stops).

Causality: a reward reads prices up to open[t+1+H] (or close[t+1]); the tape
refuses (NaN) every reward that would read a row after ``known_until``. Built
for a fit with ``train_index``, ``known_until`` is train_index[-1] + h + 1 (the
LABEL horizon h, whatever the holding H): the engine's purge keeps
train_index[-1] + h before the first validation row, so the last price read is
at most the first validation bar's open. With H > h the last H - h training
rows have no reward instead of one read from validation prices.
Open prices are FIT-ONLY in ``MarketView`` (the explainer's view has none), so
a tape exists only while fitting. A row whose tape span crosses a session gap
(``one_bar_crosses_gap`` on rows t+1..t+H) has no reward, like its label.

``TapeEnvironment`` is the gymnasium environment over the tape's usable rows:
the observation is the bar's causal feature row (never the agent's own
position, so a bar's prediction does not depend on earlier calls), the action
{short, flat, long} or a position in [-1, 1], the reward ``position_reward``
(or ``step_reward`` with ``reward_mode="step"``). ``reporter_callback`` is the
Stable-Baselines3 callback that turns rollouts into the engine's epochs:
``checkpoint`` at every rollout start and end (Stop propagates out of
``learn``), the validation score at every rollout end, and the best-validation
policy weights kept for ``restore_best()``.
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from typing import Callable

import gymnasium
import numpy as np
from gymnasium import spaces

from cycle.adapter import BatchReport, EpochReport
from cycle.bridges.training import ValidationScore

ACTION_POSITIONS = np.array([-1.0, 0.0, 1.0])      # discrete action 0 short, 1 flat, 2 long


@dataclass(frozen=True, eq=False)
class RewardTape:
    open: np.ndarray
    close: np.ndarray
    move_scale: np.ndarray
    one_bar_crosses_gap: np.ndarray
    holding_bars: int
    round_trip_cost_points: float
    known_until: int                 # the last row whose prices a reward may read (inclusive)
    skip_gap_rows: bool = True

    @classmethod
    def from_view(cls, view, train_index=None, *, holding_bars: int | None = None, known_until: int | None = None,
                  skip_gap_rows: bool = True) -> RewardTape:
        """The tape of a fit: prices through ``known_until`` (default: the last
        training row + h + 1, h the label horizon; see the module docstring)."""
        if view.open is None:
            raise ValueError("the reward tape fills at the next bar's open, which only a fit may read: "
                             "this market view has no open prices (the explainer's view never does)")
        holding = int(holding_bars) if holding_bars is not None else int(view.horizon)
        if holding < 1:
            raise ValueError(f"holding_bars must be >= 1, got {holding}")
        last = len(view) - 1
        if known_until is None:
            rows = None if train_index is None else np.asarray(train_index, dtype=np.int64)
            # the label horizon h, never H: the engine purges h bars before validation, so a holding
            # longer than h would read validation prices into a training reward (those rows stay NaN)
            known_until = last if rows is None or rows.size == 0 else int(rows[-1]) + int(view.horizon) + 1
        return cls(open=np.asarray(view.open, dtype=np.float64), close=np.asarray(view.close, dtype=np.float64),
                   move_scale=np.asarray(view.move_scale, dtype=np.float64),
                   one_bar_crosses_gap=np.asarray(view.one_bar_crosses_gap, dtype=bool), holding_bars=holding,
                   round_trip_cost_points=float(view.round_trip_cost_points),
                   known_until=int(min(known_until, last)), skip_gap_rows=bool(skip_gap_rows))

    def __len__(self) -> int:
        return int(self.close.shape[0])

    def _rows(self, rows) -> np.ndarray:
        return np.asarray(rows, dtype=np.int64).reshape(-1)

    def _span_crosses_gap(self, rows: np.ndarray) -> np.ndarray:
        """True when any step from row t+1 to t+1+H is a session gap."""
        flags = np.concatenate([[0], np.cumsum(self.one_bar_crosses_gap.astype(np.int64))])
        first = np.clip(rows + 1, 0, len(self))
        last = np.clip(rows + 1 + self.holding_bars, 0, len(self))     # steps first .. last-1
        return (flags[last] - flags[first]) > 0

    def position_points(self, rows, positions) -> np.ndarray:
        """The whole trade of a decision at each row, in points (see the module docstring)."""
        rows = self._rows(rows)
        positions = np.broadcast_to(np.asarray(positions, dtype=np.float64), rows.shape)
        out = np.full(rows.shape, np.nan)
        exits = rows + 1 + self.holding_bars
        known = (rows >= 0) & (exits <= self.known_until)
        entry = self.open[rows[known] + 1]
        leave = self.open[exits[known]]
        out[known] = positions[known] * (leave - entry) - np.abs(positions[known]) * self.round_trip_cost_points
        if self.skip_gap_rows:
            out[known & self._span_crosses_gap(rows)] = np.nan
        return out

    def position_reward(self, rows, positions) -> np.ndarray:
        """``position_points`` divided by the decision bar's move scale."""
        rows = self._rows(rows)
        with np.errstate(invalid="ignore", divide="ignore"):
            out = self.position_points(rows, positions) / self.move_scale[np.clip(rows, 0, len(self) - 1)]
        out[~np.isfinite(out)] = np.nan
        return out

    def step_points(self, rows, previous_positions, positions) -> np.ndarray:
        """The bar-(t+1) mark to market of moving from ``previous_positions`` to
        ``positions`` at each row's close, in points (see the module docstring)."""
        rows = self._rows(rows)
        previous = np.broadcast_to(np.asarray(previous_positions, dtype=np.float64), rows.shape)
        positions = np.broadcast_to(np.asarray(positions, dtype=np.float64), rows.shape)
        out = np.full(rows.shape, np.nan)
        known = (rows >= 0) & (rows + 1 <= self.known_until)
        row, following = rows[known], rows[known] + 1
        out[known] = (previous[known] * (self.open[following] - self.close[row])
                      + positions[known] * (self.close[following] - self.open[following])
                      - np.abs(positions[known] - previous[known]) * self.round_trip_cost_points / 2.0)
        return out

    def step_reward(self, rows, previous_positions, positions) -> np.ndarray:
        rows = self._rows(rows)
        with np.errstate(invalid="ignore", divide="ignore"):
            out = self.step_points(rows, previous_positions, positions) / self.move_scale[np.clip(rows, 0, len(self) - 1)]
        out[~np.isfinite(out)] = np.nan
        return out

    def usable_rows(self, rows) -> np.ndarray:
        """The rows (of ``rows``) with a known long reward."""
        rows = self._rows(rows)
        return rows[np.isfinite(self.position_reward(rows, 1.0))]

    def hindsight_positions(self, rows) -> np.ndarray:
        """The position that would have earned most at each row (+1, -1, or 0
        when neither side beats the cost); NaN where the reward is unknown.
        Hindsight: a TRAINING target only, never an input."""
        rows = self._rows(rows)
        long = self.position_points(rows, 1.0)
        short = self.position_points(rows, -1.0)
        out = np.where(long > 0, 1.0, np.where(short > 0, -1.0, 0.0))
        out[~np.isfinite(long)] = np.nan
        return out


def action_to_position(action, kind: str = "discrete") -> float:
    """Discrete 0/1/2 -> -1/0/+1; a continuous action -> its value clipped to [-1, 1]."""
    if kind == "discrete":
        return float(ACTION_POSITIONS[int(np.asarray(action).reshape(-1)[0])])
    return float(np.clip(np.asarray(action, dtype=np.float64).reshape(-1)[0], -1.0, 1.0))


class TapeEnvironment(gymnasium.Env):
    """The tape as a gymnasium environment (see the module docstring).

    ``rows`` are the fit's rows (training rows only); the ones without a known
    reward or with a missing feature are dropped. An episode walks
    ``episode_length`` consecutive usable rows (all of them by default) from a
    start drawn by the environment's seeded generator; ``terminated`` at the
    end, never ``truncated``."""

    metadata = {"render_modes": []}

    def __init__(self, features: np.ndarray, tape: RewardTape, rows, *, action_kind: str = "discrete",
                 episode_length: int | None = None, reward_mode: str = "horizon", observation_clip: float = 10.0,
                 seed: int = 0) -> None:
        super().__init__()
        if action_kind not in ("discrete", "continuous"):
            raise ValueError(f"action_kind must be discrete or continuous, got {action_kind!r}")
        if reward_mode not in ("horizon", "step"):
            raise ValueError(f"reward_mode must be horizon or step, got {reward_mode!r}")
        rows = np.asarray(rows, dtype=np.int64)
        rows = tape.usable_rows(rows)
        rows = rows[np.all(np.isfinite(features[rows]), axis=1)]
        if rows.size < 2:
            raise ValueError(f"the tape has {rows.size} usable rows; an environment needs at least 2")
        self.features = features
        self.tape = tape
        self.rows = rows
        self.action_kind = action_kind
        self.reward_mode = reward_mode
        self.observation_clip = float(observation_clip)
        self.episode_length = int(min(episode_length or rows.size, rows.size))
        self.observation_space = spaces.Box(-self.observation_clip, self.observation_clip,
                                            shape=(int(features.shape[1]),), dtype=np.float32)
        self.action_space = spaces.Discrete(3) if action_kind == "discrete" else spaces.Box(-1.0, 1.0, (1,), np.float32)
        self._generator = np.random.default_rng(int(seed))
        self._start = 0
        self._step = 0
        self._previous_position = 0.0

    def observation(self, row: int) -> np.ndarray:
        return np.clip(np.asarray(self.features[row], dtype=np.float32), -self.observation_clip, self.observation_clip)

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        if seed is not None:
            self._generator = np.random.default_rng(int(seed))
        span = self.rows.size - self.episode_length
        self._start = int(self._generator.integers(0, span + 1)) if span > 0 else 0
        self._step = 0
        self._previous_position = 0.0
        row = int(self.rows[self._start])
        return self.observation(row), {"row": row}

    def step(self, action):
        row = int(self.rows[self._start + self._step])
        position = action_to_position(action, self.action_kind)
        if self.reward_mode == "horizon":
            reward = float(self.tape.position_reward(row, position)[0])
        else:
            reward = float(self.tape.step_reward(row, self._previous_position, position)[0])
        self._previous_position = position
        self._step += 1
        terminated = self._step >= self.episode_length
        following = row if terminated else int(self.rows[self._start + self._step])
        info = {"row": row, "position": position}
        return self.observation(following), (reward if math.isfinite(reward) else 0.0), terminated, False, info


def reporter_callback(reporter, *, rollout_count: int, train_index, evaluate: Callable[[], ValidationScore] | None = None,
                      name: str = ""):
    """A Stable-Baselines3 callback reporting each rollout as one epoch (see the
    module docstring). ``evaluate()`` scores the validation rows with the policy
    as it is; the policy weights with the lowest ``selection`` are kept and put
    back by ``callback.restore_best()``. Imports Stable-Baselines3 (and torch)."""
    from stable_baselines3.common.callbacks import BaseCallback

    rows = np.asarray(train_index, dtype=np.int64)
    if rows.size == 0:
        raise ValueError("the training index is empty")

    class ReporterCallback(BaseCallback):
        def __init__(self) -> None:
            super().__init__(verbose=0)
            self.rollout = 0
            self.rewards: list[float] = []
            self.best_selection = math.inf
            self.best_rollout = 0
            self.best_state: dict | None = None
            self.checkpoints = 0

        def _checkpoint(self) -> None:
            self.checkpoints += 1
            reporter.checkpoint()

        def _on_training_start(self) -> None:
            reporter.step_unit = "epoch"

        def _on_rollout_start(self) -> None:
            self.rollout += 1
            self.rewards = []
            self._checkpoint()
            reporter.epoch_started(self.rollout, max(rollout_count, self.rollout))

        def _on_step(self) -> bool:
            rewards = self.locals.get("rewards")
            if rewards is not None:
                self.rewards.extend(float(value) for value in np.asarray(rewards, dtype=np.float64).reshape(-1))
            return True

        def _on_rollout_end(self) -> None:
            epoch_count = max(rollout_count, self.rollout)
            mean_reward = float(np.mean(self.rewards)) if self.rewards else None
            train_loss = None if mean_reward is None else -mean_reward
            reporter.batch(BatchReport(epoch=self.rollout, epoch_count=epoch_count, batch=1, batch_count=1,
                                       span_start_index=int(rows[0]), span_end_index=int(rows[-1]),
                                       train_loss=train_loss))
            self._checkpoint()
            result = ValidationScore(None, None, None, None)
            if evaluate is not None:
                reporter.validating(self.rollout, epoch_count)
                result = evaluate()
            selection = result.selection
            is_best = selection is not None and math.isfinite(selection) and selection < self.best_selection
            if is_best:
                self.best_selection = float(selection)
                self.best_rollout = self.rollout
                self.best_state = copy.deepcopy(self.model.policy.state_dict())
            reporter.epoch_finished(EpochReport(epoch=self.rollout, epoch_count=epoch_count, train_loss=train_loss,
                                                validation_loss=result.loss, validation_accuracy=result.accuracy,
                                                validation_f1_score=result.f1_score, is_best=bool(is_best)))

        def restore_best(self) -> int:
            """Put the best-validation weights back; returns that rollout (0 when none was scored)."""
            if self.best_state is not None:
                self.model.policy.load_state_dict(self.best_state)
                reporter.log(f"{name + ': ' if name else ''}restored the policy of rollout {self.best_rollout} "
                             "(best validation)")
            return self.best_rollout

    return ReporterCallback()


__all__ = ["ACTION_POSITIONS", "RewardTape", "TapeEnvironment", "action_to_position", "reporter_callback"]
