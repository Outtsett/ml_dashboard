/**
 * BacktestRunner — Per-experiment backtest dispatcher for EvaluateStage.
 *
 * For each experiment in `state.evalSelection` that lacks a
 * `runIdByExperiment[id]` entry, spawns an independent TanStack mutation
 * targeting `backtestApi.run`. Mutations run in parallel; per-experiment
 * status pills render a live progress strip.
 *
 * On success, dispatches `setBacktestRunId` so downstream tabs can read the
 * run_id from MLStudioContext.
 *
 * "Run all" gates behind an `<AlertDialog>` confirmation when more than 3
 * experiments are queued (frontend plan §10 risk row — N parallel mutations
 * could otherwise hammer the orchestrator).
 */

import { useCallback, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Play,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { backtestApi, type BacktestRunBody, type BacktestRunResponse } from "@/infrastructure/api/api_service";
import {
  useMLStudio,
  type ExperimentRecord,
  type MLStudioPipeline,
} from "@/ml/MLStudioContext";

const RUN_ALL_CONFIRM_THRESHOLD = 3;

type RunStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; runId: number }
  | { kind: "error"; message: string };

interface ExperimentRowProps {
  experiment: ExperimentRecord;
  status: RunStatus;
  onRun: () => void;
  onClear: () => void;
}

function ExperimentRow({ experiment, status, onRun, onClear }: ExperimentRowProps) {
  const baseClass =
    "flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-xs";

  let badge: React.ReactNode;
  let action: React.ReactNode;
  switch (status.kind) {
    case "idle":
      badge = (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
          Pending
        </Badge>
      );
      action = (
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onRun}>
          <Play className="mr-1 h-3 w-3" /> Run
        </Button>
      );
      break;
    case "running":
      badge = (
        <Badge className="h-5 gap-1 px-1.5 text-[10px]">
          <Loader2 className="h-3 w-3 animate-spin" /> Running
        </Badge>
      );
      action = null;
      break;
    case "done":
      badge = (
        <Badge className="h-5 gap-1 bg-emerald-500/15 px-1.5 text-[10px] text-emerald-300">
          <CheckCircle2 className="h-3 w-3" /> run #{status.runId}
        </Badge>
      );
      action = (
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClear}>
          <RotateCcw className="mr-1 h-3 w-3" /> Re-run
        </Button>
      );
      break;
    case "error":
      badge = (
        <Badge className="h-5 gap-1 bg-rose-500/15 px-1.5 text-[10px] text-rose-300">
          <AlertCircle className="h-3 w-3" /> Error
        </Badge>
      );
      action = (
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onRun}>
          <RotateCcw className="mr-1 h-3 w-3" /> Retry
        </Button>
      );
      break;
  }

  return (
    <div className={baseClass} data-testid={`runner-row-${experiment.id}`}>
      <span className="font-mono text-[11px] text-foreground/80">
        {experiment.id.slice(0, 8)}
      </span>
      <span className="truncate text-foreground/90">{experiment.catalogId}</span>
      <span className="ml-auto flex items-center gap-2">
        {badge}
        {status.kind === "error" ? (
          <span
            className="max-w-[16rem] truncate text-[10px] text-rose-300/80"
            title={status.message}
          >
            {status.message}
          </span>
        ) : null}
        {action}
      </span>
    </div>
  );
}

/** Build a backtest request body from a stored experiment. */
function buildBody(
  experiment: ExperimentRecord,
  pipeline: MLStudioPipeline,
): BacktestRunBody {
  const body: BacktestRunBody = {
    symbol: pipeline.symbol,
    timeframe: pipeline.timeframe,
    experimentId: experiment.id,
  };
  if (pipeline.dateRange?.start) body.start = pipeline.dateRange.start;
  if (pipeline.dateRange?.end) body.end = pipeline.dateRange.end;
  // Prefer registry checkpoint shim ("chk_<id>") -> pass numeric modelId.
  if (experiment.id.startsWith("chk_")) {
    const numeric = Number.parseInt(experiment.id.slice(4), 10);
    if (Number.isFinite(numeric)) {
      body.modelId = numeric;
    }
  } else if (experiment.modelId) {
    // Generated model_id strings flow as part of useLastTrained semantics for
    // ledger experiments; orchestrator resolves via experimentId.
    // No-op: experimentId already in body.
  }
  return body;
}

