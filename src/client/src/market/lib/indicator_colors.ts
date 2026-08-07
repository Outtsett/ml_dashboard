/**
 * Deterministic color mapping for indicator overlay lines.
 */

/**
 * Parse any CSS color (hex, rgb, hsl) into {r, g, b} values.
 * Falls back to a default teal if parsing fails.
 */
function parseColor(color: string): { r: number; g: number; b: number } {
  // Hex (#abc or #aabbcc)
  const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1]!;
    if (hex.length === 3) hex = hex[0]! + hex[0]! + hex[1]! + hex[1]! + hex[2]! + hex[2]!;
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  // hsl(h, s%, l%)
  const hslMatch = color.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]!) / 360;
    const s = parseFloat(hslMatch[2]!) / 100;
    const l = parseFloat(hslMatch[3]!) / 100;
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    };
  }
  // rgba/rgb
  const rgbMatch = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgbMatch) {
    return { r: parseInt(rgbMatch[1]!), g: parseInt(rgbMatch[2]!), b: parseInt(rgbMatch[3]!) };
  }
  return { r: 6, g: 182, b: 212 }; // fallback teal
}

/**
 * Get positive/negative histogram bar colors derived from an indicator's base color.
 * Positive bars use the base color; negative bars use a dimmed/reddened variant.
 */
export function getHistogramColors(baseColor: string): { positive: string; negative: string } {
  const { r, g, b } = parseColor(baseColor);
  return {
    positive: `rgba(${r}, ${g}, ${b}, 0.7)`,
    negative: `rgba(${Math.min(255, r + 60)}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 40)}, 0.45)`,
  };
}

// Named color palettes per indicator family
const INDICATOR_COLORS: Record<string, string> = {
  // Moving Averages â€” Blues
  'SMA_5': '#93c5fd', 'SMA_10': '#60a5fa', 'SMA_20': '#3b82f6',
  'SMA_50': '#2563eb', 'SMA_100': '#1d4ed8', 'SMA_200': '#1e40af',
  // EMAs â€” Greens
  // Orange ladder, light to dark, mirroring the SMA blue ladder above. The
  // period is encoded by lightness, so the six lines stay tellable apart on a
  // busy chart the same way the SMAs do — and orange-vs-blue distinguishes the
  // two families for a deuteranope, which green-vs-blue did not.
  'EMA_5': '#FFD98A', 'EMA_10': '#FBC55C', 'EMA_20': '#F2B02E',
  'EMA_50': '#E69F00', 'EMA_100': '#B87E00', 'EMA_200': '#8A5F00',
  // Other MAs
  'WMA_10': '#f59e0b', 'WMA_20': '#d97706',
  'DEMA_20': '#06b6d4', 'TEMA_20': '#0891b2',
  'HMA_20': '#ec4899', 'ALMA_9_6.0_0.85': '#f472b6',
  // ALMA (short key alias)
  'ALMA_9': '#f472b6',
  // Keltner Channels
  'KC_UPPER_20': '#38bdf8', 'KC_MIDDLE_20': '#0284c7', 'KC_LOWER_20': '#38bdf8',
  // Donchian Channels
  'DC_UPPER_20': '#a3e635', 'DC_MIDDLE_20': '#65a30d', 'DC_LOWER_20': '#a3e635',
  // SuperTrend
  'SUPERTREND_10': '#f59e0b',
  // Ichimoku
  'TENKAN_9': '#0072B2', 'KIJUN_26': '#3b82f6', 'SENKOUA_26': '#E69F00', 'SENKOUB_52': '#f97316', 'CHIKOU_26': '#a78bfa',
  // Awesome Oscillator
  'AO_5_34': '#E69F00',
  // Fisher
  'FISHER_9': '#e879f9', 'FISHER_TRIGGER_9': '#c084fc',
  // KST
  'KST': '#06b6d4', 'KST_SIGNAL': '#f97316',
  // QQE
  'QQE_14': '#a78bfa', 'QQE_RSI_14': '#22d3ee',
  // RVGI
  'RVGI_10': '#38bdf8', 'RVGI_SIGNAL_10': '#f97316',
  // TSI
  'TSI_25_13': '#E69F00', 'TSI_SIGNAL': '#0072B2',
  // SMI
  'SMI_14': '#c084fc', 'SMI_SIGNAL': '#f59e0b',
  // KDJ
  'KDJ_K_9': '#f59e0b', 'KDJ_D_9': '#3b82f6', 'KDJ_J_9': '#0072B2',
  // Vortex
  'VI_PLUS_14': '#E69F00', 'VI_MINUS_14': '#0072B2',
  // KVO
  'KVO_34_55': '#06b6d4', 'KVO_SIGNAL': '#f97316',
  // CKSP
  'CKSP_LONG': '#E69F00', 'CKSP_SHORT': '#0072B2',
  // Squeeze
  'SQZ_MOM': '#06b6d4', 'SQZ_SQUEEZE': '#0072B2',
  // HWC
  'HWC_UPPER': '#38bdf8', 'HWC_MIDDLE': '#0284c7', 'HWC_LOWER': '#38bdf8',
  // AccBands
  'ACCB_UPPER': '#c084fc', 'ACCB_MIDDLE': '#8b5cf6', 'ACCB_LOWER': '#c084fc',
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
  'PLUS_DI_14': '#E69F00', 'MINUS_DI_14': '#0072B2',
  'PLUS_DM_14': '#E69F00', 'MINUS_DM_14': '#0072B2',
  'DX_14': '#f59e0b', 'ADXR_14': '#d97706',
  // Aroon
  'AROON_UP_25': '#E69F00', 'AROON_DOWN_25': '#0072B2',
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
  'ADX_14': '#0072B2', 'ATRr_14': '#f97316',
  'VPOC_20': '#f59e0b',
  'OBV': '#06b6d4', 'WILLR_14': '#ec4899',
  'CCI_20': '#8b5cf6', 'CCI_14': '#a78bfa',
  'MFI_14': '#22d3ee',
};

