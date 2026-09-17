/**
 * Portfolio — positions and risk, in two tabs.
 *
 *   Positions  open positions, allocation, trade history
 *   Risk       rolling Sharpe, exposure, correlation, stress scenarios
 *
 * This was two sidebar entries (`/portfolio` and `/risk`) until the nav was
 * consolidated. They were never independent: Risk derives every number it shows
 * from the same closed and open trades Portfolio lists, so they were two views
 * of one dataset fetched twice.
 *
 * ONE PAIR OF QUERIES, NOT TWO. The separate pages ran four `/api/ml/trades`
 * requests between them — `["/api/ml/trades","closed"]` at limit 1000 and
 * `[...,"closed","risk"]` at limit 2000, plus the same split for open positions
 * — so the two pages could disagree about the portfolio while sitting one click
 * apart. Risk's limits were the supersets, so they are the ones kept.
 *
 * The equity curve and drawdown are rendered ONCE, above the tabs: both pages
 * built the identical curve from `buildEquityCurve`, and it is the spine both
 * views read against.
 *
 * TWO KPIs WERE RENAMED, because merging put them on one page and they
 * contradicted each other:
 *   - Portfolio's "NAV" was Σ|quantity × entryPrice| over OPEN positions. That
 *     is gross notional exposure, not net asset value — and it is the same
 *     number Risk already showed under the correct name "Gross expo". It is now
 *     "Gross exposure" in both places.
 *   - Risk's "NAV" was the last point of the REALIZED P&L curve — cumulative
 *     closed-trade P&L, which is not NAV either. It is now "Realized equity".
 * Sharpe likewise had two definitions (the pages estimated periods-per-year
 * differently); both tabs now use Risk's, which falls back to 252 when the
 * sample spans too little calendar time to estimate from.
 *
 * Data sources:
 *   /api/ml/trades?status=closed&limit=2000  — equity curve, returns, P&L
 *   /api/ml/trades?status=open&limit=500     — positions, exposure, scenarios
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wallet, AlertTriangle, RefreshCw } from "lucide-react";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
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
  ExposureBars,
  CorrelationMatrix,
  RollingSharpe,
  type Kpi,
} from "@/backtest/components";
import {
  buildEquityCurve,
  buildDrawdownSeries,
  maxDrawdown,
  returnsFromCurve,
  sharpe,
  sortino,
  historicalVaR,
  expectedShortfall,
  exposureBy,
  correlationMatrix,
  returnSeriesBySymbol,
  winRate,
  profitFactor,
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

interface ScenarioRow {
  name: string;
  shock: string;
  impact: number;
  impactPct: number;
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

type PortfolioTab = "positions" | "risk";

export default function Portfolio() {
  const [tab, setTab] = useState<PortfolioTab>("positions");

  useBreadcrumbs([{ label: tab === "risk" ? "Risk" : "Portfolio" }]);

  const { data: openRaw = [], isLoading: loadingOpen, refetch: refetchOpen } =
    useQuery<Trade[]>({
      queryKey: ["/api/ml/trades", "open"],
      queryFn: async () => {
        const r = await fetch("/api/ml/trades?status=open&limit=500");
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
        const r = await fetch("/api/ml/trades?status=closed&limit=2000");
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

  // ── Shared derivations. Both tabs read these; nothing is computed twice. ──

  const equity = useMemo(() => buildEquityCurve(closedRaw), [closedRaw]);
  const drawdown = useMemo(() => buildDrawdownSeries(equity), [equity]);
  const returns = useMemo(() => returnsFromCurve(equity), [equity]);

  const periodsPerYear = useMemo(() => {
    if (equity.length < 2) return 252;
    // Estimate: trades per year ≈ trades × (365d / span_in_days). Falls back to
    // 252 when the span is too short for that estimate to mean anything.
    const spanMs = equity[equity.length - 1]!.t - equity[0]!.t;
    if (spanMs <= 0) return 252;
    const years = spanMs / (365 * 86_400_000);
    if (years < 0.05) return 252;
    return Math.max(12, Math.min(2000, equity.length / years));
  }, [equity]);

  const realizedEquity = equity.length > 0 ? equity[equity.length - 1]!.equity : 0;
  const maxDD = useMemo(() => maxDrawdown(drawdown), [drawdown]);
  const wr = useMemo(() => winRate(closedRaw), [closedRaw]);
  const pf = useMemo(() => profitFactor(closedRaw), [closedRaw]);
  const var99 = useMemo(() => historicalVaR(returns, 0.99), [returns]);
  const es99 = useMemo(() => expectedShortfall(returns, 0.99), [returns]);
  const sharpeAnnual = useMemo(
    () => sharpe(returns, periodsPerYear),
    [returns, periodsPerYear],
  );
  const sortinoAnnual = useMemo(
    () => sortino(returns, periodsPerYear),
    [returns, periodsPerYear],
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

  // Allocation (pie) and exposure (bars) are the same aggregation — notional by
  // symbol — drawn two ways, so they share one computation.
  const exposureBySymbol = useMemo(
    () =>
      exposureBy(
        positions.map((p) => ({
          symbol: p.symbol,
          quantity: p.quantity,
          entryPrice: p.entryPrice,
        })),
        "symbol",
      ),
    [positions],
  );

  const grossExposure = useMemo(
    () => positions.reduce((s, p) => s + Math.abs(p.quantity * p.entryPrice), 0),
    [positions],
  );
  const netExposure = useMemo(
    () => positions.reduce((s, p) => s + p.quantity * p.entryPrice, 0),
    [positions],
  );

  const { symbols, m } = useMemo(() => {
    const series = returnSeriesBySymbol(closedRaw);
    return correlationMatrix(series);
  }, [closedRaw]);

  const scenarioRows = useMemo<ScenarioRow[]>(() => {
    if (positions.length === 0) return [];
    return [
      { name: "Equity −5%", shock: "−5% across long delta", factor: -0.05 },
      { name: "Equity −10%", shock: "−10% across long delta", factor: -0.1 },
      { name: "Vol +50%", shock: "vol expansion → drawdown proxy", factor: -0.04 },
      { name: "USD spike", shock: "+5% USD vs majors", factor: -0.03 },
      { name: "Rates +200bp", shock: "rate-sensitive symbols hit", factor: -0.025 },
      { name: "Liquidity event", shock: "spread × 5 on exit", factor: -0.015 },
    ].map((sc) => ({
      name: sc.name,
      shock: sc.shock,
      impact: grossExposure * sc.factor,
      impactPct: sc.factor,
    }));
  }, [positions.length, grossExposure]);

  // ── KPI strips, one per tab. ───────────────────────────────────────────────

  const positionKpis: Kpi[] = [
    {
      label: "Gross exposure",
      value: fmtUsd(grossExposure, 0),
      hint: "Σ |quantity × entry| over open positions — notional at risk, not NAV",
    },
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
      value: fmtPct(maxDD, 2),
      hint: "Worst peak-to-trough drawdown observed",
    },
  ];

  const riskKpis: Kpi[] = [
    {
      label: "Realized equity",
      value: fmtUsd(realizedEquity),
      hint: "Cumulative closed-trade P&L — the last point of the equity curve",
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
    {
      label: "99% VaR",
      value: fmtPct(var99, 2),
      hint: "Historical 99th-percentile loss on trade-level returns",
    },
    {
      label: "99% ES",
      value: fmtPct(es99, 2),
      hint: "Expected shortfall — mean of returns worse than VaR",
    },
    { label: "Gross exposure", value: fmtUsd(grossExposure, 0) },
    {
      label: "Net expo",
      value: fmtUsd(netExposure, 0),
      delta: {
        value: fmtUsd(netExposure, 0),
        direction: netExposure > 0 ? "pos" : netExposure < 0 ? "neg" : "neutral",
      },
    },
    { label: "Sharpe", value: fmtNum(sharpeAnnual, 2) },
    { label: "Sortino", value: fmtNum(sortinoAnnual, 2) },
    {
      label: "Max DD",
      value: fmtPct(maxDD, 2),
      hint: "Worst peak-to-trough drawdown observed",
    },
    {
      label: "Win rate",
      value: fmtPct(wr, 1),
      hint: "Fraction of closed trades with positive P&L",
    },
    { label: "Profit factor", value: fmtNum(pf, 2) },
  ];

  // ── Table columns. ─────────────────────────────────────────────────────────

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

  const scenarioColumns = useMemo<ColumnDef<ScenarioRow, unknown>[]>(() => {
    return [
      {
        id: "name",
        header: "Scenario",
        accessorFn: (r) => r.name,
        cell: (ctx) => <span className="text-[12px]">{ctx.row.original.name}</span>,
        meta: { align: "left", mono: false, width: 160 },
      },
      {
        id: "shock",
        header: "Shock definition",
        accessorFn: (r) => r.shock,
        cell: (ctx) => (
          <span className="text-[11px] text-muted-foreground">{ctx.row.original.shock}</span>
        ),
        meta: { align: "left", mono: false, width: 280 },
        enableSorting: false,
      },
      {
        id: "impactPct",
        header: "Impact %",
        accessorFn: (r) => r.impactPct,
        cell: (ctx) => (
          <MetricCell
            value={fmtPct(ctx.row.original.impactPct, 2, { sign: true })}
            numeric={ctx.row.original.impactPct}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 96 },
      },
      {
        id: "impact",
        header: "Impact $",
        accessorFn: (r) => r.impact,
        cell: (ctx) => (
          <MetricCell
            value={fmtUsd(ctx.row.original.impact)}
            numeric={ctx.row.original.impact}
            tone="auto"
          />
        ),
        meta: { align: "right", mono: true, width: 120 },
      },
    ];
  }, []);

  const isLoading = loadingOpen || loadingClosed;

  return (
    <PageShell
      title="Portfolio"
      subtitle={`${positions.length} open · ${closedRaw.length} closed`}
      icon={Wallet}
      status={{ label: isLoading ? "Syncing" : "Live", tone: "info", pulse: isLoading }}
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
      kpis={tab === "risk" ? riskKpis : positionKpis}
    >
      <div className="space-y-3">
        {/* Shared spine: both tabs read against this, so it is drawn once. */}
        <section className="rounded-md border border-border/40 bg-card/40">
          <div className="border-b border-border/40 px-3 py-1.5">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Equity curve + drawdown
            </h3>
          </div>
          <div className="p-2">
            <EquityCurve points={equity} />
            <DrawdownChart series={drawdown} height={140} />
          </div>
        </section>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as PortfolioTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="w-fit">
            <TabsTrigger value="positions" data-testid="tab-positions">
              <Wallet className="mr-1.5 h-3.5 w-3.5" />
              Positions
            </TabsTrigger>
            <TabsTrigger value="risk" data-testid="tab-risk">
              <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
              Risk
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions" className="mt-3 flex flex-col gap-3">
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
                  rows={exposureBySymbol.map((r) => ({ name: r.name, value: r.value }))}
                />
              </section>
            </div>

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
          </TabsContent>

          <TabsContent value="risk" className="mt-3 flex flex-col gap-3">
            <section className="rounded-md border border-border/40 bg-card/40">
              <div className="border-b border-border/40 px-3 py-1.5">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Rolling Sharpe (20/60/252)
                </h3>
              </div>
              <div className="p-2">
                <RollingSharpe
                  returns={returns}
                  windows={[20, 60, 252]}
                  periodsPerYear={periodsPerYear}
                  height={240}
                />
              </div>
            </section>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <section className="rounded-md border border-border/40 bg-card/40 p-3">
                <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Exposure by symbol
                </h3>
                <ExposureBars rows={exposureBySymbol} formatValue={(v) => fmtUsd(v, 0)} />
              </section>

              <section className="rounded-md border border-border/40 bg-card/40 p-3">
                <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Correlation matrix · symbols
                </h3>
                <CorrelationMatrix symbols={symbols} m={m} height={280} />
              </section>
            </div>

            <section className="rounded-md border border-border/40 bg-card/40">
              <div className="border-b border-border/40 px-3 py-1.5">
                <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Stress scenarios · applied to gross exposure of {fmtUsd(grossExposure, 0)}
                </h3>
              </div>
              <DenseTable<ScenarioRow>
                columns={scenarioColumns}
                data={scenarioRows}
                getRowId={(row) => row.name}
                defaultSorting={[{ id: "impact", desc: false }]}
                dense
                emptyState="No open positions — scenarios need notional to evaluate."
                testId="stress-scenarios"
              />
            </section>
          </TabsContent>
        </Tabs>
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
            <li key={r.name} className="flex items-center gap-2 font-mono text-[11px]">
              <span
                className="block h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: `hsl(var(${CAT_VARS[i % CAT_VARS.length]}))` }}
              />
              <span className="truncate text-foreground/90">{r.name}</span>
              <span className="ml-auto text-muted-foreground">{fmtPct(pct, 1)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
