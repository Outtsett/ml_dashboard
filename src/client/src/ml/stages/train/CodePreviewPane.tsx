/**
 * CodePreviewPane — outer shell + lazy-load wrapper for the Monaco editor used
 * in Stage 4 (Train) to preview generated Python.
 *
 * The Monaco bundle (~2 MB / ~600 KB gzip) is split into a `vendor-monaco`
 * chunk via `vite.config.ts manualChunks` and lazy-loaded only when the inner
 * component mounts. The outer shell is cheap — it renders an empty state when
 * no preview is present and never imports Monaco itself.
 *
 * Owned by W2.e (frontend-lead / fe-viz). Future phases:
 *   - W4 wires `preview` to `state.generatedPreview` from MLStudioContext
 *   - W8 reuses the same Monaco bundle for `<GeneratedCodeDiffViewer>`
 *
 * The `GeneratedPreview` type lives in `MLStudioContext` once W4 lands; we
 * declare a local stub here so W2 can ship before W4 extends the context.
 */

import { lazy, Suspense } from "react";
import { PageLoader } from "@/shared/layout/LoadingSkeletons";

// ─── Local type stub (replace with import from MLStudioContext after W4) ─────

export type GeneratedFileLanguage = "python" | "json";

export interface GeneratedFile {
  path: string;
  content: string;
  language: GeneratedFileLanguage;
}

export interface GeneratedPreview {
  files: GeneratedFile[];
  templateId: string;
  templateVersion: string;
  hash: string;
  warnings: string[];
  generatedAt: string;
  dirty: boolean;
}

// ─── Component API ───────────────────────────────────────────────────────────

export interface CodePreviewPaneProps {
  preview: GeneratedPreview | null;
  /** Per-file edit handler. Inner pane debounces 250ms before invoking. */
  onChange?: (path: string, content: string) => void;
  /** Save the current preview (Save & train flow). */
  onSave?: () => void;
  /** Save without launching training. */
  onSaveOnly?: () => void;
  /** Re-render the preview from scratch. Shown behind a confirm dialog when
   *  dirty edits would be lost. */
  onRegenerate?: () => void;
  /** True when the user has edited the preview after generation. */
  dirty?: boolean;
}

// ─── Lazy-loaded heavy editor ────────────────────────────────────────────────

const CodePreviewPaneInner = lazy(() => import("./CodePreviewPaneInner"));

export function CodePreviewPane(props: CodePreviewPaneProps) {
  if (!props.preview) {
    return <EmptyState />;
  }
  return (
    <Suspense fallback={<PageLoader />}>
      <CodePreviewPaneInner {...props} preview={props.preview} />
    </Suspense>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center text-sm text-muted-foreground">
      Pick a model from the catalog above and click{" "}
      <span className="text-foreground">Generate code</span> to preview the
      Python that will train it.
    </div>
  );
}