// Family prefix â†’ base hue (HSL)
const FAMILY_HUES: Record<string, number> = {
  SMA: 217, EMA: 142, WMA: 38, DEMA: 187, TEMA: 187,
  HMA: 330, ALMA: 330, KAMA: 270, FWMA: 200,
  VIDYA: 270, VWMA: 200, HWMA: 330, MCGD: 170, JMA: 280, SINWMA: 200, SWMA: 210,
  SSF: 200, HILO: 340,
  BB: 263, KC: 200, DONCH: 170, ACCB: 270,
  SUPERTREND: 45, PSAR: 340,
  ISA: 280, ISB: 280, ITS: 320, IKS: 320, ICS: 300,
  TENKAN: 0, KIJUN: 217, SENKOUA: 142, SENKOUB: 25, CHIKOU: 263,
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
  // New subchart families
  AO: 142, BIAS: 200, CFO: 170, CG: 263, COPPOCK: 217,
  CRSI: 263, ER: 38, FISHER: 290, INERTIA: 200, KST: 187,
  PGO: 170, PSL: 38, QQE: 263, RSX: 263, RVGI: 200,
  STC: 330, TSI: 142, SMI: 270, SQZ: 187, KDJ: 38,
  WAD: 187, CHOP: 38, CKSP: 142, DPO: 217, QSTICK: 170,
  VI: 142, VHF: 200, DECAY: 38, microstructure: 25,
  ABERRATION: 25, MASSI: 200, UI: 330, PDIST: 25,
  BBW: 263, KCW: 200, RVI: 263, HWC: 200,
  CMF: 187, EFI: 142, EOM: 200, KVO: 187,
  NVI: 170, PVI: 142, PVR: 38, PVT: 187, VPCI: 200, VPOC: 38,
  ENTROPY: 263, KURTOSIS: 200, MAD: 170, MEDIAN: 200,
  QUANTILE: 200, SKEW: 200, ZSCORE: 263,
  EBSW: 300, REFLEX: 330,
  LOGRET: 142, PCTRET: 142, CUMLOGRET: 142, CUMPCTRET: 142,
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
  // Major MAs â€” thick
  if (/^(SMA|EMA)_(50|100|200)/.test(column)) return 2;
  // VWAP â€” prominent
  if (column === 'VWAP') return 2;
  // SuperTrend â€” prominent
  if (column.startsWith('SUPERTREND') && !column.includes('DIR')) return 2;
  // Band upper/lower â€” thin
  if (/^(BBU|BBL|KC_(UPPER|LOWER)|DC_(UPPER|LOWER)|ACCB_(UPPER|LOWER)|HWC_(UPPER|LOWER))/.test(column)) return 1;
  // Band middle â€” standard
  if (/^(BBM|KC_MIDDLE|DC_MIDDLE|ACCB_MIDDLE|HWC_MIDDLE)/.test(column)) return 1;
  // Ichimoku â€” thin
  if (/^(TENKAN|KIJUN|SENKOU|CHIKOU)/.test(column)) return 1;
  // PSAR dots â€” thin
  if (column === 'PSAR') return 1;
  // CDL patterns â€” thin
  if (column.startsWith('CDL_')) return 1;
  // Default
  return 1;
}

/**
 * Convert any CSS color to rgba() string with a given alpha.
 * Reuses parseColor internally.
 */
export function colorToRgba(color: string, alpha: number): string {
  const { r, g, b } = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

