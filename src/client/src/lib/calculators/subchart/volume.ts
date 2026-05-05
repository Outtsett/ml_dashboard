import { ema } from '../math_primitives';

export function calcOBV(closes: number[], volumes: number[]): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n === 0) return result;
  let obv = 0;
  result[0] = obv;
  for (let i = 1; i < n; i++) {
    if (closes[i]! > closes[i - 1]!) obv += volumes[i]!;
    else if (closes[i]! < closes[i - 1]!) obv -= volumes[i]!;
    result[i] = obv;
  }
  return result;
}

export function calcAD(
  highs: number[], lows: number[], closes: number[], volumes: number[],
): (number | null)[] {
  // Accumulation/Distribution Line
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n === 0) return result;
  let ad = 0;
  for (let i = 0; i < n; i++) {
    const range = highs[i]! - lows[i]!;
    if (range !== 0) {
      const clv = ((closes[i]! - lows[i]!) - (highs[i]! - closes[i]!)) / range;
      ad += clv * volumes[i]!;
    }
    result[i] = ad;
  }
  return result;
}

export function calcADOSC(
  highs: number[], lows: number[], closes: number[], volumes: number[],
  fastP: number, slowP: number,
): (number | null)[] {
  const adLine = calcAD(highs, lows, closes, volumes);
  const adNumbers = adLine.map(v => v ?? 0);
  const fastEMA = ema(adNumbers, fastP);
  const slowEMA = ema(adNumbers, slowP);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      result[i] = fastEMA[i]! - slowEMA[i]!;
    }
  }
  return result;
}
