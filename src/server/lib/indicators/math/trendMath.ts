/**
 * Moving average primitives: SMA, EMA, WMA
 */

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
