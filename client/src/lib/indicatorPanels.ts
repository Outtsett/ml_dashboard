/**
 * Indicator panel grouping, labeling, and metadata for professional subchart rendering.
 */

import type { IndicatorOverlay } from '@/hooks/useIndicatorData';

/**
 * Derive a panel key from an indicator column name.
 * Related indicators (e.g., MACD/MACDs/MACDh) share the same panel.
 */
export function getSubchartPanelKey(column: string): string {
  // MACD variants: MACD_, MACDs_, MACDh_ → MACD_...
  if (/^MACD[hs]?_/.test(column)) {
    return column.replace(/^MACD[hs]?_/, 'MACD_');
  }
  // Stochastic: STOCHk_, STOCHd_ → STOCH_...
  if (/^STOCH[kd]_/.test(column)) {
    return column.replace(/^STOCH[kd]_/, 'STOCH_');
  }
  // StochRSI: STOCHRSIk_, STOCHRSId_ → STOCHRSI_...
  if (/^STOCHRSI[kd]_/.test(column)) {
    return column.replace(/^STOCHRSI[kd]_/, 'STOCHRSI_');
  }
  // Aroon: AROONd_, AROONu_ → AROON_...
  if (/^AROON[du]_/.test(column)) {
    return column.replace(/^AROON[du]_/, 'AROON_');
  }
  // Directional Movement: DMP_, DMN_ → DM_...
  if (/^DM[NP]_/.test(column)) {
    return column.replace(/^DM[NP]_/, 'DM_');
  }
  // QQE variants
  if (/^QQE[ls]?_/.test(column)) {
    return column.replace(/^QQE[ls]?_/, 'QQE_');
  }
  // KDJ variants
  if (/^KDJ[kd]?_/.test(column)) {
    return column.replace(/^KDJ[kd]?_/, 'KDJ_');
  }
  return column;
}

/**
 * Group subchart-type indicator overlays into panels.
 * Returns array of [panelKey, indicators[]] tuples, maintaining selection order.
 */
export function groupSubchartIndicators(
  overlays: IndicatorOverlay[],
): [string, IndicatorOverlay[]][] {
  const panelMap = new Map<string, IndicatorOverlay[]>();

  for (const overlay of overlays) {
    if (overlay.displayType !== 'subchart') continue;
    const key = getSubchartPanelKey(overlay.column);
    if (!panelMap.has(key)) panelMap.set(key, []);
    panelMap.get(key)!.push(overlay);
  }

  return Array.from(panelMap.entries());
}

/** Display-friendly names for indicator families */
const PANEL_DISPLAY_NAMES: Record<string, string> = {
  MACD: 'MACD',
  RSI: 'RSI',
  STOCH: 'Stochastic',
  STOCHRSI: 'StochRSI',
  CCI: 'CCI',
  WILLR: 'Williams %R',
  ADX: 'ADX',
  AROON: 'Aroon',
  AROONOSC: 'Aroon Osc',
  DM: 'Dir. Movement',
  ATR: 'ATR',
  ATRr: 'ATR',
  NATR: 'Norm ATR',
  OBV: 'OBV',
  MFI: 'MFI',
  CMF: 'Chaikin MF',
  TSI: 'TSI',
  AO: 'Awesome Osc',
  PPO: 'PPO',
  APO: 'Abs. Price Osc',
  ROC: 'Rate of Change',
  MOM: 'Momentum',
  TRIX: 'TRIX',
  FISHER: 'Fisher',
  FISHERt: 'Fisher',
  KVO: 'Klinger Volume',
  EFI: 'Elder Force',
  EMV: 'Ease of Movement',
  NVI: 'NVI',
  PVI: 'PVI',
  AD: 'Accum/Dist',
  ADOSC: 'AD Oscillator',
  BOP: 'Balance of Power',
  EBSW: 'EBSW',
  ENTROPY: 'Entropy',
  KURTOSIS: 'Kurtosis',
  SKEW: 'Skew',
  ZSCORE: 'Z-Score',
  CHOP: 'Choppiness',
  DPO: 'DPO',
  VHF: 'VHF',
  STC: 'STC',
  KDJ: 'KDJ',
  SQZ: 'Squeeze',
  BBB: 'Bollinger %B',
  BBP: 'Bollinger %P',
  ULCER: 'Ulcer Index',
  QQE: 'QQE',
  ABERRATION: 'Aberration',
  THERMO: 'Thermostat',
  HWC: 'HWC',
  PCTRET: 'Pct Return',
  LOGRET: 'Log Return',
  REFLEX: 'Reflex',
  MAD: 'MAD',
  MEDIAN: 'Median',
  QUANTILE: 'Quantile',
  STDEV: 'Std Dev',
  VARIANCE: 'Variance',
  TSV: 'Time Seg. Volume',
};

/** Get a display label for a panel key like "MACD_12_26_9" → "MACD (12,26,9)" */
export function getPanelLabel(panelKey: string): string {
  const parts = panelKey.split('_');
  const name = parts[0];
  const params = parts.slice(1).filter(Boolean).join(',');
  const displayName = PANEL_DISPLAY_NAMES[name] || name;
  return params ? `${displayName} (${params})` : displayName;
}

/** Reference / guide lines for well-known oscillators */
const REFERENCE_LINES: Record<string, { value: number; color: string }[]> = {
  RSI: [
    { value: 70, color: 'rgba(239, 68, 68, 0.3)' },
    { value: 30, color: 'rgba(34, 197, 94, 0.3)' },
    { value: 50, color: 'rgba(255, 255, 255, 0.06)' },
  ],
  STOCH: [
    { value: 80, color: 'rgba(239, 68, 68, 0.3)' },
    { value: 20, color: 'rgba(34, 197, 94, 0.3)' },
  ],
  STOCHRSI: [
    { value: 80, color: 'rgba(239, 68, 68, 0.3)' },
    { value: 20, color: 'rgba(34, 197, 94, 0.3)' },
  ],
  CCI: [
    { value: 100, color: 'rgba(239, 68, 68, 0.3)' },
    { value: -100, color: 'rgba(34, 197, 94, 0.3)' },
    { value: 0, color: 'rgba(255, 255, 255, 0.06)' },
  ],
  WILLR: [
    { value: -20, color: 'rgba(239, 68, 68, 0.3)' },
    { value: -80, color: 'rgba(34, 197, 94, 0.3)' },
  ],
  MFI: [
    { value: 80, color: 'rgba(239, 68, 68, 0.3)' },
    { value: 20, color: 'rgba(34, 197, 94, 0.3)' },
  ],
  MACD: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  AO: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  TSI: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  PPO: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  APO: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  ROC: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  MOM: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  CHOP: [
    { value: 61.8, color: 'rgba(239, 68, 68, 0.25)' },
    { value: 38.2, color: 'rgba(34, 197, 94, 0.25)' },
  ],
  ADX: [
    { value: 25, color: 'rgba(255, 255, 255, 0.1)' },
  ],
};

export function getReferenceLines(panelKey: string): { value: number; color: string }[] {
  const family = panelKey.split('_')[0];
  return REFERENCE_LINES[family] || [];
}

/** Whether the indicator column should render as a histogram (colored bars). */
export function shouldRenderAsHistogram(column: string): boolean {
  return column.startsWith('MACDh_');
}
