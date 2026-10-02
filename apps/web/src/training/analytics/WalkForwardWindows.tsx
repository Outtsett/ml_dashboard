/**
 * WalkForwardWindows — Per-window confidence swimlane with quality coloring.
 *
 * SRP: Renders walk-forward window results only.
 */

import { useState, type ComponentProps } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine } from "recharts";
import type { AnalyticsComponentProps } from "./index";
import { CHART_GRID, CHART_AXIS, CHART_TOOLTIP, getRegimeColor } from "@/training/lib/types";
import { ChartCard, EmptyState } from "./shared";

type BarChartClickArgs = Parameters<NonNullable<ComponentProps<typeof BarChart>["onClick"]>>;

export default function WalkForwardWindows({ diagnostics }: AnalyticsComponentProps) {
  const wf = diagnostics.walk_forward;
  const [selectedWindow, setSelectedWindow] = useState<number | null>(null);

  if (!wf?.window_results?.length) {
    return (
      <ChartCard title="Walk-Forward Windows">
        <EmptyState message="No walk-forward data" hint="Enable walk-forward validation during training" />
      </ChartCard>
    );
  }

  const chartData = wf.window_results.map((w) => ({
    name: `W${w.window}`,
    confidence: (w.avg_confidence ?? 0) * 100,
    switchRate: (w.switch_rate ?? 0) * 100,
    failed: w.failed,
  }));

  return (
    <ChartCard
      title="Walk-Forward Windows"
      subtitle={`${wf.n_windows} windows \u00b7 Stability: ${(wf.stability_score * 100).toFixed(0)}%`}
      badge={
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
          wf.stability_score >= 0.7 ? "bg-[hsl(var(--data-pos)/0.15)] text-[hsl(var(--data-pos))]"
          : wf.stability_score >= 0.5 ? "bg-amber-500/15 text-amber-400"
          : "bg-[hsl(var(--data-neg)/0.15)] text-[hsl(var(--data-neg))]"
        }`}>
          {(wf.stability_score * 100).toFixed(0)}%
        </span>
      }
    >
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} barGap={2} onClick={(data: BarChartClickArgs[0]) => {
          if (data?.activeTooltipIndex != null) {
            const idx = data.activeTooltipIndex;
            setSelectedWindow(idx === selectedWindow ? null : idx);
          }
        }}>
          <CartesianGrid {...CHART_GRID} />
          <XAxis dataKey="name" {...CHART_AXIS} />
          <YAxis {...CHART_AXIS} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip {...CHART_TOOLTIP} formatter={(v: number) => `${v.toFixed(1)}%`} />
          <ReferenceLine y={50} stroke="rgba(239, 68, 68, 0.3)" strokeDasharray="3 3" />
          <Bar dataKey="confidence" name="Confidence" radius={[3, 3, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.failed ? "#0072B260" : d.confidence > 70 ? "#E69F0060" : "#f59e0b60"} cursor="pointer" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {selectedWindow !== null && wf.window_results[selectedWindow] && (() => {
        const w = wf.window_results[selectedWindow];
        return (
          <div className="bg-white/[0.02] rounded-xl p-3 border border-white/5 mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-[9px]">
            <div>
              <div className="text-muted-foreground/50">Train size</div>
              <div className="font-mono font-medium">{w.train_size.toLocaleString()} bars</div>
            </div>
            <div>
              <div className="text-muted-foreground/50">Test size</div>
              <div className="font-mono font-medium">{w.test_size.toLocaleString()} bars</div>
            </div>
            <div>
              <div className="text-muted-foreground/50">Switch rate</div>
              <div className="font-mono font-medium">{((w.switch_rate ?? 0) * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-muted-foreground/50">Confidence</div>
              <div className="font-mono font-medium">{((w.avg_confidence ?? 0) * 100).toFixed(1)}%</div>
            </div>
            {w.regime_distribution && (
              <div className="col-span-full">
                <div className="text-muted-foreground/50 mb-1">Regime distribution</div>
                <div className="flex gap-0.5 h-3 rounded-full overflow-hidden">
                  {w.regime_distribution.map((pct: number, i: number) => (
                    <div key={i} style={{ width: `${Math.max(pct * 100, 1)}%`, backgroundColor: getRegimeColor(i).fill }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </ChartCard>
  );
}
