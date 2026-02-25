/**
 * Core Mathematical Primitives for Technical Analysis
 * 
 * These functions are the building blocks for all technical indicators.
 * Each function is designed to work with arrays and supports configurable periods.
 * The same formulas are used to generate DuckDB SQL for batch processing.
 */

import type { OHLCVBar as SharedOHLCVBar } from '@shared/ohlcv';

/**
 * Math functions accept loose timestamp types. Callers should normalise
 * timestamps (via server/lib/normalize.ts) before they reach the API layer.
 */
export interface OHLCVBar extends Omit<SharedOHLCVBar, 'timestamp'> {
  timestamp: Date | string | number;
}

// ============================================================================
// ROLLING/WINDOW FUNCTIONS
// ============================================================================

/**
 * Simple Moving Average
 * SMA = sum(values) / period
 */
export function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) {
      sum -= values[i - period]!;
    }
    if (i >= period - 1) {
      result.push(sum / period);
    } else {
      result.push(null);
    }
  }

  return result;
}

/**
 * Exponential Moving Average
 * EMA = (value * multiplier) + (prevEMA * (1 - multiplier))
 * where multiplier = 2 / (period + 1)
 */
export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const multiplier = 2 / (period + 1);
  let prevEma: number | null = null;

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      // First EMA is SMA of first period values
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += values[j]!;
      }
      prevEma = sum / period;
      result.push(prevEma);
    } else {
      prevEma = (values[i]! * multiplier) + (prevEma! * (1 - multiplier));
      result.push(prevEma);
    }
  }

  return result;
}

/**
 * Weighted Moving Average
 * WMA = sum(value[i] * weight[i]) / sum(weights)
 * Weights: most recent = period, oldest = 1
 */
export function wma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const weightSum = (period * (period + 1)) / 2;

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let weightedSum = 0;
      for (let j = 0; j < period; j++) {
        weightedSum += values[i - period + 1 + j]! * (j + 1);
      }
      result.push(weightedSum / weightSum);
    }
  }

  return result;
}

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

// ============================================================================
// DIFFERENCE/CHANGE FUNCTIONS
// ============================================================================

/**
 * Difference (change from N periods ago)
 * DIFF = current - previous[n]
 */
export function diff(values: number[], period: number = 1): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      result.push(null);
    } else {
      result.push(values[i]! - values[i - period]!);
    }
  }

  return result;
}

/**
 * Rate of Change (percentage)
 * ROC = ((current - previous) / previous) * 100
 */
export function roc(values: number[], period: number = 1): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < period || values[i - period] === 0) {
      result.push(null);
    } else {
      result.push(((values[i]! - values[i - period]!) / values[i - period]!) * 100);
    }
  }

  return result;
}

/**
 * Momentum (same as DIFF but often used in context of price)
 */
export function momentum(values: number[], period: number = 10): (number | null)[] {
  return diff(values, period);
}

/**
 * LAG - Get value from N periods ago
 */
export function lag(values: number[], period: number = 1): (number | null)[] {
  const result: (number | null)[] = [];

  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      result.push(null);
    } else {
      result.push(values[i - period]!);
    }
  }

  return result;
}

// ============================================================================
// COMPARISON/LOGIC FUNCTIONS
// ============================================================================

/**
 * Crossover - Returns true when series A crosses above series B
 */
export function crossover(a: (number | null)[], b: (number | null)[]): boolean[] {
  const result: boolean[] = [];

  for (let i = 0; i < a.length; i++) {
    if (i === 0 || a[i] === null || b[i] === null || a[i - 1] === null || b[i - 1] === null) {
      result.push(false);
    } else {
      result.push(a[i - 1]! <= b[i - 1]! && a[i]! > b[i]!);
    }
  }

  return result;
}

/**
 * Crossunder - Returns true when series A crosses below series B
 */
export function crossunder(a: (number | null)[], b: (number | null)[]): boolean[] {
  const result: boolean[] = [];

  for (let i = 0; i < a.length; i++) {
    if (i === 0 || a[i] === null || b[i] === null || a[i - 1] === null || b[i - 1] === null) {
      result.push(false);
    } else {
      result.push(a[i - 1]! >= b[i - 1]! && a[i]! < b[i]!);
    }
  }

  return result;
}

// ============================================================================
// PRICE HELPERS
// ============================================================================

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

// ============================================================================
// GAIN/LOSS HELPERS (for RSI)
// ============================================================================

/**
 * Extract gains (positive changes only)
 */
export function gains(values: number[]): (number | null)[] {
  const changes = diff(values, 1);
  return changes.map(c => c !== null && c > 0 ? c : (c === null ? null : 0));
}

/**
 * Extract losses (absolute value of negative changes)
 */
export function losses(values: number[]): (number | null)[] {
  const changes = diff(values, 1);
  return changes.map(c => c !== null && c < 0 ? Math.abs(c) : (c === null ? null : 0));
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Apply a function to non-null values only
 */
export function mapNonNull<T, U>(
  arr: (T | null)[],
  fn: (val: T) => U
): (U | null)[] {
  return arr.map(v => v !== null ? fn(v) : null);
}

/**
 * Combine two series element-wise
 */
export function combine(
  a: (number | null)[],
  b: (number | null)[],
  fn: (a: number, b: number) => number
): (number | null)[] {
  return a.map((valA, i) => {
    const valB = b[i];
    if (valA === null || valB == null) return null;
    return fn(valA, valB);
  });
}

/**
 * Shift series by N positions (positive = forward, negative = backward)
 */
export function shift(values: (number | null)[], n: number): (number | null)[] {
  if (n > 0) {
    return [...Array(n).fill(null), ...values.slice(0, -n)];
  } else if (n < 0) {
    return [...values.slice(-n), ...Array(-n).fill(null)];
  }
  return [...values];
}
