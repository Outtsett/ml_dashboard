"""
HDP-HMM Regime Detection Package
==================================

Hierarchical Dirichlet Process Hidden Markov Model for automatic
market regime discovery. The model discovers the number of regimes
from the data — no need to guess K upfront.

Usage:
    # As a module
    python -m ml.hdp_hmm --symbol ES --timeframe 1d

    # From Python
    from ml.hdp_hmm import StickyHDPHMM, train_hdp_hmm, train_universal

Package Structure:
    config      - Paths, constants, symbol/feature/indicator definitions
    features    - Rolling z-score feature engineering
    indicators  - Pre-computed indicator loading and normalization
    model       - StickyHDPHMM class (Gibbs sampler)
    data        - OHLCV data loading from DuckDB / parquet
    validation  - Walk-forward and out-of-sample validation
    analysis    - Regime analysis with auto-labeling
    training    - Full training pipelines (single + universal)
    cli         - Command-line interface
"""

from .analysis import analyze_regimes
from .cli import main
from .data import load_ohlcv_data
from .features import compute_features
from .model import StickyHDPHMM
from .training import train_hdp_hmm, train_universal

__all__ = [
    "StickyHDPHMM",
    "train_hdp_hmm",
    "train_universal",
    "compute_features",
    "load_ohlcv_data",
    "analyze_regimes",
    "main",
]
