import { Database } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import IndicatorChartLayout from "@/components/IndicatorChartLayout";
import { ReplayControls } from "@/components/ReplayControls";
import { TrainingSyncBanner } from "@/components/TrainingSyncBanner";
import { RegimeLegend, type RegimeInfo } from "@/components/RegimeLegend";
import { TerminalTabs } from "@/components/terminal/TerminalTabs";
import type { LabelMarker } from "@/components/TradingChart";
import type { PlaybackSpeed, PlaybackState } from "@/hooks/useLocalReplay";
import type { OhlcvData } from "./types";

interface ChartPanelProps {
  // Chart data
  displayData: OhlcvData[];
  chartData: OhlcvData[];
  effectiveSymbol: string;
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

export function ChartPanel({
  displayData, chartData, effectiveSymbol, isFutures, timeframe,
  replay, trainingSync,
  regimeLegendInfo, selectedRegimes, onToggleRegime, onShowAllRegimes,
  regimeColorMap, trainTestSplitTime,
  useInfiniteScroll, onLoadMore, isLoadingMore, hasMoreLeft, hasMoreRight,
  labelMarkers, indicatorOverlays, onRemoveIndicators,
  supportResistanceLevels, zigZagPoints, swingZigZagPoints,
  tradeMarkers, predictionMarkers,
}: ChartPanelProps) {
  return (
    <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0">
      {/* Chart panel */}
      <ResizablePanel defaultSize={75} minSize={30}>
        <div className="h-full flex flex-col">
          {/* Training banner — visible whenever training is active (independent of replay) */}
          {trainingSync.isActive && (
            <div className="px-3 py-1.5 border-b border-white/5 shrink-0">
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
            <div className="px-3 py-1.5 border-b border-white/5 shrink-0 flex items-center gap-3">
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
            <div className="px-3 py-1 border-b border-white/5 shrink-0">
              <RegimeLegend
                regimes={regimeLegendInfo}
                selectedRegimes={selectedRegimes}
                onToggleRegime={onToggleRegime}
                onShowAll={onShowAllRegimes}
              />
            </div>
          )}

          {displayData.length > 0 ? (
            <div className="flex-1 min-h-0 p-1">
              <IndicatorChartLayout
                data={displayData}
                symbol={effectiveSymbol}
                isFutures={isFutures}
                timeframe={timeframe}
                isReplayActive={replay.active}
                onLoadMore={!replay.active && useInfiniteScroll ? onLoadMore : undefined}
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
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Database className="h-12 w-12 mb-3 opacity-20" />
              <p className="font-mono text-sm">No data for {effectiveSymbol}</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Upload {isFutures ? 'futures' : 'forex'} data to see the chart</p>
            </div>
          )}
        </div>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Terminal panel */}
      <ResizablePanel defaultSize={25} minSize={5} maxSize={60}>
        <TerminalTabs showTrainingTab />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
