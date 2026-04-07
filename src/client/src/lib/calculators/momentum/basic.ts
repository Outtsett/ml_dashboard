import type { Bar, IndicatorPoint } from "../math_primitives";
import {
  sma,
  wma,
  rollingSum,
  trueRange,
  medianPrice,
  toPoints,
  roc,
  linregCore,
} from "../math_primitives";
import { ema } from "../math_primitives";

export function calcAO(
  bars: Bar[],
  fastPeriod = 5,
  slowPeriod = 34,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const mp = medianPrice(bars);
  const fast = sma(mp, fastPeriod);
  const slow = sma(mp, slowPeriod);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fast[i] != null && slow[i] != null) {
      result[i] = fast[i]! - slow[i]!;
    }
  }
  return toPoints(result, bars);
}

/**
 * Bias: percentage deviation of close from its SMA.
 */
export function calcBias(bars: Bar[], period = 26): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const ma = sma(closes, period);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const m = ma[i];
    if (m != null && m !== 0) {
      result[i] = ((closes[i]! - m) / m) * 100;
    }
  }
  return toPoints(result, bars);
}

/**
 * Chande Forecast Oscillator: 100 * (close - linearForecast) / close.
 */
export function calcCFO(bars: Bar[], period = 9): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const { slope, intercept } = linregCore(closes, period);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const s = slope[i];
    const b = intercept[i];
    const c = closes[i]!;
    if (s != null && b != null && c !== 0) {
      const forecast = b + s * period;
      result[i] = 100 * (c - forecast) / c;
    }
  }
  return toPoints(result, bars);
}

/**
 * Center of Gravity: -sum(close[i]*(i+1)) / sum(close[i]) over a rolling window.
 */
export function calcCG(bars: Bar[], period = 10): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return toPoints(result, bars);
  for (let i = period - 1; i < n; i++) {
    let numSum = 0;
    let denomSum = 0;
    for (let j = 0; j < period; j++) {
      const val = closes[i - j]!;
      numSum += val * (j + 1);
      denomSum += val;
    }
    if (denomSum !== 0) {
      result[i] = -numSum / denomSum;
    }
  }
  return toPoints(result, bars);
}

/**
 * Coppock Curve: WMA of (ROC(close, roc1) + ROC(close, roc2)) over wmaP.
 */
export function calcCoppock(
  bars: Bar[],
  wmaP = 10,
  roc1 = 14,
  roc2 = 11,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const r1 = roc(closes, roc1);
  const r2 = roc(closes, roc2);
  const n = closes.length;
  const combined: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    combined[i] = (r1[i] ?? 0) + (r2[i] ?? 0);
  }
  const w = wma(combined, wmaP);
  const minOffset = Math.max(roc1, roc2);
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i >= minOffset + wmaP - 1 && w[i] != null) {
      result[i] = w[i]!;
    }
  }
  return toPoints(result, bars);
}

/**
 * Kaufman Efficiency Ratio: abs(close - close[period]) / sum(abs(close[i] - close[i-1])).
 */
export function calcER(bars: Bar[], period = 10): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1 || period < 1) return toPoints(result, bars);
  for (let i = period; i < n; i++) {
    const direction = Math.abs(closes[i]! - closes[i - period]!);
    let volatility = 0;
    for (let j = i - period + 1; j <= i; j++) {
      volatility += Math.abs(closes[j]! - closes[j - 1]!);
    }
    result[i] = volatility !== 0 ? direction / volatility : 0;
  }
  return toPoints(result, bars);
}

/**
 * Pretty Good Oscillator: (close - SMA(close, period)) / EMA(trueRange, period).
 */
export function calcPGO(bars: Bar[], period = 14): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const tr = trueRange(bars);
  const ma = sma(closes, period);
  const atr = ema(tr, period);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const m = ma[i];
    const a = atr[i];
    if (m != null && a != null && a !== 0) {
      result[i] = (closes[i]! - m) / a;
    }
  }
  return toPoints(result, bars);
}

/**
 * Psychological Line: percentage of up-bars in a rolling window.
 */
export function calcPSL(bars: Bar[], period = 12): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const ups: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (closes[i]! > closes[i - 1]!) ups[i] = 1;
  }
  const sumUps = rollingSum(ups, period);
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (sumUps[i] != null) {
      result[i] = (sumUps[i]! / period) * 100;
    }
  }
  return toPoints(result, bars);
}

/**
 * Williams Accumulation/Distribution
 */
export function calcWAD(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  let wad = 0;
  result[0] = 0;
  for (let i = 1; i < n; i++) {
    const close = bars[i]!.close;
    const prevClose = bars[i - 1]!.close;
    const trh = Math.max(bars[i]!.high, prevClose);
    const trl = Math.min(bars[i]!.low, prevClose);
    if (close > prevClose) {
      wad += close - trl;
    } else if (close < prevClose) {
      wad += close - trh;
    }
    result[i] = wad;
  }
  return toPoints(result, bars);
}
