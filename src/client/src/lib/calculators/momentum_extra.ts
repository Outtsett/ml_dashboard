/**
 * Extended momentum indicators computed client-side from raw OHLCV data.
 *
 * Every function returns IndicatorPoint[] (single output) or a named object
 * of IndicatorPoint[] arrays (multi-output). All math is pure TypeScript —
 * no external dependencies.
 */

import type { Bar, IndicatorPoint } from './math_primitives';
import {
  sma,
  ema,
  wma,
  wilderSmooth,
  rollingMax,
  rollingMin,
  rollingSum,
  stddev,
  trueRange,
  medianPrice,
  toPoints,
  gains,
  losses,
  roc,
  linregCore,
  percentRank,
} from './math_primitives';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Compute RSI from a value array. Returns null-padded array. */
function rsiFromValues(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1 || period < 1) return result;
  const g = gains(values);
  const l = losses(values);
  const avgGain = wilderSmooth(g, period);
  const avgLoss = wilderSmooth(l, period);
  for (let i = 0; i < n; i++) {
    const ag = avgGain[i]!;
    const al = avgLoss[i]!;
    if (ag == null || al == null) continue;
    if (al === 0) {
      result[i] = ag === 0 ? 50 : 100;
    } else {
      result[i] = 100 - 100 / (1 + ag / al);
    }
  }
  return result;
}

/** Extract non-null numbers from null-padded array, filling nulls with 0. */
function fillNulls(arr: (number | null)[]): number[] {
  return arr.map(v => v ?? 0);
}

// ─── Indicators ─────────────────────────────────────────────────────────────

/**
 * Awesome Oscillator: SMA(medianPrice, fast) - SMA(medianPrice, slow).
 * Measures market momentum using the difference between fast and slow SMAs
 * of the bar midpoint.
 */
export function calcAO(
  bars: Bar[],
  fastPeriod = 5,
  slowPeriod = 34,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const mp = medianPrice(bars);
  const fast = sma(mp, fastPeriod);
  const slow = sma(mp, slowPeriod);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fast[i] != null && slow[i] != null) {
      result[i] = fast[i]! - slow[i]!;
    }
  }
  return toPoints(result, bars);
}

/**
 * Bias: percentage deviation of close from its SMA.
 * Formula: (close - SMA(close, period)) / SMA(close, period) * 100
 */
export function calcBias(bars: Bar[], period = 26): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const ma = sma(closes, period);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const m = ma[i]!;
    if (m != null && m !== 0) {
      result[i] = ((closes[i]! - m) / m) * 100;
    }
  }
  return toPoints(result, bars);
}

/**
 * Chande Forecast Oscillator: 100 * (close - linearForecast) / close.
 * Linear forecast = linreg intercept + linreg slope * period.
 */
export function calcCFO(bars: Bar[], period = 9): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const { slope, intercept } = linregCore(closes, period);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const s = slope[i]!;
    const b = intercept[i]!;
    const c = closes[i]!;
    if (s != null && b != null && c !== 0) {
      const forecast = b + s * period;
      result[i] = 100 * (c - forecast) / c;
    }
  }
  return toPoints(result, bars);
}

/**
 * Center of Gravity: -sum(close[i]*(i+1)) / sum(close[i]) over a rolling window.
 * Ehlers' CG oscillator — leads price turns.
 */
export function calcCG(bars: Bar[], period = 10): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period || period < 1) return toPoints(result, bars);
  for (let i = period - 1; i < n; i++) {
    let numSum = 0;
    let denomSum = 0;
    for (let j = 0; j < period; j++) {
      const val = closes[i - j]!;
      numSum += val * (j + 1);
      denomSum += val;
    }
    if (denomSum !== 0) {
      result[i] = -numSum / denomSum;
    }
  }
  return toPoints(result, bars);
}

/**
 * Coppock Curve: WMA of (ROC(close, roc1) + ROC(close, roc2)) over wmaP.
 * Originally designed as a monthly long-term buy signal.
 */
