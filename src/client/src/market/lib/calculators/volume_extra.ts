/**
 * Extended volume indicators computed client-side from raw OHLCV data.
 *
 * Every function returns IndicatorPoint[] (single output) or a named object
 * of IndicatorPoint[] arrays (multi-output). All math is pure TypeScript —
 * no external dependencies.
 *
 * Volume functions guard against missing volume data — if bars lack volume,
 * the indicator returns an empty array.
 */

import type { Bar, IndicatorPoint } from './math_primitives';
import {
  sma,
  ema,
  rollingSum,
  trueRange,
  wilderSmooth,
  toPoints,
} from './math_primitives';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check that bars have volume data. Returns false if all volumes are 0 or missing. */
function hasVolume(bars: Bar[]): boolean {
  return bars.some(b => (b.volume ?? 0) > 0);
}

/** Get volume array, defaulting missing values to 0. */
function getVolumes(bars: Bar[]): number[] {
  return bars.map(b => b.volume ?? 0);
}

/** Fill nulls with 0. */
function fillNulls(arr: (number | null)[]): number[] {
  return arr.map(v => v ?? 0);
}

// ─── Indicators ─────────────────────────────────────────────────────────────

/**
 * Chaikin Money Flow: sum(CLV * volume) / sum(volume) over period.
 * CLV (Close Location Value) = ((close-low) - (high-close)) / (high-low).
 * Ranges -1 to +1.
 */
export function calcCMF(bars: Bar[], period = 20): IndicatorPoint[] {
  if (bars.length === 0 || !hasVolume(bars)) return [];
  const volumes = getVolumes(bars);
  const n = bars.length;

  const clvVol: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const hl = bars[i]!.high - bars[i]!.low;
    if (hl !== 0) {
      const clv = ((bars[i]!.close - bars[i]!.low) - (bars[i]!.high - bars[i]!.close)) / hl;
      clvVol[i] = clv * volumes[i]!;
    }
  }

  const sumClvVol = rollingSum(clvVol, period);
  const sumVol = rollingSum(volumes, period);

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (sumClvVol[i] != null && sumVol[i] != null && sumVol[i]! !== 0) {
      result[i] = sumClvVol[i]! / sumVol[i]!;
    }
  }
  return toPoints(result, bars);
}

/**
 * Elder Force Index: EMA of (close_change * volume).
 * Combines price direction, magnitude, and volume into a single oscillator.
 */
export function calcEFI(bars: Bar[], period = 13): IndicatorPoint[] {
  if (bars.length === 0 || !hasVolume(bars)) return [];
  const volumes = getVolumes(bars);
  const n = bars.length;

  const force: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    force[i] = (bars[i]!.close - bars[i - 1]!.close) * volumes[i]!;
  }

  const smoothed = ema(force, period);
  return toPoints(smoothed, bars);
}

/**
 * Ease of Movement: SMA of ((H+L)/2 change) / (volume / (H-L)).
 * High values = price moves easily on low volume.
 * Divisor normalizes for large volume values.
 */
export function calcEOM(
  bars: Bar[],
  period = 14,
  divisor = 100000000,
): IndicatorPoint[] {
  if (bars.length === 0 || !hasVolume(bars)) return [];
  const volumes = getVolumes(bars);
  const n = bars.length;

  const eom: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const midMove = (bars[i]!.high + bars[i]!.low) / 2 - (bars[i - 1]!.high + bars[i - 1]!.low) / 2;
    const hl = bars[i]!.high - bars[i]!.low;
    if (hl !== 0 && volumes[i]! !== 0) {
      const boxRatio = (volumes[i]! / divisor) / hl;
      eom[i] = midMove / boxRatio;
    }
  }

  const smoothed = sma(eom, period);
  return toPoints(smoothed, bars);
}

/**
 * Klinger Volume Oscillator: EMA(VF, fast) - EMA(VF, slow).
 * VF = volume * sign(trend) * |2*(dm/cm) - 1|.
 * dm = high - low, cm = cumulative dm in the same trend direction.
 * Signal = EMA(KVO, signalP).
 */
