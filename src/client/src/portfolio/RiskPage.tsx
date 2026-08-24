/**
 * Risk — portfolio risk dashboard.
 *
 * Layout:
 *   ┌─ PageHeader · Risk                                                ──┐
 *   ├─ KpiStrip · NAV · DAILY · MTD · 99% VaR · 99% ES · GROSS · NET · SORT
 *   ├─ Row 1 span 8/4 · Equity + Drawdown (split) · Rolling Sharpe overlay
 *   ├─ Row 2 span 6/6 · ExposureBars · CorrelationMatrix
 *   └─ Row 3 span 12 · Stress scenarios (DenseTable)
 *
 * Data sources:
 *   /api/ml/trades?status=closed  — return series, equity curve
 *   /api/ml/trades?status=open    — open positions for exposure
 *
 * Stress scenarios are computed client-side from positions × scenario shocks.
 * Until the backend exposes named historical scenarios, we ship a curated set
 * of generic shocks (−5% equity, +200bp rates, +50% vol, USD spike) computed
 * against current notional.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
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
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
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
import { fmtUsd, fmtPct, fmtNum, fmtDuration } from "@/shared/utils/format";
import type { Trade } from "@/shared/utils/types";
import type { ColumnDef } from "@tanstack/react-table";

interface ScenarioRow {
  name: string;
  shock: string;
  impact: number;
  impactPct: number;
}

export default function Risk() {
  useBreadcrumbs([{ label: "Risk" }]);

  const { data: closedTrades = [], isFetching: closedFetching, refetch: refetchClosed } =
    useQuery<Trade[]>({
      queryKey: ["/api/ml/trades", "closed", "risk"],
      queryFn: async () => {
        const r = await fetch("/api/ml/trades?status=closed&limit=2000");
        if (!r.ok) return [];
        const body = await r.json();
        return Array.isArray(body) ? body : [];
      },
      refetchInterval: 30_000,
    });

  const { data: openTrades = [], refetch: refetchOpen } = useQuery<Trade[]>({
    queryKey: ["/api/ml/trades", "open", "risk"],
    queryFn: async () => {
      const r = await fetch("/api/ml/trades?status=open&limit=500");
      if (!r.ok) return [];
      const body = await r.json();
      return Array.isArray(body) ? body : [];
    },
    refetchInterval: 15_000,
  });

  const equity = useMemo(() => buildEquityCurve(closedTrades), [closedTrades]);
  const drawdown = useMemo(() => buildDrawdownSeries(equity), [equity]);
  const returns = useMemo(() => returnsFromCurve(equity), [equity]);
  const periodsPerYear = useMemo(() => {
    if (equity.length < 2) return 252;
    // Estimate: trades per year ≈ trades × (365d / span_in_days). We use 252
    // when the span is too short for a meaningful estimate.
    const spanMs = equity[equity.length - 1]!.t - equity[0]!.t;
    if (spanMs <= 0) return 252;
    const years = spanMs / (365 * 86_400_000);
    if (years < 0.05) return 252;
    return Math.max(12, Math.min(2000, equity.length / years));
  }, [equity]);

  const nav = equity.length > 0 ? equity[equity.length - 1]!.equity : 0;
  const var99 = useMemo(() => historicalVaR(returns, 0.99), [returns]);
  const es99 = useMemo(() => expectedShortfall(returns, 0.99), [returns]);
  const sharpeAnnual = useMemo(() => sharpe(returns, periodsPerYear), [returns, periodsPerYear]);
  const sortinoAnnual = useMemo(() => sortino(returns, periodsPerYear), [returns, periodsPerYear]);
  const wr = useMemo(() => winRate(closedTrades), [closedTrades]);
  const pf = useMemo(() => profitFactor(closedTrades), [closedTrades]);
  const maxDD = useMemo(() => maxDrawdown(drawdown), [drawdown]);

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
      closedTrades
        .filter((t) => (t.exitTimestamp ?? 0) >= todayStart)
        .reduce((s, t) => s + (t.pnl ?? 0), 0),
    [closedTrades, todayStart],
  );
  const mtdPnL = useMemo(
    () =>
      closedTrades
        .filter((t) => (t.exitTimestamp ?? 0) >= monthStart)
        .reduce((s, t) => s + (t.pnl ?? 0), 0),
    [closedTrades, monthStart],
  );

  const positionsForExposure = useMemo(() => {
    return openTrades.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      quantity: t.quantity,
      entryPrice: t.entryPrice,
    }));
  }, [openTrades]);

  const exposureBySymbol = useMemo(
    () => exposureBy(positionsForExposure, "symbol"),
    [positionsForExposure],
  );

  const grossExposure = useMemo(
    () => positionsForExposure.reduce((s, p) => s + Math.abs(p.quantity * p.entryPrice), 0),
    [positionsForExposure],
  );
  const netExposure = useMemo(
    () =>
      positionsForExposure.reduce(
        (s, p) => s + (p.side === "BUY" ? 1 : -1) * Math.abs(p.quantity * p.entryPrice),
        0,
      ),
    [positionsForExposure],
  );

  const { symbols, m } = useMemo(() => {
    const series = returnSeriesBySymbol(closedTrades);
    return correlationMatrix(series);
  }, [closedTrades]);

  const scenarioRows = useMemo<ScenarioRow[]>(() => {
    if (positionsForExposure.length === 0) return [];
    return [
      { name: "Equity −5%", shock: "−5% across long delta", factor: -0.05 },
      { name: "Equity −10%", shock: "−10% across long delta", factor: -0.10 },
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
  }, [positionsForExposure.length, grossExposure]);

  const kpis: Kpi[] = [
    { label: "NAV", value: fmtUsd(nav) },
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
    { label: "Gross expo", value: fmtUsd(grossExposure, 0) },
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

  const isLoading = closedFetching;

  return (
    <PageShell
      title="Risk"
      subtitle={`Portfolio risk · ${closedTrades.length} closed trades · ${openTrades.length} open positions · ${fmtDuration(undefined)}`}
      icon={AlertTriangle}
      status={{ label: isLoading ? "Syncing" : "Live", tone: "info", pulse: isLoading }}
      actions={[
        {
          label: "Refresh",
          icon: RefreshCw,
          onClick: () => {
            refetchClosed();
            refetchOpen();
          },
          variant: "ghost",
        },
      ]}
      kpis={kpis}
    >
      <div className="space-y-3">
        {/* Row 1: equity + drawdown (8) | rolling sharpe (4) */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <section className="lg:col-span-8 rounded-md border border-border/40 bg-card/40">
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

          <section className="lg:col-span-4 rounded-md border border-border/40 bg-card/40">
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
                height={320}
              />
            </div>
          </section>
        </div>

        {/* Row 2: exposure (6) | correlation (6) */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <section className="rounded-md border border-border/40 bg-card/40 p-3">
            <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Exposure by symbol
            </h3>
            <ExposureBars
              rows={exposureBySymbol}
              formatValue={(v) => fmtUsd(v, 0)}
            />
          </section>

          <section className="rounded-md border border-border/40 bg-card/40 p-3">
            <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Correlation matrix · symbols
            </h3>
            <CorrelationMatrix symbols={symbols} m={m} height={280} />
          </section>
        </div>

        {/* Row 3: stress scenarios */}
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
      </div>
    </PageShell>
  );
}

interface EquityCurveProps {
  points: { t: number; equity: number }[];
}

function EquityCurve({ points }: EquityCurveProps) {
  if (points.length === 0) {
    return (
      <div className="flex h-[140px] items-center justify-center text-[11px] text-muted-foreground">
        No equity history.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={points} margin={{ top: 6, right: 8, left: 0, bottom: 2 }}>
        <defs>
          <linearGradient id="equity-grad-risk" x1="0" y1="0" x2="0" y2="1">
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
          fill="url(#equity-grad-risk)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
