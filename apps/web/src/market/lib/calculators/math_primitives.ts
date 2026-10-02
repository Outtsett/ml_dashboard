/**
 * Shared math primitives for all client-side indicator calculators.
 *
 * Every function handles edge cases: empty arrays, period > length,
 * NaN/Infinity values. Leading nulls fill positions with insufficient data.
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface Bar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface IndicatorPoint {
  time: number;
  value: number;
}

// ─── Timestamp / Conversion ──────────────────────────────────────────────────

/** Convert epoch-ms to epoch-sec. Pass through if already in seconds (< 1e12). */
export function toTimeSec(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : ts;
}

/** Convert null-padded value array + bars into IndicatorPoint[], skipping nulls/NaN/Infinity. */
export function toPoints(values: (number | null)[], bars: Bar[]): IndicatorPoint[] {
  const points: IndicatorPoint[] = [];
  const len = Math.min(values.length, bars.length);
  for (let i = 0; i < len; i++) {
    const v = values[i];
    if (v !== null && v !== undefined && !isNaN(v) && isFinite(v)) {
      points.push({ time: toTimeSec(bars[i]!.timestamp), value: v });
    }
  }
  return points;
}

// ─── Moving Averages ─────────────────────────────────────────────────────────

/** Simple Moving Average */
export function sma(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  result[period - 1] = sum / period;
  for (let i = period; i < n; i++) {
    sum += values[i]! - values[i - period]!;
    result[i] = sum / period;
  }
  return result;
}

/** Exponential Moving Average with SMA seed, k = 2/(period+1) */
export function ema(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  result[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < n; i++) {
    prev = values[i]! * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

/** Weighted Moving Average: weight_i = i+1, denominator = period*(period+1)/2 */
export function wma(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return result;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += values[i - period + 1 + j]! * (j + 1);
    }
    result[i] = sum / denom;
  }
  return result;
}

/** Wilder's smoothing (RMA). k = 1/period. SMA seed over first `period` values. */
export function wilderSmooth(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  result[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + values[i]!) / period;
    result[i] = prev;
  }
  return result;
}

/** Running Moving Average — alias for Wilder's smoothing */
export function rma(values: number[], period: number): (number | null)[] {
  return wilderSmooth(values, period);
}

// ─── Rolling Window Functions ────────────────────────────────────────────────

/** Rolling maximum over window */
export function rollingMax(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return result;
  for (let i = period - 1; i < n; i++) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j]! > max) max = values[j]!;
    }
    result[i] = max;
  }
  return result;
}

/** Rolling minimum over window */
export function rollingMin(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return result;
  for (let i = period - 1; i < n; i++) {
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j]! < min) min = values[j]!;
    }
    result[i] = min;
  }
  return result;
}

/** Rolling sum over window */
export function rollingSum(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  result[period - 1] = sum;
  for (let i = period; i < n; i++) {
    sum += values[i]! - values[i - period]!;
    result[i] = sum;
  }
  return result;
}

/** Rolling standard deviation (population formula: divide by N, not N-1) */
export function stddev(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return result;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j]!;
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (values[j]! - mean) ** 2;
    result[i] = Math.sqrt(sqSum / period);
  }
  return result;
}

/** Rolling median over window */
export function rollingMedian(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return result;
  for (let i = period - 1; i < n; i++) {
    const window: number[] = [];
    for (let j = i - period + 1; j <= i; j++) window.push(values[j]!);
    window.sort((a, b) => a - b);
    const mid = Math.floor(period / 2);
    result[i] = period % 2 === 0
      ? (window[mid - 1]! + window[mid]!) / 2
      : window[mid]!;
  }
  return result;
}

/** Percent rank: fraction of values in window that are <= current value, * 100 */
export function percentRank(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return result;
  for (let i = period - 1; i < n; i++) {
    const current = values[i]!;
    let count = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j]! <= current) count++;
    }
    // Exclude current value from count/denominator for standard percent rank
    result[i] = ((count - 1) / (period - 1)) * 100;
  }
  return result;
}

// ─── Price Transforms ────────────────────────────────────────────────────────

