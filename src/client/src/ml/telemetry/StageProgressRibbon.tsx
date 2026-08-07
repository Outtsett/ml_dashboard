/**
 * StageProgressRibbon — progress and ETA for the active training run.
 *
 * Sits under the metric ticker. Shows the phase, a determinate progress bar,
 * percent complete, elapsed time, and a remaining-time estimate when one can be
 * made honestly (see `eta.ts` — it declines to guess more often than not).
 *
 * Renders nothing when idle. This surface is about a run in flight; a progress
 * bar frozen at 100% after the fact is noise.
 */

import { useEffect, useRef, useState } from "react";
import { useTrainingControl, useTrainingOverlays } from "@/training/lib/TrainingContext";
import { usePrefersReducedMotion } from "@/shared/hooks/useReducedMotion";
import {
  estimateEtaSeconds,
  formatDuration,
  pushSample,
  type ProgressSample,
} from "./eta";

export function StageProgressRibbon({ className = "" }: { className?: string }) {
  const { isTraining, phase, progress } = useTrainingControl();
  const { elapsedSec } = useTrainingOverlays();
  const reducedMotion = usePrefersReducedMotion();

  const [samples, setSamples] = useState<ProgressSample[]>([]);
  // Progress can re-emit at the same value; only a changed value is a sample
  // worth recording, so the effect keys off the value rather than the clock.
  const lastProgress = useRef<number | null>(null);

  useEffect(() => {
    if (!isTraining) {
      lastProgress.current = null;
      setSamples([]);
      return;
    }
    if (!Number.isFinite(progress)) return;
    if (lastProgress.current === progress) return;
    lastProgress.current = progress;
    setSamples((prev) => pushSample(prev, { t: Date.now(), progress }));
  }, [isTraining, progress]);

  if (!isTraining) return null;

  const clamped = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  const etaSeconds = estimateEtaSeconds(samples);

  return (
    <div
      className={`flex items-center gap-3 px-2.5 py-1.5 rounded-lg border border-white/5 bg-white/[0.02] shrink-0 ${className}`}
    >
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground/70 shrink-0">
        {phase || "Training"}
      </span>

      <div
        className="relative flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden min-w-24"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${phase || "Training"} progress`}
      >
        <div
          className={`h-full rounded-full bg-[hsl(var(--data-pos))] ${
            reducedMotion ? "" : "transition-[width] duration-500 ease-out"
          }`}
          style={{ width: `${clamped}%` }}
        />
      </div>

      <span className="metric-value tnum text-[11px] text-foreground shrink-0">
        {clamped.toFixed(0)}%
      </span>

      <span className="text-[10px] font-mono tnum text-muted-foreground shrink-0">
        {formatDuration(elapsedSec)} elapsed
      </span>

      {/* Absent rather than approximate — see eta.ts. */}
      {etaSeconds !== null && (
        <span className="text-[10px] font-mono tnum text-muted-foreground shrink-0">
          ~{formatDuration(etaSeconds)} left
        </span>
      )}
    </div>
  );
}
