"""TensionFlow scoring engine configuration.

All constants, weight profiles, thresholds, field indices, regime IDs, and
action codes. Single source of truth for the Python scorer.

Level 1 only — no DOM/Level 2 features or detection thresholds.
"""

import numpy as np

# ── Shared Memory Constants (must match tf_layout.h) ─────────────────────────

SHMEM_LEVELS: int = 60      # Array allocation size — matches tf_layout.h
MIN_DOM_LEVELS: int = 10      # Floor — always compute at least this many levels
RAW_FIELDS: int = 57
COMPONENTS: int = 15
BENCHMARKS: int = 15
DISTANCES: int = 210
DETECTION_TYPES: int = 6
TICK_SIZE: float = 0.25  # MNQ

# ── Feature Field Indices (field-major: features[field * 60 + level]) ────────

F_VOLUME: int = 0
F_BUY_VOLUME: int = 1
F_SELL_VOLUME: int = 2
F_DELTA: int = 3
F_MAX_TRADE: int = 4
F_FILTERED_VOL: int = 5
F_FILTERED_PCT: int = 6
F_FILTERED_BUY: int = 7
F_FILTERED_SELL: int = 8
F_CUMULATIVE_SIZE: int = 9
F_IMBALANCE_PCT: int = 10
F_CUM_DELTA: int = 11
F_TRADE_COUNT: int = 12
F_BUY_TRADE_COUNT: int = 13
F_SELL_TRADE_COUNT: int = 14
F_AVG_TRADE_SIZE: int = 15
F_AVG_BUY_SIZE: int = 16
F_AVG_SELL_SIZE: int = 17
F_AGGRESSOR_RATIO: int = 18
F_PRICE_CONFIRM: int = 19
F_TICK_UP_COUNT: int = 20
F_TICK_DOWN_COUNT: int = 21
F_TICK_DIRECTION: int = 22
F_RECENT_1S: int = 23
F_RECENT_5S: int = 24
F_RECENT_30S: int = 25
F_TIME_SINCE_LAST: int = 26
F_LIQ_CHANGE: int = 27
F_LIQ_CHANGE_COUNT: int = 28
F_LIQ_ADD_VOL: int = 29
F_LIQ_REMOVE_VOL: int = 30
F_TIME_BETWEEN: int = 31
F_TIME_STD: int = 32
F_VWAP_BID: int = 33
F_VWAP_ASK: int = 34
F_DEPTH_BID_CUMUL: int = 35
F_DEPTH_ASK_CUMUL: int = 36
F_DEPTH_RATIO: int = 37
F_CROSS_VENUE: int = 38
F_TOXICITY: int = 39
F_SPOOF_SCORE: int = 40
F_ABSORPTION_SCORE: int = 41
F_TRAP_SCORE: int = 42
F_SWEEP_DETECTED: int = 43
F_ICEBERG_SCORE: int = 44
F_LEVEL_PERSISTENCE: int = 45
F_MOMENTUM_SCORE: int = 46
F_VOLUME_PERCENTILE: int = 47
F_SIZE_RATIO: int = 48
F_DELTA_ACCEL: int = 49
F_SPREAD_TENSION: int = 50
F_ABSORPTION_PERSIST: int = 51
F_VOLUME_CLUSTER: int = 52
F_BID_ASK_PRESSURE: int = 53
F_MICRO_STRUCTURE: int = 54
F_REGIME_CUE: int = 55
F_COMPOSITE_TENSION: int = 56

# ── Benchmark Indices (matching TF_Benchmarks struct order) ──────────────────

BENCH_PDH: int = 0
BENCH_PDL: int = 1
BENCH_PDS: int = 2
BENCH_PDC: int = 3
BENCH_DH: int = 4
BENCH_DL: int = 5
BENCH_VPOC: int = 6
BENCH_VAH: int = 7
BENCH_VAL: int = 8
BENCH_VWAP: int = 9
BENCH_VWAP_UPPER_PERM: int = 10
BENCH_VWAP_LOWER_PERM: int = 11
BENCH_VWAP_UPPER: int = 12
BENCH_VWAP_LOWER: int = 13
BENCH_TWAP: int = 14

