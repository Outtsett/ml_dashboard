/**
 * StabilityCard — Walk-forward stability score.
 */

import type { WalkForwardWindow } from "../types";
import { getStabilityVerdict } from "../types";
import { PendingValue } from "../MicroComponents";

interface StabilityCardProps {
  stabilityScore: number;
  isTraining: boolean;
  isGibbsSampling: boolean;
  isPostGibbs: boolean;
  wfWindResults: WalkForwardWindow[];
}

export function StabilityCard({ stabilityScore, isTraining, isGibbsSampling, isPostGibbs, wfWindResults }: StabilityCardProps) {
  return (
    <div className="flex-1 p-5 cursor-help border-r border-white/4" title="Walk-forward test — data split into 5 time windows, each trains on 60% and tests on 40%. High = same regimes found everywhere. Low = results change with different data.">
      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-2">Walk-Forward</div>
      <div className={`text-5xl font-bold font-mono leading-none mb-2 transition-all duration-700 ${stabilityScore > 0 ? 'text-emerald-400 scale-100' : isTraining ? 'text-emerald-400/20' : 'text-emerald-400'}`}>
        {stabilityScore > 0 ? `${(stabilityScore * 100).toFixed(0)}%` : isTraining ? (
          <PendingValue color="text-emerald-400/40" label={isPostGibbs ? 'computing' : 'pending'} />
        ) : <span className="text-emerald-400/20">{'\u2014'}</span>}
      </div>
      <div className="flex gap-1 items-end h-8 mb-2">
        {(wfWindResults.length > 0 ? wfWindResults : Array.from({ length: 5 }, () => ({ avg_confidence: 0, failed: false }))).map((w, i) => {
          const confPct = w.avg_confidence ? w.avg_confidence * 100 : 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
              <div className={`w-full rounded-sm ${wfWindResults.length > 0 ? (w.failed ? 'bg-rose-500/50' : 'bg-emerald-500/40') : 'bg-white/5'}`}
                style={{ height: `${Math.max(confPct * 0.28, 2)}px` }} />
              <span className="text-[9px] text-muted-foreground/40">W{i + 1}</span>
            </div>
          );
        })}
      </div>
      <p className={`text-[11px] leading-relaxed ${stabilityScore > 0
        ? getStabilityVerdict(stabilityScore).color
        : isGibbsSampling ? 'text-muted-foreground/60' : isPostGibbs ? 'text-emerald-400/60 animate-pulse' : getStabilityVerdict(stabilityScore).color
      }`}>
        {stabilityScore > 0
          ? getStabilityVerdict(stabilityScore).text
          : isGibbsSampling ? 'Runs after Gibbs sampling completes'
          : isPostGibbs ? 'Computing walk-forward stability...'
          : getStabilityVerdict(stabilityScore).text}
      </p>
    </div>
  );
}
