"""The semi-supervised split of a training span, and the node set a graph is built on.

Both semi-supervised bridge families (``graph_label_inference`` and
``pseudo_label_ensemble``) start from the same split:

- ``bridges.pool.block_mask`` cuts the span ``train_index[0]..train_index[-1]``
  into contiguous blocks of ``block_bars``; a seeded ``labeled_fraction`` of the
  blocks keep their labels, the rest are hidden, and a kept row whose horizon
  reaches into a hidden block (embargo = the label horizon h) is hidden too:
  adjacent bars share most of their h-bar label, so masking single rows would
  leak the hidden labels through their neighbours.
- **labelled** rows are kept training rows with a finite feature row and a
  finite target; **unlabelled** rows are every other row of the span with a
  finite feature row (hidden blocks, the embargo, and the rows the horizon /
  session-gap rule left without a label). Nothing outside the span is ever a
  node: never a validation or test row. Unlabelled rows' targets are not read.

``evenly_spaced_subset`` caps a node set to a size by taking evenly spaced rows
(a deterministic function of the rows only, so a fit with poisoned later bars
selects the same nodes).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from cycle.bridges.pool import block_mask, span_rows


@dataclass(frozen=True)
class SemiSupervisedSplit:
    labelled: np.ndarray       # training rows whose target is used (int64, increasing)
    unlabelled: np.ndarray     # span rows whose target is hidden or unknown (int64, increasing)
    hidden_block_count: int
    block_count: int
    hidden_blocks: tuple[tuple[int, int], ...] = ()   # (first row, last row) of each hidden block


def finite_rows(features: np.ndarray, rows: np.ndarray) -> np.ndarray:
    rows = np.asarray(rows, dtype=np.int64)
    if rows.size == 0:
        return rows
    return rows[np.all(np.isfinite(np.asarray(features[rows], dtype=np.float64)), axis=1)]


def semi_supervised_split(features: np.ndarray, targets: np.ndarray, train_index, *, labeled_fraction: float,
                          block_bars: int, horizon: int, seed: int) -> SemiSupervisedSplit:
    """The labelled / unlabelled rows of a training span (see the module docstring)."""
    train = np.asarray(train_index, dtype=np.int64).reshape(-1)
    mask = block_mask(train, block_bars=int(block_bars), labeled_fraction=float(labeled_fraction),
                      embargo_bars=int(horizon), seed=int(seed))
    targets = np.asarray(targets, dtype=np.float64)
    labelled = finite_rows(features, mask.labelled)
    labelled = labelled[np.isfinite(targets[labelled])]
    span = finite_rows(features, span_rows(train))
    unlabelled = np.setdiff1d(span, labelled, assume_unique=True)
    block_count = int(np.ceil(span_rows(train).size / max(1, int(block_bars)))) if train.size else 0
    return SemiSupervisedSplit(labelled.astype(np.int64), unlabelled.astype(np.int64), len(mask.hidden_blocks),
                               block_count, tuple(mask.hidden_blocks))


def evenly_spaced_subset(rows: np.ndarray, limit: int) -> np.ndarray:
    """At most ``limit`` of ``rows``, evenly spaced (all of them when they fit)."""
    rows = np.asarray(rows, dtype=np.int64)
    limit = int(limit)
    if limit <= 0:
        return rows[:0]
    if rows.size <= limit:
        return rows
    positions = np.unique(np.round(np.linspace(0, rows.size - 1, limit)).astype(np.int64))
    return rows[positions]


def capped_nodes(split: SemiSupervisedSplit, limit: int) -> tuple[np.ndarray, np.ndarray]:
    """(labelled nodes, unlabelled nodes) with at most ``limit`` in total: each
    side keeps its share of the total, the labelled side at least one row."""
    labelled, unlabelled = split.labelled, split.unlabelled
    total = labelled.size + unlabelled.size
    if total <= limit:
        return labelled, unlabelled
    labelled_limit = max(1, int(round(limit * labelled.size / total)))
    return evenly_spaced_subset(labelled, labelled_limit), evenly_spaced_subset(unlabelled, limit - labelled_limit)


__all__ = ["SemiSupervisedSplit", "capped_nodes", "evenly_spaced_subset", "finite_rows", "semi_supervised_split"]
