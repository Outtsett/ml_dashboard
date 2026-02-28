/**
 * LiveTrainingDashboard — Adaptive grid composing live training panels.
 *
 * Panels render based on what metrics the SSE stream provides (OCP).
 * IterationMetrics always shows. Other panels appear when their data arrives.
 *
 * 1 panel  → full width
 * 2 panels → 1x2
 * 3 panels → 2+1 (top row: 2, bottom row: 1 spanning)
 * 4 panels → 2x2
 */
import { useMemo, type ReactNode } from "react";
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

  // Detect which panels have data
  const hasConvergence = (iterationHistory?.length ?? 0) > 0
    && iterationHistory?.some(h => h.metrics.logLikelihood != null);
  const hasRegimeCount = (iterationHistory?.length ?? 0) > 0
    && iterationHistory?.some(h => h.metrics.activeStates != null);
  const hasTransitionMatrix = !!(overlay?.transition_matrix ?? diag?.transition_matrix);

  // Build panel list dynamically
  const panels = useMemo(() => {
    const items: { key: string; node: ReactNode }[] = [];

    if (hasConvergence) {
      items.push({
        key: "convergence",
        node: (
          <ConvergenceChart
            iterationHistory={iterationHistory || []}
            burnIn={(config?.hyperparameters?.burnIn as number) ?? 100}
            isTraining={isTraining}
          />
        ),
      });
    }

    if (hasRegimeCount) {
      items.push({
        key: "regimeCount",
        node: (
          <RegimeCountTracker
            iterationHistory={iterationHistory || []}
            isTraining={isTraining}
          />
        ),
      });
    }

    if (hasTransitionMatrix) {
      items.push({
        key: "transitionMatrix",
        node: (
          <TransitionMatrixHeatmap
            matrix={(overlay?.transition_matrix ?? diag?.transition_matrix) as number[][] | null ?? null}
            nRegimes={typeof (overlay?.n_regimes ?? diag?.n_regimes) === 'number'
              ? (overlay?.n_regimes ?? diag?.n_regimes) as number : 0}
            regimeLabels={overlay?.labels as Record<string, string> | undefined}
            regimeColors={overlay?.colors as Record<string, string> | undefined}
          />
        ),
      });
    }

    // IterationMetrics always shows
    items.push({
      key: "iterationMetrics",
      node: (
        <IterationMetrics
          isTraining={isTraining}
          progress={progress ?? 0}
          phase={phase ?? ''}
          iterationHistory={iterationHistory || []}
          elapsedSec={elapsedSec ?? 0}
        />
      ),
    });

    return items;
  }, [hasConvergence, hasRegimeCount, hasTransitionMatrix, iterationHistory, config, isTraining, overlay, diag, progress, phase, elapsedSec]);

  // Adaptive grid: 1→1col, 2→2col, 3→2col+span, 4→2x2
  const gridClass = panels.length <= 1
    ? "grid grid-cols-1"
    : "grid grid-cols-2";

  return (
    <div className="h-full border border-white/5 rounded-xl overflow-hidden bg-black/20">
      <div className={`${gridClass} h-full min-h-0`}>
        {panels.map((panel, i) => {
          // Last panel spans full width if odd count
          const isLastOdd = panels.length > 1 && panels.length % 2 === 1 && i === panels.length - 1;
          const hasRight = !isLastOdd && (i % 2 === 0) && i + 1 < panels.length;
          const isTopRow = panels.length > 2 ? i < 2 : true;

          return (
            <div
              key={panel.key}
              className={`
                ${isLastOdd ? 'col-span-2' : ''}
                ${hasRight ? 'border-r border-white/5' : ''}
                ${isTopRow && panels.length > 2 ? 'border-b border-white/5' : ''}
              `}
            >
              {panel.node}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ConvergenceChart } from "./ConvergenceChart";
export { RegimeCountTracker } from "./RegimeCountTracker";
export { TransitionMatrixHeatmap } from "./TransitionMatrixHeatmap";
export { IterationMetrics } from "./IterationMetrics";
