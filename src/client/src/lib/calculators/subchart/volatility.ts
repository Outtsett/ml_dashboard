import { wilderSmooth } from '../math_primitives';

export function calcTrueRange(
  highs: number[], lows: number[], closes: number[],
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  result[0] = highs[0]! - lows[0]!;
  for (let i = 1; i < n; i++) {
    result[i] = Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!),
    );
  }
  return result;
}

export function calcATR(
  highs: number[], lows: number[], closes: number[], period: number,
): (number | null)[] {
  const tr = calcTrueRange(highs, lows, closes);
  const trNumbers = tr.map(v => v ?? 0);
  return wilderSmooth(trNumbers, period);
}

export function calcNATR(
  highs: number[], lows: number[], closes: number[], period: number,
): (number | null)[] {
  const atr = calcATR(highs, lows, closes, period);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (atr[i] !== null && closes[i]! !== 0) {
      result[i] = (atr[i]! / closes[i]!) * 100;
    }
  }
  return result;
}
