"""What every meta_agent mechanism shares: rewards, context, policies, scores.

Two reward forms, both in "scaled" units (points divided by the causal move
scale of the decision bar, like the price target):

- ``tape_rewards`` (FIT ONLY): the reward of a short, flat or long decision at
  bar t filled at bar t+1's open and held for the label horizon, less one round
  trip (``bridges.tape.RewardTape``, the arithmetic ``cycle.simulate`` books).
  It reads open prices, which a prediction may not, and prices up to the last
  training row + h + 1, which the engine's purge keeps before validation.
- ``realised_rewards`` (fit and predict): the same decision valued with the
  realised price target (close[r + h] - close[r]) / move_scale[r] less the
  round trip. Row r's value is known at bar t only when r <= t - h
  (``MarketView.realised_until``); this is the only reward a test-time
  adaptation reads.

``context_rows`` returns the rows a mechanism may adapt on at an anchor bar:
realised rows only (r <= anchor - h), never before ``first_row``. Anchors are
``(t // interval) * interval``: every bar of one block of ``interval`` bars
adapts once, on the context known at the block's first bar, so a prediction at
t depends on bars <= t only and is the same whether t is scored alone or in a
batch (the adapted state is cached per anchor and dropped on every re-bind).

Every network runs in float64 on the CPU: the engine walks one bar at a time
and the batch-versus-single gate needs 1e-9 agreement, and these networks are
small enough that the GPU would only add transfer time.
"""

from __future__ import annotations

import math

import numpy as np
import torch
from torch import nn

from cycle.bridges.tape import RewardTape
from cycle.bridges.training import ValidationScore, score

DTYPE = torch.float64
# action order of every three-action policy head
SHORT, FLAT, LONG = 0, 1, 2
POSITIONS = np.array([-1.0, 0.0, 1.0])
MINIMUM_CONTEXT_ROWS = 8
SHORT_STATISTIC_BARS = 20
REGIME_STATISTIC_COUNT = 8


# ─── seeding ────────────────────────────────────────────────────────────────


def derived_seed(seed: int, *salt: int) -> int:
    """A 63-bit seed derived from ``seed`` and ``salt`` (stable across processes)."""
    state = np.random.SeedSequence([int(seed) & 0xFFFFFFFF, *[int(value) & 0xFFFFFFFF for value in salt]])
    return int(state.generate_state(1, dtype=np.uint64)[0] >> np.uint64(1))


def numpy_generator(seed: int, *salt: int) -> np.random.Generator:
    return np.random.default_rng(derived_seed(seed, *salt))


def torch_generator(seed: int, *salt: int) -> torch.Generator:
    generator = torch.Generator()
    generator.manual_seed(derived_seed(seed, *salt))
    return generator


def seeded(seed: int, build) -> nn.Module:
    """``build()`` with torch's global generator seeded inside a fork (the
    caller's random state is untouched), in float64."""
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(derived_seed(seed, 7))
        module = build()
    return module.to(DTYPE)


# ─── threads ────────────────────────────────────────────────────────────────


class one_thread:
    """torch on one intra-op thread inside the block, the caller's count restored
    after. These networks are a few thousand weights: a thread pool's fork and
    join costs more than the arithmetic, and on a busy machine an oversubscribed
    pool is hundreds of times slower (0.8 ms against 357 ms for one small
    forward and backward, measured 2026-09-29 with every core busy)."""

    def __enter__(self):
        self.previous = torch.get_num_threads()
        torch.set_num_threads(1)
        return self

    def __exit__(self, *exc):
        torch.set_num_threads(self.previous)
        return False


# ─── networks ───────────────────────────────────────────────────────────────


def perceptron(inputs: int, hidden: int, layers: int, outputs: int) -> nn.Sequential:
    """tanh perceptron (smooth, so second-order meta-gradients are not zero)."""
    blocks: list[nn.Module] = []
    width = int(inputs)
    for _ in range(max(1, int(layers))):
        blocks += [nn.Linear(width, int(hidden)), nn.Tanh()]
        width = int(hidden)
    blocks.append(nn.Linear(width, int(outputs)))
    return nn.Sequential(*blocks)


