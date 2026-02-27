/**
 * HeroStrip — Five metric cards displayed as a horizontal strip.
 *
 * [Regimes] [Stability] — [Quality Ring] — [Match] [Model Fit]
 *
 * Layout orchestrator only — each card is a focused component (SRP).
 */

import { Progress } from "@/components/ui/progress";
import type {
  TrainingProgress, LiveMetrics, ConvergencePoint,
  WalkForwardWindow, OOSResult, Diagnostics,
} from "./types";
import type { DerivedMetrics } from "@/hooks/useTrainingMetrics";
import { RegimesCard, StabilityCard, QualityCard, OOSCard, FitCard } from "./metric-cards";

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

  const { quality: qualityScore, regimes: nRegimes, stability: stabilityScore,
    oos: oosSimilarity, profileCorr: profileCorrelation, ll: finalLL, elapsedSec: trainingTimeSec } = metrics;

  return (
    <div className="rounded-2xl border border-white/6 bg-linear-to-br from-white/3 to-transparent backdrop-blur-xl overflow-hidden">
      <div className="flex items-stretch">
        {/* Left: Regimes + WF Stability */}
        <div className="flex-1 flex">
          <RegimesCard
            nRegimes={nRegimes}
            isTraining={isTraining}
            isGibbsSampling={isGibbsSampling}
            liveMetrics={liveMetrics}
          />
          <StabilityCard
            stabilityScore={stabilityScore}
            isTraining={isTraining}
            isGibbsSampling={isGibbsSampling}
            isPostGibbs={isPostGibbs}
            wfWindResults={wfWindResults}
          />
        </div>

        {/* Center: Quality Ring */}
        <QualityCard
          qualityScore={qualityScore}
          isTraining={isTraining}
          isGibbsSampling={isGibbsSampling}
          liveMetrics={liveMetrics}
        />

        {/* Right: OOS Match + Model Fit */}
        <div className="flex-1 flex">
          <OOSCard
            oosSimilarity={oosSimilarity}
            profileCorrelation={profileCorrelation}
            oos={oos}
            isTraining={isTraining}
            isGibbsSampling={isGibbsSampling}
            isPostGibbs={isPostGibbs}
            gibbsPhase={gibbsPhase}
          />
          <FitCard
            llPerBar={llPerBar}
            finalLL={finalLL}
            nBarsForLL={nBarsForLL}
            trainingTimeSec={trainingTimeSec}
            isTraining={isTraining}
            isGibbsSampling={isGibbsSampling}
            liveMetrics={liveMetrics}
            liveConvergence={liveConvergence}
            convergencePoints={convergencePoints}
            progress={progress}
            diagnostics={diagnostics}
            gibbsIter={gibbsIter}
          />
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
