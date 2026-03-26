/**
 * ReturnDistributions — Mean return per regime with volatility error bars.
 *
 * Horizontal bar chart: one bar per regime colored by REGIME_COLORS.
 * Error bars show +/- 1 std dev (volatility). Sharpe ratio annotated per bar.
 * Summary table below with all numeric values.
 */

import { memo, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ErrorBar,
  Cell,
  ReferenceLine,
} from "recharts";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import { ChartCard } from "./shared";

const REGIME_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#a855f7",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

function ReturnDistributionsInner() {
  const { modelState } = useTrainingModelState();

  const { chartData, profiles } = useMemo(() => {
    const profs = modelState?.snapshot.regime_profiles ?? [];
    const sorted = [...profs].sort((a, b) => b.mean_return - a.mean_return);
    const data = sorted.map((p) => ({
      name: `R${p.regime_id}`,
      regime_id: p.regime_id,
      label: p.label,
      mean_return: p.mean_return * 100,
      volatility: p.volatility * 100,
      sharpe: p.sharpe,
      bar_count: p.bar_count,
    }));
    return { chartData: data, profiles: sorted };
  }, [modelState]);

  const hasData = profiles.length > 0;
  const subtitle = hasData ? "Mean return per regime with volatility error bars" : undefined;

  return (
    <ChartCard
      title="Return Distributions"
      subtitle={subtitle}
      className="lg:col-span-2"
      minHeight={200}
    >
      {/* Bar chart */}
      <div style={{ height: Math.max(hasData ? profiles.length * 40 + 40 : 140, 140) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={hasData ? chartData : []}
            layout="vertical"
            margin={{ top: 5, right: 40, left: 10, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.3} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(2)}%`}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip
              contentStyle={{
                fontSize: 10,
                fontFamily: "monospace",
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 6,
              }}
              formatter={(value: number, name: string) => {
                if (name === "mean_return") return [`${value.toFixed(4)}%`, "Mean Return"];
                return [value, name];
              }}
              labelFormatter={(label: string) => {
                const row = chartData.find((d) => d.name === label);
                return row ? `${label} (${row.label})` : label;
              }}
            />
            <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.3} />
            {hasData && (
              <Bar dataKey="mean_return" isAnimationActive={false} barSize={14}>
                {chartData.map((entry) => (
                  <Cell
                    key={entry.regime_id}
                    fill={REGIME_COLORS[entry.regime_id % REGIME_COLORS.length]}
                    fillOpacity={0.7}
                  />
                ))}
                <ErrorBar
                  dataKey="volatility"
                  width={4}
                  stroke="hsl(var(--muted-foreground))"
                  strokeWidth={1}
                  direction="x"
                />
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary table */}
      {hasData && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-muted-foreground/50 border-b border-white/5">
                <th className="text-left py-1 pr-2">Regime</th>
                <th className="text-right py-1 px-2">Return</th>
                <th className="text-right py-1 px-2">Vol</th>
                <th className="text-right py-1 px-2">Sharpe</th>
                <th className="text-right py-1 pl-2">Bars</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((row) => {
                const color = REGIME_COLORS[row.regime_id % REGIME_COLORS.length];
                return (
                  <tr key={row.regime_id} className="border-b border-white/[0.03]">
                    <td className="py-1 pr-2">
                      <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ backgroundColor: color }} />
                      {row.name} <span className="text-muted-foreground/40">{row.label}</span>
                    </td>
                    <td className="text-right py-1 px-2" style={{ color: row.mean_return >= 0 ? "#22c55e" : "#ef4444" }}>
                      {row.mean_return >= 0 ? "+" : ""}{row.mean_return.toFixed(4)}%
                    </td>
                    <td className="text-right py-1 px-2 text-muted-foreground/70">
                      {row.volatility.toFixed(4)}%
                    </td>
                    <td
                      className="text-right py-1 px-2"
                      style={{ color: row.sharpe > 1 ? "#22c55e" : row.sharpe >= 0 ? "#eab308" : "#ef4444" }}
                    >
                      {row.sharpe.toFixed(2)}
                    </td>
                    <td className="text-right py-1 pl-2 text-muted-foreground/70">
                      {row.bar_count.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}

export const ReturnDistributions = memo(ReturnDistributionsInner);
export default ReturnDistributions;
