"""Shared utilities for signal modules."""

from __future__ import annotations

import numpy as np

from ..config import SHMEM_LEVELS


def level_array(source: dict, key: str, active_levels: int | None = None) -> np.ndarray:
    """Extract a float32 array for *key* from *source*, sized to active_levels.

    Returns a zero array when the key is missing or the stored array is
    shorter than the requested size, so the signal degrades gracefully on
    missing data.

    Parameters
    ----------
    source:
        Dictionary of normalized feature arrays keyed by string name.
    key:
        String key to look up (e.g. ``"delta_z"``, ``"imbalance"``).
    active_levels:
        Number of DOM levels to return.  Defaults to SHMEM_LEVELS.

    Returns
    -------
    np.ndarray
        Shape ``(active_levels,)`` float32.
    """
    n = active_levels if active_levels is not None else SHMEM_LEVELS
    arr = source.get(key)
    if arr is None:
        return np.zeros(n, dtype=np.float32)
    arr = np.asarray(arr, dtype=np.float32).ravel()
    if arr.shape[0] < n:
        padded = np.zeros(n, dtype=np.float32)
        padded[: arr.shape[0]] = arr
        return padded
    return arr[:n]
