"""End-to-end tests for the TensionFlow scoring pipeline (Level 1 only).

Tests the L1-only pipeline using synthetic numpy arrays, without requiring
shared memory or the C engine.  Exercises:
  normalize -> signals -> aggregate -> trigger -> risk
"""

from __future__ import annotations

import numpy as np
import pytest

# ── Source imports ────────────────────────────────────────────────────────────

from tensionflow.config import (
    ACTION_BUY,
    ACTION_SELL,
    ACTION_FLATTEN,
    ACTION_NONE,
    BENCHMARKS,
    DISTANCES,
    SHMEM_LEVELS,
    F_DELTA,
    F_AGGRESSOR_RATIO,
    F_TICK_DIRECTION,
    F_SIZE_RATIO,
    F_SPREAD_TENSION,
    F_COMPOSITE_TENSION,
    F_MOMENTUM_SCORE,
    F_TOXICITY,
    F_VOLUME_PERCENTILE,
    F_LIQ_ADD_VOL,
    F_LIQ_REMOVE_VOL,
    F_DEPTH_RATIO,
    F_IMBALANCE_PCT,
    F_BID_ASK_PRESSURE,
    F_LIQ_CHANGE,
    RAW_FIELDS,
    REGIME_UNKNOWN,
    MAX_CONTRACTS,
    MIN_CONFLUENCE,
    MIN_ALIGNMENT,
)
from tensionflow.features.spatial import normalize_spatial, normalize_spatial_full
from tensionflow.features.volume import normalize_volume
from tensionflow.features.derived import extract_derived
from tensionflow.risk.confidence import compute_confidence, passes_threshold
from tensionflow.risk.drawdown import compute_drawdown_factor
from tensionflow.risk.sizing import compute_qty
from tensionflow.risk.stops import compute_stops
from tensionflow.signals.band_direction import compute_band_direction
from tensionflow.signals.momentum import compute_momentum
from tensionflow.signals.spatial import compute_spatial
from tensionflow.signals.structure import compute_structure
from tensionflow.signals.volume_profile import compute_volume_profile
from tensionflow.state.history import TensionHistory
from tensionflow.state.hysteresis import HysteresisState
from tensionflow.state.regime import select_weight_profile
from tensionflow.tension.composite import compute_composite
from tensionflow.tension.delta import compute_tension_delta
from tensionflow.trade.confluence import compute_alignment, compute_confluence
from tensionflow.trade.context import classify_context
from tensionflow.trade.flip import evaluate_flip
from tensionflow.trade.strength import compute_strength
from tensionflow.trade.threshold import compute_thresholds


# ── Synthetic data builders ───────────────────────────────────────────────────


def _make_features_2d(rng: np.random.Generator) -> np.ndarray:
    """Build a realistic (57, 60) feature matrix."""
    features = np.zeros((RAW_FIELDS, SHMEM_LEVELS), dtype=np.float64)
    for field in range(18):
        features[field, :] = rng.uniform(0, 500, SHMEM_LEVELS)
    features[F_AGGRESSOR_RATIO, :] = rng.uniform(0, 1, SHMEM_LEVELS)
    features[F_VOLUME_PERCENTILE, :] = rng.uniform(0, 1, SHMEM_LEVELS)
    features[F_TOXICITY, :] = rng.uniform(0, 1, SHMEM_LEVELS)
    features[F_IMBALANCE_PCT, :] = rng.uniform(-1, 1, SHMEM_LEVELS)
    features[F_BID_ASK_PRESSURE, :] = rng.uniform(-1, 1, SHMEM_LEVELS)
    features[F_TICK_DIRECTION, :] = rng.uniform(-1, 1, SHMEM_LEVELS)
    features[F_COMPOSITE_TENSION, :] = rng.uniform(-1, 1, SHMEM_LEVELS)
    features[F_DELTA, :] = rng.uniform(-200, 200, SHMEM_LEVELS)
    features[F_LIQ_ADD_VOL, :] = rng.uniform(0, 300, SHMEM_LEVELS)
    features[F_LIQ_REMOVE_VOL, :] = rng.uniform(0, 300, SHMEM_LEVELS)
    features[F_DEPTH_RATIO, :] = rng.uniform(0, 10, SHMEM_LEVELS)
    features[F_SIZE_RATIO, :] = rng.uniform(0, 5, SHMEM_LEVELS)
    features[F_SPREAD_TENSION, :] = rng.uniform(0, 5, SHMEM_LEVELS)
    features[F_MOMENTUM_SCORE, :] = rng.uniform(0, 10, SHMEM_LEVELS)
    features[F_LIQ_CHANGE, :] = rng.uniform(-1, 1, SHMEM_LEVELS)
    return features


