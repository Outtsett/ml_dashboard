/**
 * BetaWeightArea — Stacked area chart of beta weights over iterations.
 *
 * X axis: iteration. Y axis: 0 to 1 (proportion).
 * One area per regime using REGIME_COLORS fill values.
 */

import { memo, useMemo } from "react";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ChartCard } from "./shared";

const REGIME_FILLS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

function BetaWeightAreaInner() {
  const { modelStateHistory } = useTrainingModelState();

  const { chartData, nRegimes } = useMemo(() => {
    if (!modelStateHistory || modelStateHistory.length === 0) {
      return { chartData: [], nRegimes: 0 };
    }

    let maxK = 0;
    for (const entry of modelStateHistory) {
      const bw = entry.state.snapshot.beta_weights;
      if (bw && bw.length > maxK) maxK = bw.length;
    }

    if (maxK === 0) return { chartData: [], nRegimes: 0 };

    const data = modelStateHistory.map((entry) => {
      const bw = entry.state.snapshot.beta_weights ?? [];
      const row: Record<string, number> = { iteration: entry.iteration };
      for (let k = 0; k < maxK; k++) {
        row[`r${k}`] = bw[k] ?? 0;
      }
      return row;
    });

    return { chartData: data, nRegimes: maxK };
  }, [modelStateHistory]);

  const hasData = chartData.length > 0;
  const subtitle = hasData ? `${nRegimes} regimes over ${chartData.length} snapshots` : undefined;

  return (
    <ChartCard
      title="Beta Weights"
      subtitle={subtitle}
      minHeight={200}
    >
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={hasData ? chartData : []} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="iteration"
            tick={{ fontSize: 9, fontFamily: "monospace", fill: "rgba(255,255,255,0.3)" }}
            tickLine={false}
            axisLine={false}
            label={!hasData ? { value: "Iteration", position: "bottom", fontSize: 9, fill: "rgba(255,255,255,0.2)" } : undefined}
          />
          <YAxis
            domain={[0, 1]}
            tick={{ fontSize: 9, fontFamily: "monospace", fill: "rgba(255,255,255,0.3)" }}
            tickLine={false}
            axisLine={false}
            width={32}
            label={!hasData ? { value: "Weight", angle: -90, position: "insideLeft", fontSize: 9, fill: "rgba(255,255,255,0.2)" } : undefined}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(0,0,0,0.9)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              fontSize: 10,
              fontFamily: "monospace",
            }}
          />
          {hasData && Array.from({ length: nRegimes }, (_, k) => (
            <Area
              key={`r${k}`}
              type="monotone"
              dataKey={`r${k}`}
              stackId="beta"
              fill={REGIME_FILLS[k % REGIME_FILLS.length]}
              stroke={REGIME_FILLS[k % REGIME_FILLS.length]}
              fillOpacity={0.7}
              strokeWidth={0.5}
              isAnimationActive={false}
            />
          ))}
          {hasData && (
            <Legend
              verticalAlign="bottom"
              height={24}
              formatter={(value: string) => (
                <span style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
                  {value.replace("r", "Regime ")}
                </span>
              )}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export const BetaWeightArea = memo(BetaWeightAreaInner);
export default BetaWeightArea;
