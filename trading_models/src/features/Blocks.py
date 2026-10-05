"""
Feature blocks: one class per feature family, each a pure function of OHLCV.

# Overview
Every block turns raw 1m OHLCV into (a) continuous indicator values and
(b) binary market-state flags. A new family is added by writing a new
`FeatureBlock` subclass — no existing block or the pipeline changes (OCP).

# Principles
* **Contract isolation** — every rolling / shifted / EWM expression is wrapped in
  `.over(group_col)` so indicator state resets at each futures contract roll; a
  back-adjusted price jump between MNQH1 and MNQM1 can never fire a fake cross.
* **Causality** — FLAG/STATE/VALUE columns use only bars <= t. Only `LabelBlock`
  looks forward, and its columns are registered as LABEL so the registry refuses
  to put them in the state bitmask.
* **Null warm-up** — indicators are null until their window is full (comparisons
  with null stay null under Polars' Kleene logic), so warm-up bars are dropped
  downstream instead of being silently encoded as 0.
* **Staged expressions** — Polars cannot reference a column created in the same
  `with_columns` call, so each block returns ordered stages.
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass

import polars as pl

from src.features.Registry import FeatureKind, FeatureSpec

GROUP_COL = "contract_symbol"  # partition key for every windowed expression

Stage = list[pl.Expr]


def _flag(expr: pl.Expr, name: str) -> pl.Expr:
    """Boolean -> Int8 0/1 (null preserved for warm-up rows)."""
    return expr.cast(pl.Int8).alias(name)


def _log_ret_raw(lag: int) -> pl.Expr:
    """Un-windowed log(close_t / close_{t-lag}); negative lag looks forward. Caller applies .over once."""
    if lag > 0:
        return (pl.col("close") / pl.col("close").shift(lag)).log()
    return (pl.col("close").shift(lag) / pl.col("close")).log()


def _log_ret(lag: int) -> pl.Expr:
    """log return within one contract (shift never crosses a roll)."""
    return _log_ret_raw(lag).over(GROUP_COL)


def _bar_sigma(window: int) -> pl.Expr:
    """Rolling std of 1-bar log returns within one contract: the unit that scales the flat band."""
    return _log_ret_raw(1).rolling_std(window).over(GROUP_COL)  # one window, no nesting


class FeatureBlock(ABC):
    """Contract every feature family satisfies (LSP: the pipeline only sees this)."""

    family: str

    @abstractmethod
    def specs(self) -> list[FeatureSpec]:
        """Registry entries for every column this block emits."""

    @abstractmethod
    def stages(self) -> list[Stage]:
        """Ordered expression stages; later stages may read earlier stages' columns."""


# ── Direction (backward-looking trend state) ────────────────────────────────


@dataclass(frozen=True)
class TrendBlock(FeatureBlock):
    """
    Current trend state from the trailing N-bar log return.

    up    if ret_N >  k * sigma_1 * sqrt(N)
    down  if ret_N < -k * sigma_1 * sqrt(N)
    flat  otherwise
    The band scales with realised volatility so "flat" means "inside noise",
    not "moved less than a fixed number of points".
    """

    lookback: int = 15        # N bars
    band_k: float = 0.5       # flat-band half-width in sigma units
    vol_window: int = 60      # bars used to estimate sigma_1
    family: str = "trend"

    def specs(self) -> list[FeatureSpec]:
        p = {"lookback": self.lookback, "band_k": self.band_k, "vol_window": self.vol_window}
        return [
            FeatureSpec(101, "trend_up", self.family, FeatureKind.FLAG, "Trailing N-bar return above +k·σ·√N", 0, p),
            FeatureSpec(102, "trend_down", self.family, FeatureKind.FLAG, "Trailing N-bar return below -k·σ·√N", 1, p),
            FeatureSpec(103, "trend_flat", self.family, FeatureKind.FLAG, "Trailing N-bar return inside ±k·σ·√N", 2, p),
            FeatureSpec(110, "trend_dir", self.family, FeatureKind.STATE, "Ternary trend: 1 up, 0 flat, -1 down", None, p),
            FeatureSpec(120, "trend_ret", self.family, FeatureKind.VALUE, "Trailing N-bar log return", None, p),
            FeatureSpec(121, "trend_band", self.family, FeatureKind.VALUE, "Flat-band half-width k·σ·√N", None, p),
        ]

    def stages(self) -> list[Stage]:
        band = self.band_k * math.sqrt(self.lookback)
        s1 = [
            _log_ret(self.lookback).alias("trend_ret"),
            (_bar_sigma(self.vol_window) * band).alias("trend_band"),
        ]
        up = pl.col("trend_ret") > pl.col("trend_band")
        down = pl.col("trend_ret") < -pl.col("trend_band")
        s2 = [_flag(up, "trend_up"), _flag(down, "trend_down"), _flag(~up & ~down, "trend_flat")]
        s3 = [(pl.col("trend_up") - pl.col("trend_down")).cast(pl.Int8).alias("trend_dir")]
        return [s1, s2, s3]


