import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Line, ReferenceLine,
} from "recharts";
import type { BacktestMetrics, BacktestRunResult } from "@/backtest/types";
import { StatRow } from "./StatRow";

/**
 * KNOWN BUG, deliberately preserved here — do not "tidy" this away.
 *
 * The P&L distribution chart below reads `net_pnl` / `running_pnl`, but the
 * server returns camelCase `netPnl` / `runningPnl` on every `BacktestTrade`
 * row. Those snake_case keys therefore never exist at runtime and the chart
 * has been plotting `?? 0` for both series — a flat line — for as long as this
 * mismatch has been here.
 *
 * The camelCase members below are what the rows ACTUALLY carry. They are
 * declared for two reasons: they make this type structurally honest about its
 * input, and — because a type whose members are all optional is a "weak type"
 * that TypeScript refuses to accept from a source sharing none of its keys —
 * they are what lets a real `BacktestTrade[]` assign here at all.
 *
 * Fixing the chart means switching the two reads below to the camelCase
 * fields. That is a behavior change (the series start showing real data), so
 * it is intentionally NOT bundled into a lint/type pass.
 */
interface TradeCostRow {
  /** Never present at runtime — see the note above. */
  net_pnl?: number;
  /** Never present at runtime — see the note above. */
  running_pnl?: number;
  /** The field the server actually sends; currently unread by this component. */
  netPnl?: number | null;
  /** The field the server actually sends; currently unread by this component. */
  runningPnl?: number | null;
}

interface CostsTabProps {
  trades: TradeCostRow[];
  metrics: BacktestMetrics | undefined;
  lastResult: BacktestRunResult | null;
}

export function CostsTab({ trades, metrics, lastResult }: CostsTabProps) {
  return (
    <div className="grid grid-cols-2 gap-3 h-full">
      <Card className="glass rounded-2xl flex flex-col gradient-border">
        <CardHeader className="py-2 px-4 border-b border-white/5">
          <CardTitle className="text-xs font-medium text-muted-foreground">P&L Distribution</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-2">
          {trades.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trades.map((t: TradeCostRow, i: number) => ({
                trade: i + 1,
                netPnl: t.net_pnl ?? 0,
                runningPnl: t.running_pnl ?? 0,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                <XAxis dataKey="trade" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px', fontSize: '11px' }} />
                <Legend wrapperStyle={{ fontSize: '10px' }} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Bar dataKey="netPnl" name="Trade P&L" fill="hsl(var(--primary))" />
                <Line type="monotone" dataKey="runningPnl" name="Cumulative" stroke="hsl(185, 70%, 55%)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Run a backtest to see P&L distribution
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass rounded-2xl flex flex-col gradient-border">
        <CardHeader className="py-2 px-4 border-b border-white/5">
          <CardTitle className="text-xs font-medium text-muted-foreground">Cost Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-3">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <p className="text-muted-foreground text-[10px] mb-1">Total Commissions</p>
            <p className="font-mono text-xl font-bold text-amber-400">
              {metrics ? `$${metrics.totalCommissions.toFixed(2)}` : '--'}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
            <p className="text-muted-foreground text-[10px] mb-1">Total Slippage</p>
            <p className="font-mono text-xl font-bold text-primary">
              {metrics ? `$${metrics.totalSlippage.toFixed(2)}` : '--'}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <p className="text-muted-foreground text-[10px] mb-1">Total Spread Cost</p>
            <p className="font-mono text-xl font-bold text-violet-400">
              {metrics ? `$${metrics.totalSpreadCost.toFixed(2)}` : '--'}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
            <p className="text-muted-foreground text-[10px] mb-1">Total Cost Impact</p>
            <p className="font-mono text-xl font-bold text-rose-400">
              {metrics ? `$${(metrics.totalCommissions + metrics.totalSlippage + metrics.totalSpreadCost).toFixed(2)}` : '--'}
            </p>
            {metrics && metrics.totalReturn !== 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {((metrics.totalCommissions + metrics.totalSlippage + metrics.totalSpreadCost) / Math.abs(metrics.totalReturn) * 100).toFixed(1)}% of gross P&L
              </p>
            )}
          </div>
          {lastResult?.run?.broker_label && (
            <div className="pt-2 border-t border-white/5 space-y-2 text-xs">
              <StatRow label="Broker" value={lastResult.run.broker_label} />
              <StatRow label="Profile" value={lastResult.run.broker_name ?? '--'} />
              {metrics && (
                <StatRow label="Cost/Trade" value={`$${((metrics.totalCommissions + metrics.totalSlippage + metrics.totalSpreadCost) / Math.max(metrics.totalTrades, 1)).toFixed(2)}`} />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
