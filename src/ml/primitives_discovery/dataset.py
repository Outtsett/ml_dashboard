"""
PyTorch Dataset for windowed primitives input.

Performance architecture:
  1. Pre-computed primitives stored as a single (N, D) float32 tensor
  2. Sliding window via strided tensor slice — minimal memory overhead
  3. __getitem__ is a single tensor slice — no numpy, no per-sample computation
  4. NaN handling deferred to model forward pass (batch-vectorized)
"""

import numpy as np
import torch
from torch.utils.data import Dataset


class PrimitivesDataset(Dataset):
    """Sliding window dataset over pre-computed primitives.

    Parameters
    ----------
    primitives : np.ndarray
        Shape (N, D) — pre-computed, normalized primitives matrix.
    direction_labels : np.ndarray
        Per-bar direction labels (float64, NaN for invalid).
    forward_labels : np.ndarray
        Per-bar forward return direction labels (float64, NaN for invalid).
    magnitude_labels : np.ndarray
        Per-bar forward return magnitude (float64, NaN for invalid).
    start, end : int
        Index range [start, end) defining the split (train or val).
    window_size : int
        Number of bars per input window.
    """

    def __init__(
        self,
        primitives: np.ndarray,
        direction_labels: np.ndarray,
        forward_labels: np.ndarray,
        magnitude_labels: np.ndarray,
        start: int,
        end: int,
        window_size: int = 64,
    ):
        self.window_size = window_size

        # Store as contiguous float32 tensor
        self.data = torch.from_numpy(primitives.astype(np.float32))  # (N, D)

        # Pre-compute labels as tensors
        self.dir_labels = torch.from_numpy(direction_labels.astype(np.float32))
        self.fwd_labels = torch.from_numpy(forward_labels.astype(np.float32))
        self.mag_labels = torch.from_numpy(magnitude_labels.astype(np.float32))

        # Valid prediction indices: need W bars of lookback, within [start, end)
        self.first_idx = max(start, window_size - 1)
        self.last_idx = end  # exclusive
        self.length = max(0, self.last_idx - self.first_idx)

    def __len__(self) -> int:
        return self.length

    def __getitem__(self, idx: int):
        bar_idx = self.first_idx + idx
        w_start = bar_idx - self.window_size + 1
        w_end = bar_idx + 1

        # Single tensor slice — returns a view, very fast
        window = self.data[w_start:w_end]  # (W, D)

        dir_label = self.dir_labels[bar_idx]
        fwd_label = self.fwd_labels[bar_idx]
        mag_label = self.mag_labels[bar_idx]

        dir_valid = ~torch.isnan(dir_label)
        fwd_valid = ~torch.isnan(fwd_label)
        mag_valid = ~torch.isnan(mag_label)

        # Replace NaN with 0 for safe tensor ops (masked out in loss anyway)
        dir_label = torch.where(dir_valid, dir_label, torch.tensor(0.0))
        fwd_label = torch.where(fwd_valid, fwd_label, torch.tensor(0.0))
        mag_label = torch.where(mag_valid, mag_label, torch.tensor(0.0))

        return window, dir_label, fwd_label, mag_label, dir_valid, fwd_valid, mag_valid
