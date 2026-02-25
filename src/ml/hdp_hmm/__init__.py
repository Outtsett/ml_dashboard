"""
HDP-HMM Package
================

Hierarchical Dirichlet Process Hidden Markov Model for automatic
market regime discovery. Discovers the number of regimes from
the data — no need to guess K upfront.

Usage:
    python -m ml.hdp_hmm --symbol ES --timeframe 1d

Package Structure:
    config      - Paths, constants, symbol lists
    model       - StickyHDPHMM class (Gibbs sampler)
    data        - OHLCV data loading from DuckDB / parquet
    validation  - Walk-forward and out-of-sample validation
    analysis    - Regime analysis with auto-labeling
    training    - Full training pipelines (single + universal)
    shap_analysis - SHAP explainability for regime assignments
"""

from .analysis import analyze_regimes
from .data import load_ohlcv_data
from .model import StickyHDPHMM
from .shap_analysis import compute_shap_explanations, save_shap_results
from .training import train_hdp_hmm, train_universal

__all__ = [
    "StickyHDPHMM",
    "train_hdp_hmm",
    "train_universal",
    "load_ohlcv_data",
    "analyze_regimes",
    "compute_shap_explanations",
    "save_shap_results",
]
