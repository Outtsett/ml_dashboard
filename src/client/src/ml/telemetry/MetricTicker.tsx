/**
 * MetricTicker — the pipeline's heartbeat.
 *
 * A horizontal strip of live training metrics, each rendered as a DeltaValue so
 * movement is visible rather than merely current. The metric list comes from
 * the runner's own `metric_declarations`, so this component never needs to know
 * what a given model reports — declare a new metric and a column appears.
 *
 * Deliberately renders nothing when no run is active and no metrics have ever
 * arrived. An empty ticker is chrome that costs vertical space and says
 * nothing; a ticker showing the last run's final numbers, however, is useful,
 * so those persist until the next run replaces them.
 */

import { useMemo } from "react";
import { useTrainingMetrics, useTrainingOverlays } from "@/training/lib/TrainingContext";
import { useTrainingControl } from "@/training/lib/TrainingContext";
import { formatMetricValue } from "@/ml/lib/diagnostics-schema";
import { DeltaValue } from "./DeltaValue";
import { resolveMetrics, isLowerBetter } from "./metricDeclarations";

/**
 * Per-metric epsilon derived from declared precision.
 *
 * Without this, a metric reported to 4 decimals jitters in the 6th and the
 * ticker flickers permanently. Half a unit in the last displayed place is the
 * smallest change that is actually visible to the reader, which makes it the
 * right threshold for "did this move".
 */
function epsilonFor(decimals: number | undefined): number {
  return 0.5 * 10 ** -(decimals ?? 4);
}

export function MetricTicker({ className = "" }: { className?: string }) {
  const { metrics } = useTrainingMetrics();
  const { metricDeclarations } = useTrainingOverlays();
  const { isTraining } = useTrainingControl();

  const columns = useMemo(
    () => resolveMetrics(metricDeclarations, metrics),
    [metricDeclarations, metrics],
  );

  const visible = columns.filter((c) => Number.isFinite(metrics[c.key]));
  if (visible.length === 0) return null;

  return (
    <div
      className={`flex items-center gap-4 overflow-x-auto scrollbar-hidden px-2.5 py-1.5 rounded-lg border border-white/5 bg-white/[0.02] shrink-0 ${className}`}
      role="status"
      aria-live="polite"
      aria-label="Live training metrics"
    >
      <span
        className={`flex items-center gap-1.5 shrink-0 text-[9px] uppercase tracking-widest ${
          isTraining ? "text-[hsl(var(--data-pos))]" : "text-muted-foreground/60"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            isTraining
              ? "bg-[hsl(var(--data-pos))] animate-pulse"
              : "bg-muted-foreground/40"
          }`}
          aria-hidden="true"
        />
        {isTraining ? "Live" : "Last run"}
      </span>

      {visible.map((column) => (
        <DeltaValue
          key={column.key}
          label={column.label}
          value={metrics[column.key]!}
          epsilon={epsilonFor(column.context.decimals)}
          lowerIsBetter={isLowerBetter(column.key, column.context)}
          format={(v) => formatMetricValue(v, column.context)}
          className="shrink-0"
        />
      ))}
    </div>
  );
}
