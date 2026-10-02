import type { IndicatorDefinition } from "@/market/lib/indicator_registry";

export const TREND_INDICATORS: IndicatorDefinition[] = [
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
  {
    id: 'choppiness',
    name: 'CHOP',
    fullName: 'Choppiness Index',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'CHOP', style: 'line' }],
    referenceLines: [
      { value: 61.8, color: 'rgba(239,68,68,0.25)' },
      { value: 38.2, color: 'rgba(34,197,94,0.25)' },
    ],
  },
  {
    id: 'cksp',
    name: 'CKSP',
    fullName: 'Chande Kroll Stop',
    category: 'trend',
    renderType: 'overlay',
    params: [
      { key: 'atrPeriod', label: 'ATR Period', type: 'number', default: 10, min: 1, max: 200, step: 1 },
      { key: 'atrMult', label: 'ATR Mult', type: 'number', default: 1, min: 0.5, max: 5, step: 0.1 },
      { key: 'period', label: 'Period', type: 'number', default: 9, min: 1, max: 200, step: 1 },
    ],
    outputs: [
      { key: 'stopLong', label: 'Stop Long', style: 'line' },
      { key: 'stopShort', label: 'Stop Short', style: 'line' },
    ],
  },
  {
    id: 'dpo',
    name: 'DPO',
    fullName: 'Detrended Price Oscillator',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'DPO', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255,255,255,0.1)' },
    ],
  },
  {
    id: 'qstick',
    name: 'QStick',
    fullName: 'QStick',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'QStick', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255,255,255,0.1)' },
    ],
  },
  {
    id: 'vortex',
    name: 'Vortex',
    fullName: 'Vortex Indicator',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 14, min: 1, max: 500, step: 1 },
    ],
    outputs: [
      { key: 'viPlus', label: 'VI+', style: 'line' },
      { key: 'viMinus', label: 'VI-', style: 'line' },
    ],
  },
  {
    id: 'vhf',
    name: 'VHF',
    fullName: 'Vertical Horizontal Filter',
    category: 'trend',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 28, min: 1, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'VHF', style: 'line' }],
  },
  {
    id: 'decay',
    name: 'Decay',
    fullName: 'Linear Decay',
    category: 'trend',
    renderType: 'overlay',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 5, min: 2, max: 100, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'Decay', style: 'line' }],
  },
  {
    id: 'microstructure',
    name: 'microstructure',
    fullName: 'microstructure',
    category: 'trend',
    renderType: 'overlay',
    params: [
      { key: 'deviation', label: 'Deviation %', type: 'number', default: 5, min: 0.1, max: 50, step: 0.1 },
    ],
    outputs: [{ key: 'value', label: 'microstructure', style: 'line' }],
  },
];

