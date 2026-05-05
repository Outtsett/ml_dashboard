/**
 * ModelStateTab — Transition matrix, emission heatmap, and model internals.
 *
 * Renders quality gates pinned at top, followed by emission heatmap,
 * animated transition matrix, beta weight area, centroid scatter, and parameter traces.
 */

import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { QualityGatePanel } from "../analytics/QualityGatePanel";
import { EmissionHeatmap } from "../analytics/EmissionHeatmap";
import { TransitionMatrixHeatmap } from "../live/TransitionMatrixHeatmap";
import { BetaWeightArea } from "../analytics/BetaWeightArea";
import { RegimeCentroidScatter } from "../analytics/RegimeCentroidScatter";
import { ParameterTraces } from "../analytics/ParameterTraces";

export interface ModelStateTabProps {
  diagnostics: Record<string, any> | null;
  activeModelId: string | null;
}

export function ModelStateTab({ diagnostics, activeModelId }: ModelStateTabProps) {
  const { modelState } = useTrainingModelState();

  const transitionMatrix = modelState?.snapshot?.transition_matrix ?? null;
  const nRegimes = transitionMatrix?.length ?? 0;

  return (
    <div className="space-y-4 p-4">
      <QualityGatePanel />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <EmissionHeatmap />
        <div className="bg-black/20 border border-white/5 rounded-xl overflow-hidden min-h-[200px]">
          <TransitionMatrixHeatmap
            matrix={transitionMatrix}
            nRegimes={nRegimes}
            animate
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BetaWeightArea />
        <RegimeCentroidScatter />
      </div>

      <ParameterTraces />
    </div>
  );
}
