/**
 * Momentum Indicators Compute Module
 */

import type { ActiveIndicator } from "@/market/lib/useActiveIndicators";
import type { ComputedIndicator, ComputedOutput } from "@/market/lib/indicator_compute";
import type { Bar } from '@/market/lib/calculators';
import {
  calcAO, calcBias, calcCFO, calcCG, calcCoppock, calcCRSI,
  calcER, calcFisher, calcInertia, calcKST, calcPGO, calcPSL,
  calcQQE, calcRVGI, calcSTC, calcTSI, calcSMI, calcSqueeze,
  calcSqueezePro, calcKDJ, calcWAD, calcRSX,
} from '@/market/lib/calculators';

export function isSpecialized(indicatorId: string): boolean {
  const specialized = [
    'ao', 'bias', 'cfo', 'cg', 'coppock', 'crsi', 'er', 'fisher',
    'inertia', 'kst', 'pgo', 'psl', 'qqe', 'rvgi', 'stc', 'tsi',
    'smi', 'squeeze', 'squeeze_pro', 'kdj', 'wad', 'rsx',
  ];
  return specialized.includes(indicatorId);
}

export function computeSpecialized(indicator: ActiveIndicator, calcBars: Bar[]): ComputedIndicator | null {
  if (indicator.indicatorId === 'ao') {
    const fastP = indicator.params.fastPeriod ?? 5;
    const slowP = indicator.params.slowPeriod ?? 34;
    const data = calcAO(calcBars, fastP, slowP);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'AO', data, style: 'histogram' }] };
  }
  if (indicator.indicatorId === 'bias') {
    const period = indicator.params.period ?? 26;
    const data = calcBias(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Bias', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'cfo') {
    const period = indicator.params.period ?? 9;
    const data = calcCFO(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'CFO', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'cg') {
    const period = indicator.params.period ?? 10;
    const data = calcCG(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'CG', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'coppock') {
    const wmaP = indicator.params.wmaP ?? 10;
    const roc1 = indicator.params.roc1 ?? 14;
    const roc2 = indicator.params.roc2 ?? 11;
    const data = calcCoppock(calcBars, wmaP, roc1, roc2);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Coppock', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'crsi') {
    const rsiP = indicator.params.rsiP ?? 3;
    const streakP = indicator.params.streakP ?? 2;
    const rankP = indicator.params.rankP ?? 100;
    const data = calcCRSI(calcBars, rsiP, streakP, rankP);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'CRSI', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'er') {
    const period = indicator.params.period ?? 10;
    const data = calcER(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'ER', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'inertia') {
    const period = indicator.params.period ?? 20;
    const rviPeriod = indicator.params.rviPeriod ?? 14;
    const data = calcInertia(calcBars, period, rviPeriod);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'Inertia', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'pgo') {
    const period = indicator.params.period ?? 14;
    const data = calcPGO(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'PGO', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'psl') {
    const period = indicator.params.period ?? 12;
    const data = calcPSL(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'PSL', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'rsx') {
    const period = indicator.params.period ?? 14;
    const data = calcRSX(calcBars, period);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'RSX', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'stc') {
    const period = indicator.params.period ?? 10;
    const fastP = indicator.params.fastP ?? 23;
    const slowP = indicator.params.slowP ?? 50;
    const data = calcSTC(calcBars, period, fastP, slowP);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'STC', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'wad') {
    const data = calcWAD(calcBars);
    if (data.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs: [{ outputKey: 'value', label: 'WAD', data, style: 'line' }] };
  }
  if (indicator.indicatorId === 'fisher') {
    const period = indicator.params.period ?? 9;
    const result = calcFisher(calcBars, period);
    const outputs: ComputedOutput[] = [];
    if (result.fisher.length > 0) outputs.push({ outputKey: 'fisher', label: 'Fisher', data: result.fisher, style: 'line' });
    if (result.trigger.length > 0) outputs.push({ outputKey: 'trigger', label: 'Trigger', data: result.trigger, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  if (indicator.indicatorId === 'kst') {
    const signalP = indicator.params.signalP ?? 9;
    const result = calcKST(calcBars, signalP);
    const outputs: ComputedOutput[] = [];
    if (result.kst.length > 0) outputs.push({ outputKey: 'kst', label: 'KST', data: result.kst, style: 'line' });
    if (result.signal.length > 0) outputs.push({ outputKey: 'signal', label: 'Signal', data: result.signal, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  if (indicator.indicatorId === 'qqe') {
    const rsiPeriod = indicator.params.rsiPeriod ?? 14;
    const smoothFactor = indicator.params.smoothFactor ?? 5;
    const qqeFactor = indicator.params.qqeFactor ?? 4.236;
    const result = calcQQE(calcBars, rsiPeriod, smoothFactor, qqeFactor);
    const outputs: ComputedOutput[] = [];
    if (result.qqe.length > 0) outputs.push({ outputKey: 'qqe', label: 'QQE', data: result.qqe, style: 'line' });
    if (result.rsiSmooth.length > 0) outputs.push({ outputKey: 'rsiSmooth', label: 'RSI Smooth', data: result.rsiSmooth, style: 'line' });
    if (result.upper.length > 0) outputs.push({ outputKey: 'upper', label: 'Upper', data: result.upper, style: 'line' });
    if (result.lower.length > 0) outputs.push({ outputKey: 'lower', label: 'Lower', data: result.lower, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  if (indicator.indicatorId === 'rvgi') {
    const period = indicator.params.period ?? 10;
    const signalP = indicator.params.signalP ?? 4;
    const result = calcRVGI(calcBars, period, signalP);
    const outputs: ComputedOutput[] = [];
    if (result.rvgi.length > 0) outputs.push({ outputKey: 'rvgi', label: 'RVGI', data: result.rvgi, style: 'line' });
    if (result.signal.length > 0) outputs.push({ outputKey: 'signal', label: 'Signal', data: result.signal, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  if (indicator.indicatorId === 'tsi') {
    const longP = indicator.params.longP ?? 25;
    const shortP = indicator.params.shortP ?? 13;
    const signalP = indicator.params.signalP ?? 13;
    const result = calcTSI(calcBars, longP, shortP, signalP);
    const outputs: ComputedOutput[] = [];
    if (result.tsi.length > 0) outputs.push({ outputKey: 'tsi', label: 'TSI', data: result.tsi, style: 'line' });
    if (result.signal.length > 0) outputs.push({ outputKey: 'signal', label: 'Signal', data: result.signal, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  if (indicator.indicatorId === 'smi') {
    const period = indicator.params.period ?? 14;
    const smoothP = indicator.params.smoothP ?? 3;
    const signalP = indicator.params.signalP ?? 3;
    const result = calcSMI(calcBars, period, smoothP, signalP);
    const outputs: ComputedOutput[] = [];
    if (result.smi.length > 0) outputs.push({ outputKey: 'smi', label: 'SMI', data: result.smi, style: 'line' });
    if (result.signal.length > 0) outputs.push({ outputKey: 'signal', label: 'Signal', data: result.signal, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  if (indicator.indicatorId === 'squeeze') {
    const bbP = indicator.params.bbP ?? 20;
    const bbMult = indicator.params.bbMult ?? 2;
    const kcP = indicator.params.kcP ?? 20;
    const kcMult = indicator.params.kcMult ?? 1.5;
    const result = calcSqueeze(calcBars, bbP, bbMult, kcP, kcMult);
    const outputs: ComputedOutput[] = [];
    if (result.momentum.length > 0) outputs.push({ outputKey: 'momentum', label: 'Momentum', data: result.momentum, style: 'histogram' });
    if (result.squeeze.length > 0) outputs.push({ outputKey: 'squeeze', label: 'Squeeze', data: result.squeeze, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  if (indicator.indicatorId === 'squeeze_pro') {
    const bbP = indicator.params.bbP ?? 20;
    const bbMult = indicator.params.bbMult ?? 2;
    const result = calcSqueezePro(calcBars, bbP, bbMult);
    const outputs: ComputedOutput[] = [];
    if (result.momentum.length > 0) outputs.push({ outputKey: 'momentum', label: 'Momentum', data: result.momentum, style: 'histogram' });
    if (result.squeeze.length > 0) outputs.push({ outputKey: 'squeeze', label: 'Squeeze', data: result.squeeze, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  if (indicator.indicatorId === 'kdj') {
    const period = indicator.params.period ?? 9;
    const signalP = indicator.params.signalP ?? 3;
    const result = calcKDJ(calcBars, period, signalP);
    const outputs: ComputedOutput[] = [];
    if (result.k.length > 0) outputs.push({ outputKey: 'k', label: 'K', data: result.k, style: 'line' });
    if (result.d.length > 0) outputs.push({ outputKey: 'd', label: 'D', data: result.d, style: 'line' });
    if (result.j.length > 0) outputs.push({ outputKey: 'j', label: 'J', data: result.j, style: 'line' });
    if (outputs.length === 0) return null;
    return { instanceId: indicator.instanceId, indicatorId: indicator.indicatorId, displayType: 'subchart', outputs };
  }
  return null;
}

export function buildMomentumColumnName(indicatorId: string, params: Record<string, number>): string | string[] {
  switch (indicatorId) {
    case 'rsi': return `RSI_${params.period}`;
    case 'macd': {
      const f = params.fastPeriod;
      const s = params.slowPeriod;
      const sig = params.signalPeriod;
      return [
        `MACD_${f}_${s}_${sig}`,
        `MACDs_${f}_${s}_${sig}`,
        `MACDh_${f}_${s}_${sig}`,
      ];
    }
    case 'macdext': {
      const f = params.fastPeriod;
      const s = params.slowPeriod;
      const sig = params.signalPeriod;
      return [
        `MACDEXT_${f}_${s}_${sig}`,
        `MACDEXTs_${f}_${s}_${sig}`,
        `MACDEXTh_${f}_${s}_${sig}`,
      ];
    }
    case 'macdfix': {
      const sig = params.signalPeriod;
      return [
        `MACDFIX_${sig}`,
        `MACDFIXs_${sig}`,
        `MACDFIXh_${sig}`,
      ];
    }
    case 'stochastic': {
      const k = params.kPeriod;
      const ks = params.kSmooth;
      const ds = params.dSmooth;
      return [
        `STOCHk_${k}_${ks}_${ds}`,
        `STOCHd_${k}_${ks}_${ds}`,
      ];
    }
    case 'stochf': {
      const k = params.kPeriod;
      const d = params.dPeriod;
      return [
        `STOCHFk_${k}_${d}`,
        `STOCHFd_${k}_${d}`,
      ];
    }
    case 'stochrsi': {
      const rp = params.rsiPeriod;
      const sp = params.stochPeriod;
      const ks = params.kSmooth;
      const ds = params.dSmooth;
      return [
        `STOCHRSIk_${rp}_${sp}_${ks}_${ds}`,
        `STOCHRSId_${rp}_${sp}_${ks}_${ds}`,
      ];
    }
    case 'cci': return `CCI_${params.period}`;
    case 'willr': return `WILLR_${params.period}`;
    case 'momentum': return `MOM_${params.period}`;
    case 'roc': return `ROC_${params.period}`;
    case 'rocp': return `ROCP_${params.period}`;
    case 'rocr': return `ROCR_${params.period}`;
    case 'rocr100': return `ROCR100_${params.period}`;
    case 'cmo': return `CMO_${params.period}`;
    case 'apo': return `APO_${params.fastPeriod}_${params.slowPeriod}`;
    case 'ppo': return `PPO_${params.fastPeriod}_${params.slowPeriod}`;
    case 'trix': return `TRIX_${params.period}`;
    case 'ultosc': return `ULTOSC_${params.period1}_${params.period2}_${params.period3}`;
    case 'bop': return 'BOP';
    default:
      return indicatorId.toUpperCase();
  }
}

export function getMomentumOutputColumnMap(indicatorId: string, params: Record<string, number>): Record<string, string> {
  switch (indicatorId) {
    case 'macd': {
      const f = params.fastPeriod;
      const s = params.slowPeriod;
      const sig = params.signalPeriod;
      return {
        macd: `MACD_${f}_${s}_${sig}`,
        signal: `MACDs_${f}_${s}_${sig}`,
        histogram: `MACDh_${f}_${s}_${sig}`,
      };
    }
    case 'macdext': {
      const f = params.fastPeriod;
      const s = params.slowPeriod;
      const sig = params.signalPeriod;
      return {
        macd: `MACDEXT_${f}_${s}_${sig}`,
        signal: `MACDEXTs_${f}_${s}_${sig}`,
        histogram: `MACDEXTh_${f}_${s}_${sig}`,
      };
    }
    case 'macdfix': {
      const sig = params.signalPeriod;
      return {
        macd: `MACDFIX_${sig}`,
        signal: `MACDFIXs_${sig}`,
        histogram: `MACDFIXh_${sig}`,
      };
    }
    case 'stochastic': {
      const k = params.kPeriod;
      const ks = params.kSmooth;
      const ds = params.dSmooth;
      return {
        k: `STOCHk_${k}_${ks}_${ds}`,
        d: `STOCHd_${k}_${ks}_${ds}`,
      };
    }
    case 'stochf': {
      const k = params.kPeriod;
      const d = params.dPeriod;
      return {
        k: `STOCHFk_${k}_${d}`,
        d: `STOCHFd_${k}_${d}`,
      };
    }
    case 'stochrsi': {
      const rp = params.rsiPeriod;
      const sp = params.stochPeriod;
      const ks = params.kSmooth;
      const ds = params.dSmooth;
      return {
        k: `STOCHRSIk_${rp}_${sp}_${ks}_${ds}`,
        d: `STOCHRSId_${rp}_${sp}_${ks}_${ds}`,
      };
    }
    default:
      return {};
  }
}
