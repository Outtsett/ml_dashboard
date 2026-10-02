/**
 * Cycle Indicators Compute Module
 */

import type { ActiveIndicator } from "@/market/lib/useActiveIndicators";
import type { ComputedIndicator } from "@/market/lib/indicator_compute";
import type { Bar } from '@/market/lib/calculators';
import { calcEBSW, calcReflex } from '@/market/lib/calculators';

export function isSpecialized(indicatorId: string): boolean {
  const specialized = ['ebsw', 'reflex'];
  return specialized.includes(indicatorId);
}

export function computeSpecialized(indicator: ActiveIndicator, calcBars: Bar[]): ComputedIndicator | null {
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

export function buildCycleColumnName(indicatorId: string, _params: Record<string, number>): string | string[] {
  switch (indicatorId) {
    default:
      return indicatorId.toUpperCase();
  }
}

export function getCycleOutputColumnMap(_indicatorId: string, _params: Record<string, number>): Record<string, string> {
  return {};
}
