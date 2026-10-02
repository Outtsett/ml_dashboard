/**
 * useChartOverlayData â€” Computes all chart overlay layers: regime colors,
 * regime legend, train/test split marker, support/resistance, and zig-zag.
 *
 * Think of it as: the "layer compositor" for the chart. It takes raw regime
 * assignments (live from training or saved from a model), chart bars, and
 * toggle flags, then outputs paint-ready overlay data for the chart component.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { computeSupportResistance, computeZigZag, computeMicroStructure } from "@/market/lib/chart_overlays";
import { useRegimeAssignments } from "@/ml/lib/useRegimeData";
import type { RegimeInfo } from "@/ml/components/RegimeLegend";
import type { OhlcvData } from "../types";

interface OverlayToggleState {
  showSR: boolean;
  setShowSR: React.Dispatch<React.SetStateAction<boolean>>;
  showZigZag: boolean;
  setShowZigZag: React.Dispatch<React.SetStateAction<boolean>>;
  showStructure: boolean;
  setShowStructure: React.Dispatch<React.SetStateAction<boolean>>;
}

interface RegimeSource {
  /** Live regime timestamps from training */
  liveTimestamps: number[];
  /** Live regime assignments from training */
  liveAssignments: number[];
  /** Whether training is currently active */
  isTraining: boolean;
  /** All regime models for matching */
  models: Array<{ id: string; symbol: string; timeframe: string; quality_score?: number }>;
  /** Training sync data for regime legend during training */
  trainingSync: { isActive: boolean; regimeLegend: Array<{ id: number; barCount: number }> };
}

interface ChartOverlayResult {
  /** Overlay toggle state */
  overlayToggles: OverlayToggleState;
  /** Map of timestamp â†’ regime_id for chart bar coloring */
  regimeColorMap: Map<number, number> | undefined;
  /** Regime legend entries for the regime badge strip */
  regimeLegendInfo: RegimeInfo[];
  /** Selected regime filter (null = all visible) */
  selectedRegimes: Set<number> | null;
  /** Toggle a single regime on/off in the filter */
  toggleRegime: (regimeId: number) => void;
  /** Show all regimes (clear filter) */
  showAllRegimes: () => void;
  /** Timestamp of train/test split boundary (epoch seconds) */
  trainTestSplitTime: number | undefined;
  /** Quality score from matched model */
  regimeQualityScore: number | undefined;
  /** Matched saved model ID */
  matchedModelId: string | null;
  /** Support/resistance levels */
  srLevels: ReturnType<typeof computeSupportResistance>;
  /** microstructure points */
  zigZagPts: ReturnType<typeof computeZigZag>;
  /** Microstructure points */
  structurePts: ReturnType<typeof computeMicroStructure>;
}

/**
 * @param chartData  Current chart bars (OHLCV)
 * @param symbol     Active symbol
 * @param tfLabel    Timeframe label (e.g., "1D", "4H")
 * @param regime     Regime data sources (live + saved)
 */
