"""Simple regime labeler -- lightweight percentile-based fallback.

Classifies regimes into 7 categories using a 2x2 return x volatility
matrix with percentile-adaptive thresholds.  Useful when the full
feature set (microstructure, ROC, MA-distance) is unavailable.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from .base import (
    CATEGORY_RANGE,
    CATEGORY_TREND,
    LabelResult,
)

# Label -> category mapping for the 7 simple buckets
_CATEGORY_MAP: dict[str, str] = {
    "Low Vol Bull": CATEGORY_TREND,
    "High Vol Bull": CATEGORY_TREND,
    "Low Vol Bear": CATEGORY_TREND,
    "High Vol Bear": CATEGORY_TREND,
    "Quiet Range": CATEGORY_RANGE,
    "High Volatility": CATEGORY_RANGE,
    "Trending": CATEGORY_TREND,
}


class SimpleLabeler:
    """Percentile-based 2x2 (return x volatility) regime labeler.

    Requires pre-computed percentile thresholds across all regimes.
    Call :meth:`fit` once with all regime means/vols, then :meth:`label`
    per regime.
    """

    def __init__(self) -> None:
        self._ret_high: float = 0.0
        self._ret_low: float = 0.0
        self._vol_high: float = 0.0
        self._vol_low: float = 0.0
        self._fitted = False

    def fit(
        self,
        regime_means: NDArray[np.float64],
        regime_vols: NDArray[np.float64],
    ) -> None:
        """Compute percentile thresholds from per-regime statistics.

        Args:
            regime_means: Array of mean return per regime.
            regime_vols:  Array of return-std per regime.
        """
        if len(regime_means) >= 3:
            self._ret_high = float(np.percentile(regime_means, 75))
            self._ret_low = float(np.percentile(regime_means, 25))
            self._vol_high = float(np.percentile(regime_vols, 75))
            self._vol_low = float(np.percentile(regime_vols, 25))
        else:
            mu = float(np.mean(regime_means))
            sigma = float(np.std(regime_means))
            self._ret_high = mu + sigma
            self._ret_low = mu - sigma
            mu_v = float(np.mean(regime_vols))
            sigma_v = float(np.std(regime_vols))
            self._vol_high = mu_v + sigma_v
            self._vol_low = mu_v - sigma_v
        self._fitted = True

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
        if not self._fitted:
            raise RuntimeError("SimpleLabeler.fit() must be called before label().")

        mean_ret = avg_return
        vol = avg_volatility

        if mean_ret >= self._ret_high and vol <= self._vol_low:
            lbl = "Low Vol Bull"
        elif mean_ret >= self._ret_high:
            lbl = "High Vol Bull"
        elif mean_ret <= self._ret_low and vol <= self._vol_low:
            lbl = "Low Vol Bear"
        elif mean_ret <= self._ret_low:
            lbl = "High Vol Bear"
        elif vol <= self._vol_low:
            lbl = "Quiet Range"
        elif vol >= self._vol_high:
            lbl = "High Volatility"
        else:
            lbl = "Trending"

        ret_bps = mean_ret * 10_000
        sign = "+" if ret_bps >= 0 else ""
        nickname = (
            f"{sign}{ret_bps:.1f}bp/bar, "
            f"{vol * 100:.2f}% vol, "
            f"{avg_duration:.0f}-bar hold, "
            f"{pct:.0f}% of data"
        )

        return LabelResult(
            label=lbl,
            nickname=nickname,
            category=_CATEGORY_MAP[lbl],
        )
