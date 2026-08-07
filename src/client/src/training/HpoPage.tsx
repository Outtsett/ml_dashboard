/**
 * Hpo — list view of every HPO session.
 *
 * Layout:
 *   ┌─ PageHeader · HPO  [refresh]                                         │
 *   ├─ KpiStrip · active · total · trials done · best score (active) ──────┤
 *   ├─ Filter strip (search · model · symbol · status) ────────────────────┤
 *   └─ DenseTable (sortable) — row click → /hpo/:sessionId ────────────────┘
 *
 * Data: GET /api/hpo/sessions (returns HPOSessionSummary[]). The page polls
 * every 5s so users see live trial counts tick up.
 */

import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Sliders, RefreshCw, Activity } from "lucide-react";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import {
  PageShell,
  DenseTable,
  MetricCell,
  type Kpi,
} from "@/backtest/components";
import { Input } from "@/shared/ui/input";
import { Badge } from "@/shared/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/shared/ui/select";
import {
  fmtInt,
  fmtNum,
  fmtDuration,
  fmtRelative,
  fmtShortId,
} from "@/shared/utils/format";
import type { ColumnDef } from "@tanstack/react-table";

interface HpoSessionSummary {
  sessionId: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  status: string;
  optimizerType: string;
  completedTrials: number;
  totalTrials: number;
  bestScore: number | null;
  startedAt: number;
  elapsedSec: number;
  prunedTrials?: number;
}

