/**
 * useTrainingSync — Live training status for the chart banner.
 *
 * Think of it as: a heads-up display on the chart that shows "the model is
 * working." No replay auto-play — the full chart stays visible so you can
 * watch regimes stabilize in real-time as the Gibbs sampler iterates.
 * After training, you can optionally scrub through with replay.
 *
 * Model-agnostic: works with any model type via TrainingState.
 */

import { useMemo } from 'react';
import { REGIME_COLORS } from '@/components/training/types';
import type { TrainingState } from '@shared/trainingTypes';

export interface RegimeLegendEntry {
  id: number;
  color: string;
  barCount: number;
}

export interface TrainingSyncResult {
  /** Whether training is active on the chart's symbol */
  isActive: boolean;
  /** Current training phase label */
  trainingPhase: string;
  /** Number of active regimes discovered so far */
  activeRegimes: number;
  /** Regime color legend data for the banner */
  regimeLegend: RegimeLegendEntry[];
  /** Current iteration (epoch, Gibbs iter, etc.) */
  gibbsIter: number;
  /** Total iterations */
  gibbsTotal: number;
  /** Assignment stability: fraction of bars that didn't change since last overlay (0-1) */
  stability: number;
}

export function useTrainingSync(
  training: TrainingState,
  chartSymbol: string,
): TrainingSyncResult {
  const symbolMatch = (training.config?.symbol ?? '').toUpperCase() === chartSymbol.toUpperCase();
  const isActive = training.isTraining && symbolMatch;

  // Compute regime legend from live assignments
  const regimeLegend = useMemo((): RegimeLegendEntry[] => {
    const assignments = training.liveRegimeAssignments;
    if (!assignments.length) return [];
    const counts = new Map<number, number>();
    for (const r of assignments) {
      counts.set(r, (counts.get(r) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([id, barCount]) => ({
        id,
        color: REGIME_COLORS[id % REGIME_COLORS.length]!.fill,
        barCount,
      }));
  }, [training.liveRegimeAssignments]);

  // Extract iteration metrics from training state
  const lastIter = training.iterationHistory.at(-1);

  // Stability metric from Python (emitted as "assignment_stability")
  const stability = training.metrics.assignment_stability ?? 0;

  return {
    isActive,
    trainingPhase: training.phase || '',
    activeRegimes: training.metrics.activeStates ?? 0,
    regimeLegend,
    gibbsIter: lastIter?.iteration ?? 0,
    gibbsTotal: (lastIter?.metrics?.totalIterations as number) ?? 0,
    stability,
  };
}
