/**
 * GeneratedCodeDiffViewerInner — heavy Monaco DiffEditor implementation.
 *
 * Loaded only via React.lazy from `GeneratedCodeDiffViewer.tsx`. Reuses the
 * already-loaded `vendor-monaco` chunk from W2.e (CodePreviewPaneInner) — no
 * additional bundle weight is introduced when both panels are mounted in the
 * same session.
 *
 * Renders one tab per file that differs, mounts a single `<DiffEditor>` whose
 * `original` (base) / `modified` (proposed) values swap with the active tab,
 * and exposes accept-all + per-file accept + reject controls. The same
 * `ml-studio-dark` theme registered by W2.e is reused; we re-register it here
 * (idempotent via the same module-scoped flag pattern) so the diff sheet works
 * standalone without requiring `<CodePreviewPane>` to have mounted first.
 *
 * For added/removed files we still mount a DiffEditor but pass empty content
 * on the missing side — Monaco renders these as full insertions/deletions,
 * which is the desired visual.
 */

import { useCallback, useMemo, useState } from "react";
import {
  DiffEditor,
  type DiffOnMount,
  type Monaco,
} from "@monaco-editor/react";
import { Check, CheckCheck, FilePlus, FileX, Loader2, X } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { cn } from "@/shared/utils/utils";

import type {
  DiffEntry,
  DiffStatus,
  GeneratedCodeDiffViewerProps,
  GeneratedFile,
} from "./GeneratedCodeDiffViewer";

// ─── Theme registration (idempotent — shared with CodePreviewPaneInner) ──────

const ML_STUDIO_DARK = "ml-studio-dark";
let themeRegistered = false;