export function BacktestRunner() {
  const { state, dispatch } = useMLStudio();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [inFlight, setInFlight] = useState<Set<string>>(() => new Set());
  const [pendingRunAll, setPendingRunAll] = useState<ExperimentRecord[] | null>(null);

  // Resolve selected ExperimentRecords (in selection order). Selection IDs
  // pointing at unknown rows are silently dropped — the selector is the
  // source of truth and would surface them as missing chips.
  const selectedExperiments = useMemo(() => {
    const byId = new Map(state.experiments.map((e) => [e.id, e] as const));
    return state.evalSelection
      .map((id) => byId.get(id))
      .filter((e): e is ExperimentRecord => Boolean(e));
  }, [state.evalSelection, state.experiments]);

  // The mutation is created once; each `mutate()` invocation is independent.
  // Per-experiment in-flight tracking lives in local state because TanStack's
  // useMutation only tracks the most-recent call's pending status.
  const runMutation = useMutation<
    { experimentId: string; response: BacktestRunResponse },
    Error,
    ExperimentRecord
  >({
    mutationFn: async (experiment) => {
      const body = buildBody(experiment, state);
      const response = await backtestApi.run(body);
      return { experimentId: experiment.id, response };
    },
    onSuccess: ({ experimentId, response }) => {
      const runId = response.run.id;
      dispatch({ type: "setBacktestRunId", experimentId, runId });
      // Last run wins for the legacy single-run consumers.
      dispatch({ type: "setLastBacktestRunId", id: runId });
      setErrors((prev) => {
        if (!(experimentId in prev)) return prev;
        const next = { ...prev };
        delete next[experimentId];
        return next;
      });
      const trades = response.metrics.totalTrades;
      const winRate = response.metrics.winRate;
      toast.success(`Backtest #${runId} complete`, {
        description: `${trades} trades · ${winRate.toFixed(1)}% win rate`,
      });
    },
    onError: (err, experiment) => {
      const message = err.message || "Backtest failed";
      setErrors((prev) => ({ ...prev, [experiment.id]: message }));
      toast.error(`Backtest failed for ${experiment.id.slice(0, 8)}`, { description: message });
    },
    onSettled: (_data, _err, experiment) => {
      setInFlight((prev) => {
        if (!prev.has(experiment.id)) return prev;
        const next = new Set(prev);
        next.delete(experiment.id);
        return next;
      });
    },
  });

  const dispatchRun = useCallback(
    (experiments: ExperimentRecord[]) => {
      // Mark all targets in-flight in a single state update so the row
      // statuses flip simultaneously instead of frame-by-frame.
      setInFlight((prev) => {
        const next = new Set(prev);
        for (const exp of experiments) next.add(exp.id);
        return next;
      });
      for (const exp of experiments) {
        runMutation.mutate(exp);
      }
    },
    [runMutation],
  );

  const handleRunSingle = useCallback(
    (experiment: ExperimentRecord) => {
      dispatchRun([experiment]);
    },
    [dispatchRun],
  );

  // Pending = selected and (not yet completed) and (not currently mutating).
  const pendingExperiments = useMemo(() => {
    return selectedExperiments.filter(
      (exp) => state.runIdByExperiment[exp.id] == null && !inFlight.has(exp.id),
    );
  }, [selectedExperiments, state.runIdByExperiment, inFlight]);

  const handleRunAll = useCallback(() => {
    if (pendingExperiments.length === 0) return;
    if (pendingExperiments.length > RUN_ALL_CONFIRM_THRESHOLD) {
      setPendingRunAll(pendingExperiments);
      return;
    }
    dispatchRun(pendingExperiments);
  }, [dispatchRun, pendingExperiments]);

  const confirmRunAll = useCallback(() => {
    if (pendingRunAll) {
      dispatchRun(pendingRunAll);
      setPendingRunAll(null);
    }
  }, [dispatchRun, pendingRunAll]);

  if (selectedExperiments.length === 0) {
    return null;
  }

  return (
    <section className="px-6 py-4 border-b border-white/5">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground/90">Backtest dispatch</h3>
        <span className="text-xs text-muted-foreground">
          {pendingExperiments.length} pending · {Object.keys(state.runIdByExperiment).length} complete
        </span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={handleRunAll}
            disabled={pendingExperiments.length === 0}
            data-testid="run-all-backtests"
          >
            <Play className="mr-1 h-3 w-3" /> Run all ({pendingExperiments.length})
          </Button>
        </div>
      </div>
      <div className="grid gap-1.5">
        {selectedExperiments.map((exp) => {
          const status = computeRowStatus(exp.id, state.runIdByExperiment, errors, inFlight);
          return (
            <ExperimentRow
              key={exp.id}
              experiment={exp}
              status={status}
              onRun={() => handleRunSingle(exp)}
              onClear={() => handleRunSingle(exp)}
            />
          );
        })}
      </div>
      <AlertDialog
        open={pendingRunAll !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRunAll(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run {pendingRunAll?.length ?? 0} backtests in parallel?</AlertDialogTitle>
            <AlertDialogDescription>
              The orchestrator will spawn {pendingRunAll?.length ?? 0} backtest workers concurrently.
              Each one can hold a database connection for tens of seconds. Continue only if your
              orchestrator capacity is sized for it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRunAll}>Run all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ─── Helpers (top-level so they are not recreated per render) ────────────────

function computeRowStatus(
  experimentId: string,
  runIdByExperiment: Record<string, number>,
  errors: Record<string, string>,
  inFlight: ReadonlySet<string>,
): RunStatus {
  const runId = runIdByExperiment[experimentId];
  if (runId != null) return { kind: "done", runId };
  if (inFlight.has(experimentId)) return { kind: "running" };
  const err = errors[experimentId];
  if (err) return { kind: "error", message: err };
  return { kind: "idle" };
}
