import { memo } from "react";
import { Badge } from "@/shared/ui/badge";
import { Brain, Layers, Loader2, Play } from "lucide-react";
import type { RegimeInfo } from "@/ml/components/RegimeLegend";

interface AnalyticsStripProps {
  symbol: string;
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

export const MarketAnalyticsStrip = memo(function MarketAnalyticsStrip({
  symbol, displayDataLength, chartDataLength,
  replayActive, isLoadingMore,
  tradeMetrics, modelCount,
  matchedModelId, regimeLegendInfo, regimeIsTraining, regimeQualityScore,
  isTrainingActive,
}: AnalyticsStripProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 border-b border-white/[0.06] shrink-0 text-[11px] bg-gradient-to-b from-card/30 to-card/15 backdrop-blur-sm">
      <span className="font-mono font-bold text-primary text-sm tracking-wide drop-shadow-[0_0_8px_rgba(96,165,250,0.3)]">{symbol}</span>

      <span className="text-muted-foreground font-mono text-[10px] bg-white/[0.04] px-2 py-0.5 rounded-full border border-white/[0.06]">
        {displayDataLength.toLocaleString()}{replayActive ? ` / ${chartDataLength.toLocaleString()}` : ''} bars
      </span>

      <div className="flex-1" />

      {tradeMetrics.totalTrades > 0 ? (
        <>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
            <span className="text-muted-foreground">Trades</span>
            <span className="font-mono font-medium text-foreground">{tradeMetrics.totalTrades}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border-l-2 border-l-emerald-500/40 border border-white/[0.06]">
            <span className="text-muted-foreground">WR</span>
            <span className="font-mono font-medium text-emerald-400">{tradeMetrics.winRate.toFixed(1)}%</span>
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border-l-2 ${tradeMetrics.totalPnl >= 0 ? 'border-l-emerald-500/40' : 'border-l-rose-500/40'} border border-white/[0.06]`}>
            <span className="text-muted-foreground">P&L</span>
            <span className={`font-mono font-medium ${tradeMetrics.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {tradeMetrics.totalPnl >= 0 ? '+' : ''}${tradeMetrics.totalPnl.toFixed(0)}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border-l-2 border-l-cyan-500/40 border border-white/[0.06]">
            <span className="text-muted-foreground">PF</span>
            <span className="font-mono font-medium text-cyan-400">
              {tradeMetrics.profitFactor === Infinity ? '∞' : tradeMetrics.profitFactor.toFixed(2)}
            </span>
          </div>
        </>
      ) : (
        <span className="text-muted-foreground/50 font-mono text-[10px] italic">No active trades</span>
      )}

      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06]">
        <Brain className="h-3 w-3 text-primary drop-shadow-[0_0_4px_rgba(96,165,250,0.4)]" />
        <span className="font-mono font-medium text-foreground">{modelCount}</span>
        <span className="text-muted-foreground">models</span>
      </div>

      {matchedModelId && !regimeIsTraining && (
        <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-400 bg-orange-500/10 py-0.5 px-2 gap-1 shadow-[0_0_6px_rgba(249,115,22,0.1)]">
          <Layers className="h-2.5 w-2.5 drop-shadow-[0_0_3px_rgba(249,115,22,0.4)]" />
          {matchedModelId} · {regimeLegendInfo.length}R
          {regimeQualityScore != null && (
            <span className="text-muted-foreground">Q:{regimeQualityScore.toFixed(0)}</span>
          )}
        </Badge>
      )}

      {isTrainingActive && (
        <Badge variant="outline" className="text-[9px] border-green-500/30 text-green-400 bg-green-500/10 py-0.5 px-2 gap-1 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.15)]">
          <Brain className="h-2.5 w-2.5" /> Training
        </Badge>
      )}

      {replayActive && (
        <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-400 bg-violet-500/10 py-0.5 px-2 gap-1 animate-pulse shadow-[0_0_8px_rgba(139,92,246,0.15)]">
          <Play className="h-2.5 w-2.5" /> Replay
        </Badge>
      )}

      {isLoadingMore && (
        <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
      )}
    </div>
  );
});
