/**
 * OverviewTab — Summary view for training results.
 *
 * Shows quality gates, metric scorecard, and recommendations
 * from the live model state stream.
 */

import { QualityGatePanel } from "../analytics/QualityGatePanel";
import { MetricScorecard } from "../analytics/MetricScorecard";
import { RecommendationEngine } from "../analytics/RecommendationEngine";

export interface OverviewTabProps {
  diagnostics: Record<string, any> | null;
  activeModelId: string | null;
}

export function OverviewTab({ diagnostics, activeModelId }: OverviewTabProps) {
  return (
    <div className="space-y-4 p-4">
      <QualityGatePanel />
      <MetricScorecard />
      <RecommendationEngine />
    </div>
  );
}
