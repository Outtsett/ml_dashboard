import { memo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import {
  TrendingUp, TrendingDown, Activity, Zap, Target, BarChart3, Crosshair
} from "lucide-react";
import type { Trade } from "@/lib/types";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";

const TradeRow = memo(({ trade, onLocate }: { trade: Trade; onLocate: (t: Trade) => void }) => (
  <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 group transition-all duration-200 border border-transparent hover:border-white/5">
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${trade.side === 'long' ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
        {trade.side === 'long' ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-rose-400" />}
      </div>
      <div className="min-w-0">
        <div className="font-medium text-sm truncate flex items-center gap-2">
          {trade.symbol}
          <Badge variant="outline" className="text-[9px] px-1 py-0 border-white/10 text-muted-foreground uppercase">{trade.side}</Badge>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground truncate">
          {trade.entryPrice?.toFixed(2)} → {trade.exitPrice?.toFixed(2) || 'OPEN'}
        </div>
      </div>
    </div>
    <div className="flex items-center gap-4 shrink-0">
      <div className="text-right">
        {trade.pnl !== null && trade.pnl !== undefined ? (
          <div className={`font-mono text-sm font-bold ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {trade.pnl >= 0 ? '+' : ''}{trade.pnl?.toFixed(2)}
          </div>
        ) : (
          <Badge className="bg-amber-500/20 text-amber-400 text-[10px] font-mono">ACTIVE</Badge>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-primary/20 text-primary transition-all"
        onClick={() => onLocate(trade)}
      >
        <Crosshair className="h-4 w-4" />
      </Button>
    </div>
  </div>
));

interface TradeMetrics {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  openTrades: number;
  winners: number;
  losers: number;
}

interface TradesTabProps {
  trades: Trade[];
  tradeMetrics: TradeMetrics;
}

export function TradesTab({ trades, tradeMetrics }: TradesTabProps) {
  const dashboard = useDashboard();

  const handleLocateTrade = useCallback((trade: Trade) => {
    const start = trade.entryTimestamp ? new Date(trade.entryTimestamp).getTime() : Date.now();
    const end = trade.exitTimestamp ? new Date(trade.exitTimestamp).getTime() : start + 60000 * 60;
    
    dashboard.setHighlightRange({
      start,
      end,
      label: `${trade.symbol} ${trade.side.toUpperCase()}`,
      color: trade.side === 'long' ? '#10b981' : '#ef4444'
    });
    
    dashboard.navigateToChart();
  }, [dashboard]);

  return (
    <div className="space-y-4">
      {/* Trade Statistics */}
      <div className="grid grid-cols-6 gap-3">
        <StatCard label="Total" value={tradeMetrics.totalTrades} icon={BarChart3} color="primary" />
        <StatCard label="Win Rate" value={`${tradeMetrics.winRate.toFixed(1)}%`} icon={TrendingUp} color="emerald" />
        <StatCard label="Total P&L" value={`$${tradeMetrics.totalPnl.toFixed(0)}`} icon={Zap} color={tradeMetrics.totalPnl >= 0 ? "emerald" : "rose"} />
        <StatCard label="Profit Factor" value={tradeMetrics.profitFactor === Infinity ? "∞" : tradeMetrics.profitFactor.toFixed(2)} icon={Target} color="cyan" />
        <StatCard label="Expectancy" value={tradeMetrics.totalTrades > 0 ? `$${(tradeMetrics.totalPnl / tradeMetrics.totalTrades).toFixed(2)}` : "--"} icon={Activity} color="amber" />
        <StatCard label="Open" value={tradeMetrics.openTrades} icon={TrendingDown} color="rose" />
      </div>

      {/* Trade History + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 glass rounded-2xl gradient-border flex flex-col border border-white/5">      
          <CardHeader className="border-b border-white/5 py-3 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-400" /> Trade History
            </CardTitle>
            <Badge variant="outline" className="text-[10px] rounded-full border-white/10 font-mono text-muted-foreground">
              {trades.length} SESSIONS
            </Badge>
          </CardHeader>
          <ScrollArea className="flex-1 max-h-[500px]">
            <CardContent className="p-3">
              {trades.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p className="text-sm font-medium">No Trades Recorded</p>
                  <p className="text-xs mt-1 text-muted-foreground/60">Neural agent awaiting signal execution</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {[...trades].reverse().map(trade => (
                    <TradeRow key={trade.id} trade={trade} onLocate={handleLocateTrade} />
                  ))}
                </div>
              )}
            </CardContent>
          </ScrollArea>
        </Card>

        <Card className="glass rounded-2xl gradient-border flex flex-col border border-white/5">
          <CardHeader className="border-b border-white/5 py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Performance Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-6">
            {/* Win/Loss bars */}
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-[10px] uppercase tracking-wider mb-2">
                  <span className="text-emerald-400 font-bold">Winners</span>
                  <span className="text-muted-foreground font-mono">{tradeMetrics.winners}</span>
                </div>
                <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                    style={{ width: `${tradeMetrics.totalTrades > 0 ? (tradeMetrics.winners / tradeMetrics.totalTrades) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] uppercase tracking-wider mb-2">
                  <span className="text-rose-400 font-bold">Losers</span>
                  <span className="text-muted-foreground font-mono">{tradeMetrics.losers}</span> 
                </div>
                <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-rose-600 to-rose-400 rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(239,68,68,0.3)]"
                    style={{ width: `${tradeMetrics.totalTrades > 0 ? (tradeMetrics.losers / tradeMetrics.totalTrades) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="pt-4 border-t border-white/5 space-y-3">
              <div className="flex justify-between items-center group">
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">Avg Win</span>
                <span className="text-sm font-mono text-emerald-400 font-bold">+${tradeMetrics.avgWin.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center group">
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">Avg Loss</span>
                <span className="text-sm font-mono text-rose-400 font-bold">-${tradeMetrics.avgLoss.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center group">
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">Best Trade</span>
                <span className="text-sm font-mono text-emerald-400 font-bold">
                  +${trades.length > 0 ? Math.max(...trades.map(t => t.pnl || 0)).toFixed(2) : '0.00'}
                </span>
              </div>
              <div className="flex justify-between items-center group">
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">Worst Trade</span>
                <span className="text-sm font-mono text-rose-400 font-bold">
                  ${trades.length > 0 ? Math.min(...trades.map(t => t.pnl || 0)).toFixed(2) : '0.00'}
                </span>
              </div>
            </div>

            {/* Risk/Reward */}
            <div className="pt-4 border-t border-white/5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-4">Risk Reward Profile</div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2.5 bg-black/40 rounded-full overflow-hidden flex border border-white/5">    
                  <div className="h-full bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.4)]" style={{ width: `${tradeMetrics.avgLoss > 0 ? Math.min((tradeMetrics.avgWin / (tradeMetrics.avgWin + tradeMetrics.avgLoss)) * 100, 100) : 50}%` }} />
                  <div className="h-full bg-rose-500/80 shadow-[0_0_8px_rgba(239,68,68,0.4)]" style={{ width: `${tradeMetrics.avgWin > 0 ? Math.min((tradeMetrics.avgLoss / (tradeMetrics.avgWin + tradeMetrics.avgLoss)) * 100, 100) : 50}%` }} />
                </div>
                <span className="text-xs font-mono text-muted-foreground font-bold whitespace-nowrap">
                  {tradeMetrics.avgLoss > 0 ? (tradeMetrics.avgWin / tradeMetrics.avgLoss).toFixed(2) : '∞'}:1
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