export function calcCoppock(
  bars: Bar[],
  wmaP = 10,
  roc1 = 14,
  roc2 = 11,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const r1 = roc(closes, roc1);
  const r2 = roc(closes, roc2);
  const n = closes.length;
  const combined: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    combined[i] = (r1[i] ?? 0) + (r2[i] ?? 0);
  }
  const w = wma(combined, wmaP);
  // Only emit where both ROCs are valid
  const minOffset = Math.max(roc1, roc2);
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i >= minOffset + wmaP - 1 && w[i] != null) {
      result[i] = w[i]!;
    }
  }
  return toPoints(result, bars);
}

/**
 * Connors RSI: (RSI(close, rsiP) + RSI(streak, streakP) + percentRank(close, rankP)) / 3.
 * streak = consecutive up bars positive, consecutive down bars negative.
 */
export function calcCRSI(
  bars: Bar[],
  rsiP = 3,
  streakP = 2,
  rankP = 100,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;

  // Build streak series
  const streak: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (closes[i]! > closes[i - 1]!) {
      streak[i] = streak[i - 1]! > 0 ? streak[i - 1]! + 1 : 1;
    } else if (closes[i]! < closes[i - 1]!) {
      streak[i] = streak[i - 1]! < 0 ? streak[i - 1]! - 1 : -1;
    } else {
      streak[i] = 0;
    }
  }

  const rsiClose = rsiFromValues(closes, rsiP);
  const rsiStreak = rsiFromValues(streak, streakP);
  const pRank = percentRank(closes, rankP);

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const rc = rsiClose[i]!;
    const rs = rsiStreak[i]!;
    const pr = pRank[i]!;
    if (rc != null && rs != null && pr != null) {
      result[i] = (rc + rs + pr) / 3;
    }
  }
  return toPoints(result, bars);
}

/**
 * Kaufman Efficiency Ratio: abs(close - close[period]) / sum(abs(close[i] - close[i-1])).
 * Ranges 0..1. High = trending, low = choppy.
 */
export function calcER(bars: Bar[], period = 10): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1 || period < 1) return toPoints(result, bars);
  for (let i = period; i < n; i++) {
    const direction = Math.abs(closes[i]! - closes[i - period]!);
    let volatility = 0;
    for (let j = i - period + 1; j <= i; j++) {
      volatility += Math.abs(closes[j]! - closes[j - 1]!);
    }
    result[i] = volatility !== 0 ? direction / volatility : 0;
  }
  return toPoints(result, bars);
}

/**
 * Fisher Transform: 0.5 * ln((1+x)/(1-x)) of normalized HL midpoint.
 * Returns fisher line and its 1-bar lagged trigger.
 */
export function calcFisher(
  bars: Bar[],
  period = 9,
): { fisher: IndicatorPoint[]; trigger: IndicatorPoint[] } {
  const empty = { fisher: [] as IndicatorPoint[], trigger: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const n = bars.length;
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const hl2 = bars.map(b => (b.high + b.low) / 2);

  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);

  const fisherArr: (number | null)[] = new Array(n).fill(null);
  const triggerArr: (number | null)[] = new Array(n).fill(null);

  let prevValue = 0;
  let prevFisher = 0;

  for (let i = 0; i < n; i++) {
    if (hh[i] == null || ll[i] == null) continue;
    const maxH = hh[i]!;
    const minL = ll[i]!;
    const range = maxH - minL;
    let x: number;
    if (range === 0) {
      x = 0;
    } else {
      x = 2 * ((hl2[i]! - minL) / range) - 1;
    }
    // Clamp to prevent log of zero/negative
    x = Math.max(-0.999, Math.min(0.999, x));
    // Smooth
    const value = 0.5 * (x + prevValue);
    const clampedValue = Math.max(-0.999, Math.min(0.999, value));
    const fisher = 0.5 * Math.log((1 + clampedValue) / (1 - clampedValue)) + 0.5 * prevFisher;

    fisherArr[i] = fisher;
    triggerArr[i] = prevFisher;

    prevValue = value;
    prevFisher = fisher;
  }

  return {
    fisher: toPoints(fisherArr, bars),
    trigger: toPoints(triggerArr, bars),
  };
}

