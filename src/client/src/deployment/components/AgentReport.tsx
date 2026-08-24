/**
 * AgentReport — W8.e
 *
 * Single global side-panel rendered at the MLStudioRoute boundary so the Sheet
 * overlays any stage. Lives on `side="left"` to coexist with the Promote
 * stage's `side="right"` lineage drawer (W7 risk row mitigation).
 *
 * Per `docs/plans/2026-05-09-ml-studio-workshop-integration-frontend.md` §8.2:
 *
 *   1. Severity-tinted summary banner (info / warning / error)
 *   2. Findings table (sortable Tanstack-Table) — severity badge, category,
 *      message, evidence
 *   3. Collapsible markdown body (react-markdown + remark-gfm,
 *      `vendor-markdown` chunk)
 *   4. Proposed-action buttons — clicking dispatches the matching reducer
 *      action against `MLStudioContext` (set-feature-pipeline →
 *      `setFeaturePipeline`, set-hyperparameter → `setHyperparameters`,
 *      add-experiment → `addExperiment`, set-search-space →
 *      `setObjectiveConfig`, apply-template-edit → routed through the diff
 *      viewer below).
 *   5. If `report.diff` is present (arch-designer only), renders the
 *      `<GeneratedCodeDiffViewer>` (W8.f) for accept-all / per-file accept.
 *
 * The Sheet open/close lifecycle is owned by `state.agentPanel` in the
 * MLStudioContext (W4.c). Closing the sheet does NOT cancel an in-flight run —
 * the user can re-open the panel and the latest report is still there.
 */

import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";

import { cn } from "@/shared/utils/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { useMLStudio } from "@/ml/MLStudioContext";
import { useAgentDispatch } from "@/deployment/lib/useAgentDispatch";
import type {
  AgentFinding,
  AgentProposedAction,
  AgentSeverity,
} from "@/deployment/lib/useAgentDispatch";

// ─── Lazy modules — kept off the main bundle ──────────────────────────────────
//
// react-markdown + remark-gfm live in the `vendor-markdown` chunk (vite config).
// We dynamic-import the wrapper component so the chunk is only fetched when an
// agent report is actually rendered — first-paint of /ml-studio stays light.

const MarkdownBody = lazy(() => import("./AgentReportMarkdownBody"));

// GeneratedCodeDiffViewer (W8.f) reuses the `vendor-monaco` chunk. Lazy-load so
// the Monaco bundle is only requested when an arch-designer report actually
// ships a `diff` envelope.

