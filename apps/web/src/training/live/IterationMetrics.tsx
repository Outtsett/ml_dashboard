/**
 * IterationMetrics — Compact numeric dashboard during training.
 *
 * Shows: current iteration, elapsed time, iterations/sec, ETA, active regimes.
 */
import { useMemo } from "react";
import { RadialGauge } from "@/training/analytics/RadialGauge";
import { useTrainingLive } from "@/training/lib/TrainingContext";

interface IterationMetricsProps {
  isTraining: boolean;
  progress: number; // 0-100
  phase: string;
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;
}

export function IterationMetrics({ isTraining, progress, phase, iterationHistory }: IterationMetricsProps) {
  const { elapsedSec } = useTrainingLive();

  const stats = useMemo(() => {
    if (!iterationHistory.length) return null;

    const latest = iterationHistory[iterationHistory.length - 1]!;
    const currentIter = latest.iteration;

    const iterPerSec = elapsedSec > 0 ? currentIter / elapsedSec : 0;
    // ETA = elapsed * (remaining% / completed%), clamped to avoid explosion at low progress
    const safePct = Math.max(progress, 0.5);
    const eta = iterPerSec > 0 && safePct < 100
      ? elapsedSec * ((100 - safePct) / safePct)
      : 0;

    const nRegimes = latest.metrics?.activeStates ?? 0;
    const ll = latest.metrics?.logLikelihood;

    return { currentIter, elapsed: elapsedSec, iterPerSec, eta, nRegimes, ll };
  }, [iterationHistory, elapsedSec, progress]);

  if (!stats) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground/40">
        <p className="text-xs font-mono">Waiting for training...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <span className="text-[10px] font-mono text-amber-400 font-medium">Iteration Metrics</span>
        {isTraining && (
          <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">{phase}</span>
        )}
      </div>
      <div className="flex-1 p-2 grid grid-cols-2 lg:grid-cols-4 gap-2 content-start overflow-y-auto">
        <RadialGauge
          value={stats.currentIter}
          max={10000}
          label="ITERATION"
          color="#56B4E9"
        />
        <RadialGauge
          value={stats.iterPerSec}
          max={100}
          label="SPEED"
          unit="it/s"
          color="#E69F00"
        />
        <RadialGauge
          value={stats.nRegimes}
          max={50}
          label="REGIMES"
          color="#E69F00"
        />
        <RadialGauge
          value={stats.ll != null ? stats.ll : 0}
          min={-5000}
          max={0}
          label="LOG-LIKELIHOOD"
          color="#0072B2"
        />
      </div>
    </div>
  );
}
