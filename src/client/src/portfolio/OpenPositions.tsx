import { Card, CardHeader, CardTitle, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Sparkles, Loader2, Wallet } from "lucide-react";
import { fmtPrice, type Position } from "@/portfolio/types";

interface OpenPositionsProps {
  isLoading: boolean;
  positions: Position[];
}

export function OpenPositions({ isLoading, positions }: OpenPositionsProps) {
  return (
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
                <td className={`py-3 px-4 text-right font-mono ${pos.quantity > 0 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
                  {pos.quantity > 0 ? '+' : ''}{pos.quantity}
                </td>
                <td className="py-3 px-4 text-right font-mono">{fmtPrice(pos.avgPrice)}</td>
                <td className="py-3 px-4 text-right font-mono">{fmtPrice(pos.currentPrice)}</td>
                <td className={`py-3 px-4 text-right font-mono font-bold ${pos.pnl >= 0 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
                  {pos.pnl >= 0 ? '+' : ''}${pos.pnl.toLocaleString()}
                </td>
                <td className="py-3 px-4 text-right">
                  <Badge variant="outline" className={`font-mono text-xs rounded-full ${
                    pos.pnlPercent >= 0 
                      ? 'border-[hsl(var(--data-pos)/0.3)] text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.1)]' 
                      : 'border-[hsl(var(--data-neg)/0.3)] text-[hsl(var(--data-neg))] bg-[hsl(var(--data-neg)/0.1)]'
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
  );
}
