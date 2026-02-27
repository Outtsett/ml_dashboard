/**
 * LiveTrainingDashboard — Grid layout composing live training panels.
 *
 * ┌───────────────┬───────────────┐
 * │ Convergence   │ Regime Count  │
 * │ Chart         │ Tracker       │
 * ├───────────────┼───────────────┤
 * │ Transition    │ Iteration     │
 * │ Matrix        │ Metrics       │
 * └───────────────┴───────────────┘
 *
 * Only renders when training is active. Reads from TrainingContext.
 */
import { useTrainingContext } from "@/contexts/TrainingContext";
import { ConvergenceChart } from "./ConvergenceChart";
import { RegimeCountTracker } from "./RegimeCountTracker";
import { TransitionMatrixHeatmap } from "./TransitionMatrixHeatmap";
import { IterationMetrics } from "./IterationMetrics";

export function LiveTrainingDashboard() {
  const training = useTrainingContext();

  if (!training.isTraining && !training.completedModelId) return null;

  // Safe cast — diagnostics shape is model-dependent
  const diag = training.diagnostics as Record<string, unknown> | null;
  const overlay = training.overlayData?.payload as Record<string, unknown> | undefined;

  return (
    <div className="border border-white/5 rounded-lg overflow-hidden bg-black/20">
      <div className="grid grid-cols-2 grid-rows-2" style={{ height: '360px' }}>
        {/* Top-left: Convergence */}
        <div className="border-r border-b border-white/5">
          <ConvergenceChart
            iterationHistory={training.iterationHistory || []}
            burnIn={(training.config?.hyperparameters?.burnIn as number) ?? 100}
            isTraining={training.isTraining}
          />
        </div>

        {/* Top-right: Regime Count */}
        <div className="border-b border-white/5">
          <RegimeCountTracker
            iterationHistory={training.iterationHistory || []}
            isTraining={training.isTraining}
          />
        </div>

        {/* Bottom-left: Transition Matrix */}
        <div className="border-r border-white/5">
          <TransitionMatrixHeatmap
            matrix={(overlay?.transition_matrix ?? diag?.transition_matrix) as number[][] | null ?? null}
            nRegimes={typeof (overlay?.n_regimes ?? diag?.n_regimes) === 'number'
              ? (overlay?.n_regimes ?? diag?.n_regimes) as number : 0}
            regimeLabels={overlay?.labels as Record<string, string> | undefined}
            regimeColors={overlay?.colors as Record<string, string> | undefined}
          />
        </div>

        {/* Bottom-right: Iteration Metrics */}
        <div>
          <IterationMetrics
            isTraining={training.isTraining}
            progress={training.progress ?? 0}
            phase={training.phase ?? ''}
            iterationHistory={training.iterationHistory || []}
            elapsedSec={training.elapsedSec ?? 0}
          />
        </div>
      </div>
    </div>
  );
}

export { ConvergenceChart } from "./ConvergenceChart";
export { RegimeCountTracker } from "./RegimeCountTracker";
export { TransitionMatrixHeatmap } from "./TransitionMatrixHeatmap";
export { IterationMetrics } from "./IterationMetrics";