/**
 * Inertia: Linear regression of RVI (Relative Volatility Index based on stddev) over period.
 * Measures the persistence of the volatility trend.
 */
export function calcInertia(
  bars: Bar[],
  period = 20,
  rviPeriod = 14,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;

  // RVI: RSI applied to stddev(close, rviPeriod) instead of close
  const sd = stddev(closes, rviPeriod);
  const sdFilled = fillNulls(sd);
  const rviValues = rsiFromValues(sdFilled, rviPeriod);

  // Linear regression of RVI over period
  const rviFilled = fillNulls(rviValues);
  const { slope, intercept } = linregCore(rviFilled, period);
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (slope[i] != null && intercept[i] != null && rviValues[i] != null) {
      result[i] = intercept[i]! + slope[i]! * (period - 1);
    }
  }
  return toPoints(result, bars);
}

/**
 * Know Sure Thing (KST): Weighted sum of 4 smoothed ROCs.
 * ROC weights: 1, 2, 3, 4. Signal = SMA(KST, signalP).
 */
export function calcKST(
  bars: Bar[],
  roc1 = 10,
  roc2 = 15,
  roc3 = 20,
  roc4 = 30,
  sma1 = 10,
  sma2 = 10,
  sma3 = 10,
  sma4 = 15,
  signalP = 9,
): { kst: IndicatorPoint[]; signal: IndicatorPoint[] } {
  const empty = { kst: [] as IndicatorPoint[], signal: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const n = closes.length;

  const r1 = fillNulls(roc(closes, roc1));
  const r2 = fillNulls(roc(closes, roc2));
  const r3 = fillNulls(roc(closes, roc3));
  const r4 = fillNulls(roc(closes, roc4));

  const s1 = sma(r1, sma1);
  const s2 = sma(r2, sma2);
  const s3 = sma(r3, sma3);
  const s4 = sma(r4, sma4);

  const kstArr: (number | null)[] = new Array(n).fill(null);
  const minReq = Math.max(roc1 + sma1, roc2 + sma2, roc3 + sma3, roc4 + sma4) - 1;
  for (let i = 0; i < n; i++) {
    if (i >= minReq && s1[i] != null && s2[i] != null && s3[i] != null && s4[i] != null) {
      kstArr[i] = 1 * s1[i]! + 2 * s2[i]! + 3 * s3[i]! + 4 * s4[i]!;
    }
  }

  const kstFilled = fillNulls(kstArr);
  const sig = sma(kstFilled, signalP);
  // Only emit signal where kst is valid
  const sigResult: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (kstArr[i] != null && sig[i] != null && i >= minReq + signalP - 1) {
      sigResult[i] = sig[i]!;
    }
  }

  return {
    kst: toPoints(kstArr, bars),
    signal: toPoints(sigResult, bars),
  };
}

/**
 * Pretty Good Oscillator: (close - SMA(close, period)) / EMA(trueRange, period).
 * Measures price deviation from its average in volatility units.
 */
export function calcPGO(bars: Bar[], period = 14): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const tr = trueRange(bars);
  const ma = sma(closes, period);
  const atr = ema(tr, period);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const m = ma[i]!;
    const a = atr[i]!;
    if (m != null && a != null && a !== 0) {
      result[i] = (closes[i]! - m) / a;
    }
  }
  return toPoints(result, bars);
}

/**
 * Psychological Line: percentage of up-bars in a rolling window.
 * 100 * count(close > prev_close) / period.
 */
export function calcPSL(bars: Bar[], period = 12): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  // Build up/down array: 1 if close > prev close, 0 otherwise
  const ups: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (closes[i]! > closes[i - 1]!) ups[i] = 1;
  }
  const sumUps = rollingSum(ups, period);
  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (sumUps[i] != null) {
      result[i] = (sumUps[i]! / period) * 100;
    }
  }
  return toPoints(result, bars);
}

/**
 * Quantitative Qualitative Estimation (QQE).
 * Smoothed RSI with dynamic Wilder-smoothed ATR-style bands.
 * Returns qqe line, smoothed RSI, and upper/lower bands.
 */
