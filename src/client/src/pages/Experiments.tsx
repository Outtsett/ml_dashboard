/**
 * Experiments — flat ledger of every training run.
 *
 * Layout:
 *   ┌─ PageHeader · Experiments  [filter chips]  [refresh]  [export csv]    │
 *   ├─ KpiStrip · total · last 7d · best 30d headline · mean train · gpu-h ─┤
 *   ├─ Filter strip (search · model family · symbol · timeframe · status) ──┤
 *   └─ DenseTable (sortable, row→drawer) ──────────────────────────────────┘
 *
 * Drilling: clicking a row opens a right-side drawer (Radix Sheet) with the
 * run's full diagnostics + per-fold metrics + hyperparams. Drawer body is
 * lazy-loaded so the page boots fast even with 500 rows.
 */

import { useState, useMemo, lazy, Suspense } from "react";
import { FlaskConical, RefreshCw, Download } from "lucide-react";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import {
  PageShell,
  DenseTable,
  MetricCell,
  type Kpi,
} from "@/backtest/components";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/shared/ui/select";
import { Badge } from "@/shared/ui/badge";
import {
  useExperiments,
  useExperimentSummary,
  type ExperimentRow,
} from "@/training/lib/useExperiments";
import {
  fmtInt,
  fmtNum,
  fmtDuration,
  fmtRelative,
  fmtShortId,
} from "@/shared/utils/format";
import type { ColumnDef } from "@tanstack/react-table";

const ExperimentDetailDrawer = lazy(() =>
  import("@/training/ExperimentDetailDrawer").then((m) => ({
    default: m.ExperimentDetailDrawer,
  })),
);

const STATUS_TONE_CLASS: Record<string, string> = {
  running: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  completed: "border-primary/30 bg-primary/10 text-primary",
  failed: "border-red-500/30 bg-red-500/10 text-red-400",
  stopped: "border-white/10 bg-white/5 text-muted-foreground",
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_TONE_CLASS[status] ?? "border-white/10 bg-white/5 text-muted-foreground";
  return (
    <span
      className={`inline-flex h-4 items-center rounded-sm border px-1 font-mono text-[9px] uppercase tracking-wider ${cls}`}
    >
      {status || "—"}
    </span>
  );
}

