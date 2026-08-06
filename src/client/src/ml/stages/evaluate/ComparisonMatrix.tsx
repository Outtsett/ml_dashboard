/**
 * ComparisonMatrix — multi-experiment metric grid for Stage 5 Evaluate.
 *
 * One row per metric (Sharpe / PF / Win-rate / Max-DD / ECE / Mean trade PnL /
 * Trade frequency / regime-conditional Sharpe). One column per selected
 * experiment plus a sticky `Δ vs baseline` column on the right. Color tiers
 * exactly match `DashboardTab.tsx` via the shared `metricColorClass`.
 *
 * Sortable: clicking a metric label sorts the EXPERIMENT COLUMNS by that
 * metric's value (best-first respecting `higher`/`lower` direction). The
 * metric column itself stays sticky-left.
 *
 * Best column for each row receives a primary-color left border. Baseline is
 * derived from `BaselineComparison`'s shared store via the `baselines` prop —
 * fall back to "—" when no baseline is yet available.
 */

import { useMemo, useState } from "react";
import { ArrowDownUp, Crown } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import {
  METRICS,
  bestExperimentIndex,
  metricColorClass,
  readMetric,
  type MetricKey,
  type MetricLookup,
  type MetricSpec,
} from "./thresholds";

export interface ComparisonExperiment {
  id: string;
  label: string;
  catalogId: string | null;
  metrics: MetricLookup;
}

export interface ComparisonMatrixProps {
  experiments: ComparisonExperiment[];
  /** Baseline metric values used to populate the rightmost Δ column. */
  baseline?: MetricLookup | null;
  baselineLabel?: string;
  /** Optional click handler when a column header (experiment) is clicked. */
  onExperimentSelect?: (experimentId: string) => void;
  className?: string;
}

interface SortState {
  metric: MetricKey;
  direction: "asc" | "desc";
}

function fmtDelta(spec: MetricSpec, value: number | null, baseline: number | null): string {
  if (value == null || baseline == null || !Number.isFinite(value) || !Number.isFinite(baseline)) {
    return "—";
  }
  const delta = value - baseline;
  // Format the magnitude, then prefix the sign explicitly so we get "+0.42",
  // "-0.42", or "0.00" without double-signs from spec.format().
  const formatted = spec.format(Math.abs(delta));
  if (delta === 0) return formatted;
  return delta > 0 ? `+${formatted}` : `-${formatted}`;
}

function deltaColor(spec: MetricSpec, value: number | null, baseline: number | null): string {
  if (value == null || baseline == null || !Number.isFinite(value) || !Number.isFinite(baseline)) {
    return "text-muted-foreground";
  }
  const delta = value - baseline;
  if (delta === 0) return "text-muted-foreground";
  const positiveIsGood = spec.better === "higher";
  const isGood = positiveIsGood ? delta > 0 : delta < 0;
  return isGood ? "text-emerald-400" : "text-rose-400";
}

export function ComparisonMatrix({
  experiments,
  baseline,
  baselineLabel = "baseline",
  onExperimentSelect,
  className,
}: ComparisonMatrixProps) {
  const [sort, setSort] = useState<SortState | null>(null);

  // Sort the experiment columns by the selected metric (best-first, respecting
  // higher/lower-is-better). When `direction === "asc"` we flip the order so
  // a second click on the same header inverts.
  const sortedExperiments = useMemo(() => {
    if (!sort) return experiments;
    const spec = METRICS.find((m) => m.key === sort.metric);
    if (!spec || spec.better === "neutral") return experiments;
    const dir = sort.direction === "desc" ? 1 : -1;
    const better = spec.better === "higher" ? 1 : -1;
    const factor = dir * better;
    return [...experiments].sort((a, b) => {
      const av = readMetric(a.metrics, sort.metric);
      const bv = readMetric(b.metrics, sort.metric);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (bv - av) * factor;
    });
  }, [experiments, sort]);

  function toggleSort(metric: MetricKey) {
    setSort((prev) => {
      if (!prev || prev.metric !== metric) return { metric, direction: "desc" };
      if (prev.direction === "desc") return { metric, direction: "asc" };
      return null;
    });
  }

  const showDelta = baseline != null;

  if (experiments.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center",
          className,
        )}
        data-testid="comparison-matrix-empty"
      >
        <p className="text-sm text-muted-foreground">
          Select at least one experiment to compare.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden",
        className,
      )}
      data-testid="comparison-matrix"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-black/30">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-20 bg-black/40 backdrop-blur px-3 py-2 text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-white/5"
              >
                Metric
              </th>
              {sortedExperiments.map((exp) => (
                <th
                  key={exp.id}
                  scope="col"
                  className="px-3 py-2 text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-white/5 min-w-[120px]"
                >
                  <button
                    type="button"
                    onClick={() => onExperimentSelect?.(exp.id)}
                    className="flex flex-col gap-0.5 text-left hover:text-foreground transition-colors"
                    data-testid={`comparison-matrix-col-${exp.id}`}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground/80">
                      {exp.id.slice(0, 8)}
                    </span>
                    <span className="text-xs font-medium text-foreground truncate max-w-[140px]">
                      {exp.label}
                    </span>
                  </button>
                </th>
              ))}
              {showDelta && (
                <th
                  scope="col"
                  className="sticky right-0 z-20 bg-black/40 backdrop-blur px-3 py-2 text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-white/5 min-w-[110px]"
                >
                  Δ vs {baselineLabel}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((spec) => {
              const values = sortedExperiments.map((exp) =>
                readMetric(exp.metrics, spec.key),
              );
              const bestIdx = bestExperimentIndex(spec, values);
              const baselineValue = baseline ? readMetric(baseline, spec.key) : null;
              const isActiveSort = sort?.metric === spec.key;
              return (
                <tr
                  key={spec.key}
                  className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.02]"
                >
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 bg-card/90 backdrop-blur px-3 py-2 text-left",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(spec.key)}
                      className={cn(
                        "flex items-center gap-1.5 text-xs font-medium hover:text-primary transition-colors",
                        isActiveSort ? "text-primary" : "text-foreground",
                      )}
                      data-testid={`comparison-matrix-sort-${spec.key}`}
                      aria-label={`Sort experiments by ${spec.label}`}
                    >
                      <ArrowDownUp className="h-3 w-3 opacity-60" />
                      {spec.label}
                      {isActiveSort && (
                        <span className="text-[10px] text-muted-foreground">
                          {sort.direction === "desc" ? "↓" : "↑"}
                        </span>
                      )}
                    </button>
                  </th>
                  {sortedExperiments.map((exp, idx) => {
                    const v = values[idx]!;
                    const isBest = bestIdx === idx;
                    return (
                      <td
                        key={exp.id}
                        className={cn(
                          "px-3 py-2 font-mono text-xs whitespace-nowrap",
                          metricColorClass(spec.key, v),
                          isBest && "border-l-2 border-primary bg-primary/[0.04]",
                        )}
                        data-testid={`comparison-matrix-cell-${spec.key}-${exp.id}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {isBest && <Crown className="h-3 w-3 text-primary" />}
                          {spec.format(v)}
                        </span>
                      </td>
                    );
                  })}
                  {showDelta && (
                    <td
                      className={cn(
                        "sticky right-0 z-10 bg-card/90 backdrop-blur px-3 py-2 font-mono text-xs whitespace-nowrap",
                        deltaColor(spec, values[0] ?? null, baselineValue),
                      )}
                      data-testid={`comparison-matrix-delta-${spec.key}`}
                    >
                      {fmtDelta(spec, values[0] ?? null, baselineValue)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