export function calcQQE(
  bars: Bar[],
  rsiPeriod = 14,
  smoothFactor = 5,
  qqeFactor = 4.236,
): { qqe: IndicatorPoint[]; rsiSmooth: IndicatorPoint[]; upper: IndicatorPoint[]; lower: IndicatorPoint[] } {
  const empty = {
    qqe: [] as IndicatorPoint[],
    rsiSmooth: [] as IndicatorPoint[],
    upper: [] as IndicatorPoint[],
    lower: [] as IndicatorPoint[],
  };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const n = closes.length;

  // Step 1: RSI
  const rsiArr = rsiFromValues(closes, rsiPeriod);

  // Step 2: Smooth RSI with EMA
  const rsiFilled = fillNulls(rsiArr);
  const rsiSmooth = ema(rsiFilled, smoothFactor);

  // Step 3: Absolute difference of smoothed RSI
  const rsiSmoothFilled = fillNulls(rsiSmooth);
  const absDiff: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    absDiff[i] = Math.abs(rsiSmoothFilled[i]! - rsiSmoothFilled[i - 1]!);
  }

  // Step 4: Wilder smooth the absolute difference
  const atrRsi = wilderSmooth(absDiff, rsiPeriod * 2 - 1);
  // Double smooth
  const atrRsiFilled = fillNulls(atrRsi);
  const maAtrRsi = wilderSmooth(atrRsiFilled, rsiPeriod * 2 - 1);

  // Step 5: Dynamic bands
  const qqeArr: (number | null)[] = new Array(n).fill(null);
  const upperArr: (number | null)[] = new Array(n).fill(null);
  const lowerArr: (number | null)[] = new Array(n).fill(null);

  let longBand = 0;
  let shortBand = 0;
  let prevTrend = 0;

  for (let i = 0; i < n; i++) {
    if (rsiSmooth[i] == null || maAtrRsi[i] == null) continue;
    const rs = rsiSmooth[i]!;
    const dar = maAtrRsi[i]! * qqeFactor;

    const newShortBand = rs + dar;
    const newLongBand = rs - dar;

    if (i > 0 && rsiSmooth[i - 1] != null) {
      const prevRs = rsiSmooth[i - 1]!;
      if (prevRs > longBand && rs > longBand) {
        longBand = Math.max(longBand, newLongBand);
      } else {
        longBand = newLongBand;
      }
      if (prevRs < shortBand && rs < shortBand) {
        shortBand = Math.min(shortBand, newShortBand);
      } else {
        shortBand = newShortBand;
      }
    } else {
      longBand = newLongBand;
      shortBand = newShortBand;
    }

    let trend: number;
    if (rs > shortBand) {
      trend = 1;
    } else if (rs < longBand) {
      trend = -1;
    } else {
      trend = prevTrend;
    }

    const qqeLine = trend === 1 ? longBand : shortBand;
    qqeArr[i] = qqeLine;
    upperArr[i] = shortBand;
    lowerArr[i] = longBand;

    prevTrend = trend;
  }

  return {
    qqe: toPoints(qqeArr, bars),
    rsiSmooth: toPoints(rsiSmooth, bars),
    upper: toPoints(upperArr, bars),
    lower: toPoints(lowerArr, bars),
  };
}

/**
 * Relative Vigor Index: SMA of (close-open)/(high-low).
 * Signal = 4-period symmetrically weighted MA of RVGI.
 */
