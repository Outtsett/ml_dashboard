/**
 * Statistical indicators: Entropy, Kurtosis, MAD, Rolling Median,
 * Quantile, Skewness, Z-Score.
 */

import type { Bar, IndicatorPoint } from './math_primitives';
import { sma, stddev, rollingMedian, toPoints } from './math_primitives';

// ─── Shannon Entropy ─────────────────────────────────────────────────────────

/**
 * Shannon Entropy of price returns over a rolling window.
 *
 * Computes log-returns, bins them into a histogram, and calculates
 * -sum(p * log2(p)) where p is the probability of each bin.
 *
 * Higher entropy = more random/unpredictable returns.
 * Lower entropy = more structured/predictable returns.
 *
 * Uses sqrt(period) bins (Sturges-like rule).
 *
 * @param bars    OHLCV bar array
 * @param period  Lookback window (default 10)
 */
export function calcEntropy(bars: Bar[], period = 10): IndicatorPoint[] {
  const n = bars.length;
  if (n < 2 || period < 2) return [];

  const closes = bars.map(b => b.close);

  // Compute log returns
  const logRet: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (closes[i - 1]! > 0 && closes[i]! > 0) {
      logRet[i] = Math.log(closes[i]! / closes[i - 1]!);
    }
  }

  const numBins = Math.max(2, Math.ceil(Math.sqrt(period)));
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period; i < n; i++) {
    // Collect returns in window
    const window: number[] = [];
    for (let j = i - period + 1; j <= i; j++) {
      window.push(logRet[j]!);
    }

    // Find range
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const v of window) {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }

    const range = maxVal - minVal;
    if (range === 0) {
      // All returns identical => zero entropy
      result[i] = 0;
      continue;
    }

    // Build histogram
    const bins: number[] = new Array(numBins).fill(0);
    const binWidth = range / numBins;
    for (const v of window) {
      let bin = Math.floor((v - minVal) / binWidth);
      if (bin >= numBins) bin = numBins - 1;
      bins[bin]!++;
    }

    // Shannon entropy: -sum(p * log2(p))
    let entropy = 0;
    for (let b = 0; b < numBins; b++) {
      if (bins[b]! > 0) {
        const p = bins[b]! / period;
        entropy -= p * Math.log2(p);
      }
    }

    result[i] = entropy;
  }

  return toPoints(result, bars);
}

// ─── Kurtosis ────────────────────────────────────────────────────────────────

/**
 * Rolling excess kurtosis of close prices.
 *
 * Kurtosis = E[(x - mean)^4] / stddev^4 - 3
 *
 * Excess kurtosis > 0 (leptokurtic) = fat tails, more extreme moves.
 * Excess kurtosis < 0 (platykurtic) = thin tails, fewer extremes.
 * Excess kurtosis = 0 matches normal distribution.
 *
 * @param bars    OHLCV bar array
 * @param period  Lookback (default 30)
 */
export function calcKurtosis(bars: Bar[], period = 30): IndicatorPoint[] {
  const n = bars.length;
  if (n === 0 || period < 4) return []; // need >=4 for kurtosis

  const closes = bars.map(b => b.close);
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]!;
    const mean = sum / period;

    let m2 = 0;
    let m4 = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j]! - mean;
      const d2 = d * d;
      m2 += d2;
      m4 += d2 * d2;
    }

    m2 /= period;
    m4 /= period;

    if (m2 === 0) {
      result[i] = 0; // All values identical
      continue;
    }

    // Excess kurtosis
    result[i] = m4 / (m2 * m2) - 3;
  }

  return toPoints(result, bars);
}

// ─── Mean Absolute Deviation ─────────────────────────────────────────────────

/**
 * Mean Absolute Deviation of close prices.
 *
 * MAD = mean(|close - mean(close)|) over period.
 *
 * More robust than standard deviation for measuring spread,
 * less sensitive to extreme outliers.
 *
 * @param bars    OHLCV bar array
 * @param period  Lookback (default 30)
 */
export function calcMAD(bars: Bar[], period = 30): IndicatorPoint[] {
  const n = bars.length;
  if (n === 0 || period < 1) return [];

  const closes = bars.map(b => b.close);
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]!;
    const mean = sum / period;

    let mad = 0;
    for (let j = i - period + 1; j <= i; j++) {
      mad += Math.abs(closes[j]! - mean);
    }

    result[i] = mad / period;
  }

  return toPoints(result, bars);
}

