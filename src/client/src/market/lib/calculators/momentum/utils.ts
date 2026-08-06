import { wilderSmooth, gains, losses } from "../math_primitives";

/** Compute RSI from a value array. Returns null-padded array. */
export function rsiFromValues(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1 || period < 1) return result;
  const g = gains(values);
  const l = losses(values);
  const avgGain = wilderSmooth(g, period);
  const avgLoss = wilderSmooth(l, period);
  for (let i = 0; i < n; i++) {
    const ag = avgGain[i];
    const al = avgLoss[i];
    if (ag == null || al == null) continue;
    if (al === 0) {
      result[i] = ag === 0 ? 50 : 100;
    } else {
      result[i] = 100 - 100 / (1 + ag / al);
    }
  }
  return result;
}

/** Fill nulls with 0 for internal calculations. */
export function fillNulls(arr: (number | null)[]): number[] {
  return arr.map((v) => v ?? 0);
}
