import { ema, sma, rollingMax, rollingMin } from '../math_primitives';

export function calcRSI(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return result;

  // Calculate gains and losses
  const gains: number[] = new Array(n).fill(0);
  const losses: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff > 0) gains[i] = diff;
    else losses[i] = -diff;
  }

  // Initial averages (SMA over first `period` changes)
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    avgGain += gains[i]!;
    avgLoss += losses[i]!;
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) result[period] = 100;
  else result[period] = 100 - (100 / (1 + avgGain / avgLoss));

  // Wilder smoothing
  for (let i = period + 1; i < n; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;
    if (avgLoss === 0) result[i] = 100;
    else result[i] = 100 - (100 / (1 + avgGain / avgLoss));
  }

  return result;
}

export function calcMACD(
  closes: number[], fastP: number, slowP: number, signalP: number,
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const n = closes.length;
  const fastEMA = ema(closes, fastP);
  const slowEMA = ema(closes, slowP);

  const macdLine: (number | null)[] = new Array(n).fill(null);
  const macdValues: number[] = [];
  const macdStartIndices: number[] = [];

  for (let i = 0; i < n; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      macdLine[i] = fastEMA[i]! - slowEMA[i]!;
      macdValues.push(macdLine[i]!);
      macdStartIndices.push(i);
    }
  }

  // Signal line = EMA of MACD values
  const signalRaw = ema(macdValues, signalP);
  const signalLine: (number | null)[] = new Array(n).fill(null);
  const histogram: (number | null)[] = new Array(n).fill(null);

  for (let j = 0; j < signalRaw.length; j++) {
    const i = macdStartIndices[j]!;
    const sigVal = signalRaw[j] ?? null;
    if (sigVal !== null) {
      signalLine[i] = sigVal;
      histogram[i] = macdLine[i]! - sigVal;
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

export function calcStochastic(
  highs: number[], lows: number[], closes: number[],
  kPeriod: number, slowK: number, slowD: number,
): { k: (number | null)[]; d: (number | null)[] } {
  const n = closes.length;
  const hh = rollingMax(highs, kPeriod);
  const ll = rollingMin(lows, kPeriod);

  // Raw %K
  const rawK: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (hh[i] !== null && ll[i] !== null && hh[i]! !== ll[i]!) {
      rawK[i] = ((closes[i]! - ll[i]!) / (hh[i]! - ll[i]!)) * 100;
    }
  }

  // Slow %K = SMA(slowK) of raw %K
  const slowKLine = sma(rawK, slowK);
  // Slow %D = SMA(slowD) of slow %K
  const slowKNumbers = slowKLine.map(v => v ?? 0);
  const slowDLine = sma(slowKNumbers, slowD);

  // Fix leading values: only valid after kPeriod + slowK - 1
  const startIdx = kPeriod + slowK - 2;
  for (let i = 0; i < startIdx; i++) {
    slowKLine[i] = null;
  }
  const startIdxD = startIdx + slowD - 1;
  for (let i = 0; i < startIdxD; i++) {
    slowDLine[i] = null;
  }

  return { k: slowKLine, d: slowDLine };
}

export function calcStochasticFast(
  highs: number[], lows: number[], closes: number[],
  kPeriod: number, dPeriod: number,
): { k: (number | null)[]; d: (number | null)[] } {
  const n = closes.length;
  const hh = rollingMax(highs, kPeriod);
  const ll = rollingMin(lows, kPeriod);

  const fastK: (number | null)[] = new Array(n).fill(null);
  for (let i = kPeriod - 1; i < n; i++) {
    if (hh[i] !== null && ll[i] !== null && hh[i]! !== ll[i]!) {
      fastK[i] = ((closes[i]! - ll[i]!) / (hh[i]! - ll[i]!)) * 100;
    }
  }

  const fastKNumbers = fastK.map(v => v ?? 0);
  const fastD = sma(fastKNumbers, dPeriod);

  // Null out leading values
  for (let i = 0; i < kPeriod - 1; i++) fastD[i] = null;

  return { k: fastK, d: fastD };
}

export function calcStochRSI(
  closes: number[], rsiPeriod: number, stochPeriod: number,
  kSmooth: number, dSmooth: number,
): { k: (number | null)[]; d: (number | null)[] } {
  const rsi = calcRSI(closes, rsiPeriod);
  const n = closes.length;

  const rsiNumbers = rsi.map(v => v ?? 0);
  const hh = rollingMax(rsiNumbers, stochPeriod);
  const ll = rollingMin(rsiNumbers, stochPeriod);

  const rawK: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (hh[i] !== null && ll[i] !== null && hh[i]! !== ll[i]!) {
      rawK[i] = ((rsiNumbers[i]! - ll[i]!) / (hh[i]! - ll[i]!)) * 100;
    }
  }

  const k = sma(rawK, kSmooth);
  const kNumbers = k.map(v => v ?? 0);
  const d = sma(kNumbers, dSmooth);

  // Correct warmup
  const warmup = rsiPeriod + stochPeriod + kSmooth - 2;
  for (let i = 0; i < warmup; i++) k[i] = null;
  const dWarmup = warmup + dSmooth - 1;
  for (let i = 0; i < dWarmup; i++) d[i] = null;

  return { k, d };
}

