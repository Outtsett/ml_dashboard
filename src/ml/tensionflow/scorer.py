"""TensionFlow main scoring loop (Level 1 only).

Polls shared memory for new feature_seq, runs the L1-only pipeline
(normalize -> signals -> aggregate -> trigger -> risk), and writes
the 64-byte ScoreBlock back to shared memory.

Usage:
    python -m tensionflow.scorer [--config path/to/config.toml]

Or imported:
    from tensionflow.scorer import TensionFlowScorer
    scorer = TensionFlowScorer()
    scorer.run()
"""

from __future__ import annotations

import collections
import json
import logging
import signal as signal_mod
import time
from pathlib import Path

import numpy as np

from shared.shmem import FeatureSnapshot, ShmemReader, ShmemWriter

from .config import (
    ACTION_BUY,
    ACTION_FLATTEN,
    ACTION_NONE,
    ACTION_SELL,
    MIN_ALIGNMENT,
    MIN_CONFLUENCE,
    POLL_INTERVAL_SEC,
)
from .features.spatial import normalize_spatial_full
from .risk.confidence import compute_confidence, passes_threshold
from .risk.drawdown import compute_drawdown_factor
from .risk.sizing import compute_qty
from .risk.stops import compute_stops
from .signals.band_direction import compute_band_direction
from .signals.momentum import compute_momentum
from .signals.spatial import compute_spatial
from .signals.structure import compute_structure
from .signals.volume_profile import compute_volume_profile
from .state.history import TensionHistory
from .state.hysteresis import HysteresisState
from .state.regime import select_weight_profile
from .tension.composite import compute_composite
from .tension.delta import compute_tension_delta
from .trade.confluence import compute_alignment, compute_confluence
from .trade.context import classify_context
from .trade.flip import evaluate_flip
from .trade.strength import compute_strength
from .trade.threshold import compute_thresholds

log = logging.getLogger(__name__)

# Metrics JSONL log — scorer runs standalone (not as Node subprocess), so emit_metric
# stdout protocol does not reach the dashboard. Write structured metrics to a file
# that can be tailed or ingested separately.
_METRICS_LOG_PATH = Path(r"E:\source\repos\ml_dashboard\logs\tensionflow_metrics.jsonl")


def _write_metric(name: str, value: float, tick: int, **extra) -> None:
    """Append a single JSON metrics line to the JSONL log file."""
    record = {"ts": time.time(), "tick": tick, "name": name, "value": value, **extra}
    try:
        with _METRICS_LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError as exc:
        log.warning("event=metric_write_fail name=%s err=%s", name, exc)


def _emit_periodic_metrics(
    tick: int,
    tension_delta: float,
    d_score: float,
    signal: int,
    confidence: float,
) -> None:
    """Write all per-100-tick metrics in one pass."""
    _write_metric("tension_delta", tension_delta, tick)
    _write_metric("composite_score", d_score, tick)
    _write_metric("signal_strength", float(signal), tick)
    _write_metric("confidence", confidence, tick)


