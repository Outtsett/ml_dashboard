/**
 * Extra overlay indicator calculators.
 *
 * Each function takes Bar[] and indicator-specific params, returns IndicatorPoint[]
 * (or a named-output object for multi-line indicators).
 *
 * All math is self-contained — no external dependencies beyond ./mathPrimitives.
 */

import {
  type Bar,
  type IndicatorPoint,
  sma,
  ema,
  wma,
  wilderSmooth,
  rollingMax,
  rollingMin,
  trueRange,
  toPoints,
  ohlc4,
  medianPrice,
  typicalPrice,
  weightedClose,
} from './math_primitives';

// ─── Moving Average Variants ─────────────────────────────────────────────────

/**
 * Hull Moving Average: WMA(2*WMA(n/2) - WMA(n), sqrt(n))
 */
export function calcHMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const halfPeriod = Math.max(1, Math.floor(period / 2));
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)));

  const wmaHalf = wma(closes, halfPeriod);
  const wmaFull = wma(closes, period);

  // 2*WMA(n/2) - WMA(n)
  const diff: number[] = new Array(closes.length).fill(0);
  for (let i = 0; i < closes.length; i++) {
    if (wmaHalf[i] !== null && wmaFull[i] !== null) {
      diff[i] = 2 * wmaHalf[i]! - wmaFull[i]!;
    } else if (wmaHalf[i] !== null) {
      diff[i] = wmaHalf[i]!;
    }
  }

  const hull = wma(diff, sqrtPeriod);
  // Only output points where both WMA components were valid
  const result: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (wmaFull[i] !== null && hull[i] !== null) {
      result[i] = hull[i]!;
    }
  }
  return toPoints(result, bars);
}

/**
 * Arnaud Legoux Moving Average: Gaussian-weighted with offset and sigma.
 *   weight[i] = exp(-((i - offset * (period-1))^2) / (2 * (period / sigma)^2))
 */
export function calcALMA(bars: Bar[], period: number, offset: number, sigma: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  // Pre-compute weights
  const m = offset * (period - 1);
  const s = period / sigma;
  const weights: number[] = new Array(period);
  let wSum = 0;
  for (let i = 0; i < period; i++) {
    weights[i] = Math.exp(-((i - m) ** 2) / (2 * s * s));
    wSum += weights[i]!;
  }
  // Normalize
  for (let i = 0; i < period; i++) weights[i] = weights[i]! / wSum;

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += closes[i - period + 1 + j]! * weights[j]!;
    }
    result[i] = sum;
  }
  return toPoints(result, bars);
}

/**
 * Fibonacci Weighted MA: weights are the first `period` Fibonacci numbers.
 */
export function calcFWMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  // Generate Fibonacci weights
  const fibs: number[] = new Array(period);
  fibs[0] = 1;
  if (period > 1) fibs[1] = 1;
  for (let i = 2; i < period; i++) fibs[i] = fibs[i - 1]! + fibs[i - 2]!;
  let fibSum = 0;
  for (let i = 0; i < period; i++) fibSum += fibs[i]!;

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += closes[i - period + 1 + j]! * fibs[j]!;
    }
    result[i] = sum / fibSum;
  }
  return toPoints(result, bars);
}

/**
 * Pascal's Triangle Weighted MA: weights are row (period-1) of Pascal's triangle.
 *   C(period-1, k) for k=0..period-1
 */
export function calcPWMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  // Generate Pascal row via binomial coefficients
  const row = period - 1;
  const weights: number[] = new Array(period);
  weights[0] = 1;
  for (let k = 1; k < period; k++) {
    weights[k] = weights[k - 1]! * (row - k + 1) / k;
  }
  let wSum = 0;
  for (let i = 0; i < period; i++) wSum += weights[i]!;

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += closes[i - period + 1 + j]! * weights[j]!;
    }
    result[i] = sum / wSum;
  }
  return toPoints(result, bars);
}

/**
 * Sine Weighted MA: weights = sin(pi * (i+1) / (period+1))
 */