function configureMonaco(monaco: Monaco) {
  if (themeRegistered) return;
  themeRegistered = true;
  monaco.editor.defineTheme(ML_STUDIO_DARK, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "a78bfa", fontStyle: "bold" },
      { token: "keyword.python", foreground: "a78bfa", fontStyle: "bold" },
      { token: "string", foreground: "34d399" },
      { token: "string.python", foreground: "34d399" },
      { token: "number", foreground: "f59e0b" },
      { token: "number.python", foreground: "f59e0b" },
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "comment.python", foreground: "6b7280", fontStyle: "italic" },
      { token: "type", foreground: "60a5fa" },
      { token: "identifier", foreground: "e5e7eb" },
      { token: "string.key.json", foreground: "60a5fa" },
      { token: "string.value.json", foreground: "34d399" },
      { token: "number.json", foreground: "f59e0b" },
    ],
    colors: {
      "editor.background": "#0a0a0f",
      "editor.foreground": "#e5e7eb",
      "editor.lineHighlightBackground": "#ffffff08",
      "editor.selectionBackground": "#6366f140",
      "editor.inactiveSelectionBackground": "#6366f120",
      "editorLineNumber.foreground": "#4b5563",
      "editorLineNumber.activeForeground": "#a78bfa",
      "editorIndentGuide.background1": "#1f1f2e",
      "editorIndentGuide.activeBackground1": "#3f3f5e",
      "editorCursor.foreground": "#a78bfa",
      "editorWhitespace.foreground": "#1f1f2e",
      // Diff palette: orange inserts, blue removals.
      //
      // Green-adds-red-removes is one of the strongest conventions in software,
      // and it is broken here deliberately. The previous values were plain
      // green-600 and red-600, sitting under a comment that claimed they were
      // "the Wong CVD-safe complement" — they were not. For a deuteranope that
      // pairing renders a diff in a single hue: the most important distinction
      // the view makes, invisible.
      //
      // Monaco still marks inserts and removals with gutter glyphs and line
      // decorations, so the convention's muscle memory is not the only cue
      // being relied on.
      "diffEditor.insertedTextBackground": "#E69F0026",
      "diffEditor.removedTextBackground": "#0072B226",
      "diffEditor.insertedLineBackground": "#E69F0014",
      "diffEditor.removedLineBackground": "#0072B214",
      "diffEditorGutter.insertedLineBackground": "#E69F0040",
      "diffEditorGutter.removedLineBackground": "#0072B240",
      "diffEditorOverview.insertedForeground": "#E69F00",
      "diffEditorOverview.removedForeground": "#0072B2",
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FILE_ORDER = ["main.py", "labels.py", "eval.py", "manifest.json"] as const;

function orderEntries(entries: DiffEntry[]): DiffEntry[] {
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const ordered: DiffEntry[] = [];
  for (const name of FILE_ORDER) {
    const found = entries.find((e) => e.path.endsWith(name));
    if (found) {
      ordered.push(found);
      byPath.delete(found.path);
    }
  }
  for (const e of entries) {
    if (byPath.has(e.path)) ordered.push(e);
  }
  return ordered;
}

function shortLabel(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function languageOf(file: GeneratedFile | null): "python" | "json" {
  if (!file) return "python";
  if (file.language === "json") return "json";
  return "python";
}

function statusBadgeClasses(status: DiffStatus): string {
  switch (status) {
    case "added":
      return "border-[color-mix(in_srgb,hsl(var(--data-pos)/0.4)_88%,black)] bg-[color-mix(in_srgb,hsl(var(--data-pos)/0.1)_88%,black)] text-[color-mix(in_srgb,hsl(var(--data-pos))_80%,white)]";
    case "removed":
      return "border-[color-mix(in_srgb,hsl(var(--data-neg)/0.4)_88%,black)] bg-[color-mix(in_srgb,hsl(var(--data-neg)/0.1)_88%,black)] text-[color-mix(in_srgb,hsl(var(--data-neg))_80%,white)]";
    case "modified":
    default:
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  }
}

function statusLabel(status: DiffStatus): string {
  switch (status) {
    case "added":
      return "Added";
    case "removed":
      return "Removed";
    case "modified":
    default:
      return "Modified";
  }
}

// ─── Inner component ─────────────────────────────────────────────────────────

interface InnerProps extends GeneratedCodeDiffViewerProps {
  entries: DiffEntry[];
}

export default function GeneratedCodeDiffViewerInner({
  entries: rawEntries,
  onApplyAll,
  onApplyFile,
  onReject,
}: InnerProps) {
  const entries = useMemo(() => orderEntries(rawEntries), [rawEntries]);
  const [activePath, setActivePath] = useState<string>(entries[0]?.path ?? "");
  const [appliedPaths, setAppliedPaths] = useState<Set<string>>(() => new Set());

  const onMount: DiffOnMount = useCallback((_editor, monaco) => {
    configureMonaco(monaco);
  }, []);

  const activeEntry = entries.find((e) => e.path === activePath) ?? entries[0];

  const handleApplyFile = useCallback(
    (path: string) => {
      onApplyFile(path);
      setAppliedPaths((prev) => {
        if (prev.has(path)) return prev;
        const copy = new Set(prev);
        copy.add(path);
        return copy;
      });
    },
    [onApplyFile],
  );

  const handleApplyAll = useCallback(() => {
    onApplyAll();
    setAppliedPaths(new Set(entries.map((e) => e.path)));
  }, [onApplyAll, entries]);

  const totalChanges = entries.length;
  const appliedCount = appliedPaths.size;
  const allApplied = appliedCount > 0 && appliedCount >= totalChanges;

  return (
    <div
      className="flex flex-col rounded-2xl border border-white/5 bg-[#0a0a0f] overflow-hidden"
      data-testid="generated-code-diff-viewer"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="text-foreground font-medium">Proposed edits</span>
          <span className="text-white/20">·</span>
          <span>
            {totalChanges} file{totalChanges === 1 ? "" : "s"} changed
          </span>
          {appliedCount > 0 ? (
            <>
              <span className="text-white/20">·</span>
              <span className="flex items-center gap-1 text-[color-mix(in_srgb,hsl(var(--data-pos))_80%,white)]">
                <Check className="h-3 w-3" />
                {appliedCount} applied
              </span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {onReject ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onReject}
              data-testid="diff-reject"
            >
              <X className="h-3.5 w-3.5" />
              Reject
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={handleApplyAll}
            disabled={allApplied}
            data-testid="diff-apply-all"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            {allApplied ? "All applied" : "Accept all"}
          </Button>
        </div>
      </div>

      {/* File tab strip */}
      <Tabs
        value={activePath}
        onValueChange={setActivePath}
        className="flex-1 flex flex-col"
      >
        <TabsList className="rounded-none bg-white/[0.02] border-b border-white/5 h-10 px-2 justify-start gap-0 overflow-x-auto">
          {entries.map((entry) => {
            const applied = appliedPaths.has(entry.path);
            return (
              <TabsTrigger
                key={entry.path}
                value={entry.path}
                className={cn(
                  "h-8 px-3 text-xs font-mono rounded-md gap-2",
                  "data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground",
                  "text-muted-foreground",
                )}
                data-testid={`diff-tab-${shortLabel(entry.path)}`}
              >
                <span className="flex items-center gap-1.5">
                  {entry.status === "added" ? (
                    <FilePlus className="h-3 w-3 text-[hsl(var(--data-pos))]" />
                  ) : entry.status === "removed" ? (
                    <FileX className="h-3 w-3 text-[hsl(var(--data-neg))]" />
                  ) : null}
                  {shortLabel(entry.path)}
                  {applied ? (
                    <Check className="h-3 w-3 text-[hsl(var(--data-pos))]" />
                  ) : null}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Per-file action row */}
        {activeEntry ? (
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/5 bg-white/[0.01]">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono text-foreground">{activeEntry.path}</span>
              <Badge
                variant="outline"
                className={cn(
                  "h-5 px-1.5 text-[10px] uppercase tracking-wide",
                  statusBadgeClasses(activeEntry.status),
                )}
              >
                {statusLabel(activeEntry.status)}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleApplyFile(activeEntry.path)}
              disabled={appliedPaths.has(activeEntry.path)}
              data-testid="diff-apply-file"
            >
              <Check className="h-3.5 w-3.5" />
              {appliedPaths.has(activeEntry.path)
                ? "Applied"
                : "Apply this file"}
            </Button>
          </div>
        ) : null}

        {/* Diff editor (single instance, original/modified swap with tab) */}
        <div className="flex-1 min-h-[420px]">
          {activeEntry ? (
            <DiffEditor
              key={activeEntry.path}
              originalModelPath={`base://${activeEntry.path}`}
              modifiedModelPath={`proposed://${activeEntry.path}`}
              original={activeEntry.base?.content ?? ""}
              modified={activeEntry.proposed?.content ?? ""}
              language={languageOf(activeEntry.proposed ?? activeEntry.base)}
              theme={ML_STUDIO_DARK}
              onMount={onMount}
              loading={
                <div className="flex h-full items-center justify-center text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading diff editor</span>
                </div>
              }
              options={{
                renderSideBySide: true,
                readOnly: true,
                originalEditable: false,
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily:
                  "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
                fontLigatures: true,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbersMinChars: 3,
                renderLineHighlight: "all",
                smoothScrolling: true,
                cursorBlinking: "smooth",
                padding: { top: 12, bottom: 12 },
                scrollbar: {
                  verticalScrollbarSize: 10,
                  horizontalScrollbarSize: 10,
                },
                wordWrap: "off",
                bracketPairColorization: { enabled: true },
                ignoreTrimWhitespace: false,
                renderOverviewRuler: true,
                diffWordWrap: "off",
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No diff selected.
            </div>
          )}
        </div>
      </Tabs>
    </div>
  );
}
