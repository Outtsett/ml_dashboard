/**
 * ModelHistory — Quality score sparkline with degradation alerts.
 *
 * SRP: Renders quality trajectory only.
 * DIP: Fetches via useModelHistory hook.
 */

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "../types";
import { ChartCard, EmptyState } from "./shared";
import { useModelHistory } from "@/hooks/useModelHistory";

const GRADE_COLORS: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-400",
  B: "bg-blue-500/15 text-blue-400",
  C: "bg-amber-500/15 text-amber-400",
  D: "bg-orange-500/15 text-orange-400",
  F: "bg-rose-500/15 text-rose-400",
};

function extractModelType(modelId: string): string | null {
  // Format: SYMBOL_TIMEFRAME_MODELTYPE_TIMESTAMP
  // E.g.: ES_1h_hdp-hmm_20260227T143022
  const parts = modelId.split("_");
  if (parts.length < 4) return null;
  // Remove first (symbol), second (timeframe), and last (timestamp)
  return parts.slice(2, -1).join("_");
}

export default function ModelHistory({ diagnostics, modelId }: AnalyticsComponentProps) {
  const modelType = extractModelType(modelId);
  const { data } = useModelHistory(diagnostics.symbol, modelType);

  if (!data?.sessions?.length || data.sessions.length < 2) {
    return (
      <ChartCard title="Model History">
        <EmptyState message="Train multiple sessions to see history" hint="Re-train the same symbol to track quality over time" />
      </ChartCard>
    );
  }

  const sessions = data.sessions.filter(s => s.qualityScore != null);
  if (sessions.length < 2) {
    return (
      <ChartCard title="Model History">
        <EmptyState message="Need at least 2 completed sessions" />
      </ChartCard>
    );
  }

  // Compute 3-session moving average
  const movingAvg: (number | null)[] = sessions.map((s, i) => {
    if (i < 2) return null;
    return (sessions[i - 2]!.qualityScore! + sessions[i - 1]!.qualityScore! + s.qualityScore!) / 3;
  });

  // Detect degradation: current score >15% below moving average
  const latest = sessions[sessions.length - 1]!;
  const latestAvg = movingAvg[movingAvg.length - 1];
  const degraded = latestAvg != null && latest.qualityScore! < latestAvg * 0.85;

  const chartData = sessions.map((s, i) => ({
    name: new Date(s.startedAt).toLocaleDateString(),
    score: s.qualityScore,
    avg: movingAvg[i],
  }));

  return (
    <ChartCard
      title="Model History"
      subtitle={`${sessions.length} sessions for ${diagnostics.symbol}`}
      badge={degraded ? (
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400">
          Score Degrading
        </span>
      ) : null}
    >
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={chartData}>
          <CartesianGrid {...CHART_GRID} />
          <XAxis dataKey="name" {...CHART_AXIS} />
          <YAxis {...CHART_AXIS} domain={[0, 100]} />
          <Tooltip {...CHART_TOOLTIP} />
          <Line dataKey="score" stroke="#10b981" dot={{ r: 3 }} strokeWidth={2} name="Quality Score" />
          <Line dataKey="avg" stroke="#f59e0b60" strokeDasharray="3 3" dot={false} strokeWidth={1} name="3-Session Avg" />
        </LineChart>
      </ResponsiveContainer>

      {/* Grade badges per session */}
      <div className="flex gap-1 mt-2 flex-wrap">
        {sessions.map((s, i) => (
          <span
            key={i}
            className={`text-[8px] px-1.5 py-0.5 rounded ${GRADE_COLORS[s.evaluationGrade || "F"] || GRADE_COLORS.F}`}
          >
            {s.evaluationGrade || "?"}
          </span>
        ))}
      </div>
    </ChartCard>
  );
}
