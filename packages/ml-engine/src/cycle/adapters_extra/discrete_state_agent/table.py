"""Tabular reinforcement learning over discretised market states: Q-learning,
SARSA and Dyna-Q.

The environment is the run's reward tape (``cycle.bridges.tape.RewardTape``):
at bar t the agent holds position p (short, flat, long), chooses the new
position a at t's close, and earns the tape's bar-(t+1) mark to market
``step_reward(t, p, a)`` (next-open fill, half a round trip per unit of
turnover, divided by the bar's causal move scale). The state is
(market cell, position): the cell is the bar's quantile-bin cell of a few
feature columns (``bridges.binning.FeatureBins``), the position is the agent's
own. The market cell of bar t+1 does not depend on the agent (a single trader
does not move the market), so the next state after (cell_t, p) and action a is
(cell_{t+1}, a) whatever p was.

That makes every position's transition at bar t observable at once, so each
sweep updates all nine (position, action) pairs of the bar's cell in time
order ("position-complete" updates); the three rules differ only in the
bootstrap target of the update

    Q(c, p, a) += learning_rate * (target - Q(c, p, a))

- Q-learning (Watkins): target = r + discount * max_b Q(c', a, b);
- SARSA (on-policy): target = r + discount * Q(c', a, b'), b' drawn by the
  epsilon-greedy behaviour policy at (c', a) (one draw per next position, so
  the four-letter tuple (s, a, r, s', a') is the behaviour policy's own);
- Dyna-Q: the Q-learning update, then the last observed (reward, next cell)
  of every updated pair is stored in a deterministic model and
  ``planning_step_count`` extra Q-learning updates replay pairs drawn
  uniformly from the model (Sutton 1990).

The next-state values are read before the bar's nine updates (one synchronous
backup per bar). A terminal step (the next bar has no state) bootstraps
nothing: target = r.
The readout is the flat-position row: the gap Q(c, flat, long) - Q(c, flat,
short) is the policy's preference for long, turned into P(up) by a Boltzmann
share whose temperature is fitted on validation rows (``bridges.calibration``).
Reading at flat keeps a bar's prediction independent of earlier predictions.
"""

from __future__ import annotations

import numpy as np
from numba import njit

POSITIONS = np.array([-1.0, 0.0, 1.0])       # index 0 short, 1 flat, 2 long (the tape's discrete actions)
SHORT, FLAT, LONG = 0, 1, 2
RULES = {"q_learning": 0, "sarsa": 1, "dyna_q": 2}


def step_rewards(tape, rows: np.ndarray) -> np.ndarray:
    """(m, 3, 3) scaled step rewards: [t, p, a] = tape.step_reward(t, POSITIONS[p], POSITIONS[a])."""
    rows = np.asarray(rows, dtype=np.int64)
    out = np.empty((rows.size, 3, 3), dtype=np.float64)
    for previous in range(3):
        for action in range(3):
            out[:, previous, action] = tape.step_reward(rows, POSITIONS[previous], POSITIONS[action])
    return out