export function calcCCI(
  highs: number[], lows: number[], closes: number[], period: number,
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period) return result;

  const tp = new Array(n);
  for (let i = 0; i < n; i++) tp[i] = (highs[i]! + lows[i]! + closes[i]!) / 3;

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tp[j]!;
    const avgTP = sum / period;

    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(tp[j]! - avgTP);
    meanDev /= period;

    if (meanDev === 0) result[i] = 0;
    else result[i] = (tp[i]! - avgTP) / (0.015 * meanDev);
  }
  return result;
}

export function calcWilliamsR(
  highs: number[], lows: number[], closes: number[], period: number,
): (number | null)[] {
  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    const high = hh[i]!;
    const low = ll[i]!;
    if (high !== low) {
      result[i] = ((high - closes[i]!) / (high - low)) * -100;
    } else {
      result[i] = 0;
    }
  }
  return result;
}

export function calcMomentum(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    result[i] = closes[i]! - closes[i - period]!;
  }
  return result;
}

export function calcROC(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    const prev = closes[i - period]!;
    if (prev !== 0) {
      result[i] = ((closes[i]! - prev) / prev) * 100;
    }
  }
  return result;
}

export function calcROCP(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    const prev = closes[i - period]!;
    if (prev !== 0) {
      result[i] = (closes[i]! - prev) / prev;
    }
  }
  return result;
}

export function calcROCR(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    const prev = closes[i - period]!;
    if (prev !== 0) {
      result[i] = closes[i]! / prev;
    }
  }
  return result;
}

export function calcROCR100(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    const prev = closes[i - period]!;
    if (prev !== 0) {
      result[i] = (closes[i]! / prev) * 100;
    }
  }
  return result;
}

export function calcCMO(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return result;

  const gains: number[] = new Array(n).fill(0);
  const losses: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff > 0) gains[i] = diff;
    else losses[i] = -diff;
  }

  for (let i = period; i < n; i++) {
    let sumG = 0, sumL = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumG += gains[j]!;
      sumL += losses[j]!;
    }
    if (sumG + sumL !== 0) {
      result[i] = ((sumG - sumL) / (sumG + sumL)) * 100;
    } else {
      result[i] = 0;
    }
  }
  return result;
}

