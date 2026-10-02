"""Confluence and alignment entry gates from multi-signal agreement.

Quantifies how many of the five core signals (spatial, momentum, band
direction, volume profile, structure) agree on a single direction.
Confluence measures the total magnitude committed to the majority side;
alignment measures the fraction of signals that agree.  Both gates must
clear their respective thresholds before any entry is permitted.
"""

from __future__ import annotations

# Total number of input signals.
_N_SIGNALS: int = 5

# Signals with absolute value at or below this threshold are treated as
# directionally neutral — they carry no conviction and do not contribute
# to either the positive or negative camp.
_DEAD_BAND: float = 0.05


def compute_confluence(
    s_spatial: float,
    s_momentum: float,
    s_band_direction: float,
    s_volume_profile: float,
    s_structure: float,
) -> float:
    """Sum of absolute signal magnitudes that agree with the majority direction.

    The majority direction is determined by comparing the sum of positive
    signal values against the sum of absolute negative signal values.
    Whichever camp is larger defines the majority direction.  Confluence
    is then the sum of magnitudes on that winning side.

    Parameters
    ----------
    s_spatial:
        Spatial signal in ``[-1, +1]``.
    s_momentum:
        Momentum signal in ``[-1, +1]``.
    s_band_direction:
        Band direction signal in ``[-1, +1]``.
    s_volume_profile:
        Volume profile signal in ``[-1, +1]``.
    s_structure:
        Structure signal in ``[-1, +1]``.

    Returns
    -------
    float
        Confluence score in ``[0.0, 5.0]``.  Higher values indicate
        stronger multi-signal agreement.  5.0 means all five signals are
        at their maximum magnitude in the same direction.
    """
    signals: tuple[float, ...] = (
        s_spatial,
        s_momentum,
        s_band_direction,
        s_volume_profile,
        s_structure,
    )

    pos_sum: float = 0.0
    neg_sum: float = 0.0
    for s in signals:
        if s > 0.0:
            pos_sum += s
        elif s < 0.0:
            neg_sum += abs(s)

    # Majority direction is the side with the larger total magnitude.
    # On a tie, both sides are equal so either choice yields the same value.
    if pos_sum >= neg_sum:
        return pos_sum
    return neg_sum


def compute_alignment(
    s_spatial: float,
    s_momentum: float,
    s_band_direction: float,
    s_volume_profile: float,
    s_structure: float,
) -> float:
    """Fraction of signals agreeing with the majority direction.

    Signals whose absolute value falls within the dead band
    (``|s| <= 0.05``) are classified as neutral — they do not vote for
    either direction but still count in the denominator (which is always
    ``_N_SIGNALS = 5``).  This penalises low-conviction regimes: a bar
    with three neutral signals and two agreeing signals scores only 0.4,
    not 1.0.

    If every signal is neutral (no directional votes at all), alignment
    is 0.0 — there is no majority to align with.

    Parameters
    ----------
    s_spatial:
        Spatial signal in ``[-1, +1]``.
    s_momentum:
        Momentum signal in ``[-1, +1]``.
    s_band_direction:
        Band direction signal in ``[-1, +1]``.
    s_volume_profile:
        Volume profile signal in ``[-1, +1]``.
    s_structure:
        Structure signal in ``[-1, +1]``.

    Returns
    -------
    float
        Alignment ratio in ``[0.0, 1.0]``.  0.60 means three of five
        signals agree with the majority direction.
    """
    signals: tuple[float, ...] = (
        s_spatial,
        s_momentum,
        s_band_direction,
        s_volume_profile,
        s_structure,
    )

    pos_count: int = 0
    neg_count: int = 0
    for s in signals:
        if s > _DEAD_BAND:
            pos_count += 1
        elif s < -_DEAD_BAND:
            neg_count += 1

    # No directional signals at all — no majority exists.
    if pos_count == 0 and neg_count == 0:
        return 0.0

    majority_count: int = max(pos_count, neg_count)
    return majority_count / _N_SIGNALS
