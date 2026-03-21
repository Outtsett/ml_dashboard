/**
 * Client-side subchart indicator calculators.
 *
 * Computes ALL non-overlay, non-pattern indicators from raw OHLCV data
 * so every symbol gets full indicator coverage without depending on
 * the talib_features table (which only has MNQ data).
 *
 * Each calculator returns {time, value}[] in lightweight-charts format.
 */

export interface IndicatorPoint {
  time: number;
  value: number;
}

interface Bar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATH PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════════

function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  result[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i]! - values[i - period]!;
    result[i] = sum / period;
  }
  return result;
}

function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  result[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

/** Wilder's smoothing (used by RSI, ATR, ADX). Equivalent to EMA with k=1/period */
function wilderSmooth(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  result[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]!) / period;
    result[i] = prev;
  }
  return result;
}

function rollingMax(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  for (let i = period - 1; i < values.length; i++) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j]! > max) max = values[j]!;
    }
    result[i] = max;
  }
  return result;
}

function rollingMin(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;
  for (let i = period - 1; i < values.length; i++) {
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j]! < min) min = values[j]!;
    }
    result[i] = min;
  }
  return result;
}

/** Convert epoch-ms timestamp to epoch-seconds for lightweight-charts */
function toTimeSec(ts: number): number {
  return ts > 1e12 ? Math.floor(ts / 1000) : ts;
}

/** Convert (number|null)[] + bars → IndicatorPoint[] */
function toPoints(vals: (number | null)[], bars: Bar[]): IndicatorPoint[] {
  const points: IndicatorPoint[] = [];
  for (let i = 0; i < bars.length; i++) {
    const v = vals[i];
    if (v !== null && v !== undefined && !isNaN(v) && isFinite(v)) {
      points.push({ time: toTimeSec(bars[i]!.timestamp), value: v });
    }
  }
  return points;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOMENTUM INDICATORS
// ═══════════════════════════════════════════════════════════════════════════════

function calcRSI(closes: number[], period: number): (number | null)[] {
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

function calcMACD(
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

function calcStochastic(
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

function calcStochasticFast(
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

function calcStochRSI(
  closes: number[], rsiPeriod: number, stochPeriod: number,
  kSmooth: number, dSmooth: number,
): { k: (number | null)[]; d: (number | null)[] } {
  const rsiValues = calcRSI(closes, rsiPeriod);
  const n = closes.length;

  // Apply stochastic formula to RSI values
  const rsiNumbers = rsiValues.map(v => v ?? 0);
  const rsiMax = rollingMax(rsiNumbers, stochPeriod);
  const rsiMin = rollingMin(rsiNumbers, stochPeriod);

  const rawK: number[] = new Array(n).fill(0);
  const startIdx = rsiPeriod + stochPeriod;
  for (let i = startIdx; i < n; i++) {
    if (rsiMax[i] !== null && rsiMin[i] !== null && rsiMax[i]! !== rsiMin[i]!) {
      rawK[i] = ((rsiNumbers[i]! - rsiMin[i]!) / (rsiMax[i]! - rsiMin[i]!)) * 100;
    }
  }

  const kLine = sma(rawK, kSmooth);
  const kNumbers = kLine.map(v => v ?? 0);
  const dLine = sma(kNumbers, dSmooth);

  // Null out leading values
  for (let i = 0; i < startIdx + kSmooth - 1; i++) kLine[i] = null;
  for (let i = 0; i < startIdx + kSmooth + dSmooth - 2; i++) dLine[i] = null;

  return { k: kLine, d: dLine };
}

function calcCCI(
  highs: number[], lows: number[], closes: number[], period: number,
): (number | null)[] {
  const n = closes.length;
  const tp: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    tp[i] = (highs[i]! + lows[i]! + closes[i]!) / 3;
  }

  const tpSMA = sma(tp, period);
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    const mean = tpSMA[i] ?? null;
    if (mean === null) continue;

    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) {
      meanDev += Math.abs(tp[j]! - mean);
    }
    meanDev /= period;

    if (meanDev === 0) {
      result[i] = 0;
    } else {
      result[i] = (tp[i]! - mean) / (0.015 * meanDev);
    }
  }

  return result;
}

function calcWilliamsR(
  highs: number[], lows: number[], closes: number[], period: number,
): (number | null)[] {
  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    if (hh[i] !== null && ll[i] !== null && hh[i]! !== ll[i]!) {
      result[i] = ((hh[i]! - closes[i]!) / (hh[i]! - ll[i]!)) * -100;
    }
  }

  return result;
}

function calcMomentum(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    result[i] = closes[i]! - closes[i - period]!;
  }
  return result;
}

