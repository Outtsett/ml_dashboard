/**
 * useTrainingMetrics — Derives display-ready metrics from training state + diagnostics.
 *
 * Extracted from Training.tsx (SRP): the page component renders layout,
 * this hook owns the data transformation from raw training state to
 * the metric shape consumed by HeroStrip and other sub-components.
 */

import { useMemo } from "react";
import type { TrainingState } from "@shared/trainingTypes";
import type {
  LiveMetrics, ConvergencePoint, TrainingProgress,
  WalkForwardWindow, OOSResult, Diagnostics,
} from "@/components/training/types";
import { INITIAL_LIVE_METRICS } from "@/components/training/types";

export interface DerivedMetrics {
  quality: number;
  regimes: number;
  stability: number;
  oos: number;
  profileCorr: number;
  ll: number;
  activeStates: number;
  elapsedSec: number;
}

export interface TrainingMetricsResult {
  isTraining: boolean;
  liveMetrics: LiveMetrics | null;
  liveConvergence: ConvergencePoint[];
  progress: TrainingProgress | null;
  gibbsPhase: string;
  isGibbsSampling: boolean;
  isPostGibbs: boolean;
  metrics: DerivedMetrics;
  nBarsForLL: number;
  llPerBar: number;
  convergencePoints: ConvergencePoint[];
  wfWindResults: WalkForwardWindow[];
  oos: OOSResult | undefined;
  gibbsIter: number;
}

export function useTrainingMetrics(
  training: Pick<TrainingState, 'isTraining' | 'config' | 'iterationHistory' | 'metrics' | 'totalBars' | 'phase' | 'progress' | 'logs' | 'elapsedSec'>,
  diagnostics: Diagnostics | undefined,
  convergenceData: { gibbs?: ConvergencePoint[] } | null | undefined,
): TrainingMetricsResult {
  const isTraining = training.isTraining;
  const gibbsIter = (training.config?.hyperparameters as Record<string, number>)?.gibbsIter ?? 200;

  // Build LiveMetrics from universal metrics (Record<string, number>)
  const liveMetrics: LiveMetrics | null = isTraining ? {
    ...INITIAL_LIVE_METRICS,
    gibbsIter: training.iterationHistory.at(-1)?.iteration ?? 0,
    gibbsTotal: (training.iterationHistory.at(-1)?.metrics?.totalIterations as number) ?? gibbsIter,
    logLikelihood: training.metrics.logLikelihood ?? 0,
    activeStates: training.metrics.activeStates ?? 0,
    delta: training.metrics.delta ?? 0,
    fitPerBar: training.metrics.fitPerBar ?? 0,
    entropy: training.metrics.entropy ?? 0,
    switchRate: training.metrics.switchRate ?? 0,
    selfTransition: training.metrics.selfTransition ?? 0,
    maxRegimePct: training.metrics.maxRegimePct ?? 0,
    avgDwell: training.metrics.avgDwell ?? 0,
    nBarsTotal: training.totalBars ?? 0,
    regimesDiscovered: training.metrics.regimes_discovered ?? 0,
    stability: training.metrics.stability ?? 0,
    oosSimilarity: training.metrics.oos_similarity ?? 0,
    oosCorrelation: training.metrics.oos_correlation ?? 0,
    qualityScore: training.metrics.quality_score ?? 0,
    elapsed: training.elapsedSec,
  } : null;

  const liveConvergence: ConvergencePoint[] = training.iterationHistory.map(h => ({
    iter: h.iteration,
    log_likelihood: h.metrics.logLikelihood ?? 0,
    n_active_states: h.metrics.activeStates,
    delta: h.metrics.delta,
    entropy: h.metrics.entropy,
    switch_rate: h.metrics.switchRate,
    self_transition: h.metrics.selfTransition,
    max_regime_pct: h.metrics.maxRegimePct,
    avg_dwell: h.metrics.avgDwell,
  }));

  // Build progress from universal state
  const progress: TrainingProgress | null = isTraining ? {
    step: Math.round(training.progress),
    totalSteps: 100,
    phase: training.phase,
    message: training.logs.at(-1) ?? '',
    pct: training.progress,
  } : null;

  // Phase detection
  const gibbsPhase = training.phase || '';
  const isGibbsSampling = isTraining && gibbsPhase === 'gibbs_sampling';
  const isPostGibbs = isTraining && ['walk_forward', 'oos_evaluation', 'analyzing', 'saving'].includes(gibbsPhase);

  // Derived metrics (live during training, from diagnostics when idle)
  const metrics = useMemo((): DerivedMetrics => {
    if (isTraining && liveMetrics != null) return {
      quality: liveMetrics.qualityScore,
      regimes: liveMetrics.regimesDiscovered || liveMetrics.activeStates,
      stability: liveMetrics.stability,
      oos: liveMetrics.oosSimilarity,
      profileCorr: liveMetrics.oosCorrelation,
      ll: liveMetrics.logLikelihood,
      activeStates: liveMetrics.activeStates,
      elapsedSec: liveMetrics.elapsed,
    };
    if (!isTraining && diagnostics) return {
      quality: diagnostics.quality_score ?? 0,
      regimes: diagnostics.n_regimes ?? 0,
      stability: diagnostics.walk_forward?.stability_score ?? 0,
      oos: diagnostics.out_of_sample?.distribution_similarity ?? 0,
      profileCorr: diagnostics.out_of_sample?.avg_profile_correlation ?? 0,
      ll: diagnostics.convergence_summary?.final_log_likelihood ?? 0,
      activeStates: diagnostics.convergence_summary?.final_active_states ?? 0,
      elapsedSec: diagnostics.training_time_sec ?? 0,
    };
    return { quality: 0, regimes: 0, stability: 0, oos: 0, profileCorr: 0, ll: 0, activeStates: 0, elapsedSec: 0 };
  }, [isTraining, liveMetrics, diagnostics]);

  const nBarsForLL = (isTraining && liveMetrics?.nBarsTotal) ? liveMetrics.nBarsTotal : diagnostics?.n_bars_total || 1;
  const llPerBar = metrics.ll !== 0 ? metrics.ll / nBarsForLL : 0;
  const convergencePoints: ConvergencePoint[] = liveConvergence.length > 0 && !convergenceData ? liveConvergence : (convergenceData?.gibbs || []);
  const wfWindResults = diagnostics?.walk_forward?.window_results || [];
  const oos = diagnostics?.out_of_sample;

  return {
    isTraining,
    liveMetrics,
    liveConvergence,
    progress,
    gibbsPhase,
    isGibbsSampling,
    isPostGibbs,
    metrics,
    nBarsForLL,
    llPerBar,
    convergencePoints,
    wfWindResults,
    oos,
    gibbsIter,
  };
}
