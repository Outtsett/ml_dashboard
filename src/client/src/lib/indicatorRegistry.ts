/**
 * Indicator Registry — defines ALL available TA-Lib indicators as configurable entities.
 *
 * This is the single source of truth for indicator metadata. Each definition
 * specifies the indicator's params, defaults, render type, and outputs.
 * The UI uses this to build the indicator catalog and settings panels.
 * The compute layer uses this to dispatch calculations.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IndicatorParam {
  key: string;
  label: string;
  type: 'number';
  default: number;
  min: number;
  max: number;
  step: number;
}

export type IndicatorCategory = 'momentum' | 'trend' | 'volatility' | 'volume' | 'overlap' | 'statistics';

export interface IndicatorOutput {
  key: string;
  label: string;
  style: 'line' | 'histogram';
}

export interface ReferenceLine {
  value: number;
  color: string;
  dash?: number[];
}

export interface IndicatorDefinition {
  id: string;
  name: string;
  fullName: string;
  category: IndicatorCategory;
  renderType: 'overlay' | 'subchart';
  params: IndicatorParam[];
  outputs: IndicatorOutput[];
  referenceLines?: ReferenceLine[];
}

// ─── Indicator Definitions ───────────────────────────────────────────────────

export const INDICATOR_REGISTRY: IndicatorDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // OVERLAP (render on price chart)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'sma',
    name: 'SMA',
    fullName: 'Simple Moving Average',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'SMA', style: 'line' }],
  },
  {
    id: 'ema',
    name: 'EMA',
    fullName: 'Exponential Moving Average',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'EMA', style: 'line' }],
  },
  {
    id: 'wma',
    name: 'WMA',
    fullName: 'Weighted Moving Average',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'WMA', style: 'line' }],
  },
  {
    id: 'dema',
    name: 'DEMA',
    fullName: 'Double Exponential Moving Average',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'DEMA', style: 'line' }],
  },
  {
    id: 'tema',
    name: 'TEMA',
    fullName: 'Triple Exponential Moving Average',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'TEMA', style: 'line' }],
  },
  {
    id: 'trima',
    name: 'TRIMA',
    fullName: 'Triangular Moving Average',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 30, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'TRIMA', style: 'line' }],
  },
  {
    id: 't3',
    name: 'T3',
    fullName: 'Triple Exponential T3',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 5, min: 1, max: 200, step: 1 },
      { key: 'vFactor', label: 'V-Factor', type: 'number', default: 0.7, min: 0.0, max: 1.0, step: 0.05 },
    ],
    outputs: [{ key: 'value', label: 'T3', style: 'line' }],
  },
  {
    id: 'bbands',
    name: 'Bollinger Bands',
    fullName: 'Bollinger Bands',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 500, step: 1 },
      { key: 'stdDev', label: 'Std Dev', type: 'number', default: 2.0, min: 0.5, max: 5.0, step: 0.5 },
    ],
    outputs: [
      { key: 'upper', label: 'Upper', style: 'line' },
      { key: 'middle', label: 'Middle', style: 'line' },
      { key: 'lower', label: 'Lower', style: 'line' },
    ],
  },
  {
    id: 'kama',
    name: 'KAMA',
    fullName: 'Kaufman Adaptive Moving Average',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 10, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'KAMA', style: 'line' }],
  },
  {
    id: 'mama',
    name: 'MAMA/FAMA',
    fullName: 'MESA Adaptive Moving Average',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'fastLimit', label: 'Fast Limit', type: 'number', default: 0.5, min: 0.01, max: 0.99, step: 0.01 },
      { key: 'slowLimit', label: 'Slow Limit', type: 'number', default: 0.05, min: 0.01, max: 0.99, step: 0.01 },
    ],
    outputs: [
      { key: 'mama', label: 'MAMA', style: 'line' },
      { key: 'fama', label: 'FAMA', style: 'line' },
    ],
  },
  {
    id: 'midpoint',
    name: 'Midpoint',
    fullName: 'Midpoint Over Period',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'MIDPOINT', style: 'line' }],
  },
  {
    id: 'midprice',
    name: 'Midprice',
    fullName: 'Midpoint Price Over Period',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'MIDPRICE', style: 'line' }],
  },
  {
    id: 'ht_trendline',
    name: 'HT Trendline',
    fullName: 'Hilbert Transform Instantaneous Trendline',
    category: 'overlap',
    renderType: 'overlay',
    params: [],
    outputs: [{ key: 'value', label: 'HT_TRENDLINE', style: 'line' }],
  },
  {
    id: 'tsf',
    name: 'TSF',
    fullName: 'Time Series Forecast',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'TSF', style: 'line' }],
  },
  {
    id: 'linearreg',
    name: 'Linear Reg',
    fullName: 'Linear Regression',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'LINREG', style: 'line' }],
  },
  {
    id: 'psar',
    name: 'Parabolic SAR',
    fullName: 'Parabolic Stop and Reverse',
    category: 'overlap',
    renderType: 'overlay',
    params: [
      { key: 'step', label: 'Step', type: 'number', default: 0.02, min: 0.001, max: 0.1, step: 0.001 },
      { key: 'max', label: 'Max', type: 'number', default: 0.2, min: 0.01, max: 0.5, step: 0.01 },
    ],
    outputs: [{ key: 'value', label: 'SAR', style: 'line' }],
  },
  {
    id: 'vwap',
    name: 'VWAP',
    fullName: 'Volume Weighted Average Price',
    category: 'overlap',
    renderType: 'overlay',
    params: [],
    outputs: [{ key: 'value', label: 'VWAP', style: 'line' }],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MOMENTUM (subchart)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'rsi',
    name: 'RSI',
    fullName: 'Relative Strength Index',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'RSI', style: 'line' }],
    referenceLines: [
      { value: 70, color: 'rgba(239, 68, 68, 0.3)' },
      { value: 50, color: 'rgba(255, 255, 255, 0.06)' },
      { value: 30, color: 'rgba(34, 197, 94, 0.3)' },
    ],
  },
  {
    id: 'macd',
    name: 'MACD',
    fullName: 'Moving Average Convergence Divergence',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'fastPeriod', label: 'Fast', type: 'number', default: 12, min: 2, max: 100, step: 1 },
      { key: 'slowPeriod', label: 'Slow', type: 'number', default: 26, min: 2, max: 200, step: 1 },
      { key: 'signalPeriod', label: 'Signal', type: 'number', default: 9, min: 2, max: 50, step: 1 },
    ],
    outputs: [
      { key: 'macd', label: 'MACD', style: 'line' },
      { key: 'signal', label: 'Signal', style: 'line' },
      { key: 'histogram', label: 'Histogram', style: 'histogram' },
    ],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'macdext',
    name: 'MACD Ext',
    fullName: 'MACD with Controllable MA Type',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'fastPeriod', label: 'Fast', type: 'number', default: 12, min: 2, max: 100, step: 1 },
      { key: 'slowPeriod', label: 'Slow', type: 'number', default: 26, min: 2, max: 200, step: 1 },
      { key: 'signalPeriod', label: 'Signal', type: 'number', default: 9, min: 2, max: 50, step: 1 },
    ],
    outputs: [
      { key: 'macd', label: 'MACD', style: 'line' },
      { key: 'signal', label: 'Signal', style: 'line' },
      { key: 'histogram', label: 'Histogram', style: 'histogram' },
    ],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'macdfix',
    name: 'MACD Fix',
    fullName: 'MACD Fix 12/26',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'signalPeriod', label: 'Signal', type: 'number', default: 9, min: 2, max: 50, step: 1 },
    ],
    outputs: [
      { key: 'macd', label: 'MACD', style: 'line' },
      { key: 'signal', label: 'Signal', style: 'line' },
      { key: 'histogram', label: 'Histogram', style: 'histogram' },
    ],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'stochastic',
    name: 'Stochastic',
    fullName: 'Stochastic Oscillator',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'kPeriod', label: '%K Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
      { key: 'kSmooth', label: '%K Smooth', type: 'number', default: 3, min: 1, max: 20, step: 1 },
      { key: 'dSmooth', label: '%D Smooth', type: 'number', default: 3, min: 1, max: 20, step: 1 },
    ],
    outputs: [
      { key: 'k', label: '%K', style: 'line' },
      { key: 'd', label: '%D', style: 'line' },
    ],
    referenceLines: [
      { value: 80, color: 'rgba(239, 68, 68, 0.3)' },
      { value: 20, color: 'rgba(34, 197, 94, 0.3)' },
    ],
  },
  {
    id: 'stochf',
    name: 'Fast Stochastic',
    fullName: 'Fast Stochastic Oscillator',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'kPeriod', label: '%K Period', type: 'number', default: 5, min: 2, max: 100, step: 1 },
      { key: 'dPeriod', label: '%D Period', type: 'number', default: 3, min: 1, max: 20, step: 1 },
    ],
    outputs: [
      { key: 'k', label: 'Fast %K', style: 'line' },
      { key: 'd', label: 'Fast %D', style: 'line' },
    ],
    referenceLines: [
      { value: 80, color: 'rgba(239, 68, 68, 0.3)' },
      { value: 20, color: 'rgba(34, 197, 94, 0.3)' },
    ],
  },
  {
    id: 'stochrsi',
    name: 'Stochastic RSI',
    fullName: 'Stochastic RSI',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'rsiPeriod', label: 'RSI Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
      { key: 'stochPeriod', label: 'Stoch Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
      { key: 'kSmooth', label: '%K Smooth', type: 'number', default: 3, min: 1, max: 20, step: 1 },
      { key: 'dSmooth', label: '%D Smooth', type: 'number', default: 3, min: 1, max: 20, step: 1 },
    ],
    outputs: [
      { key: 'k', label: '%K', style: 'line' },
      { key: 'd', label: '%D', style: 'line' },
    ],
    referenceLines: [
      { value: 80, color: 'rgba(239, 68, 68, 0.3)' },
      { value: 20, color: 'rgba(34, 197, 94, 0.3)' },
    ],
  },
  {
    id: 'cci',
    name: 'CCI',
    fullName: 'Commodity Channel Index',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'CCI', style: 'line' }],
    referenceLines: [
      { value: 100, color: 'rgba(239, 68, 68, 0.3)' },
      { value: 0, color: 'rgba(255, 255, 255, 0.06)' },
      { value: -100, color: 'rgba(34, 197, 94, 0.3)' },
    ],
  },
  {
    id: 'willr',
    name: 'Williams %R',
    fullName: 'Williams Percent Range',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: '%R', style: 'line' }],
    referenceLines: [
      { value: -20, color: 'rgba(239, 68, 68, 0.3)' },
      { value: -80, color: 'rgba(34, 197, 94, 0.3)' },
    ],
  },
  {
    id: 'momentum',
    name: 'Momentum',
    fullName: 'Momentum',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 10, min: 1, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'MOM', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'roc',
    name: 'ROC',
    fullName: 'Rate of Change',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 10, min: 1, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'ROC', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'rocp',
    name: 'ROC %',
    fullName: 'Rate of Change Percentage',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 10, min: 1, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'ROCP', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'rocr',
    name: 'ROCR',
    fullName: 'Rate of Change Ratio',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 10, min: 1, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'ROCR', style: 'line' }],
    referenceLines: [
      { value: 1, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'rocr100',
    name: 'ROCR 100',
    fullName: 'Rate of Change Ratio x100',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 10, min: 1, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'ROCR100', style: 'line' }],
    referenceLines: [
      { value: 100, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'cmo',
    name: 'CMO',
    fullName: 'Chande Momentum Oscillator',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'CMO', style: 'line' }],
    referenceLines: [
      { value: 50, color: 'rgba(239, 68, 68, 0.3)' },
      { value: 0, color: 'rgba(255, 255, 255, 0.06)' },
      { value: -50, color: 'rgba(34, 197, 94, 0.3)' },
    ],
  },
  {
    id: 'apo',
    name: 'APO',
    fullName: 'Absolute Price Oscillator',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'fastPeriod', label: 'Fast', type: 'number', default: 12, min: 2, max: 100, step: 1 },
      { key: 'slowPeriod', label: 'Slow', type: 'number', default: 26, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'APO', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'ppo',
    name: 'PPO',
    fullName: 'Percentage Price Oscillator',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'fastPeriod', label: 'Fast', type: 'number', default: 12, min: 2, max: 100, step: 1 },
      { key: 'slowPeriod', label: 'Slow', type: 'number', default: 26, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'PPO', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'trix',
    name: 'TRIX',
    fullName: 'Triple Smooth EMA ROC',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 15, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'TRIX', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'ultosc',
    name: 'Ultimate Osc',
    fullName: 'Ultimate Oscillator',
    category: 'momentum',
    renderType: 'subchart',
    params: [
      { key: 'period1', label: 'Period 1', type: 'number', default: 7, min: 1, max: 50, step: 1 },
      { key: 'period2', label: 'Period 2', type: 'number', default: 14, min: 1, max: 100, step: 1 },
      { key: 'period3', label: 'Period 3', type: 'number', default: 28, min: 1, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'ULTOSC', style: 'line' }],
    referenceLines: [
      { value: 70, color: 'rgba(239, 68, 68, 0.3)' },
      { value: 30, color: 'rgba(34, 197, 94, 0.3)' },
    ],
  },
  {
    id: 'bop',
    name: 'BOP',
    fullName: 'Balance of Power',
    category: 'momentum',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'BOP', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TREND (subchart)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'adx',
    name: 'ADX',
    fullName: 'Average Directional Index',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [
      { key: 'adx', label: 'ADX', style: 'line' },
      { key: 'plusDI', label: '+DI', style: 'line' },
      { key: 'minusDI', label: '-DI', style: 'line' },
    ],
    referenceLines: [
      { value: 25, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'adxr',
    name: 'ADXR',
    fullName: 'Average Directional Index Rating',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'ADXR', style: 'line' }],
    referenceLines: [
      { value: 25, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'dx',
    name: 'DX',
    fullName: 'Directional Movement Index',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'DX', style: 'line' }],
    referenceLines: [
      { value: 25, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'plus_di',
    name: '+DI',
    fullName: 'Plus Directional Indicator',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: '+DI', style: 'line' }],
  },
  {
    id: 'minus_di',
    name: '-DI',
    fullName: 'Minus Directional Indicator',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: '-DI', style: 'line' }],
  },
  {
    id: 'plus_dm',
    name: '+DM',
    fullName: 'Plus Directional Movement',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: '+DM', style: 'line' }],
  },
  {
    id: 'minus_dm',
    name: '-DM',
    fullName: 'Minus Directional Movement',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: '-DM', style: 'line' }],
  },
  {
    id: 'aroon',
    name: 'Aroon',
    fullName: 'Aroon Indicator',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 25, min: 2, max: 200, step: 1 },
    ],
    outputs: [
      { key: 'up', label: 'Up', style: 'line' },
      { key: 'down', label: 'Down', style: 'line' },
    ],
    referenceLines: [
      { value: 70, color: 'rgba(239, 68, 68, 0.25)' },
      { value: 30, color: 'rgba(34, 197, 94, 0.25)' },
    ],
  },
  {
    id: 'aroonosc',
    name: 'Aroon Osc',
    fullName: 'Aroon Oscillator',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 25, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'AROONOSC', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'ht_trendmode',
    name: 'HT Trend Mode',
    fullName: 'Hilbert Transform Trend vs Cycle Mode',
    category: 'trend',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'HT_TRENDMODE', style: 'line' }],
    referenceLines: [
      { value: 0.5, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VOLATILITY (subchart)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'atr',
    name: 'ATR',
    fullName: 'Average True Range',
    category: 'volatility',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'ATR', style: 'line' }],
  },
  {
    id: 'natr',
    name: 'NATR',
    fullName: 'Normalized Average True Range',
    category: 'volatility',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'NATR', style: 'line' }],
  },
  {
    id: 'trange',
    name: 'True Range',
    fullName: 'True Range',
    category: 'volatility',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'TRANGE', style: 'line' }],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VOLUME (subchart)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'obv',
    name: 'OBV',
    fullName: 'On Balance Volume',
    category: 'volume',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'OBV', style: 'line' }],
  },
  {
    id: 'ad',
    name: 'AD',
    fullName: 'Accumulation/Distribution',
    category: 'volume',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'A/D', style: 'line' }],
  },
  {
    id: 'adosc',
    name: 'AD Osc',
    fullName: 'Chaikin A/D Oscillator',
    category: 'volume',
    renderType: 'subchart',
    params: [
      { key: 'fastPeriod', label: 'Fast', type: 'number', default: 3, min: 2, max: 50, step: 1 },
      { key: 'slowPeriod', label: 'Slow', type: 'number', default: 10, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'ADOSC', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'mfi',
    name: 'MFI',
    fullName: 'Money Flow Index',
    category: 'volume',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'MFI', style: 'line' }],
    referenceLines: [
      { value: 80, color: 'rgba(239, 68, 68, 0.3)' },
      { value: 20, color: 'rgba(34, 197, 94, 0.3)' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STATISTICS (subchart)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'stddev',
    name: 'Std Dev',
    fullName: 'Standard Deviation',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'STDEV', style: 'line' }],
  },
  {
    id: 'variance',
    name: 'Variance',
    fullName: 'Variance',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'VAR', style: 'line' }],
  },
  {
    id: 'beta',
    name: 'Beta',
    fullName: 'Beta',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 5, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'BETA', style: 'line' }],
    referenceLines: [
      { value: 1, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'correl',
    name: 'Correlation',
    fullName: 'Pearson Correlation Coefficient',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'CORREL', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'linreg_slope',
    name: 'LinReg Slope',
    fullName: 'Linear Regression Slope',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'SLOPE', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'linreg_angle',
    name: 'LinReg Angle',
    fullName: 'Linear Regression Angle',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'ANGLE', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
    ],
  },
  {
    id: 'linreg_intercept',
    name: 'LinReg Intercept',
    fullName: 'Linear Regression Intercept',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'INTERCEPT', style: 'line' }],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HILBERT TRANSFORM (subchart)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'ht_dcperiod',
    name: 'HT DC Period',
    fullName: 'Hilbert Transform Dominant Cycle Period',
    category: 'statistics',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'HT_DCPERIOD', style: 'line' }],
  },
  {
    id: 'ht_dcphase',
    name: 'HT DC Phase',
    fullName: 'Hilbert Transform Dominant Cycle Phase',
    category: 'statistics',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'HT_DCPHASE', style: 'line' }],
  },
  {
    id: 'ht_phasor',
    name: 'HT Phasor',
    fullName: 'Hilbert Transform Phasor Components',
    category: 'statistics',
    renderType: 'subchart',
    params: [],
    outputs: [
      { key: 'inphase', label: 'InPhase', style: 'line' },
      { key: 'quadrature', label: 'Quadrature', style: 'line' },
    ],
  },
  {
    id: 'ht_sine',
    name: 'HT Sine',
    fullName: 'Hilbert Transform Sine Wave',
    category: 'statistics',
    renderType: 'subchart',
    params: [],
    outputs: [
      { key: 'sine', label: 'Sine', style: 'line' },
      { key: 'leadsine', label: 'Lead Sine', style: 'line' },
    ],
    referenceLines: [
      { value: 0, color: 'rgba(255, 255, 255, 0.06)' },
    ],
  },
];

// ─── Lookup Helpers ──────────────────────────────────────────────────────────

const REGISTRY_MAP = new Map<string, IndicatorDefinition>();
for (const def of INDICATOR_REGISTRY) {
  REGISTRY_MAP.set(def.id, def);
}

export function getIndicatorDefinition(id: string): IndicatorDefinition | undefined {
  return REGISTRY_MAP.get(id);
}

export function getIndicatorsByCategory(category: IndicatorCategory): IndicatorDefinition[] {
  return INDICATOR_REGISTRY.filter(d => d.category === category);
}

/** All categories in display order */
export const CATEGORY_ORDER: IndicatorCategory[] = [
  'overlap', 'momentum', 'trend', 'volatility', 'volume', 'statistics',
];

export const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  overlap: 'Overlap',
  momentum: 'Momentum',
  trend: 'Trend',
  volatility: 'Volatility',
  volume: 'Volume',
  statistics: 'Statistics',
};