export function calcRVGI(
  bars: Bar[],
  period = 10,
  signalP = 4,
): { rvgi: IndicatorPoint[]; signal: IndicatorPoint[] } {
  const empty = { rvgi: [] as IndicatorPoint[], signal: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const n = bars.length;

  // Numerator: close - open, Denominator: high - low
  const num: number[] = new Array(n).fill(0);
  const den: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    num[i] = bars[i]!.close - bars[i]!.open;
    const hl = bars[i]!.high - bars[i]!.low;
    den[i] = hl === 0 ? 1e-10 : hl;
  }

  // Use symmetrical weighting (1,2,2,1)/6 for smoothing — then SMA
  const smoothNum: number[] = new Array(n).fill(0);
  const smoothDen: number[] = new Array(n).fill(0);
  for (let i = 3; i < n; i++) {
    smoothNum[i] = (num[i]! + 2 * num[i - 1]! + 2 * num[i - 2]! + num[i - 3]!) / 6;
    smoothDen[i] = (den[i]! + 2 * den[i - 1]! + 2 * den[i - 2]! + den[i - 3]!) / 6;
  }

  // SMA of ratio
  const ratio: number[] = new Array(n).fill(0);
  for (let i = 3; i < n; i++) {
    ratio[i] = smoothDen[i] !== 0 ? smoothNum[i]! / smoothDen[i]! : 0;
  }
  const rvgiArr = sma(ratio, period);

  // Signal: symmetrical weighting of RVGI (1,2,2,1)/6
  const rvgiFilled = fillNulls(rvgiArr);
  const sigArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 3; i < n; i++) {
    if (rvgiArr[i] != null && rvgiArr[i - 1] != null && rvgiArr[i - 2] != null && rvgiArr[i - 3] != null) {
      sigArr[i] = (rvgiFilled[i]! + 2 * rvgiFilled[i - 1]! + 2 * rvgiFilled[i - 2]! + rvgiFilled[i - 3]!) / 6;
    }
  }

  return {
    rvgi: toPoints(rvgiArr, bars),
    signal: toPoints(sigArr, bars),
  };
}

/**
 * Schaff Trend Cycle: Double-smoothed stochastic of MACD line.
 * Combines MACD with stochastic for faster cycle detection.
 */
export function calcSTC(
  bars: Bar[],
  period = 10,
  fastP = 23,
  slowP = 50,
): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;

  // MACD line
  const fastEma = ema(closes, fastP);
  const slowEma = ema(closes, slowP);
  const macdLine: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (fastEma[i] != null && slowEma[i] != null) {
      macdLine[i] = fastEma[i]! - slowEma[i]!;
    }
  }

  // First stochastic smoothing of MACD
  const macdHH = rollingMax(macdLine, period);
  const macdLL = rollingMin(macdLine, period);

  const pf: number[] = new Array(n).fill(0);
  let prevPf = 0;
  for (let i = 0; i < n; i++) {
    if (macdHH[i] == null || macdLL[i] == null) continue;
    const range = macdHH[i]! - macdLL[i]!;
    const fastK = range !== 0 ? ((macdLine[i]! - macdLL[i]!) / range) * 100 : prevPf;
    // Smooth with factor 0.5
    prevPf = prevPf + 0.5 * (fastK - prevPf);
    pf[i] = prevPf;
  }

  // Second stochastic smoothing of PF
  const pfHH = rollingMax(pf, period);
  const pfLL = rollingMin(pf, period);

  const stcArr: (number | null)[] = new Array(n).fill(null);
  let prevStc = 0;
  for (let i = 0; i < n; i++) {
    if (pfHH[i] == null || pfLL[i] == null) continue;
    const range = pfHH[i]! - pfLL[i]!;
    const fastK = range !== 0 ? ((pf[i]! - pfLL[i]!) / range) * 100 : prevStc;
    prevStc = prevStc + 0.5 * (fastK - prevStc);
    stcArr[i] = prevStc;
  }

  return toPoints(stcArr, bars);
}

/**
 * True Strength Index: 100 * EMA(EMA(momentum, longP), shortP) / EMA(EMA(|momentum|, longP), shortP).
 * Signal = EMA(TSI, signalP).
 */
