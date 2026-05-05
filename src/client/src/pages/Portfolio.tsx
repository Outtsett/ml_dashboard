import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { ErrorCard } from "@/components/ui/error-card";
import { 
  TrendingUp, Wallet, 
  Target, Activity, BarChart2
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import type { Trade } from "@/lib/types";

// Sub-components
import { PortfolioStatsHeader } from "./portfolio/PortfolioStatsHeader";
import { PortfolioAllocation } from "./portfolio/PortfolioAllocation";
import { OpenPositions } from "./portfolio/OpenPositions";
import { TradeHistory } from "./portfolio/TradeHistory";
import { 
  type Position, 
  type AllocationEntry, 
  type EquityPoint, 
  type RecentTrade,
  COLORS 
} from "./portfolio/types";

export default function Portfolio() {
  // ── Data Fetching ──────────────────────────────────────────────────────
  const { data: openTradesRaw = [], isLoading: loadingOpen, isError: isErrorOpen, error: errorOpen, refetch: refetchOpen } = useQuery<Trade[]>({
    queryKey: ['/api/ml/trades', 'open'],
    queryFn: async () => {
      const res = await fetch('/api/ml/trades?status=open&limit=100');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: closedTradesRaw = [], isLoading: loadingClosed, isError: isErrorClosed, error: errorClosed, refetch: refetchClosed } = useQuery<Trade[]>({
    queryKey: ['/api/ml/trades', 'closed'],
    queryFn: async () => {
      const res = await fetch('/api/ml/trades?status=closed&limit=50');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: backtestRuns } = useQuery<any[]>({
    queryKey: ['backtest-runs'],
    queryFn: async () => {
      const res = await fetch('/api/backtest/runs?limit=1');
      if (!res.ok) return null;
      return res.json();
    },
  });

  const isLoading = loadingOpen || loadingClosed;
  const isError = isErrorOpen || isErrorClosed;

  // ── Derived State ──────────────────────────────────────────────────────
  const positions: Position[] = useMemo(() =>
    openTradesRaw.map((t) => ({
      symbol: t.symbol,
      name: t.symbol,
      quantity: t.side === 'BUY' ? t.quantity : -t.quantity,
      avgPrice: t.entryPrice,
      currentPrice: t.entryPrice, // mark-to-market fallback
      pnl: t.pnl ?? 0,
      pnlPercent: t.pnlPct ?? 0,
    })),
  [openTradesRaw]);

  const allocationData: AllocationEntry[] = useMemo(() => {
    if (positions.length === 0) return [];
    const grouped = new Map<string, number>();
    let totalNotional = 0;
    for (const p of positions) {
      const notional = Math.abs(p.quantity) * p.currentPrice;
      grouped.set(p.symbol, (grouped.get(p.symbol) ?? 0) + notional);
      totalNotional += notional;
    }
    if (totalNotional === 0) return [];
    return Array.from(grouped.entries()).map(([name, notional], i) => ({
      name,
      value: Math.round((notional / totalNotional) * 1000) / 10, // 1 decimal %
      color: COLORS[i % COLORS.length] ?? '#8b5cf6',
    }));
  }, [positions]);

  const recentTrades: RecentTrade[] = useMemo(() =>
    closedTradesRaw.map((t) => ({
      time: t.exitTimestamp ? new Date(t.exitTimestamp).toLocaleString() : '--',
      symbol: t.symbol,
      side: t.side,
      qty: t.quantity,
      price: t.exitPrice ?? t.entryPrice,
      pnl: t.pnl ?? null,
    })),
  [closedTradesRaw]);

  const equityCurve: EquityPoint[] = useMemo(() => {
    // Prefer backtest equity curve if available
    const latestRun = Array.isArray(backtestRuns) && backtestRuns.length > 0 ? backtestRuns[0] : null;
    if (latestRun?.equityCurve) {
      try {
        const parsed = typeof latestRun.equityCurve === 'string'
          ? JSON.parse(latestRun.equityCurve)
          : latestRun.equityCurve;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((pt: any) => ({
            date: pt.date ?? new Date(pt.timestamp ?? pt.t ?? 0).toLocaleDateString(),
            value: pt.value ?? pt.equity ?? pt.v ?? 0,
          }));
        }
      } catch { /* fall through to cumulative P&L */ }
    }
    // Fallback: build from closed trades cumulative P&L
    if (closedTradesRaw.length === 0) return [];
    const sorted = [...closedTradesRaw]
      .filter((t) => t.exitTimestamp)
      .sort((a, b) => (a.exitTimestamp ?? 0) - (b.exitTimestamp ?? 0));
    let cumPnL = 0;
    return sorted.map((t) => {
      cumPnL += t.pnl ?? 0;
      return {
        date: new Date(t.exitTimestamp!).toLocaleDateString(),
        value: Math.round(cumPnL * 100) / 100,
      };
    });
  }, [closedTradesRaw, backtestRuns]);

  // ── KPIs ───────────────────────────────────────────────────────────────
  const totalValue = positions.reduce((sum, p) => sum + p.currentPrice * Math.abs(p.quantity), 0);
  const totalPnL = closedTradesRaw.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  }, []);
  const dailyPnL = useMemo(() =>
    closedTradesRaw
      .filter((t) => (t.exitTimestamp ?? 0) >= todayStart)
      .reduce((sum, t) => sum + (t.pnl ?? 0), 0),
  [closedTradesRaw, todayStart]);

  const winRate = useMemo(() => {
    if (closedTradesRaw.length === 0) return null;
    const wins = closedTradesRaw.filter((t) => (t.pnl ?? 0) > 0).length;
    return Math.round((wins / closedTradesRaw.length) * 1000) / 10;
  }, [closedTradesRaw]);

  const openPositionsCount = positions.length;

  if (isError) {
    return (
      <div className="space-y-5 h-[calc(100vh-8.5rem)] flex flex-col overflow-hidden">
        <ErrorCard
          title="Failed to load portfolio"
          description="Could not fetch trade data from the server."
          error={errorOpen ?? errorClosed}
          onRetry={() => { refetchOpen(); refetchClosed(); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 h-[calc(100vh-8.5rem)] flex flex-col overflow-hidden">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500/30 to-cyan-500/30 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-violet-300" />
            </div>
            <span className="text-sm font-medium text-violet-300/80">Portfolio Management</span>
          </div>
          <h1 className="text-4xl font-display font-bold bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">Portfolio</h1>
          <p className="text-muted-foreground text-sm mt-1">Positions, P&L tracking, and allocation analysis</p>
        </div>
        <div className="flex gap-3 items-center">
          <div className="bg-gradient-to-br from-violet-500/10 to-violet-600/5 rounded-xl px-4 py-2 border border-violet-500/20 flex items-center gap-2">
            <Activity className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-mono text-violet-300">{openPositionsCount} Open Positions</span>
          </div>
          <div className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 rounded-xl px-4 py-2 border border-cyan-500/20 flex items-center gap-2">
            <Target className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-mono text-cyan-300">Orders via MotiveWave</span>
          </div>
        </div>
      </div>

      <PortfolioStatsHeader 
        isLoading={isLoading}
        positions={positions}
        closedTradesRaw={closedTradesRaw}
        totalValue={totalValue}
        totalPnL={totalPnL}
        dailyPnL={dailyPnL}
        winRate={winRate}
      />

      {/* Main Content */}
      {!isLoading && positions.length === 0 && closedTradesRaw.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 min-h-0 flex items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarChart2 />
              </EmptyMedia>
              <EmptyTitle>No positions yet</EmptyTitle>
              <EmptyDescription>Your portfolio is empty. Start trading to see your positions and performance here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </motion.div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 flex-1 min-h-0 overflow-hidden">
            <OpenPositions isLoading={isLoading} positions={positions} />

            {/* Right Column */}
            <div className="flex flex-col gap-4 min-h-0 overflow-hidden">
              <PortfolioAllocation allocationData={allocationData} />
              <TradeHistory isLoading={isLoading} recentTrades={recentTrades} />
            </div>
          </div>

          {/* Equity Curve */}
          <Card className="h-48 shrink-0 glass rounded-2xl gradient-border flex flex-col overflow-hidden">
            <CardHeader className="border-b border-white/5 py-2 px-4 shrink-0">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-400" /> Equity Curve
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-2">
              {equityCurve.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <TrendingUp className="h-6 w-6 mr-2 opacity-20" />
                  <span className="text-xs">{isLoading ? 'Loading equity data…' : 'No equity data — run a backtest or close some trades'}</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityCurve}>
                    <defs>
                      <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(260, 80%, 70%)" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="hsl(260, 80%, 70%)" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.3)" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.9)', backdropFilter: 'blur(10px)', borderColor: 'hsla(260, 80%, 70%, 0.2)', borderRadius: '12px' }}
                      formatter={(value: number) => [`$${value.toLocaleString()}`, 'P&L']}
                    />
                    <Area type="monotone" dataKey="value" stroke="hsl(260, 80%, 70%)" strokeWidth={2} fill="url(#equityGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
