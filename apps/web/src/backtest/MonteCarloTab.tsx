import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { MonteCarloResult } from "@/backtest/types";

interface MonteCarloTabProps {
  result: MonteCarloResult | null;
  isPending: boolean;
}

function buildHistogram(distribution: number[], bins: number = 30) {
  if (!distribution.length) return [];
  const min = Math.min(...distribution);
  const max = Math.max(...distribution);
  const binWidth = (max - min) / bins || 1;
  const histogram: { range: string; count: number; midpoint: number }[] = [];
  for (let i = 0; i < bins; i++) {
    const lo = min + i * binWidth;
    const hi = lo + binWidth;
    const count = distribution.filter((v) => v >= lo && (i === bins - 1 ? v <= hi : v < hi)).length;
    histogram.push({
      range: `$${(lo / 1000).toFixed(1)}k`,
      count,
      midpoint: (lo + hi) / 2,
    });
  }
  return histogram;
}

export function MonteCarloTab({ result, isPending }: MonteCarloTabProps) {
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        {isPending ? 'Running Monte Carlo simulation...' : 'Run Monte Carlo analysis to see results'}
      </div>
    );
  }

  const { terminalEquity, maxDrawdown, profitProbability, ruinProbability, numSimulations } = result;

  const equityHistogram = buildHistogram(terminalEquity.distribution);
  const ddHistogram = buildHistogram(maxDrawdown.distribution);

  const percentileKeys = Object.keys(terminalEquity.percentiles).sort((a, b) => parseFloat(a) - parseFloat(b));

  return (
    <div className="grid grid-cols-3 gap-3 h-full">
      {/* Left: probabilities + confidence intervals */}
      <Card className="col-span-1 glass rounded-2xl flex flex-col gradient-border">
        <CardHeader className="py-2 px-4 border-b border-white/5">
          <CardTitle className="text-xs font-medium text-muted-foreground">Simulation Summary</CardTitle>
        </CardHeader>
        <ScrollArea className="flex-1">
          <CardContent className="pt-3 space-y-3">
            <p className="text-[10px] text-muted-foreground">{numSimulations.toLocaleString()} simulations</p>

            {/* Profit / Ruin Probabilities */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-xl bg-[hsl(220,15%,12%)] border border-[hsl(220,15%,18%)] text-center">
                <p className="text-[10px] text-muted-foreground mb-1">Profit Probability</p>
                <p className={`font-mono text-2xl font-bold ${profitProbability >= 0.5 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
                  {(profitProbability * 100).toFixed(1)}%
                </p>
              </div>
              <div className="p-3 rounded-xl bg-[hsl(220,15%,12%)] border border-[hsl(220,15%,18%)] text-center">
                <p className="text-[10px] text-muted-foreground mb-1">Ruin Probability</p>
                <p className={`font-mono text-2xl font-bold ${ruinProbability <= 0.05 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
                  {(ruinProbability * 100).toFixed(2)}%
                </p>
              </div>
            </div>

            {/* Terminal equity stats */}
            <div className="p-2.5 rounded-xl bg-[hsl(220,15%,12%)] border border-[hsl(220,15%,18%)] space-y-1.5 text-xs">
              <p className="text-[10px] text-muted-foreground font-medium">Terminal Equity</p>
              <div className="flex justify-between"><span className="text-muted-foreground">Mean</span><span className="font-mono">${terminalEquity.mean.toFixed(0)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Median</span><span className="font-mono">${terminalEquity.median.toFixed(0)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Std Dev</span><span className="font-mono">${terminalEquity.stdDev.toFixed(0)}</span></div>
            </div>

            {/* Confidence Intervals */}
            <div className="p-2.5 rounded-xl bg-[hsl(220,15%,12%)] border border-[hsl(220,15%,18%)] space-y-1.5 text-xs">
              <p className="text-[10px] text-muted-foreground font-medium">Confidence Bands</p>
              {percentileKeys.map((pct) => (
                <div key={pct} className="flex justify-between">
                  <span className="text-muted-foreground">{(parseFloat(pct) * 100).toFixed(0)}th %ile</span>
                  <span className="font-mono">${terminalEquity.percentiles[pct]!.toFixed(0)}</span>
                </div>
              ))}
            </div>

            {/* Max DD stats */}
            <div className="p-2.5 rounded-xl bg-[hsl(220,15%,12%)] border border-[hsl(220,15%,18%)] space-y-1.5 text-xs">
              <p className="text-[10px] text-muted-foreground font-medium">Max Drawdown</p>
              <div className="flex justify-between"><span className="text-muted-foreground">Mean</span><span className="font-mono text-[hsl(var(--data-neg))]">${maxDrawdown.mean.toFixed(0)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Median</span><span className="font-mono text-[hsl(var(--data-neg))]">${maxDrawdown.median.toFixed(0)}</span></div>
            </div>
          </CardContent>
        </ScrollArea>
      </Card>

      {/* Right: histograms */}
      <div className="col-span-2 flex flex-col gap-3">
        {/* Terminal equity distribution */}
        <Card className="glass rounded-2xl flex-1 flex flex-col gradient-border">
          <CardHeader className="py-2 px-4 border-b border-white/5">
            <CardTitle className="text-xs font-medium text-muted-foreground">Terminal Equity Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={equityHistogram}>
                <defs>
                  <linearGradient id="colorMcEquity" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(185, 70%, 55%)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="hsl(185, 70%, 55%)" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                <XAxis dataKey="range" stroke="hsl(var(--muted-foreground))" fontSize={9} interval="preserveStartEnd" />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }}
                  formatter={(v: number) => [v, 'Count']}
                />
                <ReferenceLine x={equityHistogram.findIndex((b) => b.midpoint >= terminalEquity.median)} stroke="hsl(185, 70%, 55%)" strokeDasharray="5 5" label={{ value: 'Median', fill: 'hsl(185, 70%, 55%)', fontSize: 10 }} />
                <Bar dataKey="count" fill="url(#colorMcEquity)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Max drawdown distribution */}
        <Card className="glass rounded-2xl flex-1 flex flex-col gradient-border">
          <CardHeader className="py-2 px-4 border-b border-white/5">
            <CardTitle className="text-xs font-medium text-muted-foreground">Max Drawdown Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ddHistogram}>
                <defs>
                  <linearGradient id="colorMcDD" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(350, 70%, 55%)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="hsl(350, 70%, 55%)" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                <XAxis dataKey="range" stroke="hsl(var(--muted-foreground))" fontSize={9} interval="preserveStartEnd" />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }}
                  formatter={(v: number) => [v, 'Count']}
                />
                <Bar dataKey="count" fill="url(#colorMcDD)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
