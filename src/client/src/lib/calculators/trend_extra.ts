/**
 * Trend indicators: Choppiness, Chande Kroll Stop, DPO, QStick,
 * Vortex, VHF, Linear Decay, microstructure.
 */

import type { Bar, IndicatorPoint } from './math_primitives';
import {
  trueRange,
  wilderSmooth,
  rollingMax,
  rollingMin,
  rollingSum,
  sma,
  toPoints,
  toTimeSec,
} from './math_primitives';

// â”€â”€â”€ Choppiness Index â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Choppiness Index.
 *
 * Formula: 100 * log10(sum(ATR, period) / (highestHigh - lowestLow)) / log10(period)
 *
 * Values above 61.8 indicate a choppy/range-bound market.
 * Values below 38.2 indicate a strongly trending market.
 *
 * @param bars  OHLCV bar array
 * @param period  Lookback window (default 14)
 */
export function calcChoppiness(bars: Bar[], period = 14): IndicatorPoint[] {
  const n = bars.length;
  if (n === 0 || period < 1) return [];

  const tr = trueRange(bars);
  // Sum of true range over period
  const trSum = rollingSum(tr, period);

  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const hh = rollingMax(highs, period);
  const ll = rollingMin(lows, period);

  const log10Period = Math.log10(period);
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const s = trSum[i] ?? null;
    const h = hh[i] ?? null;
    const l = ll[i] ?? null;
    if (s === null || h === null || l === null) continue;
    const range = h - l;
    if (range <= 0 || log10Period === 0) continue;
    const ci = (100 * Math.log10(s / range)) / log10Period;
    // Clamp to 0-100
    result[i] = Math.max(0, Math.min(100, ci));
  }

  return toPoints(result, bars);
}

// â”€â”€â”€ Chande Kroll Stop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Chande Kroll Stop â€” ATR-based trailing stop.
 *
 * Step 1: ATR = Wilder's smoothed true range over atrPeriod.
 * Step 2: first_high_stop = highest_high(atrPeriod) - atrMult * ATR
 *         first_low_stop  = lowest_low(atrPeriod)  + atrMult * ATR
 * Step 3: stop_short = highest(first_high_stop, period)
 *         stop_long  = lowest(first_low_stop, period)
 *
 * @param bars       OHLCV bar array
 * @param atrPeriod  ATR lookback (default 10)
 * @param atrMult    ATR multiplier (default 1)
 * @param period     Stop smoothing period (default 9)
 */
export function calcCKSP(
  bars: Bar[],
  atrPeriod = 10,
  atrMult = 1,
  period = 9,
): { stopLong: IndicatorPoint[]; stopShort: IndicatorPoint[] } {
  const n = bars.length;
  if (n === 0) return { stopLong: [], stopShort: [] };

  const tr = trueRange(bars);
  const atr = wilderSmooth(tr, atrPeriod);

  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const hh = rollingMax(highs, atrPeriod);
  const ll = rollingMin(lows, atrPeriod);

  // Step 2: intermediate stops
  const firstHighStop: number[] = new Array(n).fill(0);
  const firstLowStop: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (hh[i] !== null && atr[i] !== null) {
      firstHighStop[i] = hh[i]! - atrMult * atr[i]!;
    }
    if (ll[i] !== null && atr[i] !== null) {
      firstLowStop[i] = ll[i]! + atrMult * atr[i]!;
    }
  }

  // Step 3: smooth the intermediate stops
  const stopShortRaw = rollingMax(firstHighStop, period);
  const stopLongRaw = rollingMin(firstLowStop, period);

  return {
    stopLong: toPoints(stopLongRaw, bars),
    stopShort: toPoints(stopShortRaw, bars),
  };
}

// â”€â”€â”€ Detrended Price Oscillator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Detrended Price Oscillator.
 *
 * DPO = close[i - (period/2 + 1)] - SMA(close, period)[i]
 *
 * The standard formula shifts the oscillator backward, but for charting
 * we plot it at the current bar index (i.e., we use the close at
 * i - shift and the SMA at i, plotted at position i).
 *
 * @param bars    OHLCV bar array
 * @param period  Lookback (default 20)
 */
