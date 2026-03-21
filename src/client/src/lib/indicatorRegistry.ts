/**
 * Indicator Registry — defines ALL available indicators as configurable entities.
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
  'overlap', 'momentum', 'trend', 'volatility', 'volume',
];

export const CATEGORY_LABELS: Record<IndicatorCategory, string> = {
  overlap: 'Overlap',
  momentum: 'Momentum',
  trend: 'Trend',
  volatility: 'Volatility',
  volume: 'Volume',
  statistics: 'Statistics',
};
