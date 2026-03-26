import { IndicatorDefinition } from '../../indicator_registry';

export const PERFORMANCE_INDICATORS: IndicatorDefinition[] = [
  {
    id: 'log_return',
    name: 'LogRet',
    fullName: 'Log Return',
    category: 'performance',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'Log Return', style: 'histogram' }],
    referenceLines: [
      { value: 0, color: 'rgba(255,255,255,0.1)' },
    ],
  },
  {
    id: 'pct_return',
    name: 'PctRet',
    fullName: 'Percent Return',
    category: 'performance',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'Pct Return', style: 'histogram' }],
    referenceLines: [
      { value: 0, color: 'rgba(255,255,255,0.1)' },
    ],
  },
  {
    id: 'cum_log_return',
    name: 'CumLogRet',
    fullName: 'Cumulative Log Return',
    category: 'performance',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'Cum Log Return', style: 'line' }],
  },
  {
    id: 'cum_pct_return',
    name: 'CumPctRet',
    fullName: 'Cumulative Pct Return',
    category: 'performance',
    renderType: 'subchart',
    params: [],
    outputs: [{ key: 'value', label: 'Cum Pct Return', style: 'line' }],
  },
];
