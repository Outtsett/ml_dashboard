/**
 * Technical Indicator Registry
 * 
 * Defines all indicators as compositions of core math primitives.
 * Each indicator has:
 * - Name and description
 * - Default parameters
 * - TypeScript calculation function
 * - SQL generation function for DuckDB batch processing
 */

import {
  OHLCVBar, sma, ema, wma, stddev, rollingMax, rollingMin,
  diff, roc, trueRange, typicalPrice, gains, losses, combine
} from './math';
import {
  rsiSQL, macdSQL, bollingerBandsSQL, atrSQL, stochasticSQL, 
  cciSQL, williamsRSQL, smaSQL, stddevSQL, lagSQL, diffSQL, rocSQL,
  SQLGeneratorOptions, generateBulkIndicatorsSQL, BulkIndicatorRequest
} from './sqlGenerator';

// ============================================================================
// INDICATOR DEFINITIONS
// ============================================================================

export interface IndicatorDefinition {
  id: string;
  name: string;
  category: 'trend' | 'momentum' | 'volatility' | 'volume' | 'overlap';
  description: string;
  defaultParams: Record<string, number>;
  paramDescriptions: Record<string, string>;
  outputs: string[];
}

export const INDICATOR_REGISTRY: Record<string, IndicatorDefinition> = {
  sma: {
    id: 'sma',
    name: 'Simple Moving Average',
    category: 'overlap',
    description: 'Average of closing prices over a period',
    defaultParams: { period: 20 },
    paramDescriptions: { period: 'Lookback period' },
    outputs: ['sma']
  },
  ema: {
    id: 'ema',
    name: 'Exponential Moving Average',
    category: 'overlap',
    description: 'Weighted average giving more weight to recent prices',
    defaultParams: { period: 20 },
    paramDescriptions: { period: 'Lookback period' },
    outputs: ['ema']
  },
  wma: {
    id: 'wma',
    name: 'Weighted Moving Average',
    category: 'overlap',
    description: 'Linearly weighted average of prices',
    defaultParams: { period: 20 },
    paramDescriptions: { period: 'Lookback period' },
    outputs: ['wma']
  },
  rsi: {
    id: 'rsi',
    name: 'Relative Strength Index',
    category: 'momentum',
    description: 'Momentum oscillator measuring speed and change of price movements',
    defaultParams: { period: 14 },
    paramDescriptions: { period: 'Lookback period for RSI calculation' },
    outputs: ['rsi']
  },
  macd: {
    id: 'macd',
    name: 'Moving Average Convergence Divergence',
    category: 'momentum',
    description: 'Trend-following momentum indicator showing relationship between two EMAs',
    defaultParams: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    paramDescriptions: {
      fastPeriod: 'Fast EMA period',
      slowPeriod: 'Slow EMA period',
      signalPeriod: 'Signal line EMA period'
    },
    outputs: ['macd', 'macd_signal', 'macd_histogram']
  },
  bollinger: {
    id: 'bollinger',
    name: 'Bollinger Bands',
    category: 'volatility',
    description: 'Volatility bands placed above and below a moving average',
    defaultParams: { period: 20, stdDev: 2 },
    paramDescriptions: {
      period: 'SMA lookback period',
      stdDev: 'Standard deviation multiplier'
    },
    outputs: ['bb_upper', 'bb_middle', 'bb_lower', 'bb_pct_b']
  },
  atr: {
    id: 'atr',
    name: 'Average True Range',
    category: 'volatility',
    description: 'Measures market volatility by decomposing the range of an asset price',
    defaultParams: { period: 14 },
    paramDescriptions: { period: 'Lookback period' },
    outputs: ['atr']
  },
  stochastic: {
    id: 'stochastic',
    name: 'Stochastic Oscillator',
    category: 'momentum',
    description: 'Momentum indicator comparing closing price to price range over a period',
    defaultParams: { kPeriod: 14, dPeriod: 3 },
    paramDescriptions: {
      kPeriod: '%K lookback period',
      dPeriod: '%D smoothing period'
    },
    outputs: ['stoch_k', 'stoch_d']
  },
  cci: {
    id: 'cci',
    name: 'Commodity Channel Index',
    category: 'momentum',
    description: 'Measures deviation of price from its average',
    defaultParams: { period: 20 },
    paramDescriptions: { period: 'Lookback period' },
    outputs: ['cci']
  },
  williams_r: {
    id: 'williams_r',
    name: 'Williams %R',
    category: 'momentum',
    description: 'Momentum indicator showing overbought/oversold levels',
    defaultParams: { period: 14 },
    paramDescriptions: { period: 'Lookback period' },
    outputs: ['williams_r']
  },
  roc: {
    id: 'roc',
    name: 'Rate of Change',
    category: 'momentum',
    description: 'Percentage change between current and past price',
    defaultParams: { period: 10 },
    paramDescriptions: { period: 'Lookback period' },
    outputs: ['roc']
  },
  momentum: {
    id: 'momentum',
    name: 'Momentum',
    category: 'momentum',
    description: 'Difference between current and past price',
    defaultParams: { period: 10 },
    paramDescriptions: { period: 'Lookback period' },
    outputs: ['momentum']
  },
  stddev: {
    id: 'stddev',
    name: 'Standard Deviation',
    category: 'volatility',
    description: 'Measures the dispersion of prices from the mean',
    defaultParams: { period: 20 },
    paramDescriptions: { period: 'Lookback period' },
    outputs: ['stddev']
  }
};

