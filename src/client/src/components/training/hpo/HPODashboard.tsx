import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { logError } from "../../../lib/errorLogger";

// shadcn UI components
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Icons
import {
  Activity,
  Trophy,
  Clock,
  TrendingUp,
  Hash,
  AlertTriangle,
  Pause,
  X,
  ChevronDown,
} from "lucide-react";

// Shared types
import type { TrialResult, HPOSession } from "@shared/hpoTypes";

// ---------------------------------------------------------------------------

interface HPODashboardProps {
  sessionId: string;
  onClose?: () => void;
  onApplyParams?: (params: Record<string, any>) => void;
}

type SessionStatus = "pending" | "running" | "completed" | "failed" | "stopped";
type SortField = "trialId" | "score" | "durationSec";
type SortDir = "asc" | "desc";

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

// ---------------------------------------------------------------------------

function HPODashboard({ sessionId, onClose, onApplyParams }: HPODashboardProps) {
  const [trials, setTrials] = useState<TrialResult[]>([]);
  const [bestTrial, setBestTrial] = useState<{
    trialId: number;
    bestScore: number;
    bestParams: Record<string, any>;
  } | null>(null);
  const [prunedCount, setPrunedCount] = useState(0);
  const [status, setStatus] = useState<SessionStatus>("pending");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [sortField, setSortField] = useState<SortField>("trialId");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selectedParam, setSelectedParam] = useState<string>("");
  const [applying, setApplying] = useState(false);
  const [stopping, setStopping] = useState(false);

  const startTimeRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Initial data fetch (reconnection / past sessions) ------------------

  const { data: sessionData } = useQuery<HPOSession | null>({
    queryKey: ["hpo-session", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/hpo/sessions/${sessionId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!sessionId,
    staleTime: 10_000,
  });

  // Hydrate local state from fetched session data
  useEffect(() => {
    if (!sessionData) return;
    if (sessionData.trials?.length) setTrials(sessionData.trials);
    if (sessionData.bestScore != null && sessionData.bestParams) {
      setBestTrial({
        trialId: sessionData.bestTrialId ?? 0,
        bestScore: sessionData.bestScore,
        bestParams: sessionData.bestParams,
      });
    }
    setPrunedCount(sessionData.prunedTrials ?? 0);
    setStatus(sessionData.status as SessionStatus);
    setElapsedSec(sessionData.elapsedSec ?? 0);
    if (sessionData.startedAt) startTimeRef.current = sessionData.startedAt;
  }, [sessionData]);

  // ---- Elapsed timer (while running) --------------------------------------

  useEffect(() => {
    if (status === "running") {
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.round((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  // ---- SSE stream for live updates ----------------------------------------

  useEffect(() => {
    if (!sessionId || status === "completed" || status === "failed" || status === "stopped") return;

    const eventSource = new EventSource(
      `/api/hpo/stream/${sessionId}?from=${trials.length}`,
    );

    eventSource.addEventListener("hpo-trial-done", (e) => {
      try {
        const trial: TrialResult = JSON.parse(e.data);
        setTrials((prev) => [...prev, trial]);
        if (trial.pruned) setPrunedCount((p) => p + 1);
      } catch (err) {
        logError('HPODashboard', 'Failed to parse hpo-trial-done SSE event', { error: String(err) });
      }
    });

    eventSource.addEventListener("hpo-best-update", (e) => {
      try {
        const data = JSON.parse(e.data);
        setBestTrial(data);
      } catch (err) {
        logError('HPODashboard', 'Failed to parse hpo-best-update SSE event', { error: String(err) });
      }
    });

    eventSource.addEventListener("hpo-trial-pruned", (e) => {
      try {
        const data: TrialResult = JSON.parse(e.data);
        setPrunedCount((p) => p + 1);
        setTrials((prev) => {
          const idx = prev.findIndex((t) => t.trialId === data.trialId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], pruned: true } as TrialResult;
            return next;
          }
          return [...prev, data];
        });
      } catch (err) {
        logError('HPODashboard', 'Failed to parse hpo-trial-pruned SSE event', { error: String(err) });
      }
    });

    eventSource.addEventListener("hpo-complete", () => {
      setStatus("completed");
      eventSource.close();
    });

    eventSource.addEventListener("hpo-error", () => {
      setStatus("failed");
      eventSource.close();
    });

    eventSource.addEventListener("connected", () => {
      setStatus("running");
    });

    eventSource.onerror = () => {
      logError('HPODashboard', 'SSE connection error, browser will auto-reconnect', { sessionId });
    };

    return () => eventSource.close();
    // Re-subscribe when sessionId changes or when status transitions to a
    // terminal state so the cleanup closes the stream.
  }, [sessionId, status]);

  // ---- Derived data -------------------------------------------------------

  const isMaximize = useMemo(() => {
    if (!sessionData) return true;
    // Convention: if objectiveMetric contains "loss" or "error", minimize
    const metric = sessionData.objectiveMetric?.toLowerCase() ?? "";
    return !(metric.includes("loss") || metric.includes("error") || metric.includes("mse") || metric.includes("mae"));
  }, [sessionData]);

  const compareFn = useCallback(
    (a: number, b: number) => (isMaximize ? Math.max(a, b) : Math.min(a, b)),
    [isMaximize],
  );

  const chartData = useMemo(() => {
    const worstInit = isMaximize ? -Infinity : Infinity;
    let bestSoFar = worstInit;
    return trials.map((t, i) => {
      bestSoFar = compareFn(bestSoFar, t.score);
      return {
        trial: i + 1,
        score: t.score,
        bestSoFar,
        pruned: t.pruned,
      };
    });
  }, [trials, compareFn, isMaximize]);

  const totalTrials = sessionData?.totalTrials ?? 0;

  // Param names for the scatter section
  const paramNames = useMemo(() => {
    if (trials.length === 0) return [];
    const keys = new Set<string>();
    for (const t of trials) {
      for (const k of Object.keys(t.params)) keys.add(k);
    }
    return Array.from(keys);
  }, [trials]);

  // Auto-select first param if none selected
  useEffect(() => {
    if (!selectedParam && paramNames.length > 0) setSelectedParam(paramNames[0]!);
  }, [paramNames, selectedParam]);

  const scatterData = useMemo(() => {
    if (!selectedParam) return [];
    return trials
      .filter((t) => !t.pruned && t.params[selectedParam] != null)
      .map((t) => ({
        value: Number(t.params[selectedParam]),
        score: t.score,
        trial: t.trialId,
      }));
  }, [trials, selectedParam]);

  // Top params for table badges (most varied numeric params)
  const topParamKeys = useMemo(() => {
    return paramNames.slice(0, 4);
  }, [paramNames]);

  // Sorted trials for the table
  const sortedTrials = useMemo(() => {
    const arr = [...trials];
    arr.sort((a, b) => {
      const va = a[sortField] as number;
      const vb = b[sortField] as number;
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return arr;
  }, [trials, sortField, sortDir]);

  // ---- Actions ------------------------------------------------------------

  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      await fetch(`/api/hpo/stop/${sessionId}`, { method: "POST" });
      setStatus("stopped");
    } catch (err) {
      logError('HPODashboard', 'Failed to stop HPO session', { sessionId, error: String(err) });
    } finally {
      setStopping(false);
    }
  }, [sessionId]);

  const handleApplyBest = useCallback(async () => {
    if (!bestTrial) return;
    setApplying(true);
    try {
      await fetch(`/api/hpo/sessions/${sessionId}/apply`, { method: "POST" });
      onApplyParams?.(bestTrial.bestParams);
    } catch (err) {
      logError('HPODashboard', 'Failed to apply best HPO params', { sessionId, error: String(err) });
    } finally {
      setApplying(false);
    }
  }, [sessionId, bestTrial, onApplyParams]);

  const toggleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir(field === "score" ? "desc" : "asc");
      }
    },
    [sortField],
  );

  const isRunning = status === "running" || status === "pending";
  const isDone = status === "completed" || status === "stopped";

  // ---- Render -------------------------------------------------------------

  if (!sessionId) {
    return (
      <Card className="bg-black/20 border-white/5 p-8">
        <div className="flex items-center justify-center text-muted-foreground min-h-[120px]">
          <p className="text-xs">No HPO session selected.</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ================================================================= */}
      {/* Section 1 — Header Bar                                            */}
      {/* ================================================================= */}
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
                      {trials.length}
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

            {bestTrial && (
              <div className="flex items-center gap-1.5">
                <Trophy className="h-3 w-3 text-amber-400" />
                <span className="text-lg font-bold text-emerald-400">
                  {formatScore(bestTrial.bestScore)}
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
            {isDone && bestTrial && (
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

      {/* ================================================================= */}
      {/* Section 2 — Optimization History Chart                            */}
      {/* ================================================================= */}
      <Card className="bg-black/20 border-white/5 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Optimization History
          </h4>
          {chartData.length > 0 && (
            <div className="flex items-center gap-3 text-[9px] text-muted-foreground/50">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-0.5 rounded bg-[#3b82f680]" />
                Per-trial
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-0.5 rounded bg-emerald-500" />
                Best so far
              </span>
            </div>
          )}
        </div>
        <div className="px-4 pb-3" style={{ minHeight: 220 }}>
          {chartData.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground min-h-[200px]">
              <div className="text-center">
                <Activity className="h-5 w-5 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Waiting for trial results…</p>
                <p className="text-[10px] opacity-60 mt-1">
                  Data will appear as trials complete.
                </p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="trial"
                  tick={{ fontSize: 10, fill: "#888" }}
                  tickLine={false}
                  label={{ value: "Trial", position: "insideBottomRight", offset: -4, fontSize: 9, fill: "#666" }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#888" }}
                  tickLine={false}
                  width={65}
                  tickFormatter={(v: number) => formatScore(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1a1a1a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: 11,
                    borderRadius: 6,
                  }}
                  formatter={(value: number, name: string) => [
                    formatScore(value),
                    name === "bestSoFar" ? "Best so far" : "Score",
                  ]}
                  labelFormatter={(label) => `Trial ${label}`}
                />
                {/* Per-trial score */}
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#3b82f680"
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    if (payload?.pruned) {
                      return (
                        <g key={`pruned-${payload.trial}`}>
                          <line x1={cx - 3} y1={cy - 3} x2={cx + 3} y2={cy + 3} stroke="#ef4444" strokeWidth={1.5} />
                          <line x1={cx + 3} y1={cy - 3} x2={cx - 3} y2={cy + 3} stroke="#ef4444" strokeWidth={1.5} />
                        </g>
                      );
                    }
                    return (
                      <circle
                        key={`dot-${payload?.trial}`}
                        cx={cx}
                        cy={cy}
                        r={2.5}
                        fill="#3b82f6"
                        stroke="none"
                      />
                    );
                  }}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
                {/* Best-so-far stepped line */}
                <Line
                  type="stepAfter"
                  dataKey="bestSoFar"
                  stroke="#10b981"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* ================================================================= */}
      {/* Section 3 — Trial Results Table                                   */}
      {/* ================================================================= */}
      <Card className="bg-black/20 border-white/5 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Trial Results
          </h4>
          <span className="text-[9px] text-muted-foreground/40 font-mono">
            {trials.length} trial{trials.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="px-4 pb-3">
          {trials.length === 0 ? (
            <div className="w-full flex items-center justify-center text-muted-foreground min-h-[100px]">
              <p className="text-xs">No trials yet.</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead
                      className="text-[10px] cursor-pointer select-none w-16"
                      onClick={() => toggleSort("trialId")}
                    >
                      <span className="flex items-center gap-1">
                        Trial
                        {sortField === "trialId" && (
                          <ChevronDown
                            className={cn("h-3 w-3 transition-transform", sortDir === "asc" && "rotate-180")}
                          />
                        )}
                      </span>
                    </TableHead>
                    <TableHead
                      className="text-[10px] cursor-pointer select-none w-28"
                      onClick={() => toggleSort("score")}
                    >
                      <span className="flex items-center gap-1">
                        Score
                        {sortField === "score" && (
                          <ChevronDown
                            className={cn("h-3 w-3 transition-transform", sortDir === "asc" && "rotate-180")}
                          />
                        )}
                      </span>
                    </TableHead>
                    <TableHead className="text-[10px] w-20">Status</TableHead>
                    <TableHead
                      className="text-[10px] cursor-pointer select-none w-20"
                      onClick={() => toggleSort("durationSec")}
                    >
                      <span className="flex items-center gap-1">
                        Duration
                        {sortField === "durationSec" && (
                          <ChevronDown
                            className={cn("h-3 w-3 transition-transform", sortDir === "asc" && "rotate-180")}
                          />
                        )}
                      </span>
                    </TableHead>
                    <TableHead className="text-[10px]">Key Params</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedTrials.map((trial) => {
                    const isBest = bestTrial?.trialId === trial.trialId;
                    const trialStatus = trial.error
                      ? "failed"
                      : trial.pruned
                        ? "pruned"
                        : "completed";

                    return (
                      <TableRow
                        key={trial.trialId}
                        className={cn(
                          "border-white/5",
                          isBest && "bg-amber-500/5 border-l-2 border-l-amber-500/40",
                        )}
                      >
                        <TableCell className="text-xs font-mono">
                          <span className="flex items-center gap-1.5">
                            {isBest && <Trophy className="h-3 w-3 text-amber-400" />}
                            #{trial.trialId}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          <span className={cn(isBest && "text-emerald-400 font-semibold")}>
                            {formatScore(trial.score)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn("text-[9px]", STATUS_STYLES[trialStatus])}
                          >
                            {trialStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {formatDuration(trial.durationSec)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            {topParamKeys.map((key) => {
                              const val = trial.params[key];
                              if (val == null) return null;
                              const display =
                                typeof val === "number"
                                  ? Number.isInteger(val)
                                    ? String(val)
                                    : val.toPrecision(3)
                                  : String(val);
                              return (
                                <Badge
                                  key={key}
                                  variant="outline"
                                  className="text-[8px] bg-zinc-500/10 text-zinc-400 border-zinc-500/20 font-mono"
                                >
                                  {key}={display}
                                </Badge>
                              );
                            })}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </div>
      </Card>

      {/* ================================================================= */}
      {/* Section 4 — Parameter Distribution Scatter                        */}
      {/* ================================================================= */}
      <Card className="bg-black/20 border-white/5 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Parameter vs Score
          </h4>
          {paramNames.length > 0 && (
            <Select value={selectedParam} onValueChange={setSelectedParam}>
              <SelectTrigger className="h-6 w-[160px] text-[10px] bg-black/30 border-white/10">
                <SelectValue placeholder="Select param" />
              </SelectTrigger>
              <SelectContent>
                {paramNames.map((p) => (
                  <SelectItem key={p} value={p} className="text-[10px]">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="px-4 pb-3" style={{ minHeight: 200 }}>
          {scatterData.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground min-h-[180px]">
              <div className="text-center">
                <TrendingUp className="h-5 w-5 mx-auto mb-2 opacity-30" />
                <p className="text-xs">
                  {trials.length === 0
                    ? "Awaiting trial data…"
                    : "No numeric data for this parameter."}
                </p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="value"
                  type="number"
                  tick={{ fontSize: 10, fill: "#888" }}
                  tickLine={false}
                  name={selectedParam}
                  label={{
                    value: selectedParam,
                    position: "insideBottomRight",
                    offset: -4,
                    fontSize: 9,
                    fill: "#666",
                  }}
                />
                <YAxis
                  dataKey="score"
                  type="number"
                  tick={{ fontSize: 10, fill: "#888" }}
                  tickLine={false}
                  width={65}
                  tickFormatter={(v: number) => formatScore(v)}
                  name="Score"
                />
                <ZAxis range={[20, 20]} />
                <Tooltip
                  contentStyle={{
                    background: "#1a1a1a",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: 11,
                    borderRadius: 6,
                  }}
                  formatter={(value: number, name: string) => [
                    name === "Score" ? formatScore(value) : value,
                    name,
                  ]}
                  labelFormatter={() => ""}
                />
                <Scatter
                  data={scatterData}
                  fill="#3b82f6"
                  fillOpacity={0.7}
                  strokeWidth={0}
                />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}

export default HPODashboard;
