/**
 * Notebooks — every marimo notebook on this machine, served in place.
 *
 * Each notebook belongs to a group (one Python environment and working
 * directory, one pinned port, one `marimo run` process). Selecting a notebook
 * starts its group if it is not already up, then shows the notebook itself in
 * an iframe on this origin — the dashboard proxies /marimo/<group>/ so the
 * page, its websocket and its assets are all same-origin.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NotebookPen, Pencil, RefreshCw, Square } from "lucide-react";
import { PageShell } from "@/backtest/components";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useToast } from "@/shared/hooks/use-toast";
import { cn } from "@/shared/utils/utils";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable";

interface NotebookEntry {
  path: string;
  groupSlug: string;
  category: string;
  repoLabel: string;
  relativePath: string;
  title: string;
  description: string;
  sizeBytes: number;
  modifiedAtIso: string;
  url: string;
}

interface GroupEntry {
  slug: string;
  label: string;
  python: string;
  cwd: string;
  port: number;
  status: "stopped" | "starting" | "ready" | "error";
  error?: string;
}

interface CatalogResponse {
  groups: GroupEntry[];
  notebooks: NotebookEntry[];
}

const STATUS_WORDS: Record<GroupEntry["status"], string> = {
  stopped: "not running",
  starting: "starting…",
  ready: "running",
  error: "failed",
};

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof parsed?.error === "string" ? parsed.error : `${response.status} ${response.statusText}`);
  return parsed as T;
}

export default function MarimoPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<NotebookEntry | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameNonce, setFrameNonce] = useState(0);
  const [filter, setFilter] = useState("");

  const catalog = useQuery({
    queryKey: ["marimo", "notebooks"],
    queryFn: ({ signal }) =>
      fetch("/api/marimo/notebooks", { signal }).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<CatalogResponse>;
      }),
    refetchInterval: (query) =>
      query.state.data?.groups.some((g) => g.status === "starting") ? 1500 : false,
  });

  const start = useMutation({
    mutationFn: (notebook: NotebookEntry) =>
      postJson<{ status: string; url: string }>(`/api/marimo/groups/${notebook.groupSlug}/start`).then(() => notebook),
    onSuccess: (notebook) => {
      setFrameUrl(notebook.url);
      queryClient.invalidateQueries({ queryKey: ["marimo"] });
    },
    onError: (error: Error) => toast({ title: "Could not start the notebook group", description: error.message, variant: "destructive" }),
  });

  const stop = useMutation({
    mutationFn: (slug: string) => postJson<{ status: string }>(`/api/marimo/groups/${slug}/stop`),
    onSuccess: () => {
      setFrameUrl(null);
      queryClient.invalidateQueries({ queryKey: ["marimo"] });
    },
    onError: (error: Error) => toast({ title: "Could not stop the group", description: error.message, variant: "destructive" }),
  });

  const edit = useMutation({
    mutationFn: (notebook: NotebookEntry) => postJson<{ url: string }>("/api/marimo/editor", { path: notebook.path }),
    onSuccess: (result) => setFrameUrl(result.url),
    onError: (error: Error) => toast({ title: "Could not open the editor", description: error.message, variant: "destructive" }),
  });

  const groups = catalog.data?.groups ?? [];
  const notebooks = catalog.data?.notebooks ?? [];

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return notebooks;
    return notebooks.filter((n) =>
      [n.title, n.description, n.relativePath, n.category].some((field) => field.toLowerCase().includes(needle)),
    );
  }, [notebooks, filter]);

  const byCategory = useMemo(() => {
    const map = new Map<string, NotebookEntry[]>();
    for (const notebook of visible) {
      const list = map.get(notebook.category);
      if (list) list.push(notebook);
      else map.set(notebook.category, [notebook]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  // Reopening the same notebook after a restart needs a fresh iframe.
  useEffect(() => setFrameNonce((n) => n + 1), [frameUrl]);

  const selectedGroup = selected ? groups.find((g) => g.slug === selected.groupSlug) : undefined;
  const pending = start.isPending || edit.isPending;

  const open = (notebook: NotebookEntry) => {
    setSelected(notebook);
    const group = groups.find((g) => g.slug === notebook.groupSlug);
    if (group?.status === "ready") setFrameUrl(notebook.url);
    else {
      setFrameUrl(null);
      start.mutate(notebook);
    }
  };

  return (
    <PageShell
      title="Notebooks"
      subtitle="Every marimo notebook on this machine, run in its own project environment and shown here"
      icon={NotebookPen}
      fillHeight
      actions={[
        { label: "Rescan", icon: RefreshCw, onClick: () => catalog.refetch(), variant: "ghost" },
      ]}
    >
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="notebooks-split"
        className="h-full min-h-0"
        data-testid="notebooks-page"
      >
        {/* ── Catalog ─────────────────────────────────────────────── */}
        <ResizablePanel defaultSize={26} minSize={14} maxSize={60} className="flex min-w-0 flex-col gap-2 overflow-hidden">
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={`Search ${notebooks.length} notebooks…`}
            className="h-8 text-xs"
            data-testid="notebook-filter"
          />

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {catalog.isLoading && <p className="px-2 text-xs text-muted-foreground">Scanning notebook roots…</p>}
            {catalog.error && <p className="px-2 text-xs text-destructive">Catalog failed: {(catalog.error as Error).message}</p>}
            {byCategory.map(([category, entries]) => (
              <section key={category} className="mb-3">
                <h3 className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {category} <span className="tnum">({entries.length})</span>
                </h3>
                <ul>
                  {entries.map((notebook) => {
                    const isSelected = selected?.path === notebook.path;
                    return (
                      <li key={notebook.path}>
                        <button
                          type="button"
                          onClick={() => open(notebook)}
                          className={cn(
                            "w-full rounded-md border px-2 py-1.5 text-left transition-colors",
                            isSelected
                              ? "border-primary/60 bg-muted"
                              : "border-transparent hover:border-border hover:bg-muted/50",
                          )}
                          title={notebook.relativePath}
                        >
                          <span className="flex items-baseline gap-1.5">
                            <span aria-hidden="true" className="text-[10px] text-muted-foreground">
                              {isSelected ? "▸" : "·"}
                            </span>
                            <span className="truncate text-xs font-medium text-foreground">{notebook.title}</span>
                          </span>
                          <span className="ml-3 block truncate font-mono text-[10px] text-muted-foreground">
                            {notebook.relativePath}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {!catalog.isLoading && visible.length === 0 && (
              <p className="px-2 text-xs text-muted-foreground">No notebook matches “{filter}”.</p>
            )}
          </div>

          {/* ── Group runtimes ───────────────────────────────────── */}
          <div className="shrink-0 rounded-md border border-border p-2">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Environments</h3>
            <ul className="space-y-1">
              {groups.map((group) => (
                <li key={group.slug} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate" title={`${group.python}\n${group.cwd}`}>
                    <span className="font-mono text-foreground">{group.label}</span>
                    <span className="ml-1 text-muted-foreground tnum">:{group.port}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className={cn("text-muted-foreground", group.status === "error" && "text-destructive")}>
                      {STATUS_WORDS[group.status]}
                    </span>
                    {group.status === "ready" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5"
                        title={`Stop ${group.label}`}
                        onClick={() => stop.mutate(group.slug)}
                      >
                        <Square className="h-3 w-3" />
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {groups.some((g) => g.error) && (
              <p className="mt-1 text-[10px] text-destructive">
                {groups.find((g) => g.error)?.error}
              </p>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="mx-1.5 bg-transparent" />

        {/* ── Notebook ────────────────────────────────────────────── */}
        <ResizablePanel defaultSize={74} minSize={30} className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">{selected ? selected.title : "No notebook open"}</h2>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {selected ? `${selected.relativePath} · ${selectedGroup?.python ?? ""}` : "Choose one from the list"}
              </p>
            </div>
            {selected && (
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => edit.mutate(selected)} disabled={edit.isPending}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  {edit.isPending ? "Opening…" : "Open in editor"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setFrameNonce((n) => n + 1)} disabled={!frameUrl}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  Reload
                </Button>
              </div>
            )}
          </header>

          <div className="min-h-0 flex-1">
            {frameUrl ? (
              <iframe
                key={frameNonce}
                src={frameUrl}
                className="h-full w-full border-none"
                title={selected?.title ?? "marimo notebook"}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                {pending ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <p>Starting {selectedGroup?.label ?? "the notebook environment"} on port {selectedGroup?.port}…</p>
                  </>
                ) : (
                  <>
                    <NotebookPen className="h-8 w-8 opacity-20" />
                    <p>Select a notebook to run it here.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </PageShell>
  );
}
