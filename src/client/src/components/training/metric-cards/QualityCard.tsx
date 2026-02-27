/**
 * QualityCard — Central quality ring display.
 */

import { Flame } from "lucide-react";
import type { LiveMetrics } from "../types";
import { getQualityLabel, getQualityVerdict } from "../types";
import { QualityScoreRing } from "../MicroComponents";

interface QualityCardProps {
  qualityScore: number;
  isTraining: boolean;
  isGibbsSampling: boolean;
  liveMetrics: LiveMetrics | null;
}

export function QualityCard({ qualityScore, isTraining, isGibbsSampling, liveMetrics }: QualityCardProps) {
  return (
    <div className="w-52 shrink-0 flex flex-col items-center justify-center p-5 border-r border-white/4 bg-white/1" title="Overall quality (0-100). Combines stability, generalization, profile correlation, and regime balance.">
      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-3">Quality</div>
      {qualityScore > 0 ? (
        <QualityScoreRing score={qualityScore} size={96} />
      ) : isTraining && liveMetrics ? (
        <div className="w-24 h-24 rounded-full border-2 border-orange-500/20 flex flex-col items-center justify-center animate-pulse">
          <Flame className="h-6 w-6 text-orange-400/60 mb-1" />
          <span className="text-[9px] text-orange-400/60 font-medium">
            {isGibbsSampling ? `iter ${liveMetrics.gibbsIter}` : 'Processing'}
          </span>
        </div>
      ) : (
        <div className="w-24 h-24 rounded-full border-2 border-white/5 flex items-center justify-center">
          <span className="text-3xl font-bold font-mono text-muted-foreground/20">{'\u2014'}</span>
        </div>
      )}
      <div className={`text-[10px] font-medium mt-3 px-2.5 py-1 rounded-full ${
        qualityScore >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
        qualityScore >= 60 ? 'bg-amber-500/15 text-amber-400' :
        qualityScore >= 40 ? 'bg-orange-500/15 text-orange-400' :
        isTraining ? 'bg-orange-500/10 text-orange-400/70' :
        'bg-white/5 text-muted-foreground'
      }`}>
        {qualityScore > 0 ? getQualityLabel(qualityScore) : isTraining ? 'Training' : 'Awaiting'}
      </div>
      <p className={`text-[10px] text-center leading-relaxed mt-2 ${qualityScore > 0 ? getQualityVerdict(qualityScore).color : isTraining ? 'text-orange-400/60' : getQualityVerdict(qualityScore).color}`}>
        {qualityScore > 0 ? getQualityVerdict(qualityScore).text : isTraining ? 'Computed after all phases complete' : getQualityVerdict(qualityScore).text}
      </p>
    </div>
  );
}