function calcROC(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (closes[i - period]! !== 0) {
      result[i] = ((closes[i]! - closes[i - period]!) / closes[i - period]!) * 100;
    }
  }
  return result;
}

function calcROCP(closes: number[], period: number): (number | null)[] {
  // Rate of change percentage (same as ROC / 100)
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (closes[i - period]! !== 0) {
      result[i] = (closes[i]! - closes[i - period]!) / closes[i - period]!;
    }
  }
  return result;
}

function calcROCR(closes: number[], period: number): (number | null)[] {
  // Rate of change ratio
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (closes[i - period]! !== 0) {
      result[i] = closes[i]! / closes[i - period]!;
    }
  }
  return result;
}

function calcROCR100(closes: number[], period: number): (number | null)[] {
  // Rate of change ratio * 100
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (closes[i - period]! !== 0) {
      result[i] = (closes[i]! / closes[i - period]!) * 100;
    }
  }
  return result;
}

function calcCMO(closes: number[], period: number): (number | null)[] {
  // Chande Momentum Oscillator
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return result;

  for (let i = period; i < n; i++) {
    let sumUp = 0;
    let sumDown = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j]! - closes[j - 1]!;
      if (diff > 0) sumUp += diff;
      else sumDown += -diff;
    }
    if (sumUp + sumDown === 0) result[i] = 0;
    else result[i] = ((sumUp - sumDown) / (sumUp + sumDown)) * 100;
  }

  return result;
}

function calcMFI(
  highs: number[], lows: number[], closes: number[], volumes: number[], period: number,
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return result;

  const tp: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    tp[i] = (highs[i]! + lows[i]! + closes[i]!) / 3;
  }

  for (let i = period; i < n; i++) {
    let posFlow = 0;
    let negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const rawMF = tp[j]! * volumes[j]!;
      if (tp[j]! > tp[j - 1]!) posFlow += rawMF;
      else if (tp[j]! < tp[j - 1]!) negFlow += rawMF;
    }
    if (negFlow === 0) result[i] = 100;
    else {
      const mfRatio = posFlow / negFlow;
      result[i] = 100 - (100 / (1 + mfRatio));
    }
  }

  return result;
}