export function calcSINWMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  const weights: number[] = new Array(period);
  let wSum = 0;
  for (let i = 0; i < period; i++) {
    weights[i] = Math.sin(Math.PI * (i + 1) / (period + 1));
    wSum += weights[i]!;
  }

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += closes[i - period + 1 + j]! * weights[j]!;
    }
    result[i] = sum / wSum;
  }
  return toPoints(result, bars);
}

/**
 * Symmetric Weighted MA: fixed 4-bar with weights [1,2,2,1]/6
 */
export function calcSWMA(bars: Bar[]): IndicatorPoint[] {
  if (bars.length < 4) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = 3; i < n; i++) {
    result[i] = (
      1 * closes[i - 3]! +
      2 * closes[i - 2]! +
      2 * closes[i - 1]! +
      1 * closes[i]!
    ) / 6;
  }
  return toPoints(result, bars);
}

/**
 * Variable Index Dynamic Average (VIDYA).
 * Uses Chande Momentum Oscillator (CMO) as the smoothing constant multiplier.
 * alpha = |CMO(cmoPeriod)| * 2/(period+1)
 */
export function calcVIDYA(bars: Bar[], period: number, cmoPeriod: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1 || cmoPeriod < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  // Need at least cmoPeriod+1 bars for first CMO value
  const startIdx = Math.max(period - 1, cmoPeriod);
  if (n <= startIdx) return [];

  const k = 2 / (period + 1);

  // Initialize VIDYA with the close at startIdx
  let vidya = closes[startIdx]!;
  result[startIdx] = vidya;

  for (let i = startIdx + 1; i < n; i++) {
    // Compute CMO over cmoPeriod
    let sumGains = 0;
    let sumLosses = 0;
    for (let j = i - cmoPeriod + 1; j <= i; j++) {
      const d = closes[j]! - closes[j - 1]!;
      if (d > 0) sumGains += d;
      else sumLosses += -d;
    }
    const cmo = (sumGains + sumLosses) !== 0
      ? (sumGains - sumLosses) / (sumGains + sumLosses)
      : 0;

    const alpha = Math.abs(cmo) * k;
    vidya = alpha * closes[i]! + (1 - alpha) * vidya;
    result[i] = vidya;
  }
  return toPoints(result, bars);
}

/**
 * Volume Weighted MA: sum(close * volume) / sum(volume) over period.
 * Bars without volume are treated as volume=0.
 */
export function calcVWMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    let sumCV = 0;
    let sumV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const vol = bars[j]!.volume ?? 0;
      sumCV += bars[j]!.close * vol;
      sumV += vol;
    }
    // If no volume data, fall back to simple average of closes
    if (sumV === 0) {
      let sumC = 0;
      for (let j = i - period + 1; j <= i; j++) sumC += bars[j]!.close;
      result[i] = sumC / period;
    } else {
      result[i] = sumCV / sumV;
    }
  }
  return toPoints(result, bars);
}

/**
 * Holt-Winter Moving Average (triple exponential smoothing).
 * F_t = F_{t-1} + V_{t-1} + 0.5*A_{t-1}
 * V_t = V_{t-1} + A_{t-1}
 * A_t = na * (close - F_t) + nb * V_t + nc * A_{t-1} (correction terms)
 *
 * na, nb, nc are smoothing factors (typically small, 0 < x < 1).
 */
export function calcHWMA(bars: Bar[], na: number, nb: number, nc: number): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  // Initialize
  let F = closes[0]!;
  let V = 0;
  let A = 0;
  result[0] = F;

  for (let i = 1; i < n; i++) {
    const Fprev = F;
    F = Fprev + V + 0.5 * A;
    V = V + A;
    A = na * (closes[i]! - F) + nb * V + nc * A;
    // Correction: update F with the new acceleration contribution
    // Standard HWMA: the output is F after correction
    result[i] = F;
  }
  return toPoints(result, bars);
}

