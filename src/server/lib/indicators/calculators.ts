/**
 * Technical Indicator Calculators
 *
 * TypeScript calculation functions for each core indicator.
 * Uses math primitives from ./math.ts.
 */

import {
  OHLCVBar, sma, ema, wma, stddev, rollingMax, rollingMin,
  diff, roc, trueRange, typicalPrice, gains, losses, combine
} from './math';
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

export function calculateIndicator(request: CalculateIndicatorParams): IndicatorResult[] {
  const { indicator, bars, params = {} } = request;
  const def = INDICATOR_REGISTRY[indicator];

  if (!def) {
    throw new Error(`Unknown indicator: ${indicator}`);
  }

  const mergedParams = { ...def.defaultParams, ...params };
  const closes = bars.map(b => b.close);

  switch (indicator) {
    case 'sma':
      return [{ name: `sma_${mergedParams.period}`, values: sma(closes, mergedParams.period!) }];

    case 'ema':
      return [{ name: `ema_${mergedParams.period}`, values: ema(closes, mergedParams.period!) }];

    case 'wma':
      return [{ name: `wma_${mergedParams.period}`, values: wma(closes, mergedParams.period!) }];

    case 'stddev':
      return [{ name: `stddev_${mergedParams.period}`, values: stddev(closes, mergedParams.period!) }];

    case 'roc':
      return [{ name: `roc_${mergedParams.period}`, values: roc(closes, mergedParams.period) }];

    case 'momentum':
      return [{ name: `momentum_${mergedParams.period}`, values: diff(closes, mergedParams.period) }];

    case 'rsi':
      return [calculateRSI(bars, mergedParams.period)];

    case 'macd': {
      const macdResult = calculateMACD(bars, mergedParams.fastPeriod, mergedParams.slowPeriod, mergedParams.signalPeriod);
      return [macdResult.macd, macdResult.signal, macdResult.histogram];
    }

    case 'bollinger': {
      const bbResult = calculateBollingerBands(bars, mergedParams.period, mergedParams.stdDev);
      return [bbResult.upper, bbResult.middle, bbResult.lower, bbResult.pctB];
    }

    case 'atr':
      return [calculateATR(bars, mergedParams.period)];

    case 'stochastic': {
      const stochResult = calculateStochastic(bars, mergedParams.kPeriod, mergedParams.dPeriod);
      return [stochResult.k, stochResult.d];
    }

    case 'cci':
      return [calculateCCI(bars, mergedParams.period)];

    case 'williams_r':
      return [calculateWilliamsR(bars, mergedParams.period)];

    default:
      throw new Error(`Indicator calculation not implemented: ${indicator}`);
  }
}
