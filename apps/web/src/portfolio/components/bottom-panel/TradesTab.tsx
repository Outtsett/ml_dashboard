import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  TrendingUp, TrendingDown, Activity, Zap, Target, BarChart3,
} from "lucide-react";
import type { Trade } from "@/shared/utils/types";
import type { TradeMetrics } from "@/portfolio/lib/useTradeMetrics";
import { TradeRow } from "./TradeRow";

interface TradesTabProps {
  trades: Trade[];
  tradeMetrics: TradeMetrics;
}

export function TradesTab({ trades, tradeMetrics }: TradesTabProps) {
  return (
    <>
      {/* Compact trade stat pills */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-muted-foreground/10">
          <BarChart3 className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Total</span>
          <span className="text-xs font-bold font-mono">{tradeMetrics.totalTrades}</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--data-pos)/0.1)] border border-[hsl(var(--data-pos)/0.2)]">
          <TrendingUp className="h-3 w-3 text-[hsl(var(--data-pos))]" />
          <span className="text-[10px] text-muted-foreground">Win</span>
          <span className="text-xs font-bold font-mono text-[hsl(var(--data-pos))]">{tradeMetrics.winRate.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
          <Zap className="h-3 w-3 text-primary" />
          <span className="text-[10px] text-muted-foreground">P&L</span>
          <span className={`text-xs font-bold font-mono ${tradeMetrics.totalPnl >= 0 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
            {tradeMetrics.totalPnl >= 0 ? '+' : ''}${tradeMetrics.totalPnl.toFixed(0)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
          <Target className="h-3 w-3 text-cyan-400" />
          <span className="text-[10px] text-muted-foreground">PF</span>
          <span className="text-xs font-bold font-mono text-cyan-400">
            {tradeMetrics.profitFactor === Infinity ? '∞' : tradeMetrics.profitFactor.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <Activity className="h-3 w-3 text-amber-400" />
          <span className="text-[10px] text-muted-foreground">Avg W/L</span>
          <span className="text-xs font-mono">
            <span className="text-[hsl(var(--data-pos))]">+{tradeMetrics.avgWin.toFixed(0)}</span>
            <span className="text-muted-foreground mx-0.5">/</span>
            <span className="text-[hsl(var(--data-neg))]">-{tradeMetrics.avgLoss.toFixed(0)}</span>
          </span>
        </div>
        {tradeMetrics.openTrades > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--data-neg)/0.1)] border border-[hsl(var(--data-neg)/0.2)]">
            <TrendingDown className="h-3 w-3 text-[hsl(var(--data-neg))]" />
            <span className="text-[10px] text-muted-foreground">Open</span>
            <span className="text-xs font-bold font-mono text-[hsl(var(--data-neg))]">{tradeMetrics.openTrades}</span>
          </div>
        )}
      </div>

      {/* Trade list + breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2 glass rounded-xl gradient-border flex flex-col">
          <CardHeader className="border-b border-white/5 py-2 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 text-cyan-400" /> Trade History
              <Badge variant="outline" className="ml-auto text-[8px] rounded-full border-muted-foreground/30 font-mono">{trades.length}</Badge>
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1 max-h-[250px]">
            <CardContent className="p-2">
              {trades.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-xs font-medium">No Trades</p>
                  <p className="text-[10px] mt-1 text-muted-foreground/60">Trades appear after signal execution</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {trades.map(trade => <TradeRow key={trade.id} trade={trade} />)}
                </div>
              )}
            </CardContent>
          </ScrollArea>
        </Card>

        <Card className="glass rounded-xl gradient-border flex flex-col">
          <CardHeader className="border-b border-white/5 py-2 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-primary" /> Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-3">
            {/* Win/Loss bars */}
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-[hsl(var(--data-pos))] font-medium">Winners</span>
                  <span className="text-muted-foreground">{tradeMetrics.winners}</span>
                </div>
                <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-linear-to-r from-[hsl(var(--data-pos))] to-[hsl(var(--data-pos))] rounded-full transition-all"
                    style={{ width: `${tradeMetrics.totalTrades > 0 ? (tradeMetrics.winners / tradeMetrics.totalTrades) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-[hsl(var(--data-neg))] font-medium">Losers</span>
                  <span className="text-muted-foreground">{tradeMetrics.losers}</span>
                </div>
                <div className="h-2 bg-black/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-linear-to-r from-[hsl(var(--data-neg))] to-[hsl(var(--data-neg))] rounded-full transition-all"
                    style={{ width: `${tradeMetrics.totalTrades > 0 ? (tradeMetrics.losers / tradeMetrics.totalTrades) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="pt-2.5 border-t border-white/10 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-muted-foreground">Best</span>
                <span className="text-xs font-mono text-[hsl(var(--data-pos))]">
                  +${trades.length > 0 ? Math.max(...trades.map(t => t.pnl || 0)).toFixed(2) : '0.00'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-muted-foreground">Worst</span>
                <span className="text-xs font-mono text-[hsl(var(--data-neg))]">
                  ${trades.length > 0 ? Math.min(...trades.map(t => t.pnl || 0)).toFixed(2) : '0.00'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-muted-foreground">R:R</span>
                <span className="text-xs font-mono text-muted-foreground">
                  {tradeMetrics.avgLoss > 0 ? (tradeMetrics.avgWin / tradeMetrics.avgLoss).toFixed(2) : '∞'}:1
                </span>
              </div>
            </div>

            {/* R:R bar */}
            <div className="pt-2.5 border-t border-white/10">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2.5 bg-black/40 rounded-full overflow-hidden flex">
                  <div className="h-full bg-[hsl(var(--data-pos))]" style={{ width: `${tradeMetrics.avgLoss > 0 ? Math.min((tradeMetrics.avgWin / (tradeMetrics.avgWin + tradeMetrics.avgLoss)) * 100, 100) : 50}%` }} />
                  <div className="h-full bg-[hsl(var(--data-neg))]" style={{ width: `${tradeMetrics.avgWin > 0 ? Math.min((tradeMetrics.avgLoss / (tradeMetrics.avgWin + tradeMetrics.avgLoss)) * 100, 100) : 50}%` }} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
