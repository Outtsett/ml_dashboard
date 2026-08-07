
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/shared/ui/empty";
import { TrendingUp, DollarSign, BarChart3, Clock, LineChart } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { useIndicatorData } from "@/market/lib/useIndicatorData";
import { useLabelOverlay } from "@/market/lib/useLabelOverlay";
import { useActiveIndicators } from "@/market/lib/useActiveIndicators";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import { useDashboard } from "@/shared/contexts/UnifiedDashboardContext";
import { useLocalReplay } from "@/market/lib/useLocalReplay";
import { useTrainingSync } from "@/training/lib/useTrainingSync";
import { useTrainingContext, useTrainingControl } from "@/training/lib/TrainingContext";
import { useRegimeModels } from "@/ml/lib/useRegimeData";
import type { Trade } from "@/shared/utils/types";
import { useMLTrades } from "@/ml/lib/useMLData";
import { useChartOHLCV } from "@/market/lib/useChartOHLCV";
import { useChartOverlayData } from "./useChartOverlayData";
import { type InstrumentInfo } from "@/market/types";
import { minutesToLabel } from "@/market/lib/timeframes";
import { Toolbar } from "./Toolbar";
import { AnalyticsStrip } from "./AnalyticsStrip";
import { LiveQuoteStrip } from "./LiveQuoteStrip";
import { TrainingStatusStrip } from "@/training/market-data/TrainingStatusStrip";
import IndicatorChartLayout from "@/market/components/IndicatorChartLayout";
import { ReplayControls } from "@/market/components/ReplayControls";
import { RegimeLegend } from "@/ml/components/RegimeLegend";
import { TrainingSyncBanner } from "@/training/TrainingSyncBanner";

