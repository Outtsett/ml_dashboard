/**
 * ClusterScatter — 2D scatter of regime centroids in feature space.
 *
 * SRP: Renders scatter plot of regime positions only.
 */

import { useMemo } from "react";
import { ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { getRegimeColor, CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "@/training/lib/types";
import { ChartCard, EmptyState } from "./shared";

export default function ClusterScatter({ diagnostics }: AnalyticsComponentProps) {
  const { regime_stats } = diagnostics;

  const { data, xFeature, yFeature } = useMemo(() => {
    if (!regime_stats?.length) return { data: [], xFeature: "", yFeature: "" };

    const allFeatures = new Set<string>();
    for (const rs of regime_stats) {
      if (rs.characteristics) {
        for (const k of Object.keys(rs.characteristics)) allFeatures.add(k);
      }
    }

    const features = Array.from(allFeatures);
    const variances = features.map(f => {
      const vals = regime_stats.map(rs => rs.characteristics?.[f] ?? 0);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
      return { feature: f, variance };
    }).sort((a, b) => b.variance - a.variance);

    const xF = variances[0]?.feature || "return_1";
    const yF = variances[1]?.feature || "volatility_10";

    const pts = regime_stats.map((rs, i) => ({
      x: rs.characteristics?.[xF] ?? 0,
      y: rs.characteristics?.[yF] ?? 0,
      label: rs.label,
      pct: rs.pct,
      idx: i,
    }));

    return { data: pts, xFeature: xF, yFeature: yF };
  }, [regime_stats]);

  if (data.length < 2) {
    return (
      <ChartCard title="Cluster Scatter">
        <EmptyState message="Need at least 2 regimes" />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Cluster Scatter" subtitle={`${xFeature} vs ${yFeature} (highest cross-regime variance)`}>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart>
          <CartesianGrid {...CHART_GRID} />
          <XAxis
            dataKey="x"
            name={xFeature}
            {...CHART_AXIS}
            type="number"
            label={{ value: xFeature.replace(/_/g, " "), position: "bottom", fontSize: 8, fill: "#888" }}
          />
          <YAxis
            dataKey="y"
            name={yFeature}
            {...CHART_AXIS}
            type="number"
            label={{ value: yFeature.replace(/_/g, " "), angle: -90, position: "left", fontSize: 8, fill: "#888" }}
          />
          <Tooltip
            {...CHART_TOOLTIP}
            content={({ payload }) => {
              const d = payload?.[0]?.payload;
              if (!d) return null;
              return (
                <div className="bg-[hsla(250,25%,14%,0.95)] rounded-lg px-3 py-2 text-[10px] border-none">
                  <div className="font-medium" style={{ color: getRegimeColor(d.idx).fill }}>{d.label}</div>
                  <div className="text-muted-foreground/60">{d.pct.toFixed(1)}% of data</div>
                </div>
              );
            }}
          />
          <Scatter data={data} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={getRegimeColor(d.idx).fill} r={Math.max(6, Math.sqrt(d.pct) * 3)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
