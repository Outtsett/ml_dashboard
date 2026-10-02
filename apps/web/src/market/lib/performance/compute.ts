/**
 * Performance Indicators Compute Module
 */

import type { ActiveIndicator } from "@/market/lib/useActiveIndicators";
import type { ComputedIndicator } from "@/market/lib/indicator_compute";
import type { Bar } from '@/market/lib/calculators';
import {
  calcLogReturn, calcPctReturn,
  calcCumLogReturn, calcCumPctReturn,
} from '@/market/lib/calculators';

export function isSpecialized(indicatorId: string): boolean {
  const specialized = [
    'log_return', 'pct_return', 'cum_log_return', 'cum_pct_return',
  ];
  return specialized.includes(indicatorId);
}

export function computeSpecialized(indicator: ActiveIndicator, calcBars: Bar[]): ComputedIndicator | null {
  if (indicator.indicatorId === 'log_return') {
    const data = calcLogReturn(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Log Return', data, style: 'histogram' }] };
  }
  if (indicator.indicatorId === 'pct_return') {
    const data = calcPctReturn(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Pct Return', data, style: 'histogram' }] };
  }
  if (indicator.indicatorId === 'cum_log_return') {
    const data = calcCumLogReturn(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Cum Log Return', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'cum_pct_return') {
    const data = calcCumPctReturn(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Cum Pct Return', data, style: 'line' }] };
  }
  return null;
}

export function buildPerformanceColumnName(indicatorId: string, _params: Record<string, number>): string | string[] {
  switch (indicatorId) {
    default:
      return indicatorId.toUpperCase();
  }
}

export function getPerformanceOutputColumnMap(_indicatorId: string, _params: Record<string, number>): Record<string, string> {
  return {};
}
