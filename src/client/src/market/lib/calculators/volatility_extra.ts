/**
 * Extended volatility indicators computed client-side from raw OHLCV data.
 *
 * Every function returns IndicatorPoint[] (single output) or a named object
 * of IndicatorPoint[] arrays (multi-output). All math is pure TypeScript —
 * no external dependencies.
 */

import type { Bar, IndicatorPoint } from './math_primitives';
import {
  sma,
  ema,
  wilderSmooth,
  rollingMax,
  stddev,
  trueRange,
  toPoints,
  gains,
  losses,
} from './math_primitives';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Compute RSI from a value array. Returns null-padded array. */
function rsiFromValues(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1 || period < 1) return result;
  const g = gains(values);
  const l = losses(values);
  const avgGain = wilderSmooth(g, period);
  const avgLoss = wilderSmooth(l, period);
  for (let i = 0; i < n; i++) {
    const ag = avgGain[i]!;
    const al = avgLoss[i]!;
    if (ag == null || al == null) continue;
    if (al === 0) {
      result[i] = ag === 0 ? 50 : 100;
    } else {
      result[i] = 100 - 100 / (1 + ag / al);
    }
  }
  return result;
}

/** Fill nulls with 0. */
function fillNulls(arr: (number | null)[]): number[] {
  return arr.map(v => v ?? 0);
}

// ─── Indicators ─────────────────────────────────────────────────────────────

/**
 * Aberration: Close deviation from Keltner Channel center, measured in ATR units.
 * Positive = above center, negative = below.
 */
export function calcAberration(
  bars: Bar[],
  period = 20,
  atrPeriod = 14,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const tr = trueRange(bars);
  const n = bars.length;

  const kcMid = ema(closes, period);
  const atr = wilderSmooth(tr, atrPeriod);

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const mid = kcMid[i]!;
    const a = atr[i]!;
    if (mid != null && a != null && a !== 0) {
      result[i] = (closes[i]! - mid) / a;
    }
  }
  return toPoints(result, bars);
}

/**
 * Mass Index: Sum of EMA(high-low) / EMA(EMA(high-low)) over sumPeriod.
 * Values > 27 then dropping below 26.5 signal a "reversal bulge."
 */
export function calcMassIndex(
  bars: Bar[],
  emaPeriod = 9,
  sumPeriod = 25,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const n = bars.length;

  // High - Low range
  const hl: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    hl[i] = bars[i]!.high - bars[i]!.low;
  }

  // Single EMA and double EMA of range
  const emaHL = ema(hl, emaPeriod);
  const emaEmaHL = ema(fillNulls(emaHL), emaPeriod);

  // Ratio: single / double
  const ratio: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (emaHL[i] != null && emaEmaHL[i] != null && emaEmaHL[i]! !== 0) {
      ratio[i] = emaHL[i]! / emaEmaHL[i]!;
    }
  }

  // Rolling sum of ratio
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < sumPeriod) return toPoints(result, bars);
  let sum = 0;
  for (let i = 0; i < sumPeriod; i++) sum += ratio[i]!;
  result[sumPeriod - 1] = sum;
  for (let i = sumPeriod; i < n; i++) {
    sum += ratio[i]! - ratio[i - sumPeriod]!;
    result[i] = sum;
  }

  return toPoints(result, bars);
}

/**
 * Ulcer Index: Measures downside volatility / drawdown risk.
 * sqrt(sum((close - highest_close_in_period) / highest_close_in_period)^2 / period) * 100
 */
export function calcUlcerIndex(bars: Bar[], period = 14): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const hh = rollingMax(closes, period);

  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period) return toPoints(result, bars);

  for (let i = period - 1; i < n; i++) {
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const highest = hh[j]!;
      if (highest != null && highest !== 0) {
        const pctDD = ((closes[j]! - highest) / highest) * 100;
        sqSum += pctDD * pctDD;
      }
    }
    result[i] = Math.sqrt(sqSum / period);
  }

  return toPoints(result, bars);
}

