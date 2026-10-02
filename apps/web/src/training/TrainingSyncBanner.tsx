/**
 * TrainingSyncBanner — Compact training status shown alongside replay controls.
 *
 * Think of it as: a label on the replay bar that says "this replay is driven
 * by training" plus shows the Gibbs iteration progress and regime color key.
 */

import { Flame } from "lucide-react";
import type { RegimeLegendEntry } from "@/training/lib/useTrainingSync";

interface TrainingSyncBannerProps {
  gibbsIter: number;
  gibbsTotal: number;
  activeRegimes: number;
  regimeLegend: RegimeLegendEntry[];
  trainingPhase: string;
  stability: number;
}

export function TrainingSyncBanner({
  gibbsIter,
  gibbsTotal,
  activeRegimes,
  regimeLegend,
  trainingPhase,
  stability,
}: TrainingSyncBannerProps) {
  const progress = gibbsTotal > 0 ? (gibbsIter / gibbsTotal) * 100 : 0;
  const isGibbs = trainingPhase === 'gibbs_sampling';
  const stabilityPct = Math.round(stability * 100);
  const stabilityColor = stabilityPct >= 95 ? 'text-[hsl(var(--data-pos))]' : stabilityPct >= 85 ? 'text-amber-400' : 'text-[hsl(var(--data-neg))]';
  const stabilityBarColor = stabilityPct >= 95 ? 'bg-[hsl(var(--data-pos))]' : stabilityPct >= 85 ? 'bg-amber-500' : 'bg-[hsl(var(--data-neg))]';

  return (
    <div className="flex items-center gap-2.5 text-[10px] font-mono shrink-0">
      {/* Sync indicator */}
      <div className="flex items-center gap-1 text-orange-400">
        <Flame className="h-3 w-3 animate-pulse" />
        <span className="font-semibold">Training</span>
      </div>

      <div className="w-px h-3.5 bg-white/10" />

      {/* Phase / Iteration */}
      {isGibbs ? (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Iter</span>
          <span className="text-foreground">{gibbsIter}/{gibbsTotal}</span>
          <div className="w-14 h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-linear-to-r from-orange-500 to-[hsl(var(--data-neg))] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <span className="text-muted-foreground capitalize">{trainingPhase.replace(/_/g, ' ')}</span>
      )}

      <div className="w-px h-3.5 bg-white/10" />

      {/* Regime count + color dots */}
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">{activeRegimes}R</span>
        {regimeLegend.slice(0, 8).map((r) => (
          <div
            key={r.id}
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: r.color }}
            title={`R${r.id}: ${r.barCount.toLocaleString()} bars`}
          />
        ))}
      </div>

      {/* Stability indicator — only show once Gibbs has started emitting it */}
      {stability > 0 && (
        <>
          <div className="w-px h-3.5 bg-white/10" />
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Stability</span>
            <span className={stabilityColor}>{stabilityPct}%</span>
            <div className="w-10 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${stabilityBarColor}`}
                style={{ width: `${stabilityPct}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
