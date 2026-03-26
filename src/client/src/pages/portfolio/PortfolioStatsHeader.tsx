import { Wallet, DollarSign, TrendingUp, Target, Loader2 } from "lucide-react";
import type { Trade } from "@/lib/types";
import type { Position } from "./types";

interface PortfolioStatsHeaderProps {
  isLoading: boolean;
  positions: Position[];
  closedTradesRaw: Trade[];
  totalValue: number;
  totalPnL: number;
  dailyPnL: number;
  winRate: number | null;
}

export function PortfolioStatsHeader({
  isLoading,
  positions,
  closedTradesRaw,
  totalValue,
  totalPnL,
  dailyPnL,
  winRate,
}: PortfolioStatsHeaderProps) {
  return (
    <div className="grid grid-cols-4 gap-4 shrink-0">
      <div className="bg-gradient-to-br from-violet-500/10 to-violet-600/5 rounded-xl p-5 border border-violet-500/20">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <Wallet className="h-5 w-5 text-violet-400" />
          </div>
          <div className="text-xs text-violet-300/70 uppercase tracking-wider">Portfolio Value</div>
        </div>
        <div className="flex items-end justify-between">
          <div className="text-3xl font-bold text-violet-200 font-mono">
            {isLoading ? (
              <Loader2 className="h-7 w-7 animate-spin opacity-40" />
            ) : positions.length > 0 ? (
              `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ) : (
              "--"
            )}
          </div>
        </div>
      </div>
      <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-xl p-5 border border-emerald-500/20">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <DollarSign className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="text-xs text-emerald-300/70 uppercase tracking-wider">Total P&L</div>
        </div>
        <div className="flex items-end justify-between">
          <div
            className={`text-3xl font-bold font-mono ${
              totalPnL >= 0 ? "text-emerald-200" : "text-rose-200"
            }`}
          >
            {isLoading ? (
              <Loader2 className="h-7 w-7 animate-spin opacity-40" />
            ) : closedTradesRaw.length > 0 ? (
              `${totalPnL >= 0 ? "+" : ""}$${totalPnL.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`
            ) : (
              "--"
            )}
          </div>
        </div>
      </div>
      <div className="bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 rounded-xl p-5 border border-cyan-500/20">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-cyan-400" />
          </div>
          <div className="text-xs text-cyan-300/70 uppercase tracking-wider">Today's P&L</div>
        </div>
        <div className="flex items-end justify-between">
          <div
            className={`text-3xl font-bold font-mono ${
              dailyPnL >= 0 ? "text-cyan-200" : "text-rose-200"
            }`}
          >
            {isLoading ? (
              <Loader2 className="h-7 w-7 animate-spin opacity-40" />
            ) : closedTradesRaw.length > 0 ? (
              `${dailyPnL >= 0 ? "+" : ""}$${dailyPnL.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`
            ) : (
              "--"
            )}
          </div>
        </div>
      </div>
      <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-xl p-5 border border-amber-500/20">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
            <Target className="h-5 w-5 text-amber-400" />
          </div>
          <div className="text-xs text-amber-300/70 uppercase tracking-wider">Win Rate</div>
        </div>
        <div className="flex items-end justify-between">
          <div className="text-3xl font-bold text-amber-200 font-mono">
            {isLoading ? (
              <Loader2 className="h-7 w-7 animate-spin opacity-40" />
            ) : winRate !== null ? (
              `${winRate}%`
            ) : (
              "--"
            )}
          </div>
          {winRate !== null && (
            <div className="text-xs text-muted-foreground/60">
              {closedTradesRaw.length} trades
            </div>
          )}
          {winRate === null && !isLoading && (
            <div className="text-xs text-muted-foreground/60">no closed trades</div>
          )}
        </div>
      </div>
    </div>
  );
}
