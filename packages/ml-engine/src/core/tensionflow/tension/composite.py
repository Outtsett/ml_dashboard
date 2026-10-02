"""Regime-adaptive composite D_score from five domain signals.

Linearly combines spatial, momentum, band_direction, volume_profile, and
structure signals using the weight profile chosen by the regime detector.
The result is clipped to [-1, +1] to keep downstream stages numerically stable.
"""

from __future__ import annotations


def compute_composite(
    s_spatial: float,
    s_momentum: float,
    s_band_direction: float,
    s_volume_profile: float,
    s_structure: float,
    weight_profile: dict,
) -> float:
    """Compute the regime-adaptive composite D_score.

    Each of the five domain signals is multiplied by its regime-specific
    weight and the products are summed.  The weight profile is expected to
    come from ``config.REGIME_WEIGHTS[regime_id]`` via
    :func:`state.regime.select_weight_profile`.

    Parameters
    ----------
    s_spatial:
        S_spatial directional signal in [-1, +1].
    s_momentum:
        S_momentum signal in [-1, +1].
    s_band_direction:
        S_band_direction signal in [-1, +1].
    s_volume_profile:
        S_volume_profile signal in [-1, +1].
    s_structure:
        S_structure signal in [-1, +1].
    weight_profile:
        Dict with keys ``"spatial"``, ``"momentum"``, ``"band_direction"``,
        ``"volume_profile"``, ``"structure"`` whose values are non-negative
        floats that sum to 1.0.

    Returns
    -------
    float
        Composite directional score clipped to [-1, +1].

    Raises
    ------
    KeyError
        If ``weight_profile`` is missing any of the five required keys.
    """
    d_score: float = (
        weight_profile["spatial"] * s_spatial
        + weight_profile["momentum"] * s_momentum
        + weight_profile["band_direction"] * s_band_direction
        + weight_profile["volume_profile"] * s_volume_profile
        + weight_profile["structure"] * s_structure
    )

    # Clip to keep the output in the canonical signal range.
    return float(max(-1.0, min(1.0, d_score)))
