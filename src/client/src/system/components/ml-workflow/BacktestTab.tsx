/**
 * BacktestTab — Model selector, config, results, previous runs.
 */

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Loader2, FlaskConical, Activity } from "lucide-react";
import type { BacktestTabProps } from "@/system/components/ml-workflow/types";

export function BacktestTab({
  btModel, setBtModel,
  btCapital, setBtCapital,
  btPositionSize, setBtPositionSize,
  btMinConfidence, setBtMinConfidence,
  btResult, btTradesData,
  btSelectedRunId, setBtSelectedRunId,
  previousRuns,
  onRunBacktest, isRunningBacktest,
  onClearResults,
  symbol, mlModels,
}: BacktestTabProps) {
  return (
    <div className="p-3 space-y-3">
      {/* Model selector */}
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">Model</label>
        <Select value={btModel} onValueChange={setBtModel}>
          <SelectTrigger className="h-7 text-[10px] bg-black/30 border-white/10">
            <SelectValue placeholder="Select model..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__last_trained__" className="text-xs">Last Trained</SelectItem>
            <SelectItem value="momentum" className="text-xs">Momentum (baseline)</SelectItem>
            {mlModels.filter(m => m.name.includes(symbol)).map(m => (
              <SelectItem key={m.id} value={String(m.id)} className="text-xs">{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Config rows */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Capital</label>
          <Input type="number" value={btCapital} onChange={e => setBtCapital(parseInt(e.target.value) || 10000)} className="h-7 text-[10px] bg-black/30 border-white/10" />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Size</label>
          <Input type="number" value={btPositionSize} onChange={e => setBtPositionSize(parseInt(e.target.value) || 1)} className="h-7 text-[10px] bg-black/30 border-white/10" />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">Min Confidence</label>
        <Input type="number" step="0.05" value={btMinConfidence} onChange={e => setBtMinConfidence(parseFloat(e.target.value) || 0.5)} className="h-7 text-[10px] bg-black/30 border-white/10" />
      </div>

      {/* Run backtest */}
      <Button
        onClick={onRunBacktest}
        disabled={isRunningBacktest || !symbol}
        className="w-full h-8 text-xs bg-linear-to-r from-amber-600 to-orange-500 hover:opacity-90"
      >
        {isRunningBacktest ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <FlaskConical className="h-3 w-3 mr-1.5" />}
        Run Backtest
      </Button>

      {/* Results summary */}
      {btResult && (
        <div className="space-y-2">
          <div className="p-2 rounded-lg bg-white/5 border border-white/10 space-y-1">
            <p className="text-[10px] text-muted-foreground font-medium">Results</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <div className="flex justify-between">
                <span className="text-[9px] text-muted-foreground">Trades</span>
                <span className="text-[10px] font-mono text-foreground">{btResult.metrics.totalTrades}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[9px] text-muted-foreground">Win Rate</span>
                <span className={`text-[10px] font-mono ${btResult.metrics.winRate >= 50 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
                  {btResult.metrics.winRate.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[9px] text-muted-foreground">P&L</span>
                <span className={`text-[10px] font-mono ${btResult.metrics.totalPnl >= 0 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
                  ${btResult.metrics.totalPnl.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[9px] text-muted-foreground">Sharpe</span>
                <span className="text-[10px] font-mono text-foreground">{btResult.metrics.sharpeRatio?.toFixed(2) || '--'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[9px] text-muted-foreground">Max DD</span>
                <span className="text-[10px] font-mono text-[hsl(var(--data-neg))]">{btResult.metrics.maxDrawdown?.toFixed(2) || '--'}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[9px] text-muted-foreground">Profit F.</span>
                <span className="text-[10px] font-mono text-foreground">{btResult.metrics.profitFactor?.toFixed(2) || '--'}</span>
              </div>
            </div>
          </div>

          {/* Trades visible on chart indicator */}
          {btTradesData?.chartMarkers && btTradesData.chartMarkers.length > 0 && (
            <div className="flex items-center gap-1.5 text-[9px] text-amber-400">
              <Activity className="h-3 w-3" />
              {btTradesData.chartMarkers.length} trade markers shown on chart
            </div>
          )}

          {/* Clear results */}
          <Button
            variant="outline"
            size="sm"
            className="w-full h-6 text-[10px] border-white/10"
            onClick={onClearResults}
          >
            Clear Results
          </Button>
        </div>
      )}

      {/* Previous runs */}
      {previousRuns.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground font-medium">Recent Runs</p>
          <div className="space-y-1 max-h-32 overflow-auto">
            {previousRuns.slice(0, 5).map((run) => (
              <button
                key={run.id}
                onClick={() => setBtSelectedRunId(run.id)}
                className={`w-full text-left p-1.5 rounded text-[9px] transition-colors ${
                  btSelectedRunId === run.id ? 'bg-amber-500/20 border border-amber-500/30' : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex justify-between">
                  <span className="font-mono text-foreground">{run.symbol || symbol}</span>
                  <span className={`font-mono ${(run.totalPnl || 0) >= 0 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
                    ${(run.totalPnl || 0).toFixed(0)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
