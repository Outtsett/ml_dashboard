/**
 * RiskPanel — the risk half of what used to be the Portfolio page, now a tab
 * of ML Studio.
 *
 * Risk and Positions were merged into one page on 2026-09-16 because Risk
 * derives every number it shows from the same trade ledger Positions lists.
 * That pipeline is unchanged here — trades to equity curve to drawdown to the
 * rolling statistics. Only the positions table and the tab chrome are gone,
 * with the Portfolio entry it lived under.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
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
import { fmtUsd, fmtPct, fmtNum } from "@/shared/utils/format";
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


export function RiskPanel() {

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
      title="Risk"
      subtitle={`${positions.length} open · ${closedRaw.length} closed`}
      icon={AlertTriangle}
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
      kpis={riskKpis}
    >
      <div className="space-y-3">
        {/* The spine every risk statistic below is derived from. */}
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

          <div className="mt-3 flex flex-col gap-3">
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
          </div>
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