// ============================================================================
// TYPESCRIPT CALCULATIONS
// ============================================================================

export interface IndicatorResult {
  name: string;
  values: (number | null)[];
}

/**
 * Calculate RSI from OHLCV bars
 */
export function calculateRSI(bars: OHLCVBar[], period: number = 14): IndicatorResult {
  const closes = bars.map(b => b.close);
  const g = gains(closes).map(v => v ?? 0);
  const l = losses(closes).map(v => v ?? 0);
  
  const avgGain = sma(g, period);
  const avgLoss = sma(l, period);
  
  const rsiValues = avgGain.map((ag, i) => {
    const al = avgLoss[i];
    if (ag === null || al === null || al === 0) return null;
    return 100 - (100 / (1 + ag / al));
  });

  return { name: `rsi_${period}`, values: rsiValues };
}

/**
 * Calculate MACD from OHLCV bars
 */
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

/**
 * Calculate Bollinger Bands from OHLCV bars
 */
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
    if (u === null || l === null || u === l) return null;
    return (c - l) / (u - l);
  });

  return {
    upper: { name: `bb_upper_${period}`, values: upper },
    middle: { name: `bb_middle_${period}`, values: middle },
    lower: { name: `bb_lower_${period}`, values: lower },
    pctB: { name: `bb_pct_b_${period}`, values: pctB }
  };
}

/**
 * Calculate ATR from OHLCV bars
 */
export function calculateATR(bars: OHLCVBar[], period: number = 14): IndicatorResult {
  const tr = trueRange(bars);
  const trNonNull = tr.map(v => v ?? 0);
  const atrValues = sma(trNonNull, period);

  return { name: `atr_${period}`, values: atrValues };
}

/**
 * Calculate Stochastic Oscillator from OHLCV bars
 */
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
    if (hh === null || ll === null || hh === ll) return null;
    return ((c - ll) / (hh - ll)) * 100;
  });

  const stochKNonNull = stochK.map(v => v ?? 0);
  const stochD = sma(stochKNonNull, dPeriod);

  return {
    k: { name: `stoch_k_${kPeriod}`, values: stochK },
    d: { name: `stoch_d_${kPeriod}_${dPeriod}`, values: stochD }
  };
}

/**
 * Calculate CCI from OHLCV bars
 */
