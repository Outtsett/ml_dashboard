"""
State vectors for similarity search and clustering.

Why: a bar's market state is a fixed-length binary vector (one dimension per
FLAG, ordered by registry bit). Hamming/Jaccard distance on these vectors finds
historically similar regimes; the packed `state_code` is the same vector as one
UInt32 for exact-match grouping or vector-DB metadata filters.
"""

from __future__ import annotations

import numpy as np
import polars as pl

from src.features.Registry import FeatureRegistry


def state_matrix(df: pl.DataFrame, registry: FeatureRegistry) -> np.ndarray:
    """(n_bars, n_flags) float32 matrix in bit order — ready for a vector index or k-means."""
    keys = [s.key for s in registry.flags_by_bit()]
    return df.select(keys).to_numpy().astype(np.float32, copy=False)


def decode_state(code: int, registry: FeatureRegistry) -> list[str]:
    """Inverse of state_code: names of the flags set in one bitmask."""
    return [s.key for s in registry.flags_by_bit() if code >> s.bit & 1]
