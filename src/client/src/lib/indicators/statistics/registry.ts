import type { IndicatorDefinition } from '../../indicator_registry';

export const STATISTICS_INDICATORS: IndicatorDefinition[] = [
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
  {
    id: 'entropy',
    name: 'Entropy',
    fullName: 'Shannon Entropy',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 10, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'Entropy', style: 'line' }],
  },
  {
    id: 'kurtosis',
    name: 'Kurtosis',
    fullName: 'Rolling Kurtosis',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 30, min: 4, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'Kurtosis', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255,255,255,0.1)' },
    ],
  },
  {
    id: 'mad',
    name: 'MAD',
    fullName: 'Mean Absolute Deviation',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 30, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'MAD', style: 'line' }],
  },
  {
    id: 'rolling_median',
    name: 'Median',
    fullName: 'Rolling Median',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 30, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'Median', style: 'line' }],
  },
  {
    id: 'quantile',
    name: 'Quantile',
    fullName: 'Rolling Quantile',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 30, min: 2, max: 500, step: 1 },
      { key: 'quantile', label: 'Quantile', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
    ],
    outputs: [{ key: 'value', label: 'Quantile', style: 'line' }],
  },
  {
    id: 'skew',
    name: 'Skew',
    fullName: 'Rolling Skewness',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 30, min: 3, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'Skew', style: 'line' }],
    referenceLines: [
      { value: 0, color: 'rgba(255,255,255,0.1)' },
    ],
  },
  {
    id: 'zscore',
    name: 'Z-Score',
    fullName: 'Z-Score',
    category: 'statistics',
    renderType: 'subchart',
    params: [
      { key: 'period', label: 'Period', type: 'number', default: 30, min: 2, max: 500, step: 1 },
    ],
    outputs: [{ key: 'value', label: 'Z-Score', style: 'line' }],
    referenceLines: [
      { value: 2, color: 'rgba(239,68,68,0.3)' },
      { value: -2, color: 'rgba(34,197,94,0.3)' },
      { value: 0, color: 'rgba(255,255,255,0.06)' },
    ],
  },
];