const GeneratedCodeDiffViewer = lazy(() =>
  import("./GeneratedCodeDiffViewer").then((m) => ({
    default: m.GeneratedCodeDiffViewer,
  })),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_LABEL: Record<AgentSeverity, string> = {
  info: "info",
  warning: "warn",
  error: "error",
};

function severityTone(s: AgentSeverity): string {
  switch (s) {
    case "info":
      return "border-sky-500/30 bg-sky-500/10 text-sky-200";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
    case "error":
      return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  }
}

function bannerTone(s: AgentSeverity): string {
  switch (s) {
    case "info":
      return "border-sky-500/40 bg-sky-500/[0.08] text-sky-100";
    case "warning":
      return "border-amber-500/40 bg-amber-500/[0.08] text-amber-100";
    case "error":
      return "border-rose-500/40 bg-rose-500/[0.08] text-rose-100";
  }
}

function bannerIcon(s: AgentSeverity) {
  switch (s) {
    case "info":
      return <Info className="h-4 w-4" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4" />;
    case "error":
      return <XCircle className="h-4 w-4" />;
  }
}

/**
 * Worst-severity rollup for the summary banner. Defaults to `info` when the
 * agent reports zero findings (a clean run is informational, not a warning).
 */
function rollupSeverity(findings: AgentFinding[]): AgentSeverity {
  let worst: AgentSeverity = "info";
  for (const f of findings) {
    if (f.severity === "error") return "error";
    if (f.severity === "warning") worst = "warning";
  }
  return worst;
}

// ─── Findings table ───────────────────────────────────────────────────────────

function FindingsTable({ findings }: { findings: AgentFinding[] }) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "severity", desc: true },
  ]);

  const columns = useMemo<ColumnDef<AgentFinding>[]>(
    () => [
      {
        id: "severity",
        accessorFn: (f) => f.severity,
        header: "Sev",
        // error > warning > info
        sortingFn: (a, b) => {
          const order: Record<AgentSeverity, number> = { info: 0, warning: 1, error: 2 };
          return order[a.original.severity] - order[b.original.severity];
        },
        cell: ({ row }) => {
          const s = row.original.severity;
          return (
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 text-[10px] uppercase tracking-wider",
                severityTone(s),
              )}
            >
              {SEVERITY_LABEL[s]}
            </Badge>
          );
        },
      },
      {
        id: "category",
        accessorFn: (f) => f.category,
        header: "Category",
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {row.original.category}
          </span>
        ),
      },
      {
        id: "message",
        accessorFn: (f) => f.message,
        header: "Message",
        cell: ({ row }) => (
          <span className="text-xs text-foreground/90">{row.original.message}</span>
        ),
      },
      {
        id: "evidence",
        accessorFn: (f) => f.evidence.value,
        header: "Evidence",
        cell: ({ row }) => {
          const e = row.original.evidence;
          const value = Number.isFinite(e.value) ? e.value : Number.NaN;
          const valueStr = Number.isFinite(value) ? value.toFixed(4) : "—";
          const thr =
            typeof e.threshold === "number" && Number.isFinite(e.threshold)
              ? `≷${e.threshold.toFixed(2)}`
              : null;
          return (
            <div className="flex flex-col items-start gap-0.5">
              <span className="font-mono text-[11px] text-foreground/80">
                {e.metric}={valueStr}
                {thr ? <span className="text-muted-foreground/70"> {thr}</span> : null}
              </span>
              {e.reference ? (
                <span className="text-[10px] text-muted-foreground/70">
                  {e.reference}
                </span>
              ) : null}
            </div>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: findings,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-center text-[11px] text-muted-foreground">
        No findings flagged by the agent.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/5 overflow-hidden">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="border-b border-white/5 bg-white/[0.03]">
              {hg.headers.map((h) => (
                <TableHead
                  key={h.id}
                  className="h-7 px-2 text-[10px] uppercase tracking-widest text-muted-foreground cursor-pointer select-none"
                  onClick={h.column.getToggleSortingHandler()}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {h.column.getIsSorted() === "asc" && " ▲"}
                  {h.column.getIsSorted() === "desc" && " ▼"}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((r) => (
            <TableRow key={r.id} className="border-b border-white/5 last:border-b-0">
              {r.getVisibleCells().map((c) => (
                <TableCell key={c.id} className="px-2 py-1.5 align-top">
                  {flexRender(c.column.columnDef.cell, c.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Action button — dispatches into MLStudioContext ─────────────────────────

interface UseProposedActionHandlerArgs {
  /** Triggered when the action successfully dispatches into the reducer. */
  onApplied?: (action: AgentProposedAction) => void;
}

function useProposedActionHandler({ onApplied }: UseProposedActionHandlerArgs) {
  const { dispatch } = useMLStudio();

  return useCallback(
    (action: AgentProposedAction) => {
      const payload = action.payload ?? {};
      switch (action.kind) {
        case "set-feature-pipeline": {
          const pipelineId =
            typeof payload.pipelineId === "string" ? payload.pipelineId : null;
          const categories = Array.isArray(payload.categories)
            ? (payload.categories as string[])
            : undefined;
          dispatch({
            type: "setFeaturePipeline",
            pipelineId,
            categories,
          });
          break;
        }
        case "set-hyperparameter": {
          const hp =
            payload.hyperparameters && typeof payload.hyperparameters === "object"
              ? (payload.hyperparameters as Record<string, number | string | boolean>)
              : null;
          if (hp) dispatch({ type: "setHyperparameters", hyperparameters: hp });
          break;
        }
        case "add-experiment": {
          // The wire `record` matches `ExperimentRecord` exactly. We don't
          // re-validate here — Optuna-side schema is stable in W4.
          if (payload.record && typeof payload.record === "object") {
            // Cast through unknown to satisfy strict typing without leaking
            // server-side optionality back to the reducer.
            dispatch({
              type: "addExperiment",
              record: payload.record as Parameters<
                typeof dispatch
              >[0] extends { type: "addExperiment"; record: infer R }
                ? R
                : never,
            });
          }
          break;
        }
        case "set-search-space": {
          if (payload.objectiveConfig && typeof payload.objectiveConfig === "object") {
            dispatch({
              type: "setObjectiveConfig",
              config: payload.objectiveConfig as Parameters<
                typeof dispatch
              >[0] extends { type: "setObjectiveConfig"; config: infer C }
                ? C
                : never,
            });
          }
          break;
        }
        case "apply-template-edit": {
          // Per-file template edits flow through the diff viewer below — this
          // button just acknowledges the action so the caller can scroll the
          // diff viewer into view. The reducer mutation happens when the user
          // clicks Apply All / Apply File inside the diff editor.
          break;
        }
      }
      onApplied?.(action);
    },
    [dispatch, onApplied],
  );
}

// ─── Sheet body ───────────────────────────────────────────────────────────────

function PanelBody() {
  const { state, dispatch } = useMLStudio();
  const agent = useAgentDispatch();
  const [bodyOpen, setBodyOpen] = useState(false);
  const [appliedActions, setAppliedActions] = useState<Set<number>>(() => new Set());

  const handleAction = useProposedActionHandler({});

  const onApply = useCallback(
    (idx: number, action: AgentProposedAction) => {
      handleAction(action);
      setAppliedActions((cur) => {
        const next = new Set(cur);
        next.add(idx);
        return next;
      });
    },
    [handleAction],
  );

  const report = agent.report;
  const dispatching = agent.status === "queued" || agent.status === "running";
  const failed = agent.status === "failed";

  // Severity rollup is reactive to the final report. While streaming we render
  // a neutral header.
  const sev: AgentSeverity = report ? rollupSeverity(report.findings) : "info";

  // Diff-viewer integration: arch-designer reports include a `.diff` envelope
  // with proposed file replacements that lazy-mount the Monaco diff editor.
  const diff = report?.diff ?? null;
  const baseFiles = state.generatedPreview?.files ?? [];

  const onApplyAllDiff = useCallback(() => {
    if (!diff) return;
    // Wholesale replace the preview with the agent's proposed files. Mark
    // dirty=true so the GeneratedFileSaver lights up its Save button.
    if (state.generatedPreview) {
      dispatch({
        type: "setGeneratedPreview",
        preview: {
          ...state.generatedPreview,
          files: diff.files,
          dirty: true,
          generatedAt: new Date().toISOString(),
        },
      });
    }
  }, [diff, state.generatedPreview, dispatch]);

  const onApplyFileDiff = useCallback(
    (path: string) => {
      if (!diff || !state.generatedPreview) return;
      const proposed = diff.files.find((f) => f.path === path);
      if (!proposed) return;
      dispatch({ type: "patchGeneratedFile", path, content: proposed.content });
    },
    [diff, state.generatedPreview, dispatch],
  );

  // ─── Loading ───────────────────────────────────────────────────────────────
  if (dispatching && !report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <div className="text-sm font-medium text-foreground">
          Dispatching agent…
        </div>
        <code className="text-[10px] font-mono text-muted-foreground/70">
          {agent.agentId ?? state.agentPanel.agentId} · run
          {agent.runId ? `=${agent.runId.slice(0, 8)}` : "=…"}
        </code>
        {/* Transparency: surface the streamed body as it builds even before
            agent.completed lands. */}
        {agent.streamingBody.length > 0 ? (
          <div className="mt-2 max-h-40 w-full overflow-y-auto rounded-md border border-white/10 bg-white/[0.02] p-2 text-left text-[11px] text-muted-foreground whitespace-pre-wrap">
            {agent.streamingBody}
          </div>
        ) : null}
      </div>
    );
  }

  // ─── Failure ───────────────────────────────────────────────────────────────
  if (failed && !report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-6">
        <XCircle className="h-6 w-6 text-rose-300" />
        <div className="text-sm font-medium text-foreground">
          Agent run failed
        </div>
        <p className="text-[11px] text-muted-foreground max-w-xs">
          {agent.error ?? "Unknown error from /api/agents/dispatch."}
        </p>
      </div>
    );
  }

  // ─── No report yet (panel opened without a fresh dispatch) ────────────────
  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-6">
        <Bot className="h-6 w-6 text-muted-foreground" />
        <div className="text-sm font-medium text-foreground">
          {state.agentPanel.agentId ?? "Agent"} ready
        </div>
        <p className="text-[11px] text-muted-foreground max-w-xs">
          Trigger the agent from a stage to populate this panel.
        </p>
      </div>
    );
  }

  // ─── Rendered report ───────────────────────────────────────────────────────
  // Use the streamed body when the server's canonical body is empty.
  const bodyMarkdown =
    report.body && report.body.length > 0 ? report.body : agent.streamingBody;

  return (
    <ScrollArea className="-mx-6 h-full px-6 pr-3">
      <div className="space-y-4 pb-8">
        {/* Severity-tinted summary banner */}
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2",
            bannerTone(sev),
          )}
          data-testid="agent-summary-banner"
        >
          {bannerIcon(sev)}
          <div className="flex-1 text-xs leading-relaxed">{report.summary}</div>
        </div>

        {/* Findings table */}
        <section className="space-y-1.5">
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Findings ({report.findings.length})
          </h3>
          <FindingsTable findings={report.findings} />
        </section>

        {/* Markdown body — collapsible */}
        {bodyMarkdown && bodyMarkdown.length > 0 ? (
          <section className="space-y-1.5">
            <button
              type="button"
              className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
              onClick={() => setBodyOpen((o) => !o)}
              data-testid="agent-body-toggle"
            >
              {bodyOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Detailed analysis
            </button>
            {bodyOpen ? (
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs leading-relaxed">
                <Suspense
                  fallback={
                    <div className="flex h-12 items-center justify-center">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <MarkdownBody content={bodyMarkdown} />
                </Suspense>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Proposed actions */}
        {report.proposedActions.length > 0 ? (
          <section className="space-y-1.5">
            <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Proposed actions ({report.proposedActions.length})
            </h3>
            <div className="space-y-1.5">
              {report.proposedActions.map((action, idx) => {
                const applied = appliedActions.has(idx);
                return (
                  <div
                    key={`${action.kind}-${idx}`}
                    className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-foreground/90">{action.label}</div>
                      <code className="text-[10px] font-mono text-muted-foreground/70">
                        {action.kind}
                      </code>
                    </div>
                    <Button
                      size="sm"
                      variant={applied ? "ghost" : "outline"}
                      className="h-7 text-[10px] shrink-0"
                      onClick={() => onApply(idx, action)}
                      disabled={applied}
                      data-testid={`agent-action-${idx}`}
                    >
                      {applied ? "Applied" : "Apply"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Diff viewer (arch-designer only) */}
        {diff && diff.files.length > 0 ? (
          <section className="space-y-1.5">
            <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Proposed code edits
            </h3>
            <p className="text-[11px] text-muted-foreground/80">{diff.rationale}</p>
            <Suspense
              fallback={
                <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-white/10 text-[11px] text-muted-foreground">
                  Loading diff viewer…
                </div>
              }
            >
              <GeneratedCodeDiffViewer
                base={baseFiles}
                proposed={diff.files}
                onApplyAll={onApplyAllDiff}
                onApplyFile={onApplyFileDiff}
              />
            </Suspense>
          </section>
        ) : null}
      </div>
    </ScrollArea>
  );
}

// ─── Public component (mounted at MLStudioRoute boundary) ────────────────────

export function AgentReport() {
  const { state, dispatch } = useMLStudio();
  const open = state.agentPanel.open;
  const agentId = state.agentPanel.agentId;
  const stage = state.agentPanel.stage;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) dispatch({ type: "closeAgentPanel" });
      }}
    >
      <SheetContent
        side="left"
        className="w-full sm:max-w-md flex flex-col gap-3"
        data-testid="agent-report-sheet"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {agentId ?? "Agent"}
          </SheetTitle>
          <SheetDescription>
            {stage ? (
              <>
                Stage: <span className="text-foreground/80">{stage}</span>. Findings
                + proposed actions surface below.
              </>
            ) : (
              "Findings + proposed actions surface below."
            )}
          </SheetDescription>
        </SheetHeader>
        {open ? <PanelBody /> : null}
      </SheetContent>
    </Sheet>
  );
}

// Re-exports so consumers can import the typed envelope alongside the panel.
export type {
  AgentDispatchHandle,
  AgentFinding,
  AgentProposedAction,
  AgentReport as AgentReportEnvelope,
} from "@/deployment/lib/useAgentDispatch";
