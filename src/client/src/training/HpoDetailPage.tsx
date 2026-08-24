/**
 * HpoDetail — unified live view of a single HPO session.
 *
 * Layout (top to bottom):
 *   Header        session id · model · sym · status · KPI strip
 *   Row 1 span 12 ParallelCoords (all numeric params)
 *   Row 2 span 6  ContourPlot (user-picked X/Y)
 *          span 6 SlicePlot (small-multiples 1D scatter)
 *   Row 3 span 6  BestSoFarLine
 *          span 6 ImportanceBar (existing fANOVA component)
 *   Row 4 span 6  FoldComparison (existing)
 *          span 6 PruningCurves (existing)
 *   Row 5 span 12 Trial table (DenseTable, kill-button column)
 *
 * Data sources:
 *   /api/hpo/sessions/:id        — header info (REST, polled @ 5s)
 *   /api/hpo/stream/:sessionId   — SSE: trial-start/done/pruned/killed/intermediate
 *
 * The 5 new viz components (ParallelCoords, ContourPlot, SlicePlot, BestSoFarLine,
 * trial DenseTable) share a single useHpoTrials() subscription so we open exactly
 * one EventSource per page (not five).
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Sliders, Square } from "lucide-react";

import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import {
  PageShell,
  DenseTable,
  MetricCell,
  ParallelCoords,
  ContourPlot,
  SlicePlot,
  BestSoFarLine,
  type Kpi,
} from "@/backtest/components";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/shared/ui/select";
import { Badge } from "@/shared/ui/badge";

import { ImportanceBar } from "@/training/ImportanceBar";
import { PruningCurves } from "@/training/PruningCurves";
import { FoldComparison } from "@/training/FoldComparison";
import { TrialKillButton } from "@/training/TrialKillButton";
import {
  useHpoTrials,
  numericParamNames,
  type HpoTrial,
} from "@/training/lib/useHpoTrials";
import {
  fmtNum,
  fmtDuration,
  fmtInt,
  fmtShortId,
} from "@/shared/utils/format";
import type { ColumnDef } from "@tanstack/react-table";

interface SessionHeader {
  sessionId: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  status: string;
  optimizerType: string;
  objectiveMetric: string;
  totalTrials: number;
  completedTrials: number;
  prunedTrials: number;
  bestScore: number | null;
  bestParams: string | null;
}

const STATUS_TONE_CLASS: Record<string, "live" | "info" | "warn" | "error" | "idle"> = {
  running: "live",
  pending: "info",
  completed: "info",
  failed: "error",
  stopped: "idle",
};

const TRIAL_STATUS_CLASS: Record<HpoTrial["status"], string> = {
  running: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  completed: "border-primary/30 bg-primary/10 text-primary",
  pruned: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  killed: "border-red-500/30 bg-red-500/10 text-red-400",
  failed: "border-red-500/30 bg-red-500/10 text-red-400",
};

export default function HpoDetail() {
  const params = useParams();
  const sessionId = (params as { sessionId?: string })?.sessionId;
  if (!sessionId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No HPO sessionId provided in route.
      </div>
    );
  }

  useBreadcrumbs([
    { label: "HPO", href: "/hpo" },
    { label: fmtShortId(sessionId, 8) },
  ]);

  const { data: header } = useQuery<SessionHeader>({
    queryKey: ["hpo", "session", sessionId],
    queryFn: async () => {
      const r = await fetch(`/api/hpo/sessions/${sessionId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      return body.session;
    },
    refetchInterval: 5_000,
  });

  const trials = useHpoTrials(sessionId);

  // Determine the objective sense from the metric name. cost_adj_sharpe /
  // profit_factor / qualityScore are maximize; loss / ECE / drawdown are
  // minimize. Default to max, which is the dominant Tyler-side use.
  const objective: "max" | "min" = useMemo(() => {
    const m = (header?.objectiveMetric ?? "").toLowerCase();
    if (
      m.includes("loss") ||
      m.includes("ece") ||
      m.includes("drawdown") ||
      m.includes("error")
    )
      return "min";
    return "max";
  }, [header?.objectiveMetric]);

  const numericParams = useMemo(() => numericParamNames(trials), [trials]);
  const [xParam, setXParam] = useState<string | null>(null);
  const [yParam, setYParam] = useState<string | null>(null);

  // Auto-pick first two numeric params on first data arrival. We key on the
  // serialized param list so the effect doesn't re-run on identity-only
  // changes. After the user picks manually, we don't overwrite their choice
  // — the early-return guards on xParam/yParam being null.
  const paramsKey = numericParams.join("|");
  useEffect(() => {
    if (xParam == null && numericParams[0]) setXParam(numericParams[0]);
    if (yParam == null && numericParams[1]) setYParam(numericParams[1]);
    // paramsKey is the stable identity for numericParams; xParam/yParam are
    // intentionally outside the deps so user selection isn't clobbered.
  }, [paramsKey, numericParams, xParam, yParam]);

  const kpis: Kpi[] = [
    {
      label: "Best score",
      value: fmtNum(header?.bestScore ?? null, 4),
      hint: header?.objectiveMetric,
    },
    {
      label: "Completed",
      value:
        header != null
          ? `${header.completedTrials}/${header.totalTrials}`
          : "—",
    },
    {
      label: "Pruned",
      value: fmtInt(header?.prunedTrials ?? null),
    },
    {
      label: "Sampler",
      value: (header?.optimizerType ?? "—").toUpperCase(),
    },
    {
      label: "Model",
      value: header?.modelType ?? "—",
    },
    {
      label: "Symbol",
      value: header ? `${header.symbol}@${header.timeframe}` : "—",
    },
  ];

  const statusTone = STATUS_TONE_CLASS[header?.status ?? ""] ?? "idle";

  const trialColumns = useMemo<ColumnDef<HpoTrial, unknown>[]>(() => {
    return [
      {
        id: "trialId",
        header: "#",
        accessorFn: (t) => t.trialId,
        cell: (ctx) => (
          <span className="font-mono text-[11px]">{ctx.row.original.trialId}</span>
        ),
        meta: { align: "right", mono: true, width: 48 },
        sortDescFirst: true,
      },
      {
        id: "fold",
        header: "Fold",
        accessorFn: (t) => t.fold ?? -1,
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {ctx.row.original.fold ?? "—"}
          </span>
        ),
        meta: { align: "right", mono: true, width: 48 },
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (t) => t.status,
        cell: (ctx) => (
          <span
            className={`inline-flex h-4 items-center rounded-sm border px-1 font-mono text-[9px] uppercase tracking-wider ${TRIAL_STATUS_CLASS[ctx.row.original.status]}`}
          >
            {ctx.row.original.status}
          </span>
        ),
        meta: { align: "left", width: 84 },
      },
      {
        id: "score",
        header: "Score",
        accessorFn: (t) => t.score ?? Number.NEGATIVE_INFINITY,
        cell: (ctx) => (
          <MetricCell
            value={fmtNum(ctx.row.original.score, 4)}
            numeric={ctx.row.original.score}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 96 },
        sortDescFirst: true,
      },
      {
        id: "duration",
        header: "Duration",
        accessorFn: (t) => t.durationSec ?? -1,
        cell: (ctx) => (
          <MetricCell
            value={fmtDuration(ctx.row.original.durationSec ?? null)}
            tone="neutral"
            compact
          />
        ),
        meta: { align: "right", mono: true, width: 80 },
      },
      {
        id: "params",
        header: "Params",
        accessorFn: () => "",
        cell: (ctx) => {
          const p = ctx.row.original.params;
          if (!p || Object.keys(p).length === 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {JSON.stringify(p)}
            </span>
          );
        },
        meta: { align: "left", mono: true, width: 320 },
        enableSorting: false,
      },
      {
        id: "actions",
        header: "",
        accessorFn: () => "",
        cell: (ctx) =>
          ctx.row.original.status === "running" ? (
            <TrialKillButton sessionId={sessionId} trialId={ctx.row.original.trialId} />
          ) : (
            <span />
          ),
        meta: { align: "center", width: 60 },
        enableSorting: false,
      },
    ];
  }, [sessionId]);

  return (
    <PageShell
      title={`HPO · ${fmtShortId(sessionId, 8)}`}
      subtitle={
        header
          ? `${header.modelType} · ${header.symbol}@${header.timeframe} · optimizing ${header.objectiveMetric}`
          : "Loading session…"
      }
      icon={Sliders}
      status={{
        label: header?.status ?? "loading",
        tone: statusTone,
        pulse: header?.status === "running",
      }}
      actions={
        header?.status === "running"
          ? [
              {
                label: "Stop session",
                icon: Square,
                onClick: async () => {
                  await fetch(`/api/hpo/stop/${sessionId}`, { method: "POST" });
                },
                variant: "outline",
                testId: "hpo-stop",
              },
            ]
          : undefined
      }
      kpis={kpis}
    >
      <div className="space-y-3">
        {/* Row 1: Parallel coordinates — span 12 */}
        <section className="rounded-md border border-border/40 bg-card/40 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Parallel coordinates · {numericParams.length} numeric params
            </h3>
            <Badge variant="outline" className="font-mono text-[10px]">
              {trials.length} trials
            </Badge>
          </div>
          <ParallelCoords trials={trials} objective={objective} height={280} />
        </section>

        {/* Row 2: Contour + Slice */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <section className="rounded-md border border-border/40 bg-card/40 p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Contour
              </h3>
              <ParamPicker
                label="X"
                options={numericParams}
                value={xParam}
                onChange={setXParam}
              />
              <ParamPicker
                label="Y"
                options={numericParams}
                value={yParam}
                onChange={setYParam}
              />
            </div>
            {xParam && yParam ? (
              <ContourPlot
                trials={trials}
                xParam={xParam}
                yParam={yParam}
                objective={objective}
                height={280}
              />
            ) : (
              <div className="flex h-[280px] items-center justify-center text-[11px] text-muted-foreground">
                Need two numeric params to render contour.
              </div>
            )}
          </section>

          <section className="rounded-md border border-border/40 bg-card/40 p-3">
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Slice · objective vs each param
            </h3>
            <SlicePlot trials={trials} objective={objective} cellHeight={120} />
          </section>
        </div>

        {/* Row 3: BestSoFar + ImportanceBar */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <section className="rounded-md border border-border/40 bg-card/40 p-3">
            <h3 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Best so far
            </h3>
            <BestSoFarLine trials={trials} objective={objective} height={180} />
          </section>

          <section className="rounded-md border border-border/40 bg-card/40 p-3">
            <ImportanceBar sessionId={sessionId} />
          </section>
        </div>

        {/* Row 4: Fold + Pruning */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <section className="rounded-md border border-border/40 bg-card/40 p-3">
            <FoldComparison sessionId={sessionId} />
          </section>
          <section className="rounded-md border border-border/40 bg-card/40 p-3">
            <PruningCurves sessionId={sessionId} />
          </section>
        </div>

        {/* Row 5: Trial table */}
        <section className="rounded-md border border-border/40 bg-card/40">
          <div className="border-b border-border/40 px-3 py-1.5">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Trials ({trials.length})
            </h3>
          </div>
          <div className="max-h-[480px]">
            <DenseTable<HpoTrial>
              columns={trialColumns}
              data={trials}
              getRowId={(row) => String(row.trialId)}
              defaultSorting={[{ id: "trialId", desc: true }]}
              dense
              emptyState="No trials yet — subscribed to live SSE stream."
              testId="hpo-trials-table"
            />
          </div>
        </section>
      </div>
    </PageShell>
  );
}

function ParamPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="h-6 w-32 text-[10px]">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt} className="font-mono text-[11px]">
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