export default function MarketData() {
  const dashboard = useDashboard();
  const queryClient = useQueryClient();
  const training = useTrainingContext();
  const { models } = useRegimeModels(training.isTraining);

  // Use dashboard context state directly to avoid redundant local state sync
  const { symbol, assetType, timeframeMinutes: timeframe } = dashboard;
  
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("price");

  // Memoized setters that update dashboard context
  const _setSymbol = useCallback((s: string) => {
    dashboard.setSymbol(s);
  }, [dashboard]);

  const setTimeframe = useCallback((m: number) => {
    queryClient.cancelQueries({ queryKey: ['/api/charts/ohlcv'] });
    dashboard.setTimeframeMinutes(m);
  }, [queryClient, dashboard]);

  const tfLabel = minutesToLabel(timeframe);
  useBreadcrumbs([
    { label: assetType === "futures" ? "Futures" : "Forex", icon: assetType === "futures" ? TrendingUp : DollarSign },
    { label: symbol },
    { label: symbol },
    { label: tfLabel, icon: Clock },
  ]);

  // Global Keyboard Shortcuts for Tab Switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      switch (e.key) {
        case "1": setActiveTab("price"); break;
        case "2": setActiveTab("ml-studio"); break;
        case "3": setActiveTab("terminal"); break;
        case "4": setActiveTab("chat"); break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // â”€â”€ Instrument & symbol queries â”€â”€
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

  // â”€â”€ Chart OHLCV data (must come before indicator hook â€” provides bars for overlay calc) â”€â”€
  const {
    chartData, isFetching, isLoadingMore, hasMoreLeft, hasMoreRight,
    handleLoadMore, triggerPrefetch, resetScrollState, resetChart: _resetChart, useInfiniteScroll,
  } = useChartOHLCV(symbol, timeframe);

  // Asset type switch: cancel in-flight queries, auto-select first symbol of new type
  const setAssetType = useCallback((t: "futures" | "forex") => {
    // Kill any in-flight OHLCV queries immediately â€” prevents stale stitching
    // queries from hogging QuestDB resources while the new symbol loads
    queryClient.cancelQueries({ queryKey: ['/api/charts/ohlcv'] });
    dashboard.setAssetType(t);
    const symbols = t === "futures" ? futuresSymbols : forexSymbols;
    if (symbols.length > 0) {
      const currentInList = symbols.some(i => i.symbol === symbol);
      if (!currentInList) {
        dashboard.setSymbol(symbols[0]!.symbol);
        resetScrollState();
      }
    }
  }, [queryClient, dashboard, symbol, futuresSymbols, forexSymbols, resetScrollState]);

  // â”€â”€ Active indicators (new professional system) â”€â”€
  const {
    indicators: activeIndicators,
    addIndicator,
    removeIndicator,
    updateParams,
    toggleVisibility,
    clearAll: clearAllIndicators,
    overlays: indicatorOverlays,
  } = useActiveIndicators(chartData);

  // â”€â”€ CDL Patterns (computed client-side from OHLCV data) â”€â”€
  const {
    selectedPatterns,
    setSelectedPatterns,
    patternOverlays,
    isLoading: patternsLoading,
  } = useIndicatorData(symbol, timeframe, isFutures, chartData);

  // â”€â”€ Merge indicator overlays + pattern overlays â”€â”€
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

  // â”€â”€ Label overlay (toolbar dropdown â†’ /api/labels/preview over the loaded bars) â”€â”€
  const [selectedLabelGenerator, setSelectedLabelGenerator] = useState<string | null>(null);
  const [visibleRange, setVisibleRange] = useState<{ start: number; end: number } | null>(null);
  const {
    generators: labelGenerators,
    generatorsLoading: labelGeneratorsLoading,
    labelMarkers,
    distribution: labelDistribution,
    classBalanceRatio: labelClassBalanceRatio,
    coveredRange: labelCoveredRange,
    chartExtendsPastLabels: labelChartExtendsPastLabels,
    isLoading: labelsLoading,
    error: labelsError,
  } = useLabelOverlay(symbol, timeframe, selectedLabelGenerator, chartData, visibleRange);

  // â”€â”€ Market Replay â”€â”€
  const replay = useLocalReplay(chartData);

  // â”€â”€ Training Sync (live stabilization â€” no auto-replay) â”€â”€
  const trainingSync = useTrainingSync(training, symbol);

  const displayData = replay.active ? replay.snapshot.visibleBars : chartData;

  // â”€â”€ Chart overlay data (regime colors, SR, microstructure â€” extracted to hook) â”€â”€
  const {
    overlayToggles, regimeColorMap, regimeLegendInfo,
    selectedRegimes, toggleRegime, showAllRegimes,
    trainTestSplitTime, regimeQualityScore, matchedModelId,
    srLevels, zigZagPts, structurePts,
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

  // â”€â”€ Quick stats â”€â”€
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
    const modelType = selectedModelType || "primitives-discovery";
    const modelDef = availableModels[modelType];
    const hyperparameters: Record<string, number | string | boolean> = {};
    if (modelDef?.defaultHyperparameters) {
      for (const [k, v] of Object.entries(modelDef.defaultHyperparameters)) {
        hyperparameters[k] = v.default;
      }
    }
    startTraining({ modelType, symbol, timeframe: tfLabel, hyperparameters });
  }, [selectedModelType, availableModels, symbol, tfLabel, startTraining]);

  const handleStopTraining = useCallback(() => {
    stopTraining();
  }, [stopTraining]);

  const selectSymbol = useCallback(async (sym: string, type: "futures" | "forex") => {
    queryClient.cancelQueries({ queryKey: ['/api/charts/ohlcv'] });
    dashboard.setSymbol(sym);
    dashboard.setAssetType(type);
    resetScrollState();
  }, [queryClient, dashboard, resetScrollState]);

  // Memoize toolbar callbacks to prevent unnecessary Toolbar re-renders
  const handleToggleSR = useCallback(() => overlayToggles.setShowSR(v => !v), [overlayToggles]);
  const handleToggleZigZag = useCallback(() => overlayToggles.setShowZigZag(v => !v), [overlayToggles]);
  const handleToggleStructure = useCallback(() => overlayToggles.setShowStructure((v: boolean) => !v), [overlayToggles]);
  const handleOpenMlPanel = useCallback(() => setActiveTab("ml-studio"), []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <Toolbar
        assetType={assetType}
        onAssetTypeChange={setAssetType}
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
        labelGenerators={labelGenerators}
        labelGeneratorsLoading={labelGeneratorsLoading}
        selectedLabelGenerator={selectedLabelGenerator}
        onSelectLabelGenerator={setSelectedLabelGenerator}
        labelMarkerCount={labelMarkers.length}
        labelDistribution={labelDistribution}
        labelClassBalanceRatio={labelClassBalanceRatio}
        labelCoveredRange={labelCoveredRange}
        labelChartExtendsPastLabels={labelChartExtendsPastLabels}
        labelsLoading={labelsLoading}
        labelsError={labelsError}
        showSR={overlayToggles.showSR}
        onToggleSR={handleToggleSR}
        showZigZag={overlayToggles.showZigZag}
        onToggleZigZag={handleToggleZigZag}
        showStructure={overlayToggles.showStructure}
        onToggleStructure={handleToggleStructure}
        isTrainingActive={isTrainingActive}
        activeTab={activeTab} onTabChange={setActiveTab}
        onStartTraining={handleStartTraining}
        onStopTraining={handleStopTraining}
        isTrainingStarting={isTrainingStarting}
        onOpenMlPanel={handleOpenMlPanel}
        onResetScrollState={resetScrollState}
      />

      {/* Training Status Strip â€” compact quality gates + progress when training */}
      {isTrainingActive && <TrainingStatusStrip />}

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
      {/* Forming-bar quote. Self-hides until a frame arrives, and badges
          itself as Replay whenever the stream is stored bars rather than a
          live feed — which, since 2026-07-27, it always is. */}
      <LiveQuoteStrip className="mb-2" />
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

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Training banner */}
        {trainingSync.isActive && (
          <div className="px-3 py-1.5 border-b border-white/5 shrink-0 bg-gradient-to-r from-amber-500/5 via-orange-500/5 to-transparent">
            <TrainingSyncBanner
              gibbsIter={trainingSync.gibbsIter}
              gibbsTotal={trainingSync.gibbsTotal}
              activeRegimes={trainingSync.activeRegimes}
              regimeLegend={trainingSync.regimeLegend}
              trainingPhase={trainingSync.trainingPhase}
              stability={trainingSync.stability}
            />
          </div>
        )}

        {/* Replay controls */}
        {replay.active && (
          <div className="px-3 py-1.5 border-b border-white/5 border-t-2 border-t-violet-500/40 shrink-0 flex items-center gap-3 bg-violet-500/[0.03]">
            <ReplayControls
              state={replay.state}
              speed={replay.speed}
              snapshot={replay.snapshot}
              onPlay={replay.play}
              onPause={replay.pause}
              onStepForward={replay.stepForward}
              onStepBackward={replay.stepBackward}
              onSeekTo={replay.seekTo}
              onChangeSpeed={replay.changeSpeed}
              onReset={replay.reset}
            />
          </div>
        )}

        {/* Regime legend */}
        {regimeLegendInfo.length > 0 && (
          <div className="px-3 py-1.5 border-b border-white/5 shrink-0">
            <RegimeLegend
              regimes={regimeLegendInfo}
              selectedRegimes={selectedRegimes}
              onToggleRegime={toggleRegime}
              onShowAll={showAllRegimes}
            />
          </div>
        )}

        {displayData.length > 0 ? (
          <div className="flex-1 min-h-0">
            <IndicatorChartLayout
              data={displayData}
              symbol={symbol}
              isFutures={isFutures}
              timeframe={timeframe}
              isReplayActive={replay.active}
              onLoadMore={!replay.active && useInfiniteScroll ? handleLoadMore : undefined}
              onPrefetch={!replay.active && useInfiniteScroll ? triggerPrefetch : undefined}
              onVisibleTimeRangeChange={setVisibleRange}
              isLoadingMore={isLoadingMore}
              hasMoreLeft={!replay.active && hasMoreLeft}
              hasMoreRight={!replay.active && hasMoreRight}
              labelMarkers={labelMarkers}
              indicatorOverlays={allOverlays}
              onRemoveIndicators={handleRemoveIndicators}
              supportResistanceLevels={srLevels}
              zigZagPoints={zigZagPts}
              swingZigZagPoints={structurePts}
              tradeMarkers={dashboard.overlays.tradeMarkers}
              predictionMarkers={dashboard.overlays.predictionMarkers}
              regimeColorMap={regimeColorMap}
              trainTestSplitTime={trainTestSplitTime}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent">
            <div className="relative mb-5">
              <BarChart3 className="h-16 w-16 opacity-15 text-primary" />
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-[hsl(var(--data-pos)/0.6)] animate-pulse" />
            </div>
            <p className="font-mono text-sm font-medium tracking-wide text-muted-foreground/80">
              Awaiting market data
            </p>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}

