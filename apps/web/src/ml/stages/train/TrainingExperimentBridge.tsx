/**
 * TrainingExperimentBridge — zero-render mount-point for the W4.d
 * useTrainingExperimentBridge() hook.
 *
 * Mount once inside <TrainStage> (alongside the other train children).
 * Renders nothing; the hook dispatches MLStudioContext updates as a side
 * effect of TrainingContext changes.
 */

import { useTrainingExperimentBridge } from "./useTrainingExperimentBridge";

export function TrainingExperimentBridge(): null {
  useTrainingExperimentBridge();
  return null;
}
