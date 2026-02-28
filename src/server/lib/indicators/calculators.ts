/**
 * Technical Indicator Calculators
 *
 * TypeScript calculation functions for each core indicator.
 * Uses math primitives from ./math.ts.
 */

import type { OHLCVBar } from './math/types';
import { sma, ema, wma } from './math/trendMath';
import { stddev, rollingMax, rollingMin, trueRange, typicalPrice } from './math/volatilityMath';
import { diff, roc, gains, losses, combine } from './math/momentumMath';
import { INDICATOR_REGISTRY } from './registry';

export interface IndicatorResult {
  name: string;
  values: (number | null)[];
}

export function calculateRSI(bars: OHLCVBar[], period: number = 14): IndicatorResult {
  const closes = bars.map(b => b.close);
  const g = gains(closes).map(v => v ?? 0);
  const l = losses(closes).map(v => v ?? 0);

  const avgGain = sma(g, period);
  const avgLoss = sma(l, period);

  const rsiValues = avgGain.map((ag, i) => {
    const al = avgLoss[i];
    if (ag === null || al == null || al === 0) return null;
    return 100 - (100 / (1 + ag / al));
  });

  return { name: `rsi_${period}`, values: rsiValues };
}

export function calculateMACD(
  bars: OHLCVBar[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: IndicatorResult; signal: IndicatorResult; histogram: IndicatorResult } {
  const closes = bars.map(b => b.close);
  const fastEMA = ema(closes, fastPeriod);
  const slowEMA = ema(closes, slowPeriod);

  const macdLine = combine(fastEMA, slowEMA, (a, b) => a - b);
  const macdNonNull = macdLine.map(v => v ?? 0);
  const signalLine = ema(macdNonNull, signalPeriod);
  const histogram = combine(macdLine, signalLine, (a, b) => a - b);

  return {
    macd: { name: `macd_${fastPeriod}_${slowPeriod}_${signalPeriod}`, values: macdLine },
    signal: { name: `macd_signal_${fastPeriod}_${slowPeriod}_${signalPeriod}`, values: signalLine },
    histogram: { name: `macd_hist_${fastPeriod}_${slowPeriod}_${signalPeriod}`, values: histogram }
  };
}

export function calculateBollingerBands(
  bars: OHLCVBar[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: IndicatorResult; middle: IndicatorResult; lower: IndicatorResult; pctB: IndicatorResult } {
  const closes = bars.map(b => b.close);
  const middle = sma(closes, period);
  const std = stddev(closes, period);

  const upper = combine(middle, std, (m, s) => m + stdDevMultiplier * s);
  const lower = combine(middle, std, (m, s) => m - stdDevMultiplier * s);

  const pctB = closes.map((c, i) => {
    const u = upper[i];
    const l = lower[i];
    if (u == null || l == null || u === l) return null;
    return (c - l) / (u - l);
  });

  return {
    upper: { name: `bb_upper_${period}`, values: upper },
    middle: { name: `bb_middle_${period}`, values: middle },
    lower: { name: `bb_lower_${period}`, values: lower },
    pctB: { name: `bb_pct_b_${period}`, values: pctB }
  };
}

export function calculateATR(bars: OHLCVBar[], period: number = 14): IndicatorResult {
  const tr = trueRange(bars);
  const trNonNull = tr.map(v => v ?? 0);
  const atrValues = sma(trNonNull, period);

  return { name: `atr_${period}`, values: atrValues };
}

export function calculateStochastic(
  bars: OHLCVBar[],
  kPeriod: number = 14,
  dPeriod: number = 3
): { k: IndicatorResult; d: IndicatorResult } {
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);

  const highestHigh = rollingMax(highs, kPeriod);
  const lowestLow = rollingMin(lows, kPeriod);

  const stochK = closes.map((c, i) => {
    const hh = highestHigh[i];
    const ll = lowestLow[i];
    if (hh == null || ll == null || hh === ll) return null;
    return ((c - ll) / (hh - ll)) * 100;
  });

  const stochKNonNull = stochK.map(v => v ?? 0);
  const stochD = sma(stochKNonNull, dPeriod);

  return {
    k: { name: `stoch_k_${kPeriod}`, values: stochK },
    d: { name: `stoch_d_${kPeriod}_${dPeriod}`, values: stochD }
  };
}

export function calculateCCI(bars: OHLCVBar[], period: number = 20): IndicatorResult {
  const tp = typicalPrice(bars);
  const tpSMA = sma(tp, period);

  const cciValues = tp.map((t, i) => {
    const mean = tpSMA[i];
    if (mean == null || i < period - 1) return null;

    const window = tp.slice(i - period + 1, i + 1);
    const meanDev = window.reduce((sum, v) => sum + Math.abs(v - mean), 0) / period;

    if (meanDev === 0) return null;
    return (t - mean) / (0.015 * meanDev);
  });

  return { name: `cci_${period}`, values: cciValues };
}

export function calculateWilliamsR(bars: OHLCVBar[], period: number = 14): IndicatorResult {
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);

  const highestHigh = rollingMax(highs, period);
  const lowestLow = rollingMin(lows, period);

  const willR = closes.map((c, i) => {
    const hh = highestHigh[i];
    const ll = lowestLow[i];
    if (hh == null || ll == null || hh === ll) return null;
    return ((hh - c) / (hh - ll)) * -100;
  });

  return { name: `williams_r_${period}`, values: willR };
}

