import { Card, CardHeader, CardTitle } from "@/shared/ui/card";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { TrendingUp, TrendingDown, Crosshair } from "lucide-react";
import { useDashboard } from "@/shared/contexts/UnifiedDashboardContext";
import { useCallback } from "react";
import type { BacktestTrade } from "@shared/schema";

interface TradesTabProps {
  trades: BacktestTrade[];
  isPending: boolean;
}

export function TradesTab({ trades, isPending }: TradesTabProps) {
  const dashboard = useDashboard();

  const handleLocateTrade = useCallback((trade: BacktestTrade) => {
    const start = Number(trade.entryTimestamp);
    const end = trade.exitTimestamp ? Number(trade.exitTimestamp) : start + 60000 * 60; // default 1h if open
    
    dashboard.setHighlightRange({
      start,
      end,
      label: `Trade ${trade.side.toUpperCase()} @ ${trade.entryPrice.toFixed(2)}`,
      color: trade.side === 'long' ? '#10b981' : '#ef4444'
    });
    
    dashboard.navigateToChart();
  }, [dashboard]);

  return (
    <Card className="h-full glass rounded-2xl flex flex-col gradient-border">
      <CardHeader className="py-2 px-4 border-b border-white/5 shrink-0 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          Trade-by-Trade Breakdown ({trades.length} trades)
        </CardTitle>
        <div className="text-[10px] text-muted-foreground/50 font-mono">
          Click <Crosshair className="h-2.5 w-2.5 inline mx-0.5" /> to jump to chart
        </div>
      </CardHeader>
      <ScrollArea className="flex-1">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background/80 backdrop-blur-sm z-10">
            <tr className="border-b border-white/5 text-muted-foreground">
              <th className="text-left py-2 px-3 font-medium">Entry</th>
              <th className="text-left py-2 px-3 font-medium">Exit</th>
              <th className="text-left py-2 px-3 font-medium">Dir</th>
              <th className="text-right py-2 px-3 font-medium">Entry $</th>
              <th className="text-right py-2 px-3 font-medium">Exit $</th>
              <th className="text-right py-2 px-3 font-medium">Net P&L</th>
              <th className="text-left py-2 px-3 font-medium">Reason</th>
              <th className="text-center py-2 px-3 font-medium w-10">Action</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade: BacktestTrade, idx: number) => {
              const netPnl = trade.netPnl ?? 0;
              return (
                <tr key={trade.id || idx} className="border-b border-white/5 hover:bg-white/[0.03] group transition-colors">
                  <td className="py-2 px-3 font-mono text-muted-foreground text-[10px]">      
                    {new Date(Number(trade.entryTimestamp)).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 font-mono text-muted-foreground text-[10px]">      
                    {trade.exitTimestamp ? new Date(Number(trade.exitTimestamp)).toLocaleString() : '—'}
                  </td>
                  <td className="py-2 px-3">
                    <Badge variant="outline" className={`text-[9px] rounded-full px-1.5 py-0 ${
                      trade.side === 'long' ? 'border-emerald-500/50 text-emerald-400' : 'border-rose-500/50 text-rose-400'
                    }`}>
                      {trade.side === 'long' ? <TrendingUp className="h-2 w-2 mr-0.5" /> : <TrendingDown className="h-2 w-2 mr-0.5" />}
                      {trade.side}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-[11px]">{trade.entryPrice?.toFixed(4)}</td>
                  <td className="py-2 px-3 text-right font-mono text-[11px]">{trade.exitPrice?.toFixed(4) ?? '—'}</td>
                  <td className={`py-2 px-3 text-right font-mono font-bold text-[11px] ${netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-[10px] text-muted-foreground truncate max-w-[120px]">{trade.exitReason}</td>
                  <td className="py-2 px-3 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md opacity-0 group-hover:opacity-100 hover:bg-primary/20 text-primary transition-all"
                      onClick={() => handleLocateTrade(trade)}
                      title="Show on Chart"
                    >
                      <Crosshair className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {trades.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-muted-foreground italic opacity-50">
                  {isPending ? 'Neural engine computing results...' : 'No trades found for this simulation.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>
    </Card>
  );
}
