"""Adaptive flip thresholds derived from TensionDelta history.

Wraps the :class:`state.history.TensionHistory` adaptive threshold API with a
stable function interface and a cold-start guard: fewer than 10 observations
are insufficient for a statistically meaningful threshold, so fixed defaults
of ±0.3 are returned until the window is seeded.
"""

from __future__ import annotations

from ..state.history import TensionHistory

# Cold-start default thresholds — used until at least MIN_HISTORY_SIZE
# observations are available for a meaningful mean/std estimate.
_DEFAULT_BULLISH: float = 0.3
_DEFAULT_BEARISH: float = -0.3
_MIN_HISTORY_SIZE: int = 10


def compute_thresholds(history: TensionHistory) -> tuple[float, float]:
    """Return the adaptive bullish and bearish flip thresholds.

    Delegates to :meth:`TensionHistory.bullish_threshold` and
    :meth:`TensionHistory.bearish_threshold`, which compute
    ``mean ± THRESHOLD_SIGMA_MULTIPLIER × std`` over the rolling window.

    A cold-start guard prevents noisy thresholds in the first few bars: if
    the history buffer contains fewer than ``_MIN_HISTORY_SIZE`` values the
    function returns the fixed defaults ±0.3 instead.  Once the buffer is
    sufficiently populated the adaptive values take over automatically.

    Parameters
    ----------
    history:
        A :class:`state.history.TensionHistory` instance that has been
        updated via :meth:`TensionHistory.push` on every scoring cycle.

    Returns
    -------
    tuple[float, float]
        ``(bullish_threshold, bearish_threshold)``.

        * ``bullish_threshold`` — TensionDelta must *exceed* this value to
          trigger a LONG flip.  Always ``>= 0`` for a well-seeded window.
        * ``bearish_threshold`` — TensionDelta must *fall below* this value
          to trigger a SHORT flip.  Always ``<= 0`` for a well-seeded window.
    """
    if len(history) < _MIN_HISTORY_SIZE:
        return _DEFAULT_BULLISH, _DEFAULT_BEARISH

    return history.bullish_threshold(), history.bearish_threshold()