/**
 * McGinley Dynamic: MD = MD_prev + (close - MD_prev) / (period * (close/MD_prev)^4)
 */
export function calcMCGD(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  let md = closes[0]!;
  result[0] = md;

  for (let i = 1; i < n; i++) {
    const c = closes[i]!;
    if (md === 0) {
      md = c;
    } else {
      const ratio = c / md;
      const denom = period * (ratio ** 4);
      if (denom !== 0) {
        md = md + (c - md) / denom;
      }
    }
    result[i] = md;
  }
  return toPoints(result, bars);
}

/**
 * Jurik Moving Average approximation.
 *
 * Common open-source JMA uses a multi-stage adaptive filter:
 *   - Phase adjustment: phaseRatio from phase param
 *   - Power-based smoothing: beta = 0.45 * (period-1) / (0.45*(period-1)+2)
 *   - Three-stage Kalman-like filter with adaptive gain
 */
export function calcJMA(bars: Bar[], period: number, phase: number, power: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  // Phase ratio: maps phase (-100..100) to 0.5..2.5 range
  let phaseRatio: number;
  if (phase < -100) phaseRatio = 0.5;
  else if (phase > 100) phaseRatio = 2.5;
  else if (phase < 0) phaseRatio = 1.0 + phase / 200.0;    // -100->0.5, 0->1.0
  else phaseRatio = 1.0 + phase * 1.5 / 100.0;             // 0->1.0, 100->2.5

  // Beta from period
  const beta = 0.45 * (period - 1) / (0.45 * (period - 1) + 2);
  const alpha = beta ** power;

  // State variables
  let e0 = 0, e1 = 0, e2 = 0;
  let jma = 0;
  let initialized = false;

  for (let i = 0; i < n; i++) {
    const price = closes[i]!;
    if (!initialized) {
      e0 = price;
      e1 = 0;
      e2 = 0;
      jma = price;
      initialized = true;
      result[i] = jma;
      continue;
    }

    e0 = (1 - alpha) * price + alpha * e0;
    e1 = (price - e0) * (1 - beta) + beta * e1;
    e2 = (e0 + phaseRatio * e1 - jma) * ((1 - alpha) ** 2) + (alpha ** 2) * e2;
    jma = jma + e2;
    result[i] = jma;
  }

  // Skip first `period` bars as warm-up
  for (let i = 0; i < Math.min(period, n); i++) {
    result[i] = null;
  }

  return toPoints(result, bars);
}

/**
 * Zero Lag MA: 2*EMA(close) - EMA(EMA(close))
 * Identical to DEMA but kept as a distinct named function.
 */
export function calcZLMA(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const ema1 = ema(closes, period);
  const ema1Nums = ema1.map(v => v ?? 0);
  const ema2 = ema(ema1Nums, period);

  const result: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (ema1[i] !== null && ema2[i] !== null) {
      result[i] = 2 * ema1[i]! - ema2[i]!;
    }
  }
  return toPoints(result, bars);
}

/**
 * Running Moving Average overlay (Wilder's smoothing applied to close prices).
 */
export function calcRMAOverlay(bars: Bar[], period: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const result = wilderSmooth(closes, period);
  return toPoints(result, bars);
}

// ─── Channel / Band Indicators ───────────────────────────────────────────────

/**
 * Keltner Channels: EMA +/- multiplier * ATR
 */
export function calcKeltnerChannels(
  bars: Bar[],
  emaPeriod: number,
  atrPeriod: number,
  multiplier: number,
): { upper: IndicatorPoint[]; middle: IndicatorPoint[]; lower: IndicatorPoint[] } {
  const empty = { upper: [] as IndicatorPoint[], middle: [] as IndicatorPoint[], lower: [] as IndicatorPoint[] };
  if (bars.length === 0 || emaPeriod < 1 || atrPeriod < 1) return empty;

  const closes = bars.map(b => b.close);
  const tr = trueRange(bars);
  const atr = wilderSmooth(tr, atrPeriod);
  const mid = ema(closes, emaPeriod);

  const upper: (number | null)[] = new Array(bars.length).fill(null);
  const lower: (number | null)[] = new Array(bars.length).fill(null);
  const middle: (number | null)[] = new Array(bars.length).fill(null);

  for (let i = 0; i < bars.length; i++) {
    if (mid[i] !== null && atr[i] !== null) {
      middle[i] = mid[i]!;
      upper[i] = mid[i]! + multiplier * atr[i]!;
      lower[i] = mid[i]! - multiplier * atr[i]!;
    }
  }

  return {
    upper: toPoints(upper, bars),
    middle: toPoints(middle, bars),
    lower: toPoints(lower, bars),
  };
}

