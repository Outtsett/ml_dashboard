/**
 * Trade Lab — single home for chart exploration + model trade analysis.
 *
 * Absorbs the full Market Data feature set (asset/symbol/timeframe picker,
 * 151 indicators, CDL patterns, S/R + zigzag + structure overlays, regime
 * shading, replay, training sync) and adds a backtest-run picker that
 * layers trades on top: click any marker for a detail drawer, equity +
 * drawdown curve below the chart, sortable trade list filtered to the
 * visible window.
 *
 * No run selected → behaves exactly like the old Market Data page.
 * Run selected → the trade-analysis layers fade in.
 */
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/shared/ui/empty";
import { TrendingUp, DollarSign, BarChart3, Clock, LineChart } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useCallback, useState } from "react";
import { motion } from "framer-motion";
import { type LabelMarker } from "@/market/components/TradingChart";
import { useIndicatorData } from "@/market/lib/useIndicatorData";
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
import { minutesToLabel } from "@/market/lib/timeframes";
import { TrainingStatusStrip } from "@/training/market-data/TrainingStatusStrip";
import IndicatorChartLayout from "@/market/components/IndicatorChartLayout";
import { ReplayControls } from "@/market/components/ReplayControls";
import { RegimeLegend } from "@/ml/components/RegimeLegend";
import { TrainingSyncBanner } from "@/training/TrainingSyncBanner";

import { TradeLabProvider, useTradeLab } from "@/contexts/TradeLabContext";
import { MarketToolbar } from "./MarketToolbar";
import { MarketAnalyticsStrip } from "./MarketAnalyticsStrip";
import { useChartOverlayData } from "./hooks/useChartOverlayData";
import type { InstrumentInfo } from "./types";
import { TradeLabToolbar } from "./TradeLabToolbar";
import { TradeLabStatStrip } from "./TradeLabStatStrip";
import { TradeDetailDrawer } from "./TradeDetailDrawer";
import { EquityDrawdownPanel } from "./EquityDrawdownPanel";
import { TradeListPanel } from "./TradeListPanel";
import { ConfPnLScatter } from "./analytics/ConfPnLScatter";
import { RegimePnLBars } from "./analytics/RegimePnLBars";
import { MAEMFEHistogram } from "./analytics/MAEMFEHistogram";
import { useTradeLabRun, parseMarkerId } from "./hooks/useTradeLabRun";
import { useEquityCurve } from "./hooks/useEquityCurve";

export default function TradeLab() {
  return (
    <TradeLabProvider>
      <TradeLabBody />
    </TradeLabProvider>
  );
}

