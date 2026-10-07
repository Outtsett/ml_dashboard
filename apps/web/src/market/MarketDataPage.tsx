
import { useChartContextPublisher } from "@/market/lib/useChartContextPublisher";
import { requestChartScroll, subscribeChartView, useNotebookOverlays } from "@/market/lib/useNotebookOverlays";
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
import { useTrainingContext } from "@/training/lib/TrainingContext";
import { useRegimeModels } from "@/ml/lib/useRegimeData";
import type { Trade } from "@/shared/utils/types";
import { useMLTrades } from "@/ml/lib/useMLData";
import { useChartOHLCV } from "@/market/lib/useChartOHLCV";
import { useChartOverlayData } from "./useChartOverlayData";
import { type InstrumentInfo } from "@/market/types";
import { minutesToLabel, minutesToApiKey, apiKeyToMinutes } from "@/market/lib/timeframes";
import { isFuturesSymbol } from "@/market/components/chartConfig";
import { Toolbar } from "./Toolbar";
import { AnalyticsStrip } from "./AnalyticsStrip";
import { LiveQuoteStrip } from "./LiveQuoteStrip";
import { useLiveTail } from "@/live/useLiveTail";
import { TrainingStatusStrip } from "@/training/market-data/TrainingStatusStrip";
import IndicatorChartLayout, { type ExtraChartPanel } from "@/market/components/IndicatorChartLayout";
import { ReplayControls } from "@/market/components/ReplayControls";
import { RegimeLegend } from "@/ml/components/RegimeLegend";
import { TrainingSyncBanner } from "@/training/TrainingSyncBanner";
import { RunChartChrome } from "@/cycle/RunChartChrome";
import { useRunChartData } from "@/cycle/useRunChartData";
import { useRunOverlay } from "@/cycle/useRunOverlay";
import type { ChartAttachTarget } from "@/market/components/useChartSetup";
import type { RunOverlayTarget } from "@/cycle/useRunOverlay";
import { useCycleStore } from "@/cycle/store";
import { useFeatureOverIndication } from "@/market/lib/useFeatureOverIndication";
import { ForecastAccuracyHUD } from "@/market/components/ForecastAccuracyHUD";


/** No label markers while a run covers the chart — see where they are passed. */
const NO_LABEL_MARKERS: never[] = [];

