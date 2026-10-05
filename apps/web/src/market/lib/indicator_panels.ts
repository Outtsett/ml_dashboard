/**
 * Indicator panel grouping, labeling, and metadata for professional subchart rendering.
 *
 * Supports both:
 * - Legacy column names (e.g., "RSI_14", "MACD_12_26_9")
 * - New instance-based names (e.g., "ind_123_1_abc::value", "ind_123_1_abc::histogram")
 */

import type { IndicatorOverlay } from "@/market/lib/useIndicatorData";

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
  // New instance-based format: "ind_123_1_abc::outputKey" â†’ group by instanceId
  const parsed = parseInstanceColumn(column);
  if (parsed) {
    return parsed.instanceId;
  }

  // Legacy column format â€” kept for backward compatibility
  // MACD variants: MACD_, MACDs_, MACDh_ â†’ MACD_...
  if (/^MACD[hs]?_/.test(column)) {
    return column.replace(/^MACD[hs]?_/, 'MACD_');
  }
  // Stochastic: STOCHk_, STOCHd_ â†’ STOCH_...
  if (/^STOCH[kd]_/.test(column)) {
    return column.replace(/^STOCH[kd]_/, 'STOCH_');
  }
  // StochRSI: STOCHRSIk_, STOCHRSId_ â†’ STOCHRSI_...
  if (/^STOCHRSI[kd]_/.test(column)) {
    return column.replace(/^STOCHRSI[kd]_/, 'STOCHRSI_');
  }
  // MACDEXT variants: MACDEXT_, MACDEXTs_, MACDEXTh_ â†’ MACDEXT_...
  if (/^MACDEXT[hs]?_/.test(column)) {
    return column.replace(/^MACDEXT[hs]?_/, 'MACDEXT_');
  }
  // MACDFIX variants: MACDFIX_, MACDFIXs_, MACDFIXh_ â†’ MACDFIX_...
  if (/^MACDFIX[hs]?_/.test(column)) {
    return column.replace(/^MACDFIX[hs]?_/, 'MACDFIX_');
  }
  // Fast Stochastic: STOCHFk_, STOCHFd_ â†’ STOCHF_...
  if (/^STOCHF[kd]_/.test(column)) {
    return column.replace(/^STOCHF[kd]_/, 'STOCHF_');
  }
  // Aroon: AROON_UP_, AROON_DOWN_ â†’ AROON_...
  if (/^AROON_(UP|DOWN)_/.test(column)) {
    return column.replace(/^AROON_(UP|DOWN)_/, 'AROON_');
  }
  // Aroon: AROONd_, AROONu_ â†’ AROON_...
  if (/^AROON[du]_/.test(column)) {
    return column.replace(/^AROON[du]_/, 'AROON_');
  }
  // PLUS_DI / MINUS_DI â†’ DI panel (group with ADX)
  if (/^(PLUS|MINUS)_DI_/.test(column)) {
    const period = column.match(/_(\d+)$/)?.[1] ?? '14';
    return `ADX_${period}`;
  }
  // PLUS_DM / MINUS_DM â†’ DM panel
  if (/^(PLUS|MINUS)_DM_/.test(column)) {
    const period = column.match(/_(\d+)$/)?.[1] ?? '14';
    return `DM_${period}`;
  }
  // Directional Movement: DMP_, DMN_ â†’ DM_...
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

// â”€â”€â”€ Instance label registry (populated by useActiveIndicators) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Maps instanceId â†’ display label (e.g., "RSI (14)", "MACD (12,26,9)")
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
  BIAS: 'Bias',
  CFO: 'CFO',
  CG: 'Center of Gravity',
  COPPOCK: 'Coppock',
  CRSI: 'Connors RSI',
  ER: 'Efficiency Ratio',
  INERTIA: 'Inertia',
  PGO: 'PGO',
  PSL: 'Psych Line',
  RSX: 'RSX',
  SMI: 'SMI',
  WAD: 'Williams AD',
  CKSP: 'Chande Kroll',
  QSTICK: 'QStick',
  VI: 'Vortex',
  microstructure: 'microstructure',
  DECAY: 'Linear Decay',
  MASSI: 'Mass Index',
  UI: 'Ulcer Index',
  PDIST: 'Price Distance',
  BBW: 'BB Width',
  KCW: 'KC Width',
  RVI: 'RVI',
  EOM: 'Ease of Movement',
  PVR: 'Price Vol Rank',
  PVT: 'Price Vol Trend',
  VPCI: 'VPCI',
  VPOC: 'VPOC',
  CUMLOGRET: 'Cum Log Return',
  CUMPCTRET: 'Cum Pct Return',
  SQZPRO: 'Squeeze Pro',
};

