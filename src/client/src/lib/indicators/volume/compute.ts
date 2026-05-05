/**
 * Volume Indicators Compute Module
 */

import type { ActiveIndicator } from '@/hooks/useActiveIndicators';
import type { ComputedIndicator, ComputedOutput } from '@/lib/indicator_compute';
import {
  calcCMF, calcEFI, calcEOM, calcKVO, calcNVI, calcPVI,
  calcPVR, calcPVT, calcVPCI, calcVPOC, calcVPOCDist,
} from '@/lib/calculators';

export function isSpecialized(indicatorId: string): boolean {
  const specialized = [
    'cmf', 'efi', 'eom', 'nvi', 'pvi', 'pvr', 'pvt', 'vpci',
    'vpoc', 'vpoc_dist', 'kvo',
  ];
  return specialized.includes(indicatorId);
}

export function computeSpecialized(indicator: ActiveIndicator, calcBars: any[]): ComputedIndicator | null {
  if (indicator.indicatorId === 'cmf') {
    const period = indicator.params.period ?? 20;
    const data = calcCMF(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'CMF', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'efi') {
    const period = indicator.params.period ?? 13;
    const data = calcEFI(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'EFI', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'eom') {
    const period = indicator.params.period ?? 14;
    const divisor = indicator.params.divisor ?? 100000000;
    const data = calcEOM(calcBars, period, divisor);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'EOM', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'nvi') {
    const data = calcNVI(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'NVI', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'pvi') {
    const data = calcPVI(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'PVI', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'pvr') {
    const data = calcPVR(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'PVR', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'pvt') {
    const data = calcPVT(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'PVT', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'vpci') {
    const shortP = indicator.params.shortP ?? 5;
    const longP = indicator.params.longP ?? 25;
    const data = calcVPCI(calcBars, shortP, longP);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'VPCI', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'vpoc') {
    const period = indicator.params.period ?? 20;
    const bins = indicator.params.bins ?? 50;
    const data = calcVPOC(calcBars, period, bins);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'VPOC', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'vpoc_dist') {
    const period = indicator.params.period ?? 20;
    const bins = indicator.params.bins ?? 50;
    const data = calcVPOCDist(calcBars, period, bins);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'VPOC Dist', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'kvo') {
    const fastP = indicator.params.fastP ?? 34;
    const slowP = indicator.params.slowP ?? 55;
    const signalP = indicator.params.signalP ?? 13;
    const result = calcKVO(calcBars, fastP, slowP, signalP);
    const outputs: ComputedOutput[] = [];
    if (result.kvo.length > 0) outputs.push({ outputKey: 'kvo', label: 'KVO', data: result.kvo, style: 'line' });
    if (result.signal.length > 0) outputs.push({ outputKey: 'signal', label: 'Signal', data: result.signal, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  return null;
}

export function buildVolumeColumnName(indicatorId: string, params: Record<string, number>): string | string[] {
  switch (indicatorId) {
    case 'obv': return 'OBV';
    case 'ad': return 'AD';
    case 'adosc': return `ADOSC_${params.fastPeriod}_${params.slowPeriod}`;
    case 'mfi': return `MFI_${params.period}`;
    default:
      return indicatorId.toUpperCase();
  }
}

export function getVolumeOutputColumnMap(indicatorId: string, params: Record<string, number>): Record<string, string> {
  // No multi-output volume indicators in current buildColumnName mapping
  return {};
}
