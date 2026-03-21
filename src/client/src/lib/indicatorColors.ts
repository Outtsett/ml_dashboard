/**
 * Deterministic color mapping for indicator overlay lines.
 */

// Named color palettes per indicator family
const INDICATOR_COLORS: Record<string, string> = {
  // Moving Averages — Blues
  'SMA_5': '#93c5fd', 'SMA_10': '#60a5fa', 'SMA_20': '#3b82f6',
  'SMA_50': '#2563eb', 'SMA_100': '#1d4ed8', 'SMA_200': '#1e40af',
  // EMAs — Greens
  'EMA_5': '#86efac', 'EMA_10': '#4ade80', 'EMA_20': '#22c55e',
  'EMA_50': '#16a34a', 'EMA_100': '#15803d', 'EMA_200': '#166534',
  // Other MAs
  'WMA_10': '#f59e0b', 'WMA_20': '#d97706',
  'DEMA_20': '#06b6d4', 'TEMA_20': '#0891b2',
  'HMA_20': '#ec4899', 'ALMA_9_6.0_0.85': '#f472b6',
  // Bollinger
  'BBM_5_2.0': '#8b5cf6', 'BBU_5_2.0': '#a78bfa', 'BBL_5_2.0': '#a78bfa',
  // RSI
  'RSI_14': '#a78bfa', 'RSI_7': '#c4b5fd', 'RSI_21': '#7c3aed',
  // MACD
  'MACD_12_26_9': '#06b6d4', 'MACDh_12_26_9': '#94a3b8', 'MACDs_12_26_9': '#f97316',
  // Stochastic
  'STOCHk_14_3_3': '#f59e0b', 'STOCHd_14_3_3': '#d97706',
  // MACDEXT / MACDFIX
  'MACDEXT_12_26_9': '#0ea5e9', 'MACDEXTs_12_26_9': '#fb923c', 'MACDEXTh_12_26_9': '#94a3b8',
  'MACDFIX_9': '#38bdf8', 'MACDFIXs_9': '#fdba74', 'MACDFIXh_9': '#94a3b8',
  // Fast Stochastic
  'STOCHFk_5_3': '#fbbf24', 'STOCHFd_5_3': '#b45309',
  // StochRSI
  'STOCHRSIk_14_14_3_3': '#c084fc', 'STOCHRSId_14_14_3_3': '#9333ea',
  // Directional
  'PLUS_DI_14': '#22c55e', 'MINUS_DI_14': '#ef4444',
  'PLUS_DM_14': '#4ade80', 'MINUS_DM_14': '#f87171',
  'DX_14': '#f59e0b', 'ADXR_14': '#d97706',
  // Aroon
  'AROON_UP_25': '#22c55e', 'AROON_DOWN_25': '#ef4444',
  'AROONOSC_25': '#a78bfa',
  // Momentum
  'MOM_10': '#38bdf8', 'ROC_10': '#0ea5e9', 'CMO_14': '#c084fc',
  'APO_12_26': '#14b8a6', 'PPO_12_26': '#2dd4bf',
  'BOP': '#94a3b8', 'ULTOSC_7_14_28': '#e879f9', 'TRIX_15': '#a3e635',
  // Volatility
  'ATR_14': '#f97316', 'NATR_14': '#fb923c', 'TRANGE': '#fdba74',
  // Volume
  'AD': '#06b6d4', 'ADOSC_3_10': '#22d3ee',
  // Statistics
  'STDEV_20': '#a78bfa', 'VAR_20': '#c4b5fd',
  'LINREG_SLOPE_20': '#60a5fa', 'LINREG_ANGLE_20': '#93c5fd',
  // Others
  'ADX_14': '#ef4444', 'ATRr_14': '#f97316',
  'OBV': '#06b6d4', 'WILLR_14': '#ec4899',
  'CCI_20': '#8b5cf6', 'CCI_14': '#a78bfa',
  'MFI_14': '#22d3ee',
};

// Family prefix → base hue (HSL)
const FAMILY_HUES: Record<string, number> = {
  SMA: 217, EMA: 142, WMA: 38, DEMA: 187, TEMA: 187,
  HMA: 330, ALMA: 330, KAMA: 270, FWMA: 200,
  BB: 263, KC: 200, DONCH: 170, ACCB: 160,
  SUPERTREND: 45, PSAR: 340,
  ISA: 280, ISB: 280, ITS: 320, IKS: 320, ICS: 300,
  RSI: 263, MACD: 187, STOCH: 38, CCI: 263,
  ADX: 0, ADXR: 25, DX: 38, AROON: 30, ATR: 25, OBV: 187,
  CDL: 50, MOM: 200, ROC: 200, CMO: 270, APO: 170, PPO: 170,
  BOP: 210, ULTOSC: 290, TRIX: 80, MFI: 187,
  NATR: 25, TRANGE: 30, AD: 187, ADOSC: 187,
  WILLR: 330, STOCHF: 38, STOCHRSI: 270,
  MACDEXT: 200, MACDFIX: 200,
  PLUS: 142, MINUS: 0,
  STDEV: 263, VAR: 263,
  LINREG: 217, HT: 300,
  ROCP: 200, ROCR: 200, ROCR100: 200,
  AROONOSC: 30,
  VWAP: 200, ZL: 160, RMA: 170, TRIMA: 210,
};

/**
 * Hash a string to a number for deterministic color generation.
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Get a deterministic color for an indicator column name.
 */
export function getIndicatorColor(column: string): string {
  // Check exact match first
  if (INDICATOR_COLORS[column]) return INDICATOR_COLORS[column];

  // Check family prefix
  const prefix = column.split('_')[0];
  if (prefix !== undefined && FAMILY_HUES[prefix] !== undefined) {
    const hue = FAMILY_HUES[prefix]!;
    // Vary saturation/lightness based on full column name hash
    const h = hashCode(column);
    const saturation = 60 + (h % 30);
    const lightness = 50 + (h % 20);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }

  // Fallback: hash-based HSL from full name
  const h = hashCode(column);
  return `hsl(${h % 360}, ${60 + (h % 30)}%, ${50 + (h % 20)}%)`;
}

/**
 * Get line width for an indicator (thicker for important MAs, thinner for bands).
 */
export function getIndicatorLineWidth(column: string): number {
  if (column.startsWith('SMA_200') || column.startsWith('EMA_200')) return 2;
  if (column.startsWith('SMA_50') || column.startsWith('EMA_50')) return 2;
  if (column.startsWith('BBL_') || column.startsWith('BBU_')) return 1;
  if (column.startsWith('CDL_')) return 1;
  return 1;
}
