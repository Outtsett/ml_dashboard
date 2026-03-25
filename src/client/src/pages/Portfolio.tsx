import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/components/ui/empty";
import { ErrorCard } from "@/components/ui/error-card";
import { 
  TrendingUp, DollarSign, Wallet, 
  PieChart, ArrowUpRight, ArrowDownRight, Clock,
  Target, Activity, Sparkles, Loader2, BarChart2
} from "lucide-react";
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import type { Trade } from "@/lib/types";

type Position = { symbol: string; name: string; quantity: number; avgPrice: number; currentPrice: number; pnl: number; pnlPercent: number };
type AllocationEntry = { name: string; value: number; color: string };
type EquityPoint = { date: string; value: number };
type RecentTrade = { time: string; symbol: string; side: string; qty: number; price: number; pnl: number | null };

const COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

/** Format price — forex pairs get 5 decimals, others get 2 */
function fmtPrice(price: number): string {
  return price < 50 ? price.toFixed(5) : price.toFixed(2);
}

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

  const openPositions = positions.length;

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
            <span className="text-sm font-mono text-violet-300">{openPositions} Open Positions</span>
          </div>
          <Button
            className="h-10 px-5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-medium hover:brightness-110 transition-all"
            data-testid="button-new-order"
            onClick={() => alert('Manual order entry coming soon')}
          >
            <Target className="mr-2 h-4 w-4" /> New Order
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 shrink-0">
        <div className="bg-gradient-to-br from-violet-500/10 to-violet-600/5 rounded-xl p-5 border border-violet-500/20">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-violet-400" />
            </div>
            <div className="text-xs text-violet-300/70 uppercase tracking-wider">Portfolio Value</div>
          </div>
          <div className="flex items-end justify-between">
            <div className="text-3xl font-bold text-violet-200 font-mono">
              {isLoading ? <Loader2 className="h-7 w-7 animate-spin opacity-40" /> : positions.length > 0 ? `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-xl p-5 border border-emerald-500/20">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="text-xs text-emerald-300/70 uppercase tracking-wider">Total P&L</div>
          </div>
          <div className="flex items-end justify-between">
            <div className={`text-3xl font-bold font-mono ${totalPnL >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
              {isLoading ? <Loader2 className="h-7 w-7 animate-spin opacity-40" /> : closedTradesRaw.length > 0 ? `${totalPnL >= 0 ? '+' : ''}$${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 rounded-xl p-5 border border-cyan-500/20">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="text-xs text-cyan-300/70 uppercase tracking-wider">Today's P&L</div>
          </div>
          <div className="flex items-end justify-between">
            <div className={`text-3xl font-bold font-mono ${dailyPnL >= 0 ? 'text-cyan-200' : 'text-rose-200'}`}>
              {isLoading ? <Loader2 className="h-7 w-7 animate-spin opacity-40" /> : closedTradesRaw.length > 0 ? `${dailyPnL >= 0 ? '+' : ''}$${dailyPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-xl p-5 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Target className="h-5 w-5 text-amber-400" />
            </div>
            <div className="text-xs text-amber-300/70 uppercase tracking-wider">Win Rate</div>
          </div>
          <div className="flex items-end justify-between">
            <div className="text-3xl font-bold text-amber-200 font-mono">
              {isLoading ? <Loader2 className="h-7 w-7 animate-spin opacity-40" /> : winRate !== null ? `${winRate}%` : '--'}
            </div>
            {winRate !== null && (
              <div className="text-xs text-muted-foreground/60">{closedTradesRaw.length} trades</div>
            )}
            {winRate === null && !isLoading && (
              <div className="text-xs text-muted-foreground/60">no closed trades</div>
            )}
          </div>
        </div>
      </div>

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
        {/* Positions Table */}
        <Card className="col-span-2 glass rounded-2xl flex flex-col gradient-border overflow-hidden">
          <CardHeader className="border-b border-white/5 shrink-0">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Open Positions
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-0">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background/80 backdrop-blur-sm">
                <tr className="border-b border-white/5 text-muted-foreground text-xs">
                  <th className="text-left py-3 px-4 font-medium">Symbol</th>
                  <th className="text-left py-3 px-4 font-medium">Name</th>
                  <th className="text-right py-3 px-4 font-medium">Qty</th>
                  <th className="text-right py-3 px-4 font-medium">Avg Price</th>
                  <th className="text-right py-3 px-4 font-medium">Current</th>
                  <th className="text-right py-3 px-4 font-medium">P&L</th>
                  <th className="text-right py-3 px-4 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin opacity-40" />
                      <p className="text-sm">Loading positions…</p>
                    </td>
                  </tr>
                ) : positions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      <Wallet className="h-12 w-12 mx-auto mb-3 opacity-20" />
                      <p className="text-sm font-medium">No Open Positions</p>
                      <p className="text-xs mt-1">Open positions will appear here when trades are active</p>
                    </td>
                  </tr>
                ) : positions.map((pos, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors" data-testid={`row-position-${i}`}>
                    <td className="py-3 px-4 font-mono font-bold text-primary">{pos.symbol}</td>
                    <td className="py-3 px-4 text-muted-foreground">{pos.name}</td>
                    <td className={`py-3 px-4 text-right font-mono ${pos.quantity > 0 ? 'text-green-400' : 'text-rose-400'}`}>
                      {pos.quantity > 0 ? '+' : ''}{pos.quantity}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">{fmtPrice(pos.avgPrice)}</td>
                    <td className="py-3 px-4 text-right font-mono">{fmtPrice(pos.currentPrice)}</td>
                    <td className={`py-3 px-4 text-right font-mono font-bold ${pos.pnl >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                      {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Badge variant="outline" className={`font-mono text-xs rounded-full ${
                        pos.pnlPercent >= 0 
                          ? 'border-green-500/30 text-green-400 bg-green-500/10' 
                          : 'border-rose-500/30 text-rose-400 bg-rose-500/10'
                      }`}>
                        {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Right Column */}
        <div className="flex flex-col gap-4 min-h-0 overflow-hidden">
          {/* Allocation Pie */}
          <Card className="glass rounded-2xl gradient-border flex-1 min-h-0 flex flex-col">
            <CardHeader className="border-b border-white/5 shrink-0">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <PieChart className="h-4 w-4 text-accent" /> Allocation
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-4">
              {allocationData.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                  <PieChart className="h-10 w-10 mb-2 opacity-20" />
                  <p className="text-xs">No positions to allocate</p>
                </div>
              ) : (
                <>
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={allocationData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {allocationData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsla(250, 25%, 14%, 0.9)', 
                      backdropFilter: 'blur(10px)', 
                      borderColor: 'hsla(260, 80%, 70%, 0.2)', 
                      borderRadius: '12px' 
                    }} 
                  />
                </RePieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {allocationData.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="text-muted-foreground">{item.name}</span>
                    <span className="ml-auto font-mono">{item.value}%</span>
                  </div>
                ))}
              </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Recent Trades */}
          <Card className="glass rounded-2xl gradient-border flex-1 min-h-0 flex flex-col">
            <CardHeader className="border-b border-white/5 shrink-0">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-green-400" /> Recent Trades
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-0">
              {recentTrades.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-muted-foreground py-8">
                  <Clock className="h-10 w-10 mb-2 opacity-20" />
                  <p className="text-xs">{isLoading ? 'Loading trades…' : 'No recent trades'}</p>
                </div>
              ) : (
              <div className="divide-y divide-white/5">
                {recentTrades.map((trade, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-xs" data-testid={`trade-${i}`}>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-muted-foreground">{trade.time}</span>
                      <span className="font-bold text-primary">{trade.symbol}</span>
                      <Badge variant="outline" className={`text-[10px] px-2 py-0 rounded-full ${
                        trade.side === 'BUY' 
                          ? 'border-green-500/30 text-green-400' 
                          : 'border-rose-500/30 text-rose-400'
                      }`}>
                        {trade.side}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-mono">{trade.qty} @ {fmtPrice(trade.price)}</span>
                      {trade.pnl !== null && (
                        <span className={`font-mono font-bold ${trade.pnl >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                          {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              )}
            </CardContent>
          </Card>
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

function SummaryCard({ icon: Icon, label, value, change, positive }: { 
  icon: any; 
  label: string; 
  value: string; 
  change: string; 
  positive: boolean 
}) {
  return (
    <Card className="glass rounded-2xl gradient-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-end justify-between">
          <span className="text-2xl font-display font-bold">{value}</span>
          <div className={`flex items-center gap-1 text-xs font-mono ${positive ? 'text-green-400' : 'text-rose-400'}`}>
            {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {change}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