export function calcKVO(
  bars: Bar[],
  fastP = 34,
  slowP = 55,
  signalP = 13,
): { kvo: IndicatorPoint[]; signal: IndicatorPoint[] } {
  const empty = { kvo: [] as IndicatorPoint[], signal: [] as IndicatorPoint[] };
  if (bars.length === 0 || !hasVolume(bars)) return empty;
  const volumes = getVolumes(bars);
  const n = bars.length;

  // Trend direction based on typical price
  const tp: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    tp[i] = (bars[i]!.high + bars[i]!.low + bars[i]!.close) / 3;
  }

  const vf: number[] = new Array(n).fill(0);
  let cm = 0;

  for (let i = 0; i < n; i++) {
    const dm = bars[i]!.high - bars[i]!.low;

    if (i === 0) {
      cm = dm;
      continue;
    }

    // Trend direction
    const trendUp = tp[i]! > tp[i - 1]! ? 1 : -1;

    // Cumulative measurement — reset when trend changes
    const prevTrendUp = tp[i - 1]! > (i >= 2 ? tp[i - 2]! : tp[i - 1]!) ? 1 : -1;
    if (trendUp === prevTrendUp) {
      cm = cm + dm;
    } else {
      cm = dm;
    }

    // Volume Force
    if (cm !== 0) {
      vf[i] = volumes[i]! * trendUp * Math.abs(2 * (dm / cm) - 1);
    }
  }

  const fastEma = ema(vf, fastP);
  const slowEma = ema(vf, slowP);

  const kvoArr: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fastEma[i] != null && slowEma[i] != null) {
      kvoArr[i] = fastEma[i]! - slowEma[i]!;
    }
  }

  const kvoFilled = fillNulls(kvoArr);
  const sig = ema(kvoFilled, signalP);
  const sigResult: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (kvoArr[i] != null && sig[i] != null) {
      sigResult[i] = sig[i]!;
    }
  }

  return {
    kvo: toPoints(kvoArr, bars),
    signal: toPoints(sigResult, bars),
  };
}

/**
 * Negative Volume Index: Cumulative.
 * When volume decreases vs prior bar, NVI changes by the price ROC.
 * When volume increases, NVI stays flat. Starts at 1000.
 */
export function calcNVI(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0 || !hasVolume(bars)) return [];
  const volumes = getVolumes(bars);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);

  let nvi = 1000;
  result[0] = nvi;
  for (let i = 1; i < n; i++) {
    if (volumes[i]! < volumes[i - 1]! && bars[i - 1]!.close !== 0) {
      const pctChange = (bars[i]!.close - bars[i - 1]!.close) / bars[i - 1]!.close;
      nvi = nvi * (1 + pctChange);
    }
    result[i] = nvi;
  }
  return toPoints(result, bars);
}

/**
 * Positive Volume Index: Cumulative.
 * When volume increases vs prior bar, PVI changes by the price ROC.
 * When volume decreases, PVI stays flat. Starts at 1000.
 */
export function calcPVI(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0 || !hasVolume(bars)) return [];
  const volumes = getVolumes(bars);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);

  let pvi = 1000;
  result[0] = pvi;
  for (let i = 1; i < n; i++) {
    if (volumes[i]! > volumes[i - 1]! && bars[i - 1]!.close !== 0) {
      const pctChange = (bars[i]!.close - bars[i - 1]!.close) / bars[i - 1]!.close;
      pvi = pvi * (1 + pctChange);
    }
    result[i] = pvi;
  }
  return toPoints(result, bars);
}

/**
 * Price Volume Rank: Categorical score based on price/volume direction.
 * Score encoding:
 *   1 = price up, volume up
 *   2 = price up, volume down
 *   3 = price down, volume up
 *   4 = price down, volume down
 */
export function calcPVR(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0 || !hasVolume(bars)) return [];
  const volumes = getVolumes(bars);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = 1; i < n; i++) {
    const priceUp = bars[i]!.close >= bars[i - 1]!.close;
    const volUp = volumes[i]! >= volumes[i - 1]!;

    if (priceUp && volUp) result[i] = 1;
    else if (priceUp && !volUp) result[i] = 2;
    else if (!priceUp && volUp) result[i] = 3;
    else result[i] = 4;
  }
  return toPoints(result, bars);
}

/**
 * Price Volume Trend: Cumulative sum of ((close - prev_close) / prev_close) * volume.
 * Combines price direction and volume magnitude into a cumulative line.
 */
export function calcPVT(bars: Bar[]): IndicatorPoint[] {
  if (bars.length === 0 || !hasVolume(bars)) return [];
  const volumes = getVolumes(bars);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);

  let pvt = 0;
  result[0] = 0;
  for (let i = 1; i < n; i++) {
    const prevClose = bars[i - 1]!.close;
    if (prevClose !== 0) {
      pvt += ((bars[i]!.close - prevClose) / prevClose) * volumes[i]!;
    }
    result[i] = pvt;
  }
  return toPoints(result, bars);
}

/**
 * Volume Price Confirmation Indicator:
 * VWMA(close, shortP) - VWMA(close, longP) + (SMA(close, shortP) - SMA(close, longP)).
 * Confirms whether volume supports the price trend.
 */
