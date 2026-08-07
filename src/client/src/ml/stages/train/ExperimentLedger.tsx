/**
 * ExperimentLedger — Tanstack-Table v8 of state.experiments.
 *
 * Per W4 frontend sub-plan §5: sortable columns; row click pre-fills the
 * composer with the experiment's saved config; actions are Fork / Promote /
 * Delete. The W4.d SSE bridge updates row status in-place via
 * updateExperiment patches; this component is read/dispatch only.
 *
 * Layout per §5.4:
 *   [ID] [Model] [Status] [Fold] [Sharpe] [PF] [ECE] [Max DD] [Trades]
 *   [Duration] [★] [Actions]
 *
 * Sorting: any numeric column. Default sort: most-recent-first by ID
 * (ULID-style monotonic IDs preserve creation order).
 */

import { useMemo } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";
import {
  Star,
  GitFork,
  Rocket,
  Trash2,
  CheckCircle2,
  Loader2,
  XCircle,
  Clock,
  Bot,
} from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  useMLStudio,
  type ExperimentRecord,
  type ExperimentStatus,
  type CompositionConfig,
} from "../../MLStudioContext";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const startMs = Date.parse(start);
  const endMs = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "—";
  const sec = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function shortId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`;
}

interface StatusVisual {
  icon: typeof CheckCircle2;
  label: string;
  className: string;
}

function statusVisual(status: ExperimentStatus): StatusVisual {
  switch (status) {
    case "done":
      return {
        icon: CheckCircle2,
        label: "Done",
        className: "border-[hsl(var(--data-pos)/0.4)] text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.1)]",
      };
    case "running":
      return {
        icon: Loader2,
        label: "Running",
        className: "border-primary/40 text-primary bg-primary/10",
      };
    case "queued":
      return {
        icon: Clock,
        label: "Queued",
        className: "border-amber-500/40 text-amber-400 bg-amber-500/10",
      };
    case "failed":
      return {
        icon: XCircle,
        label: "Failed",
        className: "border-[hsl(var(--data-neg)/0.4)] text-[hsl(var(--data-neg))] bg-[hsl(var(--data-neg)/0.1)]",
      };
    case "cancelled":
      return {
        icon: XCircle,
        label: "Cancelled",
        className: "border-white/20 text-muted-foreground bg-white/5",
      };
    case "proposed":
      return {
        icon: Bot,
        label: "Proposed",
        className: "border-violet-500/40 text-violet-300 bg-violet-500/10",
      };
  }
}

function StatusBadge({ status }: { status: ExperimentStatus }) {
  const v = statusVisual(status);
  const Icon = v.icon;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] px-1.5 py-0 h-5 gap-1 font-medium",
        v.className,
      )}
    >
      <Icon className={cn("h-3 w-3", status === "running" && "animate-spin")} />
      {v.label}
    </Badge>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ExperimentLedger() {
  const { state, dispatch } = useMLStudio();
  const [sorting, setSorting] = useState<SortingState>([
    // Most recent first — ULIDs sort lexicographically by creation time.
    { id: "id", desc: true },
  ]);

  const columns = useMemo<ColumnDef<ExperimentRecord>[]>(
    () => [
      {
        id: "id",
        header: "ID",
        accessorFn: (r) => r.id,
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {shortId(row.original.id)}
          </span>
        ),
      },
      {
        id: "model",
        header: "Model",
        accessorFn: (r) => r.modelId ?? r.catalogId,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5 min-w-[140px]">
            <span className="text-xs font-medium text-foreground truncate">
              {row.original.modelId ?? row.original.catalogId}
            </span>
            <span className="text-[10px] text-muted-foreground truncate">
              {row.original.catalogId}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (r) => r.status,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "fold",
        header: "Fold",
        cell: ({ row }) => {
          const folds = row.original.foldMetrics.length;
          const expected = row.original.walkForward?.folds ?? folds;
          return (
            <span className="text-xs text-muted-foreground">
              {folds}/{expected}
            </span>
          );
        },
      },
      {
        id: "sharpe",
        header: "Sharpe",
        accessorFn: (r) => r.summary?.sharpe ?? null,
        cell: ({ row }) => (
          <span className="text-xs font-mono text-foreground">
            {formatNumber(row.original.summary?.sharpe, 3)}
          </span>
        ),
        sortingFn: "basic",
      },
      {
        id: "pf",
        header: "PF",
        accessorFn: (r) => r.summary?.profitFactor ?? null,
        cell: ({ row }) => (
          <span className="text-xs font-mono text-foreground">
            {formatNumber(row.original.summary?.profitFactor, 2)}
          </span>
        ),
        sortingFn: "basic",
      },
      {
        id: "ece",
        header: "ECE",
        accessorFn: (r) => r.summary?.ece ?? null,
        cell: ({ row }) => (
          <span className="text-xs font-mono text-foreground">
            {formatNumber(row.original.summary?.ece, 3)}
          </span>
        ),
        sortingFn: "basic",
      },
      {
        id: "maxdd",
        header: "Max DD",
        accessorFn: (r) => r.summary?.maxDrawdown ?? null,
        cell: ({ row }) => (
          <span className="text-xs font-mono text-foreground">
            {formatNumber(row.original.summary?.maxDrawdown, 3)}
          </span>
        ),
        sortingFn: "basic",
      },
      {
        id: "trades",
        header: "Trades",
        accessorFn: (r) => {
          const trades = r.foldMetrics.reduce(
            (acc, f) => acc + (f.trades ?? 0),
            0,
          );
          return trades || null;
        },
        cell: ({ row }) => {
          const trades = row.original.foldMetrics.reduce(
            (acc, f) => acc + (f.trades ?? 0),
            0,
          );
          return (
            <span className="text-xs font-mono text-foreground">
              {trades > 0 ? trades : "—"}
            </span>
          );
        },
        sortingFn: "basic",
      },
      {
        id: "duration",
        header: "Duration",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatDuration(row.original.startedAt, row.original.completedAt)}
          </span>
        ),
      },
      {
        id: "star",
        header: "★",
        cell: ({ row }) => {
          const isStarred = row.original.summary?.isStarred ?? false;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dispatch({
                  type: "starExperiment",
                  id: row.original.id,
                  starred: !isStarred,
                });
              }}
              className="text-amber-300 hover:text-amber-200 transition-colors"
              aria-label={isStarred ? "Unstar experiment" : "Star experiment"}
              data-testid={`ledger-star-${row.original.id}`}
            >
              <Star
                className={cn(
                  "h-3.5 w-3.5",
                  isStarred ? "fill-amber-300" : "fill-transparent",
                )}
              />
            </button>
          );
        },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={(e) => {
                e.stopPropagation();
                forkExperiment(row.original);
              }}
              data-testid={`ledger-fork-${row.original.id}`}
            >
              <GitFork className="h-3 w-3" />
              Fork
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              disabled={row.original.status !== "done"}
              onClick={(e) => {
                e.stopPropagation();
                promoteExperiment(row.original);
              }}
              data-testid={`ledger-promote-${row.original.id}`}
            >
              <Rocket className="h-3 w-3" />
              Promote
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] text-[hsl(var(--data-neg))] hover:text-[hsl(var(--data-neg))]"
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "removeExperiment", id: row.original.id });
              }}
              data-testid={`ledger-delete-${row.original.id}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ),
      },
    ],
    // dispatch is stable; the helpers below capture it via closure on each render
    // which is fine — table re-renders cheap.
    [dispatch],
  );

  // ─── Pre-fill composer from row ───────────────────────────────────────────
  // Per §5.2: dispatch in canonical order so listeners (e.g. preview hash)
  // recompute correctly.
  function preFillFromExperiment(exp: ExperimentRecord) {
    const composition: CompositionConfig =
      // We don't currently persist the composition tree per-experiment
      // (atomic only in W4); fall back to atomic with the catalog id.
      { kind: "atomic", params: {}, subPicks: [] };
    dispatch({ type: "setComposition", config: composition });
    dispatch({ type: "setHyperparameters", hyperparameters: { ...exp.hyperparameters } });
    if (exp.walkForward) {
      dispatch({ type: "setWalkForward", walkForward: { ...exp.walkForward } });
    }
    if (exp.objectiveConfig) {
      dispatch({ type: "setObjectiveConfig", config: { ...exp.objectiveConfig } });
    }
    dispatch({
      type: "setLabelStrategy",
      strategy: exp.labelStrategy,
      params: { ...exp.labelParams },
    });
    dispatch({ type: "setModelType", modelType: exp.catalogId });
    dispatch({ type: "setSelectedExperiment", id: exp.id });
    // setComposition already cleared generatedPreview, but be explicit so
    // the subsequent dispatches don't accidentally repopulate it.
    dispatch({ type: "setGeneratedPreview", preview: null });
  }

  function forkExperiment(exp: ExperimentRecord) {
    preFillFromExperiment(exp);
  }

  function promoteExperiment(exp: ExperimentRecord) {
    dispatch({ type: "setSelectedExperiment", id: exp.id });
    // Stage 5 evaluate → Stage 6 promote. We jump straight to promote per the
    // ledger plan §5.4; the user can still detour via Stage 5.
    dispatch({ type: "setActiveStage", stage: "promote" });
  }

  const table = useReactTable({
    data: state.experiments,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (state.experiments.length === 0) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="text-sm text-muted-foreground text-center py-8">
          No experiments yet. Generate code above and click <span className="text-foreground">Save & train</span> to record one.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <header className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Experiment ledger
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {state.experiments.length}/50 local
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/5">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  return (
                    <th
                      key={h.id}
                      className={cn(
                        "px-3 py-2 font-medium text-muted-foreground/80 text-[10px] uppercase tracking-widest whitespace-nowrap",
                        sortable && "cursor-pointer hover:text-foreground",
                      )}
                      onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {{ asc: "↑", desc: "↓" }[h.column.getIsSorted() as string] ?? ""}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const isSelected = state.selectedExperimentId === row.original.id;
              return (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-white/5 last:border-0 cursor-pointer transition-colors",
                    isSelected
                      ? "bg-primary/10"
                      : "hover:bg-white/[0.04]",
                  )}
                  onClick={() => preFillFromExperiment(row.original)}
                  data-testid={`ledger-row-${row.original.id}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
