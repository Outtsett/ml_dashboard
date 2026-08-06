import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/shared/ui/card";
import { logError } from "@/infrastructure/lib/error_logger";

// Sub-components
import { HPOMetricsCards } from "./HPOMetricsCards";
import { HPOChartsSection } from "./HPOChartsSection";
import { HPOTrialsList } from "./HPOTrialsList";

// Shared types
import type { TrialResult, HPOSession } from "@shared/hpoTypes";

// ---------------------------------------------------------------------------

interface HPODashboardProps {
  sessionId: string;
  onClose?: () => void;
  onApplyParams?: (params: Record<string, unknown>) => void;
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
    bestParams: Record<string, unknown>;
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
  }, [sessionId, status]);

  // ---- Derived data -------------------------------------------------------

  const isMaximize = useMemo(() => {
    if (!sessionData) return true;
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
      <HPOMetricsCards
        sessionData={sessionData ?? null}
        status={status}
        trialsCount={trials.length}
        prunedCount={prunedCount}
        elapsedSec={elapsedSec}
        bestScore={bestTrial?.bestScore}
        isRunning={isRunning}
        isDone={isDone}
        stopping={stopping}
        applying={applying}
        handleStop={handleStop}
        handleApplyBest={handleApplyBest}
        onClose={onClose}
      />

      <HPOChartsSection
        chartData={chartData}
        scatterData={scatterData}
        paramNames={paramNames}
        selectedParam={selectedParam}
        setSelectedParam={setSelectedParam}
        formatScore={formatScore}
        trialsCount={trials.length}
      />

      <HPOTrialsList
        trials={trials}
        sortedTrials={sortedTrials}
        bestTrialId={bestTrial?.trialId}
        sortField={sortField}
        sortDir={sortDir}
        toggleSort={toggleSort}
        formatScore={formatScore}
        formatDuration={formatDuration}
        topParamKeys={topParamKeys}
        statusStyles={STATUS_STYLES}
      />
    </div>
  );
}

export default HPODashboard;
