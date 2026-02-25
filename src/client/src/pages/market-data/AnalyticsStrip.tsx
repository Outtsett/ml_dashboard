import { Badge } from "@/components/ui/badge";
import { Brain, Layers, Loader2, Play } from "lucide-react";
import type { RegimeInfo } from "@/components/RegimeLegend";

interface AnalyticsStripProps {
  effectiveSymbol: string;
  contract: string | null;
  displayDataLength: number;
  chartDataLength: number;
  replayActive: boolean;
  isLoadingMore: boolean;
  // Trade metrics
  tradeMetrics: {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    profitFactor: number;
  };
  // Model info
  modelCount: number;
  matchedModelId: string | null;
  regimeLegendInfo: RegimeInfo[];
  regimeIsTraining: boolean;
  regimeQualityScore: number | null | undefined;
  isTrainingActive: boolean;
}

export function AnalyticsStrip({
  effectiveSymbol, contract, displayDataLength, chartDataLength,
  replayActive, isLoadingMore,
  tradeMetrics, modelCount,
  matchedModelId, regimeLegendInfo, regimeIsTraining, regimeQualityScore,
  isTrainingActive,
}: AnalyticsStripProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-1 border-b border-white/5 shrink-0 text-[10px] bg-card/20">
      <span className="font-mono font-semibold text-primary text-xs">{effectiveSymbol}</span>
      {contract !== null && (
        <Badge variant="outline" className="text-[8px] border-amber-500/30 text-amber-400 py-0">
          Single Contract
        </Badge>
      )}

      <span className="text-muted-foreground font-mono">
        {displayDataLength.toLocaleString()}{replayActive ? ` / ${chartDataLength.toLocaleString()}` : ''} bars
      </span>

      <div className="flex-1" />

      {tradeMetrics.totalTrades > 0 && (
        <>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5">
            <span className="text-muted-foreground">Trades</span>
            <span className="font-mono text-foreground">{tradeMetrics.totalTrades}</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5">
            <span className="text-muted-foreground">WR</span>
            <span className="font-mono text-emerald-400">{tradeMetrics.winRate.toFixed(1)}%</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5">
            <span className="text-muted-foreground">P&L</span>
            <span className={`font-mono ${tradeMetrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {tradeMetrics.totalPnl >= 0 ? '+' : ''}${tradeMetrics.totalPnl.toFixed(0)}
            </span>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5">
            <span className="text-muted-foreground">PF</span>
            <span className="font-mono text-cyan-400">
              {tradeMetrics.profitFactor === Infinity ? '∞' : tradeMetrics.profitFactor.toFixed(2)}
            </span>
          </div>
        </>
      )}

      <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5">
        <Brain className="h-3 w-3 text-primary" />
        <span className="font-mono text-foreground">{modelCount}</span>
        <span className="text-muted-foreground">models</span>
      </div>

      {matchedModelId && !regimeIsTraining && (
        <Badge variant="outline" className="text-[8px] border-orange-500/30 text-orange-400 bg-orange-500/10 py-0 gap-1">
          <Layers className="h-2.5 w-2.5" />
          {matchedModelId} · {regimeLegendInfo.length}R
          {regimeQualityScore != null && (
            <span className="text-muted-foreground">Q:{regimeQualityScore.toFixed(0)}</span>
          )}
        </Badge>
      )}

      {isTrainingActive && (
        <Badge variant="outline" className="text-[8px] border-green-500/30 text-green-400 bg-green-500/10 py-0 gap-1">
          <Brain className="h-2.5 w-2.5 animate-pulse" /> Training
        </Badge>
      )}

      {replayActive && (
        <Badge variant="outline" className="text-[8px] border-violet-500/30 text-violet-400 bg-violet-500/10 py-0 gap-1">
          <Play className="h-2.5 w-2.5" /> Replay
        </Badge>
      )}

      {isLoadingMore && (
        <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
      )}
    </div>
  );
}
