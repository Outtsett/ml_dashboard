/**
 * IterationMetrics — Compact numeric dashboard during training.
 *
 * Shows: current iteration, elapsed time, iterations/sec, ETA, active regimes.
 */
import { useMemo } from "react";
import { Activity, Clock, Gauge, Layers, Timer } from "lucide-react";

interface IterationMetricsProps {
  isTraining: boolean;
  progress: number; // 0-100
  phase: string;
  iterationHistory: Array<{ iteration: number; metrics: Record<string, number> }>;
  elapsedSec: number;
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}

function MetricCard({ icon, label, value, color }: MetricCardProps) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-md" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ color }} className="shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[8px] font-mono text-muted-foreground/50 uppercase tracking-wider">{label}</div>
        <div className="text-sm font-mono font-bold" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}

export function IterationMetrics({ isTraining, progress, phase, iterationHistory, elapsedSec }: IterationMetricsProps) {
  const stats = useMemo(() => {
    if (!iterationHistory.length) return null;

    const latest = iterationHistory[iterationHistory.length - 1]!;
    const currentIter = latest.iteration;

    const iterPerSec = elapsedSec > 0 ? currentIter / elapsedSec : 0;
    const eta = iterPerSec > 0 && progress < 100
      ? ((100 - progress) / 100) * (currentIter / iterPerSec) * (100 / progress)
      : 0;

    const nRegimes = latest.metrics?.num_regimes ?? 0;
    const ll = latest.metrics?.log_likelihood;

    return { currentIter, elapsed: elapsedSec, iterPerSec, eta, nRegimes, ll };
  }, [iterationHistory, elapsedSec, progress]);

  if (!stats) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground/40">
        <p className="text-xs font-mono">Waiting for training...</p>
      </div>
    );
  }

  const formatTime = (sec: number) => {
    if (sec < 60) return `${Math.round(sec)}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
        <span className="text-[10px] font-mono text-amber-400 font-medium">Iteration Metrics</span>
        {isTraining && (
          <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">{phase}</span>
        )}
      </div>
      <div className="flex-1 p-2 grid grid-cols-2 gap-2 content-start">
        <MetricCard
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Iteration"
          value={String(stats.currentIter)}
          color="#f59e0b"
        />
        <MetricCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Elapsed"
          value={formatTime(stats.elapsed)}
          color="#6366f1"
        />
        <MetricCard
          icon={<Gauge className="h-3.5 w-3.5" />}
          label="Speed"
          value={`${stats.iterPerSec.toFixed(1)} it/s`}
          color="#06b6d4"
        />
        <MetricCard
          icon={<Timer className="h-3.5 w-3.5" />}
          label="ETA"
          value={stats.eta > 0 ? formatTime(stats.eta) : "--"}
          color="#8b5cf6"
        />
        <MetricCard
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Regimes"
          value={String(Math.round(stats.nRegimes))}
          color="#a855f7"
        />
        {stats.ll != null && (
          <MetricCard
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Log-Lik"
            value={stats.ll.toFixed(1)}
            color="#3b82f6"
          />
        )}
      </div>
    </div>
  );
}
