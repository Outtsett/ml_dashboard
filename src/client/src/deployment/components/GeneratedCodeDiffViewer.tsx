/**
 * GeneratedCodeDiffViewer — outer shell + lazy-load wrapper for the Monaco
 * `DiffEditor` used in W8 (agent UI) to surface arch-designer's proposed edits
 * to the generated training code.
 *
 * Compares `base` (current `state.generatedPreview.files`) against `proposed`
 * (the agent's `diff.files` payload), shows only files that actually differ,
 * and exposes accept-all + per-file accept controls.
 *
 * The Monaco bundle (~2 MB / ~600 KB gzip) lives in the shared `vendor-monaco`
 * chunk created by W2.e — this component reuses it via React.lazy without
 * adding any new bundle weight. The outer shell never imports Monaco; it
 * renders an empty state when no diffs exist and never pays the chunk-load
 * cost in that case.
 *
 * Owned by W8.f (frontend-lead / fe-viz). Pairs with `<AgentReport>` Sheet.
 *
 * Type compatibility: `GeneratedFile` is re-exported from W2's CodePreviewPane
 * to avoid drift; once W4 lands the canonical type in MLStudioContext both
 * components will swap to that import.
 */

import { lazy, Suspense, useMemo } from "react";
import { PageLoader } from "@/shared/layout/LoadingSkeletons";

import type { GeneratedFile } from "@/ml/stages/train/CodePreviewPane";

export type { GeneratedFile };

// ─── Component API ───────────────────────────────────────────────────────────

export interface GeneratedCodeDiffViewerProps {
  /** Current generated files (state.generatedPreview.files). */
  base: GeneratedFile[];
  /** Agent's proposed replacement files (agentReport.diff.files). */
  proposed: GeneratedFile[];
  /** Accept every changed file; caller POSTs proposed.files to
   *  /api/training/save-generated. */
  onApplyAll: () => void;
  /** Accept a single file; caller replaces just that one entry inside
   *  state.generatedPreview.files. */
  onApplyFile: (path: string) => void;
  /** Reject the entire proposal; caller dismisses the diff sheet. */
  onReject?: () => void;
}

// ─── Diff classification ─────────────────────────────────────────────────────

export type DiffStatus = "modified" | "added" | "removed";

export interface DiffEntry {
  path: string;
  status: DiffStatus;
  base: GeneratedFile | null;
  proposed: GeneratedFile | null;
}

/**
 * Compute the set of files that differ between `base` and `proposed`.
 * - `modified`: exists in both, content differs
 * - `added`: in proposed only
 * - `removed`: in base only
 *
 * Files identical across both sides are omitted so the tab strip stays focused
 * on actual changes — the agent typically rewrites only 1-2 of the 4 generated
 * files, never all of them.
 */
export function computeDiffEntries(
  base: GeneratedFile[],
  proposed: GeneratedFile[],
): DiffEntry[] {
  const baseByPath = new Map(base.map((f) => [f.path, f]));
  const proposedByPath = new Map(proposed.map((f) => [f.path, f]));
  const allPaths = new Set<string>([...baseByPath.keys(), ...proposedByPath.keys()]);

  const entries: DiffEntry[] = [];
  for (const path of allPaths) {
    const b = baseByPath.get(path) ?? null;
    const p = proposedByPath.get(path) ?? null;
    if (b && p) {
      if (b.content !== p.content) {
        entries.push({ path, status: "modified", base: b, proposed: p });
      }
      // identical → skip
    } else if (p) {
      entries.push({ path, status: "added", base: null, proposed: p });
    } else if (b) {
      entries.push({ path, status: "removed", base: b, proposed: null });
    }
  }
  return entries;
}

// ─── Lazy-loaded heavy diff editor ───────────────────────────────────────────

const GeneratedCodeDiffViewerInner = lazy(
  () => import("./GeneratedCodeDiffViewerInner"),
);

export function GeneratedCodeDiffViewer(props: GeneratedCodeDiffViewerProps) {
  const entries = useMemo(
    () => computeDiffEntries(props.base, props.proposed),
    [props.base, props.proposed],
  );

  if (entries.length === 0) {
    return <EmptyDiffState onReject={props.onReject} />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <GeneratedCodeDiffViewerInner {...props} entries={entries} />
    </Suspense>
  );
}

function EmptyDiffState({ onReject }: { onReject?: () => void }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center text-sm text-muted-foreground space-y-3">
      <div>
        The agent's proposal matches the current generated code — there is
        nothing to apply.
      </div>
      {onReject ? (
        <button
          type="button"
          onClick={onReject}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
