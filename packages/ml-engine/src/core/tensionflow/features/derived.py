"""Derived feature extraction: fields pre-bounded by the C engine.

Extracts fields that the C engine has already computed as bounded or
normalised quantities.  Where the engine guarantees a specific range the
values are passed through directly.  Where the engine produces an unbounded
positive scalar it is clipped and rescaled to [0, 1].

All outputs are (60,) float32 arrays, one value per DOM level.
"""

from __future__ import annotations

import numpy as np

from ..config import (
    F_AGGRESSOR_RATIO,
    F_COMPOSITE_TENSION,
    F_MOMENTUM_SCORE,
    F_SIZE_RATIO,
    F_SPREAD_TENSION,
    F_TICK_DIRECTION,
    F_TOXICITY,
    F_VOLUME_PERCENTILE,
    RAW_FIELDS,
    SHMEM_LEVELS,
)


def extract_derived(features: np.ndarray) -> dict[str, np.ndarray]:
    """Extract and range-correct pre-computed C-engine derived fields.

    The C engine computes a number of composite scores that are either already
    normalised or are naturally bounded positive scalars that need only a
    clip-and-rescale to produce a clean [0, 1] output.  This function
    centralises that final conditioning step so that downstream signal modules
    receive consistently bounded inputs.

    Field mapping and conditioning:

    - aggressor_ratio   : F_AGGRESSOR_RATIO  — C engine outputs [0, 1]; pass through.
    - tick_direction    : F_TICK_DIRECTION   — C engine outputs [-1, 1]; pass through.
    - volume_percentile : F_VOLUME_PERCENTILE— C engine outputs [0, 1]; pass through.
    - size_ratio        : F_SIZE_RATIO       — unbounded positive; clip to [0, 5],
                          divide by 5 -> [0, 1].
    - spread_tension    : F_SPREAD_TENSION   — unbounded positive; clip to [0, 5],
                          divide by 5 -> [0, 1].
    - toxicity          : F_TOXICITY         — C engine outputs [0, 1]; pass through.
    - momentum_score    : F_MOMENTUM_SCORE   — unbounded positive; clip to [0, 10],
                          divide by 10 -> [0, 1].
    - composite_tension : F_COMPOSITE_TENSION— C engine outputs [-1, 1]; pass through.

    Args:
        features: (57, 60) float array from the shared-memory feature block.
                  First axis is the field index (RAW_FIELDS = 57), second is
                  the DOM level (SHMEM_LEVELS = 60).

    Returns:
        Dict with the following keys, each mapping to a (60,) float32 array:

        - "aggressor_ratio"   : [0, 1]
        - "tick_direction"    : [-1, 1]
        - "volume_percentile" : [0, 1]
        - "size_ratio"        : [0, 1]
        - "spread_tension"    : [0, 1]
        - "toxicity"          : [0, 1]
        - "momentum_score"    : [0, 1]
        - "composite_tension" : [-1, 1]

    Raises:
        ValueError: If features does not have shape (RAW_FIELDS, SHMEM_LEVELS).
    """
    if features.shape != (RAW_FIELDS, SHMEM_LEVELS):
        raise ValueError(
            f"features must have shape ({RAW_FIELDS}, {SHMEM_LEVELS}), got {features.shape}"
        )

    # Pass-through fields — C engine already guarantees the correct range.
    aggressor_ratio = features[F_AGGRESSOR_RATIO].astype(np.float32).copy()
    tick_direction = features[F_TICK_DIRECTION].astype(np.float32).copy()
    volume_percentile = features[F_VOLUME_PERCENTILE].astype(np.float32).copy()
    toxicity = features[F_TOXICITY].astype(np.float32).copy()
    composite_tension = features[F_COMPOSITE_TENSION].astype(np.float32).copy()

    # Clip-and-rescale fields — engine produces unbounded positive scalars.
    size_ratio = (np.clip(features[F_SIZE_RATIO].astype(np.float64), 0.0, 5.0) / 5.0).astype(
        np.float32
    )

    spread_tension = (
        np.clip(features[F_SPREAD_TENSION].astype(np.float64), 0.0, 5.0) / 5.0
    ).astype(np.float32)

    momentum_score = (
        np.clip(features[F_MOMENTUM_SCORE].astype(np.float64), 0.0, 10.0) / 10.0
    ).astype(np.float32)

    return {
        "aggressor_ratio": aggressor_ratio,
        "tick_direction": tick_direction,
        "volume_percentile": volume_percentile,
        "size_ratio": size_ratio,
        "spread_tension": spread_tension,
        "toxicity": toxicity,
        "momentum_score": momentum_score,
        "composite_tension": composite_tension,
    }
