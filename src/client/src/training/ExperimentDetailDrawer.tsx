/**
 * ExperimentDetailDrawer — right-side drawer (Radix Sheet) that opens when a
 * row in the Experiments ledger is clicked.
 *
 * Sections (top to bottom):
 *   1. Header — id · model · symbol · status · headline
 *   2. KPI mini-grid — train loss · val loss · grade · elapsed · peak mem
 *   3. Hyperparameters — params JSON in a sortable key/value table
 *   4. Per-iteration metrics chart — fetched lazy from /api/training/sessions/:id/metrics
 *
 * Heavy data (per-iteration metric trace) is fetched only when the drawer is
 * open, so simply scrolling the ledger doesn't load thousands of points.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/shared/ui/sheet";
import { Badge } from "@/shared/ui/badge";
import {
  MetricCell,
  Sparkline,
  type Kpi,
  KpiStrip,
} from "@/backtest/components";
import {
  fmtNum,
  fmtDuration,
  fmtRelative,
  fmtShortId,
  fmtDateTime,
} from "@/shared/utils/format";
import type { ExperimentRow } from "@/training/lib/useExperiments";

interface ExperimentDetailDrawerProps {
  row: ExperimentRow;
  onClose: () => void;
}

interface MetricRow {
  metricName: string;
  iteration: number;
  value: number;
}

export function ExperimentDetailDrawer({
  row,
  onClose,
}: ExperimentDetailDrawerProps) {
  const { data: metrics } = useQuery({
    queryKey: ["training-metrics", row.id],
    queryFn: async (): Promise<MetricRow[]> => {
      const r = await fetch(`/api/training/sessions/${row.id}/metrics`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { metrics: MetricRow[] };
      return body.metrics ?? [];
    },
    staleTime: 60_000,
  });

  // Group by metric name → series.
  const seriesByName = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const m of metrics ?? []) {
      if (!Number.isFinite(m.value)) continue;
      const arr = map.get(m.metricName) ?? [];
      arr.push(m.value);
      map.set(m.metricName, arr);
    }
    return map;
  }, [metrics]);

  const sortedMetricKeys = useMemo(() => {
    return Array.from(seriesByName.keys()).sort();
  }, [seriesByName]);

  const kpis: Kpi[] = [
    {
      label: "Headline",
      value: fmtNum(row.headline, 3),
      delta:
        row.headline != null && row.headline !== 0
          ? {
              value: fmtNum(row.headline, 3),
              direction: row.headline > 0 ? "pos" : "neg",
            }
          : undefined,
    },
    { label: "Quality", value: fmtNum(row.qualityScore, 3) },
    { label: "Val loss", value: fmtNum(row.valLoss, 4) },
    { label: "Train loss", value: fmtNum(row.trainLoss, 4) },
    { label: "Elapsed", value: fmtDuration(row.elapsedSec ?? null) },
    {
      label: "Peak mem",
      value: row.peakMemoryMb != null ? `${row.peakMemoryMb.toFixed(0)}MB` : "—",
    },
  ];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="w-full max-w-2xl overflow-y-auto p-0"
        data-testid="experiment-detail-drawer"
      >
        <SheetHeader className="border-b border-border/50 p-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              #{row.id}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[10px]">
              {row.modelType || row.modelName || "unknown"}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {row.symbol || "—"} @ {row.timeframe || "—"}
            </Badge>
            <Badge variant="outline" className="ml-auto font-mono text-[10px] uppercase">
              {row.status}
            </Badge>
          </div>
          <SheetTitle className="font-display text-base font-semibold">
            {row.modelType || row.modelName || `Run #${row.id}`}
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px] text-muted-foreground">
            started {fmtDateTime(row.startedAt)} · {fmtRelative(row.startedAt)}
            {row.versionedModelId && ` · version ${fmtShortId(row.versionedModelId, 12)}`}
          </SheetDescription>
        </SheetHeader>

        <div className="p-4">
          <KpiStrip kpis={kpis} dense maxCols={6} />
        </div>

        {row.errorMessage && (
          <section className="px-4 pb-4">
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Error
            </h3>
            <pre className="overflow-x-auto rounded-md border border-[hsl(var(--data-neg)/0.2)] bg-[hsl(var(--data-neg)/0.05)] p-2 font-mono text-[11px] text-[hsl(var(--data-neg))]">
              {row.errorMessage}
            </pre>
          </section>
        )}

        <section className="px-4 pb-4">
          <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Hyperparameters
          </h3>
          {row.hyperparameters && Object.keys(row.hyperparameters).length > 0 ? (
            <div className="overflow-hidden rounded-md border border-border/50">
              <table className="w-full text-[11px]">
                <tbody>
                  {Object.entries(row.hyperparameters)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => (
                      <tr key={k} className="border-b border-border/30 last:border-0">
                        <td className="px-2 py-1 font-mono text-muted-foreground">
                          {k}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {formatValue(v)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[11px] italic text-muted-foreground">
              No hyperparameters recorded.
            </p>
          )}
        </section>

        <section className="px-4 pb-4">
          <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Metric traces ({sortedMetricKeys.length})
          </h3>
          {sortedMetricKeys.length === 0 ? (
            <p className="text-[11px] italic text-muted-foreground">
              No per-iteration metrics recorded.
            </p>
          ) : (
            <div className="space-y-1 overflow-hidden rounded-md border border-border/50">
              {sortedMetricKeys.map((name) => {
                const series = seriesByName.get(name) ?? [];
                const last = series[series.length - 1] ?? null;
                const first = series[0] ?? null;
                const delta =
                  first != null && last != null ? last - first : null;
                return (
                  <div
                    key={name}
                    className="grid grid-cols-[1fr_70px_70px_120px] items-center gap-2 border-b border-border/30 px-2 py-1 last:border-0"
                  >
                    <span className="truncate font-mono text-[11px] text-foreground/90">
                      {name}
                    </span>
                    <MetricCell
                      value={fmtNum(last, 4)}
                      numeric={last}
                      tone="neutral"
                      compact
                    />
                    <MetricCell
                      value={fmtNum(delta, 4)}
                      numeric={delta}
                      tone="auto"
                      compact
                    />
                    <Sparkline data={series} direction="neutral" height={14} />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </SheetContent>
    </Sheet>
  );
}

export default ExperimentDetailDrawer;

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/\.?0+$/, "");
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