export interface CalculateIndicatorParams {
  indicator: string;
  bars: OHLCVBar[];
  params?: Record<string, number>;
}

// ─── Calculator Dispatch Map (OCP: add new indicator = add entry here) ───────

type CalculatorFn = (bars: OHLCVBar[], params: Record<string, number>) => IndicatorResult[];

const INDICATOR_CALCULATORS: Record<string, CalculatorFn> = {
  sma:        (bars, p) => [{ name: `sma_${p.period}`, values: sma(bars.map(b => b.close), p.period!) }],
  ema:        (bars, p) => [{ name: `ema_${p.period}`, values: ema(bars.map(b => b.close), p.period!) }],
  wma:        (bars, p) => [{ name: `wma_${p.period}`, values: wma(bars.map(b => b.close), p.period!) }],
  stddev:     (bars, p) => [{ name: `stddev_${p.period}`, values: stddev(bars.map(b => b.close), p.period!) }],
  roc:        (bars, p) => [{ name: `roc_${p.period}`, values: roc(bars.map(b => b.close), p.period) }],
  momentum:   (bars, p) => [{ name: `momentum_${p.period}`, values: diff(bars.map(b => b.close), p.period) }],
  rsi:        (bars, p) => [calculateRSI(bars, p.period)],
  macd:       (bars, p) => {
    const r = calculateMACD(bars, p.fastPeriod, p.slowPeriod, p.signalPeriod);
    return [r.macd, r.signal, r.histogram];
  },
  bollinger:  (bars, p) => {
    const r = calculateBollingerBands(bars, p.period, p.stdDev);
    return [r.upper, r.middle, r.lower, r.pctB];
  },
  atr:        (bars, p) => [calculateATR(bars, p.period)],
  stochastic: (bars, p) => {
    const r = calculateStochastic(bars, p.kPeriod, p.dPeriod);
    return [r.k, r.d];
  },
  cci:        (bars, p) => [calculateCCI(bars, p.period)],
  williams_r: (bars, p) => [calculateWilliamsR(bars, p.period)],
};

export function calculateIndicator(request: CalculateIndicatorParams): IndicatorResult[] {
  const { indicator, bars, params = {} } = request;
  const def = INDICATOR_REGISTRY[indicator];

  if (!def) {
    throw new Error(`Unknown indicator: ${indicator}`);
  }

  const calculator = INDICATOR_CALCULATORS[indicator];
  if (!calculator) {
    throw new Error(`Indicator calculation not implemented: ${indicator}`);
  }

  const mergedParams = { ...def.defaultParams, ...params };
  return calculator(bars, mergedParams);
}
