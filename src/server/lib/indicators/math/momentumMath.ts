/**
 * Momentum & change primitives: diff, ROC, momentum, lag, crossover, gains/losses, utilities
 */

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