export default function MarketData() {
  const dashboard = useDashboard();
  const queryClient = useQueryClient();
  const training = useTrainingContext();
  // Raw overlay writers. Taken from ChartOverlayContext rather than the merged
  // useDashboard() object: these are the bare state setters, so their identity
  // never changes and an effect that writes an overlay cannot re-trigger itself.
  const { setPredictionMarkers, setHighlightRange } = useChartOverlayContext();
  const { models } = useRegimeModels(training.isTraining);

  // ── Model Cycle run, drawn on this chart ──
  //
  // The run used to REPLACE the chart, which unmounted it and took every derived
  // layer with it. It is now a source of bars, panels, markers and marks on the
  // one market chart: the run's own bars become the candles, so its forecasts
  // land on the bars the model read and every indicator is computed on those
  // same bars.
  const run = useRunChartData();
  const runPlan = useCycleStore((state) => state.plan);

  // The overlay attaches imperatively to the chart the layout builds, so the
  // page bridges: `useRunOverlay` hands over an attach function, the chart
  // hands over the chart, and this calls one with the other.
  const attachRunOverlayRef = useRef<((target: RunOverlayTarget | null) => void) | null>(null);
  const registerRunOverlay = useCallback((attach: (target: RunOverlayTarget | null) => void) => {
    attachRunOverlayRef.current = attach;
  }, []);
  const runHover = useRunOverlay({ onChartReady: registerRunOverlay });
  const onRunChartReady = useCallback((target: ChartAttachTarget | null) => {
    attachRunOverlayRef.current?.(target);
  }, []);

  // Use dashboard context state directly to avoid redundant local state sync
  const { symbol, assetType, timeframeMinutes: timeframe } = dashboard;
  
  const [symbolOpen, setSymbolOpen] = useState(false);


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

  // A view request through the chart link (POST /api/chart/view). "latest" reloads the newest
  // window first � the chart may be anchored on an older one � then scrolls to its last bar.
  useEffect(() => subscribeChartView((view) => {
    if ("target" in view) {
      void handleReloadBars().then(() => setTimeout(() => requestChartScroll(view), 250));
    } else {
      requestChartScroll(view);
    }
  }), [handleReloadBars]);

  // Asset type switch: cancel in-flight queries, auto-select first symbol of new type
  const setAssetType = useCallback((t: "futures" | "forex") => {
    // Kill any in-flight OHLCV queries immediately — prevents stale stitching
    // queries from hogging lake resources while the new symbol loads
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

  // ── What the candles are ──
  //
  // A run's own bars while it is shown, otherwise the market's. Every derived
  // layer below reads this instead of `chartData`, so the 151 indicators,
  // support/resistance and the chart's own overlays are computed on the bars
  // actually on screen — the run's bars are roll-adjusted, and mixing the two
  // price spaces on one chart would draw every level in the wrong place.
  const drawnSource = run.bars ?? chartData;

  // A run declares its own instrument, which need not be the toolbar's. Price
  // formatting (tick size, decimals), the lake-column overlays and the context
  // published to every other surface must describe the bars being drawn.
  const chartSymbol = run.active && runPlan ? runPlan.symbol : symbol;
  const chartTimeframeMinutes = run.active && runPlan ? apiKeyToMinutes(runPlan.timeframe) : timeframe;
  const chartIsFutures = run.active && runPlan ? isFuturesSymbol(chartSymbol) : isFutures;

  // The run's two panels, each its own panel so `P(up)` and equity get their own
  // price scale. `closable: false` — they close with the run, not with the
  // user's indicator selection, which does not know them.
  const runPanels = useMemo<ExtraChartPanel[]>(
    () => run.panels.map((indicator) => ({ key: indicator.column, indicators: [indicator], closable: false })),
    [run.panels],
  );

  // ── Active indicators (new professional system) ──
  const {
    indicators: activeIndicators,
    addIndicator,
    removeIndicator,
    updateParams,
    toggleVisibility,
    clearAll: clearAllIndicators,
    overlays: indicatorOverlays,
  } = useActiveIndicators(drawnSource);

  // ── Feature Engineering Over-Indication & Collinearity Analysis ──
  const featureOverIndication = useFeatureOverIndication(activeIndicators);

  // ── CDL Patterns (computed client-side from OHLCV data) ──
  // Candlestick patterns are label generators now, chosen one at a time from
  // the label dropdown. This call only clears the retired selection.
  useIndicatorData();

  // What the chart is showing, shared by the lake series and the label overlay.
  const [visibleRange, setVisibleRange] = useState<{ start: number; end: number } | null>(null);
  // The chart reports a new visible range on every frame of a drag. Every
  // consumer of this range issues a request keyed on it, so the value settles
  // for 300ms before it moves � a pan becomes one request, not sixty.
  const visibleRangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleVisibleRangeChange = useCallback((range: { start: number; end: number } | null) => {
    if (visibleRangeTimer.current) clearTimeout(visibleRangeTimer.current);
    visibleRangeTimer.current = setTimeout(() => setVisibleRange(range), 300);
  }, []);
  useEffect(() => () => { if (visibleRangeTimer.current) clearTimeout(visibleRangeTimer.current); }, []);
  // ── Lake columns as chart series (fetched, not computed) ──
  const lakeSeries = useLakeSeries({
    symbol: chartSymbol,
    timeframe: minutesToApiKey(chartTimeframeMinutes),
    bars: drawnSource,
    visibleRange,
  });

  // ── Merge indicator overlays + pattern overlays + lake series ──
  // Lines a notebook beside the chart drew (useNotebookOverlays: markers, levels
  // and zones travel to the chart separately below).
  const notebookOverlays = useNotebookOverlays(symbol, minutesToApiKey(timeframe));
  const allOverlays = useMemo(() => {
    return [...indicatorOverlays, ...lakeSeries.overlays, ...notebookOverlays.lines];
  }, [indicatorOverlays, lakeSeries.overlays, notebookOverlays.lines]);

  const handleRemoveIndicators = useCallback((columns: string[]) => {
    // For indicator instance columns (instanceId::outputKey), remove the instance
    const instanceCols = columns.filter(c => c.includes('::'));
    const instanceIds = new Set(instanceCols.map(c => c.split('::')[0]!));
    for (const id of instanceIds) {
      removeIndicator(id);
    }
    // Lake columns are not instances � closing their pane deselects the column.
    lakeSeries.removeByOverlayColumns(columns);
  }, [removeIndicator, lakeSeries]);

  // ── Label overlay (toolbar dropdown → /api/labels/preview over the loaded bars) ──
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

  // ── Market Replay ──
  const replay = useLocalReplay(chartData);

  // ── Training Sync (live stabilization — no auto-replay) ──
  const trainingSync = useTrainingSync(training, symbol);

  // Live tail from the data hub (OANDA forex real time, Yahoo futures delayed,
  // live_source when recording), appended only while the chart shows its newest
  // lake bar � a live bar after a scrolled-back window would sit in the middle
  // of history.
  const lastChartTimestamp = chartData.length > 0 ? chartData[chartData.length - 1]!.timestamp : null;
  const liveTail = useLiveTail(symbol, timeframe, lastChartTimestamp);
  const chartWithLive = liveTail.bars.length > 0 ? [...chartData, ...liveTail.bars] : chartData;

  // A local replay of the market's own bars outranks a run's bars: it is the user
  // stepping through that series by hand. Otherwise the chart draws the run's
  // bars, or the market's with its live tail — which was this line before the run
  // became a source of bars.
  const displayData = replay.active ? replay.snapshot.visibleBars : (run.bars ?? chartWithLive);

  // What the chart shows, published to the notebooks beside it
  // (chartContextBridge.ts): symbol, timeframe, the visible range and the bar
  // last clicked, which a following notebook takes as its focus. While a run is
  // drawn this is the run's own instrument and bars — the alternative was a
  // context claiming MNQ 1m while the chart showed a 5m walk-forward test set.
  const [selectedBarMs, setSelectedBarMs] = useState<number | null>(null);
  useEffect(() => setSelectedBarMs(null), [chartSymbol, chartTimeframeMinutes]);
  useChartContextPublisher({
    symbol: chartSymbol,
    timeframe: minutesToApiKey(chartTimeframeMinutes),
    assetClass: run.active && runPlan
      ? (chartIsFutures ? 'futures' : 'forex')
      : assetType === 'forex' ? 'forex' : 'futures',
    visibleRange,
    selectedMs: selectedBarMs,
    firstBarMs: displayData.length > 0 ? displayData[0]!.timestamp : null,
    lastBarMs: displayData.length > 0 ? displayData[displayData.length - 1]!.timestamp : null,
    barCount: displayData.length,
  });

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

  // ── Chart overlay data (regime colors, SR, microstructure — extracted to hook) ──
  const {
    overlayToggles, regimeColorMap, regimeLegendInfo,
    selectedRegimes, toggleRegime, showAllRegimes,
    trainTestSplitTime, regimeQualityScore, matchedModelId,
    zigZagPts, structurePts,
    trainingRevealRange,
  } = useChartOverlayData(drawnSource, chartSymbol, minutesToLabel(chartTimeframeMinutes), {
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
  }, visibleRange);

  // ── Quick stats ──
  // -- Model predictions on the price chart ------------------------------
  //
  // Every model declares how it wants to be drawn with its `chartOverlay`
  // string, and emits that same string as the `overlayType` of its live
  // `overlay` events. dispatchOverlayEvent() routes on that string alone �
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

  // -- Training window highlight, advancing with the run -----------------
  //
  // Publishes the growing span so any chart painter reading
  // ChartOverlayContext.highlightRange gets the leading edge rather than one
  // static rectangle. What advances is the edge of a band drawn over the
  // training window � the candles themselves are unchanged, because
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
        onResetScrollState={resetScrollState}
      />

      {/* Training Status Strip — compact quality gates + progress when training */}
      {isTrainingActive && <TrainingStatusStrip />}

      {/* Analytics Strip */}
      {!isFetching && chartData.length === 0 && run.bars === null ? (
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
          live feed — which, since 2026-07-27, it always is. Hidden while a run
          is drawn: it reports on the live bar the chart is not showing. */}
      {!run.active && (
        <LiveQuoteStrip
          className="mb-2"
          symbol={symbol}
          timeframeApiKey={minutesToApiKey(timeframe)}
          tail={{ shown: liveTail.bars.length, waiting: liveTail.atNewest ? 0 : liveTail.minuteBars, onShow: () => void handleReloadBars(), gap: liveTail.gap }}
        />
      )}
      <AnalyticsStrip
        symbol={symbol}
        displayDataLength={run.active ? chartData.length : displayData.length}
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
        featureOverIndication={featureOverIndication}
        onClearAllIndicators={clearAllIndicators}
      />

      {/* Model Forecast Accuracy & Backtest Telemetry HUD */}
      <ForecastAccuracyHUD />

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

        {/* Training window progress � the span grows as the run proceeds */}
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
                : 'Span: the first and last bar this run is predicting over � it declared no training date range.'}
              {' '}Every bar in the span is already drawn on the chart � this is a progress
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
          <div className="flex-1 min-h-0 w-full h-full overflow-hidden relative">
            {(
              <div className="w-full h-full min-h-0">
                <IndicatorChartLayout
                  onReloadBars={handleReloadBars}
                  isReloadingBars={isReloadingBars}
                  data={displayData}
                  symbol={chartSymbol}
                  isFutures={chartIsFutures}
                  timeframe={chartTimeframeMinutes}
                  isReplayActive={replay.active}
                  // Infinite scroll belongs to the market's own series. A run's bars
                  // are the whole test walk already, and asking the lake for more of
                  // them would append bars the model never read.
                  onLoadMore={!replay.active && !run.active && useInfiniteScroll ? handleLoadMore : undefined}
                  onPrefetch={!replay.active && !run.active && useInfiniteScroll ? triggerPrefetch : undefined}
                  onVisibleTimeRangeChange={handleVisibleRangeChange}
                  isLoadingMore={isLoadingMore}
                  hasMoreLeft={!replay.active && !run.active && hasMoreLeft}
                  hasMoreRight={!replay.active && !run.active && hasMoreRight}
                  // A landed label set is keyed to the market series it was generated
                  // from; its markers would point at bars the chart is no longer
                  // showing, so they step aside for the run's own glyphs.
                  labelMarkers={run.active ? NO_LABEL_MARKERS : labelMarkers}
                  indicatorOverlays={allOverlays}
                  onRemoveIndicators={handleRemoveIndicators}
                  zigZagPoints={zigZagPts}
                  swingZigZagPoints={structurePts}
                  tradeMarkers={dashboard.overlays.tradeMarkers}
                  predictionMarkers={dashboard.overlays.predictionMarkers}
                  regimeColorMap={regimeColorMap}
                  trainTestSplitTime={trainTestSplitTime}
                  onBarClick={setSelectedBarMs}
                  notebookMarkers={notebookOverlays.markers}
                  notebookDrawings={notebookOverlays.drawings}
                  // ── The Model Cycle run, on this chart ──
                  extraPanels={runPanels}
                  extraMarkers={run.markers}
                  onChartReady={onRunChartReady}
                  chrome={<RunChartChrome hover={runHover} />}
                />
              </div>
            )}
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



