/**
 * Overlap Indicators Compute Module
 */

import type { ActiveIndicator } from '@/hooks/useActiveIndicators';
import type { ComputedIndicator, ComputedOutput } from '@/lib/indicator_compute';
import {
  calcHMA, calcALMA, calcFWMA, calcPWMA, calcSINWMA, calcSWMA,
  calcVIDYA, calcVWMA, calcHWMA, calcMCGD, calcJMA, calcZLMA,
  calcRMAOverlay, calcKeltnerChannels, calcDonchianChannels,
  calcSuperTrend, calcIchimoku, calcHILO, calcSSF, calcAccBands,
  calcAvgPrice, calcMedPrice, calcTypPrice, calcWCLPrice,
} from '@/lib/calculators';

export function isSpecialized(indicatorId: string): boolean {
  const specialized = [
    'hma', 'alma', 'fwma', 'pwma', 'sinwma', 'swma', 'vidya', 'vwma',
    'hwma', 'mcgd', 'jma', 'zlma', 'rma', 'keltner', 'donchian',
    'supertrend', 'ichimoku', 'hilo', 'ssf', 'accbands',
    'avgprice', 'medprice', 'typprice', 'wclprice',
  ];
  return specialized.includes(indicatorId);
}

export function computeSpecialized(indicator: ActiveIndicator, calcBars: any[]): ComputedIndicator | null {
  if (indicator.indicatorId === 'hma') {
    const period = indicator.params.period ?? 20;
    const data = calcHMA(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'HMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'alma') {
    const period = indicator.params.period ?? 9;
    const offset = indicator.params.offset ?? 0.85;
    const sigma = indicator.params.sigma ?? 6;
    const data = calcALMA(calcBars, period, offset, sigma);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'ALMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'fwma') {
    const period = indicator.params.period ?? 20;
    const data = calcFWMA(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'FWMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'pwma') {
    const period = indicator.params.period ?? 20;
    const data = calcPWMA(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'PWMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'sinwma') {
    const period = indicator.params.period ?? 20;
    const data = calcSINWMA(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'SINWMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'swma') {
    const data = calcSWMA(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'SWMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'vidya') {
    const period = indicator.params.period ?? 20;
    const cmoPeriod = indicator.params.cmoPeriod ?? 9;
    const data = calcVIDYA(calcBars, period, cmoPeriod);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'VIDYA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'vwma') {
    const period = indicator.params.period ?? 20;
    const data = calcVWMA(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'VWMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'hwma') {
    const na = indicator.params.na ?? 0.2;
    const nb = indicator.params.nb ?? 0.1;
    const nc = indicator.params.nc ?? 0.1;
    const data = calcHWMA(calcBars, na, nb, nc);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'HWMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'mcgd') {
    const period = indicator.params.period ?? 20;
    const data = calcMCGD(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'MCGD', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'jma') {
    const period = indicator.params.period ?? 14;
    const phase = indicator.params.phase ?? 0;
    const power = indicator.params.power ?? 2;
    const data = calcJMA(calcBars, period, phase, power);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'JMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'zlma') {
    const period = indicator.params.period ?? 20;
    const data = calcZLMA(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'ZLMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'rma') {
    const period = indicator.params.period ?? 20;
    const data = calcRMAOverlay(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'RMA', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'avgprice') {
    const data = calcAvgPrice(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'AvgPrice', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'medprice') {
    const data = calcMedPrice(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'MedPrice', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'typprice') {
    const data = calcTypPrice(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'TypPrice', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'wclprice') {
    const data = calcWCLPrice(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'WCLPrice', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'keltner') {
    const emaP = indicator.params.emaPeriod ?? 20;
    const atrP = indicator.params.atrPeriod ?? 10;
    const mult = indicator.params.multiplier ?? 1.5;
    const result = calcKeltnerChannels(calcBars, emaP, atrP, mult);
    const outputs: ComputedOutput[] = [];
    if (result.upper.length > 0) outputs.push({ outputKey: 'upper', label: 'Upper', data: result.upper, style: 'line' });
    if (result.middle.length > 0) outputs.push({ outputKey: 'middle', label: 'Middle', data: result.middle, style: 'line' });
    if (result.lower.length > 0) outputs.push({ outputKey: 'lower', label: 'Lower', data: result.lower, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs };
  }
  if (indicator.indicatorId === 'donchian') {
    const period = indicator.params.period ?? 20;
    const result = calcDonchianChannels(calcBars, period);
    const outputs: ComputedOutput[] = [];
    if (result.upper.length > 0) outputs.push({ outputKey: 'upper', label: 'Upper', data: result.upper, style: 'line' });
    if (result.middle.length > 0) outputs.push({ outputKey: 'middle', label: 'Middle', data: result.middle, style: 'line' });
    if (result.lower.length > 0) outputs.push({ outputKey: 'lower', label: 'Lower', data: result.lower, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs };
  }
  if (indicator.indicatorId === 'supertrend') {
    const period = indicator.params.period ?? 10;
    const mult = indicator.params.multiplier ?? 3;
    const result = calcSuperTrend(calcBars, period, mult);
    if (result.supertrend.length === 0) return null;
    const outputs: ComputedOutput[] = [
      { outputKey: 'supertrend', label: 'SuperTrend', data: result.supertrend, style: 'line' },
    ];
    if (result.direction.length > 0) outputs.push({ outputKey: 'direction', label: 'Direction', data: result.direction, style: 'line' });
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs };
  }
  if (indicator.indicatorId === 'ichimoku') {
    const tenkan = indicator.params.tenkan ?? 9;
    const kijun = indicator.params.kijun ?? 26;
    const senkou = indicator.params.senkou ?? 52;
    const result = calcIchimoku(calcBars, tenkan, kijun, senkou);
    const outputs: ComputedOutput[] = [];
    if (result.tenkan.length > 0) outputs.push({ outputKey: 'tenkan', label: 'Tenkan', data: result.tenkan, style: 'line' });
    if (result.kijun.length > 0) outputs.push({ outputKey: 'kijun', label: 'Kijun', data: result.kijun, style: 'line' });
    if (result.senkouA.length > 0) outputs.push({ outputKey: 'senkouA', label: 'Senkou A', data: result.senkouA, style: 'line' });
    if (result.senkouB.length > 0) outputs.push({ outputKey: 'senkouB', label: 'Senkou B', data: result.senkouB, style: 'line' });
    if (result.chikou.length > 0) outputs.push({ outputKey: 'chikou', label: 'Chikou', data: result.chikou, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs };
  }
  if (indicator.indicatorId === 'hilo') {
    const highPeriod = indicator.params.highPeriod ?? indicator.params.period ?? 3;
    const lowPeriod = indicator.params.lowPeriod ?? indicator.params.period ?? 3;
    const data = calcHILO(calcBars, highPeriod, lowPeriod);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'HILO', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'ssf') {
    const period = indicator.params.period ?? 20;
    const poles = indicator.params.poles ?? 2;
    const data = calcSSF(calcBars, period, poles);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs: [{ outputKey: 'value', label: 'SSF', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'accbands') {
    const period = indicator.params.period ?? 20;
    const result = calcAccBands(calcBars, period);
    const outputs: ComputedOutput[] = [];
    if (result.upper.length > 0) outputs.push({ outputKey: 'upper', label: 'Upper', data: result.upper, style: 'line' });
    if (result.middle.length > 0) outputs.push({ outputKey: 'middle', label: 'Middle', data: result.middle, style: 'line' });
    if (result.lower.length > 0) outputs.push({ outputKey: 'lower', label: 'Lower', data: result.lower, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'overlay', outputs };
  }
  return null;
}

export function buildOverlapColumnName(indicatorId: string, params: Record<string, number>): string | string[] {
  switch (indicatorId) {
    case 'sma': return `SMA_${params.period}`;
    case 'ema': return `EMA_${params.period}`;
    case 'wma': return `WMA_${params.period}`;
    case 'dema': return `DEMA_${params.period}`;
    case 'tema': return `TEMA_${params.period}`;
    case 'trima': return `TRIMA_${params.period}`;
    case 't3': return `T3_${params.period}`;
    case 'kama': return `KAMA_${params.period}`;
    case 'midpoint': return `MIDPOINT_${params.period}`;
    case 'midprice': return `MIDPRICE_${params.period}`;
    case 'ht_trendline': return 'HT_TRENDLINE';
    case 'tsf': return `TSF_${params.period}`;
    case 'linearreg': return `LINREG_${params.period}`;
    case 'psar': return 'PSAR';
    case 'vwap': return 'VWAP';
    case 'mama': return ['MAMA', 'FAMA'];
    case 'bbands': {
      const p = params.period;
      const sd = params.stdDev ?? 2.0;
      const sdWhole = Math.floor(sd);
      const sdFrac = Math.round((sd - sdWhole) * 10);
      return [
        `BBU_${p}_${sdWhole}_${sdFrac}`,
        `BBM_${p}_${sdWhole}_${sdFrac}`,
        `BBL_${p}_${sdWhole}_${sdFrac}`,
      ];
    }
    default:
      return indicatorId.toUpperCase();
  }
}

export function getOverlapOutputColumnMap(indicatorId: string, params: Record<string, number>): Record<string, string> {
  switch (indicatorId) {
    case 'bbands': {
      const p = params.period;
      const sd = params.stdDev ?? 2.0;
      const sdWhole = Math.floor(sd);
      const sdFrac = Math.round((sd - sdWhole) * 10);
      return {
        upper: `BBU_${p}_${sdWhole}_${sdFrac}`,
        middle: `BBM_${p}_${sdWhole}_${sdFrac}`,
        lower: `BBL_${p}_${sdWhole}_${sdFrac}`,
      };
    }
    case 'mama':
      return {
        mama: 'MAMA',
        fama: 'FAMA',
      };
    default:
      return {};
  }
}