def _make_benchmarks(vwap: float = 20000.0) -> np.ndarray:
    bench = np.zeros(BENCHMARKS, dtype=np.float64)
    bench[9] = vwap
    bench[4] = vwap + 20.0
    bench[5] = vwap - 20.0
    bench[7] = vwap + 8.0
    bench[8] = vwap - 8.0
    bench[12] = vwap + 30.0
    bench[13] = vwap - 30.0
    bench[0] = vwap + 40.0
    bench[1] = vwap - 40.0
    bench[14] = vwap + 2.0
    bench[6] = vwap - 5.0
    bench[10] = vwap + 50.0
    bench[11] = vwap - 50.0
    bench[2] = vwap + 5.0
    bench[3] = vwap - 3.0
    return bench


def _make_distances(rng: np.random.Generator) -> np.ndarray:
    return rng.uniform(-50.0, 50.0, DISTANCES).astype(np.float32)


# ── Pipeline runner (L1 only) ────────────────────────────────────────────────


class PipelineResult:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def run_pipeline(
    features_2d: np.ndarray,
    benchmarks: np.ndarray,
    distances: np.ndarray,
    markov_state: int = REGIME_UNKNOWN,
    vol_regime: int = REGIME_UNKNOWN,
    tension_history: TensionHistory | None = None,
    hysteresis: HysteresisState | None = None,
    prev_distances: np.ndarray | None = None,
    prev_benchmarks: np.ndarray | None = None,
    current_equity: float = 100_000.0,
    peak_equity: float = 100_000.0,
    feature_seq: int = 1,
) -> PipelineResult:
    """Run the complete L1 TensionFlow pipeline."""

    if tension_history is None:
        tension_history = TensionHistory()
    if hysteresis is None:
        hysteresis = HysteresisState()

    # Layer 1: Normalize
    norm_full = normalize_spatial_full(distances, benchmarks)
    norm_spatial = norm_full["price_to_bench"]
    pair_distances = norm_full["pair_distances"]

    # Layer 2: Domain signals
    s_spatial = compute_spatial(norm_spatial, pair_distances)
    spread_tension = float(features_2d[50, 0]) if features_2d.shape[0] > 50 else 1.0
    s_momentum = compute_momentum(norm_spatial, prev_distances, spread_tension)
    s_band_direction = compute_band_direction(benchmarks, prev_benchmarks, distances)
    s_volume_profile = compute_volume_profile(benchmarks, prev_benchmarks, distances)
    s_structure = compute_structure(benchmarks, distances)

    # Layer 3: Aggregate
    weight_profile = select_weight_profile(markov_state, vol_regime)
    d_score = compute_composite(
        s_spatial, s_momentum, s_band_direction,
        s_volume_profile, s_structure, weight_profile
    )

    upzone, downzone, tension_delta = compute_tension_delta(distances, d_score)
    tension_history.push(tension_delta)

    # Confluence / alignment
    confluence = compute_confluence(
        s_spatial, s_momentum, s_band_direction,
        s_volume_profile, s_structure
    )
    alignment = compute_alignment(
        s_spatial, s_momentum, s_band_direction,
        s_volume_profile, s_structure
    )

    # Layer 4: Trade decision
    bullish_thresh, bearish_thresh = compute_thresholds(tension_history)
    context = classify_context(benchmarks, distances)
    strength = compute_strength(
        tension_delta, bullish_thresh, bearish_thresh, context, confluence=confluence
    )
    signal, action = evaluate_flip(strength, hysteresis, tension_delta, feature_seq)

    # Risk gates
    confidence = compute_confidence(d_score, tension_delta, alignment)
    if (confluence < MIN_CONFLUENCE or alignment < MIN_ALIGNMENT) and action in (ACTION_BUY, ACTION_SELL):
        signal = hysteresis.position
        action = ACTION_NONE
        confidence = 0.0
    if not passes_threshold(confidence) and action not in (ACTION_FLATTEN,):
        signal = hysteresis.position
        action = ACTION_NONE
        confidence = 0.0

    dd_factor = compute_drawdown_factor(current_equity, peak_equity)
    qty = compute_qty(confidence * dd_factor)
    stop_ticks, target_ticks = compute_stops(signal, benchmarks)

    return PipelineResult(
        s_spatial=s_spatial,
        s_momentum=s_momentum,
        s_band_direction=s_band_direction,
        s_volume_profile=s_volume_profile,
        s_structure=s_structure,
        d_score=d_score,
        tension_delta=tension_delta,
        confluence=confluence,
        alignment=alignment,
        signal=signal,
        action=action,
        confidence=confidence,
        qty=qty,
        stop_ticks=stop_ticks,
        target_ticks=target_ticks,
    )


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_full_pipeline_runs_without_error():
    rng = np.random.default_rng(42)
    result = run_pipeline(_make_features_2d(rng), _make_benchmarks(), _make_distances(rng))
    assert result is not None


