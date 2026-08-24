export function calcStdDev(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period) return result;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]!;
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j]! - mean) ** 2;
    result[i] = Math.sqrt(sqSum / period);
  }
  return result;
}

export function calcVariance(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period) return result;
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]!;
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j]! - mean) ** 2;
    result[i] = sqSum / period;
  }
  return result;
}

export function calcLinregSlope(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period) return result;
  for (let i = period - 1; i < n; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      const x = j;
      const y = closes[i - period + 1 + j]!;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    result[i] = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
  }
  return result;
}

export function calcLinregAngle(closes: number[], period: number): (number | null)[] {
  const slope = calcLinregSlope(closes, period);
  return slope.map(s => s !== null ? Math.atan(s) * (180 / Math.PI) : null);
}

export function calcLinregIntercept(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period) return result;
  for (let i = period - 1; i < n; i++) {
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      const x = j;
      const y = closes[i - period + 1 + j]!;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const slope = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
    result[i] = (sumY - slope * sumX) / period;
  }
  return result;
}
