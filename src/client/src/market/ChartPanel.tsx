import { useState, memo } from "react";
import { BarChart3, TerminalSquare, MessageSquare } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/shared/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import IndicatorChartLayout from "@/market/components/IndicatorChartLayout";
import { ReplayControls } from "@/market/components/ReplayControls";
import { TrainingSyncBanner } from "@/training/TrainingSyncBanner";
import { RegimeLegend, type RegimeInfo } from "@/ml/components/RegimeLegend";
import { TerminalTabs } from "@/system/components/TerminalTabs";
import { ChatTab } from "@/portfolio/components/chat/ChatTab";
import type { LabelMarker } from "@/market/components/TradingChart";
import type { PlaybackSpeed, PlaybackState } from "@/market/lib/useLocalReplay";
import type { OhlcvData } from "@/market/components/types";

interface ChartPanelProps {
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
}

export const ChartPanel = memo(function ChartPanel({
  displayData, chartData: _chartData, symbol, isFutures, timeframe,
  replay, trainingSync,
  regimeLegendInfo, selectedRegimes, onToggleRegime, onShowAllRegimes,
  regimeColorMap, trainTestSplitTime,
  useInfiniteScroll, onLoadMore, onPrefetch, isLoadingMore, hasMoreLeft, hasMoreRight,
  labelMarkers, indicatorOverlays, onRemoveIndicators,
  supportResistanceLevels, zigZagPoints, swingZigZagPoints,
  tradeMarkers, predictionMarkers,
}: ChartPanelProps) {
  const [bottomTab, setBottomTab] = useState("terminal");

  return (
    <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0">
      {/* Chart panel */}
      <ResizablePanel defaultSize={75} minSize={30}>
        <div className="h-full flex flex-col">
          {/* Training banner — visible whenever training is active (independent of replay) */}
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

          {/* Replay controls — only when replay is active */}
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
            <div className="flex-1 min-h-0 flex-1 min-h-0">
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
              <p className="text-xs text-muted-foreground/40 mt-1.5">
                Load {isFutures ? 'futures' : 'forex'} data for <span className="text-primary/60 font-semibold">{symbol}</span> to begin
              </p>
            </div>
          )}
        </div>
      </ResizablePanel>

      <ResizableHandle className="bg-border/30 hover:bg-primary/20 data-[resize-handle-active]:bg-primary/30 transition-colors after:!h-1 after:!rounded-full after:!bg-muted-foreground/20 hover:after:!bg-primary/40" withHandle />

      {/* Bottom panel — Terminal + Chat */}
      <ResizablePanel defaultSize={25} minSize={5} maxSize={60}>
        <Tabs value={bottomTab} onValueChange={setBottomTab} className="h-full flex flex-col overflow-hidden">
          <div className="flex items-center px-2 pt-1 pb-0.5 border-b border-white/[0.06] shrink-0">
            <TabsList className="glass rounded-lg p-0.5 h-auto w-fit">
              <TabsTrigger value="terminal" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400 gap-1">
                <TerminalSquare className="h-3 w-3" /> Terminal
              </TabsTrigger>
              <TabsTrigger value="chat" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-400 gap-1">
                <MessageSquare className="h-3 w-3" /> Chat
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="terminal" className="flex-1 min-h-0 overflow-hidden mt-0">
            <TerminalTabs visible={bottomTab === "terminal"} />
          </TabsContent>

          <TabsContent value="chat" className="flex-1 min-h-0 overflow-hidden mt-0">
            <ChatTab />
          </TabsContent>
        </Tabs>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});