export function calcDPO(bars: Bar[], period = 20): IndicatorPoint[] {
  const n = bars.length;
  if (n === 0 || period < 1) return [];

  const closes = bars.map(b => b.close);
  const smaVals = sma(closes, period);
  const shift = Math.floor(period / 2) + 1;

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (smaVals[i] === null) continue;
    const pastIdx = i - shift;
    if (pastIdx < 0) continue;
    result[i] = closes[pastIdx]! - smaVals[i]!;
  }

  return toPoints(result, bars);
}

// â”€â”€â”€ QStick â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * QStick â€” SMA of (close - open).
 *
 * Positive values indicate buying pressure (closes above opens).
 * Negative values indicate selling pressure.
 *
 * @param bars    OHLCV bar array
 * @param period  SMA lookback (default 14)
 */
export function calcQStick(bars: Bar[], period = 14): IndicatorPoint[] {
  const n = bars.length;
  if (n === 0 || period < 1) return [];

  const co = bars.map(b => b.close - b.open);
  const result = sma(co, period);
  return toPoints(result, bars);
}

// â”€â”€â”€ Vortex Indicator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Vortex Indicator.
 *
 * VM+ = |high[i] - low[i-1]|
 * VM- = |low[i]  - high[i-1]|
 * VI+ = sum(VM+, period) / sum(TR, period)
 * VI- = sum(VM-, period) / sum(TR, period)
 *
 * @param bars    OHLCV bar array
 * @param period  Lookback (default 14)
 */
export function calcVortex(
  bars: Bar[],
  period = 14,
): { viPlus: IndicatorPoint[]; viMinus: IndicatorPoint[] } {
  const n = bars.length;
  if (n < 2) return { viPlus: [], viMinus: [] };

  const tr = trueRange(bars);

  // VM+ and VM-: first element is 0 (no previous bar)
  const vmPlus: number[] = new Array(n).fill(0);
  const vmMinus: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    vmPlus[i] = Math.abs(bars[i]!.high - bars[i - 1]!.low);
    vmMinus[i] = Math.abs(bars[i]!.low - bars[i - 1]!.high);
  }

  const sumVMPlus = rollingSum(vmPlus, period);
  const sumVMMinus = rollingSum(vmMinus, period);
  const sumTR = rollingSum(tr, period);

  const viPlusArr: (number | null)[] = new Array(n).fill(null);
  const viMinusArr: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (sumVMPlus[i] === null || sumVMMinus[i] === null || sumTR[i] === null) continue;
    if (sumTR[i]! === 0) continue;
    viPlusArr[i] = sumVMPlus[i]! / sumTR[i]!;
    viMinusArr[i] = sumVMMinus[i]! / sumTR[i]!;
  }

  return {
    viPlus: toPoints(viPlusArr, bars),
    viMinus: toPoints(viMinusArr, bars),
  };
}

// â”€â”€â”€ Vertical Horizontal Filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Vertical Horizontal Filter.
 *
 * VHF = |highest_close - lowest_close| / sum(|close_change|, period)
 *
 * High values indicate a trending market. Low values indicate ranging.
 *
 * @param bars    OHLCV bar array
 * @param period  Lookback (default 28)
 */
export function calcVHF(bars: Bar[], period = 28): IndicatorPoint[] {
  const n = bars.length;
  if (n < 2 || period < 2) return [];

  const closes = bars.map(b => b.close);
  const hc = rollingMax(closes, period);
  const lc = rollingMin(closes, period);

  // Absolute close-to-close changes: |close[i] - close[i-1]|
  const absChange: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    absChange[i] = Math.abs(closes[i]! - closes[i - 1]!);
  }
  const sumAbsChange = rollingSum(absChange, period);

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (hc[i] === null || lc[i] === null || sumAbsChange[i] === null) continue;
    const denom = sumAbsChange[i]!;
    if (denom === 0) continue;
    result[i] = Math.abs(hc[i]! - lc[i]!) / denom;
  }

  return toPoints(result, bars);
}

