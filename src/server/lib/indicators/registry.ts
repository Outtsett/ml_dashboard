/**
 * Technical Indicator Registry
 *
 * Metadata definitions for all 13 core indicators.
 * Lookup helpers and SQL generation dispatch.
 *
 * Calculation functions are in ./calculators.ts (SRP).
 */

import {
  rsiSQL, macdSQL, bollingerBandsSQL, atrSQL, stochasticSQL,
  cciSQL, williamsRSQL,
  type SQLGeneratorOptions, generateBulkIndicatorsSQL, type BulkIndicatorRequest
} from './sqlGenerator';

// Re-export calculators for backward compat
export {
  calculateRSI, calculateMACD, calculateBollingerBands,
  calculateATR, calculateStochastic, calculateCCI, calculateWilliamsR,
  calculateIndicator,
  type IndicatorResult, type CalculateIndicatorParams,
} from './calculators';

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
// SQL GENERATION FOR BATCH PROCESSING
// ============================================================================

export interface GenerateIndicatorSQLParams {
  indicator: string;
  params?: Record<string, number>;
  options?: SQLGeneratorOptions;
}

// ─── SQL Generator Dispatch Map (OCP: add new indicator = add entry here) ────

type SQLGeneratorFn = (params: Record<string, number>, options: SQLGeneratorOptions) => string;

const INDICATOR_SQL_DISPATCH: Record<string, SQLGeneratorFn> = {
  rsi:        (p, o) => rsiSQL(p.period, o),
  macd:       (p, o) => macdSQL(p.fastPeriod, p.slowPeriod, p.signalPeriod, o),
  bollinger:  (p, o) => bollingerBandsSQL(p.period, p.stdDev, o),
  atr:        (p, o) => atrSQL(p.period, o),
  stochastic: (p, o) => stochasticSQL(p.kPeriod, p.dPeriod, o),
  cci:        (p, o) => cciSQL(p.period, o),
  williams_r: (p, o) => williamsRSQL(p.period, o),
  sma:        (p, o) => generateBulkIndicatorsSQL({ sma: [p.period!] }, o),
  ema:        (p, o) => generateBulkIndicatorsSQL({ ema: [p.period!] }, o),
  wma:        (p, o) => generateBulkIndicatorsSQL({ sma: [p.period!] }, o), // WMA approximated as SMA in SQL
  stddev:     (p, o) => generateBulkIndicatorsSQL({ stddev: [p.period!] }, o),
  roc:        (p, o) => generateBulkIndicatorsSQL({ roc: [p.period!] }, o),
  momentum:   (p, o) => generateBulkIndicatorsSQL({ momentum: [p.period!] }, o),
};

export function generateIndicatorSQL(request: GenerateIndicatorSQLParams): string {
  const { indicator, params = {}, options = {} } = request;
  const def = INDICATOR_REGISTRY[indicator];

  if (!def) {
    throw new Error(`Unknown indicator: ${indicator}`);
  }

  const dispatch = INDICATOR_SQL_DISPATCH[indicator];
  if (!dispatch) {
    throw new Error(`SQL generation not implemented for: ${indicator}`);
  }

  const mergedParams = { ...def.defaultParams, ...params };
  return dispatch(mergedParams, options);
}

// ============================================================================
// LOOKUP HELPERS
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
