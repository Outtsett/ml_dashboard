/**
 * ModelHistory — Quality score sparkline with degradation alerts.
 *
 * SRP: Renders quality trajectory only.
 * DIP: Fetches via useModelHistory hook.
 */

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import type { AnalyticsComponentProps } from "./index";
import { CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "@/training/lib/types";
import { ChartCard, EmptyState } from "./shared";
import { useModelHistory } from "@/ml/lib/useModelHistory";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/utils/utils";

const GRADE_COLORS: Record<string, string> = {
  A: "bg-[hsl(var(--data-pos)/0.15)] text-[hsl(var(--data-pos))]",
  B: "bg-blue-500/15 text-blue-400",
  C: "bg-amber-500/15 text-amber-400",
  D: "bg-orange-500/15 text-orange-400",
  F: "bg-[hsl(var(--data-neg)/0.15)] text-[hsl(var(--data-neg))]",
};

function extractModelType(modelId: string): string | null {
  // Format: SYMBOL_TIMEFRAME_MODELTYPE_TIMESTAMP
  // E.g.: ES_1h_primitives-discovery_20260227T143022
  const parts = modelId.split("_");
  if (parts.length < 4) return null;
  // Remove first (symbol), second (timeframe), and last (timestamp)
  return parts.slice(2, -1).join("_");
}

interface HPOSession {
  sessionId: string;
  optimizerType: string;
  modelType: string;
  bestScore: number | null;
  completedTrials: number;
  totalTrials: number;
  status: string;
  startedAt: string;
}

export default function ModelHistory({ diagnostics, modelId }: AnalyticsComponentProps) {
  const modelType = extractModelType(modelId);
  const { data } = useModelHistory(diagnostics.symbol, modelType);

  const { data: hpoSessions } = useQuery<HPOSession[]>({
    queryKey: ["hpo-sessions"],
    queryFn: async () => {
      const res = await fetch("/api/hpo/sessions?limit=20");
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

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
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-[hsl(var(--data-neg)/0.15)] text-[hsl(var(--data-neg))]">
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
          <Line dataKey="score" stroke="#E69F00" dot={{ r: 3 }} strokeWidth={2} name="Quality Score" />
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

      {/* HPO Optimization History */}
      {hpoSessions && hpoSessions.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              HPO Sessions
            </h4>
            <Badge variant="outline" className="text-[9px]">
              {hpoSessions.length}
            </Badge>
          </div>

          {hpoSessions.map(session => (
            <div key={session.sessionId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 border border-white/5 mb-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] capitalize">{session.optimizerType}</Badge>
                <span className="text-xs text-muted-foreground">{session.modelType}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-[hsl(var(--data-pos))]">
                  {session.bestScore != null ? session.bestScore.toFixed(4) : '—'}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {session.completedTrials}/{session.totalTrials} trials
                </span>
                <Badge variant="outline" className={cn(
                  "text-[9px]",
                  session.status === 'completed' ? 'text-[hsl(var(--data-pos))] border-[hsl(var(--data-pos)/0.2)]' :
                  session.status === 'failed' ? 'text-[hsl(var(--data-neg))] border-[hsl(var(--data-neg)/0.2)]' :
                  'text-blue-400 border-blue-500/20'
                )}>
                  {session.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}