export default function Experiments() {
  useBreadcrumbs([{ label: "Experiments" }]);

  const [search, setSearch] = useState("");
  const [symbol, setSymbol] = useState<string>("all");
  const [modelType, setModelType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: rows, isLoading, isError, refetch, isFetching } = useExperiments({
    symbol: symbol === "all" ? undefined : symbol,
    modelType: modelType === "all" ? undefined : modelType,
    status: status === "all" ? undefined : status,
  });

  // Build symbol + modelType option lists from the data so the dropdowns
  // self-populate from whatever the server has seen.
  const { symbols, modelTypes } = useMemo(() => {
    const symSet = new Set<string>();
    const mtSet = new Set<string>();
    for (const r of rows ?? []) {
      if (r.symbol) symSet.add(r.symbol);
      if (r.modelType) mtSet.add(r.modelType);
    }
    return {
      symbols: Array.from(symSet).sort(),
      modelTypes: Array.from(mtSet).sort(),
    };
  }, [rows]);

  // Apply free-text search client-side over a precomputed lower-cased haystack.
  const visibleRows = useMemo<ExperimentRow[]>(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const hay = [
        r.modelName,
        r.modelType,
        r.symbol,
        r.timeframe,
        r.versionedModelId,
        r.walkForwardGroup,
        r.grade,
        String(r.id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, search]);

  const summary = useExperimentSummary(visibleRows);

  const kpis: Kpi[] = [
    { label: "Total runs", value: fmtInt(summary.total) },
    {
      label: "Last 7 days",
      value: fmtInt(summary.last7d),
      delta: summary.last7d > 0
        ? { value: `${summary.last7d}`, direction: "pos" }
        : undefined,
    },
    {
      label: "Best 30d headline",
      value: fmtNum(summary.best30dHeadline, 3),
      hint: "Promoted from qualityScore when available, else 1 / val_loss",
    },
    { label: "Mean train", value: fmtDuration(summary.meanElapsedSec ?? null) },
    {
      label: "Wall-clock total",
      value: fmtDuration((summary.totalGpuHours ?? 0) * 3600),
      hint: "Sum of all run wall-clock — under-counts true GPU-hours",
    },
  ];

  const columns = useMemo<ColumnDef<ExperimentRow, unknown>[]>(() => {
    return [
      {
        id: "id",
        header: "ID",
        accessorFn: (r) => r.id,
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {fmtShortId(String(ctx.row.original.id), 6)}
          </span>
        ),
        meta: { align: "left", mono: true, width: 64 },
      },
      {
        id: "model",
        header: "Model",
        accessorFn: (r) => r.modelType || r.modelName,
        cell: (ctx) => (
          <span className="truncate text-[12px]">{ctx.row.original.modelType || ctx.row.original.modelName || "—"}</span>
        ),
        meta: { align: "left", mono: false, width: 160 },
      },
      {
        id: "symbol",
        header: "Sym",
        accessorFn: (r) => r.symbol,
        cell: (ctx) => (
          <span className="font-mono text-[12px]">{ctx.row.original.symbol || "—"}</span>
        ),
        meta: { align: "left", mono: true, width: 60 },
      },
      {
        id: "timeframe",
        header: "TF",
        accessorFn: (r) => r.timeframe,
        cell: (ctx) => (
          <span className="font-mono text-[12px] text-muted-foreground">
            {ctx.row.original.timeframe || "—"}
          </span>
        ),
        meta: { align: "left", mono: true, width: 48 },
      },
      {
        id: "headline",
        header: "Headline",
        accessorFn: (r) => r.headline ?? Number.NEGATIVE_INFINITY,
        cell: (ctx) => (
          <MetricCell
            value={fmtNum(ctx.row.original.headline, 3)}
            numeric={ctx.row.original.headline}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 88 },
        sortDescFirst: true,
      },
      {
        id: "qualityScore",
        header: "Quality",
        accessorFn: (r) => r.qualityScore ?? Number.NEGATIVE_INFINITY,
        cell: (ctx) => (
          <MetricCell
            value={fmtNum(ctx.row.original.qualityScore, 3)}
            numeric={ctx.row.original.qualityScore}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 80 },
      },
      {
        id: "valLoss",
        header: "Val loss",
        accessorFn: (r) => r.valLoss ?? Number.POSITIVE_INFINITY,
        cell: (ctx) => (
          <MetricCell
            value={fmtNum(ctx.row.original.valLoss, 4)}
            tone="neutral"
          />
        ),
        meta: { align: "right", mono: true, width: 88 },
      },
      {
        id: "trainLoss",
        header: "Train loss",
        accessorFn: (r) => r.trainLoss ?? Number.POSITIVE_INFINITY,
        cell: (ctx) => (
          <MetricCell
            value={fmtNum(ctx.row.original.trainLoss, 4)}
            tone="neutral"
          />
        ),
        meta: { align: "right", mono: true, width: 88 },
      },
      {
        id: "grade",
        header: "Grade",
        accessorFn: (r) => r.grade ?? "",
        cell: (ctx) => (
          <span className="font-mono text-[11px] uppercase">
            {ctx.row.original.grade || "—"}
          </span>
        ),
        meta: { align: "center", mono: true, width: 56 },
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => r.status,
        cell: (ctx) => <StatusPill status={ctx.row.original.status} />,
        meta: { align: "left", width: 84 },
      },
      {
        id: "windowIndex",
        header: "Fold",
        accessorFn: (r) => r.windowIndex ?? -1,
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {ctx.row.original.windowIndex != null
              ? String(ctx.row.original.windowIndex)
              : "—"}
          </span>
        ),
        meta: { align: "right", mono: true, width: 56 },
      },
      {
        id: "elapsed",
        header: "Elapsed",
        accessorFn: (r) => r.elapsedSec ?? -1,
        cell: (ctx) => (
          <MetricCell
            value={fmtDuration(ctx.row.original.elapsedSec ?? null)}
            tone="neutral"
            compact
          />
        ),
        meta: { align: "right", mono: true, width: 88 },
      },
      {
        id: "startedAt",
        header: "Started",
        accessorFn: (r) => r.startedAt,
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {fmtRelative(ctx.row.original.startedAt)}
          </span>
        ),
        meta: { align: "right", mono: true, width: 88 },
        sortDescFirst: true,
      },
      {
        id: "versionedModelId",
        header: "Version",
        accessorFn: (r) => r.versionedModelId ?? "",
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {fmtShortId(ctx.row.original.versionedModelId, 10)}
          </span>
        ),
        meta: { align: "left", mono: true, width: 96 },
      },
      {
        id: "walkForwardGroup",
        header: "Group",
        accessorFn: (r) => r.walkForwardGroup ?? "",
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {fmtShortId(ctx.row.original.walkForwardGroup, 8)}
          </span>
        ),
        meta: { align: "left", mono: true, width: 80 },
      },
    ];
  }, []);

  const selected = useMemo(
    () => visibleRows.find((r) => r.id === selectedId) ?? null,
    [visibleRows, selectedId],
  );

  return (
    <PageShell
      title="Experiments"
      subtitle="Ledger of every training run · sortable · drill into any row"
      icon={FlaskConical}
      status={{ label: isFetching ? "Syncing" : "Live", tone: isFetching ? "info" : "live", pulse: isFetching }}
      actions={[
        {
          label: "Refresh",
          icon: RefreshCw,
          onClick: () => refetch(),
          variant: "ghost",
          testId: "experiments-refresh",
        },
        {
          label: "Export CSV",
          icon: Download,
          onClick: () => exportCsv(visibleRows),
          variant: "outline",
          testId: "experiments-export",
        },
      ]}
      kpis={kpis}
    >
      {/* Filter strip */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search id · model · symbol · version"
          className="h-7 w-64 text-[12px]"
        />

        <FilterSelect
          label="Model"
          value={modelType}
          onChange={setModelType}
          options={modelTypes}
        />
        <FilterSelect
          label="Symbol"
          value={symbol}
          onChange={setSymbol}
          options={symbols}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={["running", "paused", "completed", "failed", "stopped"]}
        />

        <Badge variant="outline" className="ml-auto font-mono text-[10px]">
          {visibleRows.length} / {rows?.length ?? 0} rows
        </Badge>
      </div>

      <div className="h-[calc(100%-2.5rem)]">
        <DenseTable<ExperimentRow>
          columns={columns}
          data={visibleRows}
          getRowId={(row) => String(row.id)}
          selectedRowId={selectedId != null ? String(selectedId) : null}
          onRowClick={(row) => setSelectedId(row.id)}
          defaultSorting={[{ id: "headline", desc: true }]}
          dense
          emptyState={
            isLoading
              ? "Loading sessions…"
              : isError
                ? "Failed to load /api/training/sessions"
                : "No experiments match the current filters."
          }
          testId="experiments-table"
        />
      </div>

      {selected && (
        <Suspense fallback={null}>
          <ExperimentDetailDrawer
            row={selected}
            onClose={() => setSelectedId(null)}
          />
        </Suspense>
      )}
    </PageShell>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 w-32 text-[11px]">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function exportCsv(rows: ExperimentRow[]) {
  if (rows.length === 0) return;
  const headers = [
    "id",
    "modelType",
    "modelName",
    "symbol",
    "timeframe",
    "status",
    "headline",
    "qualityScore",
    "trainLoss",
    "valLoss",
    "grade",
    "windowIndex",
    "elapsedSec",
    "startedAt",
    "versionedModelId",
    "walkForwardGroup",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        csvEscape(r.modelType),
        csvEscape(r.modelName),
        csvEscape(r.symbol),
        csvEscape(r.timeframe),
        csvEscape(r.status),
        r.headline ?? "",
        r.qualityScore ?? "",
        r.trainLoss ?? "",
        r.valLoss ?? "",
        csvEscape(r.grade ?? ""),
        r.windowIndex ?? "",
        r.elapsedSec ?? "",
        new Date(r.startedAt).toISOString(),
        csvEscape(r.versionedModelId ?? ""),
        csvEscape(r.walkForwardGroup ?? ""),
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `experiments-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(s: string | null | undefined): string {
  if (s == null) return "";
  const needsQuote = /[",\n]/.test(s);
  return needsQuote ? `"${s.replace(/"/g, '""')}"` : s;
}