/**
 * Price Distance (PDIST): Signed bar range weighted by direction.
 * (high - low) * sign(close - open).
 * Positive = bullish bar, negative = bearish bar.
 */
export function calcPDIST(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const n = bars.length;
  const result: (number | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const range = bars[i]!.high - bars[i]!.low;
    const dir = bars[i]!.close - bars[i]!.open;
    result[i] = range * Math.sign(dir);
  }
  return toPoints(result, bars);
}

/**
 * Bollinger Band Width: (upper - lower) / middle * 100.
 * Measures volatility expansion/contraction.
 */
export function calcBBWidth(
  bars: Bar[],
  period = 20,
  stdMult = 2,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const mid = sma(closes, period);
  const sd = stddev(closes, period);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (mid[i] != null && sd[i] != null && mid[i]! !== 0) {
      const upper = mid[i]! + stdMult * sd[i]!;
      const lower = mid[i]! - stdMult * sd[i]!;
      result[i] = ((upper - lower) / mid[i]!) * 100;
    }
  }
  return toPoints(result, bars);
}

/**
 * Keltner Channel Width: (upper - lower) / middle * 100.
 * Uses EMA for center and ATR for band offset.
 */
export function calcKCWidth(
  bars: Bar[],
  emaPeriod = 20,
  atrPeriod = 10,
  multiplier = 1.5,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const tr = trueRange(bars);
  const mid = ema(closes, emaPeriod);
  const atr = wilderSmooth(tr, atrPeriod);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (mid[i] != null && atr[i] != null && mid[i]! !== 0) {
      const upper = mid[i]! + multiplier * atr[i]!;
      const lower = mid[i]! - multiplier * atr[i]!;
      result[i] = ((upper - lower) / mid[i]!) * 100;
    }
  }
  return toPoints(result, bars);
}

/**
 * Relative Volatility Index: RSI applied to standard deviation instead of price.
 * Measures the direction of volatility rather than price.
 */
export function calcRVI(bars: Bar[], period = 14): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const sd = stddev(closes, period);
  const sdFilled = fillNulls(sd);
  const rvi = rsiFromValues(sdFilled, period);
  return toPoints(rvi, bars);
}

/**
 * Holt-Winter Channel: Triple exponential smoothing forecast with confidence bands.
 * Returns upper, middle (forecast), and lower channel lines.
 *
 * na = level smoothing, nb = trend smoothing, nc = seasonal/deviation smoothing.
 */
export function calcHWC(
  bars: Bar[],
  na = 0.2,
  nb = 0.1,
  nc = 0.1,
): { upper: IndicatorPoint[]; middle: IndicatorPoint[]; lower: IndicatorPoint[] } {
  const empty = {
    upper: [] as IndicatorPoint[],
    middle: [] as IndicatorPoint[],
    lower: [] as IndicatorPoint[],
  };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const n = closes.length;

  const upperArr: (number | null)[] = new Array(n).fill(null);
  const middleArr: (number | null)[] = new Array(n).fill(null);
  const lowerArr: (number | null)[] = new Array(n).fill(null);

  if (n < 2) return empty;

  // Initialize
  let level = closes[0]!;
  let trend = closes[1]! - closes[0]!;
  let deviation = 0;

  for (let i = 0; i < n; i++) {
    const price = closes[i]!;

    // Forecast
    const forecast = level + trend;

    // Error
    const error = price - forecast;

    // Update level
    const newLevel = na * price + (1 - na) * (level + trend);

    // Update trend
    const newTrend = nb * (newLevel - level) + (1 - nb) * trend;

    // Update deviation
    deviation = nc * Math.abs(error) + (1 - nc) * deviation;

    level = newLevel;
    trend = newTrend;

    // Current forecast for next bar
    const fcast = level + trend;

    middleArr[i] = fcast;
    upperArr[i] = fcast + 2 * deviation;
    lowerArr[i] = fcast - 2 * deviation;
  }

  return {
    upper: toPoints(upperArr, bars),
    middle: toPoints(middleArr, bars),
    lower: toPoints(lowerArr, bars),
  };
}
