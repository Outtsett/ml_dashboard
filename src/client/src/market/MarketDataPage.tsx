
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia, EmptyContent } from "@/shared/ui/empty";
import { Button } from "@/shared/ui/button";
import { TrendingUp, DollarSign, BarChart3, Clock, LineChart, RefreshCw } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useIndicatorData } from "@/market/lib/useIndicatorData";
import { useLabelOverlay, useLabelOverlaySelectionEvents } from "@/market/lib/useLabelOverlay";
import { useActiveIndicators } from "@/market/lib/useActiveIndicators";
import { useLakeSeries } from "@/market/lib/useLakeSeries";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import { useDashboard, useChartOverlayContext } from "@/shared/contexts/UnifiedDashboardContext";
import { dispatchOverlayEvent, reportOverlayDispatchResult } from "@/training/lib/overlayDispatch";
import type { PredictionMarker } from "@/shared/contexts/dashboardTypes";
import { useLocalReplay } from "@/market/lib/useLocalReplay";
import { useTrainingSync } from "@/training/lib/useTrainingSync";
import { useTrainingContext, useTrainingControl } from "@/training/lib/TrainingContext";
import { useRegimeModels } from "@/ml/lib/useRegimeData";
import type { Trade } from "@/shared/utils/types";
import { useMLTrades } from "@/ml/lib/useMLData";
import { useChartOHLCV } from "@/market/lib/useChartOHLCV";
import { useChartOverlayData } from "./useChartOverlayData";
import { type InstrumentInfo } from "@/market/types";
import { minutesToLabel, minutesToApiKey } from "@/market/lib/timeframes";
import { Toolbar } from "./Toolbar";
import { AnalyticsStrip } from "./AnalyticsStrip";
import { LiveQuoteStrip } from "./LiveQuoteStrip";
import { TrainingStatusStrip } from "@/training/market-data/TrainingStatusStrip";
import IndicatorChartLayout from "@/market/components/IndicatorChartLayout";
import { ReplayControls } from "@/market/components/ReplayControls";
import { RegimeLegend } from "@/ml/components/RegimeLegend";
import { TrainingSyncBanner } from "@/training/TrainingSyncBanner";
import { useCycleStore } from "@/cycle/store";
import { CycleChartArea } from "@/cycle/CycleChart";

