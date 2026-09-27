"""
Triple-barrier-style binary direction labels with embargo — the reference
model's label module, now a re-export of the shared kernel.

The ATR-scaled barrier, its diagnostics and the embargo split were written
here first (2026-05) while ``src/ml/shared/labels.py`` still carried only a
fixed basis-point barrier that every ML-Studio-generated model inherited. The
2026-09-26 label audit moved the kernel into the shared module so both paths
label the same way; the public names here are unchanged so ``main.py`` and
the tests keep importing them from this module.
"""

from __future__ import annotations

from src.ml.shared.labels import (
    _barrier_label,
    _true_range,
    make_labels,
    resolve_threshold_bp,
    time_split_indices,
    trailing_atr_bp,
)

__all__ = [
    "_barrier_label",
    "_true_range",
    "make_labels",
    "resolve_threshold_bp",
    "time_split_indices",
    "trailing_atr_bp",
]
