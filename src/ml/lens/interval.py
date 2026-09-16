"""Causal conformal interval — probability_up -> forward-return quantiles.

At row ``t`` the mapping is calibrated only on rows ``s <= t - horizon_bars``
whose realized forward return is therefore already observable at ``t``. The
calibration is refreshed every ``recalibration_step_bars`` rows over a trailing
window of ``history_bars`` eligible rows; between refreshes the most recent
calibration (which is itself built from rows at or before the current row minus
the horizon) is reused, so no value at ``t`` can move when a return at a row
later than ``t - horizon_bars`` changes.

Bins are the deciles of ``probability_up`` over the calibration window. A bin
holding fewer than ``minimum_bin_observations`` eligible rows emits null, never
a fabricated quantile.
"""

from __future__ import annotations

import numpy as np

#: Exactly LENS_QUANTILE_LEVELS in src/shared/lens/types.ts.
QUANTILE_LEVELS: tuple[float, ...] = (0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95)

DEFAULT_BIN_COUNT = 10
DEFAULT_HISTORY_BARS = 20_000
DEFAULT_MINIMUM_BIN_OBSERVATIONS = 30

METHOD = (
    "causal conformal: probability_up binned into trailing deciles, empirical "
    "quantiles of realized forward return per bin, refreshed on a fixed step "
    "using only rows whose horizon has already elapsed"
)


def recalibration_step_for(row_count: int) -> int:
    """max(25, n // 1000) — the refresh cadence in rows."""
    return max(25, int(row_count) // 1000)


def causal_conformal_quantiles(
    probability_up: np.ndarray,
    realized_return_basis_points: np.ndarray,
    horizon_bars: int,
    *,
    bin_count: int = DEFAULT_BIN_COUNT,
    history_bars: int = DEFAULT_HISTORY_BARS,
    minimum_bin_observations: int = DEFAULT_MINIMUM_BIN_OBSERVATIONS,
    recalibration_step_bars: int | None = None,
) -> tuple[np.ndarray, dict]:
    """Return ``(quantiles, meta)``.

    ``quantiles`` has shape ``(n, 7)`` float32, NaN where the row is not yet
    covered. ``meta`` carries the manifest fields describing the mapping.
    """
    probability = np.asarray(probability_up, dtype=np.float64)
    realized = np.asarray(realized_return_basis_points, dtype=np.float64)
    if probability.shape != realized.shape:
        raise ValueError("probability_up and realized_return_basis_points shape mismatch")
    if horizon_bars < 1:
        raise ValueError(f"horizon_bars must be >= 1, got {horizon_bars}")

    n = probability.size
    step = int(recalibration_step_bars or recalibration_step_for(n))
    out = np.full((n, len(QUANTILE_LEVELS)), np.nan, dtype=np.float32)

    eligible = np.flatnonzero(np.isfinite(realized) & np.isfinite(probability))
    levels = np.asarray(QUANTILE_LEVELS, dtype=np.float64)
    interior = np.linspace(0.0, 1.0, bin_count + 1)[1:-1]

    recalibrations = 0
    for start in range(0, n, step):
        stop = min(n, start + step)
        limit = start - horizon_bars  # inclusive last row whose return is known at `start`
        if limit < 0:
            continue
        upper = int(np.searchsorted(eligible, limit, side="right"))
        if upper == 0:
            continue
        lower = max(0, upper - history_bars)
        selected = eligible[lower:upper]
        if selected.size < minimum_bin_observations:
            continue

        recalibrations += 1
        calibration_probability = probability[selected]
        calibration_realized = realized[selected]
        edges = np.quantile(calibration_probability, interior)
        calibration_bins = np.searchsorted(edges, calibration_probability, side="right")

        per_bin = np.full((bin_count, levels.size), np.nan, dtype=np.float64)
        counts = np.bincount(calibration_bins, minlength=bin_count)
        for b in range(bin_count):
            if counts[b] < minimum_bin_observations:
                continue
            per_bin[b] = np.quantile(calibration_realized[calibration_bins == b], levels)

        block_probability = probability[start:stop]
        block_bins = np.searchsorted(edges, block_probability, side="right")
        block_bins = np.clip(block_bins, 0, bin_count - 1)
        out[start:stop] = per_bin[block_bins].astype(np.float32)

    covered = int(np.isfinite(out[:, 0]).sum())
    meta = {
        "method": METHOD,
        "binCount": int(bin_count),
        "recalibrationStepBars": step,
        "historyBars": int(history_bars),
        "minimumBinObservations": int(minimum_bin_observations),
        "quantiles": [float(q) for q in QUANTILE_LEVELS],
        "coveredBarCount": covered,
        "recalibrationCount": recalibrations,
        "eligibleBarCount": int(eligible.size),
    }
    return out, meta