export function calculateCCI(bars: OHLCVBar[], period: number = 20): IndicatorResult {
  const tp = typicalPrice(bars);
  const tpSMA = sma(tp, period);
  
  const cciValues = tp.map((t, i) => {
    const mean = tpSMA[i];
    if (mean === null || i < period - 1) return null;
    
    // Calculate mean deviation
    const window = tp.slice(i - period + 1, i + 1);
    const meanDev = window.reduce((sum, v) => sum + Math.abs(v - mean), 0) / period;
    
    if (meanDev === 0) return null;
    return (t - mean) / (0.015 * meanDev);
  });

  return { name: `cci_${period}`, values: cciValues };
}

/**
 * Calculate Williams %R from OHLCV bars
 */
export function calculateWilliamsR(bars: OHLCVBar[], period: number = 14): IndicatorResult {
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const closes = bars.map(b => b.close);

  const highestHigh = rollingMax(highs, period);
  const lowestLow = rollingMin(lows, period);

  const willR = closes.map((c, i) => {
    const hh = highestHigh[i];
    const ll = lowestLow[i];
    if (hh === null || ll === null || hh === ll) return null;
    return ((hh - c) / (hh - ll)) * -100;
  });

  return { name: `williams_r_${period}`, values: willR };
}

// ============================================================================
// UNIFIED INDICATOR CALCULATOR
// ============================================================================

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
      return [{ name: `sma_${mergedParams.period}`, values: sma(closes, mergedParams.period) }];
    
    case 'ema':
      return [{ name: `ema_${mergedParams.period}`, values: ema(closes, mergedParams.period) }];
    
    case 'wma':
      return [{ name: `wma_${mergedParams.period}`, values: wma(closes, mergedParams.period) }];
    
    case 'stddev':
      return [{ name: `stddev_${mergedParams.period}`, values: stddev(closes, mergedParams.period) }];
    
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

// ============================================================================
// SQL GENERATION FOR BATCH PROCESSING
// ============================================================================

export interface GenerateIndicatorSQLParams {
  indicator: string;
  params?: Record<string, number>;
  options?: SQLGeneratorOptions;
}

export function generateIndicatorSQL(request: GenerateIndicatorSQLParams): string {
  const { indicator, params = {}, options = {} } = request;
  const def = INDICATOR_REGISTRY[indicator];
  
  if (!def) {
    throw new Error(`Unknown indicator: ${indicator}`);
  }

  const mergedParams = { ...def.defaultParams, ...params };

  switch (indicator) {
    case 'rsi':
      return rsiSQL(mergedParams.period, options);
    
    case 'macd':
      return macdSQL(mergedParams.fastPeriod, mergedParams.slowPeriod, mergedParams.signalPeriod, options);
    
    case 'bollinger':
      return bollingerBandsSQL(mergedParams.period, mergedParams.stdDev, options);
    
    case 'atr':
      return atrSQL(mergedParams.period, options);
    
    case 'stochastic':
      return stochasticSQL(mergedParams.kPeriod, mergedParams.dPeriod, options);
    
    case 'cci':
      return cciSQL(mergedParams.period, options);
    
    case 'williams_r':
      return williamsRSQL(mergedParams.period, options);
    
    default:
      // For simple indicators, generate bulk SQL
      const bulkRequest: BulkIndicatorRequest = {};
      switch (indicator) {
        case 'sma':
          bulkRequest.sma = [mergedParams.period];
          break;
        case 'stddev':
          bulkRequest.stddev = [mergedParams.period];
          break;
        case 'roc':
          bulkRequest.roc = [mergedParams.period];
          break;
        case 'momentum':
          bulkRequest.momentum = [mergedParams.period];
          break;
        default:
          throw new Error(`SQL generation not implemented for: ${indicator}`);
      }
      return generateBulkIndicatorsSQL(bulkRequest, options);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function listIndicators(): IndicatorDefinition[] {
  return Object.values(INDICATOR_REGISTRY);
}

export function getIndicatorsByCategory(category: IndicatorDefinition['category']): IndicatorDefinition[] {
  return Object.values(INDICATOR_REGISTRY).filter(ind => ind.category === category);
}

export function getIndicator(id: string): IndicatorDefinition | undefined {
  return INDICATOR_REGISTRY[id];
}
