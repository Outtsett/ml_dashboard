/**
 * ResourceUsage — Training time, speed, and resource summary.
 *
 * SRP: Displays training performance metadata only.
 */

import { Clock, Zap, Database, Calendar } from "lucide-react";
import type { AnalyticsComponentProps } from "./index";
import { ChartCard } from "./shared";

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

export default function ResourceUsage({ diagnostics }: AnalyticsComponentProps) {
  const { training_time_sec, trained_at, n_bars_total, convergence_summary, n_features } = diagnostics;

  const iterPerSec = convergence_summary && training_time_sec > 0
    ? (convergence_summary.n_iterations / training_time_sec).toFixed(1)
    : "\u2014";
  const barsPerSec = n_bars_total && training_time_sec > 0
    ? Math.round(n_bars_total / training_time_sec).toLocaleString()
    : "\u2014";

  const stats = [
    { icon: Clock, label: "Training Time", value: formatDuration(training_time_sec), color: "text-blue-400" },
    { icon: Zap, label: "Speed", value: `${iterPerSec} it/s`, color: "text-amber-400" },
    { icon: Database, label: "Throughput", value: `${barsPerSec} bars/s`, color: "text-cyan-400" },
    { icon: Calendar, label: "Trained", value: trained_at ? new Date(trained_at).toLocaleDateString() : "\u2014", color: "text-violet-400" },
  ];

  return (
    <ChartCard title="Resource Usage" subtitle={`${n_features} features \u00d7 ${n_bars_total?.toLocaleString() ?? "?"} bars`} minHeight={80}>
      <div className="grid grid-cols-2 gap-3 mt-1">
        {stats.map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="flex items-center gap-2 bg-white/[0.02] rounded-lg px-3 py-2">
            <Icon className={`h-3.5 w-3.5 ${color} shrink-0`} />
            <div>
              <div className="text-[8px] text-muted-foreground/40 uppercase">{label}</div>
              <div className={`text-xs font-mono font-medium ${color}`}>{value}</div>
            </div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
