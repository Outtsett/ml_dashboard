/**
 * ReplayControls — VCR-style playback controls for market replay
 *
 * Think of it as: the media player bar at the bottom of a YouTube video,
 * but for market data. Play, pause, step through bars, adjust speed,
 * and scrub to any point in time.
 */
import { useCallback } from 'react';
import { Button } from '@/shared/ui/button';
import { Slider } from '@/shared/ui/slider';
import { Badge } from '@/shared/ui/badge';
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Gauge,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import type { PlaybackSpeed, PlaybackState } from "@/market/lib/useLocalReplay";

interface ReplaySnapshot {
  currentBarIndex: number;
  totalBars: number;
  progress: number;
  currentBar: any | null;
  // Optional fields — only present when using full replay engine with backtest
  currentPrediction?: { prediction: number; confidence: number } | null;
  openPosition?: { side: string; entryPrice: number } | null;
  currentEquity?: number | null;
  equityCurve?: { equity: number }[];
}

interface ReplayControlsProps {
  state: PlaybackState;
  speed: PlaybackSpeed;
  snapshot: ReplaySnapshot;
  onPlay: () => void;
  onPause: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onSeekTo: (barIndex: number) => void;
  onChangeSpeed: (speed: PlaybackSpeed) => void;
  onReset: () => void;
}

const SPEEDS: PlaybackSpeed[] = [1, 2, 5, 10, 25, 50, 100];

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function ReplayControls({
  state,
  speed,
  snapshot,
  onPlay,
  onPause,
  onStepForward,
  onStepBackward,
  onSeekTo,
  onChangeSpeed,
  onReset,
}: ReplayControlsProps) {
  const isPlaying = state === 'playing';
  const isDisabled = state === 'idle';

  const handleSliderChange = useCallback((value: number[]) => {
    onSeekTo(value[0]!);
  }, [onSeekTo]);

  const cycleSpeed = useCallback(() => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length]!;
    onChangeSpeed(next);
  }, [speed, onChangeSpeed]);

  const { currentBar, currentPrediction, openPosition, currentEquity } = snapshot as any;

  return (
    <div className="space-y-2">
      {/* ── Progress Bar ── */}
      <div className="px-1">
        <Slider
          min={0}
          max={Math.max(snapshot.totalBars - 1, 1)}
          step={1}
          value={[snapshot.currentBarIndex]}
          onValueChange={handleSliderChange}
          disabled={isDisabled}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5 font-mono">
          <span>{currentBar ? formatTimestamp(currentBar.timestamp || currentBar.ts) : '—'}</span>
          <span>Bar {snapshot.currentBarIndex + 1} / {snapshot.totalBars}</span>
          <span>{(snapshot.progress * 100).toFixed(1)}%</span>
        </div>
      </div>

      {/* ── Control Buttons ── */}
      <div className="flex items-center gap-1.5">
        {/* Transport controls */}
        <Button variant="outline" size="icon" onClick={onReset} disabled={isDisabled} className="h-8 w-8" title="Reset">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" onClick={onStepBackward} disabled={isDisabled} className="h-8 w-8" title="Step back">
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={isPlaying ? "secondary" : "default"}
          size="icon"
          onClick={isPlaying ? onPause : onPlay}
          disabled={isDisabled}
          className="h-9 w-9"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button variant="outline" size="icon" onClick={onStepForward} disabled={isDisabled} className="h-8 w-8" title="Step forward">
          <SkipForward className="h-3.5 w-3.5" />
        </Button>

        {/* Speed */}
        <Button variant="ghost" size="sm" onClick={cycleSpeed} disabled={isDisabled} className="h-8 px-2 font-mono text-xs gap-1" title="Cycle speed">
          <Gauge className="h-3 w-3" />
          {speed}x
        </Button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Live status badges */}
        {currentBar && (
          <div className="flex items-center gap-1.5">
            {/* Price */}
            <Badge variant="outline" className="font-mono text-[10px] h-6">
              {typeof currentBar.close === 'number' ? currentBar.close.toFixed(2) : currentBar.close}
            </Badge>

            {/* Prediction */}
            {currentPrediction && (
              <Badge
                variant={currentPrediction.prediction === 2 ? "default" : currentPrediction.prediction === 0 ? "destructive" : "secondary"}
                className="text-[10px] h-6 gap-0.5"
              >
                {currentPrediction.prediction === 2 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : currentPrediction.prediction === 0 ? (
                  <TrendingDown className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )}
                {(currentPrediction.confidence * 100).toFixed(0)}%
              </Badge>
            )}

            {/* Open position */}
            {openPosition && (
              <Badge
                variant={openPosition.side === 'long' ? "default" : "destructive"}
                className="text-[10px] h-6"
              >
                {openPosition.side === 'long' ? <ChevronRight className="h-3 w-3 inline" /> : <ChevronLeft className="h-3 w-3 inline" />}
                {openPosition.side.toUpperCase()} @ {openPosition.entryPrice.toFixed(2)}
              </Badge>
            )}

            {/* Equity */}
            {currentEquity != null && (
              <Badge
                variant="outline"
                className={`text-[10px] h-6 font-mono ${currentEquity >= 0 ? 'text-green-500' : 'text-red-500'}`}
              >
                ${currentEquity.toFixed(0)}
              </Badge>
            )}
          </div>
        )}

        {/* State indicator */}
        <Badge variant={
          state === 'playing' ? 'default' :
          state === 'paused' ? 'secondary' :
          state === 'finished' ? 'outline' :
          'secondary'
        } className="text-[10px] h-6 uppercase tracking-wider">
          {state}
        </Badge>
      </div>

      {/* ── Speed presets row ── */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground mr-1">Speed:</span>
        {SPEEDS.map(s => (
          <Button
            key={s}
            variant={speed === s ? "default" : "ghost"}
            size="sm"
            onClick={() => onChangeSpeed(s)}
            disabled={isDisabled}
            className="h-6 px-1.5 text-[10px] font-mono"
          >
            {s}x
          </Button>
        ))}
      </div>
    </div>
  );
}