export default function MarketData() {
  const dashboard = useDashboard();
  const queryClient = useQueryClient();
  const training = useTrainingContext();
  // Raw overlay writers. Taken from ChartOverlayContext rather than the merged
  // useDashboard() object: these are the bare state setters, so their identity
  // never changes and an effect that writes an overlay cannot re-trigger itself.
  const { setPredictionMarkers, setHighlightRange } = useChartOverlayContext();
  const { models } = useRegimeModels(training.isTraining);
  // A Model Cycle run on screen replaces the market chart (which unmounts) until "Back to market chart".
  const cycleChartShown = useCycleStore((state) => state.modelId !== null && state.showOnChart);

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
    isError: barsFailed, error: barsError, reloadChart,
  } = useChartOHLCV(symbol, timeframe);

  // The reload the user can actually reach. A chart that came up empty used
  // to leave them with "Select an instrument" under a symbol they had
  // already selected, and no way forward except reloading the whole page.
  const [isReloadingBars, setIsReloadingBars] = useState(false);
  const handleReloadBars = useCallback(async () => {
    setIsReloadingBars(true);
    try {
      await reloadChart();
    } finally {
      setIsReloadingBars(false);
    }
  }, [reloadChart]);

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
  // Candlestick patterns are label generators now, chosen one at a time from
  // the label dropdown. This call only clears the retired selection.
  useIndicatorData();

  // What the chart is showing, shared by the lake series and the label overlay.
  const [visibleRange, setVisibleRange] = useState<{ start: number; end: number } | null>(null);
  // The chart reports a new visible range on every frame of a drag. Every
  // consumer of this range issues a request keyed on it, so the value settles
  // for 300ms before it moves — a pan becomes one request, not sixty.
  const visibleRangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVisibleRangeChange = useCallback((range: { start: number; end: number } | null) => {
    if (visibleRangeTimer.current) clearTimeout(visibleRangeTimer.current);
    visibleRangeTimer.current = setTimeout(() => setVisibleRange(range), 300);
  }, []);
  useEffect(() => () => { if (visibleRangeTimer.current) clearTimeout(visibleRangeTimer.current); }, []);
  // â”€â”€ Lake columns as chart series (fetched, not computed) â”€â”€
  const lakeSeries = useLakeSeries({
    symbol,
    timeframe: minutesToApiKey(timeframe),
    bars: chartData,
    visibleRange,
  });

  // â”€â”€ Merge indicator overlays + pattern overlays + lake series â”€â”€
  const allOverlays = useMemo(() => {
    return [...indicatorOverlays, ...lakeSeries.overlays];
  }, [indicatorOverlays, lakeSeries.overlays]);

  const handleRemoveIndicators = useCallback((columns: string[]) => {
    // For indicator instance columns (instanceId::outputKey), remove the instance
    const instanceCols = columns.filter(c => c.includes('::'));
    const instanceIds = new Set(instanceCols.map(c => c.split('::')[0]!));
    for (const id of instanceIds) {
      removeIndicator(id);
    }
    // Lake columns are not instances — closing their pane deselects the column.
    lakeSeries.removeByOverlayColumns(columns);
  }, [removeIndicator, lakeSeries]);

  // â”€â”€ Label overlay (toolbar dropdown â†’ /api/labels/preview over the loaded bars) â”€â”€
  const [selectedLabelGenerator, setSelectedLabelGenerator] = useState<string | null>(null);
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
  useLabelOverlaySelectionEvents(setSelectedLabelGenerator);

  // â”€â”€ Market Replay â”€â”€
  const replay = useLocalReplay(chartData);

  // â”€â”€ Training Sync (live stabilization â€” no auto-replay) â”€â”€
  const trainingSync = useTrainingSync(training, symbol);

  const displayData = replay.active ? replay.snapshot.visibleBars : chartData;

  // First and last bar the live overlay is predicting over. Used as the
  // training window whenever the run declares none (the `started` event ships
  // dateRange: null for the runners measured on 2026-09-22).
  const livePredictionMarkers = dashboard.overlays.predictionMarkers;
  const predictedSpanMilliseconds = useMemo(() => {
    if (livePredictionMarkers.length === 0) return null;
    let start = Infinity;
    let end = -Infinity;
    for (const marker of livePredictionMarkers) {
      if (marker.timestamp < start) start = marker.timestamp;
      if (marker.timestamp > end) end = marker.timestamp;
    }
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
  }, [livePredictionMarkers]);

  // â”€â”€ Chart overlay data (regime colors, SR, microstructure â€” extracted to hook) â”€â”€
  const {
    overlayToggles, regimeColorMap, regimeLegendInfo,
    selectedRegimes, toggleRegime, showAllRegimes,
    trainTestSplitTime, regimeQualityScore, matchedModelId,
    srLevels, zigZagPts, structurePts,
    trainingRevealRange,
  } = useChartOverlayData(chartData, symbol, tfLabel, {
    liveTimestamps: training.liveRegimeTimestamps,
    liveAssignments: training.liveRegimeAssignments,
    isTraining: training.isTraining,
    models,
    trainingSync: {
      isActive: trainingSync.isActive,
      regimeLegend: trainingSync.regimeLegend,
    },
  }, {
    barContext: dashboard.trainingContext,
    livePercent: training.progress,
    predictedSpanMilliseconds: predictedSpanMilliseconds,
  });

  // â”€â”€ Quick stats â”€â”€
  // ── Model predictions on the price chart ──────────────────────────────
  //
  // Every model declares how it wants to be drawn with its `chartOverlay`
  // string, and emits that same string as the `overlayType` of its live
  // `overlay` events. dispatchOverlayEvent() routes on that string alone —
  // there is no per-model branch here, and a new overlay type is an entry in
  // overlayDispatch.ts rather than an edit to this page.
  //
  // When the event resolves to prediction markers they go into
  // ChartOverlayContext, which useChartMarkers.ts already paints as
  // arrowUp / arrowDown / circle markers on the candles.
  useEffect(() => {
    if (!training.isTraining || !training.overlayData) return;

    const dispatched = dispatchOverlayEvent(training.overlayData);
    reportOverlayDispatchResult(dispatched);
    if (dispatched.outcome !== 'prediction_markers') return;

    const modelName = training.modelType ?? 'training run';
    const markers: PredictionMarker[] = dispatched.predictionMarkers.map(prediction => ({
      // The dispatcher normalises to epoch seconds; PredictionMarker is in
      // milliseconds (dashboardTypes.ts:26), so this multiply is required.
      timestamp: prediction.timestampSeconds * 1000,
      direction: prediction.direction,
      ...(prediction.confidence === null ? {} : { confidence: prediction.confidence }),
      modelName,
      source: 'live' as const,
    }));
    setPredictionMarkers(markers);
  }, [training.overlayData, training.isTraining, training.modelType, setPredictionMarkers]);

  // A finished run must not leave stale arrows on the chart.
  useEffect(() => {
    if (training.isTraining) return;
    setPredictionMarkers([]);
    setHighlightRange(undefined);
  }, [training.isTraining, setPredictionMarkers, setHighlightRange]);

  // ── Training window highlight, advancing with the run ─────────────────
  //
  // Publishes the growing span so any chart painter reading
  // ChartOverlayContext.highlightRange gets the leading edge rather than one
  // static rectangle. What advances is the edge of a band drawn over the
  // training window — the candles themselves are unchanged, because
  // useChartSeries.ts sets the whole bar array at once.
  useEffect(() => {
    if (!trainingRevealRange) return;
    setHighlightRange({
      start: trainingRevealRange.startMilliseconds,
      end: trainingRevealRange.revealedThroughMilliseconds,
      label: trainingRevealRange.label,
      color: trainingRevealRange.color,
    });
  }, [trainingRevealRange, setHighlightRange]);

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

  const livePredictionMarkerCount = livePredictionMarkers.length;

  const trainingWindowLabels = useMemo(() => {
    if (!trainingRevealRange) return null;
    const format = (milliseconds: number) =>
      new Date(milliseconds).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    return {
      windowStart: format(trainingRevealRange.startMilliseconds),
      leadingEdge: format(trainingRevealRange.revealedThroughMilliseconds),
      windowEnd: format(trainingRevealRange.endMilliseconds),
      percentComplete: Math.round(trainingRevealRange.completedFraction * 100),
    };
  }, [trainingRevealRange]);

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
        lakeSeries={lakeSeries}
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
      {cycleChartShown ? (
        <CycleChartArea />
      ) : !isFetching && chartData.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 min-h-0 flex items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {symbol ? <RefreshCw /> : <LineChart />}
              </EmptyMedia>
              {/* Two different situations that used to read the same. No symbol
                  is a prompt; a symbol with no bars is a failure, and saying
                  "select an instrument" under one the user already selected is
                  what sent them to the browser's reload button. */}
              <EmptyTitle>
                {symbol ? `No bars loaded for ${symbol}` : 'Select an instrument'}
              </EmptyTitle>
              <EmptyDescription>
                {symbol
                  ? (barsFailed
                      ? `The request failed: ${barsError?.message ?? 'unknown error'}. Reloading clears the cached copy and asks the server again.`
                      : 'The server returned no bars for this symbol and timeframe. Reloading clears the cached copy and asks again.')
                  : 'Choose a symbol from the toolbar above to view charts, indicators, and market data.'}
              </EmptyDescription>
            </EmptyHeader>
            {symbol && (
              <EmptyContent>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReloadBars}
                  disabled={isReloadingBars}
                  data-testid="button-reload-bars-empty"
                >
                  <RefreshCw className={`h-3 w-3 mr-1.5 ${isReloadingBars ? 'animate-spin' : ''}`} />
                  {isReloadingBars ? 'Reloading' : 'Reload bars'}
                </Button>
              </EmptyContent>
            )}
          </Empty>
        </motion.div>
      ) : (
      <>
      {/* Forming-bar quote. Self-hides until a frame arrives, and badges
          itself as Replay whenever the stream is stored bars rather than a
          live feed — which, since 2026-07-27, it always is. */}
      <LiveQuoteStrip className="mb-2" symbol={symbol} timeframeApiKey={minutesToApiKey(timeframe)} />
      <AnalyticsStrip
        symbol={symbol}
        displayDataLength={displayData.length}
        chartDataLength={chartData.length}
        onReloadBars={handleReloadBars}
        isReloadingBars={isReloadingBars}
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

        {/* Training window progress — the span grows as the run proceeds */}
        {trainingRevealRange && trainingWindowLabels && (
          <div className="px-3 py-2 border-b border-white/5 shrink-0">
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <span className="text-[11px] font-medium tracking-wide text-foreground/80">
                {trainingRevealRange.label}
              </span>
              <span className="text-[11px] font-mono text-muted-foreground/80">
                {livePredictionMarkerCount} prediction markers on chart
              </span>
            </div>
            <div
              className="relative h-2 w-full overflow-hidden rounded-sm bg-white/[0.06]"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={trainingWindowLabels.percentComplete}
              aria-label={trainingRevealRange.label}
            >
              {/* Okabe-Ito orange, striped so the covered span reads without
                  relying on colour alone. */}
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${trainingWindowLabels.percentComplete}%`,
                  backgroundColor: '#E69F00',
                  backgroundImage:
                    'repeating-linear-gradient(45deg, rgba(0,0,0,0.30) 0 3px, rgba(0,0,0,0) 3px 6px)',
                }}
              />
              <div
                className="absolute inset-y-0 w-px bg-white/75"
                style={{ left: `${trainingWindowLabels.percentComplete}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[10px] text-muted-foreground/70">
              <span>{trainingWindowLabels.windowStart}</span>
              {trainingRevealRange.progressSource !== 'unavailable' && (
                <span className="text-foreground/70">reached {trainingWindowLabels.leadingEdge}</span>
              )}
              <span>{trainingWindowLabels.windowEnd}</span>
            </div>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground/60">
              {trainingRevealRange.windowSource === 'declared_training_window'
                ? 'Span: the date range this run was handed to train on.'
                : 'Span: the first and last bar this run is predicting over — it declared no training date range.'}
              {' '}Every bar in the span is already drawn on the chart — this is a progress
              indicator over the run, not bars arriving one at a time.
              {trainingRevealRange.progressSource === 'unavailable'
                ? ' This run publishes no advancing progress number, so there is no leading edge to draw.'
                : ''}
            </p>
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
              onReloadBars={handleReloadBars}
              isReloadingBars={isReloadingBars}
              data={displayData}
              symbol={symbol}
              isFutures={isFutures}
              timeframe={timeframe}
              isReplayActive={replay.active}
              onLoadMore={!replay.active && useInfiniteScroll ? handleLoadMore : undefined}
              onPrefetch={!replay.active && useInfiniteScroll ? triggerPrefetch : undefined}
              onVisibleTimeRangeChange={handleVisibleRangeChange}
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

