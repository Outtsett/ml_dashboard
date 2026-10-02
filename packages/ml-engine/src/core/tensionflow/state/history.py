"""Rolling TensionDelta statistics for adaptive threshold computation.

Maintains a sliding window of recent TensionDelta values and derives
mean/std used by the hysteresis state machine to set flip thresholds.
"""

from __future__ import annotations

import collections
import math

from ..config import TENSION_HISTORY_WINDOW, THRESHOLD_SIGMA_MULTIPLIER


class TensionHistory:
    """Rolling window of TensionDelta values with adaptive threshold computation.

    Internally stores values in a deque of fixed capacity so that push() is
    O(1).  Mean and std are maintained incrementally using Welford's online
    algorithm to avoid O(n) recomputation on every access.

    Attributes:
        window: Maximum number of values retained.
        _dq: Deque holding the current window of values.
        _n: Current count of values in the window.
        _mean: Running mean (Welford).
        _M2: Running sum of squared deviations from the mean (Welford).
    """

    def __init__(self, window: int = TENSION_HISTORY_WINDOW) -> None:
        """Initialise an empty history buffer.

        Args:
            window: Number of most-recent TensionDelta values to keep.
                    Defaults to TENSION_HISTORY_WINDOW from config.
        """
        self.window: int = window
        self._dq: collections.deque[float] = collections.deque(maxlen=window)
        self._n: int = 0
        self._mean: float = 0.0
        self._M2: float = 0.0  # sum of squared deviations — Welford accumulator

    # ── Public API ────────────────────────────────────────────────────────────

    def push(self, value: float) -> None:
        """Add a new TensionDelta observation to the rolling window.

        When the window is full the oldest value is evicted first; its
        contribution to the running statistics is removed before the new
        value is incorporated so that mean/std remain accurate at all times.

        NaN or inf values are silently dropped — a single corrupt shared-memory
        read must not permanently corrupt the Welford accumulators.

        Args:
            value: The new TensionDelta scalar to record.
        """
        if not math.isfinite(value):
            return

        if len(self._dq) == self.window:
            # Evict the oldest sample using a reverse Welford update.
            evicted = self._dq[0]
            self._n -= 1
            if self._n == 0:
                self._mean = 0.0
                self._M2 = 0.0
            else:
                old_mean = self._mean
                self._mean = (self._mean * (self._n + 1) - evicted) / self._n
                self._M2 -= (evicted - old_mean) * (evicted - self._mean)
                self._M2 = max(self._M2, 0.0)  # guard floating-point drift

        # Welford online update for the incoming value.
        self._dq.append(value)
        self._n += 1
        delta = value - self._mean
        self._mean += delta / self._n
        delta2 = value - self._mean
        self._M2 += delta * delta2

    def mean(self) -> float:
        """Return the rolling mean of TensionDelta values.

        Returns:
            Arithmetic mean over the current window; 0.0 if the window is
            empty.
        """
        return self._mean if self._n > 0 else 0.0

    def std(self) -> float:
        """Return the rolling population standard deviation.

        Uses population std (divides by n, not n-1) because the window is
        treated as the full reference population for threshold calibration.

        Returns:
            Standard deviation over the current window; 0.0 if fewer than
            two samples have been recorded.
        """
        if self._n < 2:
            return 0.0
        variance = self._M2 / self._n
        return math.sqrt(max(variance, 0.0))

    def bullish_threshold(self) -> float:
        """Adaptive upper threshold for a bullish TensionDelta flip.

        Computed as mean + THRESHOLD_SIGMA_MULTIPLIER * std.  A TensionDelta
        exceeding this value in the opposing direction triggers a LONG signal.

        Returns:
            Scalar threshold above which tension is considered bullish.
        """
        return self.mean() + THRESHOLD_SIGMA_MULTIPLIER * self.std()

    def bearish_threshold(self) -> float:
        """Adaptive lower threshold for a bearish TensionDelta flip.

        Computed as mean - THRESHOLD_SIGMA_MULTIPLIER * std.  A TensionDelta
        falling below this value triggers a SHORT signal.

        Returns:
            Scalar threshold below which tension is considered bearish.
        """
        return self.mean() - THRESHOLD_SIGMA_MULTIPLIER * self.std()

    def __len__(self) -> int:
        """Return the number of values currently in the window."""
        return self._n

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"TensionHistory(window={self.window}, n={self._n}, "
            f"mean={self._mean:.4f}, std={self.std():.4f})"
        )
