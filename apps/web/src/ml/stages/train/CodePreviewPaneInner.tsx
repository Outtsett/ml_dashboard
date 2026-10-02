/**
 * CodePreviewPaneInner — heavy Monaco editor implementation.
 *
 * Loaded only via React.lazy from `CodePreviewPane.tsx`. Pulls in
 * `@monaco-editor/react` + `monaco-editor` (~2 MB / ~600 KB gzip), which Vite
 * splits into the `vendor-monaco` chunk so the main bundle stays light.
 *
 * Renders a tab strip across the files in the preview, mounts a single Monaco
 * `<Editor>` whose `path` switches with the active tab, debounces edit events
 * by 250ms, and exposes Save / Save without training / Regenerate controls.
 *
 * Theme: defines `ml-studio-dark` once on first mount with project tokens
 * (violet keywords, emerald strings, amber numbers, primary selection).
 *
 * Per-file dirty state is tracked locally via a Set so tab labels can show a
 * yellow dot without touching the parent's `dirty` flag.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { loader, type Monaco, type OnMount } from "@monaco-editor/react";
import { Loader2, Play, RefreshCw, Save } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
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
import { cn } from "@/shared/utils/utils";

import type {
  CodePreviewPaneProps,
  GeneratedFile,
  GeneratedPreview,
} from "./CodePreviewPane";

// ─── Theme + worker config (one-shot, runs at module import) ─────────────────

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
      // JSON-specific tokens
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
      "editorBracketMatch.background": "#6366f130",
      "editorBracketMatch.border": "#6366f1",
    },
  });
}

// Disable workers we don't need — we only highlight Python + JSON, never
// TypeScript / CSS / HTML. Skipping them saves ~400 KB of worker payloads.
loader.config({
  // Use bundled monaco-editor; no CDN.
  monaco: undefined,
});

// ─── Inner component ─────────────────────────────────────────────────────────

interface InnerProps extends Omit<CodePreviewPaneProps, "preview"> {
  preview: GeneratedPreview;
}

const FILE_ORDER = ["main.py", "labels.py", "eval.py", "manifest.json"] as const;

function orderFiles(files: GeneratedFile[]): GeneratedFile[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const ordered: GeneratedFile[] = [];
  for (const name of FILE_ORDER) {
    const found = files.find((f) => f.path.endsWith(name));
    if (found) {
      ordered.push(found);
      byPath.delete(found.path);
    }
  }
  // Append any remaining files in their original order
  for (const f of files) {
    if (byPath.has(f.path)) ordered.push(f);
  }
  return ordered;
}

function shortLabel(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function languageOf(file: GeneratedFile): "python" | "json" {
  if (file.language === "json") return "json";
  return "python";
}

export default function CodePreviewPaneInner({
  preview,
  onChange,
  onSave,
  onSaveOnly,
  onRegenerate,
  dirty: dirtyProp,
}: InnerProps) {
  const files = useMemo(() => orderFiles(preview.files), [preview.files]);
  const [activePath, setActivePath] = useState<string>(
    files[0]?.path ?? "",
  );
  const [perFileDirty, setPerFileDirty] = useState<Set<string>>(() => new Set());
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);

  // Reset local dirty tracking when a fresh preview arrives
  useEffect(() => {
    setPerFileDirty(new Set());
    if (!files.find((f) => f.path === activePath)) {
      setActivePath(files[0]?.path ?? "");
    }
  }, [preview.hash, files, activePath]);

  // Debounced onChange so rapid keystrokes don't thrash the reducer
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const handleEditorChange = useCallback(
    (path: string, value: string | undefined) => {
      const next = value ?? "";
      // Mark per-file dirty immediately for the tab indicator
      setPerFileDirty((prev) => {
        if (prev.has(path)) return prev;
        const copy = new Set(prev);
        copy.add(path);
        return copy;
      });
      // Debounce the parent dispatch
      const existing = debounceTimers.current.get(path);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        debounceTimers.current.delete(path);
        onChange?.(path, next);
      }, 250);
      debounceTimers.current.set(path, timer);
    },
    [onChange],
  );

  const onMount: OnMount = useCallback((_editor, monaco) => {
    configureMonaco(monaco);
  }, []);

  const dirty = dirtyProp ?? perFileDirty.size > 0;

  const handleRegenerateClick = useCallback(() => {
    if (dirty) {
      setConfirmRegenerateOpen(true);
    } else {
      onRegenerate?.();
    }
  }, [dirty, onRegenerate]);

  const confirmRegenerate = useCallback(() => {
    setConfirmRegenerateOpen(false);
    onRegenerate?.();
  }, [onRegenerate]);

  const activeFile = files.find((f) => f.path === activePath) ?? files[0];

  return (
    <div className="flex flex-col rounded-2xl border border-white/5 bg-[#0a0a0f] overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono text-foreground">{preview.templateId}</span>
          <span className="text-white/20">·</span>
          <span>v{preview.templateVersion}</span>
          <span className="text-white/20">·</span>
          <span className="font-mono">{preview.hash.slice(0, 8)}</span>
          {dirty ? (
            <>
              <span className="text-white/20">·</span>
              <span className="flex items-center gap-1 text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Unsaved edits
              </span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRegenerateClick}
            disabled={!onRegenerate}
            data-testid="codepreview-regenerate"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSaveOnly?.()}
            disabled={!onSaveOnly}
            data-testid="codepreview-save-only"
          >
            <Save className="h-3.5 w-3.5" />
            Save without training
          </Button>
          <Button
            size="sm"
            onClick={() => onSave?.()}
            disabled={!onSave}
            data-testid="codepreview-save-train"
          >
            <Play className="h-3.5 w-3.5" />
            {dirty ? (
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                Save & train
              </span>
            ) : (
              "Save & train"
            )}
          </Button>
        </div>
      </div>

      {/* File tab strip */}
      <Tabs value={activePath} onValueChange={setActivePath} className="flex-1 flex flex-col">
        <TabsList className="rounded-none bg-white/[0.02] border-b border-white/5 h-9 px-2 justify-start gap-0">
          {files.map((file) => {
            const isDirty = perFileDirty.has(file.path);
            return (
              <TabsTrigger
                key={file.path}
                value={file.path}
                className={cn(
                  "h-7 px-3 text-xs font-mono rounded-md",
                  "data-[state=active]:bg-white/[0.06] data-[state=active]:text-foreground",
                  "text-muted-foreground",
                )}
                data-testid={`codepreview-tab-${shortLabel(file.path)}`}
              >
                <span className="flex items-center gap-1.5">
                  {shortLabel(file.path)}
                  {isDirty ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  ) : null}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Editor (single instance, value swaps with tab) */}
        <div className="flex-1 min-h-[420px]">
          {activeFile ? (
            <Editor
              key={preview.hash}
              path={activeFile.path}
              language={languageOf(activeFile)}
              value={activeFile.content}
              theme={ML_STUDIO_DARK}
              onMount={onMount}
              onChange={(value) => handleEditorChange(activeFile.path, value)}
              loading={
                <div className="flex h-full items-center justify-center text-muted-foreground gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading editor</span>
                </div>
              }
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily:
                  "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
                fontLigatures: true,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 4,
                insertSpaces: true,
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
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No files in this preview.
            </div>
          )}
        </div>

        {/* Warnings strip */}
        {preview.warnings.length > 0 ? (
          <div className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-200/80 space-y-1">
            {preview.warnings.map((w, i) => (
              <div key={i}>· {w}</div>
            ))}
          </div>
        ) : null}
      </Tabs>

      {/* Confirm-regenerate dialog (only when dirty) */}
      <AlertDialog open={confirmRegenerateOpen} onOpenChange={setConfirmRegenerateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved edits?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved edits in the generated code. Regenerating will
              discard them and rebuild from the current model + hyperparameter
              configuration.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="codepreview-regenerate-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRegenerate}
              data-testid="codepreview-regenerate-confirm"
            >
              Discard and regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
