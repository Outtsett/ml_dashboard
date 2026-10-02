"""State renumbering — contiguous IDs sorted by frequency.

Pure function with a single responsibility: take raw HMM state indices
and produce a clean 0..N-1 relabeling.  No colors, no labels.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True, slots=True)
class RenumberResult:
    """Output of renumber_states().

    Attributes:
        states:       Array of renumbered state indices (0..n_regimes-1).
        n_regimes:    Number of active regimes after filtering.
        old_to_new:   Mapping from original state ID to new contiguous ID.
    """

    states: NDArray[np.intp]
    n_regimes: int
    old_to_new: dict[int, int]


def renumber_states(
    raw_states: NDArray[np.intp],
    *,
    min_pct: float = 0.01,
) -> RenumberResult:
    """Renumber raw HMM states to contiguous 0..N-1 sorted by frequency.

    1. Filter regimes occupying < *min_pct* of total bars.
    2. Sort remaining regimes by count (most common → 0).
    3. Map filtered bars to the nearest valid predecessor.

    Args:
        raw_states: 1-D array of raw state assignments from the model.
        min_pct:    Minimum fraction of bars a regime must occupy to survive.

    Returns:
        RenumberResult with renumbered states, count, and mapping.
    """
    T = len(raw_states)
    threshold = max(1, T * min_pct)

    unique, counts = np.unique(raw_states, return_counts=True)

    # Keep regimes above the threshold
    active_mask = counts > threshold
    active = unique[active_mask]
    active_counts = counts[active_mask]

    # Sort descending by frequency
    order = np.argsort(-active_counts)
    active = active[order]

    old_to_new = {int(old): new for new, old in enumerate(active)}
    n_regimes = len(active)

    # Relabel — assign -1 to bars from filtered-out regimes
    relabeled = np.array([old_to_new.get(int(s), -1) for s in raw_states], dtype=np.intp)

    # Fill gaps: propagate last valid assignment forward
    # If the first bar(s) are invalid, fill backward from the first valid bar
    for i in range(len(relabeled)):
        if relabeled[i] == -1:
            relabeled[i] = relabeled[max(0, i - 1)]

    # Edge case: first bars had no valid predecessor — backfill from first valid
    if relabeled[0] == -1:
        first_valid = 0
        for j in range(len(relabeled)):
            if relabeled[j] != -1:
                first_valid = relabeled[j]
                break
        else:
            first_valid = 0  # all filtered — assign regime 0
        for j in range(len(relabeled)):
            if relabeled[j] == -1:
                relabeled[j] = first_valid
            else:
                break

    return RenumberResult(states=relabeled, n_regimes=n_regimes, old_to_new=old_to_new)
