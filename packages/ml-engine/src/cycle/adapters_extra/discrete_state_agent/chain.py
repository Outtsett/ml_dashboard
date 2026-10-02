"""A Markov chain over bucketed one-bar moves, and the h-bar up-share it implies.

The observed series is the scaled one-bar move of each bar,

    x_t = (close[t] - close[t-1]) / move_scale[t]

(``move_scale`` is the run's causal volatility scale, so buckets mean the same
in quiet and busy markets), missing where the step from t-1 to t is a session
gap. Buckets are quantile bins of x on the training span
(``bridges.binning.QuantileBins``); the chain state at bar t is the last
``markov_order`` buckets (a higher-order chain), and the transition table
P(next bucket | state) is counted from consecutive training bars with additive
smoothing (the spec's estimator).

Direction is a sum over h steps, not one step, so the fit simulates: from
every chain state, ``path_count`` paths of h steps draw each next bucket from
P and each step's move from that bucket's own training moves; the share of
paths whose cumulative move is positive (ties count half) is P(up | state) and
the mean cumulative move is the price forecast in move-scale units (the price
target's own units). The stationary distribution (left eigenvector of the
first-order matrix) is kept as a diagnostic. Prediction is a table lookup on
the bar's state, read from closes and move scales at rows <= t only.
"""

from __future__ import annotations

import numpy as np

from cycle.bridges.binning import QuantileBins


def scaled_moves(view, rows: np.ndarray) -> np.ndarray:
    """x_r for each of ``rows`` (NaN at row 0, across a session gap, or where a price or scale is missing)."""
    rows = np.asarray(rows, dtype=np.int64)
    out = np.full(rows.shape, np.nan)
    usable = rows >= 1
    row = rows[usable]
    close = view.close
    with np.errstate(invalid="ignore", divide="ignore"):
        moves = (close[row] - close[row - 1]) / view.move_scale[row]
    moves[np.asarray(view.one_bar_crosses_gap, dtype=bool)[row - 1]] = np.nan
    moves[~np.isfinite(moves)] = np.nan
    out[usable] = moves
    return out


def state_codes(view, rows: np.ndarray, bins: QuantileBins, order: int) -> np.ndarray:
    """The chain state of each row: the buckets of x at rows t-order+1..t as a
    mixed-radix number (oldest first); -1 when any of them is missing."""
    rows = np.asarray(rows, dtype=np.int64)
    radix = bins.bin_count
    state = np.zeros(rows.shape, dtype=np.int64)
    missing = np.zeros(rows.shape, dtype=bool)
    for lag in range(order - 1, -1, -1):
        lagged = rows - lag
        codes = np.full(rows.shape, -1, dtype=np.int64)
        inside = lagged >= 0
        codes[inside] = bins.assign(scaled_moves(view, lagged[inside]))
        missing |= codes < 0
        state = state * radix + np.maximum(codes, 0)
    state[missing] = -1
    return state


def fit_chain(view, rows: np.ndarray, *, bin_count: int, order: int, smoothing: float,
              remove_drift: bool = True) -> dict:
    """Bucket edges, per-bucket training moves and the smoothed transition
    table from the training span ``rows`` (consecutive rows only). With
    ``remove_drift`` the moves a simulated path draws are centred on the
    training span's mean move, so the table carries the chain's serial
    dependence and not the one-window drift of the training period."""
    rows = np.asarray(rows, dtype=np.int64)
    moves = scaled_moves(view, rows)
    bins = QuantileBins.fit(moves, bin_count)
    radix = bins.bin_count
    states = state_codes(view, rows, bins, order)
    buckets = bins.assign(moves)
    state_count = radix ** order
    counts = np.full((state_count, radix), float(smoothing))
    consecutive = rows[1:] == rows[:-1] + 1
    usable = consecutive & (states[:-1] >= 0) & (buckets[1:] >= 0)
    np.add.at(counts, (states[:-1][usable], buckets[1:][usable]), 1.0)
    totals = counts.sum(axis=1, keepdims=True)
    transition = np.where(totals > 0, counts / np.where(totals > 0, totals, 1.0), 1.0 / radix)
    support = counts.sum(axis=1) - smoothing * radix
    known = buckets >= 0
    order_index = np.argsort(buckets[known], kind="stable")
    bucket_moves = moves[known][order_index]
    drift = float(np.mean(bucket_moves)) if bucket_moves.size else 0.0
    if remove_drift:
        bucket_moves = bucket_moves - drift
    bucket_offsets = np.concatenate([[0], np.cumsum(np.bincount(buckets[known], minlength=radix))]).astype(np.int64)
    return {"bins": bins, "transition": transition, "support": support, "bucket_moves": bucket_moves,
            "bucket_offsets": bucket_offsets, "order": int(order), "radix": int(radix),
            "training_drift": drift}


def simulate(chain: dict, horizon: int, path_count: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    """(up share, mean cumulative move) per chain state, from ``path_count``
    simulated h-step paths per state (seeded)."""
    generator = np.random.default_rng(int(seed))
    transition = chain["transition"]
    radix, order = chain["radix"], chain["order"]
    moves, offsets = chain["bucket_moves"], chain["bucket_offsets"]
    state_count = transition.shape[0]
    cumulative_transition = np.cumsum(transition, axis=1)
    cumulative_transition[:, -1] = 1.0
    states = np.repeat(np.arange(state_count, dtype=np.int64), path_count)
    total = np.zeros(states.size)
    sizes = np.diff(offsets)
    overall = moves if moves.size else np.zeros(1)
    for _ in range(int(horizon)):
        draw = generator.random(states.size)
        bucket = (draw[:, None] >= cumulative_transition[states]).sum(axis=1).astype(np.int64)
        bucket = np.minimum(bucket, radix - 1)
        pick = generator.random(states.size)
        size = sizes[bucket]
        chosen = np.where(size > 0, offsets[bucket] + np.minimum((pick * size).astype(np.int64), np.maximum(size - 1, 0)),
                          -1)
        step = np.where(chosen >= 0, moves[np.maximum(chosen, 0)] if moves.size else 0.0,
                        overall[(pick * overall.size).astype(np.int64) % overall.size])
        total += step
        states = (states * radix + bucket) % (radix ** order)
    total = total.reshape(state_count, path_count)
    up_share = (np.sum(total > 0, axis=1) + 0.5 * np.sum(total == 0, axis=1)) / float(path_count)
    return up_share, total.mean(axis=1)


def stationary_distribution(chain: dict) -> np.ndarray:
    """The first-order chain's stationary distribution over buckets (a diagnostic):
    the marginal over the last bucket of the order-k table, iterated to its fixed point."""
    radix, order = chain["radix"], chain["order"]
    transition = chain["transition"]
    state_count = transition.shape[0]
    distribution = np.full(state_count, 1.0 / state_count)
    for _ in range(500):
        following = np.zeros(state_count)
        for state in range(state_count):
            targets = (state * radix + np.arange(radix)) % (radix ** order)
            following[targets] += distribution[state] * transition[state]
        if np.max(np.abs(following - distribution)) < 1e-12:
            distribution = following
            break
        distribution = following
    buckets = np.zeros(radix)
    np.add.at(buckets, np.arange(state_count) % radix, distribution)
    return buckets / buckets.sum()


__all__ = ["fit_chain", "scaled_moves", "simulate", "state_codes", "stationary_distribution"]
