/**
 * Active Indicator State Management — manages the lifecycle of indicator
 * instances that the user has added to the chart.
 *
 * Each instance has a unique ID, references an indicator definition from
 * the registry, and stores user-configured params.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getIndicatorDefinition } from '@/lib/indicatorRegistry';
import { computeAllIndicators, type ComputedIndicator } from '@/lib/indicatorCompute';
import { getIndicatorColor, getIndicatorLineWidth } from '@/lib/indicatorColors';
import {
  registerInstanceLabel, registerInstanceReferenceLines,
  unregisterInstanceLabel, unregisterInstanceReferenceLines,
} from '@/lib/indicatorPanels';
import type { IndicatorOverlay, IndicatorDisplayType } from '@/hooks/useIndicatorData';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ActiveIndicator {
  instanceId: string;
  indicatorId: string;
  params: Record<string, number>;
  visible: boolean;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'active-indicators-v2';

function loadActiveIndicators(): ActiveIndicator[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveActiveIndicators(indicators: ActiveIndicator[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(indicators));
  } catch {
    // ignore quota errors
  }
}

// ─── UUID ────────────────────────────────────────────────────────────────────

let counter = 0;
function generateId(): string {
  counter++;
  return `ind_${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Color assignment for multi-output indicators ────────────────────────────

const MULTI_OUTPUT_COLORS: Record<string, Record<string, string>> = {
  macd: {
    macd: '#06b6d4',
    signal: '#f97316',
    histogram: '#94a3b8',
  },
  macdext: {
    macd: '#06b6d4',
    signal: '#f97316',
    histogram: '#94a3b8',
  },
  macdfix: {
    macd: '#06b6d4',
    signal: '#f97316',
    histogram: '#94a3b8',
  },
  stochastic: {
    k: '#f59e0b',
    d: '#d97706',
  },
  stochf: {
    k: '#f59e0b',
    d: '#d97706',
  },
  stochrsi: {
    k: '#c084fc',
    d: '#9333ea',
  },
  bbands: {
    upper: '#a78bfa',
    middle: '#8b5cf6',
    lower: '#a78bfa',
  },
  mama: {
    mama: '#ec4899',
    fama: '#f472b6',
  },
  adx: {
    adx: '#ef4444',
    plusDI: '#22c55e',
    minusDI: '#ef4444',
  },
  aroon: {
    up: '#22c55e',
    down: '#ef4444',
  },
  ht_phasor: {
    inphase: '#38bdf8',
    quadrature: '#818cf8',
  },
  ht_sine: {
    sine: '#2dd4bf',
    leadsine: '#a78bfa',
  },
};

function getOutputColor(indicatorId: string, outputKey: string, fallbackColumn: string): string {
  const colors = MULTI_OUTPUT_COLORS[indicatorId];
  if (colors && colors[outputKey]) return colors[outputKey];
  return getIndicatorColor(fallbackColumn);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface OHLCVBarInput {
  timestamp: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function useActiveIndicators(ohlcvBars: OHLCVBarInput[] = []) {
  const [indicators, setIndicators] = useState<ActiveIndicator[]>(loadActiveIndicators);

  // Persist to localStorage on change
  useEffect(() => {
    saveActiveIndicators(indicators);
  }, [indicators]);

  // Sync from localStorage on mount (in case another tab changed it)
  useEffect(() => {
    const stored = loadActiveIndicators();
    if (stored.length > 0) setIndicators(stored);
  }, []);

  // ── Normalize OHLCV bars ──
  const normalizedBars = useMemo(() => {
    if (ohlcvBars.length === 0) return [];
    return ohlcvBars.map(b => ({
      timestamp: typeof b.timestamp === 'string' ? parseInt(b.timestamp) : b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
  }, [ohlcvBars]);

  // ── Add an indicator with default params ──
  const addIndicator = useCallback((indicatorId: string) => {
    const def = getIndicatorDefinition(indicatorId);
    if (!def) return;

    const params: Record<string, number> = {};
    for (const p of def.params) {
      params[p.key] = p.default;
    }

    const newIndicator: ActiveIndicator = {
      instanceId: generateId(),
      indicatorId,
      params,
      visible: true,
    };

    setIndicators(prev => [...prev, newIndicator]);
  }, []);

  // ── Remove an indicator instance ──
  const removeIndicator = useCallback((instanceId: string) => {
    setIndicators(prev => prev.filter(i => i.instanceId !== instanceId));
  }, []);

  // ── Update params for an instance ──
  const updateParams = useCallback((instanceId: string, params: Record<string, number>) => {
    setIndicators(prev =>
      prev.map(i => i.instanceId === instanceId ? { ...i, params } : i),
    );
  }, []);

  // ── Toggle visibility ──
  const toggleVisibility = useCallback((instanceId: string) => {
    setIndicators(prev =>
      prev.map(i => i.instanceId === instanceId ? { ...i, visible: !i.visible } : i),
    );
  }, []);

  // ── Clear all ──
  const clearAll = useCallback(() => {
    setIndicators([]);
  }, []);

  // ── Register instance labels and reference lines for subchart panels ──
  useEffect(() => {
    for (const ind of indicators) {
      const def = getIndicatorDefinition(ind.indicatorId);
      if (!def) continue;

      // Build label: "RSI (14)" or "MACD (12,26,9)"
      const paramVals = def.params.map(p => ind.params[p.key] ?? p.default);
      const label = paramVals.length > 0
        ? `${def.name} (${paramVals.join(',')})`
        : def.name;
      registerInstanceLabel(ind.instanceId, label);

      // Register reference lines if the indicator definition has them
      if (def.referenceLines && def.referenceLines.length > 0) {
        registerInstanceReferenceLines(ind.instanceId, def.referenceLines);
      }
    }

    return () => {
      for (const ind of indicators) {
        unregisterInstanceLabel(ind.instanceId);
        unregisterInstanceReferenceLines(ind.instanceId);
      }
    };
  }, [indicators]);

  // ── Compute indicator data → IndicatorOverlay[] for the chart ──
  const overlays = useMemo<IndicatorOverlay[]>(() => {
    if (normalizedBars.length === 0 || indicators.length === 0) return [];

    const computed = computeAllIndicators(indicators, normalizedBars);
    const result: IndicatorOverlay[] = [];

    for (const comp of computed) {
      const def = getIndicatorDefinition(comp.indicatorId);
      if (!def) continue;

      for (const output of comp.outputs) {
        // Build a column name for color/width lookup
        const columnName = buildDisplayColumn(comp.indicatorId, output.outputKey, comp.outputs.length > 1);
        const displayType: IndicatorDisplayType = comp.displayType === 'overlay' ? 'overlay' : 'subchart';

        result.push({
          column: `${comp.instanceId}::${output.outputKey}`,
          data: output.data,
          color: getOutputColor(comp.indicatorId, output.outputKey, columnName),
          displayType,
          lineWidth: getIndicatorLineWidth(columnName),
        });
      }
    }

    return result;
  }, [indicators, normalizedBars]);

  return {
    indicators,
    addIndicator,
    removeIndicator,
    updateParams,
    toggleVisibility,
    clearAll,
    overlays,
  };
}

/** Build a legacy-compatible column name for color/width lookup */
function buildDisplayColumn(indicatorId: string, outputKey: string, isMulti: boolean): string {
  if (!isMulti) {
    switch (indicatorId) {
      // Overlap
      case 'sma': return 'SMA_20';
      case 'ema': return 'EMA_20';
      case 'wma': return 'WMA_20';
      case 'dema': return 'DEMA_20';
      case 'tema': return 'TEMA_20';
      case 'trima': return 'TRIMA_30';
      case 't3': return 'T3_5';
      case 'kama': return 'KAMA_10';
      case 'midpoint': return 'MIDPOINT_14';
      case 'midprice': return 'MIDPRICE_14';
      case 'ht_trendline': return 'HT_TRENDLINE';
      case 'tsf': return 'TSF_20';
      case 'linearreg': return 'LINREG_20';
      case 'psar': return 'PSAR';
      case 'vwap': return 'VWAP';
      // Momentum
      case 'rsi': return 'RSI_14';
      case 'cci': return 'CCI_20';
      case 'willr': return 'WILLR_14';
      case 'momentum': return 'MOM_10';
      case 'roc': return 'ROC_10';
      case 'rocp': return 'ROCP_10';
      case 'rocr': return 'ROCR_10';
      case 'rocr100': return 'ROCR100_10';
      case 'cmo': return 'CMO_14';
      case 'apo': return 'APO_12_26';
      case 'ppo': return 'PPO_12_26';
      case 'trix': return 'TRIX_15';
      case 'ultosc': return 'ULTOSC_7_14_28';
      case 'bop': return 'BOP';
      // Trend
      case 'adxr': return 'ADXR_14';
      case 'dx': return 'DX_14';
      case 'plus_di': return 'PLUS_DI_14';
      case 'minus_di': return 'MINUS_DI_14';
      case 'plus_dm': return 'PLUS_DM_14';
      case 'minus_dm': return 'MINUS_DM_14';
      case 'aroonosc': return 'AROONOSC_25';
      case 'ht_trendmode': return 'HT_TRENDMODE';
      // Volatility
      case 'atr': return 'ATR_14';
      case 'natr': return 'NATR_14';
      case 'trange': return 'TRANGE';
      // Volume
      case 'obv': return 'OBV';
      case 'ad': return 'AD';
      case 'adosc': return 'ADOSC_3_10';
      case 'mfi': return 'MFI_14';
      // Statistics
      case 'stddev': return 'STDEV_20';
      case 'variance': return 'VAR_20';
      case 'beta': return 'BETA_5';
      case 'correl': return 'CORREL_20';
      case 'linreg_slope': return 'LINREG_SLOPE_20';
      case 'linreg_angle': return 'LINREG_ANGLE_20';
      case 'linreg_intercept': return 'LINREG_INTERCEPT_20';
      // Hilbert Transform
      case 'ht_dcperiod': return 'HT_DCPERIOD';
      case 'ht_dcphase': return 'HT_DCPHASE';
      default: return indicatorId.toUpperCase();
    }
  }

  // Multi-output indicators
  switch (indicatorId) {
    case 'macd':
      if (outputKey === 'macd') return 'MACD_12_26_9';
      if (outputKey === 'signal') return 'MACDs_12_26_9';
      if (outputKey === 'histogram') return 'MACDh_12_26_9';
      return 'MACD_12_26_9';
    case 'macdext':
      if (outputKey === 'macd') return 'MACDEXT_12_26_9';
      if (outputKey === 'signal') return 'MACDEXTs_12_26_9';
      if (outputKey === 'histogram') return 'MACDEXTh_12_26_9';
      return 'MACDEXT_12_26_9';
    case 'macdfix':
      if (outputKey === 'macd') return 'MACDFIX_9';
      if (outputKey === 'signal') return 'MACDFIXs_9';
      if (outputKey === 'histogram') return 'MACDFIXh_9';
      return 'MACDFIX_9';
    case 'stochastic':
      if (outputKey === 'k') return 'STOCHk_14_3_3';
      if (outputKey === 'd') return 'STOCHd_14_3_3';
      return 'STOCHk_14_3_3';
    case 'stochf':
      if (outputKey === 'k') return 'STOCHFk_5_3';
      if (outputKey === 'd') return 'STOCHFd_5_3';
      return 'STOCHFk_5_3';
    case 'stochrsi':
      if (outputKey === 'k') return 'STOCHRSIk_14_14_3_3';
      if (outputKey === 'd') return 'STOCHRSId_14_14_3_3';
      return 'STOCHRSIk_14_14_3_3';
    case 'bbands':
      if (outputKey === 'upper') return 'BBU_5_2.0';
      if (outputKey === 'middle') return 'BBM_5_2.0';
      if (outputKey === 'lower') return 'BBL_5_2.0';
      return 'BBM_5_2.0';
    case 'mama':
      if (outputKey === 'mama') return 'MAMA';
      if (outputKey === 'fama') return 'FAMA';
      return 'MAMA';
    case 'adx':
      if (outputKey === 'adx') return 'ADX_14';
      if (outputKey === 'plusDI') return 'PLUS_DI_14';
      if (outputKey === 'minusDI') return 'MINUS_DI_14';
      return 'ADX_14';
    case 'aroon':
      if (outputKey === 'up') return 'AROON_UP_25';
      if (outputKey === 'down') return 'AROON_DOWN_25';
      return 'AROON_UP_25';
    case 'ht_phasor':
      if (outputKey === 'inphase') return 'HT_PHASOR_INPHASE';
      if (outputKey === 'quadrature') return 'HT_PHASOR_QUADRATURE';
      return 'HT_PHASOR_INPHASE';
    case 'ht_sine':
      if (outputKey === 'sine') return 'HT_SINE_SINE';
      if (outputKey === 'leadsine') return 'HT_SINE_LEADSINE';
      return 'HT_SINE_SINE';
    default:
      return indicatorId.toUpperCase();
  }
}
