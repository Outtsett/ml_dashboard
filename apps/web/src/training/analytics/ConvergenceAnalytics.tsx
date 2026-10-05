/**
 * ConvergenceAnalytics — Multi-metric convergence curves from persisted training data.
 *
 * SRP: Renders convergence metrics. Separate from live ConvergenceChart (which uses SSE).
 * DIP: Reads from diagnostics.convergence_summary (populated by Python training).
 */

import { useState } from "react";
import type { AnalyticsComponentProps } from "./index";
import { ChartCard, EmptyState } from "./shared";

const SERIES = [
  { key: "log_likelihood", label: "Log-Likelihood", color: "#3b82f6" },
  { key: "n_active_states", label: "Active States", color: "#a855f7" },
  { key: "delta", label: "Delta", color: "#f59e0b" },
  { key: "entropy", label: "Entropy", color: "#06b6d4" },
] as const;

export default function ConvergenceAnalytics({ diagnostics }: AnalyticsComponentProps) {
  const [visible, setVisible] = useState<Set<string>>(new Set(["log_likelihood", "n_active_states"]));

  const convergenceSummary = diagnostics.convergence_summary;

  if (!convergenceSummary) {
    return (
      <ChartCard title="Convergence Analytics" className="lg:col-span-2">
        <EmptyState message="No convergence data" hint="Train a model to see convergence curves" />
      </ChartCard>
    );
  }

  const toggleSeries = (key: string) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <ChartCard
      title="Convergence Analytics"
      subtitle={`${convergenceSummary.n_iterations} iterations \u00b7 Final LL: ${convergenceSummary.final_log_likelihood.toFixed(1)} \u00b7 ${convergenceSummary.final_active_states ?? "?"} active states`}
      className="lg:col-span-2"
      minHeight={280}
    >
      {/* Series toggles */}
      <div className="flex gap-2 mb-2">
        {SERIES.map(s => (
          <button
            key={s.key}
            onClick={() => toggleSeries(s.key)}
            className={`text-[9px] px-2 py-0.5 rounded-full border transition-colors ${
              visible.has(s.key)
                ? "border-white/20 bg-white/5"
                : "border-white/5 text-muted-foreground/30"
            }`}
            style={{ color: visible.has(s.key) ? s.color : undefined }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/50 italic">
        Full per-iteration curves available when training metrics are persisted to SQLite.
        Currently showing summary statistics.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 mt-2">
        <div className="bg-white/[0.03] rounded-lg p-2 text-center">
          <div className="text-[9px] text-muted-foreground/50 uppercase">Iterations</div>
          <div className="text-sm font-mono font-bold text-blue-400">{convergenceSummary.n_iterations}</div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2 text-center">
          <div className="text-[9px] text-muted-foreground/50 uppercase">Final LL</div>
          <div className="text-sm font-mono font-bold text-[hsl(var(--data-pos))]">{convergenceSummary.final_log_likelihood.toFixed(1)}</div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2 text-center">
          <div className="text-[9px] text-muted-foreground/50 uppercase">Active States</div>
          <div className="text-sm font-mono font-bold text-violet-400">{convergenceSummary.final_active_states ?? "\u2014"}</div>
        </div>
      </div>
    </ChartCard>
  );
}
