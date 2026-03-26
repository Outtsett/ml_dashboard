/**
 * MetricScorecard — Grid of metric value cards with sparklines and status colors.
 *
 * 4-column grid. Each card: metric name, current value (large), status dot, mini sparkline.
 * Pulls cluster_quality metrics + regime count from modelState, history from modelStateHistory.
 */

import { memo, useMemo } from "react";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { ChartCard } from "./shared";

const STATUS_COLORS: Record<string, string> = {
  pass: "#22c55e",
  warn: "#eab308",
  fail: "#ef4444",
};

interface MetricDef {
  key: string;
  label: string;
  /** Extract the value from a model state snapshot */
  extract: (snap: any) => number | null;
  /** Format for display */
  format: (v: number) => string;
  /** Quality gate metric name to look up status color */
  gateKey?: string;
}

const METRICS: MetricDef[] = [
  {
    key: "silhouette",
    label: "Silhouette",
    extract: (s) => s.cluster_quality?.silhouette ?? null,
    format: (v) => v.toFixed(3),
    gateKey: "silhouette",
  },
  {
    key: "calinski_harabasz",
    label: "Calinski-Harabasz",
    extract: (s) => s.cluster_quality?.calinski_harabasz ?? null,
    format: (v) => v.toFixed(1),
    gateKey: "calinski_harabasz",
  },
  {
    key: "davies_bouldin",
    label: "Davies-Bouldin",
    extract: (s) => s.cluster_quality?.davies_bouldin ?? null,
    format: (v) => v.toFixed(3),
    gateKey: "davies_bouldin",
  },
  {
    key: "ari_vs_previous",
    label: "ARI vs Previous",
    extract: (s) => s.cluster_quality?.ari_vs_previous ?? null,
    format: (v) => v.toFixed(3),
    gateKey: "ari_vs_previous",
  },
  {
    key: "n_regimes",
    label: "Regimes",
    extract: (s) => s.regime_profiles?.length ?? null,
    format: (v) => String(Math.round(v)),
  },
  {
    key: "avg_dwell",
    label: "Avg Dwell",
    extract: (s) => {
      const profiles = s.regime_profiles as Array<{ mean_dwell: number; bar_count: number }> | undefined;
      if (!profiles || profiles.length === 0) return null;
      const totalBars = profiles.reduce((acc, p) => acc + p.bar_count, 0);
      if (totalBars === 0) return null;
      return profiles.reduce((acc, p) => acc + p.mean_dwell * p.bar_count, 0) / totalBars;
    },
    format: (v) => v.toFixed(1),
  },
];

function MetricScorecardInner() {
  const { modelState, modelStateHistory } = useTrainingModelState();

  // Build sparkline data: last 20 values per metric from history
  const sparklines = useMemo(() => {
    const result: Record<string, number[]> = {};
    if (!modelStateHistory || modelStateHistory.length === 0) return result;

    const recent = modelStateHistory.slice(-20);
    for (const def of METRICS) {
      result[def.key] = recent
        .map((entry) => def.extract(entry.state.snapshot))
        .filter((v): v is number => v !== null);
    }
    return result;
  }, [modelStateHistory]);

  const snap = modelState?.snapshot ?? null;
  const gateMap = new Map(
    (snap?.quality_gates ?? []).map((g) => [g.metric, g.status])
  );

  const iterLabel = modelState
    ? `Iteration ${modelState.iteration}/${modelState.total}`
    : undefined;

  return (
    <ChartCard title="Metrics" subtitle={iterLabel} minHeight={80}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {METRICS.map((def) => {
          const value = snap ? def.extract(snap) : null;
          const status = def.gateKey ? gateMap.get(def.gateKey) : undefined;
          const dotColor = status ? STATUS_COLORS[status] ?? "#6b7280" : "#6b7280";
          const spark = sparklines[def.key] ?? [];

          return (
            <div
              key={def.key}
              className="bg-white/[0.02] rounded-lg border border-white/5 px-3 py-2"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: dotColor }}
                />
                <span className="text-[9px] font-mono text-muted-foreground/50 truncate">
                  {def.label}
                </span>
              </div>

              <div className="flex items-end justify-between gap-2">
                <span
                  className="text-sm font-mono font-semibold"
                  style={{ color: dotColor }}
                >
                  {value !== null ? def.format(value) : "\u2014"}
                </span>

                {spark.length >= 2 && (
                  <div className="w-16 h-[30px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={spark.map((v, i) => ({ i, v }))}
                        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
                      >
                        <Line
                          type="monotone"
                          dataKey="v"
                          stroke={dotColor}
                          strokeWidth={1.5}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

export const MetricScorecard = memo(MetricScorecardInner);
export default MetricScorecard;
