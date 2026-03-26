/**
 * Volatility Indicators Compute Module
 */

import type { ActiveIndicator } from '@/hooks/useActiveIndicators';
import type { ComputedIndicator, ComputedOutput } from '@/lib/indicator_compute';
import {
  calcAberration, calcMassIndex, calcUlcerIndex, calcPDIST,
  calcBBWidth, calcKCWidth, calcRVI, calcHWC,
} from '@/lib/calculators';

export function isSpecialized(indicatorId: string): boolean {
  const specialized = [
    'aberration', 'massi', 'ui', 'pdist', 'bbwidth', 'kcwidth',
    'rvi_vol', 'hwc',
  ];
  return specialized.includes(indicatorId);
}

export function computeSpecialized(indicator: ActiveIndicator, calcBars: any[]): ComputedIndicator | null {
  if (indicator.indicatorId === 'aberration') {
    const period = indicator.params.period ?? 20;
    const atrPeriod = indicator.params.atrPeriod ?? 14;
    const data = calcAberration(calcBars, period, atrPeriod);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Aberration', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'massi') {
    const emaPeriod = indicator.params.emaPeriod ?? 9;
    const sumPeriod = indicator.params.sumPeriod ?? 25;
    const data = calcMassIndex(calcBars, emaPeriod, sumPeriod);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'MASSI', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'ui') {
    const period = indicator.params.period ?? 14;
    const data = calcUlcerIndex(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'UI', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'pdist') {
    const data = calcPDIST(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'PDIST', data, style: 'histogram' }] };
  }
  if (indicator.indicatorId === 'bbwidth') {
    const period = indicator.params.period ?? 20;
    const stdMult = indicator.params.stdMult ?? 2;
    const data = calcBBWidth(calcBars, period, stdMult);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'BBW', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'kcwidth') {
    const emaPeriod = indicator.params.emaPeriod ?? 20;
    const atrPeriod = indicator.params.atrPeriod ?? 10;
    const mult = indicator.params.multiplier ?? 1.5;
    const data = calcKCWidth(calcBars, emaPeriod, atrPeriod, mult);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'KCW', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'rvi_vol') {
    const period = indicator.params.period ?? 14;
    const data = calcRVI(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'RVI', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'hwc') {
    const na = indicator.params.na ?? 0.2;
    const nb = indicator.params.nb ?? 0.1;
    const nc = indicator.params.nc ?? 0.1;
    const result = calcHWC(calcBars, na, nb, nc);
    const outputs: ComputedOutput[] = [];
    if (result.upper.length > 0) outputs.push({ outputKey: 'upper', label: 'Upper', data: result.upper, style: 'line' });
    if (result.middle.length > 0) outputs.push({ outputKey: 'middle', label: 'Middle', data: result.middle, style: 'line' });
    if (result.lower.length > 0) outputs.push({ outputKey: 'lower', label: 'Lower', data: result.lower, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  return null;
}

export function buildVolatilityColumnName(indicatorId: string, params: Record<string, number>): string | string[] {
  switch (indicatorId) {
    case 'atr': return `ATR_${params.period}`;
    case 'natr': return `NATR_${params.period}`;
    case 'trange': return 'TRANGE';
    default:
      return indicatorId.toUpperCase();
  }
}

export function getVolatilityOutputColumnMap(indicatorId: string, params: Record<string, number>): Record<string, string> {
  // Currently no multi-output volatility indicators in buildColumnName mapping
  return {};
}
