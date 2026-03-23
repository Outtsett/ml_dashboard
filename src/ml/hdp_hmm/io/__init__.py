"""
Model I/O package — backward-compatible barrel.

All public functions are re-exported so existing
``from model_io import ...`` statements continue to work unchanged.
"""

from .save import save_model
from shared.labeling import REGIME_COLORS

__all__ = ["save_model", "REGIME_COLORS"]