/**
 * Donchian Channels: Highest High / Lowest Low over period, middle = average.
 */
export function calcDonchianChannels(
  bars: Bar[],
  period: number,
): { upper: IndicatorPoint[]; middle: IndicatorPoint[]; lower: IndicatorPoint[] } {
  const empty = { upper: [] as IndicatorPoint[], middle: [] as IndicatorPoint[], lower: [] as IndicatorPoint[] };
  if (bars.length === 0 || period < 1) return empty;

  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);

  const upper: (number | null)[] = new Array(bars.length).fill(null);
  const middle: (number | null)[] = new Array(bars.length).fill(null);
  const lower: (number | null)[] = new Array(bars.length).fill(null);

  for (let i = 0; i < bars.length; i++) {
    if (hh[i] !== null && ll[i] !== null) {
      upper[i] = hh[i]!;
      lower[i] = ll[i]!;
      middle[i] = (hh[i]! + ll[i]!) / 2;
    }
  }

  return {
    upper: toPoints(upper, bars),
    middle: toPoints(middle, bars),
    lower: toPoints(lower, bars),
  };
}

/**
 * SuperTrend: ATR-based trend-following overlay.
 *   - Basic upper band = (H+L)/2 + multiplier * ATR
 *   - Basic lower band = (H+L)/2 - multiplier * ATR
 *   - Final upper band: min(basicUpper, prevFinalUpper) if prevClose > prevFinalUpper else basicUpper
 *   - Final lower band: max(basicLower, prevFinalLower) if prevClose < prevFinalLower else basicLower
 *   - Direction flips based on close crossing bands
 *
 * Returns supertrend line values and direction (1=up, -1=down).
 */
export function calcSuperTrend(
  bars: Bar[],
  period: number,
  multiplier: number,
): { supertrend: IndicatorPoint[]; direction: IndicatorPoint[] } {
  const empty = { supertrend: [] as IndicatorPoint[], direction: [] as IndicatorPoint[] };
  if (bars.length === 0 || period < 1) return empty;

  const n = bars.length;
  const tr = trueRange(bars);
  const atr = wilderSmooth(tr, period);

  const stValues: (number | null)[] = new Array(n).fill(null);
  const dirValues: (number | null)[] = new Array(n).fill(null);

  let prevFinalUpper = 0;
  let prevFinalLower = 0;
  let prevSuperTrend = 0;
  let prevDir = 1; // 1 = up (bullish), -1 = down (bearish)
  let started = false;

  for (let i = 0; i < n; i++) {
    if (atr[i] === null) continue;

    const hl2 = (bars[i]!.high + bars[i]!.low) / 2;
    const basicUpper = hl2 + multiplier * atr[i]!;
    const basicLower = hl2 - multiplier * atr[i]!;

    let finalUpper: number;
    let finalLower: number;

    if (!started) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      prevDir = bars[i]!.close <= basicUpper ? 1 : -1;
      started = true;
    } else {
      // Final upper band
      finalUpper = (basicUpper < prevFinalUpper || bars[i - 1]!.close > prevFinalUpper)
        ? basicUpper
        : prevFinalUpper;

      // Final lower band
      finalLower = (basicLower > prevFinalLower || bars[i - 1]!.close < prevFinalLower)
        ? basicLower
        : prevFinalLower;
    }

    // Determine direction
    let dir: number;
    if (prevSuperTrend === prevFinalUpper) {
      dir = bars[i]!.close > finalUpper ? 1 : -1;
    } else {
      dir = bars[i]!.close < finalLower ? -1 : 1;
    }

    stValues[i] = dir === 1 ? finalLower : finalUpper;
    dirValues[i] = dir;

    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
    prevSuperTrend = stValues[i]!;
    prevDir = dir;
  }

  return {
    supertrend: toPoints(stValues, bars),
    direction: toPoints(dirValues, bars),
  };
}

