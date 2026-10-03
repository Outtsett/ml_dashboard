/**
 * Active Indicator State Management — manages the lifecycle of indicator
 * instances that the user has added to the chart.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { getIndicatorDefinition } from "@/market/lib/indicator_registry";
import { getIndicatorColor, getIndicatorLineWidth } from '@/market/lib/indicator_colors';
import {
  registerInstanceLabel, registerInstanceReferenceLines,
  unregisterInstanceLabel, unregisterInstanceReferenceLines,
} from "@/market/lib/indicator_panels";
import { buildDisplayColumn } from "@/market/lib/indicator_display";
import { useIndicatorWorker } from "@/market/lib/useIndicatorWorker";
import type { IndicatorOverlay, IndicatorDisplayType } from "@/market/lib/useIndicatorData";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ActiveIndicator {
  instanceId: string;
  indicatorId: string;
  params: Record<string, number>;
  visible: boolean;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'active-indicators-v3';

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
  macd: { macd: '#06b6d4', signal: '#f97316', histogram: '#94a3b8' },
  macdext: { macd: '#06b6d4', signal: '#f97316', histogram: '#94a3b8' },
  macdfix: { macd: '#06b6d4', signal: '#f97316', histogram: '#94a3b8' },
  stochastic: { k: '#f59e0b', d: '#d97706' },
  stochf: { k: '#f59e0b', d: '#d97706' },
  stochrsi: { k: '#c084fc', d: '#9333ea' },
  bbands: { upper: '#a78bfa', middle: '#8b5cf6', lower: '#a78bfa' },
  mama: { mama: '#ec4899', fama: '#f472b6' },
  // adx must differ from minusDI — the red/green removal mapped both onto blue,
  // making the trend-strength line indistinguishable from one of the two
  // directional lines it is plotted against.
  adx: { adx: '#F0E442', plusDI: '#E69F00', minusDI: '#0072B2' },
  aroon: { up: '#E69F00', down: '#0072B2' },
  ht_phasor: { inphase: '#38bdf8', quadrature: '#818cf8' },
  ht_sine: { sine: '#2dd4bf', leadsine: '#a78bfa' },
  ichimoku: { tenkan: '#0072B2', kijun: '#3b82f6', senkouA: '#E69F00', senkouB: '#f97316', chikou: '#a78bfa' },
  keltner: { upper: '#38bdf8', middle: '#0284c7', lower: '#38bdf8' },
  donchian: { upper: '#a3e635', middle: '#65a30d', lower: '#a3e635' },
  supertrend: { supertrend: '#f59e0b', direction: '#94a3b8' },
  accbands: { upper: '#c084fc', middle: '#8b5cf6', lower: '#c084fc' },
  cksp: { stopLong: '#E69F00', stopShort: '#0072B2' },
  fisher: { fisher: '#e879f9', trigger: '#c084fc' },
  kst: { kst: '#06b6d4', signal: '#f97316' },
  qqe: { qqe: '#a78bfa', rsiSmooth: '#22d3ee', upper: '#38bdf8', lower: '#38bdf8' },
  rvgi: { rvgi: '#38bdf8', signal: '#f97316' },
  tsi: { tsi: '#E69F00', signal: '#0072B2' },
  smi: { smi: '#c084fc', signal: '#f59e0b' },
  squeeze: { momentum: '#06b6d4', squeeze: '#0072B2' },
  squeeze_pro: { momentum: '#06b6d4', squeeze: '#0072B2' },
  kdj: { k: '#f59e0b', d: '#3b82f6', j: '#0072B2' },
  vortex: { viPlus: '#E69F00', viMinus: '#0072B2' },
  kvo: { kvo: '#06b6d4', signal: '#f97316' },
  hwc: { upper: '#38bdf8', middle: '#0284c7', lower: '#38bdf8' },
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
  const [overlays, setOverlays] = useState<IndicatorOverlay[]>([]);
  const { computeAll } = useIndicatorWorker();

  // Persist to localStorage on change
  useEffect(() => {
    saveActiveIndicators(indicators);
  }, [indicators]);

  // Sync from localStorage on mount
  useEffect(() => {
    const stored = loadActiveIndicators();
    if (stored.length > 0) setIndicators(stored);
  }, []);

  // Normalize OHLCV bars
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

  // Add an indicator with default params
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

  const removeIndicator = useCallback((instanceId: string) => {
    setIndicators(prev => prev.filter(i => i.instanceId !== instanceId));
  }, []);

  const updateParams = useCallback((instanceId: string, params: Record<string, number>) => {
    setIndicators(prev =>
      prev.map(i => i.instanceId === instanceId ? { ...i, params } : i),
    );
  }, []);

  const toggleVisibility = useCallback((instanceId: string) => {
    setIndicators(prev =>
      prev.map(i => i.instanceId === instanceId ? { ...i, visible: !i.visible } : i),
    );
  }, []);

  const clearAll = useCallback(() => {
    setIndicators([]);
  }, []);

  // Register instance labels and reference lines
  useEffect(() => {
    for (const ind of indicators) {
      const def = getIndicatorDefinition(ind.indicatorId);
      if (!def) continue;

      const paramVals = def.params.map(p => ind.params[p.key] ?? p.default);
      const label = paramVals.length > 0 ? `${def.name} (${paramVals.join(',')})` : def.name;
      registerInstanceLabel(ind.instanceId, label);

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

  // ── Asynchronous Computation via Web Worker ──
  useEffect(() => {
    let isMounted = true;

    if (normalizedBars.length === 0 || indicators.length === 0) {
      setOverlays([]);
      return;
    }

    const runCompute = async () => {
      const visibleIndicators = indicators.filter(i => i.visible);
      if (visibleIndicators.length === 0) {
        if (isMounted) setOverlays([]);
        return;
      }

      const computed = await computeAll(visibleIndicators, normalizedBars);

      if (!isMounted || !computed) return;

      const result: IndicatorOverlay[] = [];
      for (const comp of computed) {
        const def = getIndicatorDefinition(comp.indicatorId);
        if (!def) continue;

        for (const output of comp.outputs) {
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
      setOverlays(result);
    };

    runCompute();

    return () => {
      isMounted = false;
    };
  }, [indicators, normalizedBars, computeAll]);

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
