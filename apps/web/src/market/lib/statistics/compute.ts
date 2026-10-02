/**
 * Statistics Indicators Compute Module
 */

import type { ActiveIndicator } from "@/market/lib/useActiveIndicators";
import type { ComputedIndicator } from "@/market/lib/indicator_compute";
import type { Bar } from '@/market/lib/calculators';
import {
  calcEntropy, calcKurtosis, calcMAD, calcRollingMedian,
  calcQuantile, calcSkew, calcZScore,
} from '@/market/lib/calculators';

export function isSpecialized(indicatorId: string): boolean {
  const specialized = [
    'entropy', 'kurtosis', 'mad', 'rolling_median', 'quantile',
    'skew', 'zscore',
  ];
  return specialized.includes(indicatorId);
}

export function computeSpecialized(indicator: ActiveIndicator, calcBars: Bar[]): ComputedIndicator | null {
  if (indicator.indicatorId === 'entropy') {
    const period = indicator.params.period ?? 10;
    const data = calcEntropy(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Entropy', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'kurtosis') {
    const period = indicator.params.period ?? 30;
    const data = calcKurtosis(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Kurtosis', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'mad') {
    const period = indicator.params.period ?? 30;
    const data = calcMAD(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'MAD', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'rolling_median') {
    const period = indicator.params.period ?? 30;
    const data = calcRollingMedian(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Median', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'quantile') {
    const period = indicator.params.period ?? 30;
    const q = indicator.params.quantile ?? 0.5;
    const data = calcQuantile(calcBars, period, q);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Quantile', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'skew') {
    const period = indicator.params.period ?? 30;
    const data = calcSkew(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Skew', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'zscore') {
    const period = indicator.params.period ?? 30;
    const data = calcZScore(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Z-Score', data, style: 'line' }] };
  }
  return null;
}

export function buildStatisticsColumnName(indicatorId: string, params: Record<string, number>): string | string[] {
  switch (indicatorId) {
    case 'stddev': return `STDEV_${params.period}`;
    case 'variance': return `VAR_${params.period}`;
    case 'beta': return `BETA_${params.period}`;
    case 'correl': return `CORREL_${params.period}`;
    case 'linreg_slope': return `LINREG_SLOPE_${params.period}`;
    case 'linreg_angle': return `LINREG_ANGLE_${params.period}`;
    case 'linreg_intercept': return `LINREG_INTERCEPT_${params.period}`;
    case 'ht_dcperiod': return 'HT_DCPERIOD';
    case 'ht_dcphase': return 'HT_DCPHASE';
    case 'ht_phasor': return ['HT_PHASOR_INPHASE', 'HT_PHASOR_QUADRATURE'];
    case 'ht_sine': return ['HT_SINE_SINE', 'HT_SINE_LEADSINE'];
    default:
      return indicatorId.toUpperCase();
  }
}

export function getStatisticsOutputColumnMap(indicatorId: string, _params: Record<string, number>): Record<string, string> {
  switch (indicatorId) {
    case 'ht_phasor':
      return {
        inphase: 'HT_PHASOR_INPHASE',
        quadrature: 'HT_PHASOR_QUADRATURE',
      };
    case 'ht_sine':
      return {
        sine: 'HT_SINE_SINE',
        leadsine: 'HT_SINE_LEADSINE',
      };
    default:
      return {};
  }
}