function TradeLabBody() {
  const dashboard = useDashboard();
  const queryClient = useQueryClient();
  const training = useTrainingContext();
  const { models } = useRegimeModels(training.isTraining);

  const { selectedRunId, setSelectedTradeId, setVisibleRange } = useTradeLab();
  const run = useTradeLabRun(selectedRunId);
  const equity = useEquityCurve(run.trades);

  const { symbol, assetType, timeframeMinutes: timeframe } = dashboard;

  const [symbolOpen, setSymbolOpen] = useState(false);

  const setTimeframe = useCallback((m: number) => {
    queryClient.cancelQueries({ queryKey: ['/api/charts/ohlcv'] });
    dashboard.setTimeframeMinutes(m);
  }, [queryClient, dashboard]);

  const tfLabel = minutesToLabel(timeframe);
  useBreadcrumbs([
    { label: "Trade Lab" },
    { label: assetType === "futures" ? "Futures" : "Forex", icon: assetType === "futures" ? TrendingUp : DollarSign },
    { label: symbol },
    { label: tfLabel, icon: Clock },
    ...(selectedRunId != null ? [{ label: `Run #${selectedRunId}` }] : []),
  ]);

  // ── Instruments ────────────────────────────────────────────────────────
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

  // ── OHLCV (must precede indicators — indicators consume bars) ──────────
  const {
    chartData, isFetching, isLoadingMore, hasMoreLeft, hasMoreRight,
    handleLoadMore, triggerPrefetch, resetScrollState, useInfiniteScroll,
  } = useChartOHLCV(symbol, timeframe);

  const setAssetType = useCallback((t: "futures" | "forex") => {
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

  // ── Indicators (151 client-side) ───────────────────────────────────────
  const {
    indicators: activeIndicators,
    addIndicator,
    removeIndicator,
    updateParams,
    toggleVisibility,
    clearAll: clearAllIndicators,
    overlays: indicatorOverlays,
  } = useActiveIndicators(chartData);

  // ── CDL Patterns ───────────────────────────────────────────────────────
  useIndicatorData();

  const allOverlays = useMemo(() => [...indicatorOverlays], [indicatorOverlays]);

  const handleRemoveIndicators = useCallback((columns: string[]) => {
    const instanceCols = columns.filter(c => c.includes('::'));
    const instanceIds = new Set(instanceCols.map(c => c.split('::')[0]!));
    for (const id of instanceIds) {
      removeIndicator(id);
    }
  }, [removeIndicator]);

  // ── Sidebar label markers ──────────────────────────────────────────────
  const [sidebarLabelMarkers] = useState<LabelMarker[]>([]);
  const [sidebarShowLabels] = useState(false);

  // ── Replay + training sync ─────────────────────────────────────────────
  const replay = useLocalReplay(chartData);
  const trainingSync = useTrainingSync(training, symbol);
  const displayData = replay.active ? replay.snapshot.visibleBars : chartData;

  // ── Regime / SR / zigzag / structure overlays ─────────────────────────
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

  // ── Quick stats / live ML trade overlay ────────────────────────────────
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

  const handleStopTraining = useCallback(() => { stopTraining(); }, [stopTraining]);

  const selectSymbol = useCallback(async (sym: string, type: "futures" | "forex") => {
    queryClient.cancelQueries({ queryKey: ['/api/charts/ohlcv'] });
    dashboard.setSymbol(sym);
    dashboard.setAssetType(type);
    resetScrollState();
  }, [queryClient, dashboard, resetScrollState]);

  // Memoize toolbar callbacks
  const handleToggleSR = useCallback(() => overlayToggles.setShowSR(v => !v), [overlayToggles]);
  const handleToggleZigZag = useCallback(() => overlayToggles.setShowZigZag(v => !v), [overlayToggles]);
  const handleToggleStructure = useCallback(() => overlayToggles.setShowStructure((v: boolean) => !v), [overlayToggles]);
  const noopOpenMl = useCallback(() => { /* legacy hook — unused in Trade Lab */ }, []);
  const noopTabChange = useCallback((_t: string) => { /* legacy — single-tab Trade Lab */ }, []);

  // ── Run-driven side effects ────────────────────────────────────────────
  // When a run is picked, point the dashboard symbol at the run's symbol.
  useEffect(() => {
    if (run.trades.length > 0) {
      const sym = run.trades[0]!.symbol;
      if (sym && sym !== dashboard.symbol) {
        dashboard.setSymbol(sym);
      }
    }
  }, [run.trades, dashboard]);

  // Clear selected trade when the run changes.
  useEffect(() => { setSelectedTradeId(null); }, [selectedRunId, setSelectedTradeId]);

  // ── Marker click resolution ────────────────────────────────────────────
  const onTradeMarkerClick = useCallback((markerId: string) => {
    const parsed = parseMarkerId(markerId);
    if (parsed) setSelectedTradeId(parsed.tradeId);
  }, [setSelectedTradeId]);

  // ── Visible-range sync (for equity/list/stats scoping) ────────────────
  const onVisibleLogicalRangeChange = useCallback((range: { from: number; to: number }) => {
    if (!chartData.length) return;
    const fromIdx = Math.max(0, Math.floor(range.from));
    const toIdx = Math.min(chartData.length - 1, Math.ceil(range.to));
    const fromBar = chartData[fromIdx];
    const toBar = chartData[toIdx];
    if (!fromBar || !toBar) return;
    setVisibleRange({
      from: Math.floor(Number(fromBar.timestamp) / 1000),
      to: Math.floor(Number(toBar.timestamp) / 1000),
    });
  }, [chartData, setVisibleRange]);

  // Trade markers from the selected run (entries+exits) take precedence over
  // the dashboard's overlay tradeMarkers when a run is picked. When no run,
  // the dashboard overlays (live signals etc.) drive.
  const chartTradeMarkers = selectedRunId != null ? run.markers : dashboard.overlays.tradeMarkers;

  const hasRun = selectedRunId != null;

  // h-full, NOT h-screen: Layout's <main> is already h-screen and has spent part
  // of it on the titlebar spacer + breadcrumb, so claiming a second 100vh here
  // overflowed the body box (43px in the browser, ~63px under Electron's taller
  // pt-[36px] breadcrumb) and main's overflow-hidden silently clipped the
  // bottom subchart.
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Trade Lab strip — run picker + filter chips (always visible) */}
      <TradeLabToolbar />

      {/* Market toolbar — asset/symbol/timeframe/indicators/patterns/overlays/training */}
      <MarketToolbar
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
        indicatorsLoading={false}
        showSR={overlayToggles.showSR}
        onToggleSR={handleToggleSR}
        showZigZag={overlayToggles.showZigZag}
        onToggleZigZag={handleToggleZigZag}
        showStructure={overlayToggles.showStructure}
        onToggleStructure={handleToggleStructure}
        isTrainingActive={isTrainingActive}
        activeTab="price"
        onTabChange={noopTabChange}
        onStartTraining={handleStartTraining}
        onStopTraining={handleStopTraining}
        isTrainingStarting={isTrainingStarting}
        onOpenMlPanel={noopOpenMl}
        onResetScrollState={resetScrollState}
      />

      {isTrainingActive && <TrainingStatusStrip />}

      {/* Run-scoped headline metrics — only when a run is picked */}
      {hasRun && <TradeLabStatStrip trades={run.trades} equity={equity} />}

      {/* Run fetch error banner */}
      {hasRun && run.isError && (
        <div className="px-3 py-2 border-b border-[hsl(var(--data-neg)/0.3)] bg-[hsl(var(--data-neg)/0.05)] text-[11px] font-mono text-[hsl(var(--data-neg))] shrink-0">
          run fetch failed: {run.error?.message ?? 'unknown error'}
          <button
            onClick={run.refetch}
            className="ml-3 px-2 py-0.5 rounded border border-[hsl(var(--data-neg)/0.4)] hover:bg-[hsl(var(--data-neg)/0.1)]"
          >
            retry
          </button>
        </div>
      )}

      {/* Chart-area empty state */}
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
          <MarketAnalyticsStrip
            symbol={symbol}
            displayDataLength={displayData.length}
            chartDataLength={chartData.length}
            replayActive={replay.active}
            isLoadingMore={isLoadingMore}
            tradeMetrics={tradeMetrics}
            modelCount={modelCount}
            matchedModelId={matchedModelId ?? null}
            regimeLegendInfo={regimeLegendInfo}
            regimeIsTraining={training.isTraining}
            regimeQualityScore={regimeQualityScore}
            isTrainingActive={isTrainingActive}
          />

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Training-sync banner */}
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
              <div className="flex-1 min-h-0 flex">
                {/* Chart + (when run picked) drawer + bottom equity/list */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <div className="flex-1 min-h-0">
                    <IndicatorChartLayout
                      data={displayData}
                      symbol={symbol}
                      isFutures={isFutures}
                      timeframe={timeframe}
                      isReplayActive={replay.active}
                      onLoadMore={!replay.active && useInfiniteScroll ? handleLoadMore : undefined}
                      onPrefetch={!replay.active && useInfiniteScroll ? triggerPrefetch : undefined}
                      isLoadingMore={isLoadingMore}
                      hasMoreLeft={!replay.active && hasMoreLeft}
                      hasMoreRight={!replay.active && hasMoreRight}
                      labelMarkers={sidebarShowLabels ? sidebarLabelMarkers : []}
                      indicatorOverlays={allOverlays}
                      onRemoveIndicators={handleRemoveIndicators}
                      supportResistanceLevels={srLevels}
                      zigZagPoints={zigZagPts}
                      swingZigZagPoints={structurePts}
                      tradeMarkers={chartTradeMarkers}
                      predictionMarkers={dashboard.overlays.predictionMarkers}
                      regimeColorMap={regimeColorMap}
                      trainTestSplitTime={trainTestSplitTime}
                      onTradeMarkerClick={hasRun ? onTradeMarkerClick : undefined}
                      onMainRangeChange={hasRun ? onVisibleLogicalRangeChange : undefined}
                    />
                  </div>

                  {/* Equity / drawdown — only when run is picked */}
                  {hasRun && (
                    <div className="h-[160px] border-t border-white/5 bg-card/10 flex flex-col shrink-0">
                      <EquityDrawdownPanel curve={equity} />
                    </div>
                  )}
                </div>

                {/* Trade detail drawer — only when run is picked */}
                {hasRun && (
                  <div className="w-[300px] shrink-0 flex flex-col border-l border-white/5">
                    <TradeDetailDrawer trades={run.trades} />
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

          {/* Bottom row — 3 analytics tiles + trade list, side-by-side. Only when run picked. */}
          {hasRun && (
            <div className="h-[220px] border-t border-white/5 shrink-0 flex">
              <ConfPnLScatter trades={run.trades} />
              <RegimePnLBars trades={run.trades} />
              <MAEMFEHistogram trades={run.trades} />
              <div className="flex-[1.5] min-w-0 flex flex-col">
                <TradeListPanel trades={run.trades} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
