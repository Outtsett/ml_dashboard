/**
 * Cycle and performance indicators: Ehlers Even Better Sinewave,
 * Ehlers Reflex, log/percent returns, cumulative returns.
 */

import type { Bar, IndicatorPoint } from './math_primitives';
import { toPoints } from './math_primitives';

// ─── Even Better Sinewave (Ehlers) ──────────────────────────────────────────

/**
 * Even Better Sinewave — John Ehlers (Stocks & Commodities, Nov 2013).
 *
 * Applies a high-pass filter to remove trend, then a super smoother
 * (2-pole Butterworth) to extract the dominant cycle. The output is
 * a sinewave oscillator bounded roughly -1 to +1.
 *
 * Pipeline:
 * 1. Two-pole high-pass filter (cutoff = hpPeriod bars)
 * 2. Two-pole super smoother (cutoff = period bars)
 * 3. Compute power via RMS, normalize to get the sinewave
 *
 * @param bars      OHLCV bar array
 * @param period    Bandpass / super smoother period (default 40)
 * @param hpPeriod  High-pass filter cutoff period (default 125)
 */
export function calcEBSW(bars: Bar[], period = 40, hpPeriod = 125): IndicatorPoint[] {
  const n = bars.length;
  if (n < 3) return [];

  const hl2 = bars.map(b => (b.high + b.low) / 2);

  // ── High-pass filter (two-pole Butterworth) ──
  // For two-pole HP: alpha1 = (1 + alpha) / 2 isn't quite right for Ehlers' formulation.
  // Ehlers uses: HP(t) = (1 - alpha/2)^2 * (price - 2*price[1] + price[2])
  //                     + 2*(1-alpha)*HP[1] - (1-alpha)^2*HP[2]
  // where alpha = (1 - sin(2*pi/hpPeriod)) / cos(2*pi/hpPeriod) -- simplified form
  const hp: number[] = new Array(n).fill(0);

  // We'll use Ehlers' actual two-pole high-pass formulation:
  // alpha1 = (cosine + sine - 1) / cosine  for single pole
  // For two-pole HP (Ehlers "Cybernetic Analysis"):
  //   a = exp(-sqrt(2) * PI / hpPeriod)
  //   b = 2 * a * cos(sqrt(2) * 180 / hpPeriod in radians)
  //   hp[i] = (1 + b/2 - b/2)^? -- let me use the standard formulation:
  //
  // Simplified Ehlers 2-pole HP:
  const a1HP = Math.exp(-Math.SQRT2 * Math.PI / hpPeriod);
  const b1HP = 2 * a1HP * Math.cos(Math.SQRT2 * Math.PI / hpPeriod);
  const c2HP = b1HP;
  const c3HP = -(a1HP * a1HP);
  const c1HP = (1 + c2HP - c3HP) / 4;

  for (let i = 0; i < n; i++) {
    if (i < 2) {
      hp[i] = 0;
    } else {
      hp[i] = c1HP * (hl2[i]! - 2 * hl2[i - 1]! + hl2[i - 2]!)
            + c2HP * hp[i - 1]!
            + c3HP * hp[i - 2]!;
    }
  }

  // ── Super Smoother (two-pole Butterworth low-pass) ──
  const a1SS = Math.exp(-Math.SQRT2 * Math.PI / period);
  const b1SS = 2 * a1SS * Math.cos(Math.SQRT2 * Math.PI / period);
  const c2SS = b1SS;
  const c3SS = -(a1SS * a1SS);
  const c1SS = 1 - c2SS - c3SS;

  const filt: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i < 2) {
      filt[i] = hp[i]!;
    } else {
      filt[i] = c1SS / 2 * (hp[i]! + hp[i - 1]!)
              + c2SS * filt[i - 1]!
              + c3SS * filt[i - 2]!;
    }
  }

  // ── RMS power normalization ──
  const rmsPeriod = Math.max(period, 10);
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (i < rmsPeriod) continue;

    let sumSq = 0;
    for (let j = i - rmsPeriod + 1; j <= i; j++) {
      sumSq += filt[j]! * filt[j]!;
    }
    const rms = Math.sqrt(sumSq / rmsPeriod);

    if (rms === 0) {
      result[i] = 0;
    } else {
      // Normalize to -1..+1 range
      const wave = filt[i]! / rms;
      result[i] = Math.max(-1, Math.min(1, wave));
    }
  }

  return toPoints(result, bars);
}

// ─── Ehlers Reflex Indicator ─────────────────────────────────────────────────

/**
 * Ehlers Reflex Indicator — measures the speed of price reversal.
 *
 * Pipeline:
 * 1. Two-pole super smoother to remove noise
 * 2. Compute the "reflex" as the slope deviation from a linear
 *    extrapolation over the lookback period
 * 3. Normalize by RMS of the reflex values
 *
 * Positive values: price reversing upward (momentum turning bullish).
 * Negative values: price reversing downward (momentum turning bearish).
 *
 * Reference: John Ehlers, "Reflex: A New Zero-Lag Indicator"
 * (Stocks & Commodities, Feb 2020).
 *
 * @param bars    OHLCV bar array
 * @param period  Lookback period (default 20)
 */
