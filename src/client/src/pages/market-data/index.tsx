import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { TrendingUp, DollarSign, Clock, LineChart } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { type LabelMarker } from "@/components/TradingChart";
import { useIndicatorData } from "@/hooks/useIndicatorData";
import { useActiveIndicators } from "@/hooks/useActiveIndicators";
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { MLWorkflowSidebar } from "@/components/sidebar/MLWorkflowSidebar";
import { useLocalReplay } from "@/hooks/useLocalReplay";
import { useTrainingSync } from "@/hooks/useTrainingSync";
import { useTrainingContext, useTrainingControl } from "@/contexts/TrainingContext";
import { useRegimeModels } from "@/hooks/useRegimeData";
import type { Trade } from "@/lib/types";
import { useMLTrades } from "@/hooks/useMLData";
import { useChartOHLCV } from "@/hooks/useChartOHLCV";
import { useChartOverlayData } from "./useChartOverlayData";
import { type OhlcvData, type InstrumentInfo } from "./types";
import { TIMEFRAME_OPTIONS as timeframes, minutesToLabel } from "@/lib/timeframes";
import { Toolbar } from "./Toolbar";
import { AnalyticsStrip } from "./AnalyticsStrip";
import { ChartPanel } from "./ChartPanel";

export default function MarketData() {
  // ── Unified context: local state syncs bidirectionally with dashboard-wide context ──
  const dashboard = useDashboard();
  const training = useTrainingContext();
  const { models } = useRegimeModels(training.isTraining);
  const [symbol, setSymbolLocal] = useState(dashboard.symbol);
  const [assetType, setAssetTypeLocal] = useState<"futures" | "forex">(dashboard.assetType);
  const [timeframe, setTimeframeLocal] = useState(dashboard.timeframeMinutes);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [mlPanelOpen, setMlPanelOpen] = useState(false);

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

  const tfLabel = minutesToLabel(timeframe);
  useBreadcrumbs([
    { label: assetType === "futures" ? "Futures" : "Forex", icon: assetType === "futures" ? TrendingUp : DollarSign },
    { label: symbol },
    { label: symbol },
    { label: tfLabel, icon: Clock },
  ]);

  // ── Instrument & symbol queries ──
  const { data: rawInstruments } = useQuery<InstrumentInfo[]>({
    queryKey: ["/api/instruments"],
  });
  const allInstruments = Array.isArray(rawInstruments) ? rawInstruments : [];

  const futuresSymbols = useMemo(() =>
    allInstruments.filter(i => i.assetType === 'futures').sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [allInstruments]
  );
  const forexSymbols = useMemo(() =>
    allInstruments.filter(i => i.assetType === 'forex').sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [allInstruments]
  );

  const activeSymbols = assetType === "futures" ? futuresSymbols : forexSymbols;

  const isFutures = assetType === "futures";

  // ── Chart OHLCV data (must come before indicator hook — provides bars for overlay calc) ──
  const {
    chartData, isFetching, isLoadingMore, hasMoreLeft, hasMoreRight,
    handleLoadMore, resetScrollState, resetChart, useInfiniteScroll,
  } = useChartOHLCV(symbol, timeframe);

  // ── Active indicators (new professional system) ──
  const {
    indicators: activeIndicators,
    addIndicator,
    removeIndicator,
    updateParams,
    toggleVisibility,
    clearAll: clearAllIndicators,
    overlays: indicatorOverlays,
  } = useActiveIndicators(chartData);

  // ── CDL Patterns (computed client-side from OHLCV data) ──
  const {
    selectedPatterns,
    setSelectedPatterns,
    patternOverlays,
    isLoading: patternsLoading,
  } = useIndicatorData(symbol, timeframe, isFutures, chartData);

  // ── Merge indicator overlays + pattern overlays ──
  const allOverlays = useMemo(() => {
    return [...indicatorOverlays, ...patternOverlays];
  }, [indicatorOverlays, patternOverlays]);

  const handleRemoveIndicators = useCallback((columns: string[]) => {
    // For pattern columns (CDL_*), remove from pattern selection
    const patternCols = columns.filter(c => c.startsWith('CDL_'));
    if (patternCols.length > 0) {
      const newPatterns = selectedPatterns.filter(c => !patternCols.includes(c));
      setSelectedPatterns(newPatterns);
    }
    // For indicator instance columns (instanceId::outputKey), remove the instance
    const instanceCols = columns.filter(c => c.includes('::'));
    const instanceIds = new Set(instanceCols.map(c => c.split('::')[0]!));
    for (const id of instanceIds) {
      removeIndicator(id);
    }
  }, [selectedPatterns, setSelectedPatterns, removeIndicator]);

  // ── Label markers from sidebar workflow panel ──
  const [sidebarLabelMarkers, setSidebarLabelMarkers] = useState<LabelMarker[]>([]);
  const [sidebarShowLabels, setSidebarShowLabels] = useState(false);
  const handleLabelMarkersChange = useCallback((markers: LabelMarker[], show: boolean) => {
    setSidebarLabelMarkers(markers);
    setSidebarShowLabels(show);
  }, []);

  // ── Market Replay ──
  const replay = useLocalReplay(chartData);

  // ── Training Sync (live stabilization — no auto-replay) ──
  const trainingSync = useTrainingSync(training, symbol);

  const displayData = replay.active ? replay.snapshot.visibleBars : chartData;

  // ── Chart overlay data (regime colors, SR, zigzag — extracted to hook) ──
  const {
    overlayToggles, regimeColorMap, regimeLegendInfo,
    selectedRegimes, toggleRegime, showAllRegimes,
    trainTestSplitTime, regimeQualityScore, matchedModelId,
    srLevels, zigZagPts, swingZZPts,
  } = useChartOverlayData(chartData, symbol, tfLabel, {
    liveTimestamps: training.liveRegimeTimestamps,
    liveAssignments: training.liveRegimeAssignments,
    isTraining: training.isTraining,
    models,
    trainingSync: {
      isActive: trainingSync.isActive,
      regimeLegend: trainingSync.regimeLegend,
    },
  });

  // ── Quick stats ──
  const modelCount = models.length;

  const { data: quickTrades = [] } = useMLTrades();

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

  const isTrainingActive = training.isTraining;
  const { startTraining, stopTraining, availableModels, selectedModelType, isPending: isTrainingStarting } = useTrainingControl();

  const handleStartTraining = useCallback(() => {
    const modelType = selectedModelType || "hdp-hmm";
    const modelDef = availableModels[modelType];
    const hyperparameters: Record<string, number | string | boolean> = {};
    if (modelDef?.defaultHyperparameters) {
      for (const [k, v] of Object.entries(modelDef.defaultHyperparameters)) {
        hyperparameters[k] = v.value;
      }
    }
    startTraining({ modelType, symbol, timeframe: tfLabel, hyperparameters });
  }, [selectedModelType, availableModels, symbol, tfLabel, startTraining]);

  const handleStopTraining = useCallback(() => {
    stopTraining();
  }, [stopTraining]);

  const selectSymbol = async (sym: string, type: "futures" | "forex") => {
    setSymbol(sym);
    setAssetType(type);
    resetScrollState();
  };

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
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        activeIndicators={activeIndicators}
        onAddIndicator={addIndicator}
        onRemoveIndicator={removeIndicator}
        onUpdateParams={updateParams}
        onToggleVisibility={toggleVisibility}
        onClearAllIndicators={clearAllIndicators}
        selectedPatterns={selectedPatterns}
        onPatternSelectionChange={setSelectedPatterns}
        indicatorsLoading={patternsLoading}
        showSR={overlayToggles.showSR}
        onToggleSR={() => overlayToggles.setShowSR(v => !v)}
        showZigZag={overlayToggles.showZigZag}
        onToggleZigZag={() => overlayToggles.setShowZigZag(v => !v)}
        showSwingZZ={overlayToggles.showSwingZZ}
        onToggleSwingZZ={() => overlayToggles.setShowSwingZZ(v => !v)}
        isTrainingActive={isTrainingActive}
        onOpenMlPanel={() => setMlPanelOpen(true)}
        onStartTraining={handleStartTraining}
        onStopTraining={handleStopTraining}
        isTrainingStarting={isTrainingStarting}
        onResetScrollState={resetScrollState}
      />

      {/* Analytics Strip */}
      {!isFetching && chartData.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 min-h-0 flex items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LineChart />
              </EmptyMedia>
              <EmptyTitle>Select an instrument</EmptyTitle>
              <EmptyDescription>Choose a symbol from the toolbar above to view charts, indicators, and market data.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </motion.div>
      ) : (
      <>
      <AnalyticsStrip
        symbol={symbol}
        displayDataLength={displayData.length}
        chartDataLength={chartData.length}
        replayActive={replay.active}
        isLoadingMore={isLoadingMore}
        tradeMetrics={tradeMetrics}
        modelCount={modelCount}
        matchedModelId={matchedModelId}
        regimeLegendInfo={regimeLegendInfo}
        regimeIsTraining={training.isTraining}
        regimeQualityScore={regimeQualityScore}
        isTrainingActive={isTrainingActive}
      />

      {/* Chart + Terminal */}
      <ChartPanel
        displayData={displayData}
        chartData={chartData}
        symbol={symbol}
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
          stability: trainingSync.stability,
        }}
        regimeLegendInfo={regimeLegendInfo}
        selectedRegimes={selectedRegimes}
        onToggleRegime={toggleRegime}
        onShowAllRegimes={showAllRegimes}
        regimeColorMap={regimeColorMap}
        trainTestSplitTime={trainTestSplitTime}
        useInfiniteScroll={useInfiniteScroll}
        onLoadMore={!replay.active && useInfiniteScroll ? handleLoadMore : undefined}
        isLoadingMore={isLoadingMore}
        hasMoreLeft={!replay.active && hasMoreLeft}
        hasMoreRight={!replay.active && hasMoreRight}
        labelMarkers={sidebarShowLabels ? sidebarLabelMarkers : []}
        indicatorOverlays={allOverlays}
        onRemoveIndicators={handleRemoveIndicators}
        supportResistanceLevels={srLevels}
        zigZagPoints={zigZagPts}
        swingZigZagPoints={swingZZPts}
        tradeMarkers={dashboard.overlays.tradeMarkers}
        predictionMarkers={dashboard.overlays.predictionMarkers}
      />
      </>
      )}

      {/* ML Tools Sheet */}
      <Sheet open={mlPanelOpen} onOpenChange={setMlPanelOpen}>
        <SheetContent side="right" className="w-[380px] sm:w-[420px] sm:max-w-[420px] p-0 border-l border-white/10 bg-background/95 backdrop-blur-xl flex flex-col">
          <SheetTitle className="sr-only">ML Tools — {symbol}</SheetTitle>
          <MLWorkflowSidebar
            chartData={chartData}
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
