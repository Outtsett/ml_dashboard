/**
 * HeroStrip — Five metric cards displayed as a horizontal strip
 *
 * [Regimes] [Stability] — [Quality Ring] — [Match] [Model Fit]
 *
 * Shows live metrics during training, falls back to diagnostics when idle.
 */

import { Progress } from "@/components/ui/progress";
import { Flame } from "lucide-react";
import type {
  TrainingProgress, LiveMetrics, ConvergencePoint,
  WalkForwardWindow, OOSResult, Diagnostics,
} from "./types";
import {
  getRegimeColor, getRegimeVerdict, getStabilityVerdict,
  getOosVerdict, getQualityLabel, getQualityVerdict,
  getLLConvergenceVerdict, getFitVerdict, getFitLevel,
} from "./types";
import { Sparkline, PendingValue, FitGauge, MiniProgress, QualityScoreRing } from "./MicroComponents";

interface DerivedMetrics {
  quality: number;
  regimes: number;
  stability: number;
  oos: number;
  profileCorr: number;
  ll: number;
  activeStates: number;
  elapsedSec: number;
}

interface HeroStripProps {
  isTraining: boolean;
  progress: TrainingProgress | null;
  gibbsIter: number;
  gibbsPhase: string;
  isGibbsSampling: boolean;
  isPostGibbs: boolean;
  liveMetrics: LiveMetrics | null;
  liveConvergence: ConvergencePoint[];
  diagnostics: Diagnostics | undefined;
  metrics: DerivedMetrics;
  nBarsForLL: number;
  llPerBar: number;
  convergencePoints: ConvergencePoint[];
  wfWindResults: WalkForwardWindow[];
  oos: OOSResult | undefined;
}

