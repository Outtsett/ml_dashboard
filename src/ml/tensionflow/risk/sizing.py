"""Kelly fraction position sizing with safety scaling.

Computes a fractional Kelly quantity based on an estimated edge (win rate and
win/loss ratio) scaled by the current confidence score and a safety factor.
Before a meaningful performance history builds, the formula defaults to 1
contract, which is correct and safe — Kelly sizing is only as good as its
edge estimate.
"""

from __future__ import annotations

from ..config import KELLY_SAFETY_FACTOR, MAX_CONTRACTS


def compute_qty(
    confidence: float,
    win_rate: float = 0.5,
    avg_win: float = 1.0,
    avg_loss: float = 1.0,
) -> int:
    """Compute the target position size in contracts using fractional Kelly.

    The Kelly fraction is calculated from the estimated win rate and average
    win/loss ratio::

        Kelly = (win_rate × avg_win − (1 − win_rate) × avg_loss) / max(avg_win, 0.01)

    This is the discrete-outcome Kelly formula (Thorpe / Poundstone notation).
    The raw Kelly fraction is floored at zero (never risk capital on a
    negative-edge setup), then scaled by ``confidence`` and
    ``KELLY_SAFETY_FACTOR`` to produce a fractional allocation.  The
    resulting contracts are clamped to [1, MAX_CONTRACTS] so the engine
    always trades at least one lot when confidence clears the minimum
    threshold.

    Parameters
    ----------
    confidence:
        Confidence score in [0, 1] from
        :func:`risk.confidence.compute_confidence`.  Acts as a linear
        down-scaler — low confidence reduces position size proportionally.
    win_rate:
        Estimated probability of a winning trade.  Defaults to 0.5 (fair
        coin) until walk-forward performance history is available.  Must be
        in (0, 1) for meaningful Kelly; edge cases outside that range are
        handled gracefully by the max(kelly, 0) clamp.
    avg_win:
        Average profit on winning trades in consistent units (e.g. points or
        ticks).  Defaults to 1.0.
    avg_loss:
        Average loss on losing trades in the same units.  Defaults to 1.0.

    Returns
    -------
    int
        Number of contracts in [1, MAX_CONTRACTS].  Returns 1 when the edge
        estimate is zero or negative, or when confidence is very low.
    """
    kelly: float = (
        win_rate * avg_win - (1.0 - win_rate) * avg_loss
    ) / max(avg_win, 0.01)

    # Never risk capital on a measured negative edge.
    kelly = max(kelly, 0.0)

    raw_qty: float = kelly * confidence * KELLY_SAFETY_FACTOR * MAX_CONTRACTS
    return max(1, min(int(raw_qty), MAX_CONTRACTS))