export function calcTSI(
  bars: Bar[],
  longP = 25,
  shortP = 13,
  signalP = 13,
): { tsi: IndicatorPoint[]; signal: IndicatorPoint[] } {
  const empty = { tsi: [] as IndicatorPoint[], signal: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const n = closes.length;

  // Momentum: close - prev close
  const mom: number[] = new Array(n).fill(0);
  const absMom: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    mom[i] = closes[i]! - closes[i - 1]!;
    absMom[i] = Math.abs(mom[i]!);
  }

  // Double EMA of momentum
  const ema1Mom = ema(mom, longP);
  const ema2Mom = ema(fillNulls(ema1Mom), shortP);

  // Double EMA of |momentum|
  const ema1Abs = ema(absMom, longP);
  const ema2Abs = ema(fillNulls(ema1Abs), shortP);

  const tsiArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const num = ema2Mom[i]!;
    const den = ema2Abs[i]!;
    if (num != null && den != null && den !== 0) {
      tsiArr[i] = 100 * num / den;
    }
  }

  const tsiFilled = fillNulls(tsiArr);
  const sigArr = ema(tsiFilled, signalP);
  // Only emit signal where TSI is valid
  const sigResult: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (tsiArr[i] != null && sigArr[i] != null) {
      sigResult[i] = sigArr[i]!;
    }
  }

  return {
    tsi: toPoints(tsiArr, bars),
    signal: toPoints(sigResult, bars),
  };
}

/**
 * Stochastic Momentum Index: 100 * EMA(EMA(close - midHL, smoothP), smoothP) /
 * (0.5 * EMA(EMA(HH-LL, smoothP), smoothP)).
 * Signal = EMA(SMI, signalP).
 */
export function calcSMI(
  bars: Bar[],
  period = 14,
  smoothP = 3,
  signalP = 3,
): { smi: IndicatorPoint[]; signal: IndicatorPoint[] } {
  const empty = { smi: [] as IndicatorPoint[], signal: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const n = bars.length;

  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);

  const diffArr: number[] = new Array(n).fill(0);
  const rangeArr: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (hh[i] != null && ll[i] != null) {
      diffArr[i] = closes[i]! - (hh[i]! + ll[i]!) / 2;
      rangeArr[i] = hh[i]! - ll[i]!;
    }
  }

  // Double smooth diff and range
  const smoothDiff1 = ema(diffArr, smoothP);
  const smoothDiff2 = ema(fillNulls(smoothDiff1), smoothP);
  const smoothRange1 = ema(rangeArr, smoothP);
  const smoothRange2 = ema(fillNulls(smoothRange1), smoothP);

  const smiArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const d = smoothDiff2[i]!;
    const r = smoothRange2[i]!;
    if (d != null && r != null && r !== 0) {
      smiArr[i] = 100 * d / (0.5 * r);
    }
  }

  const smiFilled = fillNulls(smiArr);
  const sig = ema(smiFilled, signalP);
  const sigResult: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (smiArr[i] != null && sig[i] != null) {
      sigResult[i] = sig[i]!;
    }
  }

  return {
    smi: toPoints(smiArr, bars),
    signal: toPoints(sigResult, bars),
  };
}

/**
 * Squeeze Momentum: Detects when Bollinger Bands are inside Keltner Channels (low volatility).
 * momentum = linear regression of (close - (bbMiddle + kcMiddle)/2) over kcP.
 * squeeze = 1 when BB inside KC, 0 otherwise.
 */
export function calcSqueeze(
  bars: Bar[],
  bbP = 20,
  bbMult = 2,
  kcP = 20,
  kcMult = 1.5,
): { momentum: IndicatorPoint[]; squeeze: IndicatorPoint[] } {
  const empty = { momentum: [] as IndicatorPoint[], squeeze: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const tr = trueRange(bars);
  const n = bars.length;

  // Bollinger Bands
  const bbMid = sma(closes, bbP);
  const bbStd = stddev(closes, bbP);

  // Keltner Channel
  const kcMid = ema(closes, kcP);
  const atr = wilderSmooth(tr, kcP);

  const squeezeArr: (number | null)[] = new Array(n).fill(null);
  const delta: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    if (bbMid[i] == null || bbStd[i] == null || kcMid[i] == null || atr[i] == null) continue;

    const bbUpper = bbMid[i]! + bbMult * bbStd[i]!;
    const bbLower = bbMid[i]! - bbMult * bbStd[i]!;
    const kcUpper = kcMid[i]! + kcMult * atr[i]!;
    const kcLower = kcMid[i]! - kcMult * atr[i]!;

    // Squeeze on when BB is inside KC
    squeezeArr[i] = (bbLower > kcLower && bbUpper < kcUpper) ? 1 : 0;

    // Delta for momentum linreg
    delta[i] = closes[i]! - (bbMid[i]! + kcMid[i]!) / 2;
  }

  // Linear regression of delta
  const { slope, intercept } = linregCore(delta, kcP);
  const momArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (slope[i] != null && intercept[i] != null && squeezeArr[i] != null) {
      momArr[i] = intercept[i]! + slope[i]! * (kcP - 1);
    }
  }

  return {
    momentum: toPoints(momArr, bars),
    squeeze: toPoints(squeezeArr, bars),
  };
}