class TensionFlowScorer:
    """Main scoring engine.  Reads shared memory, computes TensionDelta, writes ScoreBlock."""

    def __init__(self) -> None:
        self._reader = ShmemReader()
        self._writer = ShmemWriter()

        # Rolling state
        self._tension_history = TensionHistory()
        self._hysteresis = HysteresisState()

        # Previous tick state for momentum and band direction signals
        self._prev_distances: np.ndarray | None = None
        self._prev_benchmarks: np.ndarray | None = None

        # Tracking
        self._last_seq: int = 0
        self._ticks_scored: int = 0
        self._errors: int = 0
        # Sliding window: track error ticks in the last 1000 ticks.
        # Kills scorer only if 100+ errors occur within this window.
        self._recent_error_ticks: collections.deque[int] = collections.deque(maxlen=1000)

        # Risk state (updated externally or via future integration)
        self._peak_equity: float = 0.0
        self._current_equity: float = 0.0

    # ── Main Loop ────────────────────────────────────────────────────────────

    def run(self) -> None:
        """Poll shared memory and score every new tick.  Blocks until stopped."""
        self._reader.open()
        self._writer.open()
        log.info("event=start msg='TensionFlow scorer started' poll_interval=%.3f", POLL_INTERVAL_SEC)

        running = True

        def _handle_sigterm(signum: int, frame: object) -> None:
            nonlocal running
            log.info("event=sigterm msg='Received SIGTERM, shutting down gracefully'")
            running = False

        signal_mod.signal(signal_mod.SIGTERM, _handle_sigterm)

        try:
            while running:
                seq = self._reader.read_feature_seq()
                if seq == self._last_seq:
                    time.sleep(POLL_INTERVAL_SEC)
                    continue

                snapshot = self._reader.read_snapshot()
                self._score_tick(snapshot)
                self._last_seq = seq
        except KeyboardInterrupt:
            log.info("event=stop msg='TensionFlow scorer stopped by user'")
        finally:
            self._reader.close()
            self._writer.close()
            log.info(
                "event=shutdown ticks_scored=%d errors=%d",
                self._ticks_scored,
                self._errors,
            )

    # ── Per-Tick Pipeline ────────────────────────────────────────────────────

    def _score_tick(self, snap: FeatureSnapshot) -> None:
        """Run the full pipeline, with error recovery on bad ticks."""
        try:
            self._run_pipeline(snap)
        except Exception:
            self._errors += 1
            self._recent_error_ticks.append(self._ticks_scored)
            log.exception(
                "event=tick_error seq=%d errors_total=%d errors_recent=%d",
                snap.feature_seq,
                self._errors,
                len(self._recent_error_ticks),
            )
            # Kill only if 100+ errors in the recent window (last 1000 ticks).
            window_start = self._ticks_scored - 1000
            recent_count = sum(1 for t in self._recent_error_ticks if t >= window_start)
            if recent_count > 100:
                log.critical(
                    "event=too_many_errors errors_recent=%d msg='100+ errors in last 1000 ticks, stopping'",
                    recent_count,
                )
                raise

    def _run_pipeline(self, snap: FeatureSnapshot) -> None:
        """Level-1-only 4-layer pipeline.

        Signals:
          - S_spatial: price-to-benchmark distances + convergence modifier
          - S_momentum: benchmark velocity + Bollinger band state
          - S_band_direction: VWAP/VPOC/TWAP band conditions
          - S_volume_profile: VPOC drift, distribution skew, VA width
          - S_structure: benchmark confluence, distance graph topology
        """

        features_2d = snap.features          # (57, SHMEM_LEVELS)
        benchmarks = snap.benchmarks         # (15,) f64
        distances = snap.distances           # (210,) f32

        # ── Layer 1: Normalize ───────────────────────────────────────────────

        norm_full = normalize_spatial_full(distances, benchmarks)
        norm_spatial = norm_full["price_to_bench"]
        pair_distances = norm_full["pair_distances"]

        # ── Layer 2: Domain Signals (all Level 1) ────────────────────────────

        s_spatial = compute_spatial(norm_spatial, pair_distances)

        spread_tension = float(features_2d[50, 0]) if features_2d.shape[0] > 50 else 1.0
        s_momentum = compute_momentum(norm_spatial, self._prev_distances, spread_tension)
        self._prev_distances = norm_spatial.copy()

        s_band_direction = compute_band_direction(
            benchmarks, self._prev_benchmarks, distances
        )

        s_volume_profile = compute_volume_profile(
            benchmarks, self._prev_benchmarks, distances
        )

        self._prev_benchmarks = benchmarks.copy()

        s_structure = compute_structure(benchmarks, distances)

        # ── Layer 3: Regime-Adaptive Aggregation ─────────────────────────────

        weight_profile = select_weight_profile(snap.markov_state, snap.vol_regime)

        d_score = compute_composite(
            s_spatial, s_momentum, s_band_direction,
            s_volume_profile, s_structure, weight_profile
        )

        # TensionDelta: distance-graph based, modulated by D_score
        upzone, downzone, tension_delta = compute_tension_delta(distances, d_score)

        # Push to history for adaptive thresholds
        self._tension_history.push(tension_delta)

        # ── Confluence and Alignment gates ───────────────────────────────────

        confluence = compute_confluence(
            s_spatial, s_momentum, s_band_direction,
            s_volume_profile, s_structure
        )
        alignment = compute_alignment(
            s_spatial, s_momentum, s_band_direction,
            s_volume_profile, s_structure
        )

        # ── Layer 4: Trade Decision ──────────────────────────────────────────

        bullish_thresh, bearish_thresh = compute_thresholds(self._tension_history)

        context = classify_context(benchmarks, distances)

        strength = compute_strength(
            tension_delta,
            bullish_thresh,
            bearish_thresh,
            context,
            confluence=confluence,
        )

        signal, action = evaluate_flip(
            strength,
            self._hysteresis,
            tension_delta,
            snap.feature_seq,
        )

        # ── Risk Gates ───────────────────────────────────────────────────────

        confidence = compute_confidence(d_score, tension_delta, alignment)

        # Confluence gate: suppress entry when insufficient signal agreement
        if (confluence < MIN_CONFLUENCE or alignment < MIN_ALIGNMENT) and action in (ACTION_BUY, ACTION_SELL):
            signal = self._hysteresis.position
            action = ACTION_NONE
            confidence = 0.0

        if not passes_threshold(confidence) and action not in (ACTION_FLATTEN,):
            signal = self._hysteresis.position
            action = ACTION_NONE
            confidence = 0.0

        # Drawdown scaling
        dd_factor = compute_drawdown_factor(self._current_equity, self._peak_equity)

        qty = compute_qty(confidence * dd_factor)
        stop_ticks, target_ticks = compute_stops(signal, benchmarks)

        # ── Write ScoreBlock ─────────────────────────────────────────────────

        regime_id = snap.markov_state
        weight_mode = 0  # Mode B (fixed weights)

        self._writer.write_score(
            composite=float(d_score),
            upzone=float(upzone),
            downzone=float(downzone),
            tension_delta=float(tension_delta),
            signal=int(signal),
            action=int(action),
            regime_id=int(regime_id),
            weight_mode=int(weight_mode),
            confidence=float(confidence),
            qty=int(qty),
            stop_ticks=float(stop_ticks),
            target_ticks=float(target_ticks),
        )

        self._ticks_scored += 1

        if self._ticks_scored % 100 == 0:
            _emit_periodic_metrics(
                tick=self._ticks_scored,
                tension_delta=float(tension_delta),
                d_score=float(d_score),
                signal=int(signal),
                confidence=float(confidence),
            )

        if self._ticks_scored % 1000 == 0:
            log.info(
                "event=tick_summary ticks=%d TD=%.4f signal=%+d conf=%.2f errors=%d",
                self._ticks_scored,
                tension_delta,
                signal,
                confidence,
                self._errors,
            )


# ── CLI Entry Point ──────────────────────────────────────────────────────────


def main() -> None:
    """Entry point for ``python -m tensionflow.scorer``."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    scorer = TensionFlowScorer()
    scorer.run()


if __name__ == "__main__":
    main()
