/**
 * useTrainingSync — Auto-activates chart replay when training starts.
 *
 * Think of it as: hitting "play" on the chart DVR the moment you click Train.
 * The chart replays through bars like the market is unfolding live, and as the
 * model discovers regimes, those colors paint onto the candles in real time.
 * When training finishes, replay stops and you see the full picture.
 *
 * Model-agnostic: works with any model type via TrainingState.
 */

import { useEffect, useRef, useMemo } from 'react';
import { REGIME_COLORS } from '@/components/training/types';
import type { PlaybackSpeed } from '@/hooks/useLocalReplay';
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
}

export function useTrainingSync(
  training: TrainingState,
  chartSymbol: string,
  replay: {
    active: boolean;
    state: string;
    toggleReplay: () => void;
    play: () => void;
    changeSpeed: (speed: PlaybackSpeed) => void;
  },
): TrainingSyncResult {
  const prevActivePhaseRef = useRef(false);
  const autoActivatedRef = useRef(false);

  const symbolMatch = (training.config?.symbol ?? '').toUpperCase() === chartSymbol.toUpperCase();
  const isActive = training.isTraining && symbolMatch;

  // Active phases where chart replay should auto-start
  const isActivePhase = isActive && ['gibbs_sampling', 'training', 'walk_forward', 'oos_evaluation'].includes(training.phase);

  // Auto-start replay when active phase begins
  useEffect(() => {
    if (isActivePhase && !prevActivePhaseRef.current) {
      if (!replay.active) {
        replay.toggleReplay();
      }
      setTimeout(() => {
        replay.changeSpeed(50 as PlaybackSpeed);
        replay.play();
      }, 100);
      autoActivatedRef.current = true;
    }

    prevActivePhaseRef.current = isActivePhase;
  }, [isActivePhase, replay]);

  // Auto-stop replay when training finishes
  useEffect(() => {
    if (!training.isTraining && autoActivatedRef.current) {
      if (replay.active) {
        replay.toggleReplay();
      }
      autoActivatedRef.current = false;
    }
  }, [training.isTraining, replay]);

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

  return {
    isActive,
    trainingPhase: training.phase || '',
    activeRegimes: training.metrics.activeStates ?? 0,
    regimeLegend,
    gibbsIter: lastIter?.iteration ?? 0,
    gibbsTotal: (lastIter?.metrics?.totalIterations as number) ?? 0,
  };
}
