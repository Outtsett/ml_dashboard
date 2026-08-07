/**
 * Registry — promoted-model registry with lineage.
 *
 * Layout:
 *   ┌─ PageHeader · Registry  [refresh]                                    │
 *   ├─ KpiStrip · total versions · per-status counts                       │
 *   ├─ Filter strip (search · status · symbol · timeframe)                │
 *   ├─ DenseTable of model_versions (row click → drawer)                   │
 *   └─ Drawer: lineage chain (ancestors + children) + actions              │
 *
 * Data source:
 *   /api/model-versions?status=&symbol=&timeframe=&limit=
 *   /api/model-versions/:id  → version + ancestors + children + deployments
 *
 * Actions:
 *   POST /api/model-versions/:id/promote     { to_status, dryRun, override?, reason? }
 *   POST /api/model-versions/:id/rollback    { to_version_id }
 */

import { useMemo, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitMerge, RefreshCw } from "lucide-react";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import {
  PageShell,
  DenseTable,
  MetricCell,
  type Kpi,
} from "@/backtest/components";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
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
  fmtRelative,
  fmtShortId,
} from "@/shared/utils/format";
import type { ColumnDef } from "@tanstack/react-table";

const RegistryDetailDrawer = lazy(() =>
  import("@/ml/RegistryDetailDrawer").then((m) => ({
    default: m.RegistryDetailDrawer,
  })),
);

type ModelStatus = "candidate" | "shadow" | "paper" | "live" | "retired";

interface ModelVersionRow {
  versionId: number;
  catalogId: string;
  runnerKey: string;
  status: ModelStatus;
  dataHash: string;
  symbol: string;
  timeframe: string;
  modelArtifactPath: string;
  trainedAt: string;
  promotedAt: string | null;
  retiredAt: string | null;
  parentVersionId: number | null;
  hpoStudyId: string | null;
  metricsSummary: { headline?: number | null; [k: string]: unknown } | null;
}

const STATUS_TONE_CLASS: Record<ModelStatus, string> = {
  candidate: "border-white/10 bg-white/5 text-muted-foreground",
  shadow: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  paper: "border-primary/30 bg-primary/10 text-primary",
  live: "border-[hsl(var(--data-pos)/0.3)] bg-[hsl(var(--data-pos)/0.1)] text-[hsl(var(--data-pos))]",
  retired: "border-white/5 bg-white/[0.02] text-muted-foreground/60",
};

function StatusPill({ status }: { status: ModelStatus }) {
  return (
    <span
      className={`inline-flex h-4 items-center rounded-sm border px-1 font-mono text-[9px] uppercase tracking-wider ${STATUS_TONE_CLASS[status]}`}
    >
      {status}
    </span>
  );
}