/** True Range: max(high-low, |high-prevClose|, |low-prevClose|). First bar uses high-low. */
export function trueRange(bars: Bar[]): number[] {
  const n = bars.length;
  if (n === 0) return [];
  const result: number[] = new Array(n);
  result[0] = bars[0]!.high - bars[0]!.low;
  for (let i = 1; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const pc = bars[i - 1]!.close;
    result[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return result;
}

/** Typical Price: (H+L+C)/3 */
export function typicalPrice(bars: Bar[]): number[] {
  return bars.map(b => (b.high + b.low + b.close) / 3);
}

/** Median Price: (H+L)/2 */
export function medianPrice(bars: Bar[]): number[] {
  return bars.map(b => (b.high + b.low) / 2);
}

/** OHLC4: (O+H+L+C)/4 */
export function ohlc4(bars: Bar[]): number[] {
  return bars.map(b => (b.open + b.high + b.low + b.close) / 4);
}

/** Alias for typicalPrice: (H+L+C)/3 */
export function hlc3(bars: Bar[]): number[] {
  return typicalPrice(bars);
}

/** Weighted Close: (H+L+2C)/4 */
export function weightedClose(bars: Bar[]): number[] {
  return bars.map(b => (b.high + b.low + 2 * b.close) / 4);
}

// ─── Change / Rate Functions ─────────────────────────────────────────────────

/** Extract positive changes from sequential values. gains[0] = 0. */
export function gains(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const result: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d > 0) result[i] = d;
  }
  return result;
}

/** Extract absolute negative changes. losses[0] = 0. */
export function losses(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const result: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = values[i]! - values[i - 1]!;
    if (d < 0) result[i] = -d;
  }
  return result;
}

/** Difference from N periods ago: values[i] - values[i - period] */
export function diff(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (period < 1) return result;
  for (let i = period; i < n; i++) {
    result[i] = values[i]! - values[i - period]!;
  }
  return result;
}

/** Rate of change: (v - v[i-period]) / v[i-period] * 100 */
export function roc(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (period < 1) return result;
  for (let i = period; i < n; i++) {
    const prev = values[i - period]!;
    if (prev !== 0) {
      result[i] = ((values[i]! - prev) / prev) * 100;
    } else {
      result[i] = 0;
    }
  }
  return result;
}

// ─── Crossover / Crossunder ──────────────────────────────────────────────────

/** a crosses above b: a[i] > b[i] && a[i-1] <= b[i-1] */
export function crossover(a: (number | null)[], b: (number | null)[]): boolean[] {
  const n = Math.min(a.length, b.length);
  const result: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    if (
      a[i] !== null && b[i] !== null &&
      a[i - 1] !== null && b[i - 1] !== null &&
      a[i]! > b[i]! && a[i - 1]! <= b[i - 1]!
    ) {
      result[i] = true;
    }
  }
  return result;
}

/** a crosses below b: a[i] < b[i] && a[i-1] >= b[i-1] */
export function crossunder(a: (number | null)[], b: (number | null)[]): boolean[] {
  const n = Math.min(a.length, b.length);
  const result: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    if (
      a[i] !== null && b[i] !== null &&
      a[i - 1] !== null && b[i - 1] !== null &&
      a[i]! < b[i]! && a[i - 1]! >= b[i - 1]!
    ) {
      result[i] = true;
    }
  }
  return result;
}

// ─── Linear Regression ───────────────────────────────────────────────────────

/**
 * Rolling linear regression over a window of `period`.
 * Returns slope, intercept, and R-squared at each position.
 */
export function linregCore(
  values: number[],
  period: number,
): { slope: (number | null)[]; intercept: (number | null)[]; r2: (number | null)[] } {
  const n = values.length;
  const slope: (number | null)[] = new Array(n).fill(null);
  const intercept: (number | null)[] = new Array(n).fill(null);
  const r2: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 2) return { slope, intercept, r2 };

  // Pre-compute sumX, sumX2 since x = 0..period-1 is constant
  const sumX = (period * (period - 1)) / 2;
  const sumX2 = ((period - 1) * period * (2 * period - 1)) / 6;

  for (let i = period - 1; i < n; i++) {
    let sumY = 0;
    let sumXY = 0;
    let sumY2 = 0;
    for (let j = 0; j < period; j++) {
      const y = values[i - period + 1 + j]!;
      sumY += y;
      sumXY += j * y;
      sumY2 += y * y;
    }

    const denom = period * sumX2 - sumX * sumX;
    if (denom === 0) continue;

    const m = (period * sumXY - sumX * sumY) / denom;
    const b = (sumY - m * sumX) / period;
    slope[i] = m;
    intercept[i] = b;

    // R-squared
    const meanY = sumY / period;
    const ssTot = sumY2 - period * meanY * meanY;
    if (ssTot === 0) {
      r2[i] = 1; // All values identical — perfect fit
    } else {
      // ssRes = sum((y - (b + m*x))^2)
      let ssRes = 0;
      for (let j = 0; j < period; j++) {
        const y = values[i - period + 1 + j]!;
        const predicted = b + m * j;
        ssRes += (y - predicted) ** 2;
      }
      r2[i] = 1 - ssRes / ssTot;
    }
  }

  return { slope, intercept, r2 };
}
