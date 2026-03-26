/**
 * Cycle Indicators Compute Module
 */

import type { ActiveIndicator } from '@/hooks/useActiveIndicators';
import type { ComputedIndicator } from '@/lib/indicator_compute';
import { calcEBSW, calcReflex } from '@/lib/calculators';

export function isSpecialized(indicatorId: string): boolean {
  const specialized = ['ebsw', 'reflex'];
  return specialized.includes(indicatorId);
}

export function computeSpecialized(indicator: ActiveIndicator, calcBars: any[]): ComputedIndicator | null {
  if (indicator.indicatorId === 'ebsw') {
    const period = indicator.params.period ?? 40;
    const hpPeriod = indicator.params.hpPeriod ?? 125;
    const data = calcEBSW(calcBars, period, hpPeriod);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'EBSW', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'reflex') {
    const period = indicator.params.period ?? 20;
    const data = calcReflex(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Reflex', data, style: 'line' }] };
  }
  return null;
}

export function buildCycleColumnName(indicatorId: string, params: Record<string, number>): string | string[] {
  switch (indicatorId) {
    default:
      return indicatorId.toUpperCase();
  }
}

export function getCycleOutputColumnMap(indicatorId: string, params: Record<string, number>): Record<string, string> {
  return {};
}
