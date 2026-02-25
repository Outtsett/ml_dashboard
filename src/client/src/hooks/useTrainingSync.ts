/**
 * useTrainingSync — Auto-activates chart replay when training starts.
 *
 * Think of it as: hitting "play" on the chart DVR the moment you click Train.
 * The chart replays through bars like the market is unfolding live, and as the
 * model discovers regimes, those colors paint onto the candles in real time.
 * When training finishes, replay stops and you see the full picture.
 *
 * Two variants:
 * - useTrainingSync(): Original HDP-HMM-specific hook (backward compatible)
 * - useUniversalTrainingSync(): Model-agnostic hook for the universal pipeline
 */

import { useEffect, useRef, useMemo } from 'react';
import type { TrainingState } from '@/components/training/types';
import { REGIME_COLORS } from '@/components/training/types';
import type { PlaybackSpeed } from '@/hooks/useLocalReplay';
import type { UniversalTrainingState } from '@shared/trainingTypes';

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
  /** Current Gibbs iteration */
  gibbsIter: number;
  /** Total Gibbs iterations */
  gibbsTotal: number;
}

export function useTrainingSync(
  regime: TrainingState,
  chartSymbol: string,
  replay: {
    active: boolean;
    state: string;
    toggleReplay: () => void;
    play: () => void;
    changeSpeed: (speed: PlaybackSpeed) => void;
  },
): TrainingSyncResult {
  const prevGibbsSamplingRef = useRef(false);
  const autoActivatedRef = useRef(false);

  const symbolMatch = regime.selectedSymbol === chartSymbol;
  const isActive = regime.isTraining && symbolMatch;

  // Auto-start replay when Gibbs sampling begins
  useEffect(() => {
    const isGibbs = regime.isGibbsSampling && symbolMatch;

    if (isGibbs && !prevGibbsSamplingRef.current) {
      // Gibbs just started — activate replay at high speed
      if (!replay.active) {
        replay.toggleReplay();
      }
      // Small delay to let replay initialize, then play at 50x
      setTimeout(() => {
        replay.changeSpeed(50 as PlaybackSpeed);
        replay.play();
      }, 100);
      autoActivatedRef.current = true;
    }

    prevGibbsSamplingRef.current = isGibbs;
  }, [regime.isGibbsSampling, symbolMatch, replay]);

  // Auto-stop replay when training finishes
  useEffect(() => {
    if (!regime.isTraining && autoActivatedRef.current) {
      if (replay.active) {
        replay.toggleReplay(); // turns off replay, shows all data
      }
      autoActivatedRef.current = false;
    }
  }, [regime.isTraining, replay]);

  // Compute regime legend from live assignments
  const regimeLegend = useMemo((): RegimeLegendEntry[] => {
    const assignments = regime.liveRegimeAssignments;
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
  }, [regime.liveRegimeAssignments]);

  return {
    isActive,
    trainingPhase: regime.gibbsPhase || '',
    activeRegimes: regime.liveMetrics?.activeStates ?? 0,
    regimeLegend,
    gibbsIter: regime.liveMetrics?.gibbsIter ?? 0,
    gibbsTotal: regime.liveMetrics?.gibbsTotal ?? 0,
  };
}

// ─── Universal Training Sync (model-agnostic) ───────────────────────────────

export interface UniversalTrainingSyncResult {
  isActive: boolean;
  trainingPhase: string;
  progress: number;
  modelType: string | null;
}

/**
 * Model-agnostic training sync. Triggers chart replay for ANY model type
 * when training enters the 'training' phase (Gibbs sampling, epoch training, etc.)
 */
export function useUniversalTrainingSync(
  training: UniversalTrainingState,
  chartSymbol: string,
  replay: {
    active: boolean;
    state: string;
    toggleReplay: () => void;
    play: () => void;
    changeSpeed: (speed: PlaybackSpeed) => void;
  },
): UniversalTrainingSyncResult {
  const prevTrainingRef = useRef(false);
  const autoActivatedRef = useRef(false);

  // Training is active and on the same symbol
  const isActive = training.isTraining && training.config?.symbol?.toUpperCase() === chartSymbol.toUpperCase();

  // Auto-start replay when training phase is active (gibbs_sampling, training, etc.)
  const isActivePhase = isActive && ['gibbs_sampling', 'training', 'walk_forward', 'oos_evaluation'].includes(training.phase);

  useEffect(() => {
    if (isActivePhase && !prevTrainingRef.current) {
      if (!replay.active) {
        replay.toggleReplay();
      }
      setTimeout(() => {
        replay.changeSpeed(50 as PlaybackSpeed);
        replay.play();
      }, 100);
      autoActivatedRef.current = true;
    }

    prevTrainingRef.current = isActivePhase;
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

  return {
    isActive,
    trainingPhase: training.phase,
    progress: training.progress,
    modelType: training.modelType,
  };
}
