/**
 * FitCard — Model fit (log-likelihood per bar) with sparkline convergence.
 */

import { Flame } from "lucide-react";
import type { LiveMetrics, ConvergencePoint, TrainingProgress, Diagnostics } from "../types";
import { getLLConvergenceVerdict, getFitVerdict, getFitLevel } from "../types";
import { Sparkline, FitGauge, MiniProgress } from "../MicroComponents";

interface FitCardProps {
  llPerBar: number;
  finalLL: number;
  nBarsForLL: number;
  trainingTimeSec: number;
  isTraining: boolean;
  isGibbsSampling: boolean;
  liveMetrics: LiveMetrics | null;
  liveConvergence: ConvergencePoint[];
  convergencePoints: ConvergencePoint[];
  progress: TrainingProgress | null;
  diagnostics: Diagnostics | undefined;
  gibbsIter: number;
}

export function FitCard({
  llPerBar, finalLL, nBarsForLL, trainingTimeSec,
  isTraining, liveMetrics, liveConvergence,
  convergencePoints, progress, diagnostics, gibbsIter,
}: FitCardProps) {
  return (
    <div className="flex-1 p-5 cursor-help" title="Log-likelihood per bar = how well the model explains each candle. Think of it as a grade: -2 to -4 = great fit, -5 to -7 = decent, -8+ = poor. The number is always negative because it's a log-probability. Higher (closer to 0) = better.">
      <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-2">
        {isTraining && liveMetrics?.gibbsIter ? `Gibbs ${liveMetrics.gibbsIter}/${liveMetrics.gibbsTotal}` : 'Model Fit'}
      </div>
      <div className="text-4xl font-bold font-mono text-violet-400 leading-none mb-2 truncate transition-all duration-500">
        {llPerBar !== 0 ? llPerBar.toFixed(2) : isTraining ? <span className="animate-pulse text-violet-400/20">{'\u2014'}</span> : <span className="text-violet-400/20">{'\u2014'}</span>}
      </div>
      {finalLL !== 0 && (
        <div className="text-[9px] text-muted-foreground/50 mb-1">
          <span className="font-mono text-violet-400/60">{finalLL.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span> total across {nBarsForLL.toLocaleString()} bars
        </div>
      )}
      {isTraining && liveMetrics?.gibbsIter ? (
        <div className="mb-2">
          {liveConvergence.length > 2 && (
            <Sparkline data={liveConvergence.map(p => p.log_likelihood)} fillColor="hsla(260, 80%, 70%, 0.08)" className="mb-1" />
          )}
          <div className="flex justify-between text-[9px] text-muted-foreground/50 mb-1">
            <span>{'\u0394'} = {liveMetrics.delta.toFixed(1)}</span>
            <span>{liveMetrics.activeStates} states</span>
          </div>
          <MiniProgress value={liveMetrics.gibbsIter} max={liveMetrics.gibbsTotal} />
        </div>
      ) : convergencePoints.length > 1 ? (
        <Sparkline data={convergencePoints.map(p => p.log_likelihood)} className="mb-2" />
      ) : (
        <div className="h-4 mb-2" />
      )}
      {(() => {
        const fitVerdict = isTraining && liveMetrics?.gibbsIter
          ? { text: `Sampling... ${((liveMetrics.gibbsIter / liveMetrics.gibbsTotal) * 100).toFixed(0)}% complete`, color: 'text-violet-400/80' }
          : llPerBar !== 0 ? getFitVerdict(llPerBar)
          : getLLConvergenceVerdict(convergencePoints);
        return <p className={`text-[11px] leading-relaxed ${fitVerdict.color}`}>{fitVerdict.text}</p>;
      })()}
      {llPerBar !== 0 && !isTraining && <FitGauge level={getFitLevel(llPerBar)} />}
      {/* Training time footnote */}
      <div className="mt-3 pt-2 border-t border-white/4 flex items-center gap-2">
        <Flame className={`h-3 w-3 ${isTraining ? 'text-orange-400 animate-pulse' : 'text-muted-foreground/30'}`} />
        <span className="text-xs font-mono text-muted-foreground">
          {trainingTimeSec > 0 ? (
            trainingTimeSec >= 60 ? `${Math.floor(trainingTimeSec / 60)}m ${Math.round(trainingTimeSec % 60)}s` : `${trainingTimeSec.toFixed(0)}s`
          ) : isTraining && progress ? `${progress.pct.toFixed(0)}%` : '\u2014'}
        </span>
        {diagnostics && (
          <span className="text-[9px] text-muted-foreground/40 font-mono">
            {diagnostics.n_bars_total?.toLocaleString()} bars {'\u00B7'} {diagnostics.training_config?.gibbs_iter || gibbsIter} iter
          </span>
        )}
      </div>
    </div>
  );
}
