"""Labeling protocol and data structures.

Single source of truth for regime label contracts. All labelers
implement RegimeLabeler; all consumers receive LabelResult.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

import numpy as np
from numpy.typing import NDArray

# ── Label categories ─────────────────────────────────────────────────────────

CATEGORY_TREND = "trend"
CATEGORY_REVERSAL = "reversal"
CATEGORY_RANGE = "range"

VALID_CATEGORIES = frozenset({CATEGORY_TREND, CATEGORY_REVERSAL, CATEGORY_RANGE})


# ── Label result ─────────────────────────────────────────────────────────────

@dataclass(frozen=True, slots=True)
class LabelResult:
    """Immutable output of a regime labeler.

    Attributes:
        label:    Human-readable name  (e.g. "Bull Breakout").
        nickname: Numeric fingerprint  (e.g. "+3.2bp/bar, 1.1% vol, …").
        category: One of "trend", "reversal", or "range".
    """

    label: str
    nickname: str
    category: str

    def __post_init__(self) -> None:
        if self.category not in VALID_CATEGORIES:
            raise ValueError(
                f"Invalid category '{self.category}'. "
                f"Must be one of {sorted(VALID_CATEGORIES)}."
            )


# ── Labeler protocol ────────────────────────────────────────────────────────

@runtime_checkable
class RegimeLabeler(Protocol):
    """Contract every regime labeler must satisfy."""

    def label(
        self,
        regime_id: int,
        regime_features: NDArray[np.float64],
        feature_names: list[str],
        avg_return: float,
        avg_volatility: float,
        avg_duration: float,
        pct: float,
    ) -> LabelResult:
        """Classify a single regime and return a structured label.

        Args:
            regime_id:        Contiguous regime index (0-based).
            regime_features:  Feature matrix for bars in this regime (N×D).
            feature_names:    Ordered feature names matching columns of regime_features.
            avg_return:       Mean 1-bar return of this regime.
            avg_volatility:   Std of 1-bar returns in this regime.
            avg_duration:     Mean consecutive run length (bars).
            pct:              Percentage of total bars in this regime.

        Returns:
            LabelResult with label, nickname, and category.
        """
        ...
