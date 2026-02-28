/**
 * SilhouettePlot — Cluster separation quality summary.
 *
 * SRP: Renders evaluation cluster metrics only.
 */

import type { AnalyticsComponentProps } from "./index";
import { ChartCard, EmptyState } from "./shared";

export default function SilhouettePlot({ diagnostics }: AnalyticsComponentProps) {
  const evaluation = diagnostics.evaluation;
  const stage1 = evaluation?.stage1;

  if (!stage1) {
    return (
      <ChartCard title="Cluster Quality Metrics">
        <EmptyState message="No evaluation data" hint="Evaluation runs automatically after training" />
      </ChartCard>
    );
  }

  const metrics = [
    {
      name: "Silhouette",
      value: stage1.silhouette_score?.value ?? 0,
      passed: stage1.silhouette_score?.passed ?? false,
      description: "Higher = better-separated clusters",
    },
    {
      name: "Calinski-Harabasz",
      value: Math.min(stage1.calinski_harabasz?.value ?? 0, 200),
      passed: stage1.calinski_harabasz?.passed ?? false,
      description: "Higher = denser, well-separated",
    },
    {
      name: "Davies-Bouldin",
      value: stage1.davies_bouldin?.value ?? 0,
      passed: stage1.davies_bouldin?.passed ?? false,
      description: "Lower = better separation",
    },
  ];

  return (
    <ChartCard title="Cluster Quality Metrics" subtitle="Stage 1 evaluation tests">
      <div className="space-y-3">
        {metrics.map(m => (
          <div key={m.name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium">{m.name}</span>
              <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                m.passed ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
              }`}>
                {m.value.toFixed(3)} {m.passed ? "PASS" : "FAIL"}
              </span>
            </div>
            <div className="text-[8px] text-muted-foreground/30">{m.description}</div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
