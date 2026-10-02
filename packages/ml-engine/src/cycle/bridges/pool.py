"""The unlabelled pool of a training span, and block masking with an embargo.

Self-supervised and semi-supervised families pre-train on more rows than the
labelled ones. Causality rule: the pool of a fold is drawn ONLY from the span
``train_index[0] .. train_index[-1]`` — never a validation or test row, and
never a row after the span — and only from rows whose features are finite over
the model's history. A row's label is not read by anything in this module.

``block_mask`` makes a semi-supervised split of the training rows. The span is
cut into contiguous blocks of ``block_bars``; a seeded choice keeps the labels
of ``labeled_fraction`` of the blocks and hides the rest. A kept row whose
label horizon reaches into a hidden block (r + embargo >= that block's start),
or that starts within ``embargo`` bars after a hidden block ends, is moved to
the unlabelled side too: its label would describe the hidden block's prices.
With ``embargo_bars`` = the label horizon no kept label overlaps a hidden block.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from cycle.features import history_valid


def span_rows(train_index) -> np.ndarray:
    index = np.asarray(train_index, dtype=np.int64).reshape(-1)
    if index.size == 0:
        return np.empty(0, dtype=np.int64)
    return np.arange(int(index[0]), int(index[-1]) + 1, dtype=np.int64)


def unlabelled_pool(features: np.ndarray, train_index, minimum_history: int = 1) -> np.ndarray:
    """Every row of the training span whose last ``minimum_history`` feature
    rows are finite, labelled or not (int64, increasing)."""
    rows = span_rows(train_index)
    if rows.size == 0:
        return rows
    valid = history_valid(features, int(minimum_history))
    return rows[valid[rows]]


@dataclass(frozen=True)
class BlockMask:
    labelled: np.ndarray       # training rows whose labels are kept
    unlabelled: np.ndarray     # span rows whose labels are hidden (hidden blocks and the embargo)
    hidden_blocks: tuple[tuple[int, int], ...]   # (first row, last row) of each hidden block


def block_mask(train_index, *, block_bars: int, labeled_fraction: float, embargo_bars: int, seed: int,
               features: np.ndarray | None = None, minimum_history: int = 1) -> BlockMask:
    """The semi-supervised split of a training span (see the module docstring).
    ``features`` (optional) limits the unlabelled side to rows with finite
    history; the labelled side is always a subset of ``train_index``."""
    if block_bars < 1:
        raise ValueError(f"block_bars must be >= 1, got {block_bars}")
    if not 0.0 < labeled_fraction <= 1.0:
        raise ValueError(f"labeled_fraction must be in (0, 1], got {labeled_fraction}")
    train = np.asarray(train_index, dtype=np.int64).reshape(-1)
    span = span_rows(train)
    if span.size == 0:
        empty = np.empty(0, dtype=np.int64)
        return BlockMask(empty, empty, ())
    starts = np.arange(int(span[0]), int(span[-1]) + 1, int(block_bars))
    blocks = [(int(start), int(min(start + block_bars - 1, span[-1]))) for start in starts]
    kept_count = max(1, int(round(labeled_fraction * len(blocks))))
    order = np.random.default_rng(int(seed)).permutation(len(blocks))
    kept = set(int(position) for position in order[:kept_count])
    hidden = tuple(block for position, block in enumerate(blocks) if position not in kept)
    in_hidden = np.zeros(span.size, dtype=bool)
    near_hidden = np.zeros(span.size, dtype=bool)
    origin = int(span[0])
    for first, last in hidden:
        in_hidden[first - origin:last - origin + 1] = True
        low = max(first - int(embargo_bars), origin)
        high = min(last + int(embargo_bars), int(span[-1]))
        near_hidden[low - origin:high - origin + 1] = True
    kept_mask = ~(in_hidden | near_hidden)
    labelled = train[kept_mask[train - origin]]
    unlabelled = span[~kept_mask]
    if features is not None:
        valid = history_valid(features, int(minimum_history))
        unlabelled = unlabelled[valid[unlabelled]]
    return BlockMask(labelled, unlabelled, hidden)


__all__ = ["BlockMask", "block_mask", "span_rows", "unlabelled_pool"]