export function calcMFI(
  highs: number[], lows: number[], closes: number[], volumes: number[],
  period: number,
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return result;

  const tp: number[] = new Array(n);
  for (let i = 0; i < n; i++) tp[i] = (highs[i]! + lows[i]! + closes[i]!) / 3;

  const posFlow: number[] = new Array(n).fill(0);
  const negFlow: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const flow = tp[i]! * volumes[i]!;
    if (tp[i]! > tp[i - 1]!) posFlow[i] = flow;
    else if (tp[i]! < tp[i - 1]!) negFlow[i] = flow;
  }

  for (let i = period; i < n; i++) {
    let sumP = 0, sumN = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumP += posFlow[j]!;
      sumN += negFlow[j]!;
    }
    if (sumN === 0) result[i] = 100;
    else result[i] = 100 - (100 / (1 + sumP / sumN));
  }
  return result;
}

export function calcAPO(closes: number[], fastP: number, slowP: number): (number | null)[] {
  const fastEMA = ema(closes, fastP);
  const slowEMA = ema(closes, slowP);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null) {
      result[i] = fastEMA[i]! - slowEMA[i]!;
    }
  }
  return result;
}

export function calcPPO(closes: number[], fastP: number, slowP: number): (number | null)[] {
  const fastEMA = ema(closes, fastP);
  const slowEMA = ema(closes, slowP);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fastEMA[i] !== null && slowEMA[i] !== null && slowEMA[i]! !== 0) {
      result[i] = ((fastEMA[i]! - slowEMA[i]!) / slowEMA[i]!) * 100;
    }
  }
  return result;
}

export function calcBOP(
  opens: number[], highs: number[], lows: number[], closes: number[],
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const range = highs[i]! - lows[i]!;
    if (range !== 0) {
      result[i] = (closes[i]! - opens[i]!) / range;
    } else {
      result[i] = 0;
    }
  }
  return result;
}

export function calcUltimateOscillator(
  highs: number[], lows: number[], closes: number[],
  p1: number, p2: number, p3: number,
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < p3 + 1) return result;

  // BP = close - min(low, prevClose), TR = max(high, prevClose) - min(low, prevClose)
  const bp: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const prevC = closes[i - 1]!;
    bp[i] = closes[i]! - Math.min(lows[i]!, prevC);
    tr[i] = Math.max(highs[i]!, prevC) - Math.min(lows[i]!, prevC);
  }

  for (let i = p3; i < n; i++) {
    let bpSum1 = 0, trSum1 = 0;
    let bpSum2 = 0, trSum2 = 0;
    let bpSum3 = 0, trSum3 = 0;

    for (let j = i - p1 + 1; j <= i; j++) { bpSum1 += bp[j]!; trSum1 += tr[j]!; }
    for (let j = i - p2 + 1; j <= i; j++) { bpSum2 += bp[j]!; trSum2 += tr[j]!; }
    for (let j = i - p3 + 1; j <= i; j++) { bpSum3 += bp[j]!; trSum3 += tr[j]!; }

    if (trSum1 === 0 || trSum2 === 0 || trSum3 === 0) continue;

    const avg1 = bpSum1 / trSum1;
    const avg2 = bpSum2 / trSum2;
    const avg3 = bpSum3 / trSum3;

    result[i] = ((4 * avg1 + 2 * avg2 + avg3) / 7) * 100;
  }

  return result;
}

export function calcTRIX(closes: number[], period: number): (number | null)[] {
  // TRIX = 1-period ROC of triple-smoothed EMA
  const ema1 = ema(closes, period);
  const ema1n = ema1.map(v => v ?? 0);
  const ema2 = ema(ema1n, period);
  const ema2n = ema2.map(v => v ?? 0);
  const ema3 = ema(ema2n, period);

  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = 1; i < n; i++) {
    if (ema3[i] !== null && ema3[i - 1] !== null && ema3[i - 1]! !== 0) {
      result[i] = ((ema3[i]! - ema3[i - 1]!) / ema3[i - 1]!) * 100;
    }
  }

  // Null out insufficiently warmed values
  const warmup = (period - 1) * 3 + 1;
  for (let i = 0; i < warmup; i++) result[i] = null;

  return result;
}