// ─── Rolling Median ──────────────────────────────────────────────────────────

/**
 * Rolling median of close prices.
 *
 * The median is the middle value when sorted. More robust than SMA
 * against outliers/spikes.
 *
 * @param bars    OHLCV bar array
 * @param period  Lookback (default 30)
 */
export function calcRollingMedian(bars: Bar[], period = 30): IndicatorPoint[] {
  const n = bars.length;
  if (n === 0 || period < 1) return [];

  const closes = bars.map(b => b.close);
  const result = rollingMedian(closes, period);
  return toPoints(result, bars);
}

// ─── Rolling Quantile ────────────────────────────────────────────────────────

/**
 * Rolling quantile (percentile) of close prices.
 *
 * Returns the value at the given quantile position within each window.
 * quantile=0.5 is the median, 0.25 is Q1, 0.75 is Q3.
 *
 * Uses linear interpolation between adjacent values.
 *
 * @param bars      OHLCV bar array
 * @param period    Lookback (default 30)
 * @param quantile  Quantile level 0-1 (default 0.5)
 */
export function calcQuantile(
  bars: Bar[],
  period = 30,
  quantile = 0.5,
): IndicatorPoint[] {
  const n = bars.length;
  if (n === 0 || period < 1) return [];
  const q = Math.max(0, Math.min(1, quantile));

  const closes = bars.map(b => b.close);
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    const window: number[] = [];
    for (let j = i - period + 1; j <= i; j++) window.push(closes[j]!);
    window.sort((a, b) => a - b);

    // Linear interpolation quantile
    const pos = q * (period - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const frac = pos - lo;

    if (lo === hi || hi >= period) {
      result[i] = window[lo]!;
    } else {
      result[i] = window[lo]! * (1 - frac) + window[hi]! * frac;
    }
  }

  return toPoints(result, bars);
}

// ─── Skewness ────────────────────────────────────────────────────────────────

/**
 * Rolling skewness of close prices.
 *
 * Skew = E[(x - mean)^3] / stddev^3
 *
 * Positive skew: right tail longer (more extreme up moves).
 * Negative skew: left tail longer (more extreme down moves).
 * Zero: symmetric distribution.
 *
 * @param bars    OHLCV bar array
 * @param period  Lookback (default 30)
 */
export function calcSkew(bars: Bar[], period = 30): IndicatorPoint[] {
  const n = bars.length;
  if (n === 0 || period < 3) return []; // need >=3 for skewness

  const closes = bars.map(b => b.close);
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]!;
    const mean = sum / period;

    let m2 = 0;
    let m3 = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j]! - mean;
      const d2 = d * d;
      m2 += d2;
      m3 += d2 * d;
    }

    m2 /= period;
    m3 /= period;

    if (m2 === 0) {
      result[i] = 0; // All values identical
      continue;
    }

    const sigma3 = Math.pow(m2, 1.5); // stddev^3 = (variance)^1.5
    result[i] = m3 / sigma3;
  }

  return toPoints(result, bars);
}

// ─── Z-Score ─────────────────────────────────────────────────────────────────

/**
 * Z-Score of close prices.
 *
 * Z = (close - SMA(close, period)) / stddev(close, period)
 *
 * Measures how many standard deviations the current close is
 * from the mean. Values > 2 or < -2 are statistically extreme.
 *
 * @param bars    OHLCV bar array
 * @param period  Lookback (default 30)
 */
export function calcZScore(bars: Bar[], period = 30): IndicatorPoint[] {
  const n = bars.length;
  if (n === 0 || period < 2) return [];

  const closes = bars.map(b => b.close);
  const smaVals = sma(closes, period);
  const stdVals = stddev(closes, period);

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (smaVals[i] === null || stdVals[i] === null) continue;
    const s = stdVals[i]!;
    if (s === 0) {
      result[i] = 0; // No deviation => z-score is 0
      continue;
    }
    result[i] = (closes[i]! - smaVals[i]!) / s;
  }

  return toPoints(result, bars);
}
