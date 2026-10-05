/**
 * useChartOverlayData â€” Computes all chart overlay layers: regime colors,
 * regime legend, train/test split marker, support/resistance, and zig-zag.
 *
 * Think of it as: the "layer compositor" for the chart. It takes raw regime
 * assignments (live from training or saved from a model), chart bars, and
 * toggle flags, then outputs paint-ready overlay data for the chart component.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { computeZigZag, computeMicroStructure } from "@/market/lib/chart_overlays";
import { useRegimeAssignments } from "@/ml/lib/useRegimeData";
import type { RegimeInfo } from "@/ml/components/RegimeLegend";
import type { OhlcvData } from "@/market/components/types";
import type { TrainingBarContext } from "@/shared/contexts/dashboardTypes";

/**
 * Okabe-Ito orange, the deuteranopia-safe "up / in progress" hue. Used as a
 * translucent fill for the part of the training window the run has covered.
 */
const TRAINING_REVEAL_FILL_COLOR = "rgba(230, 159, 0, 0.16)";

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
  models: Array<{ id: string; symbol?: string | null; timeframe?: string | null; quality_score?: number }>;
  /** Training sync data for regime legend during training */
  trainingSync: { isActive: boolean; regimeLegend: Array<{ id: number; barCount: number }> };
}

/**
 * Where the growing training-window highlight gets its numbers.
 *
 * Two separate signals, because neither one alone is enough today:
 *  - `barContext` (ActiveModelContext.trainingContext) declares the window —
 *    `dataStart` / `dataEnd` — and is the only place the window is published.
 *  - `livePercent` is the training control plane's 0-100 progress, which is
 *    the signal that actually advances while a run is in flight.
 */
export interface TrainingProgressSource {
  /** Training window plus epoch counters, straight from ActiveModelContext. */
  barContext: TrainingBarContext | null;
  /** Live progress percentage (0-100) from the training control plane. */
  livePercent: number;
  /**
   * Fallback window: the first and last bar the live overlay is predicting
   * over, in epoch milliseconds. Needed because the `started` SSE event ships
   * `dateRange: null` for the runners measured on 2026-09-22, which leaves
   * `barContext.dataStart` / `dataEnd` as empty strings.
   */
  predictedSpanMilliseconds: { start: number; end: number } | null;
}

/**
 * The highlighted span over the training window, with a leading edge that
 * advances as the run proceeds.
 *
 * Honest about what this shows: it is a PROGRESS INDICATOR drawn across the
 * date range the run was handed. It is not bars arriving one at a time — the
 * candle series is set wholesale in useChartSeries.ts, and every bar in the
 * window is already on the chart before the run starts. The leading edge says
 * "the run is this far through its work", nothing more.
 */
export interface TrainingRevealRange {
  /** Epoch milliseconds of the start of the training window. */
  startMilliseconds: number;
  /** Epoch milliseconds of the leading edge reached so far (clamped to the end). */
  revealedThroughMilliseconds: number;
  /** Epoch milliseconds of the end of the training window. */
  endMilliseconds: number;
  /** Share of the window covered so far, 0 to 1. */
  completedFraction: number;
  /**
   * Which signal the fraction came from. `unavailable` means the run publishes
   * no advancing progress number at all, so the bar must say that rather than
   * show a 0% that reads as a stalled run.
   */
  progressSource: "epoch_counter" | "batch_fraction" | "control_plane_percent" | "unavailable";
  /** Where the window itself came from. */
  windowSource: "declared_training_window" | "predicted_bar_span";
  /** Plain-words label shown to the user. */
  label: string;
  /** Translucent fill colour for the covered span (Okabe-Ito orange). */
  color: string;
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
  /** microstructure points */
  zigZagPts: ReturnType<typeof computeZigZag>;
  /** Microstructure points */
  structurePts: ReturnType<typeof computeMicroStructure>;
  /** Growing highlight over the training window, or undefined when no run is live */
  trainingRevealRange: TrainingRevealRange | undefined;
}

/**
 * @param chartData  Current chart bars (OHLCV)
 * @param symbol     Active symbol
 * @param tfLabel    Timeframe label (e.g., "1D", "4H")
 * @param regime     Regime data sources (live + saved)
 * @param training   Training window + progress, for the growing window highlight
 */
const TOGGLE_STORAGE_KEY = "market-overlay-toggles-v1";

function readToggle(name: string): boolean {
  try {
    const stored = localStorage.getItem(TOGGLE_STORAGE_KEY);
    return stored ? Boolean((JSON.parse(stored) as Record<string, unknown>)[name]) : false;
  } catch {
    return false;
  }
}

function writeToggle(name: string, value: boolean): void {
  try {
    const stored = localStorage.getItem(TOGGLE_STORAGE_KEY);
    const toggles = stored ? (JSON.parse(stored) as Record<string, unknown>) : {};
    localStorage.setItem(TOGGLE_STORAGE_KEY, JSON.stringify({ ...toggles, [name]: value }));
  } catch {
    // storage unavailable (private window, quota): the toggle just does not persist
  }
}

