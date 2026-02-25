import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TrendingUp, DollarSign, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef, useMemo, useCallback, useEffect, type RefObject } from "react";
import { type LabelMarker } from "@/components/TradingChart";
import { clearAllCache } from "@/lib/indexeddb";
import { useIndicatorData } from "@/hooks/useIndicatorData";
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";
import { computeSupportResistance, computeZigZag, computeSwingZigZag } from "@/lib/chartOverlays";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { MLWorkflowSidebar } from "@/components/sidebar/MLWorkflowSidebar";
import { useLocalReplay } from "@/hooks/useLocalReplay";
import { useTrainingSync } from "@/hooks/useTrainingSync";
import { useRegimeTrainingContext } from "@/contexts/RegimeTrainingContext";
import { useTrainingContext } from "@/contexts/TrainingContext";
import type { RegimeInfo } from "@/components/RegimeLegend";
import { QUERY_KEYS, type Trade } from "@/lib/types";
import type { ContinuousOHLCVBar } from "@shared/ohlcv";
import { timeframes, type OhlcvData, type InstrumentInfo, type ChartSymbolInfo, MAX_BARS_IN_MEMORY, getFetchLimit, getApiTimeframe } from "./types";
import { Toolbar } from "./Toolbar";
import { AnalyticsStrip } from "./AnalyticsStrip";
import { ChartPanel } from "./ChartPanel";