# ── MACD events ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class MacdBlock(FeatureBlock):
    """MACD(fast, slow, signal) line crosses plus histogram slope and sign."""

    fast: int = 12
    slow: int = 26
    signal: int = 9
    family: str = "macd"

    def specs(self) -> list[FeatureSpec]:
        p = {"fast": self.fast, "slow": self.slow, "signal": self.signal}
        return [
            FeatureSpec(201, "macd_cross_up", self.family, FeatureKind.FLAG, "MACD crossed above signal on this bar", 3, p),
            FeatureSpec(202, "macd_cross_down", self.family, FeatureKind.FLAG, "MACD crossed below signal on this bar", 4, p),
            FeatureSpec(203, "macd_hist_rising", self.family, FeatureKind.FLAG, "Histogram higher than previous bar", 5, p),
            FeatureSpec(204, "macd_hist_falling", self.family, FeatureKind.FLAG, "Histogram lower than previous bar", 6, p),
            FeatureSpec(205, "macd_hist_below_zero", self.family, FeatureKind.FLAG, "Histogram < 0 (MACD below signal)", 7, p),
            FeatureSpec(220, "macd_line", self.family, FeatureKind.VALUE, "EMA(fast) - EMA(slow)", None, p),
            FeatureSpec(221, "macd_signal", self.family, FeatureKind.VALUE, "EMA(signal) of MACD line", None, p),
            FeatureSpec(222, "macd_hist", self.family, FeatureKind.VALUE, "MACD line - signal", None, p),
        ]

    def stages(self) -> list[Stage]:
        def ema(col: str, span: int) -> pl.Expr:
            # min_samples=span keeps the warm-up null instead of a biased early EMA.
            return pl.col(col).ewm_mean(span=span, adjust=False, min_samples=span).over(GROUP_COL)

        s1 = [(ema("close", self.fast) - ema("close", self.slow)).alias("macd_line")]
        s2 = [ema("macd_line", self.signal).alias("macd_signal")]
        s3 = [(pl.col("macd_line") - pl.col("macd_signal")).alias("macd_hist")]
        hist, prev = pl.col("macd_hist"), pl.col("macd_hist").shift(1).over(GROUP_COL)
        s4 = [
            _flag((hist > 0) & (prev <= 0), "macd_cross_up"),     # sign change - to + == line crosses signal upward
            _flag((hist < 0) & (prev >= 0), "macd_cross_down"),
            _flag(hist > prev, "macd_hist_rising"),
            _flag(hist < prev, "macd_hist_falling"),
            _flag(hist < 0, "macd_hist_below_zero"),
        ]
        return [s1, s2, s3, s4]


# ── Volume rate of change ───────────────────────────────────────────────────


