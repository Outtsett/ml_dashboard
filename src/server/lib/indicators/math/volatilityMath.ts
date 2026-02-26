/**
 * Volatility & range primitives: stddev, rolling sum/max/min, true range, price helpers
 */

import type { OHLCVBar } from './types';

/**
 * Rolling Standard Deviation
 * STDDEV = sqrt(sum((x - mean)^2) / n)
 */
export function stddev(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const window = values.slice(i - period + 1, i + 1);
      const mean = window.reduce((a, b) => a + b, 0) / period;
      const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      result.push(Math.sqrt(variance));
    }
  }

  return result;
}

/**
 * Rolling Sum
 */
export function rollingSum(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) {
      sum -= values[i - period]!;
    }
    if (i >= period - 1) {
      result.push(sum);
    } else {
      result.push(null);
    }
  }

  return result;
}

/**
 * Rolling Maximum
 */
export function rollingMax(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const window = values.slice(i - period + 1, i + 1);
      result.push(Math.max(...window));
    }
  }

  return result;
}

/**
 * Rolling Minimum
 */
export function rollingMin(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const window = values.slice(i - period + 1, i + 1);
      result.push(Math.min(...window));
    }
  }

  return result;
}

/**
 * True Range - Max of: (high - low), |high - prevClose|, |low - prevClose|
 */
export function trueRange(bars: OHLCVBar[]): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      result.push(bars[i]!.high - bars[i]!.low);
    } else {
      const prevClose = bars[i - 1]!.close;
      const tr = Math.max(
        bars[i]!.high - bars[i]!.low,
        Math.abs(bars[i]!.high - prevClose),
        Math.abs(bars[i]!.low - prevClose)
      );
      result.push(tr);
    }
  }

  return result;
}

/**
 * Typical Price = (High + Low + Close) / 3
 */
export function typicalPrice(bars: OHLCVBar[]): number[] {
  return bars.map(bar => (bar.high + bar.low + bar.close) / 3);
}

/**
 * OHLC4 = (Open + High + Low + Close) / 4
 */
export function ohlc4(bars: OHLCVBar[]): number[] {
  return bars.map(bar => (bar.open + bar.high + bar.low + bar.close) / 4);
}

/**
 * HL2 = (High + Low) / 2
 */
export function hl2(bars: OHLCVBar[]): number[] {
  return bars.map(bar => (bar.high + bar.low) / 2);
}

/**
 * HLC3 = (High + Low + Close) / 3
 */
export function hlc3(bars: OHLCVBar[]): number[] {
  return bars.map(bar => (bar.high + bar.low + bar.close) / 3);
}
