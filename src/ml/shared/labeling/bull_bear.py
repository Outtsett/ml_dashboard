"""Bull/Bear labeler for 2-state clustering models.

Assigns exactly two labels -- Bullish and Bearish -- based on which
regime has a higher mean return.  Wraps the output in a structured
LabelResult so the rest of the pipeline treats it identically.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from .base import CATEGORY_TREND, LabelResult


class BullBearLabeler:
    """Two-state labeler: regime with higher mean return = Bullish."""

    def __init__(self, bull_label: str = "Bullish", bear_label: str = "Bearish") -> None:
        self._bull_label = bull_label
        self._bear_label = bear_label
        self._bull_regime: int | None = None

    def fit(
        self,
        regime_features_by_id: dict[int, NDArray[np.float64]],
        ret_col: int = 0,
    ) -> None:
        """Determine which regime is bullish from mean returns.

        Args:
            regime_features_by_id: ``{regime_id: feature_matrix}`` for each regime.
            ret_col: Column index of the 1-bar return feature.
        """
        means = {
            rid: float(np.mean(feats[:, ret_col]))
            for rid, feats in regime_features_by_id.items()
            if feats.shape[0] > 0
        }
        if means:
            self._bull_regime = max(means, key=means.get)  # type: ignore[arg-type]

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
        is_bull = regime_id == self._bull_regime
        lbl = self._bull_label if is_bull else self._bear_label

        ret_bps = avg_return * 10_000
        sign = "+" if ret_bps >= 0 else ""
        nickname = (
            f"{sign}{ret_bps:.1f}bp/bar, "
            f"{avg_volatility * 100:.2f}% vol, "
            f"{avg_duration:.0f}-bar hold, "
            f"{pct:.0f}% of data"
        )

        return LabelResult(label=lbl, nickname=nickname, category=CATEGORY_TREND)
