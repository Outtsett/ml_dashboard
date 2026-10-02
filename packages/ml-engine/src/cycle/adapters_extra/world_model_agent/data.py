"""Windows of bars and the arrays a world-model agent fits on.

Every world-model agent reads, at bar t, the WINDOW of the last
``sequence_length`` causal feature rows (t - L + 1 .. t). Its recurrent or
latent state is rebuilt from that window on every call, never carried from
an earlier call, so a bar's prediction does not depend on which bars were
scored before it or beside it. Rows before the start of the matrix (and a
missing value inside the window) are zeros, the scaled features' mean.

The fit's arrays (``FitData``) follow ``cycle.market``'s read rules:

- ``move`` (the scaled tape move of a decision at t, from ``bridges.tape``:
  open[t + 1 + h] - open[t + 1] over the decision bar's move scale) and
  ``cost`` (one round trip over the same scale) are known only for rows of the
  training span whose tape span ends by train_index[-1] + h + 1;
- ``target`` (the price target for a price model) only for rows of the
  training span (``MarketView.fit_rows``);
- next-row targets (the dynamics a world model learns) only for rows t with
  t + 1 <= train_index[-1];
- the feature matrix is kept only up to the last training or validation row,
  so nothing past validation is ever read.

``elapsed`` is the time since the previous bar in units of the training
span's median bar interval, capped at ``MAXIMUM_ELAPSED_BARS`` (a session
break becomes a longer step, not a missing bar); the neural ODE integrates
over it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

MAXIMUM_ELAPSED_BARS = 24.0


def window_indices(rows: np.ndarray, length: int) -> np.ndarray:
    """(B, L) row numbers of each window, oldest first; negative before the matrix starts."""
    rows = np.asarray(rows, dtype=np.int64).reshape(-1)
    return rows[:, None] - (int(length) - 1 - np.arange(int(length), dtype=np.int64))[None, :]


def gather_windows(features: np.ndarray, rows: np.ndarray, length: int, dtype=np.float32) -> np.ndarray:
    """(B, L, F) windows ending at ``rows``; zeros before row 0 and for missing values."""
    index = window_indices(rows, length)
    valid = index >= 0
    out = np.asarray(features[np.clip(index, 0, None)], dtype=dtype)
    out[~valid] = 0.0
    out[~np.isfinite(out)] = 0.0
    return out


def gather_series(values: np.ndarray, rows: np.ndarray, length: int, fill: float = np.nan) -> np.ndarray:
    """(B, L) values of a per-row array over each window; ``fill`` before row 0."""
    index = window_indices(rows, length)
    out = np.asarray(values, dtype=np.float64)[np.clip(index, 0, None)].copy()
    out[index < 0] = fill
    return out


def elapsed_bars(timestamps: np.ndarray, bar_seconds: float) -> np.ndarray:
    """float32 time since the previous bar in bar intervals (1 at row 0), capped."""
    stamps = np.asarray(timestamps, dtype=np.float64)
    out = np.ones(stamps.shape[0], dtype=np.float64)
    if stamps.shape[0] > 1 and bar_seconds > 0:
        out[1:] = np.diff(stamps) / float(bar_seconds)
    out = np.clip(np.nan_to_num(out, nan=1.0), 0.0, MAXIMUM_ELAPSED_BARS)
    return out.astype(np.float32)


def median_bar_seconds(timestamps: np.ndarray, rows: np.ndarray) -> float:
    """The median interval between consecutive training rows' bars (seconds)."""
    rows = np.asarray(rows, dtype=np.int64)
    if rows.size < 2:
        return 1.0
    stamps = np.asarray(timestamps, dtype=np.float64)[rows[0]: rows[-1] + 1]
    steps = np.diff(stamps)
    steps = steps[steps > 0]
    return float(np.median(steps)) if steps.size else 1.0


