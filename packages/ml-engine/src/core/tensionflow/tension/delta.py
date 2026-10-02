"""TensionDelta: net directional pressure from the 210-distance graph.

Computes upzone and downzone directional contribution scores from the
210 benchmark distances, modulated by the composite D_score.  The D_score
replaces the DOM-derived ask/bid multipliers that were removed with Level 2.

The scalar result is the primary output of the TensionFlow scoring pipeline
and drives all downstream trade and risk logic.
"""

from __future__ import annotations

import numpy as np

from ..config import DISTANCES

_UNIFORM_WEIGHT: float = 1.0 / DISTANCES


def compute_tension_delta(
    distances: np.ndarray,
    d_score: float,
    edge_weights: np.ndarray | None = None,
) -> tuple[float, float, float]:
    """Compute TensionDelta from the 210-distance graph modulated by D_score.

    Without DOM data, the D_score acts as the directional multiplier that was
    previously provided by ask/bid pressure from the order book.  A positive
    D_score amplifies upzone contributions (bullish bias); a negative D_score
    amplifies downzone contributions (bearish bias).

    Parameters
    ----------
    distances:
        Shape ``(210,)``.  Signed distances from the current price to each
        benchmark-pair midpoint.  Positive = price above midpoint.
    d_score:
        Composite directional score in [-1, +1] from
        :func:`tension.composite.compute_composite`.
    edge_weights:
        Optional shape ``(210,)`` array of non-negative weights.  If ``None``,
        uniform weights ``1/210`` are used.

    Returns
    -------
    tuple[float, float, float]
        ``(upzone, downzone, tension_delta)`` where ``tension_delta = upzone -
        downzone``.  Positive delta = net bullish pressure; negative = net
        bearish pressure; zero = equilibrium.

    Raises
    ------
    ValueError
        If ``distances`` does not have exactly ``DISTANCES`` elements.
    """
    if distances.shape[0] != DISTANCES:
        raise ValueError(f"distances must have shape ({DISTANCES},), got {distances.shape}")

    if edge_weights is not None:
        if edge_weights.shape[0] != DISTANCES:
            raise ValueError(
                f"edge_weights must have shape ({DISTANCES},), got {edge_weights.shape}"
            )
        weights: np.ndarray = np.asarray(edge_weights, dtype=np.float64)
    else:
        weights = np.full(DISTANCES, _UNIFORM_WEIGHT, dtype=np.float64)

    dist = np.asarray(distances, dtype=np.float64)

    # D_score modulates the zone multipliers.
    # Positive D_score amplifies upzone, dampens downzone (and vice versa).
    up_mult: float = max(0.5 + 0.5 * d_score, 0.1)
    dn_mult: float = max(0.5 - 0.5 * d_score, 0.1)

    # Upzone: positive distances scaled by up_mult.
    up_mask: np.ndarray = dist > 0.0
    upzone: float = float(np.sum(weights[up_mask] * dist[up_mask] * up_mult))

    # Downzone: absolute value of negative distances scaled by dn_mult.
    dn_mask: np.ndarray = dist < 0.0
    downzone: float = float(np.sum(weights[dn_mask] * np.abs(dist[dn_mask]) * dn_mult))

    return upzone, downzone, upzone - downzone