export function calcVPCI(
  bars: Bar[],
  shortP = 5,
  longP = 25,
): IndicatorPoint[] {
  if (bars.length === 0 || !hasVolume(bars)) return [];
  const volumes = getVolumes(bars);
  const closes = bars.map(b => b.close);
  const n = bars.length;

  // VWMA = sum(close * volume, period) / sum(volume, period)
  const cv: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    cv[i] = closes[i]! * volumes[i]!;
  }

  const sumCvShort = rollingSum(cv, shortP);
  const sumVolShort = rollingSum(volumes, shortP);
  const sumCvLong = rollingSum(cv, longP);
  const sumVolLong = rollingSum(volumes, longP);

  const smaShort = sma(closes, shortP);
  const smaLong = sma(closes, longP);

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (
      sumCvShort[i] != null && sumVolShort[i] != null && sumVolShort[i]! !== 0 &&
      sumCvLong[i] != null && sumVolLong[i] != null && sumVolLong[i]! !== 0 &&
      smaShort[i] != null && smaLong[i] != null
    ) {
      const vwmaShort = sumCvShort[i]! / sumVolShort[i]!;
      const vwmaLong = sumCvLong[i]! / sumVolLong[i]!;
      result[i] = (vwmaShort - vwmaLong) + (smaShort[i]! - smaLong[i]!);
    }
  }
  return toPoints(result, bars);
}

/**
 * Volume Point of Control — price level with highest volume in a lookback window.
 * Bins the high-low range of the lookback into equal segments, distributes each
 * bar's volume proportionally across the bins its high-low range spans,
 * and returns the midpoint price of the highest-volume bin.
 */
export function calcVPOC(bars: Bar[], period = 20, bins = 50): IndicatorPoint[] {
  if (bars.length === 0 || !hasVolume(bars)) return [];
  const volumes = getVolumes(bars);
  const n = bars.length;
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    // Find the overall high and low of the lookback window
    let windowHigh = -Infinity;
    let windowLow = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j]!.high > windowHigh) windowHigh = bars[j]!.high;
      if (bars[j]!.low < windowLow) windowLow = bars[j]!.low;
    }

    const range = windowHigh - windowLow;
    if (range <= 0) {
      // Flat price — VPOC is the price itself
      result[i] = windowHigh;
      continue;
    }

    const binSize = range / bins;
    const binVolume: number[] = new Array(bins).fill(0);

    // Distribute each bar's volume proportionally across bins its H-L spans
    for (let j = i - period + 1; j <= i; j++) {
      const barLow = bars[j]!.low;
      const barHigh = bars[j]!.high;
      const barRange = barHigh - barLow;
      const vol = volumes[j]!;

      if (barRange <= 0 || vol <= 0) {
        // Point bar — all volume goes to one bin
        const bin = Math.min(Math.floor((bars[j]!.close - windowLow) / binSize), bins - 1);
        if (bin >= 0) binVolume[bin] = binVolume[bin]! + vol;
        continue;
      }

      // Find the range of bins this bar's H-L spans
      const startBin = Math.max(0, Math.floor((barLow - windowLow) / binSize));
      const endBin = Math.min(bins - 1, Math.floor((barHigh - windowLow) / binSize));

      if (startBin === endBin) {
        binVolume[startBin] = binVolume[startBin]! + vol;
      } else {
        // Proportional distribution: fraction of bar range in each bin
        for (let b = startBin; b <= endBin; b++) {
          const binLowPrice = windowLow + b * binSize;
          const binHighPrice = binLowPrice + binSize;
          const overlapLow = Math.max(barLow, binLowPrice);
          const overlapHigh = Math.min(barHigh, binHighPrice);
          const fraction = (overlapHigh - overlapLow) / barRange;
          binVolume[b] = binVolume[b]! + vol * fraction;
        }
      }
    }

    // Find the bin with maximum volume
    let maxVol = -1;
    let maxBin = 0;
    for (let b = 0; b < bins; b++) {
      if (binVolume[b]! > maxVol) {
        maxVol = binVolume[b]!;
        maxBin = b;
      }
    }

    // VPOC = midpoint of the highest-volume bin
    result[i] = windowLow + (maxBin + 0.5) * binSize;
  }

  return toPoints(result, bars);
}

/**
 * VPOC Distance — normalized distance from close to VPOC.
 * Positive = close above VPOC, negative = below.
 * Normalized by ATR for cross-instrument comparability.
 */
export function calcVPOCDist(bars: Bar[], period = 20, bins = 50): IndicatorPoint[] {
  if (bars.length === 0 || !hasVolume(bars)) return [];
  const n = bars.length;

  // Compute VPOC values
  const vpocPoints = calcVPOC(bars, period, bins);
  if (vpocPoints.length === 0) return [];

  // Build a lookup of VPOC values by bar index
  // VPOC points start at index (period-1)
  const vpocByTime = new Map<number, number>();
  for (const pt of vpocPoints) {
    vpocByTime.set(pt.time, pt.value);
  }

  // Compute ATR for normalization (use same period)
  const tr = trueRange(bars);
  const atrSmoothed = wilderSmooth(tr, period);

  const result: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const barTime = Math.floor(bars[i]!.timestamp / 1000);
    const vpocVal = vpocByTime.get(barTime);
    const atrVal = atrSmoothed[i];

    if (vpocVal != null && atrVal != null && atrVal > 0) {
      result[i] = (bars[i]!.close - vpocVal) / atrVal;
    }
  }

  return toPoints(result, bars);
}
