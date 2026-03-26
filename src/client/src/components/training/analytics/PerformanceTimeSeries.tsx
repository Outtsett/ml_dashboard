/**
 * PerformanceTimeSeries — 2x2 grid of cluster quality metrics over iterations.
 *
 * Tracks silhouette, CH, DB, ARI across model state snapshots with reference
 * lines at target thresholds and color-coded status badges.
 */

import { memo, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { ChartCard } from "./shared";

interface MetricDef {
  key: string; label: string; color: string; refLine: number;
  lowerBetter: boolean; thresholds: { green: number; yellow: number };
  format: (v: number) => string;
}

const METRICS: MetricDef[] = [
  { key: "silhouette", label: "Silhouette Score", color: "#3b82f6", refLine: 0.40,
    lowerBetter: false, thresholds: { green: 0.40, yellow: 0.20 }, format: (v) => v.toFixed(3) },
  { key: "calinski_harabasz", label: "Calinski-Harabasz", color: "#a855f7", refLine: 500,
    lowerBetter: false, thresholds: { green: 500, yellow: 100 },
    format: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0) },
  { key: "davies_bouldin", label: "Davies-Bouldin", color: "#f59e0b", refLine: 1.0,
    lowerBetter: true, thresholds: { green: 1.0, yellow: 1.5 }, format: (v) => v.toFixed(3) },
  { key: "ari_vs_previous", label: "ARI vs Previous", color: "#06b6d4", refLine: 0.85,
    lowerBetter: false, thresholds: { green: 0.85, yellow: 0.70 }, format: (v) => v.toFixed(3) },
];

const TOOLTIP_STYLE = {
  fontSize: 10, fontFamily: "monospace",
  backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6,
};

function getStatusColor(value: number | null, def: MetricDef): string {
  if (value === null || value === undefined) return "#6b7280";
  if (def.lowerBetter) {
    if (value < def.thresholds.green) return "#22c55e";
    return value <= def.thresholds.yellow ? "#eab308" : "#ef4444";
  }
  if (value > def.thresholds.green) return "#22c55e";
  return value >= def.thresholds.yellow ? "#eab308" : "#ef4444";
}

type DataPoint = { iteration: number; value: number | null };

function MetricMiniChart({ def, data, currentValue }: {
  def: MetricDef; data: DataPoint[]; currentValue: number | null;
}) {
  const statusColor = getStatusColor(currentValue, def);
  return (
    <div className="bg-white/[0.02] rounded-xl border border-white/5 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
          {def.label}
        </span>
        <span
          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
          style={{ color: statusColor, backgroundColor: `${statusColor}15` }}
        >
          {currentValue != null ? def.format(currentValue) : "---"}
        </span>
      </div>
      <div style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} />
            <XAxis dataKey="iteration" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={36} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [def.format(v), def.label]} />
            <ReferenceLine y={def.refLine} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />
            {data.length > 0 && (
              <Line type="monotone" dataKey="value" stroke={def.color} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PerformanceTimeSeriesInner() {
  const { modelState, modelStateHistory } = useTrainingModelState();

  const { seriesData, currentValues } = useMemo(() => {
    const perMetric: Record<string, DataPoint[]> = {};
    const current: Record<string, number | null> = {};
    for (const def of METRICS) { perMetric[def.key] = []; current[def.key] = null; }

    for (const entry of modelStateHistory) {
      const cq = entry.state.snapshot.cluster_quality;
      if (!cq) continue;
      for (const def of METRICS) {
        const val = cq[def.key as keyof typeof cq];
        perMetric[def.key]!.push({ iteration: entry.iteration, value: typeof val === "number" ? val : null });
      }
    }
    if (modelState?.snapshot.cluster_quality) {
      const cq = modelState.snapshot.cluster_quality;
      for (const def of METRICS) {
        const val = cq[def.key as keyof typeof cq];
        current[def.key] = typeof val === "number" ? val : null;
      }
    }
    return { seriesData: perMetric, currentValues: current };
  }, [modelState, modelStateHistory]);

  return (
    <ChartCard title="Cluster Quality Time Series" subtitle="Metric evolution across Gibbs iterations" className="lg:col-span-2" minHeight={280}>
      <div className="grid grid-cols-2 gap-3">
        {METRICS.map((def) => (
          <MetricMiniChart key={def.key} def={def} data={seriesData[def.key] ?? []} currentValue={currentValues[def.key] ?? null} />
        ))}
      </div>
    </ChartCard>
  );
}

export const PerformanceTimeSeries = memo(PerformanceTimeSeriesInner);
export default PerformanceTimeSeries;
