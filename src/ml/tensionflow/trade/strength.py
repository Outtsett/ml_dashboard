"""Signal strength quantification from TensionDelta and structural context.

Maps TensionDelta magnitude relative to adaptive thresholds onto a discrete
strength integer: +2 (strong long), +1 (weak long), 0 (neutral), -1 (weak
short), -2 (strong short).  Structural context can upgrade a weak signal to
strong when price is at a structurally significant level with sufficient
confluence.
"""

from __future__ import annotations

from .context import AT_EXTREME, AT_MPD, AT_VALUE_EDGE

# Confluence threshold for AT_VALUE_EDGE upgrade (replaces setup_active).
_VALUE_EDGE_CONFLUENCE: float = 2.0


def compute_strength(
    tension_delta: float,
    bullish_thresh: float,
    bearish_thresh: float,
    context: str,
    confluence: float = 0.0,
) -> int:
    """Compute the discrete signal strength from TensionDelta and context.

    The base strength is determined by how far TensionDelta has crossed the
    adaptive threshold in either direction.  A signal is classified as
    *strong* when its excess over the threshold exceeds the threshold range
    (defined as ``bullish_thresh - bearish_thresh``).

    A context upgrade can further elevate a weak signal to strong when the
    structural situation justifies heightened conviction:
    * Price is at the Value Area edge (VAH/VAL) *and* signal confluence
      exceeds 2.0, indicating multiple signals agree on direction.
    * Price is at an extreme (VWAP upper/lower band), regardless of
      confluence, indicating a statistically unusual extension.
    * Price is at MPD (institutional hard ceiling), always strong.

    Parameters
    ----------
    tension_delta:
        Current TensionDelta scalar.
    bullish_thresh:
        Upper adaptive threshold.  TensionDelta must exceed this for a
        bullish signal.
    bearish_thresh:
        Lower adaptive threshold.  TensionDelta must fall below this for a
        bearish signal.
    context:
        Structural context label from :func:`trade.context.classify_context`.
    confluence:
        Signal confluence score from :func:`trade.confluence.compute_confluence`.
        Used for the ``AT_VALUE_EDGE`` upgrade.  Defaults to 0.0 for backward
        compatibility with existing tests.

    Returns
    -------
    int
        Discrete signal strength in ``{-2, -1, 0, +1, +2}``.
    """
    # Threshold range defines what counts as "excess" conviction.
    threshold_range: float = max(bullish_thresh - bearish_thresh, 0.0)

    if tension_delta > bullish_thresh:
        base: int = 1
        excess: float = tension_delta - bullish_thresh
        strong: bool = threshold_range > 0.0 and excess > threshold_range
    elif tension_delta < bearish_thresh:
        base = -1
        excess = bearish_thresh - tension_delta
        strong = threshold_range > 0.0 and excess > threshold_range
    else:
        # TensionDelta is inside the neutral zone — no signal.
        return 0

    # Context upgrade: structural significance warrants strong signal.
    if context == AT_MPD:
        strong = True
    elif context == AT_EXTREME:
        strong = True
    elif context == AT_VALUE_EDGE and confluence > _VALUE_EDGE_CONFLUENCE:
        strong = True

    return base * 2 if strong else base