/**
 * Ichimoku Cloud.
 *   Tenkan-sen  = (highest_high + lowest_low) / 2 over tenkanPeriod
 *   Kijun-sen   = (highest_high + lowest_low) / 2 over kijunPeriod
 *   Senkou A    = (tenkan + kijun) / 2, displaced forward by kijunPeriod
 *   Senkou B    = (highest_high + lowest_low) / 2 over senkouPeriod, displaced forward by kijunPeriod
 *   Chikou      = close displaced backward by kijunPeriod
 */
export function calcIchimoku(
  bars: Bar[],
  tenkanPeriod: number,
  kijunPeriod: number,
  senkouPeriod: number,
): {
  tenkan: IndicatorPoint[];
  kijun: IndicatorPoint[];
  senkouA: IndicatorPoint[];
  senkouB: IndicatorPoint[];
  chikou: IndicatorPoint[];
} {
  const empty = {
    tenkan: [] as IndicatorPoint[],
    kijun: [] as IndicatorPoint[],
    senkouA: [] as IndicatorPoint[],
    senkouB: [] as IndicatorPoint[],
    chikou: [] as IndicatorPoint[],
  };
  if (bars.length === 0) return empty;

  const n = bars.length;
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);

  // Donchian midlines
  const hhTenkan = rollingMax(highs, tenkanPeriod);
  const llTenkan = rollingMin(lows, tenkanPeriod);
  const hhKijun = rollingMax(highs, kijunPeriod);
  const llKijun = rollingMin(lows, kijunPeriod);
  const hhSenkou = rollingMax(highs, senkouPeriod);
  const llSenkou = rollingMin(lows, senkouPeriod);

  // Tenkan-sen
  const tenkanVals: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (hhTenkan[i] !== null && llTenkan[i] !== null) {
      tenkanVals[i] = (hhTenkan[i]! + llTenkan[i]!) / 2;
    }
  }

  // Kijun-sen
  const kijunVals: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (hhKijun[i] !== null && llKijun[i] !== null) {
      kijunVals[i] = (hhKijun[i]! + llKijun[i]!) / 2;
    }
  }

  // Senkou B base (before displacement)
  const senkouBBase: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (hhSenkou[i] !== null && llSenkou[i] !== null) {
      senkouBBase[i] = (hhSenkou[i]! + llSenkou[i]!) / 2;
    }
  }

  // Convert tenkan and kijun to points directly
  const tenkan = toPoints(tenkanVals, bars);
  const kijun = toPoints(kijunVals, bars);

  // Senkou A: (tenkan + kijun) / 2, displaced forward by kijunPeriod
  // We create virtual future bars by extrapolating timestamps
  const senkouA: IndicatorPoint[] = [];
  for (let i = 0; i < n; i++) {
    if (tenkanVals[i] !== null && kijunVals[i] !== null) {
      const futureIdx = i + kijunPeriod;
      let ts: number;
      if (futureIdx < n) {
        ts = bars[futureIdx]!.timestamp;
      } else {
        // Extrapolate timestamp using average bar spacing
        const lastTs = bars[n - 1]!.timestamp;
        const avgSpacing = n > 1 ? (bars[n - 1]!.timestamp - bars[0]!.timestamp) / (n - 1) : 1;
        ts = lastTs + (futureIdx - n + 1) * avgSpacing;
      }
      const time = ts > 1e12 ? Math.floor(ts / 1000) : ts;
      senkouA.push({ time, value: (tenkanVals[i]! + kijunVals[i]!) / 2 });
    }
  }

  // Senkou B: displaced forward by kijunPeriod
  const senkouB: IndicatorPoint[] = [];
  for (let i = 0; i < n; i++) {
    if (senkouBBase[i] !== null) {
      const futureIdx = i + kijunPeriod;
      let ts: number;
      if (futureIdx < n) {
        ts = bars[futureIdx]!.timestamp;
      } else {
        const lastTs = bars[n - 1]!.timestamp;
        const avgSpacing = n > 1 ? (bars[n - 1]!.timestamp - bars[0]!.timestamp) / (n - 1) : 1;
        ts = lastTs + (futureIdx - n + 1) * avgSpacing;
      }
      const time = ts > 1e12 ? Math.floor(ts / 1000) : ts;
      senkouB.push({ time, value: senkouBBase[i]! });
    }
  }

  // Chikou: close displaced backward by kijunPeriod
  const chikou: IndicatorPoint[] = [];
  for (let i = kijunPeriod; i < n; i++) {
    const pastIdx = i - kijunPeriod;
    const ts = bars[pastIdx]!.timestamp;
    const time = ts > 1e12 ? Math.floor(ts / 1000) : ts;
    chikou.push({ time, value: bars[i]!.close });
  }

  return { tenkan, kijun, senkouA, senkouB, chikou };
}

