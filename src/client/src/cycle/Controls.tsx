/**
 * Play / pause / resume / stop / speed / follow / show-on-chart for the
 * current cycle run. Reads `useCycleStore` for status; the setup config
 * (needed only to start a run) is passed in from `CyclePage`.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Play, Pause, Square, Eye, EyeOff, Compass, Gauge } from "lucide-react";

import { cn } from "@/shared/utils/utils";
import { Button } from "@/shared/ui/button";
import { Slider } from "@/shared/ui/slider";
import { Switch } from "@/shared/ui/switch";
import { Label } from "@/shared/ui/label";

import { controlCycle, startCycle, stopCycle } from "@/cycle/connection";
import { useCycleStore } from "@/cycle/store";
import { type CycleFormState, validateCycleForm } from "@/cycle/ConfigForm";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";

const SPEED_DEBOUNCE_MILLISECONDS = 150;
/** Log-scale slider: position 0..1000 maps to 1..2000 bars/s. */
const SPEED_SLIDER_MAX = 1000;
const SPEED_MIN_BARS_PER_SECOND = 1;
const SPEED_MAX_BARS_PER_SECOND = 2000;

function speedToSlider(barsPerSecond: number): number {
  if (barsPerSecond <= 0) return SPEED_SLIDER_MAX;
  const ratio = Math.log(barsPerSecond / SPEED_MIN_BARS_PER_SECOND) / Math.log(SPEED_MAX_BARS_PER_SECOND / SPEED_MIN_BARS_PER_SECOND);
  return Math.round(Math.min(1, Math.max(0, ratio)) * SPEED_SLIDER_MAX);
}

function sliderToSpeed(position: number): number {
  const ratio = position / SPEED_SLIDER_MAX;
  return Math.round(SPEED_MIN_BARS_PER_SECOND * Math.pow(SPEED_MAX_BARS_PER_SECOND / SPEED_MIN_BARS_PER_SECOND, ratio));
}

export interface ControlsProps {
  formState: CycleFormState;
}

export function Controls({ formState }: ControlsProps) {
  const status = useCycleStore((state) => state.status);
  const cursor = useCycleStore((state) => state.cursor);
  const follow = useCycleStore((state) => state.follow);
  const showOnChart = useCycleStore((state) => state.showOnChart);
  const setFollow = useCycleStore((state) => state.setFollow);
  const setShowOnChart = useCycleStore((state) => state.setShowOnChart);
  const { symbol } = useSymbolContext();

  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sliderPosition, setSliderPosition] = useState(() => speedToSlider(cursor?.barsPerSecond ?? 40));
  const speedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (cursor) setSliderPosition(speedToSlider(cursor.barsPerSecond));
  }, [cursor?.barsPerSecond]);

  useEffect(() => {
    return () => {
      if (speedTimerRef.current) clearTimeout(speedTimerRef.current);
    };
  }, []);

  const running = status === "running";
  const isStarting = status === "starting" || starting;
  const paused = cursor?.paused ?? false;
  const validation = validateCycleForm(formState);

  const handlePlay = useCallback(async () => {
    if (!formState.familyKey || !validateCycleForm(formState).valid) return;
    setStarting(true);
    try {
      await startCycle({
        modelType: formState.familyKey,
        symbol,
        timeframe: formState.timeframe,
        dateRange: { start: formState.dateStart, end: formState.dateEnd },
        hyperparameters: formState.hyperparameters,
      });
    } finally {
      setStarting(false);
    }
  }, [formState, symbol]);

  const handlePauseResume = useCallback(() => {
    void controlCycle({ command: paused ? "resume" : "pause" });
  }, [paused]);

  const handleStop = useCallback(() => {
    setStopping(true);
    stopCycle();
  }, []);

  useEffect(() => {
    if (status !== "running") setStopping(false);
  }, [status]);

  const commitSpeed = useCallback((position: number) => {
    setSliderPosition(position);
    if (speedTimerRef.current) clearTimeout(speedTimerRef.current);
    speedTimerRef.current = setTimeout(() => {
      const barsPerSecond = position >= SPEED_SLIDER_MAX ? 0 : sliderToSpeed(position);
      void controlCycle({ command: "pace", barsPerSecond });
    }, SPEED_DEBOUNCE_MILLISECONDS);
  }, []);

  const handleMaxToggle = useCallback(
    (checked: boolean) => {
      commitSpeed(checked ? SPEED_SLIDER_MAX : speedToSlider(40));
    },
    [commitSpeed],
  );

  // Space toggles pause/resume while this panel has focus, unless a form
  // control (input/textarea/select) is what actually has focus.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      if (!running) return;
      event.preventDefault();
      handlePauseResume();
    },
    [running, handlePauseResume],
  );

  const isMax = sliderPosition >= SPEED_SLIDER_MAX;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 outline-none"
    >
      {!running && !isStarting ? (
        <Button
          type="button"
          onClick={() => void handlePlay()}
          disabled={!formState.familyKey || !validation.valid}
          title={!validation.valid ? validation.errors.join(" ") : "Start the cycle"}
          className="gap-2 bg-[#E69F00] text-black hover:bg-[#E69F00]/90 disabled:opacity-40"
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          Play
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handlePauseResume}
            disabled={isStarting}
            className="gap-2"
          >
            {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleStop}
            disabled={stopping}
            className="gap-2 border-[#D55E00]/50 text-[#D55E00] hover:bg-[#D55E00]/10"
          >
            <Square className="h-4 w-4" aria-hidden="true" />
            {stopping ? "Stopping…" : "Stop"}
          </Button>
        </div>
      )}

      <div className="flex min-w-[220px] items-center gap-2">
        <Gauge className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
        <Slider
          className="w-32"
          min={0}
          max={SPEED_SLIDER_MAX}
          step={1}
          value={[sliderPosition]}
          onValueChange={(vals) => commitSpeed(vals[0] ?? sliderPosition)}
          disabled={!running || isMax}
        />
        <span className="w-20 shrink-0 font-mono text-[11px] text-neutral-400">
          {isMax ? "max" : `${sliderToSpeed(sliderPosition)} bars/s`}
        </span>
        <Label className="flex items-center gap-1 text-[10px] text-neutral-400">
          <Switch checked={isMax} onCheckedChange={handleMaxToggle} disabled={!running} />
          Max
        </Label>
      </div>

      <Label className="flex items-center gap-1.5 text-xs text-neutral-300">
        <Switch checked={follow} onCheckedChange={setFollow} />
        <Compass className="h-3.5 w-3.5" aria-hidden="true" />
        Follow
      </Label>
      <Label className="flex items-center gap-1.5 text-xs text-neutral-300">
        <Switch checked={showOnChart} onCheckedChange={setShowOnChart} />
        {showOnChart ? <Eye className="h-3.5 w-3.5" aria-hidden="true" /> : <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}
        Show on chart
      </Label>

      {paused && running && (
        <span className={cn("rounded-full border border-[#F0E442]/50 bg-[#F0E442]/10 px-2 py-0.5 text-[10px] font-semibold text-[#F0E442]")}>
          PAUSED
        </span>
      )}
    </div>
  );
}
