import type { IndicatorDefinition } from '../../indicator_registry';

export const VOLATILITY_INDICATORS: IndicatorDefinition[] = [
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
  {
    id: 'aberration',
    name: 'Aberration',
    fullName: 'Aberration',
    category: 'volatility',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 1, max: 500, step: 1 },
      { key: 'atrPeriod', label: 'ATR Period', type: 'number', default: 14, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'Aberration', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255,255,255,0.1)' },
    ],
  },
  {
    id: 'massi',
    name: 'MASSI',
    fullName: 'Mass Index',
    category: 'volatility',
    renderType: 'subchart',
    params: [
      { key: 'emaPeriod', label: 'EMA Period', type: 'number', default: 9, min: 1, max: 200, step: 1 },
      { key: 'sumPeriod', label: 'Sum Period', type: 'number', default: 25, min: 1, max: 200, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'MASSI', style: 'line' }],
    referenceLines: [
      { value: 27, color: 'rgba(239,68,68,0.3)' },
      { value: 26.5, color: 'rgba(34,197,94,0.3)' },
    ],
  },
  {
    id: 'ui',
    name: 'UI',
    fullName: 'Ulcer Index',
    category: 'volatility',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'UI', style: 'line' }],
  },
  {
    id: 'pdist',
    name: 'PDIST',
    fullName: 'Price Distance',
    category: 'volatility',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'PDIST', style: 'histogram' }],
  },
  {
    id: 'bbwidth',
    name: 'BBW',
    fullName: 'Bollinger Band Width',
    category: 'volatility',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 500, step: 1 },
      { key: 'stdMult', label: 'Std Mult', type: 'number', default: 2, min: 0.5, max: 5, step: 0.1 },
    ],
    outputs: [{ key: 'value', label: 'BBW', style: 'line' }],
  },
  {
    id: 'kcwidth',
    name: 'KCW',
    fullName: 'Keltner Channel Width',
    category: 'volatility',
    renderType: 'subchart',
    params: [
      { key: 'emaPeriod', label: 'EMA Period', type: 'number', default: 20, min: 1, max: 500, step: 1 },
      { key: 'atrPeriod', label: 'ATR Period', type: 'number', default: 10, min: 1, max: 500, step: 1 },
      { key: 'multiplier', label: 'Multiplier', type: 'number', default: 1.5, min: 0.5, max: 5, step: 0.1 },
    ],
    outputs: [{ key: 'value', label: 'KCW', style: 'line' }],
  },
  {
    id: 'rvi_vol',
    name: 'RVI',
    fullName: 'Relative Volatility Index',
    category: 'volatility',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'RVI', style: 'line' }],
    referenceLines: [
      { value: 50, color: 'rgba(255,255,255,0.1)' },
    ],
  },
  {
    id: 'hwc',
    name: 'HWC',
    fullName: 'Holt-Winter Channel',
    category: 'volatility',
    renderType: 'subchart',
    params: [
      { key: 'na', label: 'Level', type: 'number', default: 0.2, min: 0, max: 1, step: 0.05 },
      { key: 'nb', label: 'Trend', type: 'number', default: 0.1, min: 0, max: 1, step: 0.05 },
      { key: 'nc', label: 'Seasonal', type: 'number', default: 0.1, min: 0, max: 1, step: 0.05 },
    ],
    outputs: [
      { key: 'upper', label: 'Upper', style: 'line' },
      { key: 'middle', label: 'Middle', style: 'line' },
      { key: 'lower', label: 'Lower', style: 'line' },
    ],
  },
];