/**
 * HiLo Activator.
 *   When trend is down (close < SMA(high)): plot SMA(high)
 *   When trend is up   (close > SMA(low)):  plot SMA(low)
 *   Trend flips when close crosses the opposite SMA.
 */
export function calcHILO(bars: Bar[], highPeriod: number, lowPeriod: number): IndicatorPoint[] {
  if (bars.length === 0 || highPeriod < 1 || lowPeriod < 1) return [];

  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);
  const smaHigh = sma(highs, highPeriod);
  const smaLow = sma(lows, lowPeriod);

  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);

  // Find first index where both SMAs are available
  const startIdx = Math.max(highPeriod - 1, lowPeriod - 1);
  if (startIdx >= n) return [];

  // Initial trend detection
  let trendUp = closes[startIdx]! > smaLow[startIdx]!;

  for (let i = startIdx; i < n; i++) {
    if (smaHigh[i] === null || smaLow[i] === null) continue;

    if (trendUp) {
      result[i] = smaLow[i]!;
      // Check for trend flip to down
      if (closes[i]! < smaHigh[i]!) {
        trendUp = false;
        result[i] = smaHigh[i]!;
      }
    } else {
      result[i] = smaHigh[i]!;
      // Check for trend flip to up
      if (closes[i]! > smaLow[i]!) {
        trendUp = true;
        result[i] = smaLow[i]!;
      }
    }
  }

  return toPoints(result, bars);
}

/**
 * Ehlers Super Smoother Filter (2-pole or 3-pole IIR).
 *
 * 2-pole:
 *   a1 = exp(-sqrt(2) * pi / period)
 *   b1 = 2 * a1 * cos(sqrt(2) * pi / period)
 *   c2 = b1, c3 = -a1^2, c1 = 1 - c2 - c3
 *   filt[i] = c1*(src[i]+src[i-1])/2 + c2*filt[i-1] + c3*filt[i-2]
 *
 * 3-pole:
 *   a1 = exp(-pi / period)
 *   b1 = 2*a1*cos(1.738*pi/period)
 *   c1 = a1^2
 *   coef2 = b1+c1, coef3 = -(c1+b1*c1), coef4 = c1^2
 *   coef1 = 1 - coef2 - coef3 - coef4
 *   filt[i] = coef1*src[i] + coef2*filt[i-1] + coef3*filt[i-2] + coef4*filt[i-3]
 */