// â”€â”€â”€ Linear Decay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Linear Decay â€” linearly declining weights applied to close prices.
 *
 * Weight for offset j (0 = most recent) = (period - j) / sum(1..period).
 * Equivalent to WMA but conceptually framed as a decay function.
 *
 * @param bars    OHLCV bar array
 * @param period  Window (default 5)
 */
export function calcDecayLinear(bars: Bar[], period = 5): IndicatorPoint[] {
  const n = bars.length;
  if (n === 0 || period < 1) return [];

  const closes = bars.map(b => b.close);
  const denom = (period * (period + 1)) / 2;

  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period) return [];

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      // Weight: newest bar gets weight `period`, oldest gets weight 1
      const weight = j + 1;
      sum += closes[i - period + 1 + j]! * weight;
    }
    result[i] = sum / denom;
  }

  return toPoints(result, bars);
}

// â”€â”€â”€ microstructure â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * microstructure â€” identifies significant microstructure highs and lows with at least
 * `deviation`% price change between pivots.
 *
 * Returns only the pivot points (not every bar). Useful for identifying
 * trend structure, wave counts, and support/resistance.
 *
 * @param bars       OHLCV bar array
 * @param deviation  Minimum % change to register a new microstructure (default 5)
 */
export function calcZigZag(bars: Bar[], deviation = 5): IndicatorPoint[] {
  const n = bars.length;
  if (n < 2 || deviation <= 0) return [];

  const thresh = deviation / 100;
  const points: IndicatorPoint[] = [];

  // Seed: first bar's high and low as initial candidates
  let lastPivotIdx = 0;
  let trend = 0; // 0 = undetermined, 1 = up, -1 = down

  // Determine initial direction from bar 0
  let highIdx = 0;
  let highPrice = bars[0]!.high;
  let lowIdx = 0;
  let lowPrice = bars[0]!.low;

  for (let i = 1; i < n; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;

    if (trend === 0) {
      // Determine initial trend direction
      if (h > highPrice) { highPrice = h; highIdx = i; }
      if (l < lowPrice) { lowPrice = l; lowIdx = i; }

      const upMove = highPrice / lowPrice - 1;
      const downMove = 1 - lowPrice / highPrice;

      if (upMove >= thresh && highIdx > lowIdx) {
        // Low came first, we're heading up
        trend = 1;
        points.push({ time: toTimeSec(bars[lowIdx]!.timestamp), value: lowPrice });
        lastPivotIdx = lowIdx;
      } else if (downMove >= thresh && lowIdx > highIdx) {
        // High came first, we're heading down
        trend = -1;
        points.push({ time: toTimeSec(bars[highIdx]!.timestamp), value: highPrice });
        lastPivotIdx = highIdx;
      }
      continue;
    }

    if (trend === 1) {
      // Uptrend: track highest high
      if (h > highPrice) {
        highPrice = h;
        highIdx = i;
      }
      // Check for reversal down
      const drop = 1 - l / highPrice;
      if (drop >= thresh) {
        // microstructure high confirmed
        points.push({ time: toTimeSec(bars[highIdx]!.timestamp), value: highPrice });
        lastPivotIdx = highIdx;
        // Start tracking downtrend from here
        trend = -1;
        lowPrice = l;
        lowIdx = i;
      }
    } else {
      // Downtrend: track lowest low
      if (l < lowPrice) {
        lowPrice = l;
        lowIdx = i;
      }
      // Check for reversal up
      const rise = h / lowPrice - 1;
      if (rise >= thresh) {
        // microstructure low confirmed
        points.push({ time: toTimeSec(bars[lowIdx]!.timestamp), value: lowPrice });
        lastPivotIdx = lowIdx;
        // Start tracking uptrend
        trend = 1;
        highPrice = h;
        highIdx = i;
      }
    }
  }

  // Add the last unconfirmed pivot
  if (trend === 1 && highIdx > lastPivotIdx) {
    points.push({ time: toTimeSec(bars[highIdx]!.timestamp), value: highPrice });
  } else if (trend === -1 && lowIdx > lastPivotIdx) {
    points.push({ time: toTimeSec(bars[lowIdx]!.timestamp), value: lowPrice });
  }

  return points;
}