export default function Registry() {
  useBreadcrumbs([{ label: "Registry" }]);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["model-versions-list", status],
    queryFn: async (): Promise<ModelVersionRow[]> => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      params.set("limit", "500");
      const r = await fetch(`/api/model-versions?${params.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as { items: ModelVersionRow[] };
      return body.items ?? [];
    },
    refetchInterval: 30_000,
  });

  const rows = data ?? [];

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const hay = [
        String(r.versionId),
        r.catalogId,
        r.runnerKey,
        r.symbol,
        r.timeframe,
        r.dataHash,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, search]);

  const kpis = useMemo<Kpi[]>(() => {
    const byStatus: Record<ModelStatus, number> = {
      candidate: 0,
      shadow: 0,
      paper: 0,
      live: 0,
      retired: 0,
    };
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return [
      { label: "Total versions", value: fmtInt(rows.length) },
      {
        label: "Live",
        value: fmtInt(byStatus.live),
        delta:
          byStatus.live > 0
            ? { value: String(byStatus.live), direction: "pos" }
            : undefined,
      },
      { label: "Paper", value: fmtInt(byStatus.paper) },
      { label: "Shadow", value: fmtInt(byStatus.shadow) },
      { label: "Candidate", value: fmtInt(byStatus.candidate) },
      { label: "Retired", value: fmtInt(byStatus.retired) },
    ];
  }, [rows]);

  const columns = useMemo<ColumnDef<ModelVersionRow, unknown>[]>(() => {
    return [
      {
        id: "versionId",
        header: "ID",
        accessorFn: (r) => r.versionId,
        cell: (ctx) => (
          <span className="font-mono text-[11px]">#{ctx.row.original.versionId}</span>
        ),
        meta: { align: "right", mono: true, width: 56 },
        sortDescFirst: true,
      },
      {
        id: "catalogId",
        header: "Catalog",
        accessorFn: (r) => r.catalogId,
        cell: (ctx) => (
          <span className="truncate font-mono text-[11px]">{ctx.row.original.catalogId}</span>
        ),
        meta: { align: "left", mono: true, width: 160 },
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => r.status,
        cell: (ctx) => <StatusPill status={ctx.row.original.status} />,
        meta: { align: "left", width: 80 },
      },
      {
        id: "symbol",
        header: "Sym/TF",
        accessorFn: (r) => `${r.symbol}@${r.timeframe}`,
        cell: (ctx) => (
          <span className="font-mono text-[11px]">
            {ctx.row.original.symbol}
            <span className="text-muted-foreground">@{ctx.row.original.timeframe}</span>
          </span>
        ),
        meta: { align: "left", mono: true, width: 96 },
      },
      {
        id: "headline",
        header: "Headline",
        accessorFn: (r) => {
          const v = r.metricsSummary?.headline;
          return typeof v === "number" ? v : Number.NEGATIVE_INFINITY;
        },
        cell: (ctx) => {
          const v = ctx.row.original.metricsSummary?.headline;
          return (
            <MetricCell
              value={fmtNum(typeof v === "number" ? v : null, 3)}
              numeric={typeof v === "number" ? v : null}
              tone="auto"
            />
          );
        },
        meta: { align: "right", mono: true, width: 96 },
        sortDescFirst: true,
      },
      {
        id: "dataHash",
        header: "Data hash",
        accessorFn: (r) => r.dataHash,
        cell: (ctx) => (
          <span className="font-mono text-[10px] text-muted-foreground">
            {fmtShortId(ctx.row.original.dataHash, 10)}
          </span>
        ),
        meta: { align: "left", mono: true, width: 88 },
      },
      {
        id: "parent",
        header: "Parent",
        accessorFn: (r) => r.parentVersionId ?? -1,
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {ctx.row.original.parentVersionId
              ? `#${ctx.row.original.parentVersionId}`
              : "—"}
          </span>
        ),
        meta: { align: "right", mono: true, width: 64 },
      },
      {
        id: "hpoStudyId",
        header: "HPO",
        accessorFn: (r) => r.hpoStudyId ?? "",
        cell: (ctx) => (
          <span className="font-mono text-[10px] text-muted-foreground">
            {fmtShortId(ctx.row.original.hpoStudyId, 8)}
          </span>
        ),
        meta: { align: "left", mono: true, width: 80 },
      },
      {
        id: "trainedAt",
        header: "Trained",
        accessorFn: (r) => Date.parse(r.trainedAt),
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {fmtRelative(Date.parse(ctx.row.original.trainedAt))}
          </span>
        ),
        meta: { align: "right", mono: true, width: 88 },
        sortDescFirst: true,
      },
      {
        id: "promotedAt",
        header: "Promoted",
        accessorFn: (r) => (r.promotedAt ? Date.parse(r.promotedAt) : 0),
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {ctx.row.original.promotedAt
              ? fmtRelative(Date.parse(ctx.row.original.promotedAt))
              : "—"}
          </span>
        ),
        meta: { align: "right", mono: true, width: 88 },
      },
    ];
  }, []);

  return (
    <PageShell
      title="Registry"
      subtitle="Model versions with promotion lineage · click any row for detail"
      icon={GitMerge}
      status={{ label: isFetching ? "Syncing" : "Live", tone: "info", pulse: isFetching }}
      actions={[
        {
          label: "Refresh",
          icon: RefreshCw,
          onClick: () => refetch(),
          variant: "ghost",
        },
      ]}
      kpis={kpis}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search id · catalog · symbol · hash"
          className="h-7 w-64 text-[12px]"
        />

        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Status
          </span>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-7 w-32 text-[11px]">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="candidate">Candidate</SelectItem>
              <SelectItem value="shadow">Shadow</SelectItem>
              <SelectItem value="paper">Paper</SelectItem>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Badge variant="outline" className="ml-auto font-mono text-[10px]">
          {visibleRows.length} / {rows.length} versions
        </Badge>
      </div>

      <div className="h-[calc(100%-2.5rem)]">
        <DenseTable<ModelVersionRow>
          columns={columns}
          data={visibleRows}
          getRowId={(row) => String(row.versionId)}
          selectedRowId={selectedId != null ? String(selectedId) : null}
          onRowClick={(row) => setSelectedId(row.versionId)}
          defaultSorting={[{ id: "trainedAt", desc: true }]}
          dense
          emptyState="No model versions registered yet. Use the ML Studio Promote stage to register one."
          testId="registry-table"
        />
      </div>

      {selectedId != null && (
        <Suspense fallback={null}>
          <RegistryDetailDrawer
            versionId={selectedId}
            onClose={() => setSelectedId(null)}
            onAction={() => refetch()}
          />
        </Suspense>
      )}
    </PageShell>
  );
}