@dataclass(frozen=True)
class VolumeRocBlock(FeatureBlock):
    """Rate of change of smoothed volume: is participation expanding or shrinking?"""

    smooth: int = 5     # SMA window applied before ROC (1m volume is very noisy)
    period: int = 5     # ROC lag in bars
    family: str = "volume"

    def specs(self) -> list[FeatureSpec]:
        p = {"smooth": self.smooth, "period": self.period}
        return [
            FeatureSpec(301, "vol_roc_up", self.family, FeatureKind.FLAG, "Smoothed volume ROC > 0 (volume increasing)", 8, p),
            FeatureSpec(302, "vol_roc_down", self.family, FeatureKind.FLAG, "Smoothed volume ROC < 0 (volume decreasing)", 9, p),
            FeatureSpec(320, "vol_roc", self.family, FeatureKind.VALUE, "SMA(volume)_t / SMA(volume)_{t-period} - 1", None, p),
        ]

    def stages(self) -> list[Stage]:
        sma = pl.col("volume").rolling_mean(self.smooth).over(GROUP_COL)
        s1 = [sma.alias("_vol_sma")]
        prev = pl.col("_vol_sma").shift(self.period).over(GROUP_COL)
        # Zero prior volume makes ROC undefined -> null, never inf.
        s2 = [pl.when(prev > 0).then(pl.col("_vol_sma") / prev - 1.0).otherwise(None).alias("vol_roc")]
        s3 = [_flag(pl.col("vol_roc") > 0, "vol_roc_up"), _flag(pl.col("vol_roc") < 0, "vol_roc_down")]
        return [s1, s2, s3]


# ── Buy vs sell volume (estimated) ──────────────────────────────────────────


@dataclass(frozen=True)
class FlowBlock(FeatureBlock):
    """
    Buy/sell volume dominance, ESTIMATED from OHLCV.

    The source has no aggressor side, so buy volume is approximated by close
    location within the bar's range: buy = V·(C−L)/(H−L), sell = V − buy
    (zero-range bars split 50/50). This is a proxy, not true order flow; swap in
    a tick-derived block with the same feature_ids' semantics if L1 data lands.
    """

    window: int = 5     # rolling bars summed before comparing sides
    family: str = "flow_est"

    def specs(self) -> list[FeatureSpec]:
        p = {"window": self.window, "method": "close_location"}
        return [
            FeatureSpec(401, "flow_buy_dominant_est", self.family, FeatureKind.FLAG, "Estimated buy volume > sell volume over window", 10, p),
            FeatureSpec(402, "flow_sell_dominant_est", self.family, FeatureKind.FLAG, "Estimated sell volume > buy volume over window", 11, p),
            FeatureSpec(420, "flow_buy_ratio_est", self.family, FeatureKind.VALUE, "Estimated buy / total volume over window", None, p),
        ]

    def stages(self) -> list[Stage]:
        rng = pl.col("high") - pl.col("low")
        frac = pl.when(rng > 0).then((pl.col("close") - pl.col("low")) / rng).otherwise(0.5)
        s1 = [(pl.col("volume") * frac).alias("_buy_vol")]
        buy = pl.col("_buy_vol").rolling_sum(self.window).over(GROUP_COL)
        tot = pl.col("volume").rolling_sum(self.window).over(GROUP_COL)
        s2 = [buy.alias("_buy_sum"), (tot - buy).alias("_sell_sum"), tot.alias("_tot_sum")]
        s3 = [
            pl.when(pl.col("_tot_sum") > 0).then(pl.col("_buy_sum") / pl.col("_tot_sum")).otherwise(None).alias("flow_buy_ratio_est"),
            _flag(pl.col("_buy_sum") > pl.col("_sell_sum"), "flow_buy_dominant_est"),
            _flag(pl.col("_sell_sum") > pl.col("_buy_sum"), "flow_sell_dominant_est"),
        ]
        return [s1, s2, s3]


# ── Volatility regime ───────────────────────────────────────────────────────


