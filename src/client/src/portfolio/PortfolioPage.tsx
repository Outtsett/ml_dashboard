/**
 * Portfolio — positions, P&L, equity + drawdown.
 *
 * Redesign (phase 3.3) — strips the gradient-headline / violet-cyan brochure
 * aesthetic in favor of the institutional PageShell / KpiStrip pattern shared
 * by every other Phase-redesigned page.
 *
 * Layout:
 *   ┌─ PageShell · Portfolio · status · refresh                           ─┐
 *   ├─ KpiStrip · NAV · Daily · MTD · Win rate · Open pos · Sharpe · DD   │
 *   ├─ Row 1 · Open positions DenseTable (span 8) · Allocation pie (4)    │
 *   ├─ Row 2 · Equity curve + Drawdown (split, span 12) ──────────────────┤
 *   └─ Row 3 · Trade history DenseTable (span 12) ─────────────────────────┘
 *
 * Data sources unchanged from the prior implementation:
 *   /api/ml/trades?status=open    — open positions
 *   /api/ml/trades?status=closed  — closed trades for P&L + equity
 *   /api/backtest/runs            — preferred equity curve when present
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wallet, RefreshCw } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  PageShell,
  DenseTable,
  MetricCell,
  DrawdownChart,
  type Kpi,
} from "@/backtest/components";
import {
  buildEquityCurve,
  buildDrawdownSeries,
  maxDrawdown,
  returnsFromCurve,
  sharpe,
  exposureBy,
  winRate,
} from "@/portfolio/lib/risk";
import { fmtUsd, fmtPct, fmtNum, fmtRelative, fmtInt } from "@/shared/utils/format";
import type { Trade } from "@/shared/utils/types";
import type { ColumnDef } from "@tanstack/react-table";

interface Position {
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  pnl: number;
  pnlPct: number;
}

const CAT_VARS = [
  "--data-cat-1",
  "--data-cat-2",
  "--data-cat-3",
  "--data-cat-4",
  "--data-cat-5",
  "--data-cat-6",
  "--data-cat-7",
  "--data-cat-8",
] as const;

export default function Portfolio() {
  const { data: openRaw = [], isLoading: loadingOpen, refetch: refetchOpen } =
    useQuery<Trade[]>({
      queryKey: ["/api/ml/trades", "open"],
      queryFn: async () => {
        const r = await fetch("/api/ml/trades?status=open&limit=200");
        if (!r.ok) return [];
        const body = await r.json();
        return Array.isArray(body) ? body : [];
      },
      refetchInterval: 15_000,
    });

  const { data: closedRaw = [], isLoading: loadingClosed, refetch: refetchClosed } =
    useQuery<Trade[]>({
      queryKey: ["/api/ml/trades", "closed"],
      queryFn: async () => {
        const r = await fetch("/api/ml/trades?status=closed&limit=1000");
        if (!r.ok) return [];
        const body = await r.json();
        return Array.isArray(body) ? body : [];
      },
      refetchInterval: 30_000,
    });

  const positions: Position[] = useMemo(
    () =>
      openRaw.map((t) => ({
        symbol: t.symbol,
        side: t.side,
        quantity: t.side === "BUY" ? Math.abs(t.quantity) : -Math.abs(t.quantity),
        entryPrice: t.entryPrice,
        pnl: t.pnl ?? 0,
        pnlPct: t.pnlPct ?? 0,
      })),
    [openRaw],
  );

  const equity = useMemo(() => buildEquityCurve(closedRaw), [closedRaw]);
  const drawdown = useMemo(() => buildDrawdownSeries(equity), [equity]);
  const returns = useMemo(() => returnsFromCurve(equity), [equity]);
  const dd = useMemo(() => maxDrawdown(drawdown), [drawdown]);
  const wr = useMemo(() => winRate(closedRaw), [closedRaw]);
  const sharpeAnnual = useMemo(() => {
    if (equity.length < 2) return null;
    const spanMs = equity[equity.length - 1]!.t - equity[0]!.t;
    const years = Math.max(spanMs / (365 * 86_400_000), 0.05);
    const ppy = Math.max(12, Math.min(2000, equity.length / years));
    return sharpe(returns, ppy);
  }, [equity, returns]);

  const totalValue = useMemo(
    () =>
      positions.reduce((s, p) => s + Math.abs(p.quantity) * p.entryPrice, 0),
    [positions],
  );
  const totalPnL = useMemo(
    () => closedRaw.reduce((s, t) => s + (t.pnl ?? 0), 0),
    [closedRaw],
  );

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const monthStart = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const dailyPnL = useMemo(
    () =>
      closedRaw
        .filter((t) => (t.exitTimestamp ?? 0) >= todayStart)
        .reduce((s, t) => s + (t.pnl ?? 0), 0),
    [closedRaw, todayStart],
  );
  const mtdPnL = useMemo(
    () =>
      closedRaw
        .filter((t) => (t.exitTimestamp ?? 0) >= monthStart)
        .reduce((s, t) => s + (t.pnl ?? 0), 0),
    [closedRaw, monthStart],
  );

  const allocation = useMemo(() => {
    return exposureBy(
      positions.map((p) => ({
        symbol: p.symbol,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
      })),
      "symbol",
    );
  }, [positions]);

  const kpis: Kpi[] = [
    { label: "NAV", value: fmtUsd(totalValue) },
    {
      label: "Total P&L",
      value: fmtUsd(totalPnL),
      delta: {
        value: fmtUsd(totalPnL),
        direction: totalPnL > 0 ? "pos" : totalPnL < 0 ? "neg" : "neutral",
      },
    },
    {
      label: "Daily P&L",
      value: fmtUsd(dailyPnL),
      delta: {
        value: fmtUsd(dailyPnL),
        direction: dailyPnL > 0 ? "pos" : dailyPnL < 0 ? "neg" : "neutral",
      },
    },
    {
      label: "MTD P&L",
      value: fmtUsd(mtdPnL),
      delta: {
        value: fmtUsd(mtdPnL),
        direction: mtdPnL > 0 ? "pos" : mtdPnL < 0 ? "neg" : "neutral",
      },
    },
    { label: "Open pos", value: fmtInt(positions.length) },
    { label: "Win rate", value: fmtPct(wr, 1) },
    { label: "Sharpe", value: fmtNum(sharpeAnnual, 2) },
    {
      label: "Max DD",
      value: fmtPct(dd, 2),
      hint: "Worst peak-to-trough drawdown observed",
    },
  ];

  const positionColumns = useMemo<ColumnDef<Position, unknown>[]>(() => {
    return [
      {
        id: "symbol",
        header: "Sym",
        accessorFn: (p) => p.symbol,
        cell: (ctx) => (
          <span className="font-mono text-[12px] text-primary">
            {ctx.row.original.symbol}
          </span>
        ),
        meta: { align: "left", mono: true, width: 72 },
      },
      {
        id: "side",
        header: "Side",
        accessorFn: (p) => p.side,
        cell: (ctx) => (
          <span
            className={`font-mono text-[11px] ${
              ctx.row.original.side === "BUY"
                ? "text-[hsl(var(--data-pos))]"
                : "text-[hsl(var(--data-neg))]"
            }`}
          >
            {ctx.row.original.side}
          </span>
        ),
        meta: { align: "left", mono: true, width: 56 },
      },
      {
        id: "qty",
        header: "Qty",
        accessorFn: (p) => p.quantity,
        cell: (ctx) => (
          <MetricCell value={fmtNum(ctx.row.original.quantity, 0)} tone="neutral" />
        ),
        meta: { align: "right", mono: true, width: 72 },
      },
      {
        id: "entry",
        header: "Entry",
        accessorFn: (p) => p.entryPrice,
        cell: (ctx) => (
          <MetricCell value={fmtNum(ctx.row.original.entryPrice, 4)} tone="neutral" />
        ),
        meta: { align: "right", mono: true, width: 96 },
      },
      {
        id: "pnl",
        header: "P&L",
        accessorFn: (p) => p.pnl,
        cell: (ctx) => (
          <MetricCell
            value={fmtUsd(ctx.row.original.pnl)}
            numeric={ctx.row.original.pnl}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 96 },
      },
      {
        id: "pnlPct",
        header: "%",
        accessorFn: (p) => p.pnlPct,
        cell: (ctx) => (
          <MetricCell
            value={fmtPct(ctx.row.original.pnlPct, 2, { asInteger: true, sign: true })}
            numeric={ctx.row.original.pnlPct}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 80 },
      },
    ];
  }, []);

  const tradeColumns = useMemo<ColumnDef<Trade, unknown>[]>(() => {
    return [
      {
        id: "exitTimestamp",
        header: "Time",
        accessorFn: (t) => t.exitTimestamp ?? 0,
        cell: (ctx) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {fmtRelative(ctx.row.original.exitTimestamp ?? null)}
          </span>
        ),
        meta: { align: "right", mono: true, width: 88 },
        sortDescFirst: true,
      },
      {
        id: "symbol",
        header: "Sym",
        accessorFn: (t) => t.symbol,
        cell: (ctx) => (
          <span className="font-mono text-[12px]">{ctx.row.original.symbol}</span>
        ),
        meta: { align: "left", mono: true, width: 64 },
      },
      {
        id: "side",
        header: "Side",
        accessorFn: (t) => t.side,
        cell: (ctx) => (
          <span
            className={`font-mono text-[11px] ${
              ctx.row.original.side === "BUY"
                ? "text-[hsl(var(--data-pos))]"
                : "text-[hsl(var(--data-neg))]"
            }`}
          >
            {ctx.row.original.side}
          </span>
        ),
        meta: { align: "left", mono: true, width: 52 },
      },
      {
        id: "quantity",
        header: "Qty",
        accessorFn: (t) => t.quantity,
        cell: (ctx) => (
          <MetricCell value={fmtNum(ctx.row.original.quantity, 0)} tone="neutral" />
        ),
        meta: { align: "right", mono: true, width: 60 },
      },
      {
        id: "entryPrice",
        header: "Entry",
        accessorFn: (t) => t.entryPrice,
        cell: (ctx) => (
          <MetricCell value={fmtNum(ctx.row.original.entryPrice, 4)} tone="neutral" />
        ),
        meta: { align: "right", mono: true, width: 96 },
      },
      {
        id: "exitPrice",
        header: "Exit",
        accessorFn: (t) => t.exitPrice ?? 0,
        cell: (ctx) => (
          <MetricCell value={fmtNum(ctx.row.original.exitPrice ?? null, 4)} tone="neutral" />
        ),
        meta: { align: "right", mono: true, width: 96 },
      },
      {
        id: "pnl",
        header: "P&L",
        accessorFn: (t) => t.pnl ?? 0,
        cell: (ctx) => (
          <MetricCell
            value={fmtUsd(ctx.row.original.pnl ?? null)}
            numeric={ctx.row.original.pnl ?? null}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 100 },
      },
      {
        id: "pnlPct",
        header: "%",
        accessorFn: (t) => t.pnlPct ?? 0,
        cell: (ctx) => (
          <MetricCell
            value={fmtPct(ctx.row.original.pnlPct ?? null, 2, {
              asInteger: true,
              sign: true,
            })}
            numeric={ctx.row.original.pnlPct ?? null}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 80 },
      },
      {
        id: "commission",
        header: "Comm",
        accessorFn: (t) => t.commission ?? 0,
        cell: (ctx) => (
          <MetricCell
            value={fmtNum(ctx.row.original.commission ?? null, 2)}
            tone="neutral"
            compact
          />
        ),
        meta: { align: "right", mono: true, width: 72 },
      },
      {
        id: "slippage",
        header: "Slip",
        accessorFn: (t) => t.slippage ?? 0,
        cell: (ctx) => (
          <MetricCell
            value={fmtNum(ctx.row.original.slippage ?? null, 4)}
            tone="neutral"
            compact
          />
        ),
        meta: { align: "right", mono: true, width: 72 },
      },
    ];
  }, []);

  return (
    <PageShell
      title="Portfolio"
      subtitle={`${positions.length} open · ${closedRaw.length} closed`}
      icon={Wallet}
      status={{
        label: loadingOpen || loadingClosed ? "Syncing" : "Live",
        tone: "info",
        pulse: loadingOpen || loadingClosed,
      }}
      actions={[
        {
          label: "Refresh",
          icon: RefreshCw,
          onClick: () => {
            refetchOpen();
            refetchClosed();
          },
          variant: "ghost",
        },
      ]}
      kpis={kpis}
    >
      <div className="space-y-3">
        {/* Row 1: open positions (8) + allocation pie (4) */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <section className="lg:col-span-8 rounded-md border border-border/40 bg-card/40">
            <div className="border-b border-border/40 px-3 py-1.5">
              <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Open positions ({positions.length})
              </h3>
            </div>
            <div className="max-h-[320px]">
              <DenseTable<Position>
                columns={positionColumns}
                data={positions}
                getRowId={(row) => row.symbol + row.side}
                defaultSorting={[{ id: "pnl", desc: true }]}
                dense
                emptyState={
                  loadingOpen
                    ? "Loading…"
                    : "No open positions — fills appear as trades are recorded."
                }
                testId="open-positions"
              />
            </div>
          </section>

          <section className="lg:col-span-4 rounded-md border border-border/40 bg-card/40 p-3">
            <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Allocation
            </h3>
            <AllocationPie
              rows={allocation.map((r) => ({
                name: r.name,
                value: r.value,
              }))}
            />
          </section>
        </div>

        {/* Row 2: equity + drawdown */}
        <section className="rounded-md border border-border/40 bg-card/40">
          <div className="border-b border-border/40 px-3 py-1.5">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Equity curve + drawdown
            </h3>
          </div>
          <div className="p-2">
            <EquityCurve points={equity} />
            <DrawdownChart series={drawdown} height={120} />
          </div>
        </section>

        {/* Row 3: trade history */}
        <section className="rounded-md border border-border/40 bg-card/40">
          <div className="border-b border-border/40 px-3 py-1.5">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Trade history ({closedRaw.length})
            </h3>
          </div>
          <div className="max-h-[520px]">
            <DenseTable<Trade>
              columns={tradeColumns}
              data={closedRaw}
              getRowId={(row) => String(row.id)}
              defaultSorting={[{ id: "exitTimestamp", desc: true }]}
              dense
              emptyState={
                loadingClosed
                  ? "Loading…"
                  : "No closed trades. Trade history will appear here once trades fill and exit."
              }
              testId="trade-history"
            />
          </div>
        </section>
      </div>
    </PageShell>
  );
}

