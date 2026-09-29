"""Conditional (rule-based) TA-Lib entry signals: no model, no fitting.

A rule reads indicators up to and including bar t and returns +1 (go long),
-1 (go short) or 0 at bar t's CLOSE; the entry fills at bar t+1's open
(``bracket.simulate``). Every rule is a crossing or a state change, so it fires
once per event, not on every bar the condition holds.

Every indicator here is computed on the back-adjusted series and is either a
bounded oscillator or a comparison of two price-level series, so an additive
roll shift cannot change a signal (the shift-invariance test in
``tests/test_ta_rules.py`` holds every rule to that).

Filters are conditions ANDed onto a rule's signal:
- ``trend``: longs only above the 200-bar EMA, shorts only below it;
- ``adx``: only when the 14-bar Average Directional Index is above 20 (a trending market);
- ``rth``: only signals on bars stamped 06:30-12:30 Pacific (regular hours, leaving 30 minutes before the 13:00 close).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import talib


def cross_up(a: np.ndarray, b: np.ndarray | float) -> np.ndarray:
    b = np.broadcast_to(b, a.shape)
    out = np.zeros(a.shape, dtype=bool)
    out[1:] = (a[1:] > b[1:]) & (a[:-1] <= b[:-1])
    return out & np.isfinite(a) & np.isfinite(b) & np.r_[False, np.isfinite(a[:-1]) & np.isfinite(b[:-1])]


def cross_down(a: np.ndarray, b: np.ndarray | float) -> np.ndarray:
    return cross_up(-np.asarray(a), -np.broadcast_to(b, np.shape(a)))


def _signal(long: np.ndarray, short: np.ndarray) -> np.ndarray:
    out = np.zeros(long.shape, dtype=np.int8)
    out[long] = 1
    out[short & ~long] = -1
    return out


@dataclass(frozen=True)
class Rule:
    family: str
    parameters: tuple            # ((name, value), ...)
    description: str

    @property
    def rule_id(self) -> str:
        return self.family + "".join(f"_{k}{v:g}" if isinstance(v, (int, float)) else f"_{k}{v}" for k, v in self.parameters)

    def signal(self, bars: dict) -> np.ndarray:
        return FAMILIES[self.family](bars, **dict(self.parameters))


# ── families: (bars: dict of float64 arrays) -> int8 signal ────────────────────
def ema_cross(b, fast, slow):
    f, s = talib.EMA(b["close"], fast), talib.EMA(b["close"], slow)
    return _signal(cross_up(f, s), cross_down(f, s))


def macd_cross(b, fast, slow, signal):
    line, sig, _ = talib.MACD(b["close"], fast, slow, signal)
    return _signal(cross_up(line, sig), cross_down(line, sig))


def rsi_reversal(b, period, low, high):
    r = talib.RSI(b["close"], period)
    return _signal(cross_up(r, low), cross_down(r, high))


def rsi_momentum(b, period, level):
    r = talib.RSI(b["close"], period)
    return _signal(cross_up(r, level), cross_down(r, 100 - level))


def bollinger_breakout(b, period, width):
    upper, _, lower = talib.BBANDS(b["close"], period, width, width)
    return _signal(cross_up(b["close"], upper), cross_down(b["close"], lower))


def bollinger_reversion(b, period, width):
    upper, _, lower = talib.BBANDS(b["close"], period, width, width)
    return _signal(cross_up(b["close"], lower), cross_down(b["close"], upper))


def donchian_breakout(b, period):
    prior_high = np.r_[np.nan, talib.MAX(b["high"], period)[:-1]]
    prior_low = np.r_[np.nan, talib.MIN(b["low"], period)[:-1]]
    return _signal(cross_up(b["close"], prior_high), cross_down(b["close"], prior_low))


def keltner_breakout(b, period, multiple):
    middle = talib.EMA(b["close"], period)
    atr = talib.ATR(b["high"], b["low"], b["close"], period)
    return _signal(cross_up(b["close"], middle + multiple * atr), cross_down(b["close"], middle - multiple * atr))


def stochastic_cross(b, k, d, low, high):
    slow_k, slow_d = talib.STOCH(b["high"], b["low"], b["close"], k, 3, 0, d, 0)
    return _signal(cross_up(slow_k, slow_d) & (slow_d < low), cross_down(slow_k, slow_d) & (slow_d > high))


def cci_cross(b, period, level):
    c = talib.CCI(b["high"], b["low"], b["close"], period)
    return _signal(cross_up(c, level), cross_down(c, -level))


def williams_reversal(b, period, low, high):
    w = talib.WILLR(b["high"], b["low"], b["close"], period)
    return _signal(cross_up(w, low), cross_down(w, high))


def directional_cross(b, period, adx_minimum):
    plus, minus = talib.PLUS_DI(b["high"], b["low"], b["close"], period), talib.MINUS_DI(b["high"], b["low"], b["close"], period)
    strong = talib.ADX(b["high"], b["low"], b["close"], period) > adx_minimum
    return _signal(cross_up(plus, minus) & strong, cross_down(plus, minus) & strong)


def parabolic_sar_flip(b, acceleration, maximum):
    sar = talib.SAR(b["high"], b["low"], acceleration, maximum)
    return _signal(cross_up(b["close"], sar), cross_down(b["close"], sar))


def aroon_cross(b, period):
    down, up = talib.AROON(b["high"], b["low"], period)
    return _signal(cross_up(up, down), cross_down(up, down))


def triple_ema_alignment(b, fast, middle, slow):
    """Fast > middle > slow turns true (long) or fast < middle < slow turns true (short)."""
    f, m, s = (talib.EMA(b["close"], p) for p in (fast, middle, slow))
    up = (f > m) & (m > s)
    down = (f < m) & (m < s)
    return _signal(up & ~np.r_[False, up[:-1]], down & ~np.r_[False, down[:-1]])


def engulfing_at_band(b, period, width):
    """TA-Lib engulfing pattern closing outside a Bollinger band: a reversal at an extreme."""
    pattern = talib.CDLENGULFING(b["open"], b["high"], b["low"], b["close"])
    upper, _, lower = talib.BBANDS(b["close"], period, width, width)
    return _signal((pattern > 0) & (b["low"] < lower), (pattern < 0) & (b["high"] > upper))


FAMILIES = {
    "ema_cross": ema_cross, "macd_cross": macd_cross, "rsi_reversal": rsi_reversal, "rsi_momentum": rsi_momentum,
    "bollinger_breakout": bollinger_breakout, "bollinger_reversion": bollinger_reversion,
    "donchian_breakout": donchian_breakout, "keltner_breakout": keltner_breakout,
    "stochastic_cross": stochastic_cross, "cci_cross": cci_cross, "williams_reversal": williams_reversal,
    "directional_cross": directional_cross, "parabolic_sar_flip": parabolic_sar_flip, "aroon_cross": aroon_cross,
    "triple_ema_alignment": triple_ema_alignment, "engulfing_at_band": engulfing_at_band,
}

DESCRIPTIONS = {
    "ema_cross": "fast EMA crosses the slow EMA (long up, short down)",
    "macd_cross": "MACD line crosses its signal line",
    "rsi_reversal": "RSI crosses back up through the oversold level (long) or down through the overbought level (short)",
    "rsi_momentum": "RSI crosses up through a momentum level (long) or down through its mirror (short)",
    "bollinger_breakout": "close crosses outside a Bollinger band, trading in the breakout direction",
    "bollinger_reversion": "close crosses back inside a Bollinger band, trading back toward the middle",
    "donchian_breakout": "close breaks the prior N-bar high (long) or low (short)",
    "keltner_breakout": "close crosses a Keltner channel (EMA +/- multiple x ATR)",
    "stochastic_cross": "slow %K crosses %D inside the oversold (long) or overbought (short) zone",
    "cci_cross": "CCI crosses up through +level (long) or down through -level (short)",
    "williams_reversal": "Williams %R crosses back up from oversold or down from overbought",
    "directional_cross": "+DI crosses -DI while ADX is above a minimum",
    "parabolic_sar_flip": "close crosses the parabolic SAR (the SAR flips)",
    "aroon_cross": "Aroon up crosses Aroon down",
    "triple_ema_alignment": "three EMAs come into bullish (fast>middle>slow) or bearish order",
    "engulfing_at_band": "TA-Lib engulfing candle that reaches outside a Bollinger band (reversal)",
}


def make_rule(family: str, **parameters) -> Rule:
    return Rule(family, tuple(parameters.items()), DESCRIPTIONS[family])


def apply_filter(signal: np.ndarray, name: str, bars: dict, minute_of_day: np.ndarray) -> np.ndarray:
    if name == "none":
        return signal
    out = signal.copy()
    if name == "trend":
        ema = talib.EMA(bars["close"], 200)
        out[(signal > 0) & ~(bars["close"] > ema)] = 0
        out[(signal < 0) & ~(bars["close"] < ema)] = 0
        return out
    if name == "adx":
        out[~(talib.ADX(bars["high"], bars["low"], bars["close"], 14) > 20)] = 0
        return out
    if name == "rth":
        out[~((minute_of_day >= 6 * 60 + 30) & (minute_of_day < 12 * 60 + 30))] = 0
        return out
    raise ValueError(f"unknown filter {name!r}")


def bars_dict(frame: pd.DataFrame) -> dict:
    return {k: frame[k].to_numpy(np.float64) for k in ("open", "high", "low", "close", "volume")}
