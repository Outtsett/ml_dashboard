import { useState, memo } from "react";
import { BarChart3, TerminalSquare, MessageSquare, BrainCircuit, Activity } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import IndicatorChartLayout from "@/components/IndicatorChartLayout";
import { ReplayControls } from "@/components/ReplayControls";
import { TrainingSyncBanner } from "@/components/TrainingSyncBanner";
import { RegimeLegend, type RegimeInfo } from "@/components/RegimeLegend";
import { TerminalTabs } from "@/components/terminal/TerminalTabs";
import { ChatTab } from "@/components/panels/chat/ChatTab";
import { MLWorkflowSidebar } from "@/components/sidebar/MLWorkflowSidebar";
import type { LabelMarker } from "@/components/TradingChart";
import type { PlaybackSpeed, PlaybackState } from "@/hooks/useLocalReplay";
import type { OhlcvData } from "./types";
import { cn } from "@/lib/utils";

interface IntegratedTabsProps {
  // Chart data
  displayData: OhlcvData[];
  chartData: OhlcvData[];
  symbol: string;
  isFutures: boolean;
  timeframe: number;
  // Replay
  replay: {
    active: boolean;
    state: PlaybackState;
    speed: PlaybackSpeed;
    snapshot: any;
    play: () => void;
    pause: () => void;
    stepForward: () => void;
    stepBackward: () => void;
    seekTo: (pos: number) => void;
    changeSpeed: (speed: PlaybackSpeed) => void;
    reset: () => void;
  };
  // Training sync
  trainingSync: {
    isActive: boolean;
    gibbsIter: number;
    gibbsTotal: number;
    activeRegimes: number;
    regimeLegend: any[];
    trainingPhase: string;
    stability: number;
  };
  // Regime
  regimeLegendInfo: RegimeInfo[];
  selectedRegimes: Set<number> | null;
  onToggleRegime: (id: number) => void;
  onShowAllRegimes: () => void;
  regimeColorMap: Map<number, number> | undefined;
  trainTestSplitTime: number | undefined;
  // Infinite scroll
  useInfiniteScroll: boolean;
  onLoadMore: ((direction: 'left' | 'right', timestamp: number) => Promise<void>) | undefined;
  onPrefetch?: (direction: 'left' | 'right', edgeTimestamp: number) => void;
  isLoadingMore: boolean;
  hasMoreLeft: boolean;
  hasMoreRight: boolean;
  // Overlays
  labelMarkers: LabelMarker[];
  indicatorOverlays: any[];
  onRemoveIndicators: (columns: string[]) => void;
  supportResistanceLevels: any[];
  zigZagPoints: any[];
  swingZigZagPoints: any[];
  tradeMarkers: any[];
  predictionMarkers: any[];
  // Sidebar callbacks
  onLabelMarkersChange: (markers: LabelMarker[], show: boolean) => void;
  // Tab state
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const IntegratedTabs = memo(function IntegratedTabs({
  displayData, chartData, symbol, isFutures, timeframe,
  replay, trainingSync,
  regimeLegendInfo, selectedRegimes, onToggleRegime, onShowAllRegimes,
  regimeColorMap, trainTestSplitTime,
  useInfiniteScroll, onLoadMore, onPrefetch, isLoadingMore, hasMoreLeft, hasMoreRight,        
  labelMarkers, indicatorOverlays, onRemoveIndicators,
  supportResistanceLevels, zigZagPoints, swingZigZagPoints,
  tradeMarkers, predictionMarkers,
  onLabelMarkersChange,
  activeTab, onTabChange
}: IntegratedTabsProps) {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Institutional Tab Strip */}
      <div className="flex items-center px-4 py-1 border-b border-white/[0.06] shrink-0 bg-background/40 backdrop-blur-md">
        <TabsList className="glass rounded-lg p-0.5 h-auto w-fit gap-1 bg-white/[0.02]">       
          <TabsTrigger value="price" className="rounded-md px-4 py-1.5 text-[11px] font-bold tracking-tight data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-2 transition-all">
            <BarChart3 className="h-3.5 w-3.5" /> PRICE
          </TabsTrigger>
          <TabsTrigger value="ml-studio" className="rounded-md px-4 py-1.5 text-[11px] font-bold tracking-tight data-[state=active]:bg-violet-500/20 data-[state=active]:text-violet-400 gap-2 transition-all">
            <BrainCircuit className="h-3.5 w-3.5" /> ML STUDIO
          </TabsTrigger>
          <TabsTrigger value="terminal" className="rounded-md px-4 py-1.5 text-[11px] font-bold tracking-tight data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400 gap-2 transition-all">
            <TerminalSquare className="h-3.5 w-3.5" /> TERMINAL
          </TabsTrigger>
          <TabsTrigger value="chat" className="rounded-md px-4 py-1.5 text-[11px] font-bold tracking-tight data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-400 gap-2 transition-all">
            <MessageSquare className="h-3.5 w-3.5" /> CHAT
          </TabsTrigger>
        </TabsList>

        <div className="flex-1" />

        {/* Live Status Indicators in Tab Bar */}
        <div className="flex items-center gap-4 px-2">
          {trainingSync.isActive && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
              <Activity className="h-3 w-3 text-amber-400 animate-pulse" />
              <span className="text-[9px] font-mono font-bold text-amber-400 uppercase tracking-widest">{trainingSync.trainingPhase}</span>
            </div>
          )}
        </div>
      </div>