const STATUS_TONE_CLASS: Record<string, string> = {
  running: "border-[hsl(var(--data-pos)/0.3)] bg-[hsl(var(--data-pos)/0.1)] text-[hsl(var(--data-pos))]",
  pending: "border-white/10 bg-white/5 text-muted-foreground",
  completed: "border-primary/30 bg-primary/10 text-primary",
  failed: "border-[hsl(var(--data-neg)/0.3)] bg-[hsl(var(--data-neg)/0.1)] text-[hsl(var(--data-neg))]",
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

export default function Hpo() {
  useBreadcrumbs([{ label: "HPO" }]);
  const [, setLocation] = useLocation();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["hpo-sessions-list"],
    queryFn: async (): Promise<HpoSessionSummary[]> => {
      const r = await fetch("/api/hpo/sessions?limit=500");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { sessions: HpoSessionSummary[] };
      return body.sessions ?? [];
    },
    refetchInterval: 5_000,
  });

  const rows = data ?? [];

  const modelTypes = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.modelType) s.add(r.modelType);
    return Array.from(s).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (modelFilter !== "all" && r.modelType !== modelFilter) return false;
      if (!needle) return true;
      const hay = [r.sessionId, r.modelType, r.symbol, r.timeframe, r.optimizerType]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, search, statusFilter, modelFilter]);

  const summary = useMemo(() => {
    let active = 0;
    let totalTrialsDone = 0;
    let bestActiveScore: number | null = null;
    for (const r of rows) {
      if (r.status === "running" || r.status === "pending") {
        active += 1;
        if (r.bestScore != null && (bestActiveScore == null || r.bestScore > bestActiveScore)) {
          bestActiveScore = r.bestScore;
        }
      }
      totalTrialsDone += r.completedTrials || 0;
    }
    return { active, totalTrialsDone, bestActiveScore };
  }, [rows]);

  const kpis: Kpi[] = [
    {
      label: "Active",
      value: fmtInt(summary.active),
      delta: summary.active > 0 ? { value: "live", direction: "pos" } : undefined,
    },
    { label: "Total sessions", value: fmtInt(rows.length) },
    { label: "Trials completed", value: fmtInt(summary.totalTrialsDone) },
    {
      label: "Best (active)",
      value: fmtNum(summary.bestActiveScore, 4),
      hint: "Highest objective score among running sessions",
    },
  ];

  const columns = useMemo<ColumnDef<HpoSessionSummary, unknown>[]>(() => {
    return [
      {
        id: "sessionId",
        header: "Session",
        accessorFn: (r) => r.sessionId,
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-foreground/90">
            {fmtShortId(ctx.row.original.sessionId, 8)}
          </span>
        ),
        meta: { align: "left", mono: true, width: 96 },
      },
      {
        id: "model",
        header: "Model",
        accessorFn: (r) => r.modelType,
        cell: (ctx) => (
          <span className="truncate text-[12px]">{ctx.row.original.modelType || "—"}</span>
        ),
        meta: { align: "left", mono: false, width: 140 },
      },
      {
        id: "symbol",
        header: "Sym/TF",
        accessorFn: (r) => `${r.symbol}@${r.timeframe}`,
        cell: (ctx) => (
          <span className="font-mono text-[12px]">
            {ctx.row.original.symbol || "—"}
            <span className="text-muted-foreground">@{ctx.row.original.timeframe || "—"}</span>
          </span>
        ),
        meta: { align: "left", mono: true, width: 96 },
      },
      {
        id: "optimizer",
        header: "Sampler",
        accessorFn: (r) => r.optimizerType,
        cell: (ctx) => (
          <span className="font-mono text-[11px] uppercase text-muted-foreground">
            {ctx.row.original.optimizerType || "—"}
          </span>
        ),
        meta: { align: "left", mono: true, width: 80 },
      },
      {
        id: "trials",
        header: "Trials",
        accessorFn: (r) => r.completedTrials,
        cell: (ctx) => {
          const r = ctx.row.original;
          const pct = r.totalTrials > 0 ? r.completedTrials / r.totalTrials : 0;
          return (
            <div className="flex items-center justify-end gap-1.5">
              <span className="font-mono text-[11px]">
                {r.completedTrials}/{r.totalTrials}
              </span>
              <span
                className="block h-1 w-10 overflow-hidden rounded-sm bg-white/10"
                aria-label={`${(pct * 100).toFixed(0)}% done`}
              >
                <span
                  className="block h-full bg-primary"
                  style={{ width: `${Math.min(100, pct * 100)}%` }}
                />
              </span>
            </div>
          );
        },
        meta: { align: "right", mono: true, width: 112 },
      },
      {
        id: "pruned",
        header: "Pruned",
        accessorFn: (r) => r.prunedTrials ?? 0,
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {ctx.row.original.prunedTrials ?? "—"}
          </span>
        ),
        meta: { align: "right", mono: true, width: 64 },
      },
      {
        id: "bestScore",
        header: "Best score",
        accessorFn: (r) => r.bestScore ?? Number.NEGATIVE_INFINITY,
        cell: (ctx) => (
          <MetricCell
            value={fmtNum(ctx.row.original.bestScore, 4)}
            numeric={ctx.row.original.bestScore}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 96 },
        sortDescFirst: true,
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => r.status,
        cell: (ctx) => <StatusPill status={ctx.row.original.status} />,
        meta: { align: "left", width: 84 },
      },
      {
        id: "elapsedSec",
        header: "Elapsed",
        accessorFn: (r) => r.elapsedSec,
        cell: (ctx) => (
          <MetricCell
            value={fmtDuration(ctx.row.original.elapsedSec)}
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
    ];
  }, []);

  return (
    <PageShell
      title="HPO"
      subtitle="Optuna sessions · TPE / CMA-ES / random · click row for trial detail"
      icon={Sliders}
      status={
        summary.active > 0
          ? { label: `${summary.active} live`, tone: "live", pulse: true, icon: Activity }
          : { label: "Idle", tone: "idle" }
      }
      actions={[
        {
          label: isFetching ? "Refreshing" : "Refresh",
          icon: RefreshCw,
          onClick: () => refetch(),
          variant: "ghost",
          testId: "hpo-refresh",
        },
      ]}
      kpis={kpis}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search session · model · symbol"
          className="h-7 w-64 text-[12px]"
        />

        <FilterSelect
          label="Model"
          value={modelFilter}
          onChange={setModelFilter}
          options={modelTypes}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={["running", "pending", "completed", "failed", "stopped"]}
        />

        <Badge variant="outline" className="ml-auto font-mono text-[10px]">
          {visibleRows.length} / {rows.length} sessions
        </Badge>
      </div>

      <div className="h-[calc(100%-2.5rem)]">
        <DenseTable<HpoSessionSummary>
          columns={columns}
          data={visibleRows}
          getRowId={(row) => row.sessionId}
          onRowClick={(row) => setLocation(`/hpo/${row.sessionId}`)}
          defaultSorting={[{ id: "startedAt", desc: true }]}
          dense
          emptyState={
            isLoading
              ? "Loading sessions…"
              : isError
                ? "Failed to load /api/hpo/sessions"
                : "No HPO sessions yet. Launch one via the ML Studio Train stage."
          }
          testId="hpo-table"
        />
      </div>
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