def transitions(cells: np.ndarray, rows: np.ndarray, rewards: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """The steps of one sweep, in time order: (cell, next cell, reward) per row
    whose cell and rewards are known. The next cell is -1 (terminal) when the
    next row is not the next bar of the span or has no state."""
    rows = np.asarray(rows, dtype=np.int64)
    cells = np.asarray(cells, dtype=np.int64)
    usable = (cells >= 0) & np.all(np.isfinite(rewards), axis=(1, 2))
    following = np.full(rows.size, -1, dtype=np.int64)
    if rows.size > 1:
        consecutive = rows[1:] == rows[:-1] + 1
        following[:-1] = np.where(consecutive, cells[1:], -1)
    return cells[usable], following[usable], np.ascontiguousarray(rewards[usable])


@njit(cache=True)
def _greedy(values, row, previous):
    """argmax_b values[row, previous, b] with ties broken at random."""
    best = values[row, previous, 0]
    for action in range(1, 3):
        if values[row, previous, action] > best:
            best = values[row, previous, action]
    ties = 0
    for action in range(3):
        if values[row, previous, action] == best:
            ties += 1
    pick = np.random.randint(ties)
    for action in range(3):
        if values[row, previous, action] == best:
            if pick == 0:
                return action
            pick -= 1
    return 0


@njit(cache=True)
def _max_next(values, cell, position):
    best = values[cell, position, 0]
    for action in range(1, 3):
        if values[cell, position, action] > best:
            best = values[cell, position, action]
    return best


@njit(cache=True)
def sweep(values, cells, next_cells, rewards, rule, learning_rate, discount, exploration_rate, planning_step_count,
          model_reward, model_next, model_seen, seen_keys, seen_count, seed):
    """One pass over the steps in time order, updating ``values`` (S, 3, 3) in
    place. ``rule`` 0 Q-learning, 1 SARSA, 2 Dyna-Q. The Dyna model arrays
    persist across sweeps; returns (mean absolute temporal-difference error,
    seen_count)."""
    np.random.seed(seed)
    total = 0.0
    updates = 0
    bootstrap = np.zeros(3)
    for step in range(cells.shape[0]):
        cell = cells[step]
        following = next_cells[step]
        # the next state's value for each next position a, read BEFORE this step's nine updates (they are one
        # synchronous backup of the bar), so the rules differ in nothing but this target
        for position in range(3):
            if following < 0:
                bootstrap[position] = 0.0
            elif rule == 1:                    # SARSA: the behaviour policy's a' at (c', a)
                if np.random.random() < exploration_rate:
                    chosen = np.random.randint(3)
                else:
                    chosen = _greedy(values, following, position)
                bootstrap[position] = values[following, position, chosen]
            else:                              # Q-learning and Dyna-Q: the greedy value
                bootstrap[position] = _max_next(values, following, position)
        for previous in range(3):
            for action in range(3):
                reward = rewards[step, previous, action]
                target = reward + discount * bootstrap[action]
                error = target - values[cell, previous, action]
                values[cell, previous, action] += learning_rate * error
                total += abs(error)
                updates += 1
                if rule == 2:
                    key = (cell * 3 + previous) * 3 + action
                    if not model_seen[cell, previous, action]:
                        model_seen[cell, previous, action] = True
                        seen_keys[seen_count] = key
                        seen_count += 1
                    model_reward[cell, previous, action] = reward
                    model_next[cell, previous, action] = following
        if rule == 2 and seen_count > 0:
            for _ in range(planning_step_count):
                key = seen_keys[np.random.randint(seen_count)]
                action = key % 3
                previous = (key // 3) % 3
                cell = key // 9
                target = model_reward[cell, previous, action]
                following = model_next[cell, previous, action]
                if following >= 0:
                    target += discount * _max_next(values, following, action)
                values[cell, previous, action] += learning_rate * (target - values[cell, previous, action])
    return (total / updates if updates else 0.0), seen_count


class TabularLearner:
    """The table and the Dyna model of one fit; ``sweep`` runs one epoch."""

    def __init__(self, state_count: int, rule: str, *, learning_rate: float, discount: float,
                 exploration_rate: float = 0.0, planning_step_count: int = 0) -> None:
        if rule not in RULES:
            raise ValueError(f"unknown update rule {rule!r}; valid: {', '.join(RULES)}")
        self.rule = rule
        self.values = np.zeros((int(state_count), 3, 3), dtype=np.float64)
        self.learning_rate = float(learning_rate)
        self.discount = float(discount)
        self.exploration_rate = float(exploration_rate)
        self.planning_step_count = int(planning_step_count) if rule == "dyna_q" else 0
        self.model_reward = np.zeros_like(self.values)
        self.model_next = np.full(self.values.shape, -1, dtype=np.int64)
        self.model_seen = np.zeros(self.values.shape, dtype=np.bool_)
        self.seen_keys = np.zeros(self.values.size, dtype=np.int64)
        self.seen_count = 0

    def sweep(self, cells, next_cells, rewards, *, exploration_rate: float | None = None, seed: int = 0) -> float:
        rate = self.exploration_rate if exploration_rate is None else float(exploration_rate)
        error, self.seen_count = sweep(self.values, np.asarray(cells, dtype=np.int64),
                                       np.asarray(next_cells, dtype=np.int64),
                                       np.asarray(rewards, dtype=np.float64), RULES[self.rule], self.learning_rate,
                                       self.discount, rate, self.planning_step_count, self.model_reward,
                                       self.model_next, self.model_seen, self.seen_keys, int(self.seen_count),
                                       int(seed) % (2 ** 32))
        return float(error)


def flat_gap(values: np.ndarray, cells: np.ndarray) -> np.ndarray:
    """Q(c, flat, long) - Q(c, flat, short) per row; NaN where the cell is unknown."""
    cells = np.asarray(cells, dtype=np.int64)
    out = np.full(cells.shape, np.nan, dtype=np.float64)
    known = (cells >= 0) & (cells < values.shape[0])
    out[known] = values[cells[known], FLAT, LONG] - values[cells[known], FLAT, SHORT]
    return out


def association_columns(features: np.ndarray, rows: np.ndarray, target: np.ndarray, count: int) -> list[int]:
    """The ``count`` feature columns with the largest absolute Spearman
    correlation with ``target`` over ``rows`` (training rows only), strongest
    first; ties keep column order."""
    from scipy.stats import rankdata

    rows = np.asarray(rows, dtype=np.int64)
    target = np.asarray(target, dtype=np.float64)
    matrix = np.asarray(features[rows], dtype=np.float64)
    keep = np.isfinite(target) & np.all(np.isfinite(matrix), axis=1)
    column_count = matrix.shape[1]
    count = max(1, min(int(count), column_count))
    if keep.sum() < 3:
        return list(range(count))
    ranked_target = rankdata(target[keep])
    ranked_target -= ranked_target.mean()
    strengths = np.zeros(column_count)
    for column in range(column_count):
        ranked = rankdata(matrix[keep, column])
        ranked -= ranked.mean()
        denominator = float(np.sqrt(np.sum(ranked ** 2) * np.sum(ranked_target ** 2)))
        strengths[column] = abs(float(np.sum(ranked * ranked_target)) / denominator) if denominator > 0 else 0.0
    order = sorted(range(column_count), key=lambda column: (-round(strengths[column], 12), column))
    return [int(column) for column in order[:count]]


__all__ = ["FLAT", "LONG", "POSITIONS", "RULES", "SHORT", "TabularLearner", "association_columns", "flat_gap",
           "step_rewards", "sweep", "transitions"]
