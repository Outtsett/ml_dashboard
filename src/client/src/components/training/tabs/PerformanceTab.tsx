/**
 * PerformanceTab — Cluster quality metrics, regime profiles, and return distributions.
 *
 * Renders QualityGatePanel (pinned top), PerformanceTimeSeries (2x2 metric grid),
 * RegimeProfileCards, and ReturnDistributions. All components read from
 * useTrainingModelState() context.
 */

import { QualityGatePanel } from "../analytics/QualityGatePanel";
import { PerformanceTimeSeries } from "../analytics/PerformanceTimeSeries";
import { RegimeProfileCards } from "../analytics/RegimeProfileCards";
import { ReturnDistributions } from "../analytics/ReturnDistributions";

export interface PerformanceTabProps {
  diagnostics: Record<string, any> | null;
  activeModelId: string | null;
}

export function PerformanceTab({ diagnostics, activeModelId }: PerformanceTabProps) {
  return (
    <div className="space-y-4 p-4">
      <QualityGatePanel />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PerformanceTimeSeries />
        <RegimeProfileCards />
        <ReturnDistributions />
      </div>
    </div>
  );
}