@dataclass
class FitData:
    features: np.ndarray            # (m, F) float32, zeros for missing values, rows 0..m-1 only
    finite_rows: np.ndarray         # (m,) bool: the row's features were all finite
    length: int                     # the window L
    train_rows: np.ndarray          # the (capped) training rows
    validation_rows: np.ndarray
    span_start: int
    span_end: int                   # the last training row
    move: np.ndarray                # (m,) float64 scaled tape move, NaN where unknown
    cost: np.ndarray                # (m,) float64 scaled round trip, NaN where unknown
    target: np.ndarray              # (m,) float64 the task's own target on the training span, NaN elsewhere
    next_known: np.ndarray          # (m,) bool: row t + 1 is a known next row for t
    continuation: np.ndarray        # (m,) float64 1 when t -> t + 1 is not a session gap
    elapsed: np.ndarray             # (m,) float32 bar intervals since the previous bar
    validation_targets: np.ndarray  # float64 labels (direction) or price targets at the validation rows
    validation_move: np.ndarray     # float64 scaled tape move at the validation rows (checkpoint selection only)
    validation_cost: np.ndarray
    horizon: int
    bar_seconds: float
    mean_cost: float
    task: str = "classification"

    # ── batches ──
    def windows(self, rows: np.ndarray) -> np.ndarray:
        return gather_windows(self.features, rows, self.length)

    def batch(self, rows: np.ndarray) -> dict:
        """numpy arrays for ``rows`` (see ``to_tensors``)."""
        rows = np.asarray(rows, dtype=np.int64)
        length = self.length
        count = self.features.shape[0]
        window = self.windows(rows)
        move_series = gather_series(self.move, rows, length)
        target_series = gather_series(self.target, rows, length)
        continuation_series = gather_series(self.continuation, rows, length, fill=1.0)
        elapsed_series = gather_series(self.elapsed, rows, length, fill=1.0)
        # the row after each window position: inside the window for every position but the last
        following = window_indices(rows, length) + 1
        following_known = np.zeros(following.shape, dtype=bool)
        inside = following[:, :-1] >= 0
        following_known[:, :-1] = inside
        following_known[:, -1] = self.next_known[rows]
        next_series = np.asarray(self.features[np.clip(following, 0, count - 1)], dtype=np.float32)
        next_series[~following_known] = 0.0
        next_rows = np.minimum(rows + 1, count - 1)
        next_window = gather_windows(self.features, next_rows, length)
        reward = self.move if self.task == "classification" else self.target
        following_reward = np.where(rows + 1 <= count - 1, reward[next_rows], np.nan)
        return {
            "next_reward": np.nan_to_num(following_reward),
            "next_reward_mask": np.isfinite(following_reward) & self.next_known[rows],
            "rows": rows,
            "window": window,
            "move": np.nan_to_num(self.move[rows]),
            "move_mask": np.isfinite(self.move[rows]),
            "cost": np.nan_to_num(self.cost[rows], nan=self.mean_cost),
            "target": np.nan_to_num(self.target[rows]),
            "target_mask": np.isfinite(self.target[rows]),
            "move_series": np.nan_to_num(move_series),
            "move_series_mask": np.isfinite(move_series),
            "target_series": np.nan_to_num(target_series),
            "target_series_mask": np.isfinite(target_series),
            "continuation_series": continuation_series,
            "elapsed_series": elapsed_series,
            "next_series": next_series,
            "next_series_mask": following_known,
            "next_window": next_window,
            "next_mask": self.next_known[rows],
        }


