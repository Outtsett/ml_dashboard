"""
HDP-HMM Configuration
=====================

Loads from config/pipeline.json — single source of truth for
symbols, timeframes, features, indicator groups, and normalization rules.
"""

import json
from pathlib import Path

# ==============================================================================
# Paths
# ==============================================================================

SCRIPT_DIR = Path(__file__).parent
SRC_DIR = SCRIPT_DIR.parent.parent          # src/
PROJECT_DIR = SRC_DIR.parent                # project root
DB_PATH = PROJECT_DIR / "data" / "market.duckdb"
OUTPUT_DIR = PROJECT_DIR / "data" / "models" / "hdp-hmm"
INDICATORS_DIR = PROJECT_DIR / "data" / "indicators"

# ==============================================================================
# Load pipeline.json
# ==============================================================================

_CONFIG_PATH = SRC_DIR / "config" / "pipeline.json"
with open(_CONFIG_PATH) as _f:
    _cfg = json.load(_f)

# ==============================================================================
# Timeframe Map (label -> seconds)
# ==============================================================================

TIMEFRAME_MAP: dict[str, int] = _cfg["timeframes"]

# ==============================================================================
# Symbol Lists
# ==============================================================================

ALL_SYMBOLS: list[str] = _cfg["symbols"]

# ==============================================================================
# Feature Definitions
# ==============================================================================

DEFAULT_FEATURES: list[str] = _cfg["coreFeatures"]
WARMUP_BARS: int = _cfg["featureParams"]["warmupBars"]
ROLLING_WINDOW: int = _cfg["featureParams"]["rollingWindow"]

# ==============================================================================
# Indicator Column Filtering (normalization rules)
# ==============================================================================

SKIP_COLUMNS: set[str] = set(_cfg["normalization"]["skipColumns"])
BINARY_PREFIXES: tuple[str, ...] = tuple(_cfg["normalization"]["binaryPrefixes"])
BINARY_EXACT: set[str] = set(_cfg["normalization"]["binaryExact"])

# Bounded columns: JSON stores [min, max] arrays -> convert to (min, max) tuples
BOUNDED_COLUMNS: dict[str, tuple[float, float]] = {
    k: (v[0], v[1]) for k, v in _cfg["normalization"]["boundedColumns"].items()
}

ALREADY_NORMALIZED_PREFIXES: tuple[str, ...] = tuple(
    _cfg["normalization"]["alreadyNormalizedPrefixes"]
)

# ==============================================================================
# Indicator Groups for Selective Inclusion
# ==============================================================================

INDICATOR_GROUPS: dict[str, list[str]] = _cfg["indicatorGroups"]
DEFAULT_INDICATOR_GROUPS: list[str] = _cfg["defaultIndicatorGroups"]
