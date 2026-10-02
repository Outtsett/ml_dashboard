"""Confidence score from D_score magnitude, TensionDelta, and signal alignment.

Produces a [0, 1] scalar representing overall signal conviction.  Three
sources contribute: composite D_score (50%), TensionDelta magnitude (25%),
and signal alignment (25%).  The alignment term ensures confidence requires
multi-signal agreement, compensating for lost DOM-based conviction signals.
"""

from __future__ import annotations

from ..config import MIN_CONFIDENCE

_D_SCORE_WEIGHT: float = 0.50
_TENSION_WEIGHT: float = 0.25
_ALIGNMENT_WEIGHT: float = 0.25


def compute_confidence(
    d_score: float,
    tension_delta: float,
    alignment: float = 0.0,
) -> float:
    """Map D_score, TensionDelta, and alignment to a [0, 1] confidence scalar.

    Formula::

        raw = |d_score| * 0.50 + min(|tension_delta|, 1.0) * 0.25 + alignment * 0.25
        confidence = clip(raw, 0, 1)

    Parameters
    ----------
    d_score:
        Composite regime-weighted directional score.  Expected range [-1, +1].
    tension_delta:
        TensionDelta scalar.  Magnitude capped at 1.0 before weighting.
    alignment:
        Signal alignment fraction from
        :func:`trade.confluence.compute_alignment`.  Expected range [0, 1].
        Defaults to 0.0 for backward compatibility.

    Returns
    -------
    float
        Confidence in [0, 1].
    """
    raw: float = (
        abs(d_score) * _D_SCORE_WEIGHT
        + min(abs(tension_delta), 1.0) * _TENSION_WEIGHT
        + max(0.0, min(1.0, alignment)) * _ALIGNMENT_WEIGHT
    )
    return float(max(0.0, min(1.0, raw)))


def passes_threshold(confidence: float) -> bool:
    """Return True if confidence meets the minimum required threshold.

    Parameters
    ----------
    confidence:
        Value produced by :func:`compute_confidence`.  Expected in [0, 1].

    Returns
    -------
    bool
        ``True`` when ``confidence >= config.MIN_CONFIDENCE``; ``False``
        otherwise.
    """
    return confidence >= MIN_CONFIDENCE