export function calcReflex(bars: Bar[], period = 20): IndicatorPoint[] {
  const n = bars.length;
  if (n < 3 || period < 2) return [];

  const closes = bars.map(b => b.close);

  // ── Super Smoother (two-pole, cutoff = period/2) ──
  const ssPeriod = Math.max(period / 2, 2);
  const a1 = Math.exp(-Math.SQRT2 * Math.PI / ssPeriod);
  const b1 = 2 * a1 * Math.cos(Math.SQRT2 * Math.PI / ssPeriod);
  const c2 = b1;
  const c3 = -(a1 * a1);
  const c1 = 1 - c2 - c3;

  const filt: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i < 2) {
      filt[i] = closes[i]!;
    } else {
      filt[i] = c1 / 2 * (closes[i]! + closes[i - 1]!)
              + c2 * filt[i - 1]!
              + c3 * filt[i - 2]!;
    }
  }

  // ── Reflex computation ──
  // Reflex = filt[i] - filt[i - period]
  // Then slope-adjusted: subtract the linear extrapolation
  // Ehlers: Reflex = 2*filt - filt[period] - filt[1]
  // More precisely:
  //   slope = (filt[i-period] - filt[i]) / period
  //   sum of deviations from the trend line
  //   MS = sum/period, reflex = filt - filt[period] normalized by sqrt(MS)

  const reflex: number[] = new Array(n).fill(0);

  for (let i = period; i < n; i++) {
    // Compute the sum of squared deviations from a trend line
    const slope = (filt[i - period]! - filt[i]!) / period;
    let sumSq = 0;
    for (let j = 1; j <= period; j++) {
      const expectedVal = filt[i]! + j * slope;
      const actualVal = filt[i - j]!;
      const dev = actualVal - expectedVal;
      sumSq += dev * dev;
    }
    const ms = sumSq / period;

    // Reflex raw value
    const rawReflex = filt[i]! - filt[i - period]!;

    if (ms <= 0) {
      reflex[i] = 0;
    } else {
      reflex[i] = rawReflex / Math.sqrt(ms);
    }
  }

  // ── Smooth the reflex with EMA-like filter for stability ──
  const result: (number | null)[] = new Array(n).fill(null);
  const smoothFactor = 2 / (Math.max(Math.floor(period / 2), 1) + 1);
  let smoothed = 0;

  for (let i = period; i < n; i++) {
    if (i === period) {
      smoothed = reflex[i]!;
    } else {
      smoothed = smoothFactor * reflex[i]! + (1 - smoothFactor) * smoothed;
    }
    result[i] = smoothed;
  }

  return toPoints(result, bars);
}

// ─── Log Return ──────────────────────────────────────────────────────────────

/**
 * Log Return: ln(close / prev_close) for each bar.
 *
 * Log returns are additive across time and symmetric for gains/losses,
 * making them preferred for statistical analysis over simple returns.
 *
 * First bar returns null (no previous close).
 *
 * @param bars  OHLCV bar array
 */
export function calcLogReturn(bars: Bar[]): IndicatorPoint[] {
  const n = bars.length;
  if (n < 2) return [];

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const prev = bars[i - 1]!.close;
    const curr = bars[i]!.close;
    if (prev > 0 && curr > 0) {
      result[i] = Math.log(curr / prev);
    }
  }

  return toPoints(result, bars);
}

// ─── Percent Return ──────────────────────────────────────────────────────────

/**
 * Percent Return: (close - prev_close) / prev_close * 100.
 *
 * Simple percentage change between consecutive closes.
 * First bar returns null.
 *
 * @param bars  OHLCV bar array
 */
export function calcPctReturn(bars: Bar[]): IndicatorPoint[] {
  const n = bars.length;
  if (n < 2) return [];

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const prev = bars[i - 1]!.close;
    if (prev !== 0) {
      result[i] = ((bars[i]!.close - prev) / prev) * 100;
    }
  }

  return toPoints(result, bars);
}

// ─── Cumulative Log Return ───────────────────────────────────────────────────

/**
 * Cumulative Log Return: running sum of log returns from bar 0.
 *
 * Equivalent to ln(close[i] / close[0]). Useful for comparing
 * performance across instruments with different price scales.
 *
 * @param bars  OHLCV bar array
 */
export function calcCumLogReturn(bars: Bar[]): IndicatorPoint[] {
  const n = bars.length;
  if (n < 2) return [];

  const result: (number | null)[] = new Array(n).fill(null);
  let cumSum = 0;
  result[0] = 0; // Starting point

  for (let i = 1; i < n; i++) {
    const prev = bars[i - 1]!.close;
    const curr = bars[i]!.close;
    if (prev > 0 && curr > 0) {
      cumSum += Math.log(curr / prev);
      result[i] = cumSum;
    } else {
      result[i] = cumSum; // Carry forward
    }
  }

  return toPoints(result, bars);
}

// ─── Cumulative Percent Return ───────────────────────────────────────────────

/**
 * Cumulative Percent Return: running product of (1 + pctReturn/100) - 1,
 * expressed as a percentage.
 *
 * Equivalent to (close[i] / close[0] - 1) * 100. Shows total
 * percentage gain/loss from the first bar.
 *
 * @param bars  OHLCV bar array
 */
export function calcCumPctReturn(bars: Bar[]): IndicatorPoint[] {
  const n = bars.length;
  if (n < 2) return [];

  const result: (number | null)[] = new Array(n).fill(null);
  const base = bars[0]!.close;

  if (base === 0) return [];

  result[0] = 0; // 0% return at start
  for (let i = 1; i < n; i++) {
    result[i] = ((bars[i]!.close / base) - 1) * 100;
  }

  return toPoints(result, bars);
}