export function useChartOverlayData(
  chartData: OhlcvData[],
  symbol: string,
  tfLabel: string,
  regime: RegimeSource,
  training: TrainingProgressSource,
  visibleRange: { start: number; end: number } | null = null,
): ChartOverlayResult {
  // â”€â”€ Overlay toggles â”€â”€
  // The overlay toggles survive a reload (per browser), so the chart comes back the way it was left.
  // S/R zones default OFF: the shaded support/resistance clouds are opt-in, and a stale
  // `true` from a prior session painted them on every chart until the user found the toggle.
  const [showSR, setShowSR] = useState(false);
  const [showZigZag, setShowZigZag] = useState(() => readToggle("showZigZag"));
  const [showStructure, setShowStructure] = useState(() => readToggle("showStructure"));
  useEffect(() => { writeToggle("showSR", showSR); }, [showSR]);
  useEffect(() => { writeToggle("showZigZag", showZigZag); }, [showZigZag]);
  useEffect(() => { writeToggle("showStructure", showStructure); }, [showStructure]);

  // â”€â”€ Regime filter â”€â”€
  const [selectedRegimes, setSelectedRegimes] = useState<Set<number> | null>(null);
  const matchedModelId = useMemo(() => {
    if (regime.isTraining) return null;
    // Find models matching current symbol + timeframe, pick highest quality
    const sym = symbol.toUpperCase();
    const tf = tfLabel.toUpperCase();
    // A model folder need not declare a symbol or timeframe (the TA-strategy
    // rounds do not); such a model matches no chart rather than crashing it.
    const candidates = regime.models.filter(
      m => m.symbol?.toUpperCase() === sym && m.timeframe?.toUpperCase() === tf,
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
      return { time: ts > 1e12 ? Math.floor(ts / 1000) : ts, open: d.open, high: d.high, low: d.low, close: d.close };
    }),
    []
  );

  // Support / resistance is computed on the bars ON SCREEN (settled visible range), so the ten
  // strongest zones are the ones that matter where you are looking; over the whole 50,000-bar load
  // they all sat in one week's congestion far from the current price.
  

  const zigZagPts = useMemo(() => {
    if (!showZigZag || chartData.length < 10) return [];
    return computeZigZag(mapBars(chartData), 0);
  }, [showZigZag, chartData, mapBars]);

  const structurePts = useMemo(() => {
    if (!showStructure || chartData.length < 10) return [];
    return computeMicroStructure(mapBars(chartData));
  }, [showStructure, chartData, mapBars]);

  // ── Training window reveal (a progress indicator, not arriving bars) ──
  //
  // The chart already holds every bar in the window; useChartSeries.ts calls
  // setData() with the whole array. What grows here is the LEADING EDGE of a
  // translucent band drawn over that window, interpolated from how far the
  // run has got. Nothing about the candles themselves changes.
  const {
    barContext: trainingBarContext,
    livePercent: trainingLivePercent,
    predictedSpanMilliseconds: trainingPredictedSpan,
  } = training;

  const trainingRevealRange = useMemo((): TrainingRevealRange | undefined => {
    if (!trainingBarContext || trainingBarContext.status !== "training") return undefined;

    // ── The window ──
    // The declared window is the right source, but every runner measured on
    // 2026-09-22 sends `dateRange: null` on its `started` event, which leaves
    // dataStart / dataEnd as empty strings. When that happens, fall back to the
    // span the live overlay is actually predicting over, and say which one the
    // bar is drawn from rather than presenting one as the other.
    const declaredStart = Date.parse(trainingBarContext.dataStart);
    const declaredEnd = Date.parse(trainingBarContext.dataEnd);
    const hasDeclaredWindow =
      Number.isFinite(declaredStart) && Number.isFinite(declaredEnd) && declaredEnd > declaredStart;

    let startMilliseconds: number;
    let endMilliseconds: number;
    let windowSource: TrainingRevealRange["windowSource"];
    if (hasDeclaredWindow) {
      startMilliseconds = declaredStart;
      endMilliseconds = declaredEnd;
      windowSource = "declared_training_window";
    } else if (trainingPredictedSpan && trainingPredictedSpan.end > trainingPredictedSpan.start) {
      startMilliseconds = trainingPredictedSpan.start;
      endMilliseconds = trainingPredictedSpan.end;
      windowSource = "predicted_bar_span";
    } else {
      return undefined;
    }

    // ── The leading edge ──
    // Three progress signals, most run-specific first. The epoch counters and
    // the batch fraction live on the training context but are only written on
    // the 'started' event today, and the control-plane percentage is fed from
    // `progress.pct`, which the measured runners do not send either. When all
    // three read zero the bar reports the signal as unavailable instead of
    // drawing a 0% that looks like a stalled run.
    let completedFraction: number;
    let progressSource: TrainingRevealRange["progressSource"];
    if (trainingBarContext.totalEpochs > 0 && trainingBarContext.epoch > 0) {
      completedFraction = trainingBarContext.epoch / trainingBarContext.totalEpochs;
      progressSource = "epoch_counter";
    } else if (trainingBarContext.progress != null && trainingBarContext.progress > 0) {
      completedFraction = trainingBarContext.progress;
      progressSource = "batch_fraction";
    } else if (trainingLivePercent > 0) {
      completedFraction = trainingLivePercent / 100;
      progressSource = "control_plane_percent";
    } else {
      completedFraction = 0;
      progressSource = "unavailable";
    }
    completedFraction = Math.min(1, Math.max(0, completedFraction));

    const revealedThroughMilliseconds = Math.min(
      endMilliseconds,
      startMilliseconds + (endMilliseconds - startMilliseconds) * completedFraction,
    );

    const windowWords =
      windowSource === "declared_training_window"
        ? "training window"
        : "span the model is predicting over";
    const label =
      progressSource === "unavailable"
        ? `Training run live — this run publishes no progress number, so the ${windowWords} is shown without a leading edge`
        : `Training progress: ${Math.round(completedFraction * 100)}% through the ${windowWords}`;

    return {
      startMilliseconds,
      revealedThroughMilliseconds,
      endMilliseconds,
      completedFraction,
      progressSource,
      windowSource,
      label,
      color: TRAINING_REVEAL_FILL_COLOR,
    };
  }, [trainingBarContext, trainingLivePercent, trainingPredictedSpan]);

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
    
    zigZagPts,
    structurePts,
    trainingRevealRange,
  };
}

