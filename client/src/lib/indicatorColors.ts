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
  ADX: 0, AROON: 30, ATR: 25, OBV: 187,
  CDL: 50,
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
