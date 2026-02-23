#!/usr/bin/env python3
"""
HDP-HMM Regime Training — Thin Wrapper
=======================================

The implementation has been modularized into the ml/hdp_hmm/ package.
This script is kept for backward compatibility.

Usage (either works):
    python scripts/train-hdp-hmm.py --symbol ES --timeframe 1d
    python -m ml.hdp_hmm --symbol ES --timeframe 1d

See ml/hdp_hmm/ for the full package:
    config.py     — Paths, constants, symbol/feature/indicator definitions
    features.py   — Rolling z-score feature engineering
    indicators.py — Pre-computed indicator loading and normalization
    model.py      — StickyHDPHMM class (Gibbs sampler)
    data.py       — OHLCV data loading from DuckDB / parquet
    validation.py — Walk-forward and out-of-sample validation
    analysis.py   — Regime analysis with auto-labeling
    training.py   — Full training pipelines (single + universal)
    cli.py        — Command-line interface
"""

import sys
from pathlib import Path

# Ensure project root is on sys.path so `ml.hdp_hmm` resolves
project_root = str(Path(__file__).parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from ml.hdp_hmm.cli import main

if __name__ == "__main__":
    main()
