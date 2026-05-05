/**
 * useTrainingMetrics — Derives display-ready metrics from training state + diagnostics.
 *
 * Extracted from Training.tsx (SRP): the page component renders layout,
 * this hook owns the data transformation from raw training state to
 * the metric shape consumed by the header badges and sub-components.
 *
 * Model-agnostic: phase names are generic, no model-specific terminology.
 */

import { useMemo } from "react";
import type { TrainingState } from "@shared/trainingTypes";
import type {
  ConvergencePoint, TrainingProgress,
  Diagnostics,
} from "@/components/training/types";

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
  liveConvergence: ConvergencePoint[];
  progress: TrainingProgress | null;
  trainingPhase: string;
  metrics: DerivedMetrics;
  convergencePoints: ConvergencePoint[];
  iterationCount: number;
}

export function useTrainingMetrics(
  training: Pick<TrainingState, 'isTraining' | 'config' | 'iterationHistory' | 'metrics' | 'totalBars' | 'phase' | 'progress' | 'logs' | 'elapsedSec'>,
  diagnostics: Diagnostics | undefined,
  convergenceData: { gibbs?: ConvergencePoint[] } | null | undefined,
): TrainingMetricsResult {
  const isTraining = training.isTraining;
  const iterationCount = (training.config?.hyperparameters as Record<string, number>)?.gibbsIter
    ?? (training.config?.hyperparameters as Record<string, number>)?.emIter
    ?? 200;

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

  // Phase detection (model-agnostic)
  const trainingPhase = training.phase || '';

  // Derived metrics (live during training, from diagnostics when idle)
  const metrics = useMemo((): DerivedMetrics => {
    if (isTraining) return {
      quality: training.metrics.quality_score ?? 0,
      regimes: training.metrics.regimes_discovered ?? training.metrics.activeStates ?? 0,
      stability: training.metrics.stability ?? 0,
      oos: training.metrics.oos_similarity ?? 0,
      profileCorr: training.metrics.oos_correlation ?? 0,
      ll: training.metrics.logLikelihood ?? 0,
      activeStates: training.metrics.activeStates ?? 0,
      elapsedSec: training.elapsedSec,
    };
    if (diagnostics) return {
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
  }, [isTraining, training.metrics, training.elapsedSec, diagnostics]);

  const convergencePoints: ConvergencePoint[] = liveConvergence.length > 0 && !convergenceData ? liveConvergence : (convergenceData?.gibbs || []);

  return {
    isTraining,
    liveConvergence,
    progress,
    trainingPhase,
    metrics,
    convergencePoints,
    iterationCount,
  };
}
