#!/usr/bin/env python3
"""
HDP-HMM Training — Thin Wrapper
================================

Usage (either works):
    python scripts/train-hdp-hmm.py --symbol MNQ --timeframe 1m
    python -m ml.hdp_hmm --symbol MNQ --timeframe 1m
"""

import sys
from pathlib import Path

# Ensure src/ is on sys.path so `ml.hdp_hmm` resolves
src_dir = str(Path(__file__).parent.parent.parent)
if src_dir not in sys.path:
    sys.path.insert(0, src_dir)

from ml.hdp_hmm.__main__ import main

if __name__ == "__main__":
    main()