      {/* --- PRICE TAB --- */}
      <TabsContent value="price" className="flex-1 min-h-0 flex flex-col m-0 p-0 overflow-hidden">
        {/* Training banner inside Price tab */}
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
              onToggleRegime={onToggleRegime}
              onShowAll={onShowAllRegimes}
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
              onLoadMore={!replay.active && useInfiniteScroll ? onLoadMore : undefined}     
              onPrefetch={!replay.active && useInfiniteScroll ? onPrefetch : undefined}     
              isLoadingMore={isLoadingMore}
              hasMoreLeft={!replay.active && hasMoreLeft}
              hasMoreRight={!replay.active && hasMoreRight}
              labelMarkers={labelMarkers}
              indicatorOverlays={indicatorOverlays}
              onRemoveIndicators={onRemoveIndicators}
              supportResistanceLevels={supportResistanceLevels}
              zigZagPoints={zigZagPoints}
              swingZigZagPoints={swingZigZagPoints}
              tradeMarkers={tradeMarkers}
              predictionMarkers={predictionMarkers}
              regimeColorMap={regimeColorMap}
              trainTestSplitTime={trainTestSplitTime}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent">
            <div className="relative mb-5">
              <BarChart3 className="h-16 w-16 opacity-15 text-primary" />
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500/60 animate-pulse" />
            </div>
            <p className="font-mono text-sm font-medium tracking-wide text-muted-foreground/80">
              Awaiting market data
            </p>
          </div>
        )}
      </TabsContent>

      {/* --- ML STUDIO TAB --- */}
      <TabsContent value="ml-studio" className="flex-1 min-h-0 m-0 p-4 bg-background/20 overflow-auto">
        <div className="max-w-[1200px] mx-auto h-full">
          <MLWorkflowSidebar
            chartData={chartData}
            symbol={symbol}
            isFutures={isFutures}
            timeframe={timeframe}
            onLabelMarkersChange={onLabelMarkersChange}
          />
        </div>
      </TabsContent>

      {/* --- TERMINAL TAB --- */}
      <TabsContent value="terminal" className="flex-1 min-h-0 m-0 p-0 overflow-hidden">
        <TerminalTabs visible={activeTab === "terminal"} />
      </TabsContent>

      {/* --- CHAT TAB --- */}
      <TabsContent value="chat" className="flex-1 min-h-0 m-0 p-0 overflow-hidden">
        <ChatTab />
      </TabsContent>
    </Tabs>
  );
});
