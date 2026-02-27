/**
 * OOSCard — Out-of-sample match metric.
 */

import type { OOSResult } from "../types";
import { getOosVerdict } from "../types";
import { PendingValue } from "../MicroComponents";

interface OOSCardProps {
  oosSimilarity: number;
  profileCorrelation: number;
  oos: OOSResult | undefined;
  isTraining: boolean;
  isGibbsSampling: boolean;
  isPostGibbs: boolean;
  gibbsPhase: string;
}

export function OOSCard({ oosSimilarity, profileCorrelation, oos, isTraining, isGibbsSampling, isPostGibbs, gibbsPhase }: OOSCardProps) {
  return (
    <div className="flex-1 p-5 cursor-help border-r border-white/4" title="Out-of-sample match — does the model behave the same on data it's never seen? 90%+ = excellent generalization.">
      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-2">OOS Match</div>
      <div className={`text-5xl font-bold font-mono leading-none mb-2 transition-all duration-700 ${oosSimilarity > 0 ? 'text-cyan-400 scale-100' : isTraining ? 'text-cyan-400/20' : 'text-cyan-400'}`}>
        {oosSimilarity > 0 ? `${(oosSimilarity * 100).toFixed(0)}%` : isTraining ? (
          <PendingValue color="text-cyan-400/40" label={isPostGibbs && gibbsPhase === 'oos_evaluation' ? 'computing' : 'pending'} />
        ) : <span className="text-cyan-400/20">{'\u2014'}</span>}
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="text-[10px] text-muted-foreground/50">
          <span className="text-foreground/60 font-mono">{profileCorrelation > 0 ? profileCorrelation.toFixed(2) : '\u2014'}</span> profile corr
        </div>
        <div className="text-[10px] text-muted-foreground/50">
          <span className="text-foreground/60 font-mono">{oos?.switch_rate_ratio ? oos.switch_rate_ratio.toFixed(2) : '\u2014'}x</span> switch
        </div>
      </div>
      <p className={`text-[11px] leading-relaxed ${oosSimilarity > 0
        ? getOosVerdict(oosSimilarity).color
        : isGibbsSampling ? 'text-muted-foreground/60' : isPostGibbs ? 'text-cyan-400/60 animate-pulse' : getOosVerdict(oosSimilarity).color
      }`}>
        {oosSimilarity > 0
          ? getOosVerdict(oosSimilarity).text
          : isGibbsSampling ? 'Runs after walk-forward completes'
          : isPostGibbs ? 'Evaluating out-of-sample performance...'
          : getOosVerdict(oosSimilarity).text}
      </p>
    </div>
  );
}
