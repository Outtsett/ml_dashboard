"""Observation rows, the validation net reward and the validation score every
policy agent reports.

An agent's observation at bar t is the bar's own causal feature row, clipped
to +-``OBSERVATION_CLIP`` exactly as ``bridges.tape.TapeEnvironment`` clips it
while training; a row with a missing feature has no observation (P(up) NaN).

Validation (``ValidationEvaluator``): the policy's greedy position on each
validation row is booked on the VALIDATION tape, a reward tape whose prices
end at ``validation_index[-1] + h`` (the last price a validation label reads,
so the fit reads nothing a label does not). The mean net reward per decision
(in move-scale units) is the checkpoint selection (lower ``selection`` is
better, so it is the negative reward); the log loss, accuracy and F1 of P(up)
against the validation labels are reported beside it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from cycle.bridges.tape import ACTION_POSITIONS, RewardTape
from cycle.bridges.training import ValidationScore, score

OBSERVATION_CLIP = 10.0
SHORT, FLAT, LONG = 0, 1, 2


def observation_rows(features: np.ndarray, rows) -> tuple[np.ndarray, np.ndarray]:
    """(float64 observations of the rows, bool mask of the rows whose feature row is complete)."""
    rows = np.asarray(rows, dtype=np.int64).reshape(-1)
    values = np.asarray(features[rows], dtype=np.float64)
    complete = np.all(np.isfinite(values), axis=1) if values.size else np.zeros(rows.shape, dtype=bool)
    values = np.clip(np.where(np.isfinite(values), values, 0.0), -OBSERVATION_CLIP, OBSERVATION_CLIP)
    return values, complete


def long_share(probabilities: np.ndarray) -> np.ndarray:
    """pi(long) / (pi(long) + pi(short)) for rows of [short, flat, long] probabilities."""
    probabilities = np.asarray(probabilities, dtype=np.float64)
    long, short = probabilities[:, LONG], probabilities[:, SHORT]
    total = long + short
    with np.errstate(invalid="ignore", divide="ignore"):
        out = long / total
    out[~np.isfinite(out)] = np.nan
    return out


def greedy_positions(probabilities: np.ndarray) -> np.ndarray:
    """The most probable action of each row as a position (-1, 0, +1)."""
    return ACTION_POSITIONS[np.argmax(np.asarray(probabilities, dtype=np.float64), axis=1)]


def validation_tape(view, validation_index, holding_bars: int | None = None) -> RewardTape | None:
    """The tape the validation rows are booked on: prices through
    ``validation_index[-1] + h`` (see the module docstring)."""
    rows = np.asarray(validation_index, dtype=np.int64)
    if rows.size == 0:
        return None
    return RewardTape.from_view(view, holding_bars=holding_bars, known_until=int(rows[-1]) + int(view.horizon))


@dataclass
class ValidationEvaluator:
    features: np.ndarray
    labels: np.ndarray
    rows: np.ndarray
    tape: RewardTape | None

    def net_reward(self, positions: np.ndarray, rows: np.ndarray | None = None) -> float | None:
        rows = self.rows if rows is None else rows
        if self.tape is None or rows.size == 0:
            return None
        rewards = self.tape.position_reward(rows, positions)
        rewards = rewards[np.isfinite(rewards)]
        return float(np.mean(rewards)) if rewards.size else None

    def classification(self, probability_up: np.ndarray, positions: np.ndarray) -> ValidationScore:
        """Log loss / accuracy / F1 of P(up), selection = minus the mean net reward."""
        if self.rows.size == 0:
            return ValidationScore(None, None, None, None)
        reported = score("classification", probability_up, np.asarray(self.labels, dtype=np.float64)[self.rows])
        reward = self.net_reward(np.nan_to_num(np.asarray(positions, dtype=np.float64)))
        selection = None if reward is None or not math.isfinite(reward) else -reward
        return ValidationScore(reported.loss, reported.accuracy, reported.f1_score, selection)

    def regression(self, prediction: np.ndarray) -> ValidationScore:
        if self.rows.size == 0:
            return ValidationScore(None, None, None, None)
        return score("regression", prediction, np.asarray(self.labels, dtype=np.float64)[self.rows])


@dataclass
class FitContext:
    """Everything a policy agent's fit reads. ``train_rows`` are the training
    span's rows with a known tape reward and a complete feature row, ascending;
    ``reward_table`` (len(train_rows), 3) the tape reward of short / flat / long
    at each of them; ``evaluator`` scores the validation rows."""

    features: np.ndarray
    labels: np.ndarray
    train_rows: np.ndarray
    reward_table: np.ndarray
    tape: RewardTape
    evaluator: ValidationEvaluator
    parameters: dict
    seed: int
    reporter: object
    task: str
    name: str
    view: object

    def rewards(self, positions: np.ndarray, rows: np.ndarray | None = None) -> np.ndarray:
        """The tape reward of arbitrary (continuous) positions at training rows."""
        rows = self.train_rows if rows is None else rows
        return self.tape.position_reward(rows, positions)


def reward_table(tape: RewardTape, rows: np.ndarray) -> np.ndarray:
    return np.column_stack([tape.position_reward(rows, position) for position in ACTION_POSITIONS])


__all__ = ["FLAT", "LONG", "OBSERVATION_CLIP", "SHORT", "FitContext", "ValidationEvaluator", "greedy_positions",
           "long_share", "observation_rows", "reward_table", "validation_tape"]
