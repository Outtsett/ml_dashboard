import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { WalkForwardResult } from "@/backtest/types";

interface WalkForwardTabProps {
  result: WalkForwardResult | null;
  isPending: boolean;
}

export function WalkForwardTab({ result, isPending }: WalkForwardTabProps) {
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        {isPending ? 'Running walk-forward analysis...' : 'Run walk-forward analysis to see results'}
      </div>
    );
  }

  const { windowResults, oosMetrics, consistency, degradation } = result;

  // Build combined OOS equity curve from all windows
  const combinedEquity = windowResults.flatMap((wr) =>
    wr.equityCurve.map((pt) => ({
      time: new Date(pt.timestamp).toLocaleDateString(),
      equity: pt.equity,
      window: wr.window.index + 1,
    }))
  );

  const consistencyColor = consistency >= 0.6 ? 'text-emerald-400' : consistency >= 0.4 ? 'text-amber-400' : 'text-rose-400';
  const degradationColor = degradation <= 0.2 ? 'text-emerald-400' : degradation <= 0.5 ? 'text-amber-400' : 'text-rose-400';

  return (
    <div className="grid grid-cols-3 gap-3 h-full">
      {/* Per-window table + consistency */}
      <Card className="col-span-1 glass rounded-2xl flex flex-col gradient-border">
        <CardHeader className="py-2 px-4 border-b border-white/5">
          <CardTitle className="text-xs font-medium text-muted-foreground">Window Results</CardTitle>
        </CardHeader>
        <ScrollArea className="flex-1">
          <CardContent className="pt-3 space-y-3">
            {/* Consistency & Degradation gauges */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-xl bg-[hsl(220,15%,12%)] border border-[hsl(220,15%,18%)]">
                <p className="text-[10px] text-muted-foreground mb-0.5">Consistency</p>
                <p className={`font-mono text-lg font-bold ${consistencyColor}`}>
                  {(consistency * 100).toFixed(0)}%
                </p>
                <p className="text-[9px] text-muted-foreground">profitable windows</p>
              </div>
              <div className="p-2.5 rounded-xl bg-[hsl(220,15%,12%)] border border-[hsl(220,15%,18%)]">
                <p className="text-[10px] text-muted-foreground mb-0.5">Degradation</p>
                <p className={`font-mono text-lg font-bold ${degradationColor}`}>
                  {(degradation * 100).toFixed(1)}%
                </p>
                <p className="text-[9px] text-muted-foreground">IS → OOS drop</p>
              </div>
            </div>

            {/* OOS aggregate metrics */}
            <div className="p-2.5 rounded-xl bg-[hsl(220,15%,12%)] border border-[hsl(220,15%,18%)] space-y-1 text-xs">
              <p className="text-[10px] text-muted-foreground font-medium mb-1">OOS Aggregate</p>
              <div className="flex justify-between"><span className="text-muted-foreground">Win Rate</span><span className="font-mono">{(oosMetrics.winRate * 100).toFixed(1)}%</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Sharpe</span><span className="font-mono">{oosMetrics.sharpeRatio.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Return</span><span className={`font-mono ${oosMetrics.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{oosMetrics.totalReturnPct >= 0 ? '+' : ''}{oosMetrics.totalReturnPct.toFixed(1)}%</span></div>
            </div>

            {/* Per-window table */}
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-muted-foreground border-b border-white/5">
                  <th className="text-left py-1 font-medium">#</th>
                  <th className="text-left py-1 font-medium">Period</th>
                  <th className="text-right py-1 font-medium">Trades</th>
                  <th className="text-right py-1 font-medium">Win%</th>
                  <th className="text-right py-1 font-medium">Sharpe</th>
                  <th className="text-right py-1 font-medium">P&L%</th>
                  <th className="text-right py-1 font-medium">DD</th>
                </tr>
              </thead>
              <tbody>
                {windowResults.map((wr) => (
                  <tr key={wr.window.index} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-1.5 font-mono">{wr.window.index + 1}</td>
                    <td className="py-1.5 text-muted-foreground">{wr.window.testStart.slice(5)}-{wr.window.testEnd.slice(5)}</td>
                    <td className="py-1.5 text-right font-mono">{wr.tradeCount}</td>
                    <td className="py-1.5 text-right font-mono">{(wr.metrics.winRate * 100).toFixed(0)}%</td>
                    <td className="py-1.5 text-right font-mono">{wr.metrics.sharpeRatio.toFixed(2)}</td>
                    <td className={`py-1.5 text-right font-mono ${wr.metrics.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {wr.metrics.totalReturnPct >= 0 ? '+' : ''}{wr.metrics.totalReturnPct.toFixed(1)}%
                    </td>
                    <td className="py-1.5 text-right font-mono text-rose-400">{wr.metrics.maxDrawdownPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </ScrollArea>
      </Card>

      {/* Combined OOS equity curve */}
      <Card className="col-span-2 glass rounded-2xl flex flex-col gradient-border">
        <CardHeader className="py-2 px-4 border-b border-white/5 flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-medium text-muted-foreground">
            Combined OOS Equity Curve
          </CardTitle>
          <Badge variant="outline" className="text-[9px] border-[hsl(185,40%,45%)]/50 text-[hsl(185,40%,45%)]">
            {windowResults.length} windows
          </Badge>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-2">
          {combinedEquity.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={combinedEquity}>
                <defs>
                  <linearGradient id="colorWfEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(185, 70%, 55%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(185, 70%, 55%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={9} interval="preserveStartEnd" />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }}
                  formatter={(v: number) => [`$${v.toFixed(2)}`, 'Equity']}
                  labelFormatter={(label: string, payload: any[]) => {
                    const w = payload?.[0]?.payload?.window;
                    return w ? `${label} (Window ${w})` : label;
                  }}
                />
                <Area type="monotone" dataKey="equity" stroke="hsl(185, 70%, 55%)" strokeWidth={2} fill="url(#colorWfEquity)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No equity curve data
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
