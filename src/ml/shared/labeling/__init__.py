"""Regime labeling package — single source of truth.

Public API
----------
- ``get_labeler(name)``  — Factory for labeler strategies.
- ``renumber_states()``  — Pure state renumbering (no labels).
- ``assign_colors()``    — Regime → hex-color mapping.
- ``LabelResult``        — Immutable label output.
- ``RegimeLabeler``      — Protocol all labelers satisfy.
"""

from __future__ import annotations

from .base import CATEGORY_RANGE, CATEGORY_REVERSAL, CATEGORY_TREND, LabelResult, RegimeLabeler
from .colors import REGIME_COLORS, assign_colors
from .renumber import RenumberResult, renumber_states

# Lazy imports to avoid circular / heavy-import overhead at package level.
_LABELER_CLASSES: dict[str, str] = {
    "structural": "structural.StructuralLabeler",
    "simple": "simple.SimpleLabeler",
    "bull_bear": "bull_bear.BullBearLabeler",
}

_DEFAULT_LABELER = "structural"


def get_labeler(name: str | None = None) -> RegimeLabeler:
    """Instantiate a labeler by name.

    Args:
        name: One of ``"structural"`` (default), ``"simple"``, ``"bull_bear"``.

    Returns:
        A fresh labeler instance satisfying :class:`RegimeLabeler`.
    """
    name = name or _DEFAULT_LABELER
    if name not in _LABELER_CLASSES:
        raise ValueError(
            f"Unknown labeler '{name}'. "
            f"Available: {sorted(_LABELER_CLASSES)}."
        )

    module_name, class_name = _LABELER_CLASSES[name].rsplit(".", 1)
    import importlib

    mod = importlib.import_module(f".{module_name}", package=__package__)
    cls = getattr(mod, class_name)
    return cls()


__all__ = [
    "assign_colors",
    "CATEGORY_RANGE",
    "CATEGORY_REVERSAL",
    "CATEGORY_TREND",
    "get_labeler",
    "LabelResult",
    "REGIME_COLORS",
    "RegimeLabeler",
    "renumber_states",
    "RenumberResult",
]
