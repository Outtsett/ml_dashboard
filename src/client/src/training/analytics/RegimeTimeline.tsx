/**
 * RegimeTimeline — Regime assignments over time with confidence as opacity.
 *
 * SRP: Renders regime zones with signal overlays. Fetches its own data via useQuery.
 * DIP: Uses model assignments API, not raw QuestDB.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "@/training/lib/types";
import { ChartCard, EmptyState } from "./shared";
import type { RegimeAssignmentsResponse, RegimeRow } from "@/ml/lib/useRegimeData";

/** The assignments endpoint responds with `.rows`; `.assignments` is a defensive
 * fallback for an alternate response shape that is never actually sent. */
type AssignmentsResponse = RegimeAssignmentsResponse & { assignments?: RegimeRow[] };

export default function RegimeTimeline({ diagnostics: _diagnostics, modelId }: AnalyticsComponentProps) {
  const { data } = useQuery<AssignmentsResponse | null>({
    queryKey: ["regimeAssignments", modelId, "timeline"],
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/assignments?limit=2000`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!modelId,
    staleTime: 60_000,
  });

  const chartData = useMemo(() => {
    const rows = data?.assignments || data?.rows;
    if (!rows?.length) return [];
    return rows.map((r, i) => ({
      idx: i,
      regime: r.regime,
      confidence: Number(r.confidence ?? 1),
      entropy: Number(r.entropy ?? 0),
      transition_prob: Number(r.transition_prob ?? 0),
    }));
  }, [data]);

  if (chartData.length === 0) {
    return (
      <ChartCard title="Regime Timeline" className="lg:col-span-2">
        <EmptyState message="No assignment data" hint="Train a model to see regime zones" />
      </ChartCard>
    );
  }

  const regimeIds = [...new Set(chartData.map((d) => d.regime))].sort() as number[];

  return (
    <ChartCard
      title="Regime Timeline"
      subtitle={`${chartData.length} bars · ${regimeIds.length} regimes · Opacity = confidence`}
      className="lg:col-span-2"
      minHeight={200}
    >
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={chartData}>
          <CartesianGrid {...CHART_GRID} />
          <XAxis dataKey="idx" {...CHART_AXIS} tickFormatter={() => ""} />
          <YAxis {...CHART_AXIS} domain={[0, 1]} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
          <Tooltip
            {...CHART_TOOLTIP}
            formatter={(v: number, name: string) =>
              name === "confidence" ? `${(v * 100).toFixed(1)}%` : v.toFixed(3)
            }
          />
          <Area
            dataKey="confidence"
            stroke="#3b82f680"
            fill="#3b82f620"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="entropy"
            stroke="#f59e0b60"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="transition_prob"
            stroke="#0072B260"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="flex items-center justify-center gap-4 text-[8px] text-muted-foreground/40 mt-1">
        <span><span className="inline-block w-3 h-1 rounded-sm mr-1 bg-blue-500/40" />Confidence</span>
        <span><span className="inline-block w-3 h-1 rounded-sm mr-1 bg-amber-500/40" />Entropy</span>
        <span><span className="inline-block w-3 h-1 rounded-sm mr-1 bg-[hsl(var(--data-neg)/0.4)]" />Transition Prob</span>
      </div>
    </ChartCard>
  );
}
