"""Shared label utilities: split masking for lookahead bias prevention."""

from __future__ import annotations

import numpy as np


def apply_split_mask(
    labels: np.ndarray,
    exit_bars: np.ndarray,
    split_idx: int,
) -> np.ndarray:
    """Mask training labels whose exit_bar extends into the validation set.

    Any training bar (index < split_idx) where exit_bars[i] >= split_idx
    is set to NaN. This prevents lookahead bias at the train/val boundary.

    Args:
        labels: label array to mask (NOT modified in-place)
        exit_bars: per-bar exit bar index (absolute, NaN if no label)
        split_idx: first bar of validation set

    Returns:
        New masked label array (copy of input with leaked bars set to NaN).
    """
    masked = labels.copy()
    train_mask = np.arange(len(labels)) < split_idx
    leak_mask = (~np.isnan(exit_bars)) & (exit_bars >= split_idx)
    masked[train_mask & leak_mask] = np.nan
    return masked
