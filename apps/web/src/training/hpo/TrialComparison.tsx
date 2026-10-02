import { useMemo, useState } from "react";
import { cn } from "@/shared/utils/utils";
import { Card } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/shared/ui/table";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import { Trophy, ArrowUpDown, CheckCircle2, Play, Diff, Hash } from "lucide-react";

interface TrialData {
  trialId: number;
  score: number;
  pruned: boolean;
  durationSec: number;
  params: Record<string, unknown>;
  metrics?: Record<string, number>;
  status: string;
}

interface TrialComparisonProps {
  trials: TrialData[];
  direction?: "maximize" | "minimize";
  searchDimensions?: Array<{
    name: string;
    type: string;
    min?: number;
    max?: number;
  }>;
  onApplyParams?: (params: Record<string, unknown>) => void;
  className?: string;
}

type SortKey = "score" | "duration" | "trial";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(4);
  }
  return String(value);
}

function computeRangePct(
  value: unknown,
  dim: { min?: number; max?: number } | undefined,
): number | null {
  if (dim == null || dim.min == null || dim.max == null) return null;
  if (typeof value !== "number") return null;
  const range = dim.max - dim.min;
  if (range === 0) return 50;
  return Math.max(0, Math.min(100, ((value - dim.min) / range) * 100));
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function TrialComparison({
  trials,
  direction = "maximize",
  searchDimensions,
  onApplyParams,
  className,
}: TrialComparisonProps) {
  const [topN, setTopN] = useState<number | "all">(5);
  const [sortBy, setSortBy] = useState<SortKey>("score");

  const dimMap = useMemo(() => {
    const map = new Map<string, { min?: number; max?: number }>();
    searchDimensions?.forEach((d) => map.set(d.name, { min: d.min, max: d.max }));
    return map;
  }, [searchDimensions]);

  const topTrials = useMemo(() => {
    const completed = trials.filter(
      (t) => !t.pruned && t.status === "completed",
    );

    const sorted = [...completed].sort((a, b) => {
      switch (sortBy) {
        case "duration":
          return a.durationSec - b.durationSec;
        case "trial":
          return a.trialId - b.trialId;
        case "score":
        default:
          return direction === "maximize"
            ? b.score - a.score
            : a.score - b.score;
      }
    });

    const limit = topN === "all" ? sorted.length : topN;
    return sorted.slice(0, limit);
  }, [trials, direction, topN, sortBy]);

  // Best trial is always the top scorer regardless of current sort
  const bestTrial = useMemo(() => {
    const completed = trials.filter(
      (t) => !t.pruned && t.status === "completed",
    );
    if (completed.length === 0) return null;
    return [...completed].sort((a, b) =>
      direction === "maximize" ? b.score - a.score : a.score - b.score,
    )[0];
  }, [trials, direction]);

  const paramNames = useMemo(() => {
    if (topTrials.length === 0) return [];
    const allKeys = new Set<string>();
    topTrials.forEach((t) =>
      Object.keys(t.params).forEach((k) => allKeys.add(k)),
    );
    return Array.from(allKeys).sort();
  }, [topTrials]);

  const metricNames = useMemo(() => {
    if (topTrials.length === 0) return [];
    const allKeys = new Set<string>();
    topTrials.forEach((t) => {
      if (t.metrics) Object.keys(t.metrics).forEach((k) => allKeys.add(k));
    });
    return Array.from(allKeys).sort();
  }, [topTrials]);

  const importantParams = useMemo(() => {
    const important = new Set<string>();
    for (const name of paramNames) {
      const numericValues = topTrials
        .map((t) => t.params[name])
        .filter((v): v is number => typeof v === "number");
      if (numericValues.length >= 2 && coefficientOfVariation(numericValues) > 0.1) {
        important.add(name);
      }
    }
    return important;
  }, [topTrials, paramNames]);

  if (trials.length === 0 || topTrials.length === 0) {
    return (
      <Card className={cn("bg-black/20 border-white/5 p-8 text-center", className)}>
        <Trophy className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">
          No completed trials to compare
        </p>
      </Card>
    );
  }

  return (
    <Card className={cn("bg-black/20 border-white/5 overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-400" />
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Trial Comparison
          </h4>
        </div>
        <Badge
          variant="outline"
          className="text-[10px] border-white/10 text-muted-foreground/70"
        >
          {direction === "maximize" ? "maximize ↑" : "minimize ↓"}
        </Badge>
      </div>

      {/* Controls Bar */}
      <div className="flex items-center gap-3 px-4 pb-3">
        <div className="flex items-center gap-1.5">
          <Hash className="h-3 w-3 text-muted-foreground/50" />
          <Select
            value={String(topN)}
            onValueChange={(v) => setTopN(v === "all" ? "all" : Number(v))}
          >
            <SelectTrigger className="h-7 w-[80px] text-[10px] bg-black/20 border-white/10">
              <SelectValue placeholder="Top N" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Top 3</SelectItem>
              <SelectItem value="5">Top 5</SelectItem>
              <SelectItem value="10">Top 10</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortKey)}
          >
            <SelectTrigger className="h-7 w-[100px] text-[10px] bg-black/20 border-white/10">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">Score</SelectItem>
              <SelectItem value="duration">Duration</SelectItem>
              <SelectItem value="trial">Trial #</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {bestTrial && onApplyParams && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 text-[10px] border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
            onClick={() => onApplyParams(bestTrial.params)}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Apply Best
          </Button>
        )}
      </div>

      {/* Comparison Table */}
      <ScrollArea className="w-full">
        <div className="min-w-max overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/5 hover:bg-transparent">
                {/* Sticky label column */}
                <TableHead className="text-[10px] font-mono text-muted-foreground/70 sticky left-0 z-10 bg-black/40 backdrop-blur-sm min-w-[140px]">
                  <Diff className="h-3 w-3 inline-block mr-1" />
                  Parameter
                </TableHead>
                {topTrials.map((trial, idx) => {
                  const isBest = bestTrial?.trialId === trial.trialId;
                  return (
                    <TableHead key={trial.trialId} className="text-center p-1 min-w-[120px]">
                      <div
                        className={cn(
                          "px-2 py-1 rounded text-center",
                          isBest && "bg-amber-500/10 border border-amber-500/20",
                        )}
                      >
                        <div className="text-[10px] font-mono text-muted-foreground/70">
                          Trial #{trial.trialId}
                        </div>
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] mt-0.5 font-mono",
                                  isBest
                                    ? "border-amber-500/40 text-amber-400 bg-amber-500/5"
                                    : "border-white/10 text-muted-foreground",
                                )}
                              >
                                {isBest && (
                                  <Trophy className="h-2.5 w-2.5 mr-0.5" />
                                )}
                                {formatValue(trial.score)}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="text-[10px]">
                              {isBest ? "Best trial" : `Rank #${idx + 1}`}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>

            <TableBody>
              {/* Parameter rows */}
              {paramNames.map((paramName) => {
                const isImportant = importantParams.has(paramName);
                return (
                  <TableRow
                    key={`param-${paramName}`}
                    className={cn(
                      "border-white/5 hover:bg-white/[0.02]",
                      isImportant && "bg-amber-500/[0.03]",
                    )}
                  >
                    <TableCell className="text-[11px] font-mono sticky left-0 z-10 bg-black/40 backdrop-blur-sm">
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground/80">{paramName}</span>
                        {isImportant && (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="h-3.5 px-1 text-[8px] border-amber-500/30 text-amber-400/70"
                                >
                                  var
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="text-[10px]">
                                High variance across top trials
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </TableCell>
                    {topTrials.map((trial) => {
                      const value = trial.params[paramName];
                      const isBest = bestTrial?.trialId === trial.trialId;
                      const matchesBest =
                        !isBest &&
                        bestTrial != null &&
                        value === bestTrial.params[paramName];
                      const pct = computeRangePct(value, dimMap.get(paramName));

                      return (
                        <TableCell
                          key={trial.trialId}
                          className={cn(
                            "text-[11px] font-mono text-center",
                            isBest && "border-l-2 border-l-amber-500/30",
                            matchesBest && "bg-[hsl(var(--data-pos))]/[0.06]",
                          )}
                        >
                          <div>{formatValue(value)}</div>
                          {pct !== null && (
                            <div className="mt-1 w-full bg-white/5 rounded-full h-1">
                              <div
                                className="h-1 rounded-full bg-[hsl(var(--data-pos))]"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}

              {/* Metrics rows */}
              {metricNames.length > 0 && (
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableCell
                    colSpan={topTrials.length + 1}
                    className="text-[9px] uppercase tracking-wider text-muted-foreground/40 font-medium py-1 sticky left-0 z-10 bg-black/40"
                  >
                    Metrics
                  </TableCell>
                </TableRow>
              )}
              {metricNames.map((metricName) => (
                <TableRow
                  key={`metric-${metricName}`}
                  className="border-white/5 hover:bg-white/[0.02]"
                >
                  <TableCell className="text-[11px] font-mono text-muted-foreground/60 sticky left-0 z-10 bg-black/40 backdrop-blur-sm">
                    {metricName}
                  </TableCell>
                  {topTrials.map((trial) => {
                    const isBest = bestTrial?.trialId === trial.trialId;
                    const value = trial.metrics?.[metricName];
                    return (
                      <TableCell
                        key={trial.trialId}
                        className={cn(
                          "text-[11px] font-mono text-center text-muted-foreground/80",
                          isBest && "border-l-2 border-l-amber-500/30",
                        )}
                      >
                        {formatValue(value)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}

              {/* Footer: Duration */}
              <TableRow className="border-white/5 border-t-white/10 hover:bg-white/[0.02]">
                <TableCell className="text-[10px] font-mono text-muted-foreground/50 sticky left-0 z-10 bg-black/40 backdrop-blur-sm">
                  Duration
                </TableCell>
                {topTrials.map((trial) => {
                  const isBest = bestTrial?.trialId === trial.trialId;
                  return (
                    <TableCell
                      key={trial.trialId}
                      className={cn(
                        "text-[10px] font-mono text-center text-muted-foreground/60",
                        isBest && "border-l-2 border-l-amber-500/30",
                      )}
                    >
                      {trial.durationSec.toFixed(1)}s
                    </TableCell>
                  );
                })}
              </TableRow>

              {/* Footer: Status */}
              <TableRow className="border-white/5 hover:bg-white/[0.02]">
                <TableCell className="text-[10px] font-mono text-muted-foreground/50 sticky left-0 z-10 bg-black/40 backdrop-blur-sm">
                  Status
                </TableCell>
                {topTrials.map((trial) => {
                  const isBest = bestTrial?.trialId === trial.trialId;
                  return (
                    <TableCell
                      key={trial.trialId}
                      className={cn(
                        "text-center",
                        isBest && "border-l-2 border-l-amber-500/30",
                      )}
                    >
                      <Badge
                        variant="outline"
                        className="text-[9px] border-[hsl(var(--data-pos)/0.3)] text-[hsl(var(--data-pos)/0.7)]"
                      >
                        <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
                        {trial.status}
                      </Badge>
                    </TableCell>
                  );
                })}
              </TableRow>

              {/* Action row */}
              {onApplyParams && (
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableCell className="sticky left-0 z-10 bg-black/40 backdrop-blur-sm" />
                  {topTrials.map((trial) => {
                    const isBest = bestTrial?.trialId === trial.trialId;
                    return (
                      <TableCell key={trial.trialId} className="text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(
                            "h-6 text-[10px]",
                            isBest
                              ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                              : "border-white/10 text-muted-foreground hover:bg-white/5",
                          )}
                          onClick={() => onApplyParams(trial.params)}
                        >
                          <Play className="h-3 w-3 mr-1" />
                          Apply
                        </Button>
                      </TableCell>
                    );
                  })}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>
    </Card>
  );
}

export default TrialComparison;
