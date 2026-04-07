"""Flip-prevention state machine for TensionFlow position management.

Tracks the current position (+1 LONG, -1 SHORT, 0 uninitialised), how many
consecutive bars the scorer has spent inside the neutral zone, and the
feature sequence number at which the last flip occurred.  The machine prevents
thrashing by requiring the scorer to dwell in the neutral zone for a
configurable number of bars before allowing an exit, and only allows a flip
when TensionDelta crosses the adaptive threshold in the opposing direction.
"""

from __future__ import annotations

from ..config import (
    HYSTERESIS_BARS,
    NEUTRAL_ZONE_THRESHOLD,
)


class HysteresisState:
    """State machine that gates position flips to prevent signal thrashing.

    The machine enforces two rules:
    1. **Neutral-zone exit**: when |tension_delta| < NEUTRAL_ZONE_THRESHOLD the
       bar is counted.  After HYSTERESIS_BARS consecutive neutral bars the
       machine signals an exit (flatten) if currently in a position.
    2. **Directional flip**: when tension_delta crosses the opposing threshold
       while already in a position, a flip is allowed only if the neutral-zone
       bar count has NOT already forced an exit, preventing a same-bar
       flatten + re-enter race.

    Attributes:
        position: Current position; +1 LONG, -1 SHORT, 0 uninitialised.
        neutral_bars: Consecutive bars spent inside the neutral zone.
        last_flip_seq: feature_seq value at the most recent flip.
    """

    def __init__(self, hysteresis_bars: int = HYSTERESIS_BARS,
                 neutral_zone_threshold: float = NEUTRAL_ZONE_THRESHOLD) -> None:
        """Initialise the hysteresis state machine.

        Args:
            hysteresis_bars: Consecutive neutral-zone bars required before an
                exit signal is emitted.  Defaults to HYSTERESIS_BARS from
                config.
            neutral_zone_threshold: Absolute TensionDelta magnitude below which
                a bar is considered neutral.  Defaults to
                NEUTRAL_ZONE_THRESHOLD from config.
        """
        self._hysteresis_bars: int = hysteresis_bars
        self._neutral_threshold: float = neutral_zone_threshold

        self.position: int = 0          # 0 = uninitialised, +1 LONG, -1 SHORT
        self.neutral_bars: int = 0      # consecutive neutral-zone bar count
        self.last_flip_seq: int = 0     # feature_seq at most recent flip

    # ── Public API ────────────────────────────────────────────────────────────

    def update(self, tension_delta: float, feature_seq: int) -> tuple[bool, bool]:
        """Evaluate the current TensionDelta and return transition signals.

        Called once per scoring cycle.  Determines whether the machine should
        flip to the opposite position or exit (flatten) the current one based
        on the neutral-zone dwell count and directional threshold crossing.

        The logic priority is:
        1. If uninitialised (position == 0), no flip or exit is possible until
           execute_flip() has been called at least once to set a direction.
        2. Count neutral-zone bars; if the dwell limit is reached, signal an
           exit and reset the counter.
        3. If tension_delta crosses the opposing directional threshold while in
           a non-neutral bar, signal a flip.
        4. A bar cannot simultaneously trigger both exit and flip; exit takes
           precedence because it occurs first in bar sequence.

        Args:
            tension_delta: The current composite TensionDelta scalar.
            feature_seq: Monotonically increasing sequence number from the
                         shared-memory feature block, used for timing records.

        Returns:
            (should_flip, should_exit) as a tuple of booleans.
            - should_flip: True when tension_delta has crossed the directional
              threshold and the machine should transition to the opposing side.
            - should_exit: True when the neutral-zone dwell limit has been
              reached and the current position should be flattened.
        """
        should_flip = False
        should_exit = False

        in_neutral = abs(tension_delta) < self._neutral_threshold

        if in_neutral:
            self.neutral_bars += 1
            if self.position != 0 and self.neutral_bars >= self._hysteresis_bars:
                should_exit = True
                self.neutral_bars = 0
        else:
            # Non-neutral bar — reset dwell counter and check for flip.
            self.neutral_bars = 0
            if self.position != 0:
                # Flip when delta opposes the current direction with conviction.
                if self.position == 1 and tension_delta < -self._neutral_threshold:
                    should_flip = True
                elif self.position == -1 and tension_delta > self._neutral_threshold:
                    should_flip = True

        return should_flip, should_exit

    def execute_flip(self, new_position: int, feature_seq: int) -> None:
        """Commit a position flip and record the sequence number.

        Must be called by the caller whenever they act on a (should_flip=True)
        signal from update(), or on the initial entry into a position.  Updates
        internal state so that subsequent update() calls operate relative to the
        new direction.

        Args:
            new_position: The target position to move into.  Must be +1 (LONG)
                          or -1 (SHORT).
            feature_seq: The feature sequence number at which the flip is
                         executed.  Stored in last_flip_seq for diagnostics.

        Raises:
            ValueError: If new_position is not +1 or -1.
        """
        if new_position not in (1, -1):
            raise ValueError(
                f"new_position must be +1 or -1, got {new_position!r}"
            )
        self.position = new_position
        self.last_flip_seq = feature_seq
        self.neutral_bars = 0  # start fresh after committing the flip

    def reset(self) -> None:
        """Reset all state to uninitialised.

        Called after a flatten event to clear position, neutral bar count, and
        flip sequence so the machine waits for a fresh directional signal.
        """
        self.position = 0
        self.neutral_bars = 0
        self.last_flip_seq = 0

    def __repr__(self) -> str:  # pragma: no cover
        pos_str = {1: "LONG", -1: "SHORT", 0: "UNINIT"}.get(self.position, "?")
        return (
            f"HysteresisState(position={pos_str}, neutral_bars={self.neutral_bars}, "
            f"last_flip_seq={self.last_flip_seq})"
        )