/**
 * Squeeze Pro: 3-level squeeze using narrow/normal/wide Keltner Channels.
 * squeeze = 0 (no squeeze), 1 (wide KC squeeze), 2 (normal KC squeeze), 3 (narrow KC squeeze).
 */
export function calcSqueezePro(
  bars: Bar[],
  bbP = 20,
  bbMult = 2,
  kcPn = 20,
  kcMultN = 1,
  kcMultM = 1.5,
  kcMultW = 2,
): { momentum: IndicatorPoint[]; squeeze: IndicatorPoint[] } {
  const empty = { momentum: [] as IndicatorPoint[], squeeze: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const closes = bars.map(b => b.close);
  const tr = trueRange(bars);
  const n = bars.length;

  const bbMid = sma(closes, bbP);
  const bbStd = stddev(closes, bbP);
  const kcMid = ema(closes, kcPn);
  const atr = wilderSmooth(tr, kcPn);

  const squeezeArr: (number | null)[] = new Array(n).fill(null);
  const delta: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    if (bbMid[i] == null || bbStd[i] == null || kcMid[i] == null || atr[i] == null) continue;

    const bbUpper = bbMid[i]! + bbMult * bbStd[i]!;
    const bbLower = bbMid[i]! - bbMult * bbStd[i]!;

    const kcUpperN = kcMid[i]! + kcMultN * atr[i]!;
    const kcLowerN = kcMid[i]! - kcMultN * atr[i]!;
    const kcUpperM = kcMid[i]! + kcMultM * atr[i]!;
    const kcLowerM = kcMid[i]! - kcMultM * atr[i]!;
    const kcUpperW = kcMid[i]! + kcMultW * atr[i]!;
    const kcLowerW = kcMid[i]! - kcMultW * atr[i]!;

    // 3 = narrow squeeze (tightest), 2 = normal, 1 = wide, 0 = no squeeze
    if (bbLower > kcLowerN && bbUpper < kcUpperN) {
      squeezeArr[i] = 3;
    } else if (bbLower > kcLowerM && bbUpper < kcUpperM) {
      squeezeArr[i] = 2;
    } else if (bbLower > kcLowerW && bbUpper < kcUpperW) {
      squeezeArr[i] = 1;
    } else {
      squeezeArr[i] = 0;
    }

    delta[i] = closes[i]! - (bbMid[i]! + kcMid[i]!) / 2;
  }

  const { slope, intercept } = linregCore(delta, kcPn);
  const momArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (slope[i] != null && intercept[i] != null && squeezeArr[i] != null) {
      momArr[i] = intercept[i]! + slope[i]! * (kcPn - 1);
    }
  }

  return {
    momentum: toPoints(momArr, bars),
    squeeze: toPoints(squeezeArr, bars),
  };
}

/**
 * KDJ: Extended stochastic with J line = 3*K - 2*D.
 * K = SMA of raw %K, D = SMA of K, J = 3K - 2D.
 */