/** Get a display label for a panel key like "MACD_12_26_9" â†’ "MACD (12,26,9)" */
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
    { value: 70, color: 'rgba(239, 68, 68, 0.45)' },
    { value: 30, color: 'rgba(34, 197, 94, 0.45)' },
    { value: 50, color: 'rgba(255, 255, 255, 0.15)' },
  ],
  STOCH: [
    { value: 80, color: 'rgba(239, 68, 68, 0.45)' },
    { value: 20, color: 'rgba(34, 197, 94, 0.45)' },
  ],
  STOCHRSI: [
    { value: 80, color: 'rgba(239, 68, 68, 0.45)' },
    { value: 20, color: 'rgba(34, 197, 94, 0.45)' },
  ],
  CCI: [
    { value: 100, color: 'rgba(239, 68, 68, 0.45)' },
    { value: -100, color: 'rgba(34, 197, 94, 0.45)' },
    { value: 0, color: 'rgba(255, 255, 255, 0.15)' },
  ],
  WILLR: [
    { value: -20, color: 'rgba(239, 68, 68, 0.45)' },
    { value: -80, color: 'rgba(34, 197, 94, 0.45)' },
  ],
  MFI: [
    { value: 80, color: 'rgba(239, 68, 68, 0.45)' },
    { value: 20, color: 'rgba(34, 197, 94, 0.45)' },
  ],
  MACD: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  AO: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  TSI: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  PPO: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  APO: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  ROC: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  MOM: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  CHOP: [
    { value: 61.8, color: 'rgba(239, 68, 68, 0.4)' },
    { value: 38.2, color: 'rgba(34, 197, 94, 0.4)' },
  ],
  ADX: [
    { value: 25, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  ADXR: [
    { value: 25, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  DX: [
    { value: 25, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  STOCHF: [
    { value: 80, color: 'rgba(239, 68, 68, 0.45)' },
    { value: 20, color: 'rgba(34, 197, 94, 0.45)' },
  ],
  AROON: [
    { value: 70, color: 'rgba(239, 68, 68, 0.4)' },
    { value: 30, color: 'rgba(34, 197, 94, 0.4)' },
  ],
  AROONOSC: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  CMO: [
    { value: 50, color: 'rgba(239, 68, 68, 0.4)' },
    { value: -50, color: 'rgba(34, 197, 94, 0.4)' },
    { value: 0, color: 'rgba(255, 255, 255, 0.15)' },
  ],
  BOP: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  ULTOSC: [
    { value: 70, color: 'rgba(239, 68, 68, 0.45)' },
    { value: 30, color: 'rgba(34, 197, 94, 0.45)' },
  ],
  TRIX: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  MACDEXT: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  MACDFIX: [
    { value: 0, color: 'rgba(255, 255, 255, 0.2)' },
  ],
  BIAS: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  CFO: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  COPPOCK: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  CRSI: [{ value: 70, color: 'rgba(239,68,68,0.45)' }, { value: 30, color: 'rgba(34,197,94,0.45)' }],
  INERTIA: [{ value: 50, color: 'rgba(255,255,255,0.2)' }],
  KST: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  PGO: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  PSL: [{ value: 50, color: 'rgba(255,255,255,0.2)' }],
  RSX: [{ value: 70, color: 'rgba(239,68,68,0.45)' }, { value: 30, color: 'rgba(34,197,94,0.45)' }],
  STC: [{ value: 75, color: 'rgba(239,68,68,0.45)' }, { value: 25, color: 'rgba(34,197,94,0.45)' }],
  SMI: [{ value: 40, color: 'rgba(239,68,68,0.45)' }, { value: -40, color: 'rgba(34,197,94,0.45)' }],
  KDJ: [{ value: 80, color: 'rgba(239,68,68,0.45)' }, { value: 20, color: 'rgba(34,197,94,0.45)' }],
  DPO: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  QSTICK: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  VHF: [{ value: 0.5, color: 'rgba(255,255,255,0.2)' }],
  MASSI: [{ value: 27, color: 'rgba(239,68,68,0.45)' }, { value: 26.5, color: 'rgba(34,197,94,0.45)' }],
  RVI: [{ value: 50, color: 'rgba(255,255,255,0.2)' }],
  CMF: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  EFI: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  EOM: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  KVO: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  VPCI: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  VPOC_DIST: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  ZSCORE: [{ value: 2, color: 'rgba(239,68,68,0.45)' }, { value: -2, color: 'rgba(34,197,94,0.45)' }, { value: 0, color: 'rgba(255,255,255,0.15)' }],
  REFLEX: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  LOGRET: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  PCTRET: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  FISHER: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  RVGI: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
  WAD: [{ value: 0, color: 'rgba(255,255,255,0.2)' }],
};

// â”€â”€â”€ Instance reference lines registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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


// ─── Per-column registry (lake series) ───────────────────────────────────────
// A lake column is not a parameterised indicator instance, so its title and its
// histogram-ness are registered per column rather than derived from an output
// key. Registered entries win over every rule below them.
const seriesTitleMap = new Map<string, string>();
const histogramColumns = new Set<string>();

export function registerSeriesTitle(column: string, title: string) {
  seriesTitleMap.set(column, title);
}

export function unregisterSeriesTitle(column: string) {
  seriesTitleMap.delete(column);
  histogramColumns.delete(column);
  baselineColumns.delete(column);
  stepColumns.delete(column);
}

export function registerHistogramColumn(column: string) {
  histogramColumns.add(column);
}

/**
 * A filled area measured against a base value rather than a bare line — equity
 * net of costs, where the area between the curve and zero is the reading. Only
 * a baseline series carries the fill; a line would hide the sign of the fill.
 */
const baselineColumns = new Set<string>();

export function registerBaselineColumn(column: string) {
  baselineColumns.add(column);
}

/** Whether the column draws as a filled area against zero (equity-style). */
export function shouldRenderAsBaseline(column: string): boolean {
  return baselineColumns.has(column);
}

/**
 * A discrete state holds its value until it changes. Drawing a straight line
 * between two states renders a value that never existed, so these draw as
 * steps.
 */
const stepColumns = new Set<string>();

export function registerStepColumn(column: string) {
  stepColumns.add(column);
}

export function shouldRenderAsStep(column: string): boolean {
  return stepColumns.has(column);
}

/** Get a display title for an individual series within a subchart panel.
 *  column format: "instanceId::outputKey" e.g. "ind_123_1_abc::value"
 *  Returns e.g. "RSI (14)" for single-output or "MACD Signal" for multi-output indicators. */
export function getSeriesTitle(column: string): string {
  const registered = seriesTitleMap.get(column);
  if (registered) return registered;

  const parsed = parseInstanceColumn(column);
  if (!parsed) {
    // Legacy format â€” use column as-is
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
    trigger: 'Trigger',
    fisher: 'Fisher',
    kst: 'KST',
    qqe: 'QQE',
    rsismooth: 'RSI Smooth',
    rvgi: 'RVGI',
    tsi: 'TSI',
    smi: 'SMI',
    kvo: 'KVO',
    viplus: 'VI+',
    viminus: 'VI-',
    stoplong: 'Stop Long',
    stopshort: 'Stop Short',
    squeeze: 'Squeeze',
    tenkan: 'Tenkan',
    kijun: 'Kijun',
    senkoua: 'Senkou A',
    senkoub: 'Senkou B',
    chikou: 'Chikou',
    momentum: 'Momentum',
  };

  const friendlyKey = OUTPUT_LABELS[key.toLowerCase()] || key;
  // Extract base indicator name (before params parenthetical)
  const baseName = panelLabel.replace(/\s*\(.*\)$/, '');
  return `${baseName} ${friendlyKey}`;
}

/** Whether the indicator column should render as a histogram (colored bars). */
export function shouldRenderAsHistogram(column: string): boolean {
  if (histogramColumns.has(column)) return true;

  // New instance-based format: check outputKey
  const parsed = parseInstanceColumn(column);
  if (parsed) {
    if (parsed.outputKey === 'histogram' || parsed.outputKey === 'momentum') return true;
    // Check if the instance's indicator has histogram style for this output
    const instLabel = instanceLabelMap.get(parsed.instanceId);
    if (instLabel) {
      const family = instLabel.replace(/\s*\(.*\)$/, '');
      if (HISTOGRAM_VALUE_INDICATORS.has(family) && parsed.outputKey === 'value') return true;
    }
    return false;
  }

  // Legacy format
  return column.startsWith('MACDh_') ||
         column.startsWith('MACDEXTh_') ||
         column.startsWith('MACDFIXh_') ||
         column.startsWith('AO_');
}

/** Indicators where outputKey 'value' should render as histogram */
const HISTOGRAM_VALUE_INDICATORS = new Set([
  'Awesome Osc', 'AO', 'PDIST', 'Price Distance',
  'Log Return', 'LOGRET', 'Pct Return', 'PCTRET',
]);

/**
 * Histogram coloring style for directional per-bar colors.
 * Returns 'ao' for Awesome Oscillator style (green=increasing, red=decreasing)
 * Returns 'squeeze' for Squeeze Momentum style (4-color momentum intensity)
 * Returns null for standard positive/negative coloring.
 */
export function getHistogramStyle(column: string): 'ao' | 'squeeze' | null {
  const parsed = parseInstanceColumn(column);
  if (parsed) {
    const instLabel = instanceLabelMap.get(parsed.instanceId) || '';
    const family = instLabel.replace(/\s*\(.*\)$/, '');
    if (family === 'Awesome Osc' || family === 'AO') return 'ao';
    if ((family === 'Squeeze' || family === 'SQZ' || family === 'Squeeze Pro' || family === 'SQZ Pro')
        && parsed.outputKey === 'momentum') return 'squeeze';
    return null;
  }
  // Legacy format
  if (column.startsWith('AO_')) return 'ao';
  if (column.startsWith('SQZ_MOM') || column.startsWith('SQZPRO_MOM')) return 'squeeze';
  return null;
}