@dataclass(frozen=True)
class VolatilityBlock(FeatureBlock):
    """Wilder ATR now vs `lag` bars ago: volatility expanding or contracting."""

    atr_period: int = 14
    lag: int = 5
    family: str = "volatility"

    def specs(self) -> list[FeatureSpec]:
        p = {"atr_period": self.atr_period, "lag": self.lag}
        return [
            FeatureSpec(501, "volatility_rising", self.family, FeatureKind.FLAG, "ATR above its value `lag` bars ago", 12, p),
            FeatureSpec(502, "volatility_falling", self.family, FeatureKind.FLAG, "ATR below its value `lag` bars ago", 13, p),
            FeatureSpec(520, "atr", self.family, FeatureKind.VALUE, "Wilder ATR (true range EWM, alpha=1/period)", None, p),
        ]

    def stages(self) -> list[Stage]:
        prev_close = pl.col("close").shift(1).over(GROUP_COL)
        tr = pl.max_horizontal(
            pl.col("high") - pl.col("low"),
            (pl.col("high") - prev_close).abs(),
            (pl.col("low") - prev_close).abs(),
        )
        s1 = [tr.alias("_tr")]
        s2 = [pl.col("_tr").ewm_mean(alpha=1.0 / self.atr_period, adjust=False, min_samples=self.atr_period).over(GROUP_COL).alias("atr")]
        prev_atr = pl.col("atr").shift(self.lag).over(GROUP_COL)
        s3 = [_flag(pl.col("atr") > prev_atr, "volatility_rising"), _flag(pl.col("atr") < prev_atr, "volatility_falling")]
        return [s1, s2, s3]


# ── Forward direction label (TARGET, never an input) ────────────────────────


@dataclass(frozen=True)
class LabelBlock(FeatureBlock):
    """
    Forward H-bar direction target using the same vol-scaled band as TrendBlock.

    Binary one-hot: LBL_UP / LBL_DOWN / LBL_FLAT (1 = true, 0 = false).
    Ternary:        DIR_TERN = 1 up, 0 flat, -1 down.
    Null for the last H bars of every contract (no future inside the contract).
    """

    horizon: int = 15
    band_k: float = 0.5
    vol_window: int = 60
    bar_minutes: int = 1
    family: str = "label"

    @property
    def tag(self) -> str:
        """ISO-style horizon suffix, e.g. 15M."""
        return f"{self.horizon * self.bar_minutes}M"

    def specs(self) -> list[FeatureSpec]:
        p = {"horizon": self.horizon, "band_k": self.band_k, "vol_window": self.vol_window}
        t = self.tag
        return [
            FeatureSpec(901, f"LBL_UP_{t}", self.family, FeatureKind.LABEL, "Forward H-bar return above +k·σ·√H", None, p),
            FeatureSpec(902, f"LBL_DOWN_{t}", self.family, FeatureKind.LABEL, "Forward H-bar return below -k·σ·√H", None, p),
            FeatureSpec(903, f"LBL_FLAT_{t}", self.family, FeatureKind.LABEL, "Forward H-bar return inside ±k·σ·√H", None, p),
            FeatureSpec(910, f"DIR_TERN_{t}", self.family, FeatureKind.LABEL, "Ternary forward direction: 1 up, 0 flat, -1 down", None, p),
            FeatureSpec(920, f"RET_LOG_{t}", self.family, FeatureKind.LABEL, "Forward H-bar log return", None, p),
        ]

    def stages(self) -> list[Stage]:
        t = self.tag
        band = self.band_k * math.sqrt(self.horizon)
        s1 = [_log_ret(-self.horizon).alias(f"RET_LOG_{t}"), (_bar_sigma(self.vol_window) * band).alias("_lbl_band")]
        fwd = pl.col(f"RET_LOG_{t}")
        up, down = fwd > pl.col("_lbl_band"), fwd < -pl.col("_lbl_band")
        s2 = [_flag(up, f"LBL_UP_{t}"), _flag(down, f"LBL_DOWN_{t}"), _flag(~up & ~down, f"LBL_FLAT_{t}")]
        s3 = [(pl.col(f"LBL_UP_{t}") - pl.col(f"LBL_DOWN_{t}")).cast(pl.Int8).alias(f"DIR_TERN_{t}")]
        return [s1, s2, s3]


def default_blocks() -> list[FeatureBlock]:
    """The standard market-state feature set, in dependency-free order."""
    return [TrendBlock(), MacdBlock(), VolumeRocBlock(), FlowBlock(), VolatilityBlock(), LabelBlock()]
