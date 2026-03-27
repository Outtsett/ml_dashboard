"""OHLCV window dataset with dict-based label support.

Returns (window, labels_dict, masks_dict) per sample.
Labels and masks are keyed by head name.
Empty labels dict enables inference-only use (ISP-compliant).
"""
from __future__ import annotations

import numpy as np
import torch
from torch.utils.data import Dataset


class OHLCVWindowDataset(Dataset):
    """Sliding-window dataset over raw OHLCV with optional labels per head."""

    def __init__(self, ohlcv: dict[str, np.ndarray], labels: dict[str, np.ndarray],
                 start: int, end: int, window_size: int = 128):
        self.window_size = window_size
        stacked = np.stack([ohlcv["open"], ohlcv["high"], ohlcv["low"],
                           ohlcv["close"], ohlcv["volume"]], axis=1).astype(np.float32)
        self.data = torch.from_numpy(stacked)

        self.label_tensors: dict[str, torch.Tensor] = {}
        self.mask_tensors: dict[str, torch.Tensor] = {}
        for name, arr in labels.items():
            valid = ~np.isnan(arr)
            lab = np.where(valid, arr, 0.0)
            self.label_tensors[name] = torch.from_numpy(lab.astype(np.float32))
            self.mask_tensors[name] = torch.from_numpy(valid)

        self.first = max(start, window_size - 1)
        self.count = max(0, end - self.first)

    def __len__(self) -> int:
        return self.count

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, dict[str, torch.Tensor], dict[str, torch.Tensor]]:
        bar_idx = self.first + idx
        window = self.data[bar_idx - self.window_size + 1 : bar_idx + 1]
        labels_out = {name: tensor[bar_idx] for name, tensor in self.label_tensors.items()}
        masks_out = {name: tensor[bar_idx] for name, tensor in self.mask_tensors.items()}
        return window, labels_out, masks_out
