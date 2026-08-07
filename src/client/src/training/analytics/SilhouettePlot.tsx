/**
 * SilhouettePlot — Cluster separation quality summary.
 *
 * SRP: Renders evaluation cluster metrics only.
 */

import { useState } from "react";
import type { AnalyticsComponentProps } from "./index";
import { ChartCard, EmptyState } from "./shared";

const METRIC_INFO: Record<string, { description: string; good: string; bad: string }> = {
  silhouette_score: {
    description: "Measures how similar each bar is to its own regime vs other regimes. Think of it as: how clearly does each market mood stand out?",
    good: "> 0.2 means regimes are meaningfully different",
    bad: "< 0.2 means regime boundaries are fuzzy",
  },
  calinski_harabasz: {
    description: "Ratio of between-regime variance to within-regime variance. Think of it as: are regime centers far apart compared to the noise within each?",
    good: "> 10 means well-separated regime centers",
    bad: "< 10 means regimes overlap too much",
  },
  davies_bouldin: {
    description: "Average similarity between each regime and its most similar neighbor. Think of it as: do any two regimes look confusingly alike?",
    good: "< 1.5 means each regime is distinct",
    bad: "> 1.5 means some regimes could be merged",
  },
};

export default function SilhouettePlot({ diagnostics }: AnalyticsComponentProps) {
  const evaluation = diagnostics.evaluation;
  const stage1 = evaluation?.stage1;
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);

  if (!stage1) {
    return (
      <ChartCard title="Cluster Quality Metrics">
        <EmptyState message="No evaluation data" hint="Evaluation runs automatically after training" />
      </ChartCard>
    );
  }

  const metrics = [
    {
      key: "silhouette_score" as const,
      name: "Silhouette",
      value: stage1.silhouette_score?.value ?? 0,
      passed: stage1.silhouette_score?.passed ?? false,
      description: "Higher = better-separated clusters",
    },
    {
      key: "calinski_harabasz" as const,
      name: "Calinski-Harabasz",
      value: Math.min(stage1.calinski_harabasz?.value ?? 0, 200),
      passed: stage1.calinski_harabasz?.passed ?? false,
      description: "Higher = denser, well-separated",
    },
    {
      key: "davies_bouldin" as const,
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
          <div
            key={m.key}
            className="cursor-pointer"
            onClick={() => setExpandedMetric(expandedMetric === m.key ? null : m.key)}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium">{m.name}</span>
              <div className="flex items-center gap-1.5">
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                  m.passed ? "bg-[hsl(var(--data-pos)/0.15)] text-[hsl(var(--data-pos))]" : "bg-[hsl(var(--data-neg)/0.15)] text-[hsl(var(--data-neg))]"
                }`}>
                  {m.value.toFixed(3)} {m.passed ? "PASS" : "FAIL"}
                </span>
                <span className="text-[8px] text-muted-foreground/30">
                  {expandedMetric === m.key ? "\u25BE" : "\u25B8"}
                </span>
              </div>
            </div>
            <div className="text-[8px] text-muted-foreground/30">{m.description}</div>
          </div>
        ))}
      </div>

      {expandedMetric && METRIC_INFO[expandedMetric] && (
        <div className="bg-white/[0.02] rounded-lg p-3 mt-2 text-[9px] space-y-1">
          <p className="text-muted-foreground/60">{METRIC_INFO[expandedMetric].description}</p>
          <p className="text-[hsl(var(--data-pos)/0.6)]">{"\u2713"} {METRIC_INFO[expandedMetric].good}</p>
          <p className="text-[hsl(var(--data-neg)/0.6)]">{"\u2717"} {METRIC_INFO[expandedMetric].bad}</p>
        </div>
      )}
    </ChartCard>
  );
}