export function calcSSF(bars: Bar[], period: number, poles: number): IndicatorPoint[] {
  if (bars.length === 0 || period < 1) return [];
  const closes = bars.map(b => b.close);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  if (poles === 3) {
    // 3-pole Super Smoother
    const a1 = Math.exp(-Math.PI / period);
    const b1 = 2 * a1 * Math.cos(1.738 * Math.PI / period);
    const c1 = a1 * a1;
    const coef2 = b1 + c1;
    const coef3 = -(c1 + b1 * c1);
    const coef4 = c1 * c1;
    const coef1 = 1 - coef2 - coef3 - coef4;

    // Warm-up: first 3 bars use raw values
    const filt: number[] = new Array(n).fill(0);
    for (let i = 0; i < Math.min(3, n); i++) filt[i] = closes[i]!;

    for (let i = 3; i < n; i++) {
      filt[i] = coef1 * closes[i]! + coef2 * filt[i - 1]! + coef3 * filt[i - 2]! + coef4 * filt[i - 3]!;
    }

    // Skip first period as warm-up
    for (let i = Math.min(period, n); i < n; i++) {
      result[i] = filt[i]!;
    }
  } else {
    // 2-pole Super Smoother (default)
    const a1 = Math.exp(-Math.SQRT2 * Math.PI / period);
    const b1 = 2 * a1 * Math.cos(Math.SQRT2 * Math.PI / period);
    const c2 = b1;
    const c3 = -(a1 * a1);
    const c1 = 1 - c2 - c3;

    const filt: number[] = new Array(n).fill(0);
    for (let i = 0; i < Math.min(2, n); i++) filt[i] = closes[i]!;

    for (let i = 2; i < n; i++) {
      filt[i] = c1 * (closes[i]! + closes[i - 1]!) / 2 + c2 * filt[i - 1]! + c3 * filt[i - 2]!;
    }

    for (let i = Math.min(period, n); i < n; i++) {
      result[i] = filt[i]!;
    }
  }

  return toPoints(result, bars);
}

/**
 * Acceleration Bands.
 *   upper = SMA(high * (1 + 4 * (high - low) / (high + low)))
 *   middle = SMA(close)
 *   lower = SMA(low * (1 - 4 * (high - low) / (high + low)))
 */
export function calcAccBands(
  bars: Bar[],
  period: number,
): { upper: IndicatorPoint[]; middle: IndicatorPoint[]; lower: IndicatorPoint[] } {
  const empty = { upper: [] as IndicatorPoint[], middle: [] as IndicatorPoint[], lower: [] as IndicatorPoint[] };
  if (bars.length === 0 || period < 1) return empty;

  const n = bars.length;
  const upperRaw: number[] = new Array(n);
  const lowerRaw: number[] = new Array(n);
  const closes = bars.map(b => b.close);

  for (let i = 0; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const hl = h + l;
    const bandwidth = hl !== 0 ? 4 * (h - l) / hl : 0;
    upperRaw[i] = h * (1 + bandwidth);
    lowerRaw[i] = l * (1 - bandwidth);
  }

  const upper = sma(upperRaw, period);
  const middle = sma(closes, period);
  const lower = sma(lowerRaw, period);

  return {
    upper: toPoints(upper, bars),
    middle: toPoints(middle, bars),
    lower: toPoints(lower, bars),
  };
}

// ─── Price Transform Overlays ────────────────────────────────────────────────

/** Average Price: (O+H+L+C)/4 */
export function calcAvgPrice(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const vals = ohlc4(bars);
  const result: (number | null)[] = vals;
  return toPoints(result, bars);
}

/** Median Price: (H+L)/2 */
export function calcMedPrice(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const vals = medianPrice(bars);
  const result: (number | null)[] = vals;
  return toPoints(result, bars);
}

/** Typical Price: (H+L+C)/3 */
export function calcTypPrice(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const vals = typicalPrice(bars);
  const result: (number | null)[] = vals;
  return toPoints(result, bars);
}

/** Weighted Close Price: (H+L+2C)/4 */
export function calcWCLPrice(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0) return [];
  const vals = weightedClose(bars);
  const result: (number | null)[] = vals;
  return toPoints(result, bars);
}