def as_tensor(values) -> torch.Tensor:
    return torch.as_tensor(np.asarray(values, dtype=np.float64), dtype=DTYPE)


def snapshot(*modules: nn.Module) -> list[dict]:
    return [{name: value.detach().clone() for name, value in module.state_dict().items()} for module in modules]


def restore(state: list[dict], *modules: nn.Module) -> None:
    for module, values in zip(modules, state):
        module.load_state_dict(values)


def module_state(module: nn.Module) -> dict:
    return {name: value.detach().clone().cpu() for name, value in module.state_dict().items()}


# ─── rewards ────────────────────────────────────────────────────────────────


def tape_rewards(view, train_index, rows) -> np.ndarray:
    """(n, 3) short / flat / long rewards of the fit's tape (FIT ONLY, see the module docstring)."""
    rows = np.asarray(rows, dtype=np.int64)
    tape = RewardTape.from_view(view, train_index)
    long = tape.position_reward(rows, 1.0)
    short = tape.position_reward(rows, -1.0)
    return np.column_stack([short, np.where(np.isfinite(long), 0.0, np.nan), long])


def realised_rewards(view, rows) -> np.ndarray:
    """(n, 3) short / flat / long rewards valued with the realised price target
    (row r is known at bar t only when r <= t - h)."""
    rows = np.asarray(rows, dtype=np.int64)
    move = np.asarray(view.price_targets[rows], dtype=np.float64)
    with np.errstate(invalid="ignore", divide="ignore"):
        cost = float(view.round_trip_cost_points) / np.asarray(view.move_scale[rows], dtype=np.float64)
    out = np.column_stack([-move - cost, np.zeros_like(move), move - cost])
    out[~(np.isfinite(move) & np.isfinite(cost))] = np.nan
    return out


