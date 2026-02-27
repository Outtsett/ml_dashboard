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
import { useTrainingControl, useTrainingLive } from "@/contexts/TrainingContext";
import { ConvergenceChart } from "./ConvergenceChart";
import { RegimeCountTracker } from "./RegimeCountTracker";
import { TransitionMatrixHeatmap } from "./TransitionMatrixHeatmap";
import { IterationMetrics } from "./IterationMetrics";

export function LiveTrainingDashboard() {
  const { isTraining, completedModelId, config, progress, phase } = useTrainingControl();
  const { iterationHistory, overlayData, diagnostics, elapsedSec } = useTrainingLive();

  if (!isTraining && !completedModelId) return null;

  // Safe cast — diagnostics shape is model-dependent
  const diag = diagnostics as Record<string, unknown> | null;
  const overlay = overlayData?.payload as Record<string, unknown> | undefined;

  return (
    <div className="border border-white/5 rounded-xl overflow-hidden bg-black/20">
      <div className="grid grid-cols-2 grid-rows-2 min-h-[280px] max-h-[420px]" style={{ height: 'clamp(280px, 30vw, 420px)' }}>
        {/* Top-left: Convergence */}
        <div className="border-r border-b border-white/5">
          <ConvergenceChart
            iterationHistory={iterationHistory || []}
            burnIn={(config?.hyperparameters?.burnIn as number) ?? 100}
            isTraining={isTraining}
          />
        </div>

        {/* Top-right: Regime Count */}
        <div className="border-b border-white/5">
          <RegimeCountTracker
            iterationHistory={iterationHistory || []}
            isTraining={isTraining}
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
            isTraining={isTraining}
            progress={progress ?? 0}
            phase={phase ?? ''}
            iterationHistory={iterationHistory || []}
            elapsedSec={elapsedSec ?? 0}
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