export default function MarketData() {
  // ── Unified context: local state syncs bidirectionally with dashboard-wide context ──
  const dashboard = useDashboard();
  const regime = useRegimeTrainingContext();
  const training = useTrainingContext();
  const [symbol, setSymbolLocal] = useState(dashboard.symbol);
  const [assetType, setAssetTypeLocal] = useState<"futures" | "forex">(dashboard.assetType);
  const [contract, setContract] = useState<string | null>(null);
  const [timeframe, setTimeframeLocal] = useState(dashboard.timeframeMinutes);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [mlPanelOpen, setMlPanelOpen] = useState(false);
  const [showTerminal, setShowTerminal] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal when new logs arrive
  useEffect(() => {
    if (logEndRef.current && training.logs.length > 0) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [training.logs.length]);

  // Sync local → context when user changes symbol/tf here
  const setSymbol = useCallback((s: string) => {
    setSymbolLocal(s);
    dashboard.setSymbol(s);
  }, [dashboard]);

  const setAssetType = useCallback((t: "futures" | "forex") => {
    setAssetTypeLocal(t);
    dashboard.setAssetType(t);
  }, [dashboard]);

  const setTimeframe = useCallback((m: number) => {
    setTimeframeLocal(m);
    dashboard.setTimeframeMinutes(m);
  }, [dashboard]);

  // Sync context → local when another page changes symbol
  useEffect(() => {
    if (dashboard.symbol !== symbol) setSymbolLocal(dashboard.symbol);
    if (dashboard.assetType !== assetType) setAssetTypeLocal(dashboard.assetType);
    if (dashboard.timeframeMinutes !== timeframe) setTimeframeLocal(dashboard.timeframeMinutes);
  }, [dashboard.symbol, dashboard.assetType, dashboard.timeframeMinutes]);

  const tfLabel = timeframes.find(t => t.minutes === timeframe)?.label ?? `${timeframe}m`;
  useBreadcrumbs([
    { label: assetType === "futures" ? "Futures" : "Forex", icon: assetType === "futures" ? TrendingUp : DollarSign },
    { label: symbol },
    { label: contract ?? symbol },
    { label: tfLabel, icon: Clock },
  ]);

  // ── Indicator overlays ──
  const {
    catalog,
    selectedColumns,
    setSelectedColumns,
    overlays: indicatorOverlays,
    isLoading: indicatorsLoading,
  } = useIndicatorData(symbol, timeframe, assetType === "futures");

  const handleRemoveIndicators = useCallback((columns: string[]) => {
    const newSelection = selectedColumns.filter(c => !columns.includes(c));
    setSelectedColumns(newSelection);
  }, [selectedColumns, setSelectedColumns]);

  // ── Chart overlay toggles ──
  const [showSR, setShowSR] = useState(false);
  const [showZigZag, setShowZigZag] = useState(false);
  const [showSwingZZ, setShowSwingZZ] = useState(false);

  // ── Label markers from sidebar workflow panel ──
  const [sidebarLabelMarkers, setSidebarLabelMarkers] = useState<LabelMarker[]>([]);
  const [sidebarShowLabels, setSidebarShowLabels] = useState(false);
  const handleLabelMarkersChange = useCallback((markers: LabelMarker[], show: boolean) => {
    setSidebarLabelMarkers(markers);
    setSidebarShowLabels(show);
  }, []);

  // ── Instrument & symbol queries ──
  const { data: rawInstruments } = useQuery<InstrumentInfo[]>({
    queryKey: ["/api/instruments"],
  });
  const allInstruments = Array.isArray(rawInstruments) ? rawInstruments : [];

  const { data: chartSymbols = [] } = useQuery<ChartSymbolInfo[]>({
    queryKey: ["/api/charts/symbols"],
  });

  const futuresSymbols = useMemo(() =>
    allInstruments.filter(i => i.assetType === 'futures').sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [allInstruments]
  );
  const forexSymbols = useMemo(() =>
    allInstruments.filter(i => i.assetType === 'forex').sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [allInstruments]
  );

  const activeSymbols = assetType === "futures" ? futuresSymbols : forexSymbols;

  const contractsForSymbol = useMemo(() => {
    if (assetType !== "futures" || !symbol) return [];
    const re = new RegExp(`^${symbol}[A-Z]\\d{1,2}$`);
    return chartSymbols
      .filter(s => re.test(s.symbol))
      .sort((a, b) => b.last_bar.localeCompare(a.last_bar));
  }, [symbol, assetType, chartSymbols]);

  const effectiveSymbol = contract ?? symbol;
  const isFutures = assetType === "futures";

  // Clear stale IndexedDB cache on mount
  useEffect(() => {
    clearAllCache().catch(() => {});
  }, []);

  // ── Unified chart data state (sliding window for infinite scroll) ──
  const [visibleData, setVisibleData] = useState<OhlcvData[]>([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreLeft, setHasMoreLeft] = useState(true);
  const [hasMoreRight, setHasMoreRight] = useState(false);
  const isLoadingMoreRef = useRef(false);

  const FETCH_LIMIT = useMemo(() => getFetchLimit(timeframe), [timeframe]);
  const apiTimeframe = useMemo(() => getApiTimeframe(timeframe), [timeframe]);

  // Reset scroll state on symbol/timeframe/contract change
  useEffect(() => {
    setVisibleData([]);
    setHasMoreLeft(true);
    setHasMoreRight(false);
    isLoadingMoreRef.current = false;
  }, [effectiveSymbol, timeframe]);

  // ── Primary data query ──
  const { data: chartQueryData } = useQuery({
    queryKey: ["/api/charts/ohlcv", effectiveSymbol, apiTimeframe],
    queryFn: async () => {
      const url = `/api/charts/ohlcv?symbol=${effectiveSymbol}&timeframe=${apiTimeframe}&limit=${FETCH_LIMIT}&order=asc`;
      const response = await fetch(url);
      if (!response.ok) return [];
      const data: OhlcvData[] = await response.json();
      setVisibleData(data);
      setHasMoreLeft(false);
      setHasMoreRight(data.length >= FETCH_LIMIT);
      return data;
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: any) => prev,
  });

  // ── Infinite scroll ──
  const handleLoadMore = useCallback(async (direction: 'left' | 'right', timestamp: number) => {
    if (isLoadingMoreRef.current) return;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      let url = `/api/charts/ohlcv?symbol=${effectiveSymbol}&timeframe=${apiTimeframe}&limit=${FETCH_LIMIT}&order=asc`;
      if (direction === 'left') url += `&endTime=${timestamp - 1}`;
      else url += `&startTime=${timestamp + 1}`;

      const response = await fetch(url);
      if (!response.ok) { isLoadingMoreRef.current = false; setIsLoadingMore(false); return; }

      const result = await response.json();
      const newData: OhlcvData[] = Array.isArray(result) ? result : (result.data || []);

      if (newData.length === 0) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
        return;
      }

      setVisibleData(prev => {
        const combined = direction === 'left' ? [...newData, ...prev] : [...prev, ...newData];
        const seen = new Set<number>();
        const deduped = combined.filter(d => {
          const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp) : d.timestamp;
          if (seen.has(ts)) return false;
          seen.add(ts);
          return true;
        }).sort((a, b) => {
          const tsA = typeof a.timestamp === 'string' ? parseInt(a.timestamp) : a.timestamp;
          const tsB = typeof b.timestamp === 'string' ? parseInt(b.timestamp) : b.timestamp;
          return tsA - tsB;
        });

        if (deduped.length > MAX_BARS_IN_MEMORY) {
          if (direction === 'left') {
            setHasMoreRight(true);
            return deduped.slice(0, MAX_BARS_IN_MEMORY);
          } else {
            setHasMoreLeft(true);
            return deduped.slice(-MAX_BARS_IN_MEMORY);
          }
        }
        return deduped;
      });

      if (newData.length < FETCH_LIMIT) {
        if (direction === 'left') setHasMoreLeft(false);
        else setHasMoreRight(false);
      }
    } catch (error) {
      console.error('Error loading more data:', error);
    }
    isLoadingMoreRef.current = false;
    setIsLoadingMore(false);
  }, [effectiveSymbol, timeframe, apiTimeframe, FETCH_LIMIT]);

  const rawData = visibleData.length > 0 ? visibleData : (chartQueryData || []);
  const chartData = rawData;

  // ── Market Replay ──
  const replay = useLocalReplay(chartData);

  // ── Training Sync ──
  const trainingSync = useTrainingSync(regime, symbol, replay);

  const displayData = replay.active ? replay.snapshot.visibleBars : chartData;

  // ── Compute chart overlays ──
  const srLevels = useMemo(() => {
    if (!showSR || chartData.length < 20) return [];
    const bars = chartData.map((d: OhlcvData) => {
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      return { time: ts > 1e12 ? Math.floor(ts / 1000) : ts, open: d.open, high: d.high, low: d.low, close: d.close };
    });
    return computeSupportResistance(bars, 5, 10);
  }, [showSR, chartData]);

  const zigZagPts = useMemo(() => {
    if (!showZigZag || chartData.length < 10) return [];
    const bars = chartData.map((d: OhlcvData) => {
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      return { time: ts > 1e12 ? Math.floor(ts / 1000) : ts, open: d.open, high: d.high, low: d.low, close: d.close };
    });
    return computeZigZag(bars, 0);
  }, [showZigZag, chartData]);

  const swingZZPts = useMemo(() => {
    if (!showSwingZZ || chartData.length < 10) return [];
    const bars = chartData.map((d: OhlcvData) => {
      const ts = typeof d.timestamp === 'string' ? parseInt(d.timestamp, 10) : d.timestamp;
      return { time: ts > 1e12 ? Math.floor(ts / 1000) : ts, open: d.open, high: d.high, low: d.low, close: d.close };
    });
    return computeSwingZigZag(bars);
  }, [showSwingZZ, chartData]);

  // ── Quick stats ──
  const { data: savedModelsData } = useQuery<{ models: { name: string }[] }>({
    queryKey: ['savedModels'],
    queryFn: async () => {
      const res = await fetch('/api/ml/saved-models');
      if (!res.ok) return { models: [] };
      return res.json();
    },
  });
  const modelCount = savedModelsData?.models?.length || 0;

  const { data: quickTrades = [] } = useQuery<Trade[]>({
    queryKey: ["/api/ml/trades"],
    queryFn: async () => { const res = await fetch("/api/ml/trades?limit=50"); const data = await res.json(); return Array.isArray(data) ? data : []; },
  });

  const tradeMetrics = useMemo(() => {
    const closed = quickTrades.filter((t: Trade) => t.status === 'closed');
    const winners = closed.filter((t: Trade) => (t.pnl || 0) > 0);
    const losers = closed.filter((t: Trade) => (t.pnl || 0) < 0);
    const totalPnl = closed.reduce((sum: number, t: Trade) => sum + (t.pnl || 0), 0);
    const grossWin = winners.reduce((sum: number, t: Trade) => sum + (t.pnl || 0), 0);
    const grossLoss = Math.abs(losers.reduce((sum: number, t: Trade) => sum + (t.pnl || 0), 0));
    const winRate = closed.length > 0 ? (winners.length / closed.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    return { totalTrades: closed.length, winRate, totalPnl, profitFactor };
  }, [quickTrades]);

  // ── Regime color map — live training OR saved model ──
  const matchedModelId = useMemo(() => {
    if (regime.isTraining) return null;
    const target = `${symbol.toUpperCase()}_${tfLabel}`;
    const match = regime.models.find(m => m.id === target);
    return match ? match.id : null;
  }, [symbol, tfLabel, regime.models, regime.isTraining]);

  interface RegimeRow { ts: string; regime: number; regime_label: string; split: string }
  const { data: savedAssignments } = useQuery<{ rows: RegimeRow[] }>({
    queryKey: [...QUERY_KEYS.regimeAssignments(matchedModelId || ''), 'chart'],
    queryFn: async () => {
      const res = await fetch(`/api/regime/assignments/${matchedModelId}?limit=100000`);
      if (!res.ok) throw new Error('Failed to load regime assignments');
      return res.json();
    },
    enabled: !!matchedModelId && !regime.isTraining,
    staleTime: 120_000,
  });

  // Regime legend filter
  const [selectedRegimes, setSelectedRegimes] = useState<Set<number> | null>(null);
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

  const regimeColorMap = useMemo(() => {
    // 1. Universal training pipeline
    const uts = training.liveRegimeTimestamps;
    const uassign = training.liveRegimeAssignments;
    if (uts.length && uassign.length && uts.length === uassign.length) {
      const map = new Map<number, number>();
      for (let i = 0; i < uts.length; i++) {
        if (selectedRegimes === null || selectedRegimes.has(uassign[i]!)) map.set(uts[i]!, uassign[i]!);
      }
      if (map.size > 0) return map;
    }
    // 2. Legacy HDP-HMM (RegimeTrainingContext)
    const ts = regime.liveRegimeTimestamps;
    const assignments = regime.liveRegimeAssignments;
    if (ts.length && assignments.length && ts.length === assignments.length) {
      const map = new Map<number, number>();
      for (let i = 0; i < ts.length; i++) {
        if (selectedRegimes === null || selectedRegimes.has(assignments[i]!)) map.set(ts[i]!, assignments[i]!);
      }
      if (map.size > 0) return map;
    }
    // 3. Saved model fallback
    const rows = savedAssignments?.rows;
    if (!rows || rows.length === 0) return undefined;
    const map = new Map<number, number>();
    for (const row of rows) {
      if (selectedRegimes === null || selectedRegimes.has(row.regime))
        map.set(Math.floor(new Date(row.ts).getTime() / 1000), row.regime);
    }
    return map.size > 0 ? map : undefined;
  }, [training.liveRegimeTimestamps, training.liveRegimeAssignments,
      regime.liveRegimeTimestamps, regime.liveRegimeAssignments,
      savedAssignments, selectedRegimes]);

  const regimeLegendInfo = useMemo((): RegimeInfo[] => {
    if (trainingSync.isActive && trainingSync.regimeLegend.length > 0) {
      const total = trainingSync.regimeLegend.reduce((s, r) => s + r.barCount, 0);
      return trainingSync.regimeLegend.map(r => ({
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
      const existing = counts.get(row.regime);
      if (existing) existing.count++;
      else counts.set(row.regime, { label: row.regime_label?.replace(/_/g, ' ') || `Regime ${row.regime}`, count: 1 });
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([id, info]) => ({ id, label: info.label, count: info.count, pct: (info.count / rows.length) * 100 }));
  }, [trainingSync.isActive, trainingSync.regimeLegend, savedAssignments]);

  const trainTestSplitTime = useMemo(() => {
    const rows = savedAssignments?.rows;
    if (!rows || rows.length === 0) return undefined;
    const testRow = rows.find(r => r.split === 'test');
    return testRow ? Math.floor(new Date(testRow.ts).getTime() / 1000) : undefined;
  }, [savedAssignments]);

  const { data: trainingStatus } = useQuery({
    queryKey: ['trainingStatus'],
    queryFn: async () => {
      const res = await fetch('/api/ml/train/status');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
  });
  const isTrainingActive = trainingStatus?.active === true;

  const useInfiniteScroll = visibleData.length > 0;

  const selectSymbol = async (sym: string, type: "futures" | "forex") => {
    setSymbol(sym);
    setAssetType(type);
    setContract(null);
    setVisibleData([]);
    setHasMoreLeft(true);
    setHasMoreRight(false);
  };

  const resetScrollState = useCallback(() => {
    setVisibleData([]);
    setHasMoreLeft(true);
    setHasMoreRight(false);
  }, []);

  const regimeQualityScore = matchedModelId
    ? regime.models.find(m => m.id === matchedModelId)?.quality_score
    : undefined;

  return (
    <div className="h-[calc(100vh-4.5rem)] flex flex-col overflow-hidden -m-4">
      {/* Toolbar */}
      <Toolbar
        assetType={assetType}
        onAssetTypeChange={(newType) => {
          setAssetType(newType);
          setSymbol(newType === "futures" ? "ES" : "EURUSD");
        }}
        symbol={symbol}
        onSymbolSelect={selectSymbol}
        symbolOpen={symbolOpen}
        onSymbolOpenChange={setSymbolOpen}
        activeSymbols={activeSymbols}
        isFutures={isFutures}
        contract={contract}
        onContractChange={(c) => { setContract(c); resetScrollState(); }}
        contractOpen={contractOpen}
        onContractOpenChange={setContractOpen}
        contractsForSymbol={contractsForSymbol}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        catalog={catalog}
        selectedColumns={selectedColumns}
        onSelectionChange={setSelectedColumns}
        indicatorsLoading={indicatorsLoading}
        showSR={showSR}
        onToggleSR={() => setShowSR(v => !v)}
        showZigZag={showZigZag}
        onToggleZigZag={() => setShowZigZag(v => !v)}
        showSwingZZ={showSwingZZ}
        onToggleSwingZZ={() => setShowSwingZZ(v => !v)}
        replayActive={replay.active}
        onToggleReplay={replay.toggleReplay}
        isTraining={training.isTraining}
        trainingProgress={training.progress}
        selectedModelType={training.selectedModelType}
        onStartTraining={() => training.startTraining({
          modelType: training.selectedModelType,
        })}
        onStopTraining={training.stopTraining}
        isTrainingActive={isTrainingActive}
        onOpenMlPanel={() => setMlPanelOpen(true)}
        onResetScrollState={resetScrollState}
      />

      {/* Analytics Strip */}
      <AnalyticsStrip
        effectiveSymbol={effectiveSymbol}
        contract={contract}
        displayDataLength={displayData.length}
        chartDataLength={chartData.length}
        replayActive={replay.active}
        isLoadingMore={isLoadingMore}
        tradeMetrics={tradeMetrics}
        modelCount={modelCount}
        matchedModelId={matchedModelId}
        regimeLegendInfo={regimeLegendInfo}
        regimeIsTraining={regime.isTraining}
        regimeQualityScore={regimeQualityScore}
        isTrainingActive={isTrainingActive}
      />

      {/* Chart + Terminal */}
      <ChartPanel
        displayData={displayData}
        chartData={chartData}
        effectiveSymbol={effectiveSymbol}
        isFutures={isFutures}
        timeframe={timeframe}
        replay={{
          active: replay.active,
          state: replay.state,
          speed: replay.speed,
          snapshot: replay.snapshot,
          play: replay.play,
          pause: replay.pause,
          stepForward: replay.stepForward,
          stepBackward: replay.stepBackward,
          seekTo: replay.seekTo,
          changeSpeed: replay.changeSpeed,
          reset: replay.reset,
        }}
        trainingSync={{
          isActive: trainingSync.isActive,
          gibbsIter: trainingSync.gibbsIter,
          gibbsTotal: trainingSync.gibbsTotal,
          activeRegimes: trainingSync.activeRegimes,
          regimeLegend: trainingSync.regimeLegend,
          trainingPhase: trainingSync.trainingPhase,
        }}
        regimeLegendInfo={regimeLegendInfo}
        selectedRegimes={selectedRegimes}
        onToggleRegime={toggleRegime}
        onShowAllRegimes={() => setSelectedRegimes(null)}
        regimeColorMap={regimeColorMap}
        trainTestSplitTime={trainTestSplitTime}
        useInfiniteScroll={useInfiniteScroll}
        onLoadMore={!replay.active && useInfiniteScroll ? handleLoadMore : undefined}
        isLoadingMore={isLoadingMore}
        hasMoreLeft={!replay.active && hasMoreLeft}
        hasMoreRight={!replay.active && hasMoreRight}
        labelMarkers={sidebarShowLabels ? sidebarLabelMarkers : []}
        indicatorOverlays={indicatorOverlays}
        onRemoveIndicators={handleRemoveIndicators}
        supportResistanceLevels={srLevels}
        zigZagPoints={zigZagPts}
        swingZigZagPoints={swingZZPts}
        tradeMarkers={dashboard.overlays.tradeMarkers}
        predictionMarkers={dashboard.overlays.predictionMarkers}
        regime={{
          trainLogs: training.logs,
          isTraining: training.isTraining,
          liveMetrics: training.metrics ? {
            gibbsIter: (training.iterationHistory.at(-1)?.iteration ?? 0),
            gibbsTotal: (training.iterationHistory.at(-1)?.metrics?.totalIterations as number ?? 0) || 200,
            logLikelihood: training.metrics.logLikelihood ?? 0,
            activeStates: training.metrics.activeStates ?? 0,
            delta: training.metrics.delta ?? 0,
            fitPerBar: training.metrics.fitPerBar ?? 0,
            entropy: training.metrics.entropy ?? 0,
            switchRate: training.metrics.switchRate ?? 0,
            selfTransition: training.metrics.selfTransition ?? 0,
            maxRegimePct: training.metrics.maxRegimePct ?? 0,
            avgDwell: training.metrics.avgDwell ?? 0,
            nBarsTotal: training.totalBars ?? 0,
            regimesDiscovered: training.metrics.regimes_discovered ?? 0,
            stability: training.metrics.stability ?? 0,
            oosSimilarity: training.metrics.oos_similarity ?? 0,
            oosCorrelation: training.metrics.oos_correlation ?? 0,
            qualityScore: training.metrics.quality_score ?? 0,
            elapsed: training.elapsedSec,
          } : null,
          liveConvergence: training.iterationHistory.map(h => ({
            iter: h.iteration,
            log_likelihood: h.metrics.logLikelihood ?? 0,
            n_active_states: h.metrics.activeStates,
            delta: h.metrics.delta,
            entropy: h.metrics.entropy,
            switch_rate: h.metrics.switchRate,
            self_transition: h.metrics.selfTransition,
            max_regime_pct: h.metrics.maxRegimePct,
            avg_dwell: h.metrics.avgDwell,
          })),
          selectedSymbol: symbol,
          selectedTimeframe: tfLabel,
          showTerminal,
          setShowTerminal,
          logEndRef: logEndRef as RefObject<any>,
          burnIn: 50,
        }}
      />

      {/* ML Tools Sheet */}
      <Sheet open={mlPanelOpen} onOpenChange={setMlPanelOpen}>
        <SheetContent side="right" className="w-[380px] sm:w-[420px] sm:max-w-[420px] p-0 border-l border-white/10 bg-background/95 backdrop-blur-xl flex flex-col">
          <SheetTitle className="sr-only">ML Tools — {symbol}</SheetTitle>
          <MLWorkflowSidebar
            chartData={chartData}
            effectiveSymbol={effectiveSymbol}
            symbol={symbol}
            isFutures={isFutures}
            timeframe={timeframe}
            onLabelMarkersChange={handleLabelMarkersChange}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
