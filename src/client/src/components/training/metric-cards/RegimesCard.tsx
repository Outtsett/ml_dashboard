/**
 * RegimesCard — How many distinct market moods the model found.
 */

import type { LiveMetrics } from "../types";
import { getRegimeColor, getRegimeVerdict } from "../types";

interface RegimesCardProps {
  nRegimes: number;
  isTraining: boolean;
  isGibbsSampling: boolean;
  liveMetrics: LiveMetrics | null;
}

export function RegimesCard({ nRegimes, isTraining, isGibbsSampling, liveMetrics }: RegimesCardProps) {
  const isLivePruning = isGibbsSampling && !liveMetrics?.regimesDiscovered;

  return (
    <div className="flex-1 p-5 cursor-help border-r border-white/4" title="How many distinct market moods the model found. During Gibbs sampling, this is the live active state count.">
      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-2">
        {isLivePruning ? 'Active States' : 'Regimes'}
      </div>
      <div className={`text-5xl font-bold font-mono leading-none mb-2 transition-all duration-500 ${isLivePruning ? 'text-amber-400' : 'text-orange-400'}`}>
        {nRegimes > 0 ? nRegimes : isTraining ? <span className="animate-pulse text-orange-400/20">—</span> : '--'}
      </div>
      <div className="flex gap-0.5 mb-2">
        {Array.from({ length: Math.max(nRegimes, 9) }, (_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i < nRegimes ? getRegimeColor(i).bg : 'bg-white/5'}`} />
        ))}
      </div>
      <p className={`text-[11px] leading-relaxed ${isLivePruning ? 'text-amber-400/80' : getRegimeVerdict(nRegimes).color}`}>
        {isLivePruning
          ? `Gibbs sampler pruning — started with 30, now using ${nRegimes}`
          : getRegimeVerdict(nRegimes).text}
      </p>
    </div>
  );
}