export function useChartOverlayData(
  chartData: OhlcvData[],
  symbol: string,
  tfLabel: string,
  regime: RegimeSource,
  visibleRange?: { from: number; to: number } | null,
): ChartOverlayResult {
  // â”€â”€ Overlay toggles â”€â”€
  const [showSR, setShowSR] = useState(false);
  const [showZigZag, setShowZigZag] = useState(false);
  const [showStructure, setShowStructure] = useState(false);

  // â”€â”€ Regime filter â”€â”€
  const [selectedRegimes, setSelectedRegimes] = useState<Set<number> | null>(null);
  const matchedModelId = useMemo(() => {
    if (regime.isTraining) return null;
    // Find models matching current symbol + timeframe, pick highest quality
    const sym = symbol.toUpperCase();
    const tf = tfLabel.toUpperCase();
    const candidates = regime.models.filter(
      m => m.symbol.toUpperCase() === sym && m.timeframe.toUpperCase() === tf,
    );
    if (candidates.length === 0) return null;
    // Pick highest quality_score, or first if no scores
    candidates.sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0));
    return candidates[0]!.id;
  }, [symbol, tfLabel, regime.models, regime.isTraining]);

  useEffect(() => { setSelectedRegimes(null); }, [matchedModelId, symbol, tfLabel]);

  const toggleRegime = useCallback((regimeId: number) => {
    setSelectedRegimes((prev) => {
      if (prev === null) return new Set([regimeId]);
      const next = new Set(prev);
      if (next.has(regimeId)) { next.delete(regimeId); if (next.size === 0) return null; }
      else next.add(regimeId);
      return next;
    });
  }, []);

  // â”€â”€ Saved regime assignments â”€â”€
  const { data: savedAssignments } = useRegimeAssignments(matchedModelId, {
    enabled: !!matchedModelId && !regime.isTraining,
    limit: 500000,
  });

  // â”€â”€ Regime color map (priority: live training â†’ saved model) â”€â”€
  const regimeColorMap = useMemo(() => {
    // 1. Live training data
    const { liveTimestamps: ts, liveAssignments: assignments } = regime;
    if (ts.length && assignments.length && ts.length === assignments.length) {
      const map = new Map<number, number>();
      for (let i = 0; i < ts.length; i++) {
        if (selectedRegimes === null || selectedRegimes.has(assignments[i]!)) map.set(ts[i]!, assignments[i]!);
      }
      if (map.size > 0) return map;
    }
    // 2. Saved model fallback
    const rows = savedAssignments?.rows;
    if (!rows || rows.length === 0) return undefined;
    const map = new Map<number, number>();
    for (const row of rows) {
      if (selectedRegimes === null || selectedRegimes.has(row.regime))
        map.set(Math.floor(new Date(row.ts as string).getTime() / 1000), row.regime);
    }
    return map.size > 0 ? map : undefined;
  }, [regime, savedAssignments, selectedRegimes]);

  // â”€â”€ Regime legend â”€â”€
  const regimeLegendInfo = useMemo((): RegimeInfo[] => {
    if (regime.trainingSync.isActive && regime.trainingSync.regimeLegend.length > 0) {
      const total = regime.trainingSync.regimeLegend.reduce((s, r) => s + r.barCount, 0);
      return regime.trainingSync.regimeLegend.map(r => ({
        id: r.id,
        label: `Regime ${r.id}`,
        count: r.barCount,
        pct: total > 0 ? (r.barCount / total) * 100 : 0,
      }));
    }
    const rows = savedAssignments?.rows;
    if (!rows || rows.length === 0) return [];
    const counts = new Map<number, { label: string; count: number }>();
    for (const row of rows) {
      const label = typeof row.regime_label === 'string' ? row.regime_label.replace(/_/g, ' ') : `Regime ${row.regime}`;
      const existing = counts.get(row.regime);
      if (existing) existing.count++;
      else counts.set(row.regime, { label, count: 1 });
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([id, info]) => ({ id, label: info.label, count: info.count, pct: (info.count / rows.length) * 100 }));
  }, [regime.trainingSync.isActive, regime.trainingSync.regimeLegend, savedAssignments]);

  // â”€â”€ Train/test split boundary â”€â”€
  const trainTestSplitTime = useMemo(() => {
    const rows = savedAssignments?.rows;
    if (!rows || rows.length === 0) return undefined;
    const testRow = rows.find(r => r.split === 'test');
    return testRow ? Math.floor(new Date(testRow.ts as string).getTime() / 1000) : undefined;
  }, [savedAssignments]);

  // â”€â”€ Quality score â”€â”€
  const regimeQualityScore = matchedModelId
    ? regime.models.find(m => m.id === matchedModelId)?.quality_score
    : undefined;

  // â”€â”€ Technical overlays (SR, microstructure) â”€â”€
  const mapBars = useCallback((data: OhlcvData[]) =>
    data.map(d => {
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      return { time: ts > 1e12 ? Math.floor(ts / 1000) : ts, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume };
    }),
    []
  );

  const srLevels = useMemo(() => {
    if (!showSR || chartData.length < 20) return [];
    
    let targetBars = chartData;
    if (visibleRange) {
      targetBars = chartData.filter(d => {
        const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
        const sec = ts > 1e12 ? Math.floor(ts / 1000) : ts;
        return sec >= visibleRange.from && sec <= visibleRange.to;
      });
    }
    
    if (targetBars.length < 20) targetBars = chartData; // Fallback to all if too zoomed in
    const computed = computeSupportResistance(mapBars(targetBars), 2, 10);
    
    if (computed.length > 0) {
      const avgBandwidth = computed.reduce((s, z) => s + Math.abs(z.zoneTop - z.zoneBottom), 0) / computed.length;
      const avgOpacity = computed.reduce((s, z) => s + (0.15 + z.strength * 0.4), 0) / computed.length;
      console.log(`[Diagnostic] zone_count: ${computed.length}, avg_bandwidth: ${avgBandwidth.toFixed(2)}, avg_opacity: ${avgOpacity.toFixed(2)}`);
    }
    return computed;
  }, [showSR, chartData, mapBars, visibleRange]);

  const zigZagPts = useMemo(() => {
    if (!showZigZag || chartData.length < 10) return [];
    return computeZigZag(mapBars(chartData), 0);
  }, [showZigZag, chartData, mapBars]);

  const structurePts = useMemo(() => {
    if (!showStructure || chartData.length < 10) return [];
    return computeMicroStructure(mapBars(chartData));
  }, [showStructure, chartData, mapBars]);

  return {
    overlayToggles: { showSR, setShowSR, showZigZag, setShowZigZag, showStructure, setShowStructure },
    regimeColorMap,
    regimeLegendInfo,
    selectedRegimes,
    toggleRegime,
    showAllRegimes: useCallback(() => setSelectedRegimes(null), []),
    trainTestSplitTime,
    regimeQualityScore,
    matchedModelId,
    srLevels,
    zigZagPts,
    structurePts,
  };
}

