import { Card, CardHeader, CardTitle, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Clock } from "lucide-react";
import { fmtPrice, type RecentTrade } from "@/portfolio/types";

interface TradeHistoryProps {
  isLoading: boolean;
  recentTrades: RecentTrade[];
}

export function TradeHistory({ isLoading, recentTrades }: TradeHistoryProps) {
  return (
    <Card className="glass rounded-2xl gradient-border flex-1 min-h-0 flex flex-col">
      <CardHeader className="border-b border-white/5 shrink-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Clock className="h-4 w-4 text-[hsl(var(--data-pos))]" /> Recent Trades
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
                      ? 'border-[hsl(var(--data-pos)/0.3)] text-[hsl(var(--data-pos))]' 
                      : 'border-[hsl(var(--data-neg)/0.3)] text-[hsl(var(--data-neg))]'
                  }`}>
                    {trade.side}
                  </Badge>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono">{trade.qty} @ {fmtPrice(trade.price)}</span>
                  {trade.pnl !== null && (
                    <span className={`font-mono font-bold ${trade.pnl >= 0 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
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
  );
}
