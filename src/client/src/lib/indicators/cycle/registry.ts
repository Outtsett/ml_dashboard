import type { IndicatorDefinition } from '../../indicator_registry';

export const CYCLE_INDICATORS: IndicatorDefinition[] = [
  {
    id: 'ebsw',
    name: 'EBSW',
    fullName: 'Even Better Sinewave',
    category: 'cycle',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 40, min: 2, max: 500, step: 1 },
      { key: 'hpPeriod', label: 'HP Period', type: 'number', default: 125, min: 10, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'EBSW', style: 'line' }],
  },
  {
    id: 'reflex',
    name: 'Reflex',
    fullName: 'Ehlers Reflex',
    category: 'cycle',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 20, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'Reflex', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255,255,255,0.1)' },
    ],
  },
];
