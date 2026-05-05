import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity,
  Trophy,
  Clock,
  TrendingUp,
  Hash,
  AlertTriangle,
  Pause,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { HPOSession } from "@shared/hpoTypes";

interface HPOMetricsCardsProps {
  sessionData: HPOSession | null;
  status: string;
  trialsCount: number;
  prunedCount: number;
  elapsedSec: number;
  bestScore: number | null | undefined;
  isRunning: boolean;
  isDone: boolean;
  stopping: boolean;
  applying: boolean;
  handleStop: () => void;
  handleApplyBest: () => void;
  onClose?: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  pending: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
  stopped: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  pruned: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function formatScore(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.abs(v) < 0.001 ? v.toExponential(3) : v.toFixed(5);
}

export function HPOMetricsCards({
  sessionData,
  status,
  trialsCount,
  prunedCount,
  elapsedSec,
  bestScore,
  isRunning,
  isDone,
  stopping,
  applying,
  handleStop,
  handleApplyBest,
  onClose,
}: HPOMetricsCardsProps) {
  const totalTrials = sessionData?.totalTrials ?? 0;

  return (
    <Card className="bg-black/20 border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Left: session info */}
        <div className="flex items-center gap-3 min-w-0">
          <Activity className="h-4 w-4 text-blue-400 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium truncate">
                {sessionData?.modelType ?? "HPO"}
              </span>
              {sessionData?.optimizerType && (
                <Badge
                  variant="outline"
                  className="text-[9px] bg-blue-500/10 text-blue-400 border-blue-500/20"
                >
                  {sessionData.optimizerType}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={cn("text-[9px]", STATUS_STYLES[status] ?? STATUS_STYLES.pending)}
              >
                {status}
              </Badge>
            </div>
            {sessionData?.objectiveMetric && (
              <p className="text-[9px] text-muted-foreground/50 mt-0.5">
                Optimizing: {sessionData.objectiveMetric}
                {sessionData.symbol && ` · ${sessionData.symbol}`}
                {sessionData.timeframe && ` / ${sessionData.timeframe}`}
              </p>
            )}
          </div>
        </div>

        {/* Center: stats */}
        <div className="flex items-center gap-5">
          <TooltipProvider delayDuration={200}>
            <UITooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Hash className="h-3 w-3" />
                  <span className="text-xs font-mono">
                    {trialsCount}
                    {totalTrials > 0 && <span className="text-muted-foreground/50">/{totalTrials}</span>}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px]">
                Completed trials
              </TooltipContent>
            </UITooltip>
          </TooltipProvider>

          {prunedCount > 0 && (
            <TooltipProvider delayDuration={200}>
              <UITooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 text-amber-400/70">
                    <AlertTriangle className="h-3 w-3" />
                    <span className="text-xs font-mono">{prunedCount}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[10px]">
                  Pruned trials
                </TooltipContent>
              </UITooltip>
            </TooltipProvider>
          )}

          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="text-xs font-mono">{formatDuration(elapsedSec)}</span>
          </div>

          {bestScore !== undefined && bestScore !== null && (
            <div className="flex items-center gap-1.5">
              <Trophy className="h-3 w-3 text-amber-400" />
              <span className="text-lg font-bold text-emerald-400">
                {formatScore(bestScore)}
              </span>
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">
          {isRunning && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={handleStop}
              disabled={stopping}
            >
              <Pause className="h-3 w-3 mr-1" />
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          )}
          {isDone && bestScore !== undefined && bestScore !== null && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px] border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              onClick={handleApplyBest}
              disabled={applying}
            >
              <TrendingUp className="h-3 w-3 mr-1" />
              {applying ? "Applying…" : "Apply Best Params"}
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-white"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