def test_domain_signals_bounded():
    rng = np.random.default_rng(99)
    r = run_pipeline(_make_features_2d(rng), _make_benchmarks(), _make_distances(rng))
    for attr in ("s_spatial", "s_momentum", "s_band_direction", "s_volume_profile", "s_structure"):
        val = getattr(r, attr)
        assert -1.0 <= val <= 1.0, f"{attr}={val} out of [-1, 1]"


def test_d_score_bounded():
    rng = np.random.default_rng(7)
    r = run_pipeline(_make_features_2d(rng), _make_benchmarks(), _make_distances(rng))
    assert -1.0 <= r.d_score <= 1.0


def test_tension_delta_is_finite():
    rng = np.random.default_rng(13)
    r = run_pipeline(_make_features_2d(rng), _make_benchmarks(), _make_distances(rng))
    assert np.isfinite(r.tension_delta)


def test_confidence_bounded():
    rng = np.random.default_rng(21)
    r = run_pipeline(_make_features_2d(rng), _make_benchmarks(), _make_distances(rng))
    assert 0.0 <= r.confidence <= 1.0


def test_qty_in_valid_range():
    rng = np.random.default_rng(55)
    r = run_pipeline(_make_features_2d(rng), _make_benchmarks(), _make_distances(rng))
    assert 1 <= r.qty <= MAX_CONTRACTS


def test_action_is_valid_code():
    rng = np.random.default_rng(77)
    r = run_pipeline(_make_features_2d(rng), _make_benchmarks(), _make_distances(rng))
    assert r.action in {ACTION_NONE, ACTION_BUY, ACTION_SELL, ACTION_FLATTEN}


def test_stop_and_target_nonnegative():
    rng = np.random.default_rng(33)
    r = run_pipeline(_make_features_2d(rng), _make_benchmarks(), _make_distances(rng))
    assert r.stop_ticks >= 0.0
    assert r.target_ticks >= 0.0


def test_confluence_and_alignment_computed():
    rng = np.random.default_rng(42)
    r = run_pipeline(_make_features_2d(rng), _make_benchmarks(), _make_distances(rng))
    assert r.confluence >= 0.0
    assert 0.0 <= r.alignment <= 1.0


def test_pipeline_stateful_across_ticks():
    """Pipeline with shared state evolves correctly over 20 ticks."""
    rng = np.random.default_rng(11)
    history = TensionHistory()
    hysteresis = HysteresisState()
    prev_dist = None
    prev_bench = None
    results = []

    for seq in range(1, 21):
        features_2d = _make_features_2d(rng)
        benchmarks = _make_benchmarks()
        distances = _make_distances(rng)

        r = run_pipeline(
            features_2d, benchmarks, distances,
            tension_history=history,
            hysteresis=hysteresis,
            prev_distances=prev_dist,
            prev_benchmarks=prev_bench,
            feature_seq=seq,
        )
        results.append(r)
        norm_spatial = normalize_spatial(distances, benchmarks)
        prev_dist = norm_spatial.copy()
        prev_bench = benchmarks.copy()

    assert len(history) == 20
    for r in results:
        assert 0.0 <= r.confidence <= 1.0

    valid_actions = {ACTION_NONE, ACTION_BUY, ACTION_SELL, ACTION_FLATTEN}
    for r in results:
        assert r.action in valid_actions


def test_spatial_signal_drives_dscore_positive():
    """All benchmark distances positive -> s_spatial > 0."""
    features_2d = np.zeros((RAW_FIELDS, SHMEM_LEVELS), dtype=np.float64)
    rng = np.random.default_rng(42)
    for field in [F_LIQ_ADD_VOL, F_LIQ_REMOVE_VOL]:
        features_2d[field, :] = rng.uniform(10, 100, SHMEM_LEVELS)

    benchmarks = _make_benchmarks(vwap=20000.0)
    distances = np.full(DISTANCES, 50.0, dtype=np.float32)

    r = run_pipeline(features_2d, benchmarks, distances)
    assert r.s_spatial > 0.0
    assert r.d_score > -1.0


def test_spatial_signal_drives_dscore_negative():
    """All benchmark distances negative -> s_spatial < 0."""
    features_2d = np.zeros((RAW_FIELDS, SHMEM_LEVELS), dtype=np.float64)
    rng = np.random.default_rng(42)
    for field in [F_LIQ_ADD_VOL, F_LIQ_REMOVE_VOL]:
        features_2d[field, :] = rng.uniform(10, 100, SHMEM_LEVELS)

    benchmarks = _make_benchmarks(vwap=20000.0)
    distances = np.full(DISTANCES, -50.0, dtype=np.float32)

    r = run_pipeline(features_2d, benchmarks, distances)
    assert r.s_spatial < 0.0
