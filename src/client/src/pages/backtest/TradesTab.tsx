import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown } from "lucide-react";

interface TradesTabProps {
  trades: any[];
  isPending: boolean;
}

export function TradesTab({ trades, isPending }: TradesTabProps) {
  return (
    <Card className="h-full glass rounded-2xl flex flex-col gradient-border">
      <CardHeader className="py-2 px-4 border-b border-white/5 shrink-0">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          Trade-by-Trade Breakdown ({trades.length} trades)
        </CardTitle>
      </CardHeader>
      <ScrollArea className="flex-1">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background/80 backdrop-blur-sm">
            <tr className="border-b border-white/5 text-muted-foreground">
              <th className="text-left py-2 px-3 font-medium">Entry</th>
              <th className="text-left py-2 px-3 font-medium">Exit</th>
              <th className="text-left py-2 px-3 font-medium">Dir</th>
              <th className="text-right py-2 px-3 font-medium">Entry $</th>
              <th className="text-right py-2 px-3 font-medium">Exit $</th>
              <th className="text-right py-2 px-3 font-medium">Gross P&L</th>
              <th className="text-right py-2 px-3 font-medium">Costs</th>
              <th className="text-right py-2 px-3 font-medium">Net P&L</th>
              <th className="text-left py-2 px-3 font-medium">Reason</th>
              <th className="text-right py-2 px-3 font-medium">Bars</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade: any, idx: number) => {
              const netPnl = trade.netPnl ?? 0;
              const grossPnl = trade.pnl ?? 0;
              const costs = (trade.commission ?? 0) + (trade.slippage ?? 0) + (trade.spreadCost ?? 0);
              return (
                <tr key={trade.id || idx} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 px-3 font-mono text-muted-foreground text-[10px]">
                    {new Date(Number(trade.entryTimestamp)).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 font-mono text-muted-foreground text-[10px]">
                    {trade.exitTimestamp ? new Date(Number(trade.exitTimestamp)).toLocaleString() : '—'}
                  </td>
                  <td className="py-2 px-3">
                    <Badge variant="outline" className={`text-[9px] rounded-full ${
                      trade.side === 'long' ? 'border-green-500/50 text-green-400' : 'border-rose-500/50 text-rose-400'
                    }`}>
                      {trade.side === 'long' ? <TrendingUp className="h-2 w-2 mr-0.5" /> : <TrendingDown className="h-2 w-2 mr-0.5" />}
                      {trade.side}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 text-right font-mono">{trade.entryPrice?.toFixed(4)}</td>
                  <td className="py-2 px-3 text-right font-mono">{trade.exitPrice?.toFixed(4) ?? '—'}</td>
                  <td className={`py-2 px-3 text-right font-mono ${grossPnl >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                    {grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-amber-400">
                    -${costs.toFixed(2)}
                  </td>
                  <td className={`py-2 px-3 text-right font-mono font-bold ${netPnl >= 0 ? 'text-green-400' : 'text-rose-400'}`}>
                    {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-[10px] text-muted-foreground">{trade.exitReason}</td>
                  <td className="py-2 px-3 text-right font-mono text-muted-foreground">{trade.barsHeld}</td>
                </tr>
              );
            })}
            {trades.length === 0 && (
              <tr>
                <td colSpan={10} className="py-8 text-center text-muted-foreground">
                  {isPending ? 'Computing...' : 'No trades to display. Run a backtest first.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>
    </Card>
  );
}
