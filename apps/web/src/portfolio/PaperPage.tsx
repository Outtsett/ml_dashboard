/**
 * Paper — live paper-trade + drift monitor.
 *
 * Layout:
 *   ┌─ PageHeader · Paper · connected status                              ─┐
 *   ├─ KpiStrip · running · preds/min · paper P&L · mean PSI · last pred  │
 *   ├─ Row 1 · Active deployments DenseTable (span 8) · Signal log (4)    │
 *   ├─ Row 2 · Paper P&L overlay (recharts, all deployments)              │
 *   └─ Row 3 · Drift PSI per deployment (horizontal bars)                  │
 *
 * Data:
 *   /api/deployments         — list deployments (REST, polled 10s)
 *   /api/events/deployments  — live SSE (handled by useDeploymentEvents)
 *   /api/model-versions/:id  — fetched lazy for the selected deployment
 *
 * Note: per-feature drift would require new backend wiring. The current PSI
 * value comes from the deployment SSE envelope; until per-feature breakdown
 * is exposed, this page treats PSI as a single scalar per deployment.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio, RefreshCw, Square } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import {
  PageShell,
  DenseTable,
  MetricCell,
  ExposureBars,
  type Kpi,
} from "@/backtest/components";
import { Badge } from "@/shared/ui/badge";
import {
  useDeploymentEvents,
  type DeploymentEventState,
} from "@/deployment/lib/useDeploymentEvents";
import {
  fmtInt,
  fmtNum,
  fmtUsd,
  fmtRelative,
} from "@/shared/utils/format";
import type { ColumnDef } from "@tanstack/react-table";

interface DeploymentRow {
  deploymentId: number;
  versionId: number;
  mode: "shadow" | "paper" | "live";
  status: "running" | "paused" | "stopped" | "failed";
  startedAt: string;
  endedAt: string | null;
  symbol?: string;
  timeframe?: string;
}

interface JoinedRow extends DeploymentRow {
  live: DeploymentEventState | null;
}

const STATUS_TONE: Record<DeploymentRow["status"], string> = {
  running: "border-[hsl(var(--data-pos)/0.3)] bg-[hsl(var(--data-pos)/0.1)] text-[hsl(var(--data-pos))]",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  stopped: "border-white/10 bg-white/5 text-muted-foreground",
  failed: "border-[hsl(var(--data-neg)/0.3)] bg-[hsl(var(--data-neg)/0.1)] text-[hsl(var(--data-neg))]",
};

const MODE_TONE: Record<DeploymentRow["mode"], string> = {
  shadow: "border-white/10 bg-white/5 text-muted-foreground",
  paper: "border-primary/30 bg-primary/10 text-primary",
  live: "border-[hsl(var(--data-pos)/0.3)] bg-[hsl(var(--data-pos)/0.1)] text-[hsl(var(--data-pos))]",
};

export default function Paper() {
  useBreadcrumbs([{ label: "Paper" }]);

  const sse = useDeploymentEvents();

  const { data: deployments = [], refetch, isFetching } = useQuery({
    queryKey: ["deployments-list"],
    queryFn: async (): Promise<DeploymentRow[]> => {
      const r = await fetch("/api/deployments?limit=200");
      if (!r.ok) return [];
      const body = await r.json();
      // The /api/deployments response shape isn't normalized across builds;
      // accept either { items: [...] } or a bare array.
      if (Array.isArray(body)) return body;
      if (Array.isArray(body.items)) return body.items;
      if (Array.isArray(body.deployments)) return body.deployments;
      return [];
    },
    refetchInterval: 10_000,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);

  const rows: JoinedRow[] = useMemo(
    () =>
      deployments.map((d) => ({
        ...d,
        live: sse.byDeployment[d.deploymentId] ?? null,
      })),
    [deployments, sse.byDeployment],
  );

  const running = useMemo(
    () => rows.filter((r) => r.status === "running"),
    [rows],
  );

  const aggregate = useMemo(() => {
    let totalPnl = 0;
    let totalPreds = 0;
    let predPerMin = 0;
    let psiSum = 0;
    let psiCount = 0;
    let lastTs = 0;
    for (const r of rows) {
      if (!r.live) continue;
      if (r.live.paperPnlTotal != null) totalPnl += r.live.paperPnlTotal;
      totalPreds += r.live.predictionsEmitted;
      predPerMin += r.live.predPerMin;
      if (r.live.predDriftPsi != null) {
        psiSum += r.live.predDriftPsi;
        psiCount += 1;
      }
      if (r.live.lastEventTs) {
        const t = Date.parse(r.live.lastEventTs);
        if (Number.isFinite(t) && t > lastTs) lastTs = t;
      }
    }
    return {
      totalPnl,
      totalPreds,
      predPerMin,
      meanPsi: psiCount > 0 ? psiSum / psiCount : null,
      lastTs: lastTs > 0 ? lastTs : null,
    };
  }, [rows]);

  const kpis: Kpi[] = [
    {
      label: "Connected",
      value: sse.connected ? "OPEN" : "RECONNECTING",
      delta: sse.connected
        ? undefined
        : { value: `att ${sse.reconnectAttempt}`, direction: "neg" },
      hint: sse.connected
        ? "SSE channel /api/events/deployments is open"
        : "Backoff reconnect in progress",
    },
    { label: "Running", value: fmtInt(running.length) },
    { label: "Preds total", value: fmtInt(aggregate.totalPreds) },
    {
      label: "Preds / min",
      value: fmtNum(aggregate.predPerMin, 1),
      delta:
        aggregate.predPerMin > 0
          ? { value: `${aggregate.predPerMin}/m`, direction: "pos" }
          : undefined,
    },
    {
      label: "Mean PSI",
      value: fmtNum(aggregate.meanPsi, 3),
      hint: "Mean Population-Stability-Index across active deployments",
    },
    {
      label: "Paper P&L",
      value: fmtUsd(aggregate.totalPnl),
      delta: {
        value: fmtUsd(aggregate.totalPnl),
        direction:
          aggregate.totalPnl > 0
            ? "pos"
            : aggregate.totalPnl < 0
              ? "neg"
              : "neutral",
      },
    },
    {
      label: "Last event",
      value: aggregate.lastTs ? fmtRelative(aggregate.lastTs) : "—",
    },
  ];

  const deploymentCols = useMemo<ColumnDef<JoinedRow, unknown>[]>(() => {
    return [
      {
        id: "deploymentId",
        header: "#",
        accessorFn: (r) => r.deploymentId,
        cell: (ctx) => (
          <span className="font-mono text-[11px]">
            #{ctx.row.original.deploymentId}
          </span>
        ),
        meta: { align: "right", mono: true, width: 48 },
      },
      {
        id: "versionId",
        header: "Version",
        accessorFn: (r) => r.versionId,
        cell: (ctx) => (
          <span className="font-mono text-[11px]">v{ctx.row.original.versionId}</span>
        ),
        meta: { align: "right", mono: true, width: 64 },
      },
      {
        id: "mode",
        header: "Mode",
        accessorFn: (r) => r.mode,
        cell: (ctx) => (
          <span
            className={`inline-flex h-4 items-center rounded-sm border px-1 font-mono text-[9px] uppercase tracking-wider ${MODE_TONE[ctx.row.original.mode]}`}
          >
            {ctx.row.original.mode}
          </span>
        ),
        meta: { align: "left", width: 64 },
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => r.status,
        cell: (ctx) => (
          <span
            className={`inline-flex h-4 items-center rounded-sm border px-1 font-mono text-[9px] uppercase tracking-wider ${STATUS_TONE[ctx.row.original.status]}`}
          >
            {ctx.row.original.status}
          </span>
        ),
        meta: { align: "left", width: 72 },
      },
      {
        id: "preds",
        header: "Preds",
        accessorFn: (r) => r.live?.predictionsEmitted ?? -1,
        cell: (ctx) => (
          <MetricCell value={fmtInt(ctx.row.original.live?.predictionsEmitted ?? null)} tone="neutral" />
        ),
        meta: { align: "right", mono: true, width: 72 },
      },
      {
        id: "predPerMin",
        header: "Pred/min",
        accessorFn: (r) => r.live?.predPerMin ?? -1,
        cell: (ctx) => (
          <MetricCell value={fmtNum(ctx.row.original.live?.predPerMin ?? null, 1)} tone="neutral" />
        ),
        meta: { align: "right", mono: true, width: 80 },
      },
      {
        id: "paperPnl",
        header: "Paper P&L",
        accessorFn: (r) => r.live?.paperPnlTotal ?? Number.NEGATIVE_INFINITY,
        cell: (ctx) => (
          <MetricCell
            value={fmtUsd(ctx.row.original.live?.paperPnlTotal ?? null)}
            numeric={ctx.row.original.live?.paperPnlTotal ?? null}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 112 },
      },
      {
        id: "psi",
        header: "PSI",
        accessorFn: (r) => r.live?.predDriftPsi ?? -1,
        cell: (ctx) => {
          const v = ctx.row.original.live?.predDriftPsi ?? null;
          const tone: "warn" | "neutral" | "neg" =
            v == null ? "neutral" : v > 0.25 ? "neg" : v > 0.1 ? "warn" : "neutral";
          return <MetricCell value={fmtNum(v, 3)} tone={tone} />;
        },
        meta: { align: "right", mono: true, width: 72 },
      },
      {
        id: "lastEventTs",
        header: "Last",
        accessorFn: (r) => (r.live?.lastEventTs ? Date.parse(r.live.lastEventTs) : 0),
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {ctx.row.original.live?.lastEventTs
              ? fmtRelative(Date.parse(ctx.row.original.live.lastEventTs))
              : "—"}
          </span>
        ),
        meta: { align: "right", mono: true, width: 88 },
      },
      {
        id: "actions",
        header: "",
        accessorFn: () => "",
        cell: (ctx) =>
          ctx.row.original.status === "running" ? (
            <button
              type="button"
              className="rounded-sm border border-[hsl(var(--data-neg)/0.2)] px-1.5 py-0.5 font-mono text-[10px] text-[hsl(var(--data-neg))] hover:border-[hsl(var(--data-neg)/0.4)] hover:bg-[hsl(var(--data-neg)/0.1)]"
              onClick={(e) => {
                e.stopPropagation();
                stopDeployment(ctx.row.original.deploymentId).then(() => refetch());
              }}
              title="Stop deployment"
            >
              <Square className="inline h-2.5 w-2.5" />
            </button>
          ) : (
            <span />
          ),
        meta: { align: "center", width: 48 },
        enableSorting: false,
      },
    ];
  }, [refetch]);

  // Build the multi-deployment paper PnL series. The hook gives us
  // paperPnlTotal as a scalar — we sample the latest value into the chart's
  // most recent point. Until the SSE bridge emits a historical series, the
  // chart will appear sparse but always-current.
  const pnlOverlay = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (r.live?.paperPnlTotal != null) {
        out[`#${r.deploymentId}`] = r.live.paperPnlTotal;
      }
    }
    if (Object.keys(out).length === 0) return [];
    return [
      {
        t: Date.now(),
        ...out,
      },
    ];
  }, [rows]);

  const driftRows = useMemo(
    () =>
      running
        .map((r) => ({
          name: `#${r.deploymentId} v${r.versionId}`,
          value: r.live?.predDriftPsi ?? 0,
          pct: (r.live?.predDriftPsi ?? 0) / 0.5, // 0.5 PSI is "severe" — scale bars to that ceiling
        }))
        .filter((r) => r.value > 0),
    [running],
  );

  const signalLog = useMemo(() => {
    const out: {
      deploymentId: number;
      ts: string;
      prediction: number | string;
      confidence: number;
    }[] = [];
    for (const r of rows) {
      const lp = r.live?.lastPrediction;
      if (lp) out.push({ deploymentId: r.deploymentId, ...lp });
    }
    return out
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
      .slice(0, 40);
  }, [rows]);

  return (
    <PageShell
      title="Paper"
      subtitle={`Paper-trade + drift monitor · ${running.length} active · SSE ${sse.connected ? "open" : `reconnecting (att ${sse.reconnectAttempt})`}`}
      icon={Radio}
      status={{
        label: sse.connected ? "Live" : "Reconnecting",
        tone: sse.connected ? "live" : "warn",
        pulse: !sse.connected,
      }}
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
      <div className="space-y-3">
        {/* Row 1: deployments (8) + signal log (4) */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <section className="lg:col-span-8 rounded-md border border-border/40 bg-card/40">
            <div className="border-b border-border/40 px-3 py-1.5">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Active deployments ({rows.length})
              </h3>
            </div>
            <div className="max-h-[360px]">
              <DenseTable<JoinedRow>
                columns={deploymentCols}
                data={rows}
                getRowId={(row) => String(row.deploymentId)}
                selectedRowId={selectedId != null ? String(selectedId) : null}
                onRowClick={(row) => setSelectedId(row.deploymentId)}
                defaultSorting={[{ id: "deploymentId", desc: true }]}
                dense
                emptyState={
                  isFetching
                    ? "Loading deployments…"
                    : "No deployments registered. Promote a model in the Registry to start one."
                }
                testId="deployments-table"
              />
            </div>
          </section>

          <section className="lg:col-span-4 rounded-md border border-border/40 bg-card/40">
            <div className="border-b border-border/40 px-3 py-1.5">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Signal log
              </h3>
            </div>
            <ul className="max-h-[360px] overflow-y-auto">
              {signalLog.length === 0 ? (
                <li className="p-3 text-[11px] italic text-muted-foreground">
                  No live predictions yet.
                </li>
              ) : (
                signalLog.map((s, i) => (
                  <li
                    key={`${s.deploymentId}-${s.ts}-${i}`}
                    className="flex items-baseline justify-between gap-2 border-b border-border/30 px-2 py-1 text-[11px] last:border-0"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {fmtRelative(Date.parse(s.ts))}
                    </span>
                    <Badge variant="outline" className="font-mono text-[9px]">
                      #{s.deploymentId}
                    </Badge>
                    <span className="font-mono">
                      {typeof s.prediction === "number"
                        ? s.prediction.toFixed(3)
                        : String(s.prediction)}
                    </span>
                    <span className="font-mono tnum text-muted-foreground">
                      {fmtNum(s.confidence, 2)}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>

        {/* Row 2: paper PnL overlay */}
        <section className="rounded-md border border-border/40 bg-card/40">
          <div className="border-b border-border/40 px-3 py-1.5">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Paper P&L (current snapshot per deployment)
            </h3>
          </div>
          <div className="p-2">
            {pnlOverlay.length === 0 ? (
              <div className="flex h-[180px] items-center justify-center text-[11px] text-muted-foreground">
                No paper P&L emitted yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={pnlOverlay} margin={{ top: 6, right: 8, left: 0, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="2 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(v) => new Date(v).toLocaleTimeString()}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={9}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={9}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                  {Object.keys(pnlOverlay[0] ?? {})
                    .filter((k) => k !== "t")
                    .map((k, i) => (
                      <Area
                        key={k}
                        type="monotone"
                        dataKey={k}
                        stroke={`hsl(var(--data-cat-${(i % 10) + 1}))`}
                        fill={`hsl(var(--data-cat-${(i % 10) + 1}) / 0.2)`}
                        strokeWidth={1.5}
                      />
                    ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        {/* Row 3: drift PSI bars */}
        <section className="rounded-md border border-border/40 bg-card/40 p-3">
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Drift · PSI per active deployment (0.10 = noticeable, 0.25 = severe)
          </h3>
          <ExposureBars
            rows={driftRows}
            formatValue={(v) => v.toFixed(3)}
          />
          <p className="mt-2 text-[10px] italic text-muted-foreground">
            Per-feature drift breakdown requires backend wiring on
            <code className="mx-1 rounded-sm bg-white/[0.04] px-1 font-mono">
              /api/paper/drift
            </code>
            — not yet exposed. Showing aggregate PSI from the deployment SSE
            envelope.
          </p>
        </section>
      </div>
    </PageShell>
  );
}

async function stopDeployment(id: number): Promise<void> {
  try {
    await fetch(`/api/deployments/${id}/stop`, { method: "POST" });
  } catch {
    // swallow — the next poll will reflect actual state
  }
}
