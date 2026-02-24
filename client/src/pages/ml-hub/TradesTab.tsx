import { memo, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TrendingUp, TrendingDown, Activity, Zap, Target, BarChart3,
} from "lucide-react";
import type { Trade } from "@/lib/types";

// MLHub uses slightly larger sizing than BottomPanel, so has its own TradeRow
const TradeRow = memo(({ trade }: { trade: Trade }) => (
  <div className="flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${trade.side === 'long' ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
        {trade.side === 'long' ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-rose-400" />}
      </div>
      <div className="min-w-0">
        <div className="font-medium text-sm truncate">{trade.symbol}</div>
        <div className="text-xs text-muted-foreground truncate">
          {trade.entryPrice?.toFixed(2)} → {trade.exitPrice?.toFixed(2) || 'open'}
        </div>
      </div>
    </div>
    <div className="text-right shrink-0">
      {trade.pnl !== null && trade.pnl !== undefined ? (
        <div className={`font-mono text-sm ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {trade.pnl >= 0 ? '+' : ''}{trade.pnl?.toFixed(2)}
        </div>
      ) : (
        <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">Open</Badge>
      )}
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
  return (
    <>
      {/* Trade Statistics */}
      <div className="grid grid-cols-6 gap-3">
        <Card className="glass rounded-xl p-4 border border-muted-foreground/10">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</div>
          </div>
          <div className="text-3xl font-bold font-mono text-foreground">{tradeMetrics.totalTrades}</div>
        </Card>
        <Card className="glass rounded-xl p-4 border border-emerald-500/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="text-[10px] text-emerald-300/70 uppercase tracking-wider">Win Rate</div>
          </div>
          <div className="text-3xl font-bold font-mono text-emerald-400">{tradeMetrics.winRate.toFixed(1)}%</div>
        </Card>
        <Card className="glass rounded-xl p-4 border border-primary/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div className="text-[10px] text-primary/70 uppercase tracking-wider">Total P&L</div>
          </div>
          <div className={`text-3xl font-bold font-mono ${tradeMetrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {tradeMetrics.totalPnl >= 0 ? '+' : ''}${tradeMetrics.totalPnl.toFixed(0)}
          </div>
        </Card>
        <Card className="glass rounded-xl p-4 border border-cyan-500/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Target className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="text-[10px] text-cyan-300/70 uppercase tracking-wider">Profit Factor</div>
          </div>
          <div className="text-3xl font-bold font-mono text-cyan-400">{tradeMetrics.profitFactor === Infinity ? '∞' : tradeMetrics.profitFactor.toFixed(2)}</div>
        </Card>
        <Card className="glass rounded-xl p-4 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Activity className="h-4 w-4 text-amber-400" />
            </div>
            <div className="text-[10px] text-amber-300/70 uppercase tracking-wider">Expectancy</div>
          </div>
          <div className={`text-3xl font-bold font-mono ${tradeMetrics.totalPnl >= 0 ? 'text-amber-400' : 'text-rose-400'}`}>
            {tradeMetrics.totalTrades > 0 ? `${tradeMetrics.totalPnl >= 0 ? '+' : ''}$${(tradeMetrics.totalPnl / tradeMetrics.totalTrades).toFixed(2)}` : '--'}
          </div>
        </Card>
        <Card className="glass rounded-xl p-4 border border-rose-500/20">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-rose-500/20 flex items-center justify-center">
              <TrendingDown className="h-4 w-4 text-rose-400" />
            </div>
            <div className="text-[10px] text-rose-300/70 uppercase tracking-wider">Open</div>
          </div>
          <div className="text-3xl font-bold font-mono text-rose-400">{tradeMetrics.openTrades}</div>
        </Card>
      </div>

      {/* Trade History + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 glass rounded-2xl gradient-border flex flex-col">
          <CardHeader className="border-b border-white/5 py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-cyan-400" /> Trade History
              <Badge variant="outline" className="ml-auto text-[10px] rounded-full border-muted-foreground/30 font-mono">
                {trades.length} trades
              </Badge>
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1 max-h-[400px]">
            <CardContent className="p-3">
              {trades.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p className="text-sm font-medium">No Trades Recorded</p>
                  <p className="text-xs mt-1 text-muted-foreground/60">Trades will appear here after signal execution</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {trades.map(trade => (
                    <TradeRow key={trade.id} trade={trade} />
                  ))}
                </div>
              )}
            </CardContent>
          </ScrollArea>
        </Card>

        <Card className="glass rounded-2xl gradient-border flex flex-col">
          <CardHeader className="border-b border-white/5 py-3 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Performance Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {/* Win/Loss bars */}
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-emerald-400 font-medium">Winners</span>
                  <span className="text-muted-foreground">{tradeMetrics.winners} trades</span>
                </div>
                <div className="h-2.5 bg-black/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-linear-to-r from-emerald-600 to-emerald-400 rounded-full transition-all"
                    style={{ width: `${tradeMetrics.totalTrades > 0 ? (tradeMetrics.winners / tradeMetrics.totalTrades) * 100 : 0}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-rose-400 font-medium">Losers</span>
                  <span className="text-muted-foreground">{tradeMetrics.losers} trades</span>
                </div>
                <div className="h-2.5 bg-black/40 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-linear-to-r from-rose-600 to-rose-400 rounded-full transition-all"
                    style={{ width: `${tradeMetrics.totalTrades > 0 ? (tradeMetrics.losers / tradeMetrics.totalTrades) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="pt-4 border-t border-white/10 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Avg Win</span>
                <span className="text-sm font-mono text-emerald-400">+${tradeMetrics.avgWin.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Avg Loss</span>
                <span className="text-sm font-mono text-rose-400">-${tradeMetrics.avgLoss.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Best Trade</span>
                <span className="text-sm font-mono text-emerald-400">
                  +${trades.length > 0 ? Math.max(...trades.map(t => t.pnl || 0)).toFixed(2) : '0.00'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Worst Trade</span>
                <span className="text-sm font-mono text-rose-400">
                  ${trades.length > 0 ? Math.min(...trades.map(t => t.pnl || 0)).toFixed(2) : '0.00'}
                </span>
              </div>
            </div>

            {/* Risk/Reward */}
            <div className="pt-4 border-t border-white/10">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-3">Risk/Reward Ratio</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-3 bg-black/40 rounded-full overflow-hidden flex">
                  <div className="h-full bg-emerald-500" style={{ width: `${tradeMetrics.avgLoss > 0 ? Math.min((tradeMetrics.avgWin / (tradeMetrics.avgWin + tradeMetrics.avgLoss)) * 100, 100) : 50}%` }} />
                  <div className="h-full bg-rose-500" style={{ width: `${tradeMetrics.avgWin > 0 ? Math.min((tradeMetrics.avgLoss / (tradeMetrics.avgWin + tradeMetrics.avgLoss)) * 100, 100) : 50}%` }} />
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                  {tradeMetrics.avgLoss > 0 ? (tradeMetrics.avgWin / tradeMetrics.avgLoss).toFixed(2) : '∞'}:1
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
