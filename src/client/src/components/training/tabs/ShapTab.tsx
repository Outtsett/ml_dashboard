/**
 * ShapTab — SHAP feature importance analysis per regime.
 *
 * Renders quality gates (pinned top), global SHAP beeswarm,
 * per-regime feature attribution cards, and importance evolution over time.
 * All sub-components read from useTrainingModelState() internally.
 */

import { QualityGatePanel } from "../analytics/QualityGatePanel";
import { ShapBeeswarm } from "../analytics/ShapBeeswarm";
import { PerRegimeShapCards } from "../analytics/PerRegimeShapCards";
import { ShapEvolution } from "../analytics/ShapEvolution";

export interface ShapTabProps {
  diagnostics: Record<string, any> | null;
  activeModelId: string | null;
}

export function ShapTab({ diagnostics, activeModelId }: ShapTabProps) {
  return (
    <div className="p-5 space-y-4">
      <QualityGatePanel />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ShapBeeswarm />
        <PerRegimeShapCards />
        <ShapEvolution />
      </div>
    </div>
  );
}