function calcAPO(closes: number[], fastP: number, slowP: number): (number | null)[] {
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

function calcPPO(closes: number[], fastP: number, slowP: number): (number | null)[] {
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

function calcBOP(
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

function calcUltimateOscillator(
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

function calcTRIX(closes: number[], period: number): (number | null)[] {
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

// ═══════════════════════════════════════════════════════════════════════════════
// VOLATILITY INDICATORS
// ═══════════════════════════════════════════════════════════════════════════════

function calcTrueRange(
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

function calcATR(
  highs: number[], lows: number[], closes: number[], period: number,
): (number | null)[] {
  const tr = calcTrueRange(highs, lows, closes);
  const trNumbers = tr.map(v => v ?? 0);
  return wilderSmooth(trNumbers, period);
}

function calcNATR(
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

// ═══════════════════════════════════════════════════════════════════════════════
// VOLUME INDICATORS
// ═══════════════════════════════════════════════════════════════════════════════

function calcOBV(closes: number[], volumes: number[]): (number | null)[] {
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

function calcAD(
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

function calcADOSC(
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

// ═══════════════════════════════════════════════════════════════════════════════
// TREND INDICATORS
// ═══════════════════════════════════════════════════════════════════════════════

function calcDirectionalMovement(
  highs: number[], lows: number[], closes: number[], period: number,
): {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
  dx: (number | null)[];
  plusDM: (number | null)[];
  minusDM: (number | null)[];
} {
  const n = closes.length;
  const adx: (number | null)[] = new Array(n).fill(null);
  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);
  const dx: (number | null)[] = new Array(n).fill(null);
  const plusDMOut: (number | null)[] = new Array(n).fill(null);
  const minusDMOut: (number | null)[] = new Array(n).fill(null);

  if (n < period + 1) return { adx, plusDI, minusDI, dx, plusDM: plusDMOut, minusDM: minusDMOut };

  // Raw +DM / -DM / TR
  const rawPlusDM: number[] = new Array(n).fill(0);
  const rawMinusDM: number[] = new Array(n).fill(0);
  const rawTR: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const upMove = highs[i]! - highs[i - 1]!;
    const downMove = lows[i - 1]! - lows[i]!;

    rawPlusDM[i] = (upMove > downMove && upMove > 0) ? upMove : 0;
    rawMinusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;

    rawTR[i] = Math.max(
      highs[i]! - lows[i]!,
      Math.abs(highs[i]! - closes[i - 1]!),
      Math.abs(lows[i]! - closes[i - 1]!),
    );
  }

  // Initial sums (first `period` values, starting from index 1)
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;
  let smoothTR = 0;

  for (let i = 1; i <= period; i++) {
    smoothPlusDM += rawPlusDM[i]!;
    smoothMinusDM += rawMinusDM[i]!;
    smoothTR += rawTR[i]!;
  }

  // First DI values at index = period
  let pdi = smoothTR !== 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
  let mdi = smoothTR !== 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
  plusDI[period] = pdi;
  minusDI[period] = mdi;
  plusDMOut[period] = smoothPlusDM;
  minusDMOut[period] = smoothMinusDM;

  let dxVal = (pdi + mdi) !== 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0;
  dx[period] = dxVal;

  let adxSum = dxVal;

  // Continue Wilder smoothing
  for (let i = period + 1; i < n; i++) {
    smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + rawPlusDM[i]!;
    smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + rawMinusDM[i]!;
    smoothTR = smoothTR - (smoothTR / period) + rawTR[i]!;

    pdi = smoothTR !== 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    mdi = smoothTR !== 0 ? (smoothMinusDM / smoothTR) * 100 : 0;

    plusDI[i] = pdi;
    minusDI[i] = mdi;
    plusDMOut[i] = smoothPlusDM;
    minusDMOut[i] = smoothMinusDM;

    dxVal = (pdi + mdi) !== 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0;
    dx[i] = dxVal;

    if (i < 2 * period) {
      adxSum += dxVal;
    }
  }

  // ADX = Wilder smoothed DX, starting at index 2*period - 1
  if (n > 2 * period - 1) {
    let adxVal = adxSum / period;
    adx[2 * period - 1] = adxVal;

    for (let i = 2 * period; i < n; i++) {
      adxVal = (adxVal * (period - 1) + (dx[i] ?? 0)) / period;
      adx[i] = adxVal;
    }
  }

  return { adx, plusDI, minusDI, dx, plusDM: plusDMOut, minusDM: minusDMOut };
}

function calcADXR(adxValues: (number | null)[], period: number): (number | null)[] {
  const n = adxValues.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    if (adxValues[i] !== null && adxValues[i - period] !== null) {
      result[i] = (adxValues[i]! + adxValues[i - period]!) / 2;
    }
  }
  return result;
}

function calcAroon(
  highs: number[], lows: number[], period: number,
): { up: (number | null)[]; down: (number | null)[] } {
  const n = highs.length;
  const up: (number | null)[] = new Array(n).fill(null);
  const down: (number | null)[] = new Array(n).fill(null);

  for (let i = period; i < n; i++) {
    let highIdx = 0;
    let lowIdx = 0;
    let highVal = -Infinity;
    let lowVal = Infinity;

    for (let j = 0; j <= period; j++) {
      const idx = i - period + j;
      if (highs[idx]! >= highVal) { highVal = highs[idx]!; highIdx = j; }
      if (lows[idx]! <= lowVal) { lowVal = lows[idx]!; lowIdx = j; }
    }

    up[i] = (highIdx / period) * 100;
    down[i] = (lowIdx / period) * 100;
  }

  return { up, down };
}

function calcAroonOsc(
  highs: number[], lows: number[], period: number,
): (number | null)[] {
  const { up, down } = calcAroon(highs, lows, period);
  const n = highs.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (up[i] !== null && down[i] !== null) {
      result[i] = up[i]! - down[i]!;
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATISTICS INDICATORS
// ═══════════════════════════════════════════════════════════════════════════════

function calcStdDev(closes: number[], period: number): (number | null)[] {
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

function calcVariance(closes: number[], period: number): (number | null)[] {
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

function calcLinregSlope(closes: number[], period: number): (number | null)[] {
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

function calcLinregAngle(closes: number[], period: number): (number | null)[] {
  const slope = calcLinregSlope(closes, period);
  return slope.map(s => s !== null ? Math.atan(s) * (180 / Math.PI) : null);
}

function calcLinregIntercept(closes: number[], period: number): (number | null)[] {
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

// ═══════════════════════════════════════════════════════════════════════════════
// HILBERT TRANSFORM INDICATORS (subchart)
// ═══════════════════════════════════════════════════════════════════════════════

function calcHTDCPeriod(closes: number[]): (number | null)[] {
  // Simplified approximation: dominant cycle period via autocorrelation
  // Real Hilbert Transform is extremely complex; approximate with windowed cycle detection
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const minPeriod = 6;
  const maxPeriod = 50;
  const window = 50;

  for (let i = window; i < n; i++) {
    let bestCorr = -Infinity;
    let bestPeriod = 20; // default
    for (let p = minPeriod; p <= maxPeriod && i - p >= 0; p++) {
      let corr = 0;
      const count = Math.min(p, i - p);
      for (let j = 0; j < count; j++) {
        corr += (closes[i - j]! - closes[i - p - j]!) ** 2;
      }
      corr = -corr; // minimize squared difference = maximize negative
      if (corr > bestCorr) {
        bestCorr = corr;
        bestPeriod = p;
      }
    }
    result[i] = bestPeriod;
  }
  return result;
}

function calcHTDCPhase(closes: number[]): (number | null)[] {
  // Simplified: phase as position within dominant cycle
  const dcPeriod = calcHTDCPeriod(closes);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (dcPeriod[i] !== null && dcPeriod[i]! > 0) {
      // Find the last peak within the current dominant cycle
      const p = Math.round(dcPeriod[i]!);
      const start = Math.max(0, i - p);
      let peakIdx = start;
      for (let j = start; j <= i; j++) {
        if (closes[j]! >= closes[peakIdx]!) peakIdx = j;
      }
      const phase = ((i - peakIdx) / p) * 360;
      result[i] = phase % 360;
    }
  }
  return result;
}

function calcHTTrendMode(closes: number[]): (number | null)[] {
  // 0 = cycle mode, 1 = trend mode
  // Simplified: use DCPeriod stability as proxy
  const dcPeriod = calcHTDCPeriod(closes);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  const lookback = 10;

  for (let i = lookback; i < n; i++) {
    if (dcPeriod[i] === null) continue;
    // If DC period is stable (low variance), it's in cycle mode
    let sum = 0, count = 0;
    for (let j = i - lookback; j <= i; j++) {
      if (dcPeriod[j] !== null) { sum += dcPeriod[j]!; count++; }
    }
    if (count < 2) continue;
    const mean = sum / count;
    let variance = 0;
    for (let j = i - lookback; j <= i; j++) {
      if (dcPeriod[j] !== null) variance += (dcPeriod[j]! - mean) ** 2;
    }
    variance /= count;
    // High variance in period = trending, low = cycling
    result[i] = variance > 25 ? 1 : 0;
  }
  return result;
}

function calcHTSine(closes: number[]): { sine: (number | null)[]; leadsine: (number | null)[] } {
  const dcPhase = calcHTDCPhase(closes);
  const n = closes.length;
  const sine: (number | null)[] = new Array(n).fill(null);
  const leadsine: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (dcPhase[i] !== null) {
      const rad = (dcPhase[i]! * Math.PI) / 180;
      sine[i] = Math.sin(rad);
      leadsine[i] = Math.sin(rad + Math.PI / 4); // 45 degrees ahead
    }
  }
  return { sine, leadsine };
}

function calcHTPhasor(closes: number[]): { inphase: (number | null)[]; quadrature: (number | null)[] } {
  const dcPhase = calcHTDCPhase(closes);
  const n = closes.length;
  const inphase: (number | null)[] = new Array(n).fill(null);
  const quadrature: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (dcPhase[i] !== null) {
      const rad = (dcPhase[i]! * Math.PI) / 180;
      inphase[i] = Math.cos(rad);
      quadrature[i] = Math.sin(rad);
    }
  }
  return { inphase, quadrature };
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED DISPATCH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute a subchart indicator from raw OHLCV bars.
 *
 * @param column - Display column name (e.g., "RSI_14", "MACD_12_26_9", "ATR_14")
 * @param bars   - OHLCV bars with timestamp in ms or seconds
 * @returns Array of {time, value} points, or null if not computable client-side
 */
export function computeSubchart(
  column: string,
  bars: Bar[],
): IndicatorPoint[] | null {
  if (bars.length === 0) return null;

  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const opens = bars.map(b => b.open);
  const volumes = bars.map(b => b.volume ?? 0);

  const col = column.toUpperCase();
  let values: (number | null)[] | null = null;

  // ── RSI ────────────────────────────────────────────────────────────────────
  const rsiMatch = col.match(/^RSI_(\d+)$/);
  if (rsiMatch) {
    values = calcRSI(closes, parseInt(rsiMatch[1]!));
  }

  // ── MACD family ────────────────────────────────────────────────────────────
  if (!values) {
    const macdMatch = col.match(/^MACD_(\d+)_(\d+)_(\d+)$/);
    if (macdMatch) {
      const r = calcMACD(closes, parseInt(macdMatch[1]!), parseInt(macdMatch[2]!), parseInt(macdMatch[3]!));
      values = r.macd;
    }
  }
  if (!values) {
    const macdsMatch = col.match(/^MACDS_(\d+)_(\d+)_(\d+)$/);
    if (macdsMatch) {
      const r = calcMACD(closes, parseInt(macdsMatch[1]!), parseInt(macdsMatch[2]!), parseInt(macdsMatch[3]!));
      values = r.signal;
    }
  }
  if (!values) {
    const macdhMatch = col.match(/^MACDH_(\d+)_(\d+)_(\d+)$/);
    if (macdhMatch) {
      const r = calcMACD(closes, parseInt(macdhMatch[1]!), parseInt(macdhMatch[2]!), parseInt(macdhMatch[3]!));
      values = r.histogram;
    }
  }

  // ── MACDEXT (same formula, different default MA types — we use EMA for all) ──
  if (!values) {
    const macdextMatch = col.match(/^MACDEXT_(\d+)_(\d+)_(\d+)$/);
    if (macdextMatch) {
      const r = calcMACD(closes, parseInt(macdextMatch[1]!), parseInt(macdextMatch[2]!), parseInt(macdextMatch[3]!));
      values = r.macd;
    }
  }
  if (!values) {
    const macdextsMatch = col.match(/^MACDEXTS_(\d+)_(\d+)_(\d+)$/);
    if (macdextsMatch) {
      const r = calcMACD(closes, parseInt(macdextsMatch[1]!), parseInt(macdextsMatch[2]!), parseInt(macdextsMatch[3]!));
      values = r.signal;
    }
  }
  if (!values) {
    const macdexthMatch = col.match(/^MACDEXTH_(\d+)_(\d+)_(\d+)$/);
    if (macdexthMatch) {
      const r = calcMACD(closes, parseInt(macdexthMatch[1]!), parseInt(macdexthMatch[2]!), parseInt(macdexthMatch[3]!));
      values = r.histogram;
    }
  }

  // ── MACDFIX (close period only, fast=12, slow=26 implied) ──
  if (!values) {
    const macdfixMatch = col.match(/^MACDFIX_(\d+)$/);
    if (macdfixMatch) {
      const r = calcMACD(closes, 12, 26, parseInt(macdfixMatch[1]!));
      values = r.macd;
    }
  }
  if (!values) {
    const macdfixsMatch = col.match(/^MACDFIXS_(\d+)$/);
    if (macdfixsMatch) {
      const r = calcMACD(closes, 12, 26, parseInt(macdfixsMatch[1]!));
      values = r.signal;
    }
  }
  if (!values) {
    const macdfixhMatch = col.match(/^MACDFIXH_(\d+)$/);
    if (macdfixhMatch) {
      const r = calcMACD(closes, 12, 26, parseInt(macdfixhMatch[1]!));
      values = r.histogram;
    }
  }

  // ── Stochastic ─────────────────────────────────────────────────────────────
  if (!values) {
    const stochkMatch = col.match(/^STOCHK_(\d+)_(\d+)_(\d+)$/);
    if (stochkMatch) {
      const r = calcStochastic(highs, lows, closes,
        parseInt(stochkMatch[1]!), parseInt(stochkMatch[2]!), parseInt(stochkMatch[3]!));
      values = r.k;
    }
  }
  if (!values) {
    const stochdMatch = col.match(/^STOCHD_(\d+)_(\d+)_(\d+)$/);
    if (stochdMatch) {
      const r = calcStochastic(highs, lows, closes,
        parseInt(stochdMatch[1]!), parseInt(stochdMatch[2]!), parseInt(stochdMatch[3]!));
      values = r.d;
    }
  }

  // ── Fast Stochastic ────────────────────────────────────────────────────────
  if (!values) {
    const stochfkMatch = col.match(/^STOCHFK_(\d+)_(\d+)$/);
    if (stochfkMatch) {
      const r = calcStochasticFast(highs, lows, closes,
        parseInt(stochfkMatch[1]!), parseInt(stochfkMatch[2]!));
      values = r.k;
    }
  }
  if (!values) {
    const stochfdMatch = col.match(/^STOCHFD_(\d+)_(\d+)$/);
    if (stochfdMatch) {
      const r = calcStochasticFast(highs, lows, closes,
        parseInt(stochfdMatch[1]!), parseInt(stochfdMatch[2]!));
      values = r.d;
    }
  }

  // ── StochRSI ───────────────────────────────────────────────────────────────
  if (!values) {
    const stochrsikMatch = col.match(/^STOCHRSIK_(\d+)_(\d+)_(\d+)_(\d+)$/);
    if (stochrsikMatch) {
      const r = calcStochRSI(closes,
        parseInt(stochrsikMatch[1]!), parseInt(stochrsikMatch[2]!),
        parseInt(stochrsikMatch[3]!), parseInt(stochrsikMatch[4]!));
      values = r.k;
    }
  }
  if (!values) {
    const stochrsidMatch = col.match(/^STOCHRSID_(\d+)_(\d+)_(\d+)_(\d+)$/);
    if (stochrsidMatch) {
      const r = calcStochRSI(closes,
        parseInt(stochrsidMatch[1]!), parseInt(stochrsidMatch[2]!),
        parseInt(stochrsidMatch[3]!), parseInt(stochrsidMatch[4]!));
      values = r.d;
    }
  }

  // ── CCI ────────────────────────────────────────────────────────────────────
  if (!values) {
    const cciMatch = col.match(/^CCI_(\d+)$/);
    if (cciMatch) {
      values = calcCCI(highs, lows, closes, parseInt(cciMatch[1]!));
    }
  }

  // ── Williams %R ────────────────────────────────────────────────────────────
  if (!values) {
    const willrMatch = col.match(/^WILLR_(\d+)$/);
    if (willrMatch) {
      values = calcWilliamsR(highs, lows, closes, parseInt(willrMatch[1]!));
    }
  }

  // ── Momentum ───────────────────────────────────────────────────────────────
  if (!values) {
    const momMatch = col.match(/^MOM_(\d+)$/);
    if (momMatch) {
      values = calcMomentum(closes, parseInt(momMatch[1]!));
    }
  }

  // ── ROC / ROCP / ROCR / ROCR100 ───────────────────────────────────────────
  if (!values) {
    const rocMatch = col.match(/^ROC_(\d+)$/);
    if (rocMatch) {
      values = calcROC(closes, parseInt(rocMatch[1]!));
    }
  }
  if (!values) {
    const rocpMatch = col.match(/^ROCP_(\d+)$/);
    if (rocpMatch) {
      values = calcROCP(closes, parseInt(rocpMatch[1]!));
    }
  }
  if (!values) {
    const rocrMatch = col.match(/^ROCR_(\d+)$/);
    if (rocrMatch) {
      values = calcROCR(closes, parseInt(rocrMatch[1]!));
    }
  }
  if (!values) {
    const rocr100Match = col.match(/^ROCR100_(\d+)$/);
    if (rocr100Match) {
      values = calcROCR100(closes, parseInt(rocr100Match[1]!));
    }
  }

  // ── CMO (Chande Momentum Oscillator) ───────────────────────────────────────
  if (!values) {
    const cmoMatch = col.match(/^CMO_(\d+)$/);
    if (cmoMatch) {
      values = calcCMO(closes, parseInt(cmoMatch[1]!));
    }
  }

  // ── MFI ────────────────────────────────────────────────────────────────────
  if (!values) {
    const mfiMatch = col.match(/^MFI_(\d+)$/);
    if (mfiMatch) {
      values = calcMFI(highs, lows, closes, volumes, parseInt(mfiMatch[1]!));
    }
  }

  // ── APO ────────────────────────────────────────────────────────────────────
  if (!values) {
    const apoMatch = col.match(/^APO_(\d+)_(\d+)$/);
    if (apoMatch) {
      values = calcAPO(closes, parseInt(apoMatch[1]!), parseInt(apoMatch[2]!));
    }
  }

  // ── PPO ────────────────────────────────────────────────────────────────────
  if (!values) {
    const ppoMatch = col.match(/^PPO_(\d+)_(\d+)$/);
    if (ppoMatch) {
      values = calcPPO(closes, parseInt(ppoMatch[1]!), parseInt(ppoMatch[2]!));
    }
  }

  // ── BOP ────────────────────────────────────────────────────────────────────
  if (!values && col === 'BOP') {
    values = calcBOP(opens, highs, lows, closes);
  }

  // ── Ultimate Oscillator ────────────────────────────────────────────────────
  if (!values) {
    const ultoscMatch = col.match(/^ULTOSC_(\d+)_(\d+)_(\d+)$/);
    if (ultoscMatch) {
      values = calcUltimateOscillator(highs, lows, closes,
        parseInt(ultoscMatch[1]!), parseInt(ultoscMatch[2]!), parseInt(ultoscMatch[3]!));
    }
  }

  // ── TRIX ───────────────────────────────────────────────────────────────────
  if (!values) {
    const trixMatch = col.match(/^TRIX_(\d+)$/);
    if (trixMatch) {
      values = calcTRIX(closes, parseInt(trixMatch[1]!));
    }
  }

  // ── True Range ─────────────────────────────────────────────────────────────
  if (!values && col === 'TRANGE') {
    values = calcTrueRange(highs, lows, closes);
  }

  // ── ATR ────────────────────────────────────────────────────────────────────
  if (!values) {
    const atrMatch = col.match(/^ATR_(\d+)$/);
    if (atrMatch) {
      values = calcATR(highs, lows, closes, parseInt(atrMatch[1]!));
    }
  }

  // ── NATR ───────────────────────────────────────────────────────────────────
  if (!values) {
    const natrMatch = col.match(/^NATR_(\d+)$/);
    if (natrMatch) {
      values = calcNATR(highs, lows, closes, parseInt(natrMatch[1]!));
    }
  }

  // ── OBV ────────────────────────────────────────────────────────────────────
  if (!values && col === 'OBV') {
    values = calcOBV(closes, volumes);
  }

  // ── AD (Accumulation/Distribution) ─────────────────────────────────────────
  if (!values && col === 'AD') {
    values = calcAD(highs, lows, closes, volumes);
  }

  // ── ADOSC ──────────────────────────────────────────────────────────────────
  if (!values) {
    const adoscMatch = col.match(/^ADOSC_(\d+)_(\d+)$/);
    if (adoscMatch) {
      values = calcADOSC(highs, lows, closes, volumes,
        parseInt(adoscMatch[1]!), parseInt(adoscMatch[2]!));
    }
  }

  // ── ADX ────────────────────────────────────────────────────────────────────
  if (!values) {
    const adxMatch = col.match(/^ADX_(\d+)$/);
    if (adxMatch) {
      const r = calcDirectionalMovement(highs, lows, closes, parseInt(adxMatch[1]!));
      values = r.adx;
    }
  }

  // ── ADXR ───────────────────────────────────────────────────────────────────
  if (!values) {
    const adxrMatch = col.match(/^ADXR_(\d+)$/);
    if (adxrMatch) {
      const period = parseInt(adxrMatch[1]!);
      const r = calcDirectionalMovement(highs, lows, closes, period);
      values = calcADXR(r.adx, period);
    }
  }

  // ── DX ─────────────────────────────────────────────────────────────────────
  if (!values) {
    const dxMatch = col.match(/^DX_(\d+)$/);
    if (dxMatch) {
      const r = calcDirectionalMovement(highs, lows, closes, parseInt(dxMatch[1]!));
      values = r.dx;
    }
  }

  // ── PLUS_DI / MINUS_DI ────────────────────────────────────────────────────
  if (!values) {
    const plusDiMatch = col.match(/^PLUS_DI_(\d+)$/);
    if (plusDiMatch) {
      const r = calcDirectionalMovement(highs, lows, closes, parseInt(plusDiMatch[1]!));
      values = r.plusDI;
    }
  }
  if (!values) {
    const minusDiMatch = col.match(/^MINUS_DI_(\d+)$/);
    if (minusDiMatch) {
      const r = calcDirectionalMovement(highs, lows, closes, parseInt(minusDiMatch[1]!));
      values = r.minusDI;
    }
  }

  // ── PLUS_DM / MINUS_DM ────────────────────────────────────────────────────
  if (!values) {
    const plusDmMatch = col.match(/^PLUS_DM_(\d+)$/);
    if (plusDmMatch) {
      const r = calcDirectionalMovement(highs, lows, closes, parseInt(plusDmMatch[1]!));
      values = r.plusDM;
    }
  }
  if (!values) {
    const minusDmMatch = col.match(/^MINUS_DM_(\d+)$/);
    if (minusDmMatch) {
      const r = calcDirectionalMovement(highs, lows, closes, parseInt(minusDmMatch[1]!));
      values = r.minusDM;
    }
  }

  // ── Aroon ──────────────────────────────────────────────────────────────────
  if (!values) {
    const aroonUpMatch = col.match(/^AROON_UP_(\d+)$/);
    if (aroonUpMatch) {
      const r = calcAroon(highs, lows, parseInt(aroonUpMatch[1]!));
      values = r.up;
    }
  }
  if (!values) {
    const aroonDownMatch = col.match(/^AROON_DOWN_(\d+)$/);
    if (aroonDownMatch) {
      const r = calcAroon(highs, lows, parseInt(aroonDownMatch[1]!));
      values = r.down;
    }
  }

  // ── Aroon Oscillator ──────────────────────────────────────────────────────
  if (!values) {
    const aroonoscMatch = col.match(/^AROONOSC_(\d+)$/);
    if (aroonoscMatch) {
      values = calcAroonOsc(highs, lows, parseInt(aroonoscMatch[1]!));
    }
  }

  // ── STDEV / VAR ────────────────────────────────────────────────────────────
  if (!values) {
    const stdevMatch = col.match(/^STDEV_(\d+)$/);
    if (stdevMatch) {
      values = calcStdDev(closes, parseInt(stdevMatch[1]!));
    }
  }
  if (!values) {
    const varMatch = col.match(/^VAR_(\d+)$/);
    if (varMatch) {
      values = calcVariance(closes, parseInt(varMatch[1]!));
    }
  }

  // ── Linear Regression Slope / Angle / Intercept ────────────────────────────
  if (!values) {
    const lrsMatch = col.match(/^LINREG_SLOPE_(\d+)$/);
    if (lrsMatch) {
      values = calcLinregSlope(closes, parseInt(lrsMatch[1]!));
    }
  }
  if (!values) {
    const lraMatch = col.match(/^LINREG_ANGLE_(\d+)$/);
    if (lraMatch) {
      values = calcLinregAngle(closes, parseInt(lraMatch[1]!));
    }
  }
  if (!values) {
    const lriMatch = col.match(/^LINREG_INTERCEPT_(\d+)$/);
    if (lriMatch) {
      values = calcLinregIntercept(closes, parseInt(lriMatch[1]!));
    }
  }

  // ── Hilbert Transform subchart indicators ──────────────────────────────────
  if (!values && col === 'HT_DCPERIOD') {
    values = calcHTDCPeriod(closes);
  }
  if (!values && col === 'HT_DCPHASE') {
    values = calcHTDCPhase(closes);
  }
  if (!values && col === 'HT_TRENDMODE') {
    values = calcHTTrendMode(closes);
  }
  if (!values && col === 'HT_SINE_SINE') {
    const r = calcHTSine(closes);
    values = r.sine;
  }
  if (!values && col === 'HT_SINE_LEADSINE') {
    const r = calcHTSine(closes);
    values = r.leadsine;
  }
  if (!values && col === 'HT_PHASOR_INPHASE') {
    const r = calcHTPhasor(closes);
    values = r.inphase;
  }
  if (!values && col === 'HT_PHASOR_QUADRATURE') {
    const r = calcHTPhasor(closes);
    values = r.quadrature;
  }

  // ── Not recognized ─────────────────────────────────────────────────────────
  if (!values) return null;

  const points = toPoints(values, bars);
  return points.length > 0 ? points : null;
}
