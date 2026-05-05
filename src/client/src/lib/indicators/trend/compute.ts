/**
 * Trend Indicators Compute Module
 */

import type { ActiveIndicator } from '@/hooks/useActiveIndicators';
import type { ComputedIndicator, ComputedOutput } from '@/lib/indicator_compute';
import {
  calcChoppiness, calcCKSP, calcDPO, calcQStick, calcVortex,
  calcVHF, calcDecayLinear, calcZigZag,
} from '@/lib/calculators';

export function isSpecialized(indicatorId: string): boolean {
  const specialized = [
    'choppiness', 'dpo', 'qstick', 'vhf', 'decay', 'microstructure',
    'cksp', 'vortex',
  ];
  return specialized.includes(indicatorId);
}

export function computeSpecialized(indicator: ActiveIndicator, calcBars: any[]): ComputedIndicator | null {
  if (indicator.indicatorId === 'choppiness') {
    const period = indicator.params.period ?? 14;
    const data = calcChoppiness(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'CHOP', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'dpo') {
    const period = indicator.params.period ?? 20;
    const data = calcDPO(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'DPO', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'qstick') {
    const period = indicator.params.period ?? 14;
    const data = calcQStick(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'QStick', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'vhf') {
    const period = indicator.params.period ?? 28;
    const data = calcVHF(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'VHF', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'decay') {
    const period = indicator.params.period ?? 5;
    const data = calcDecayLinear(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'Decay', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'microstructure') {
    const deviation = indicator.params.deviation ?? 5;
    const data = calcZigZag(calcBars, deviation);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'microstructure', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'cksp') {
    const atrPeriod = indicator.params.atrPeriod ?? 10;
    const atrMult = indicator.params.atrMult ?? 1;
    const period = indicator.params.period ?? 9;
    const result = calcCKSP(calcBars, atrPeriod, atrMult, period);
    const outputs: ComputedOutput[] = [];
    if (result.stopLong.length > 0) outputs.push({ outputKey: 'stopLong', label: 'Stop Long', data: result.stopLong, style: 'line' });
    if (result.stopShort.length > 0) outputs.push({ outputKey: 'stopShort', label: 'Stop Short', data: result.stopShort, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs };
  }
  if (indicator.indicatorId === 'vortex') {
    const period = indicator.params.period ?? 14;
    const result = calcVortex(calcBars, period);
    const outputs: ComputedOutput[] = [];
    if (result.viPlus.length > 0) outputs.push({ outputKey: 'viPlus', label: 'VI+', data: result.viPlus, style: 'line' });
    if (result.viMinus.length > 0) outputs.push({ outputKey: 'viMinus', label: 'VI-', data: result.viMinus, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  return null;
}

export function buildTrendColumnName(indicatorId: string, params: Record<string, number>): string | string[] {
  switch (indicatorId) {
    case 'adx': {
      const p = params.period;
      return [
        `ADX_${p}`,
        `PLUS_DI_${p}`,
        `MINUS_DI_${p}`,
      ];
    }
    case 'adxr': return `ADXR_${params.period}`;
    case 'dx': return `DX_${params.period}`;
    case 'plus_di': return `PLUS_DI_${params.period}`;
    case 'minus_di': return `MINUS_DI_${params.period}`;
    case 'plus_dm': return `PLUS_DM_${params.period}`;
    case 'minus_dm': return `MINUS_DM_${params.period}`;
    case 'aroon': {
      const p = params.period;
      return [
        `AROON_UP_${p}`,
        `AROON_DOWN_${p}`,
      ];
    }
    case 'aroonosc': return `AROONOSC_${params.period}`;
    case 'ht_trendmode': return 'HT_TRENDMODE';
    default:
      return indicatorId.toUpperCase();
  }
}

export function getTrendOutputColumnMap(indicatorId: string, params: Record<string, number>): Record<string, string> {
  switch (indicatorId) {
    case 'adx': {
      const p = params.period;
      return {
        adx: `ADX_${p}`,
        plusDI: `PLUS_DI_${p}`,
        minusDI: `MINUS_DI_${p}`,
      };
    }
    case 'aroon': {
      const p = params.period;
      return {
        up: `AROON_UP_${p}`,
        down: `AROON_DOWN_${p}`,
      };
    }
    default:
      return {};
  }
}

