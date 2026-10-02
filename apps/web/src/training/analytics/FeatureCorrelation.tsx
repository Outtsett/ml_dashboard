/**
 * FeatureCorrelation — Feature importance heatmap across regimes.
 *
 * SRP: Renders feature x regime characteristic z-scores as a heatmap.
 */

import { useMemo } from "react";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor } from "@/training/lib/types";
import { ChartCard, EmptyState } from "./shared";

export default function FeatureCorrelation({ diagnostics }: AnalyticsComponentProps) {
  const { regime_stats } = diagnostics;

  const { features, matrix } = useMemo(() => {
    if (!regime_stats?.length) return { features: [] as string[], matrix: [] as number[][] };

    const featureSet = new Set<string>();
    for (const rs of regime_stats) {
      if (rs.characteristics) {
        for (const key of Object.keys(rs.characteristics)) featureSet.add(key);
      }
    }
    const features = Array.from(featureSet).slice(0, 15);

    const matrix = features.map(f =>
      regime_stats.map(rs => rs.characteristics?.[f] ?? 0)
    );

    return { features, matrix };
  }, [regime_stats]);

  if (features.length === 0) {
    return (
      <ChartCard title="Feature x Regime Heatmap">
        <EmptyState message="No feature data" hint="Requires regime_stats with characteristics" />
      </ChartCard>
    );
  }

  const maxAbs = Math.max(1, ...matrix.flat().map(Math.abs));

  return (
    <ChartCard title="Feature x Regime Heatmap" subtitle={`${features.length} features \u00b7 ${regime_stats.length} regimes`}>
      <div className="overflow-x-auto">
        <div className="flex">
          <div className="w-28 shrink-0" />
          {regime_stats.map((rs, ci) => {
            const color = getRegimeColor(ci);
            return (
              <div key={ci} className={`flex-1 min-w-[36px] text-center text-[8px] font-mono ${color.text} truncate px-0.5`}>
                {rs.label}
              </div>
            );
          })}
        </div>

        {features.map((feat, ri) => (
          <div key={feat} className="flex items-center">
            <div className="w-28 shrink-0 text-[9px] text-muted-foreground/60 truncate pr-1 text-right font-mono">
              {feat.replace(/_/g, " ")}
            </div>
            {matrix[ri]!.map((val, ci) => {
              const intensity = Math.abs(val) / maxAbs;
              const isPositive = val > 0;
              const bg = isPositive
                ? `rgba(59, 130, 246, ${intensity * 0.6})`
                : `rgba(239, 68, 68, ${intensity * 0.6})`;
              return (
                <div
                  key={ci}
                  className="flex-1 min-w-[36px] h-6 flex items-center justify-center text-[8px] font-mono border border-white/[0.03]"
                  style={{ backgroundColor: bg }}
                  title={`${feat} in ${regime_stats[ci]?.label}: z=${val.toFixed(2)}`}
                >
                  {Math.abs(val) > 0.5 ? val.toFixed(1) : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-center gap-4 mt-2 text-[8px] text-muted-foreground/40">
        <span><span className="inline-block w-3 h-2 rounded-sm mr-1" style={{ backgroundColor: "rgba(59, 130, 246, 0.5)" }} />Positive z-score (above avg)</span>
        <span><span className="inline-block w-3 h-2 rounded-sm mr-1" style={{ backgroundColor: "rgba(239, 68, 68, 0.5)" }} />Negative z-score (below avg)</span>
      </div>
    </ChartCard>
  );
}
