/**
 * TrainTestTimeline — Horizontal bar showing train vs test data ranges.
 *
 * SRP: Renders date range visualization only.
 */

import type { AnalyticsComponentProps } from "./index";
import { ChartCard, EmptyState } from "./shared";

export default function TrainTestTimeline({ diagnostics }: AnalyticsComponentProps) {
  const { date_range, n_bars_total, n_bars_train_val, n_bars_test } = diagnostics;

  if (!date_range?.start) {
    return (
      <ChartCard title="Train / Test Split">
        <EmptyState message="No date range data" />
      </ChartCard>
    );
  }

  const trainPct = n_bars_total && n_bars_train_val ? (n_bars_train_val / n_bars_total * 100) : 85;
  const testPct = n_bars_total && n_bars_test ? (n_bars_test / n_bars_total * 100) : 15;
  const trainEnd = (date_range as any).train_end || "\u2014";
  const testStart = (date_range as any).test_start || "\u2014";

  return (
    <ChartCard title="Train / Test Split" subtitle={`${n_bars_total?.toLocaleString() ?? "?"} total bars`} minHeight={100}>
      <div className="flex h-8 rounded-lg overflow-hidden border border-white/5 mt-2">
        <div
          className="bg-blue-500/30 flex items-center justify-center text-[10px] font-mono text-blue-300"
          style={{ width: `${trainPct}%` }}
        >
          Train {trainPct.toFixed(0)}%
        </div>
        <div
          className="bg-amber-500/30 flex items-center justify-center text-[10px] font-mono text-amber-300"
          style={{ width: `${testPct}%` }}
        >
          Test {testPct.toFixed(0)}%
        </div>
      </div>

      <div className="flex justify-between mt-1.5 text-[9px] text-muted-foreground/50 font-mono">
        <span>{String(date_range.start).split("T")[0]}</span>
        <span className="text-blue-400/60">{String(trainEnd).split("T")[0]} \u2192 {String(testStart).split("T")[0]}</span>
        <span>{String(date_range.end).split("T")[0]}</span>
      </div>

      <div className="flex justify-between mt-1 text-[9px] text-muted-foreground/40">
        <span>{n_bars_train_val?.toLocaleString() ?? "?"} bars</span>
        <span>{n_bars_test?.toLocaleString() ?? "?"} bars</span>
      </div>
    </ChartCard>
  );
}
