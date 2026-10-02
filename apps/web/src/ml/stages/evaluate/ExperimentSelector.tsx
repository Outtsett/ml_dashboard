/**
 * ExperimentSelector — Sticky chip row at top of EvaluateStage.
 *
 * Multi-select chips drawn from:
 *  - `state.experiments` filtered to `status === "done"` (completed ledger rows)
 *  - Optional ad-hoc registry checkpoints surfaced via `useModelCheckpoints()`
 *    behind a "+ pick" popover (currently expressed as a compact list — picking
 *    one synthesises a `done`-status `ExperimentRecord` shim and adds it to the
 *    selection).
 *
 * Selection writes via `setEvalSelection` (frontend plan §6.1). Baseline
 * checkboxes write via `setEvalBaselines`.
 */

import { useCallback, useMemo, useState } from "react";
import { Check, Plus, Star } from "lucide-react";
import { useMLStudio, type ExperimentRecord } from "@/ml/MLStudioContext";
import { useModelCheckpoints } from "@/ml/lib/useModelCheckpoints";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { cn } from "@/shared/utils/utils";

interface BaselineOption {
  id: string;
  label: string;
}

const BASELINE_OPTIONS: readonly BaselineOption[] = [
  { id: "buy_hold", label: "Buy & Hold" },
  { id: "naive_momentum", label: "Naive momentum" },
] as const;

function formatSharpe(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

interface ExperimentChipProps {
  experiment: ExperimentRecord;
  selected: boolean;
  onToggle: () => void;
}

function ExperimentChip({ experiment, selected, onToggle }: ExperimentChipProps) {
  const sharpe = experiment.summary?.sharpe;
  const starred = experiment.summary?.isStarred ?? false;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-all",
        "focus:outline-none focus:ring-2 focus:ring-primary/40",
        selected
          ? "border-primary bg-primary/15 text-foreground shadow-sm shadow-primary/20"
          : "border-white/10 bg-white/5 text-muted-foreground hover:border-primary/30 hover:bg-white/10 hover:text-foreground",
      )}
      aria-pressed={selected}
      data-testid={`exp-chip-${experiment.id}`}
    >
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
        )}
      >
        {selected ? <Check className="h-3 w-3" /> : null}
      </span>
      {starred ? <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> : null}
      <span className="font-mono text-[11px] text-foreground/80">{experiment.id.slice(0, 8)}</span>
      <span className="text-foreground/90">{experiment.catalogId}</span>
      <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono">
        Sh {formatSharpe(sharpe)}
      </Badge>
    </button>
  );
}

