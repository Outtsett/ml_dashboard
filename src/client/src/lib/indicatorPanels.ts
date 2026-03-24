/**
 * Indicator panel grouping, labeling, and metadata for professional subchart rendering.
 *
 * Supports both:
 * - Legacy column names (e.g., "RSI_14", "MACD_12_26_9")
 * - New instance-based names (e.g., "ind_123_1_abc::value", "ind_123_1_abc::histogram")
 */

import type { IndicatorOverlay } from '@/hooks/useIndicatorData';
import { getIndicatorDefinition } from '@/lib/indicatorRegistry';

/**
 * Extract the instanceId from a new-format column name.
 * Returns null if the column is legacy format.
 */
function parseInstanceColumn(column: string): { instanceId: string; outputKey: string } | null {
  const idx = column.indexOf('::');
  if (idx === -1) return null;
  return {
    instanceId: column.slice(0, idx),
    outputKey: column.slice(idx + 2),
  };
}

/**
 * Derive a panel key from an indicator column name.
 * Related indicators (e.g., MACD/MACDs/MACDh) share the same panel.
 *
 * For the new instance-based system, outputs from the same instance share a panel
 * keyed by the instanceId.
 */
export function getSubchartPanelKey(column: string): string {
  // New instance-based format: "ind_123_1_abc::outputKey" → group by instanceId
  const parsed = parseInstanceColumn(column);
  if (parsed) {
    return parsed.instanceId;
  }

  // Legacy column format — kept for backward compatibility
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
  // MACDEXT variants: MACDEXT_, MACDEXTs_, MACDEXTh_ → MACDEXT_...
  if (/^MACDEXT[hs]?_/.test(column)) {
    return column.replace(/^MACDEXT[hs]?_/, 'MACDEXT_');
  }
  // MACDFIX variants: MACDFIX_, MACDFIXs_, MACDFIXh_ → MACDFIX_...
  if (/^MACDFIX[hs]?_/.test(column)) {
    return column.replace(/^MACDFIX[hs]?_/, 'MACDFIX_');
  }
  // Fast Stochastic: STOCHFk_, STOCHFd_ → STOCHF_...
  if (/^STOCHF[kd]_/.test(column)) {
    return column.replace(/^STOCHF[kd]_/, 'STOCHF_');
  }
  // Aroon: AROON_UP_, AROON_DOWN_ → AROON_...
  if (/^AROON_(UP|DOWN)_/.test(column)) {
    return column.replace(/^AROON_(UP|DOWN)_/, 'AROON_');
  }
  // Aroon: AROONd_, AROONu_ → AROON_...
  if (/^AROON[du]_/.test(column)) {
    return column.replace(/^AROON[du]_/, 'AROON_');
  }
  // PLUS_DI / MINUS_DI → DI panel (group with ADX)
  if (/^(PLUS|MINUS)_DI_/.test(column)) {
    const period = column.match(/_(\d+)$/)?.[1] ?? '14';
    return `ADX_${period}`;
  }
  // PLUS_DM / MINUS_DM → DM panel
  if (/^(PLUS|MINUS)_DM_/.test(column)) {
    const period = column.match(/_(\d+)$/)?.[1] ?? '14';
    return `DM_${period}`;
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

// ─── Instance label registry (populated by useActiveIndicators) ──────────────
// Maps instanceId → display label (e.g., "RSI (14)", "MACD (12,26,9)")
const instanceLabelMap = new Map<string, string>();

/** Register an instance label for panel display */
export function registerInstanceLabel(instanceId: string, label: string) {
  instanceLabelMap.set(instanceId, label);
}

/** Unregister an instance label */
export function unregisterInstanceLabel(instanceId: string) {
  instanceLabelMap.delete(instanceId);
}

/** Clear all instance labels */
export function clearInstanceLabels() {
  instanceLabelMap.clear();
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
  MACDEXT: 'MACD Ext',
  MACDFIX: 'MACD Fix',
  STOCHF: 'Fast Stoch',
  PLUS_DI: '+DI',
  MINUS_DI: '-DI',
  PLUS_DM: '+DM',
  MINUS_DM: '-DM',
  DX: 'DX',
  ADXR: 'ADXR',
  AROON_UP: 'Aroon Up',
  AROON_DOWN: 'Aroon Dn',
  TRANGE: 'True Range',
  HT_DCPERIOD: 'HT DC Period',
  HT_DCPHASE: 'HT DC Phase',
  HT_TRENDMODE: 'HT Trend Mode',
  HT_SINE: 'HT Sine',
  HT_PHASOR: 'HT Phasor',
  LINREG_SLOPE: 'LinReg Slope',
  LINREG_ANGLE: 'LinReg Angle',
  CMO: 'Chande MO',
  ROCP: 'ROC %',
  ROCR: 'ROC Ratio',
  ROCR100: 'ROC Ratio 100',
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
  // Check instance label registry first (new system)
  const instanceLabel = instanceLabelMap.get(panelKey);
  if (instanceLabel) return instanceLabel;

  // Legacy column-based format
  const parts = panelKey.split('_');
  const name = parts[0]!;
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
  ADXR: [
    { value: 25, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  DX: [
    { value: 25, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  STOCHF: [
    { value: 80, color: 'rgba(239, 68, 68, 0.3)' },
    { value: 20, color: 'rgba(34, 197, 94, 0.3)' },
  ],
  AROON: [
    { value: 70, color: 'rgba(239, 68, 68, 0.25)' },
    { value: 30, color: 'rgba(34, 197, 94, 0.25)' },
  ],
  AROONOSC: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  CMO: [
    { value: 50, color: 'rgba(239, 68, 68, 0.25)' },
    { value: -50, color: 'rgba(34, 197, 94, 0.25)' },
    { value: 0, color: 'rgba(255, 255, 255, 0.06)' },
  ],
  BOP: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  ULTOSC: [
    { value: 70, color: 'rgba(239, 68, 68, 0.3)' },
    { value: 30, color: 'rgba(34, 197, 94, 0.3)' },
  ],
  TRIX: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  MACDEXT: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
  MACDFIX: [
    { value: 0, color: 'rgba(255, 255, 255, 0.1)' },
  ],
};

// ─── Instance reference lines registry ───────────────────────────────────────
const instanceReferenceLinesMap = new Map<string, { value: number; color: string }[]>();

/** Register reference lines for an instance */
export function registerInstanceReferenceLines(instanceId: string, lines: { value: number; color: string }[]) {
  instanceReferenceLinesMap.set(instanceId, lines);
}

/** Unregister instance reference lines */
export function unregisterInstanceReferenceLines(instanceId: string) {
  instanceReferenceLinesMap.delete(instanceId);
}

export function getReferenceLines(panelKey: string): { value: number; color: string }[] {
  // Check instance registry first (new system)
  const instanceLines = instanceReferenceLinesMap.get(panelKey);
  if (instanceLines) return instanceLines;

  // Legacy column-based format
  const family = panelKey.split('_')[0]!;
  return REFERENCE_LINES[family] || [];
}

/** Get a display title for an individual series within a subchart panel.
 *  column format: "instanceId::outputKey" e.g. "ind_123_1_abc::value"
 *  Returns e.g. "RSI (14)" for single-output or "MACD Signal" for multi-output indicators. */
export function getSeriesTitle(column: string): string {
  const parsed = parseInstanceColumn(column);
  if (!parsed) {
    // Legacy format — use column as-is
    const parts = column.split('_');
    return PANEL_DISPLAY_NAMES[parts[0]!] || parts[0]!;
  }

  const panelLabel = instanceLabelMap.get(parsed.instanceId) || parsed.instanceId;
  const key = parsed.outputKey;

  // Single-output indicators just use the panel label
  if (key === 'value' || key === 'default' || key === '') return panelLabel;

  // Multi-output: build "MACD Signal", "MACD Histogram", etc.
  const OUTPUT_LABELS: Record<string, string> = {
    signal: 'Signal',
    histogram: 'Histogram',
    slowk: '%K',
    slowd: '%D',
    fastk: 'Fast %K',
    fastd: 'Fast %D',
    macd: 'MACD',
    macdsignal: 'Signal',
    macdhist: 'Histogram',
    aroondown: 'Down',
    aroonup: 'Up',
    upperband: 'Upper',
    middleband: 'Middle',
    lowerband: 'Lower',
    plus_di: '+DI',
    minus_di: '-DI',
  };

  const friendlyKey = OUTPUT_LABELS[key.toLowerCase()] || key;
  // Extract base indicator name (before params parenthetical)
  const baseName = panelLabel.replace(/\s*\(.*\)$/, '');
  return `${baseName} ${friendlyKey}`;
}

/** Whether the indicator column should render as a histogram (colored bars). */
export function shouldRenderAsHistogram(column: string): boolean {
  // New instance-based format: check outputKey
  const parsed = parseInstanceColumn(column);
  if (parsed) {
    return parsed.outputKey === 'histogram';
  }

  // Legacy format
  return column.startsWith('MACDh_') ||
         column.startsWith('MACDEXTh_') ||
         column.startsWith('MACDFIXh_');
}