def build_fit_data(features: np.ndarray, labels: np.ndarray, train_index: np.ndarray, validation_index: np.ndarray,
                   view, task: str, length: int, maximum_training_bars: int) -> FitData:
    """The fit's arrays (see the module docstring)."""
    from cycle.bridges.tape import RewardTape

    train_index = np.asarray(train_index, dtype=np.int64)
    validation_index = np.asarray(validation_index, dtype=np.int64)
    if maximum_training_bars and train_index.size > int(maximum_training_bars):
        train_index = train_index[-int(maximum_training_bars):]
    span_start, span_end = int(train_index[0]), int(train_index[-1])
    last = max(span_end + 1, int(validation_index[-1]) if validation_index.size else span_end)
    last = min(last, features.shape[0] - 1)
    raw = np.asarray(features[: last + 1], dtype=np.float32)
    finite_rows = np.all(np.isfinite(raw), axis=1)
    kept = np.where(np.isfinite(raw), raw, 0.0).astype(np.float32)
    count = kept.shape[0]
    span = np.arange(span_start, span_end + 1, dtype=np.int64)

    move = np.full(count, np.nan)
    cost = np.full(count, np.nan)
    validation_move = np.full(validation_index.size, np.nan)
    validation_cost = np.full(validation_index.size, np.nan)
    if task == "classification":
        move[span], cost[span] = tape_move(RewardTape.from_view(view, train_index), span)
        if validation_index.size:
            # the validation rows' own trades, read only to pick the best epoch: their prices end by
            # validation_index[-1] + h, before the engine's purge ends and the test span starts
            validation_tape = RewardTape.from_view(view, known_until=int(validation_index[-1]) + int(view.horizon))
            validation_move, validation_cost = tape_move(validation_tape, validation_index)
    target = np.full(count, np.nan)
    target[span] = np.asarray(labels, dtype=np.float64)[span]

    next_known = np.zeros(count, dtype=bool)
    candidates = span[span + 1 <= span_end]
    next_known[candidates] = finite_rows[candidates + 1]
    continuation = np.ones(count, dtype=np.float64)
    continuation[span] = 1.0 - np.asarray(view.one_bar_crosses_gap, dtype=np.float64)[span]
    timestamps = np.asarray(view.timestamps)[:count]
    bar_seconds = median_bar_seconds(timestamps, train_index)
    elapsed = elapsed_bars(timestamps, bar_seconds)
    finite_cost = cost[np.isfinite(cost)]
    return FitData(
        features=kept, finite_rows=finite_rows, length=int(length), train_rows=train_index,
        validation_rows=validation_index, span_start=span_start, span_end=span_end, move=move, cost=cost,
        target=target, next_known=next_known, continuation=continuation, elapsed=elapsed,
        validation_targets=np.asarray(labels, dtype=np.float64)[validation_index], validation_move=validation_move,
        validation_cost=validation_cost, horizon=int(view.horizon),
        bar_seconds=float(bar_seconds), mean_cost=float(np.mean(finite_cost)) if finite_cost.size else 0.0,
        task=task,
    )


def tape_move(tape, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(scaled move, scaled round-trip cost) of a decision at each row: the long reward is
    move - cost and the short reward -move - cost."""
    long_reward = tape.position_reward(rows, 1.0)
    short_reward = tape.position_reward(rows, -1.0)
    return (long_reward - short_reward) / 2.0, -(long_reward + short_reward) / 2.0


def minibatches(rows: np.ndarray, batch_size: int, seed: int, epoch: int) -> list[np.ndarray]:
    """The training rows in shuffled minibatches (seeded by (seed, epoch)); each batch sorted."""
    rows = np.asarray(rows, dtype=np.int64)
    generator = np.random.default_rng((int(seed), int(epoch)))
    order = rows[generator.permutation(rows.size)]
    size = max(1, int(batch_size))
    return [np.sort(order[start: start + size]) for start in range(0, order.size, size)]


def row_noise(seed: int, rows: np.ndarray, shape: tuple[int, ...]) -> np.ndarray:
    """Standard normal draws per row, from a generator seeded by (seed, row): a bar gets the
    same draws whether it is scored alone or in a batch."""
    rows = np.asarray(rows, dtype=np.int64).reshape(-1)
    out = np.empty((rows.size, *shape), dtype=np.float64)
    for position, row in enumerate(rows):
        out[position] = np.random.default_rng((int(seed), int(row))).standard_normal(shape)
    return out


__all__ = ["FitData", "MAXIMUM_ELAPSED_BARS", "build_fit_data", "elapsed_bars", "gather_series", "gather_windows",
           "median_bar_seconds", "minibatches", "row_noise", "tape_move", "window_indices"]
