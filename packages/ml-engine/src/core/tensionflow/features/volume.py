"""Volume feature normalisation: z-score normalisation across 60 DOM levels.

Extracts volume-related fields from the (57, 60) feature matrix and returns
z-score normalised arrays clipped to [-1, +1].  filtered_pct is passed
through unchanged because the C engine already produces it in [0, 1].
"""

from __future__ import annotations

import numpy as np

from ..config import (
    F_BUY_VOLUME,
    F_CUM_DELTA,
    F_DELTA,
    F_FILTERED_PCT,
    F_SELL_VOLUME,
    F_VOLUME,
    RAW_FIELDS,
    SHMEM_LEVELS,
)

# Clip bound after z-scoring; rescale to [-1, 1] by dividing by this.
_CLIP: float = 3.0


def _zscore_clip(arr: np.ndarray) -> np.ndarray:
    """Z-score normalise a 1-D array, clip to [-3, 3], rescale to [-1, 1].

    Args:
        arr: (60,) float array of raw values for a single field.

    Returns:
        (60,) float32 array in [-1, 1].
    """
    arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)
    mean = arr.mean()
    std = arr.std()
    std = max(float(std), 1e-6)
    z = (arr - mean) / std
    z = np.clip(z, -_CLIP, _CLIP)
    return (z / _CLIP).astype(np.float32)


def normalize_volume(features: np.ndarray) -> dict[str, np.ndarray]:
    """Z-score normalise volume-related fields across 60 DOM price levels.

    The feature matrix is laid out field-major: features[field, level] gives
    the value of field at DOM level `level`.  Six fields are extracted:

    - volume_z      : total traded volume per level (F_VOLUME)
    - buy_vol_z     : buy-side volume per level (F_BUY_VOLUME)
    - sell_vol_z    : sell-side volume per level (F_SELL_VOLUME)
    - delta_z       : buy minus sell volume (F_DELTA)
    - filtered_pct  : C-engine filtered-volume percentage [0, 1] (F_FILTERED_PCT),
                      passed through without modification
    - cum_delta_z   : cumulative buy-sell delta per level (F_CUM_DELTA)

    Args:
        features: (57, 60) float array from the shared-memory feature block.
                  First axis is the field index (RAW_FIELDS = 57), second is
                  the DOM level (SHMEM_LEVELS = 60).

    Returns:
        Dict with keys "volume_z", "buy_vol_z", "sell_vol_z", "delta_z",
        "filtered_pct", "cum_delta_z".  Each value is a (60,) float32 array.
        volume_z / buy_vol_z / sell_vol_z / delta_z / cum_delta_z are in
        [-1, 1]; filtered_pct is in [0, 1].

    Raises:
        ValueError: If features does not have shape (RAW_FIELDS, SHMEM_LEVELS).
    """
    if features.shape != (RAW_FIELDS, SHMEM_LEVELS):
        raise ValueError(
            f"features must have shape ({RAW_FIELDS}, {SHMEM_LEVELS}), got {features.shape}"
        )

    volume_z = _zscore_clip(features[F_VOLUME].astype(np.float64))
    buy_vol_z = _zscore_clip(features[F_BUY_VOLUME].astype(np.float64))
    sell_vol_z = _zscore_clip(features[F_SELL_VOLUME].astype(np.float64))
    delta_z = _zscore_clip(features[F_DELTA].astype(np.float64))
    cum_delta_z = _zscore_clip(features[F_CUM_DELTA].astype(np.float64))

    # filtered_pct is already in [0, 1] from the C engine — pass through.
    filtered_pct = features[F_FILTERED_PCT].astype(np.float32).copy()

    return {
        "volume_z": volume_z,
        "buy_vol_z": buy_vol_z,
        "sell_vol_z": sell_vol_z,
        "delta_z": delta_z,
        "filtered_pct": filtered_pct,
        "cum_delta_z": cum_delta_z,
    }
