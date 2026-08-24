export interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PatternResult {
  name: string;        // e.g., "CDL_DOJI"
  displayName: string; // e.g., "Doji"
  value: number;       // 100 (bullish), -100 (bearish), or 0
}

export function bodySize(bar: Bar): number {
  return Math.abs(bar.close - bar.open);
}

export function upperWick(bar: Bar): number {
  return bar.high - Math.max(bar.open, bar.close);
}

export function lowerWick(bar: Bar): number {
  return Math.min(bar.open, bar.close) - bar.low;
}

export function range(bar: Bar): number {
  return bar.high - bar.low;
}

export function isBullish(bar: Bar): boolean {
  return bar.close > bar.open;
}

export function isBearish(bar: Bar): boolean {
  return bar.close < bar.open;
}

export function isDoji(bar: Bar): boolean {
  const r = range(bar);
  if (r === 0) return true;
  return bodySize(bar) <= r * 0.1;
}

export function bodyMidpoint(bar: Bar): number {
  return (bar.open + bar.close) / 2;
}

export function bodyTop(bar: Bar): number {
  return Math.max(bar.open, bar.close);
}

export function bodyBottom(bar: Bar): number {
  return Math.min(bar.open, bar.close);
}

/**
 * Determine trend direction from prior bars.
 * Looks back `lookback` bars and compares average close to current close.
 * Returns 'up', 'down', or 'flat'.
 */
export function trendDirection(bars: Bar[], index: number, lookback: number = 5): 'up' | 'down' | 'flat' {
  if (index < lookback) return 'flat';
  let sum = 0;
  for (let i = index - lookback; i < index; i++) {
    sum += bars[i]!.close;
  }
  const avg = sum / lookback;
  const current = bars[index]!.close;
  const threshold = avg * 0.001; // 0.1% dead zone
  if (current > avg + threshold) return 'up';
  if (current < avg - threshold) return 'down';
  return 'flat';
}

/**
 * Check if two prices are approximately equal within a tolerance.
 * Tolerance is relative to the average of the two values.
 */
export function approxEqual(a: number, b: number, tolerance: number = 0.001): boolean {
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  if (avg === 0) return true;
  return Math.abs(a - b) / avg <= tolerance;
}

/**
 * Compute average body size over a lookback window ending before `index`.
 * Used by Long Line, Short Line, and other patterns that need relative body comparison.
 */
export function avgBodySize(bars: Bar[], index: number, lookback: number = 10): number {
  const start = Math.max(0, index - lookback);
  if (start >= index) return bodySize(bars[index]!);
  let sum = 0;
  for (let i = start; i < index; i++) {
    sum += bodySize(bars[i]!);
  }
  return sum / (index - start);
}

/**
 * Check if a bar is a marubozu (body >= 90% of range, minimal wicks).
 */
export function isMarubozu(bar: Bar): boolean {
  const r = range(bar);
  if (r === 0) return false;
  return bodySize(bar) >= r * 0.90;
}
