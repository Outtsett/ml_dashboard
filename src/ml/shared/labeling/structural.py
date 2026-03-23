"""Structural regime labeler — the primary, feature-rich labeler.

Classifies regimes into 30+ market-structure labels across three categories
(trend / reversal / range) using momentum alignment, volatility dynamics,
swing structure, and price-extension signals.

Moved from ``hdp_hmm.io.regime_stats.generate_regime_description()`` and
refactored into the RegimeLabeler protocol.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from .base import (
    CATEGORY_RANGE,
    CATEGORY_REVERSAL,
    CATEGORY_TREND,
    LabelResult,
)


class StructuralLabeler:
    """Rich regime labeler using price-structure and swing features."""

    # ── helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _feat(
        name: str,
        regime_features: NDArray[np.float64],
        feature_names: list[str],
    ) -> float | None:
        """Mean value of *name* across regime bars, or None if absent."""
        if name in feature_names:
            idx = feature_names.index(name)
            return float(np.mean(regime_features[:, idx]))
        return None

    # ── public API ───────────────────────────────────────────────────────

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
        _f = lambda name: self._feat(name, regime_features, feature_names)

        # ── Feature extraction ───────────────────────────────────────
        ret1 = _f("return_1")
        ret20 = _f("return_20")
        vol10 = _f("volatility_10")
        vol50 = _f("volatility_50")
        roc5 = _f("roc_5")
        roc20 = _f("roc_20")
        ma50 = _f("ma_dist_50")
        body = _f("body_ratio")
        bar_range = _f("bar_range")
        vol_ratio = _f("volume_ratio_10")

        # Swing features (causal zigzag)
        swing_pct = _f("swing_pct")
        swing_dur = _f("swing_duration")
        retrace = _f("retracement_ratio")
        swing_count = _f("swing_count_50")

        ret_bps = (ret1 or 0) * 10_000
        vol_pct = avg_volatility * 100

        # ── Directional alignment (short vs long) ────────────────────
        short_dir = 1 if (ret1 or 0) > 0 else -1
        long_dir = 1 if (ret20 or 0) > 0 else -1
        aligned = short_dir == long_dir
        trending = abs(ret_bps) > 1.5

        # Volatility dynamics
        vol_expanding = (
            vol10 is not None
            and vol50 is not None
            and vol10 > vol50 * 1.2
        )
        vol_contracting = (
            vol10 is not None
            and vol50 is not None
            and vol10 < vol50 * 0.8
        )

        # Momentum acceleration / deceleration
        accel = (
            roc5 is not None
            and roc20 is not None
            and abs(roc5) > abs(roc20) * 1.3
            and (roc5 > 0) == (roc20 > 0)
        )
        decel = (
            roc5 is not None
            and roc20 is not None
            and abs(roc5) < abs(roc20) * 0.6
            and (roc5 > 0) == (roc20 > 0)
        )

        # Extension from MA
        extended = ma50 is not None and abs(ma50) > 0.01

        # Volume surge
        vol_surge = vol_ratio is not None and vol_ratio > 1.5

        # ── Swing structure signals ──────────────────────────────────
        has_swing = swing_count is not None
        choppy = has_swing and swing_count is not None and swing_count > 8
        long_swings = has_swing and swing_dur is not None and swing_dur > 10
        big_swings = has_swing and swing_pct is not None and abs(swing_pct) > 0.005
        deep_retrace = has_swing and retrace is not None and retrace > 0.6
        shallow_retrace = has_swing and retrace is not None and retrace < 0.3

        # ── Classification ───────────────────────────────────────────
        bull = short_dir > 0
        prefix = "Bull" if bull else "Bear"

        if has_swing and choppy and not trending:
            lbl, cat = "Choppy", CATEGORY_RANGE
        elif has_swing and choppy and vol_expanding:
            lbl, cat = "Whipsaw", CATEGORY_RANGE
        elif not aligned and trending and vol_expanding:
            lbl, cat = f"{prefix} Reversal", CATEGORY_REVERSAL
        elif not aligned and trending:
            lbl, cat = f"{prefix} Reversal", CATEGORY_REVERSAL
        elif aligned and vol_expanding and vol_surge and trending:
            lbl, cat = f"{prefix} Breakout", CATEGORY_TREND
        elif aligned and vol_expanding and trending:
            lbl, cat = f"{prefix} Breakout", CATEGORY_TREND
        elif has_swing and long_swings and big_swings and aligned:
            lbl, cat = f"{prefix} Trend", CATEGORY_TREND
        elif aligned and accel:
            lbl, cat = f"{prefix} Acceleration", CATEGORY_TREND
        elif aligned and decel and extended:
            lbl, cat = f"{prefix} Exhaustion", CATEGORY_REVERSAL
        elif has_swing and deep_retrace and trending:
            lbl, cat = f"{prefix} Pullback", CATEGORY_REVERSAL
        elif aligned and trending:
            lbl, cat = f"{prefix} Continuation", CATEGORY_TREND
        elif vol_contracting and abs(ret_bps) < 1.0:
            lbl, cat = "Compression", CATEGORY_RANGE
        elif has_swing and shallow_retrace and not trending:
            lbl, cat = "Coiling", CATEGORY_RANGE
        elif abs(ret_bps) < 0.3 and vol_pct < 0.3:
            lbl, cat = "Dead Zone", CATEGORY_RANGE
        elif has_swing and choppy:
            lbl, cat = "Range-Bound", CATEGORY_RANGE
        elif abs(ret_bps) < 1.0:
            lbl, cat = "Range-Bound", CATEGORY_RANGE
        else:
            lbl, cat = f"{prefix} Drift", CATEGORY_TREND

        # ── Nickname: numeric fingerprint ────────────────────────────
        nickname = self._build_nickname(
            ret_bps, vol_pct, vol_expanding, vol_contracting,
            bar_range, body, vol_surge, vol_ratio,
            has_swing, swing_dur, swing_count, avg_duration, pct,
        )

        return LabelResult(label=lbl, nickname=nickname, category=cat)

    # ── nickname builder ─────────────────────────────────────────────

    @staticmethod
    def _build_nickname(
        ret_bps: float,
        vol_pct: float,
        vol_expanding: bool,
        vol_contracting: bool,
        bar_range: float | None,
        body: float | None,
        vol_surge: bool,
        vol_ratio: float | None,
        has_swing: bool,
        swing_dur: float | None,
        swing_count: float | None,
        avg_duration: float,
        pct: float,
    ) -> str:
        sign = "+" if ret_bps >= 0 else ""
        parts = [f"{sign}{ret_bps:.1f}bp/bar", f"{vol_pct:.2f}% vol"]

        if vol_expanding:
            parts.append("expanding vol")
        elif vol_contracting:
            parts.append("contracting vol")

        if bar_range is not None:
            parts.append(f"{bar_range * 100:.2f}% range")

        if body is not None:
            if body < 0.15:
                parts.append("doji bars")
            elif body > 0.7:
                parts.append("impulse bars")

        if vol_surge and vol_ratio is not None:
            parts.append(f"{vol_ratio:.1f}x vol")

        if has_swing and swing_dur is not None:
            parts.append(f"{swing_dur:.0f}-bar swings")
        if has_swing and swing_count is not None:
            parts.append(f"{swing_count:.0f} pivots/50bars")

        parts.append(f"{avg_duration:.0f}-bar hold")
        parts.append(f"{pct:.0f}% of data")

        return ", ".join(parts)