function EquityCurve({ points }: { points: { t: number; equity: number }[] }) {
  if (points.length === 0) {
    return (
      <div className="flex h-[140px] items-center justify-center text-[11px] text-muted-foreground">
        No equity history — run a backtest or wait for trades to close.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={points} margin={{ top: 6, right: 8, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id="portfolio-equity-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--data-pos))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="hsl(var(--data-pos))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="2 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="t"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v) => new Date(v).toLocaleDateString()}
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
          labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
          formatter={(v: number) => [fmtUsd(v), "Equity"]}
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke="hsl(var(--data-pos))"
          strokeWidth={1.5}
          fill="url(#portfolio-equity-grad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function AllocationPie({ rows }: { rows: { name: string; value: number }[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-[11px] text-muted-foreground">
        No allocation data.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <ResponsiveContainer width="55%" height={200}>
        <PieChart>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={36}
            outerRadius={70}
            stroke="hsl(var(--background))"
            strokeWidth={2}
          >
            {rows.map((_r, i) => (
              <Cell key={i} fill={`hsl(var(${CAT_VARS[i % CAT_VARS.length]}))`} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 4,
              fontSize: 11,
            }}
            formatter={(v: number) => [fmtUsd(v, 0), "Notional"]}
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="flex-1 space-y-1 overflow-y-auto" style={{ maxHeight: 200 }}>
        {rows.map((r, i) => {
          const total = rows.reduce((s, x) => s + x.value, 0);
          const pct = total > 0 ? r.value / total : 0;
          return (
            <li
              key={r.name}
              className="flex items-center gap-2 font-mono text-[11px]"
            >
              <span
                className="block h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: `hsl(var(${CAT_VARS[i % CAT_VARS.length]}))` }}
              />
              <span className="truncate text-foreground/90">{r.name}</span>
              <span className="ml-auto text-muted-foreground">
                {fmtPct(pct, 1)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