export function ExperimentSelector() {
  const { state, dispatch } = useMLStudio();
  const [open, setOpen] = useState(false);

  // Completed experiments (ledger). Sorted by completedAt DESC.
  const doneExperiments = useMemo(
    () =>
      state.experiments
        .filter((e) => e.status === "done")
        .sort((a, b) => {
          const ta = a.completedAt ? Date.parse(a.completedAt) : 0;
          const tb = b.completedAt ? Date.parse(b.completedAt) : 0;
          return tb - ta;
        }),
    [state.experiments],
  );

  // Ad-hoc registry checkpoints, scoped to the current symbol/timeframe.
  const checkpointsQuery = useModelCheckpoints({
    symbol: state.symbol,
    timeframe: state.timeframe,
  });
  const checkpoints = checkpointsQuery.data ?? [];

  // IDs the selector knows about — used to hide already-added checkpoints.
  const knownIds = useMemo(() => new Set(state.experiments.map((e) => e.id)), [state.experiments]);

  const selectedSet = useMemo(() => new Set(state.evalSelection), [state.evalSelection]);

  const toggleExperiment = useCallback(
    (id: string) => {
      const next = selectedSet.has(id)
        ? state.evalSelection.filter((x) => x !== id)
        : [...state.evalSelection, id];
      dispatch({ type: "setEvalSelection", ids: next });
    },
    [dispatch, selectedSet, state.evalSelection],
  );

  const addCheckpointAsExperiment = useCallback(
    (cpId: number) => {
      const cp = checkpoints.find((c) => c.id === cpId);
      if (!cp) return;
      const id = `chk_${cp.id}`;
      // Materialize a synthetic ExperimentRecord so downstream tabs can treat
      // it identically. Skip if we already have it.
      if (!knownIds.has(id)) {
        const record: ExperimentRecord = {
          id,
          catalogId: cp.modelType,
          modelId: cp.modelId,
          runnerKey: null,
          hyperparameters: {},
          walkForward: null,
          objectiveConfig: null,
          labelStrategy: state.labelStrategy,
          labelParams: {},
          featurePipelineId: state.featurePipelineId,
          featureCategories: state.featureCategories,
          status: "done",
          foldMetrics: [],
          summary: {
            sharpe: cp.perf.sharpeRatio,
            profitFactor: cp.perf.profitFactor,
            winRate: cp.perf.winRate,
            maxDrawdown: cp.perf.maxDrawdown,
            ece: null,
            meanTradePnl: null,
            foldDispersion: null,
            isStarred: false,
          },
          startedAt: null,
          completedAt: new Date(cp.createdAt).toISOString(),
          trainingSessionId: cp.sessionId != null ? String(cp.sessionId) : null,
          diagnosticsPath: null,
          errorMessage: null,
          source: "server",
        };
        dispatch({ type: "addExperiment", record });
      }
      if (!selectedSet.has(id)) {
        dispatch({ type: "setEvalSelection", ids: [...state.evalSelection, id] });
      }
      setOpen(false);
    },
    [
      checkpoints,
      dispatch,
      knownIds,
      selectedSet,
      state.evalSelection,
      state.featureCategories,
      state.featurePipelineId,
      state.labelStrategy,
    ],
  );

  const toggleBaseline = useCallback(
    (baselineId: string) => {
      const cur = state.evalBaselines;
      const next = cur.includes(baselineId)
        ? cur.filter((x) => x !== baselineId)
        : [...cur, baselineId];
      dispatch({ type: "setEvalBaselines", ids: next });
    },
    [dispatch, state.evalBaselines],
  );

  const clearSelection = useCallback(() => {
    dispatch({ type: "setEvalSelection", ids: [] });
  }, [dispatch]);

  return (
    <div className="sticky top-0 z-20 border-b border-white/5 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="px-6 py-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Experiments
          </span>
          <span className="text-xs text-muted-foreground">
            {state.evalSelection.length} of {doneExperiments.length} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            {state.evalSelection.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={clearSelection}
              >
                Clear
              </Button>
            ) : null}
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  <Plus className="mr-1 h-3 w-3" /> pick
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="border-b border-white/5 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Registry checkpoints ({checkpoints.length})
                </div>
                <ScrollArea className="h-64">
                  {checkpointsQuery.isLoading ? (
                    <div className="p-4 text-xs text-muted-foreground">Loading…</div>
                  ) : checkpoints.length === 0 ? (
                    <div className="p-4 text-xs text-muted-foreground">
                      No registry checkpoints for {state.symbol} / {state.timeframe}.
                    </div>
                  ) : (
                    <ul className="divide-y divide-white/5">
                      {checkpoints.map((cp) => {
                        const id = `chk_${cp.id}`;
                        const already = knownIds.has(id);
                        return (
                          <li key={cp.id}>
                            <button
                              type="button"
                              disabled={already}
                              onClick={() => addCheckpointAsExperiment(cp.id)}
                              className={cn(
                                "flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/5",
                                already && "opacity-50",
                              )}
                            >
                              <span className="font-mono text-[11px] text-foreground/80">
                                #{cp.id}
                              </span>
                              <span className="flex-1 truncate text-foreground/90">
                                {cp.modelType}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                Sh {formatSharpe(cp.perf.sharpeRatio)}
                              </span>
                              {already ? (
                                <Check className="h-3 w-3 text-primary" />
                              ) : (
                                <Plus className="h-3 w-3 text-muted-foreground" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {doneExperiments.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No completed experiments yet. Train one in Stage 4 or pick a registry checkpoint.
            </span>
          ) : (
            doneExperiments.map((exp) => (
              <ExperimentChip
                key={exp.id}
                experiment={exp}
                selected={selectedSet.has(exp.id)}
                onToggle={() => toggleExperiment(exp.id)}
              />
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Baselines
          </span>
          {BASELINE_OPTIONS.map((b) => {
            const checked = state.evalBaselines.includes(b.id);
            return (
              <label
                key={b.id}
                className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-foreground/80"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleBaseline(b.id)}
                  className="h-3.5 w-3.5"
                />
                {b.label}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
