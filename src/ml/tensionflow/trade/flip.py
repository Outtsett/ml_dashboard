"""Flip logic with hysteresis gating.

Determines the final trade action on each scoring cycle by combining the
discrete signal strength with the hysteresis state machine.
"""

from __future__ import annotations

from ..config import (
    ACTION_BUY,
    ACTION_FLATTEN,
    ACTION_NONE,
    ACTION_SELL,
)
from ..state.hysteresis import HysteresisState


def evaluate_flip(
    signal_strength: int,
    hysteresis: HysteresisState,
    tension_delta: float,
    feature_seq: int,
) -> tuple[int, int]:
    """Evaluate whether to flip, hold, or exit the current position.

    Delegates to :meth:`HysteresisState.update` which enforces the
    HYSTERESIS_BARS neutral-zone dwell requirement.  If ``should_flip`` is
    True *and* ``signal_strength != 0``, the flip is committed via
    :meth:`HysteresisState.execute_flip`.  If ``should_exit`` is True, the
    position is flattened.  Otherwise the current position is held.

    Parameters
    ----------
    signal_strength:
        Discrete strength integer from
        :func:`trade.strength.compute_strength`.  In ``{-2, -1, 0, +1, +2}``.
    hysteresis:
        The shared :class:`state.hysteresis.HysteresisState` instance.
        Mutated in place when a flip or flatten occurs.
    tension_delta:
        Current TensionDelta scalar, forwarded to
        :meth:`HysteresisState.update` for neutral-zone determination.
    feature_seq:
        Monotonically increasing feature sequence number from the shared-
        memory block.  Passed through to :meth:`HysteresisState.execute_flip`
        so that flip timing can be recorded for diagnostics.

    Returns
    -------
    tuple[int, int]
        ``(signal, action)`` where:

        * ``signal`` -- the active position direction after this cycle:
          ``+2`` or ``+1`` for long, ``-2`` or ``-1`` for short, ``0`` for
          flat/uninitialised.
        * ``action`` -- one of ``ACTION_BUY``, ``ACTION_SELL``,
          ``ACTION_FLATTEN``, or ``ACTION_NONE`` from config.
    """
    # ── Initial entry (position == 0) ───────────────────────────────────────
    # Hysteresis.update() requires an existing position to evaluate flips and
    # exits.  When uninitialised, allow the first directional signal to
    # establish a position without requiring a prior opposing threshold cross.
    if hysteresis.position == 0 and signal_strength != 0:
        new_position = 1 if signal_strength > 0 else -1
        hysteresis.execute_flip(new_position, feature_seq)
        initial_action: int = ACTION_BUY if new_position == 1 else ACTION_SELL
        return signal_strength, initial_action

    # ── Normal hysteresis path ───────────────────────────────────────────────
    should_flip, should_exit = hysteresis.update(tension_delta, feature_seq)

    if should_exit:
        # Flatten takes precedence; reset hysteresis so next entry is clean.
        hysteresis.reset()
        return 0, ACTION_FLATTEN

    if should_flip and signal_strength != 0:
        # Determine new direction from the signal strength sign.
        new_position: int = 1 if signal_strength > 0 else -1
        hysteresis.execute_flip(new_position, feature_seq)
        flip_action: int = ACTION_BUY if new_position == 1 else ACTION_SELL
        return signal_strength, flip_action

    # No state change — return the current position and no-op action.
    return hysteresis.position, ACTION_NONE
