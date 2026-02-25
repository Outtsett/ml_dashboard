import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import { BarChart2 } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { BacktestMetrics } from "./types";
import { StatRow } from "./StatRow";

interface ResultsTabProps {
  equityCurveData: { time: string; equity: number }[];
  metrics: BacktestMetrics | undefined;
  initialCapital: number;
  isPending: boolean;
}

export function ResultsTab({ equityCurveData, metrics, initialCapital, isPending }: ResultsTabProps) {
  return (
    <div className="grid grid-cols-3 gap-3 h-full">
      <Card className="col-span-2 glass rounded-2xl flex flex-col gradient-border">
        <CardHeader className="py-2 px-4 border-b border-white/5">
          <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <BarChart2 className="h-3 w-3 text-accent" /> Equity Curve
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-2">
          {equityCurveData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityCurveData}>
                <defs>
                  <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(185, 70%, 55%)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(185, 70%, 55%)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={9} interval="preserveStartEnd" />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }}
                  formatter={(v: number) => [`$${v.toFixed(2)}`, 'Equity']} />
                <ReferenceLine y={initialCapital} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" strokeOpacity={0.5} />
                <Area type="monotone" dataKey="equity" stroke="hsl(185, 70%, 55%)" strokeWidth={2} fill="url(#colorEquity)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              {isPending ? (
                <div className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Computing backtest...</div>
              ) : (
                'Run a backtest to see the equity curve'
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass rounded-2xl flex flex-col gradient-border">
        <CardHeader className="py-2 px-4 border-b border-white/5">
          <CardTitle className="text-xs font-medium text-muted-foreground">Performance Stats</CardTitle>
        </CardHeader>
        <ScrollArea className="flex-1">
          {metrics ? (
            <CardContent className="space-y-2 pt-3 text-xs">
              <StatRow label="Sortino" value={metrics.sortinoRatio.toFixed(2)} />
              <StatRow label="Calmar" value={metrics.calmarRatio.toFixed(2)} />
              <StatRow label="Profit Factor" value={metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)} />
              <StatRow label="Expectancy" value={`$${metrics.expectancy.toFixed(2)}`} />
              <div className="border-t border-white/5 pt-2" />
              <StatRow label="Avg Win" value={`$${metrics.avgWin.toFixed(2)}`} positive />
              <StatRow label="Avg Loss" value={`$${metrics.avgLoss.toFixed(2)}`} negative />
              <StatRow label="Largest Win" value={`$${metrics.largestWin.toFixed(2)}`} positive />
              <StatRow label="Largest Loss" value={`$${metrics.largestLoss.toFixed(2)}`} negative />
              <div className="border-t border-white/5 pt-2" />
              <StatRow label="Win/Loss" value={`${metrics.winningTrades ?? '?'}/${metrics.losingTrades ?? '?'}`} />
              <StatRow label="Avg Hold" value={`${metrics.avgHoldingTimeBars?.toFixed(0) ?? '?'} bars`} />
              <StatRow label="Commissions" value={`$${metrics.totalCommissions.toFixed(2)}`} />
              <StatRow label="Slippage" value={`$${metrics.totalSlippage.toFixed(2)}`} />
              <StatRow label="Spread Cost" value={`$${metrics.totalSpreadCost.toFixed(2)}`} />
            </CardContent>
          ) : (
            <CardContent className="h-full flex items-center justify-center text-sm text-muted-foreground p-6">
              Configure parameters and click Execute
            </CardContent>
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}