export function calcKDJ(
  bars: Bar[],
  period = 9,
  signalP = 3,
): { k: IndicatorPoint[]; d: IndicatorPoint[]; j: IndicatorPoint[] } {
  const empty = { k: [] as IndicatorPoint[], d: [] as IndicatorPoint[], j: [] as IndicatorPoint[] };
  if (bars.length === 0) return empty;
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);
  const n = bars.length;

  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);

  // Raw %K
  const rawK: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (hh[i] != null && ll[i] != null) {
      const range = hh[i]! - ll[i]!;
      rawK[i] = range !== 0 ? ((closes[i]! - ll[i]!) / range) * 100 : 50;
    }
  }

  // K = SMA of rawK
  const kArr = sma(rawK, signalP);
  // D = SMA of K
  const kFilled = fillNulls(kArr);
  const dArr = sma(kFilled, signalP);

  // J = 3K - 2D
  const jArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (kArr[i] != null && dArr[i] != null) {
      jArr[i] = 3 * kArr[i]! - 2 * dArr[i]!;
    }
  }

  return {
    k: toPoints(kArr, bars),
    d: toPoints(dArr, bars),
    j: toPoints(jArr, bars),
  };
}

/**
 * Williams Accumulation/Distribution: Cumulative sum of TRH/TRL-weighted close changes.
 * AD = prev_AD + (close > prev_close ? close - TRL : close < prev_close ? close - TRH : 0)
 * where TRH = max(high, prev_close), TRL = min(low, prev_close).
 */
export function calcWAD(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);
  let wad = 0;
  result[0] = 0;
  for (let i = 1; i < n; i++) {
    const close = bars[i]!.close;
    const prevClose = bars[i - 1]!.close;
    const trh = Math.max(bars[i]!.high, prevClose);
    const trl = Math.min(bars[i]!.low, prevClose);
    if (close > prevClose) {
      wad += close - trl;
    } else if (close < prevClose) {
      wad += close - trh;
    }
    // If close == prevClose, wad unchanged
    result[i] = wad;
  }
  return toPoints(result, bars);
}

/**
 * RSX: Jurik-style smoothed RSI using double-smoothed exponential filtering.
 * Produces a smoother, less lagging version of RSI.
 */
export function calcRSX(bars: Bar[], period = 14): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < 2) return toPoints(result, bars);

  // RSX uses a multi-stage smoothing approach
  const f10 = Math.ceil(Math.sqrt(period));
  const f18 = 3 / (period + 2);
  const f20 = 1 - f18;

  let f28 = 0, f30 = 0;
  let f38 = 0, f40 = 0, f48 = 0, f50 = 0;
  let f58 = 0, f60 = 0, f68 = 0, f70 = 0;
  let f78 = 0, f80 = 0;

  for (let i = 0; i < n; i++) {
    if (i === 0) {
      f28 = 0;
      f30 = 0;
      continue;
    }

    const mom = closes[i]! - closes[i - 1]!;
    const momAbs = Math.abs(mom);

    // Stage 1: smooth momentum
    f28 = f20 * f28 + f18 * mom;
    f30 = f18 * f28 + f20 * f30;
    const v4 = 1.5 * f28 - 0.5 * f30;

    // Stage 2: smooth absolute momentum
    f38 = f20 * f38 + f18 * momAbs;
    f40 = f18 * f38 + f20 * f40;
    const v8 = 1.5 * f38 - 0.5 * f40;

    // Stage 3
    f48 = f20 * f48 + f18 * v4;
    f50 = f18 * f48 + f20 * f50;
    const v10 = 1.5 * f48 - 0.5 * f50;

    f58 = f20 * f58 + f18 * v8;
    f60 = f18 * f58 + f20 * f60;
    const v14 = 1.5 * f58 - 0.5 * f60;

    // Stage 4
    f68 = f20 * f68 + f18 * v10;
    f70 = f18 * f68 + f20 * f70;
    const v18 = 1.5 * f68 - 0.5 * f70;

    f78 = f20 * f78 + f18 * v14;
    f80 = f18 * f78 + f20 * f80;
    const v20 = 1.5 * f78 - 0.5 * f80;

    // Final RSX value
    if (i < f10 || v20 === 0) continue;
    const rsx = Math.max(0, Math.min(100, (v18 / v20 + 1) * 50));
    result[i] = rsx;
  }

  return toPoints(result, bars);
}
