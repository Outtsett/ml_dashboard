import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from "recharts";
import type { BenchmarkResult } from "./types";

interface BenchmarkTabProps {
  result: BenchmarkResult | null;
  isPending: boolean;
}

export function BenchmarkTab({ result, isPending }: BenchmarkTabProps) {
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        {isPending ? 'Computing benchmark comparison...' : 'Run benchmark analysis to see results'}
      </div>
    );
  }

  const { buyAndHold, comparison, rollingMetrics } = result;

  // Merge strategy equity and buy&hold equity into one series for overlay
  const overlaidCurve = buyAndHold.equityCurve.map((pt, i) => ({
    time: new Date(pt.timestamp).toLocaleDateString(),
    benchmark: pt.equity,
    // If we have a strategy equity curve in the benchmark result, use it
    // Otherwise we just show buy&hold
    strategy: undefined as number | undefined,
  }));

  // Rolling sharpe data
  const rollingData = rollingMetrics.map((rm) => ({
    time: new Date(rm.timestamp).toLocaleDateString(),
    strategy: rm.strategySharpe,
    benchmark: rm.benchmarkSharpe,
    alpha: rm.rollingAlpha,
  }));

  const metricCards = [
    { label: 'Alpha', value: comparison.alpha.toFixed(4), color: comparison.alpha >= 0 ? 'text-emerald-400' : 'text-rose-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
    { label: 'Beta', value: comparison.beta.toFixed(3), color: 'text-[hsl(185,40%,45%)]', bg: 'bg-[hsl(185,40%,45%)]/10 border-[hsl(185,40%,45%)]/20' },
    { label: 'Information Ratio', value: comparison.informationRatio.toFixed(3), color: comparison.informationRatio >= 0 ? 'text-emerald-400' : 'text-rose-400', bg: 'bg-violet-500/10 border-violet-500/20' },
    { label: 'Tracking Error', value: `${(comparison.trackingError * 100).toFixed(2)}%`, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
    { label: 'Up Capture', value: `${(comparison.upCaptureRatio * 100).toFixed(0)}%`, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
    { label: 'Down Capture', value: `${(comparison.downCaptureRatio * 100).toFixed(0)}%`, color: comparison.downCaptureRatio <= 1 ? 'text-emerald-400' : 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20' },
  ];

  return (
    <div className="grid grid-cols-3 gap-3 h-full">
      {/* Left column: comparison metrics */}
      <Card className="col-span-1 glass rounded-2xl flex flex-col gradient-border">
        <CardHeader className="py-2 px-4 border-b border-white/5">
          <CardTitle className="text-xs font-medium text-muted-foreground">Strategy vs Buy &amp; Hold</CardTitle>
        </CardHeader>
        <CardContent className="pt-3 space-y-2">
          {metricCards.map((mc) => (
            <div key={mc.label} className={`p-2.5 rounded-xl ${mc.bg} border`}>
              <p className="text-[10px] text-muted-foreground mb-0.5">{mc.label}</p>
              <p className={`font-mono text-lg font-bold ${mc.color}`}>{mc.value}</p>
            </div>
          ))}

          <div className="pt-2 border-t border-white/5 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">B&H Return</span>
              <span className={`font-mono ${buyAndHold.totalReturnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {buyAndHold.totalReturnPct >= 0 ? '+' : ''}{buyAndHold.totalReturnPct.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">B&H Max DD</span>
              <span className="font-mono text-rose-400">{buyAndHold.maxDrawdownPct.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">B&H Sharpe</span>
              <span className="font-mono">{buyAndHold.sharpeRatio.toFixed(2)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Right column: charts */}
      <div className="col-span-2 flex flex-col gap-3">
        {/* Equity curve overlay */}
        <Card className="glass rounded-2xl flex-1 flex flex-col gradient-border">
          <CardHeader className="py-2 px-4 border-b border-white/5">
            <CardTitle className="text-xs font-medium text-muted-foreground">Equity Curves</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overlaidCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={9} interval="preserveStartEnd" />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }}
                  formatter={(v: number, name: string) => [`$${v.toFixed(2)}`, name === 'benchmark' ? 'Buy & Hold' : 'Strategy']} />
                <Legend wrapperStyle={{ fontSize: '10px' }} />
                {overlaidCurve.some((pt) => pt.strategy !== undefined) && (
                  <Line type="monotone" dataKey="strategy" name="Strategy" stroke="hsl(185, 70%, 55%)" strokeWidth={2} dot={false} />
                )}
                <Line type="monotone" dataKey="benchmark" name="Buy & Hold" stroke="hsl(220, 10%, 50%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Rolling Sharpe comparison */}
        <Card className="glass rounded-2xl flex-1 flex flex-col gradient-border">
          <CardHeader className="py-2 px-4 border-b border-white/5">
            <CardTitle className="text-xs font-medium text-muted-foreground">Rolling Sharpe Ratio</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-2">
            {rollingData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rollingData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={9} interval="preserveStartEnd" />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }}
                    formatter={(v: number, name: string) => [v.toFixed(3), name === 'strategy' ? 'Strategy Sharpe' : name === 'benchmark' ? 'B&H Sharpe' : 'Rolling α']} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Line type="monotone" dataKey="strategy" name="Strategy Sharpe" stroke="hsl(185, 70%, 55%)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="benchmark" name="B&H Sharpe" stroke="hsl(220, 10%, 50%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No rolling metrics data
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