def move_and_cost(rewards: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The signed move m and the cost c of a (n, 3) reward table (reward(p) = p m - |p| c)."""
    return (rewards[:, LONG] - rewards[:, SHORT]) / 2.0, -(rewards[:, LONG] + rewards[:, SHORT]) / 2.0


def finite_rows(features: np.ndarray, rows, *arrays: np.ndarray) -> np.ndarray:
    """``rows`` whose feature row (and every given per-row array) is finite."""
    rows = np.asarray(rows, dtype=np.int64)
    keep = np.all(np.isfinite(features[rows]), axis=1)
    for values in arrays:
        values = np.asarray(values)
        keep &= np.all(np.isfinite(values.reshape(values.shape[0], -1)), axis=1)
    return rows[keep]


# ─── the realised context of an anchor ─────────────────────────────────────


def anchor_of(rows, interval: int) -> np.ndarray:
    rows = np.asarray(rows, dtype=np.int64)
    return (rows // int(interval)) * int(interval)


def context_rows(view, features: np.ndarray, anchor: int, count: int, first_row: int = 0) -> np.ndarray:
    """The last ``count`` rows r <= anchor - h (realised at the anchor), not before
    ``first_row``, whose price target, move scale and feature row are finite."""
    stop = view.realised_until(int(anchor))
    start = max(int(first_row), stop - int(count) + 1, 0)
    if stop < start:
        return np.empty(0, dtype=np.int64)
    rows = np.arange(start, stop + 1, dtype=np.int64)
    rows = rows[rows < features.shape[0]]
    target = np.asarray(view.price_targets[rows], dtype=np.float64)
    scale = np.asarray(view.move_scale[rows], dtype=np.float64)
    keep = np.isfinite(target) & np.isfinite(scale) & (scale > 0) & np.all(np.isfinite(features[rows]), axis=1)
    return rows[keep]


def one_bar_moves(view, rows) -> np.ndarray:
    """(close[r + 1] - close[r]) / move_scale[r], NaN across a session gap; known at bar r + 1."""
    rows = np.asarray(rows, dtype=np.int64)
    close = np.asarray(view.close, dtype=np.float64)
    following = np.minimum(rows + 1, close.shape[0] - 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = (close[following] - close[rows]) / np.asarray(view.move_scale[rows], dtype=np.float64)
    out[(rows + 1 >= close.shape[0]) | np.asarray(view.one_bar_crosses_gap[rows], dtype=bool)] = np.nan
    out[~np.isfinite(out)] = np.nan
    return out


# ─── causal regime statistics (task-aware and Distral) ─────────────────────


def windows(values: np.ndarray, rows: np.ndarray, length: int) -> np.ndarray:
    """(n, length) values[r - length + 1 .. r] per row (NaN before the series starts)."""
    offsets = np.arange(-int(length) + 1, 1, dtype=np.int64)
    index = np.asarray(rows, dtype=np.int64)[:, None] + offsets[None, :]
    out = np.full(index.shape, np.nan)
    inside = index >= 0
    out[inside] = values[index[inside]]
    return out


def regime_statistics(returns: np.ndarray, timestamps: np.ndarray, rows, history_bars: int) -> np.ndarray:
    """(n, 8) statistics of the bars up to each row (never after it):
    log volatility over 20 bars and over ``history_bars``, the trend t-statistic
    over ``history_bars``, the up-bar share over 20 bars, time of day and day of
    week as sine / cosine pairs. ``returns`` is ``MarketView.one_bar_returns()``."""
    rows = np.asarray(rows, dtype=np.int64)
    out = np.full((rows.size, REGIME_STATISTIC_COUNT), np.nan)
    if rows.size == 0:
        return out
    short_length = min(SHORT_STATISTIC_BARS, int(history_bars))
    long_window = windows(returns, rows, int(history_bars))
    short_window = long_window[:, -short_length:]
    with np.errstate(invalid="ignore", divide="ignore"), _quiet():
        short_deviation = np.nanstd(short_window, axis=1)
        long_deviation = np.nanstd(long_window, axis=1)
        long_mean = np.nanmean(long_window, axis=1)
        long_count = np.sum(np.isfinite(long_window), axis=1)
        finite_short = np.isfinite(short_window)
        up_share = np.sum((short_window > 0) & finite_short, axis=1) / np.sum(finite_short, axis=1)
        out[:, 0] = np.log(short_deviation + 1e-12)
        out[:, 1] = np.log(long_deviation + 1e-12)
        out[:, 2] = long_mean / (long_deviation + 1e-12) * np.sqrt(long_count)
        out[:, 3] = up_share
    stamps = np.asarray(timestamps, dtype=np.int64)[rows]
    day_angle = (stamps % 86400) / 86400.0 * 2.0 * math.pi
    week_angle = ((stamps // 86400 + 3) % 7) / 7.0 * 2.0 * math.pi      # epoch day 0 was a Thursday
    out[:, 4], out[:, 5] = np.sin(day_angle), np.cos(day_angle)
    out[:, 6], out[:, 7] = np.sin(week_angle), np.cos(week_angle)
    out[~np.isfinite(out)] = np.nan
    return out


class _quiet:
    def __enter__(self):
        import warnings

        self._catch = warnings.catch_warnings()
        self._catch.__enter__()
        warnings.simplefilter("ignore", RuntimeWarning)
        return self

    def __exit__(self, *exc):
        return self._catch.__exit__(*exc)


def standardise(statistics: np.ndarray, centre: np.ndarray, spread: np.ndarray) -> np.ndarray:
    """Train-fixed standardisation; a missing statistic becomes 0 (the train mean)."""
    out = (statistics - centre[None, :]) / spread[None, :]
    out[~np.isfinite(out)] = 0.0
    return out


def fit_standardisation(statistics: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    with _quiet():
        centre = np.nanmean(statistics, axis=0)
        spread = np.nanstd(statistics, axis=0)
    centre = np.where(np.isfinite(centre), centre, 0.0)
    spread = np.where(np.isfinite(spread) & (spread > 1e-12), spread, 1.0)
    return centre, spread


# ─── policies and scores ───────────────────────────────────────────────────


def expected_reward_loss(logits: torch.Tensor, rewards: torch.Tensor, entropy_coefficient: float) -> torch.Tensor:
    """Minus (expected reward + entropy bonus) of a softmax policy whose every
    action's reward is known: the exact policy gradient, no sampling."""
    log_policy = torch.log_softmax(logits, dim=-1)
    policy = log_policy.exp()
    value = (policy * rewards).sum(-1).mean()
    entropy = -(policy * log_policy).sum(-1).mean()
    return -(value + float(entropy_coefficient) * entropy)


def huber(prediction: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
    return nn.functional.huber_loss(prediction, target, delta=1.0)


def up_share(policy: np.ndarray) -> np.ndarray:
    """P(up) = pi(long) / (pi(long) + pi(short)) of (n, 3) action probabilities."""
    policy = np.asarray(policy, dtype=np.float64)
    total = policy[:, LONG] + policy[:, SHORT]
    with np.errstate(invalid="ignore", divide="ignore"):
        out = policy[:, LONG] / total
    out[~np.isfinite(out)] = np.nan
    return out


def softmax_numpy(logits: torch.Tensor) -> np.ndarray:
    return torch.softmax(logits, dim=-1).detach().cpu().numpy().astype(np.float64)


def policy_score(policy: np.ndarray, labels: np.ndarray, rewards: np.ndarray) -> ValidationScore:
    """Log loss / accuracy / F1 of P(up) against the labels, selected on minus
    the mean validation net reward of the policy (lower is better)."""
    base = score("classification", up_share(policy), labels)
    expected = np.sum(np.asarray(policy) * np.asarray(rewards), axis=1)
    expected = expected[np.isfinite(expected)]
    selection = -float(np.mean(expected)) if expected.size else None
    return ValidationScore(base.loss, base.accuracy, base.f1_score, selection)


def position_score(probability_up: np.ndarray, position: np.ndarray, labels: np.ndarray,
                   rewards: np.ndarray) -> ValidationScore:
    """The same for a continuous position in [-1, 1] (reward(p) = p m - |p| c)."""
    base = score("classification", probability_up, labels)
    move, cost = move_and_cost(np.asarray(rewards))
    net = np.asarray(position) * move - np.abs(position) * cost
    net = net[np.isfinite(net)]
    selection = -float(np.mean(net)) if net.size else None
    return ValidationScore(base.loss, base.accuracy, base.f1_score, selection)


def batches(rows: np.ndarray, batch_size: int, generator: np.random.Generator) -> list[np.ndarray]:
    order = rows[generator.permutation(rows.size)]
    size = max(1, int(batch_size))
    return [order[start:start + size] for start in range(0, order.size, size)]


def group_by_anchor(rows: np.ndarray, interval: int) -> list[tuple[int, np.ndarray]]:
    """Rows grouped by their anchor (block start), in time order."""
    rows = np.asarray(rows, dtype=np.int64)
    if rows.size == 0:
        return []
    anchors = anchor_of(rows, interval)
    cuts = np.flatnonzero(np.diff(anchors)) + 1
    return [(int(anchor_of(group[:1], interval)[0]), group) for group in np.split(rows, cuts)]


__all__ = [
    "DTYPE", "FLAT", "LONG", "MINIMUM_CONTEXT_ROWS", "POSITIONS", "REGIME_STATISTIC_COUNT", "SHORT", "anchor_of",
    "as_tensor", "batches", "context_rows", "derived_seed", "expected_reward_loss", "finite_rows",
    "fit_standardisation", "group_by_anchor", "huber", "module_state", "one_thread", "move_and_cost", "numpy_generator",
    "one_bar_moves", "perceptron", "policy_score", "position_score", "realised_rewards", "regime_statistics",
    "restore", "seeded", "snapshot", "softmax_numpy", "standardise", "tape_rewards", "torch_generator", "up_share",
    "windows",
]