# ── Regime IDs (matching TF_REGIME_*) ────────────────────────────────────────

REGIME_UNKNOWN: int = 0
REGIME_TREND_UP: int = 1
REGIME_TREND_DOWN: int = 2
REGIME_RANGE: int = 3
REGIME_VOLATILE: int = 4

# ── Action Codes (matching TF_ACTION_*) ──────────────────────────────────────

ACTION_NONE: int = 0
ACTION_BUY: int = 1
ACTION_SELL: int = 2
ACTION_FLATTEN: int = 3

# ── Regime-Adaptive Weight Profiles (Level 1 Only) ──────────────────────────
# Signals: spatial, momentum, band_direction, volume_profile, structure

REGIME_WEIGHTS: dict = {
    REGIME_VOLATILE: {
        "spatial": 0.35, "momentum": 0.15, "band_direction": 0.20,
        "volume_profile": 0.15, "structure": 0.15,
    },
    REGIME_TREND_UP: {
        "spatial": 0.25, "momentum": 0.25, "band_direction": 0.20,
        "volume_profile": 0.15, "structure": 0.15,
    },
    REGIME_TREND_DOWN: {
        "spatial": 0.25, "momentum": 0.25, "band_direction": 0.20,
        "volume_profile": 0.15, "structure": 0.15,
    },
    REGIME_RANGE: {
        "spatial": 0.20, "momentum": 0.15, "band_direction": 0.25,
        "volume_profile": 0.20, "structure": 0.20,
    },
    REGIME_UNKNOWN: {
        "spatial": 0.25, "momentum": 0.20, "band_direction": 0.20,
        "volume_profile": 0.15, "structure": 0.20,
    },
}

# ── Confluence / Alignment Entry Gates ──────────────────────────────────────
# From AI system architecture spec

MIN_CONFLUENCE: float = 1.5
MIN_ALIGNMENT: float = 0.60

# ── Spatial Signal Benchmark Weights ─────────────────────────────────────────
# From Mathematical Framework: VWAP=0.25, TWAP=0.20, VPOC=0.20, VAH/VAL=0.10

SPATIAL_BENCHMARK_WEIGHTS: np.ndarray = np.array([
    0.04,  # PDH
    0.04,  # PDL
    0.03,  # PDS
    0.04,  # PDC
    0.05,  # DH
    0.05,  # DL
    0.20,  # VPOC
    0.10,  # VAH
    0.10,  # VAL
    0.25,  # VWAP
    0.025, # VWAP upper perm
    0.025, # VWAP lower perm
    0.025, # VWAP upper
    0.025, # VWAP lower
    0.20,  # TWAP
], dtype=np.float32)

# ── Momentum Signal Weights ──────────────────────────────────────────────────

MOMENTUM_W_CORE: float = 0.7
MOMENTUM_W_BAND: float = 0.3

# ── Hysteresis ───────────────────────────────────────────────────────────────
# From Market Intent Architecture

HYSTERESIS_BARS: int = 3
NEUTRAL_ZONE_THRESHOLD: float = 0.3

# ── Adaptive Threshold ───────────────────────────────────────────────────────
# From mathematical_foundations.md: MA ± 1.2 × StdDev

TENSION_HISTORY_WINDOW: int = 100
THRESHOLD_SIGMA_MULTIPLIER: float = 1.2

# ── Risk ─────────────────────────────────────────────────────────────────────
# From risk_management.md

MIN_CONFIDENCE: float = 0.4
KELLY_SAFETY_FACTOR: float = 0.25
MAX_DRAWDOWN_PCT: float = 0.05
MAX_CONTRACTS: int = 4
MIN_STOP_TICKS: float = 4.0  # 1 point MNQ

# ── Benchmark Context Proximity ──────────────────────────────────────────────
# Number of ticks from a benchmark to be considered "at" that level

CONTEXT_AT_THRESHOLD_TICKS: int = 2
CONTEXT_EXTREME_THRESHOLD_TICKS: int = 8

# ── Scorer Loop ──────────────────────────────────────────────────────────────

POLL_INTERVAL_SEC: float = 0.0001  # 100μs