export default function HeroStrip(props: HeroStripProps) {
  const {
    isTraining, liveMetrics, liveConvergence, progress,
    gibbsPhase, isGibbsSampling, isPostGibbs,
    metrics, nBarsForLL, llPerBar,
    convergencePoints, wfWindResults, oos, diagnostics, gibbsIter,
  } = props;

  // Short aliases for readability
  const { quality: qualityScore, regimes: nRegimes, stability: stabilityScore,
    oos: oosSimilarity, profileCorr: profileCorrelation, ll: finalLL, elapsedSec: trainingTimeSec } = metrics;

  return (
    <div className="rounded-2xl border border-white/6 bg-linear-to-br from-white/3 to-transparent backdrop-blur-xl overflow-hidden">
      <div className="flex items-stretch">
        {/* ── Left: Regimes + WF Stability ── */}
        <div className="flex-1 flex">
          {/* Regimes */}
          <div className="flex-1 p-5 cursor-help border-r border-white/4" title="How many distinct market moods the model found. During Gibbs sampling, this is the live active state count.">
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-2">
              {isGibbsSampling && !liveMetrics?.regimesDiscovered ? 'Active States' : 'Regimes'}
            </div>
            <div className={`text-5xl font-bold font-mono leading-none mb-2 transition-all duration-500 ${isGibbsSampling && !liveMetrics?.regimesDiscovered ? 'text-amber-400' : 'text-orange-400'}`}>
              {nRegimes > 0 ? nRegimes : isTraining ? <span className="animate-pulse text-orange-400/20">—</span> : '--'}
            </div>
            <div className="flex gap-0.5 mb-2">
              {Array.from({ length: Math.max(nRegimes, 9) }, (_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full ${i < nRegimes ? getRegimeColor(i).bg : 'bg-white/5'}`} />
              ))}
            </div>
            <p className={`text-[11px] leading-relaxed ${isGibbsSampling && !liveMetrics?.regimesDiscovered ? 'text-amber-400/80' : getRegimeVerdict(nRegimes).color}`}>
              {isGibbsSampling && !liveMetrics?.regimesDiscovered
                ? `Gibbs sampler pruning — started with 30, now using ${nRegimes}`
                : getRegimeVerdict(nRegimes).text}
            </p>
          </div>

          {/* WF Stability */}
          <div className="flex-1 p-5 cursor-help border-r border-white/4" title="Walk-forward test — data split into 5 time windows, each trains on 60% and tests on 40%. High = same regimes found everywhere. Low = results change with different data.">
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-2">Walk-Forward</div>
            <div className={`text-5xl font-bold font-mono leading-none mb-2 transition-all duration-700 ${stabilityScore > 0 ? 'text-emerald-400 scale-100' : isTraining ? 'text-emerald-400/20' : 'text-emerald-400'}`}>
              {stabilityScore > 0 ? `${(stabilityScore * 100).toFixed(0)}%` : isTraining ? (
                <PendingValue color="text-emerald-400/40" label={isPostGibbs ? 'computing' : 'pending'} />
              ) : '--'}
            </div>
            <div className="flex gap-1 items-end h-5 mb-2">
              {(wfWindResults.length > 0 ? wfWindResults : Array.from({ length: 5 }, () => ({ avg_confidence: 0, failed: false }))).map((w, i) => {
                const conf = w.avg_confidence ? w.avg_confidence * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className={`w-full rounded-sm ${wfWindResults.length > 0 ? (w.failed ? 'bg-rose-500/50' : 'bg-emerald-500/40') : 'bg-white/5'}`}
                      style={{ height: `${Math.max(conf * 0.2, 2)}px` }} />
                    <span className="text-[7px] text-muted-foreground/40">W{i + 1}</span>
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
        </div>

        {/* ── Center: Quality Ring ── */}
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
              <span className="text-3xl font-bold font-mono text-muted-foreground/20">--</span>
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

        {/* ── Right: OOS Match + Model Fit ── */}
        <div className="flex-1 flex">
          {/* OOS Match */}
          <div className="flex-1 p-5 cursor-help border-r border-white/4" title="Out-of-sample match — does the model behave the same on data it's never seen? 90%+ = excellent generalization.">
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-2">OOS Match</div>
            <div className={`text-5xl font-bold font-mono leading-none mb-2 transition-all duration-700 ${oosSimilarity > 0 ? 'text-cyan-400 scale-100' : isTraining ? 'text-cyan-400/20' : 'text-cyan-400'}`}>
              {oosSimilarity > 0 ? `${(oosSimilarity * 100).toFixed(0)}%` : isTraining ? (
                <PendingValue color="text-cyan-400/40" label={isPostGibbs && gibbsPhase === 'oos_evaluation' ? 'computing' : 'pending'} />
              ) : '--'}
            </div>
            <div className="flex items-center gap-3 mb-2">
              <div className="text-[10px] text-muted-foreground/50">
                <span className="text-foreground/60 font-mono">{profileCorrelation > 0 ? profileCorrelation.toFixed(2) : '--'}</span> profile corr
              </div>
              <div className="text-[10px] text-muted-foreground/50">
                <span className="text-foreground/60 font-mono">{oos?.switch_rate_ratio ? oos.switch_rate_ratio.toFixed(2) : '--'}x</span> switch
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

          {/* Model Fit (LL per bar) */}
          <div className="flex-1 p-5 cursor-help" title="Log-likelihood per bar = how well the model explains each candle. Think of it as a grade: -2 to -4 = great fit, -5 to -7 = decent, -8+ = poor. The number is always negative because it's a log-probability. Higher (closer to 0) = better.">
            <div className="text-[10px] text-muted-foreground/60 uppercase tracking-widest mb-2">
              {isTraining && liveMetrics?.gibbsIter ? `Gibbs ${liveMetrics.gibbsIter}/${liveMetrics.gibbsTotal}` : 'Model Fit'}
            </div>
            <div className={`text-4xl font-bold font-mono text-violet-400 leading-none mb-2 truncate transition-all duration-500`}>
              {llPerBar !== 0 ? llPerBar.toFixed(2) : isTraining ? <span className="animate-pulse text-violet-400/20">—</span> : '--'}
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
                ) : isTraining && progress ? `${progress.pct.toFixed(0)}%` : '--'}
              </span>
              {diagnostics && (
                <span className="text-[9px] text-muted-foreground/40 font-mono">
                  {diagnostics.n_bars_total?.toLocaleString()} bars {'\u00B7'} {diagnostics.training_config?.gibbs_iter || gibbsIter} iter
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Progress bar during training */}
      {isTraining && progress && (
        <div className="px-5 pb-3">
          <Progress value={progress.pct} className="h-1 [&>div]:bg-orange-500" />
        </div>
      )}
    </div>
  );
}
