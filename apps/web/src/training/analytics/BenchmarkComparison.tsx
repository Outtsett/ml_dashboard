/**
 * BenchmarkComparison — Cumulative return curves for regime strategy vs baselines.
 *
 * SRP: Renders benchmark comparison chart only.
 * DIP: Fetches its own data via useQuery from /api/training/models/:id/benchmarks.
 */

import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import type { BenchmarkResult } from "@/training/lib/types";
import { CHART_GRID, CHART_AXIS, CHART_TOOLTIP } from "@/training/lib/types";
import { ChartCard, EmptyState } from "./shared";

export default function BenchmarkComparison({ diagnostics: _diagnostics, modelId }: AnalyticsComponentProps) {
  const { data } = useQuery<BenchmarkResult | null>({
    queryKey: ["benchmarks", modelId],
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/benchmarks`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!modelId,
    staleTime: 60_000,
  });

  if (!data) {
    return (
      <ChartCard title="Benchmark Comparison" className="lg:col-span-2">
        <EmptyState message="No benchmark data" hint="Need ≥200 bars for SMA crossover baseline" />
      </ChartCard>
    );
  }

  // Downsample for rendering (max 500 points)
  const step = Math.max(1, Math.floor(data.dates.length / 500));
  const chartData = data.dates
    .filter((_, i) => i % step === 0 || i === data.dates.length - 1)
    .map((date, idx) => {
      const i = idx * step >= data.dates.length ? data.dates.length - 1 : idx * step;
      return {
        date: date.split("T")[0],
        buyAndHold: +((data.buyAndHold.cumulative[i] ?? 0) * 100).toFixed(2),
        sma: +((data.smaCrossover.cumulative[i] ?? 0) * 100).toFixed(2),
      };
    });

  const bnh = (data.buyAndHold.totalReturn * 100).toFixed(1);
  const smaRet = (data.smaCrossover.totalReturn * 100).toFixed(1);

  return (
    <ChartCard
      title="Benchmark Comparison"
      subtitle={`B&H: ${bnh}% \u00b7 SMA: ${smaRet}%`}
      className="lg:col-span-2"
    >
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid {...CHART_GRID} />
          <XAxis dataKey="date" {...CHART_AXIS} interval="preserveStartEnd" />
          <YAxis {...CHART_AXIS} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v.toFixed(1)}%`} />
          <Legend wrapperStyle={{ fontSize: 9 }} />
          <Line dataKey="buyAndHold" name="Buy & Hold" stroke="#E69F00" dot={false} strokeWidth={1.5} />
          <Line dataKey="sma" name="SMA 50/200" stroke="#f59e0b" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
