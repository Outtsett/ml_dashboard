import { memo } from "react";
import { Badge } from "@/shared/ui/badge";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { Trade } from "@/shared/utils/types";
import type { DashboardLog } from "@/shared/contexts/UnifiedDashboardContext";

export const TradeRow = memo(({ trade }: { trade: Trade }) => (
  <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
    <div className="flex items-center gap-2.5">
      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${trade.side === 'long' ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
        {trade.side === 'long' ? <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> : <TrendingDown className="h-3.5 w-3.5 text-rose-400" />}
      </div>
      <div className="min-w-0">
        <div className="font-medium text-xs truncate">{trade.symbol}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {trade.entryPrice?.toFixed(2)} → {trade.exitPrice?.toFixed(2) || 'open'}
        </div>
      </div>
    </div>
    <div className="text-right shrink-0">
      {trade.pnl !== null && trade.pnl !== undefined ? (
        <div className={`font-mono text-xs ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {trade.pnl >= 0 ? '+' : ''}{trade.pnl?.toFixed(2)}
        </div>
      ) : (
        <Badge className="bg-amber-500/20 text-amber-400 text-[9px]">Open</Badge>
      )}
    </div>
  </div>
));

export const logColors: Record<DashboardLog["level"], string> = {
  info: "text-blue-400",
  success: "text-emerald-400",
  warning: "text-amber-400",
  error: "text-rose-400",
};

export const LogEntry = memo(({ log }: { log: DashboardLog }) => (
  <div className="flex items-start gap-2 py-1 px-2 hover:bg-white/5 rounded font-mono text-[11px]">
    <span className="text-muted-foreground/50 shrink-0 tabular-nums">
      {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
    </span>
    <Badge variant="outline" className={`text-[8px] px-1 py-0 rounded shrink-0 border-transparent ${logColors[log.level]}`}>
      {log.level.toUpperCase()}
    </Badge>
    <span className="text-muted-foreground/60 shrink-0">[{log.source}]</span>
    <span className={`break-all ${logColors[log.level]}`}>{log.message}</span>
  </div>
));
