"""Drawdown protection factor for position sizing.

Reduces position size linearly as current drawdown approaches the configured
maximum allowable drawdown.  The factor floor of 0.1 ensures the engine never
goes completely silent — even at maximum drawdown, 10% of the nominal size is
retained so that the system can recover rather than locking out entirely.
"""

from __future__ import annotations

from ..config import MAX_DRAWDOWN_PCT


def compute_drawdown_factor(current_equity: float, peak_equity: float) -> float:
    """Compute a multiplicative position-size reduction factor from drawdown.

    The factor starts at 1.0 (no reduction) and declines linearly toward 0.1
    as the current drawdown approaches ``config.MAX_DRAWDOWN_PCT``.  At or
    above that drawdown level the factor is floored at 0.1 rather than zero
    to preserve some trading activity during the drawdown recovery period.

    Formula::

        current_dd = (peak_equity − current_equity) / peak_equity
        factor = max(0.1, 1.0 − current_dd / MAX_DRAWDOWN_PCT)

    A peak_equity of zero or below is treated as uninitialised and returns
    1.0 (no reduction) to avoid division by zero on session startup.

    Parameters
    ----------
    current_equity:
        Current mark-to-market account equity in consistent currency units.
    peak_equity:
        Highest equity recorded since the start of the trading session (or
        since the last reset).  When equal to ``current_equity``, the
        drawdown is zero and the factor is 1.0.

    Returns
    -------
    float
        Drawdown protection factor in [0.1, 1.0].  Multiply this by the
        nominal contract quantity before placing an order.
    """
    if peak_equity <= 0.0:
        # Uninitialised — return full allocation.
        return 1.0

    current_dd: float = (peak_equity - current_equity) / peak_equity

    # Linear decay: at current_dd == MAX_DRAWDOWN_PCT the factor hits 0.0
    # before the floor; the floor of 0.1 prevents complete shutdown.
    factor: float = 1.0 - current_dd / MAX_DRAWDOWN_PCT
    return float(max(0.1, factor))
