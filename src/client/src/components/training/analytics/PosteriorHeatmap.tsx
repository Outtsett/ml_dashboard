/**
 * PosteriorHeatmap — Regime confidence and entropy over time as a strip heatmap.
 *
 * SRP: Renders posterior confidence visualization only.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor } from "../types";
import { ChartCard, EmptyState } from "./shared";

export default function PosteriorHeatmap({ diagnostics, modelId }: AnalyticsComponentProps) {
  const { data } = useQuery({
    queryKey: ["regimeAssignments", modelId, "posterior"],
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/assignments?limit=500`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!modelId,
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const raw = data?.assignments || data?.rows;
    if (!raw?.length) return [];
    const step = Math.max(1, Math.floor(raw.length / 200));
    return raw.filter((_: any, i: number) => i % step === 0).map((r: any) => ({
      regime: r.regime ?? 0,
      confidence: r.confidence ?? 1,
      entropy: r.entropy ?? 0,
    }));
  }, [data]);

  if (rows.length === 0) {
    return (
      <ChartCard title="Posterior Heatmap">
        <EmptyState message="No posterior data" hint="Requires model assignments with confidence" />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Posterior Heatmap" subtitle={`${rows.length} sampled bars · Color = regime · Opacity = confidence`}>
      <div className="text-[8px] text-muted-foreground/40 mb-1">Regime assignment (opacity = confidence)</div>
      <div className="flex h-6 rounded overflow-hidden border border-white/5">
        {rows.map((r: any, i: number) => {
          const color = getRegimeColor(r.regime);
          return (
            <div
              key={i}
              className="flex-1 min-w-0"
              style={{ backgroundColor: color.fill, opacity: 0.15 + r.confidence * 0.75 }}
              title={`Bar ${i}: Regime ${r.regime}, conf=${(r.confidence * 100).toFixed(0)}%`}
            />
          );
        })}
      </div>

      <div className="text-[8px] text-muted-foreground/40 mb-1 mt-2">Entropy (brighter = more uncertain)</div>
      <div className="flex h-4 rounded overflow-hidden border border-white/5">
        {rows.map((r: any, i: number) => (
          <div
            key={i}
            className="flex-1 min-w-0"
            style={{ backgroundColor: `rgba(245, 158, 11, ${r.entropy * 0.8})` }}
            title={`Bar ${i}: entropy=${r.entropy.toFixed(3)}`}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 mt-2 text-[8px] text-muted-foreground/40">
        {diagnostics.regime_stats.map((rs, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: getRegimeColor(i).fill }} />
            {rs.label}
          </span>
        ))}
      </div>
    </ChartCard>
  );
}
