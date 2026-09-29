/**
 * Notebooks — every marimo notebook on this machine, served in place.
 *
 * Each notebook belongs to a group (one Python environment and working
 * directory, one pinned port, one `marimo run` process). Opening a notebook
 * starts its group if it is not already up and shows the notebook in a tab; up
 * to six tabs stay open, each frame kept alive. The dashboard proxies
 * /marimo/<group>/ so the page, its websocket and its assets are same-origin.
 *
 * The library beside it searches titles or the code inside every cell, filters
 * by category, health, uncommitted work and the lake data a notebook reads, and
 * keeps pinned notebooks at the top (their environments start with the
 * dashboard). The open notebook is in the URL (`?notebook=<id or path>`), so a
 * reload or a link from another page lands on it.
 */

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { FilePlus2, NotebookPen, RefreshCw, Stethoscope, XCircle } from "lucide-react";
import { PageShell } from "@/backtest/components";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable";
import {
  useCancelHealthChecks,
  useCreateNotebook,
  useHealthCheck,
  useNotebookCatalog,
  useNotebookSearch,
  useOpenEditor,
  usePendingStarts,
  useRescan,
  useStartGroup,
  useStopGroup,
  useTogglePin,
} from "./api";
import { healthView, LIVE_FRAMES, openTab, resolveNotebookReference, selectNotebooks, touchRecent, type HealthView, type SortOrder } from "./format";
import { NotebookList, type SearchMode } from "./NotebookList";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { NotebookTabs } from "./NotebookTabs";
import { NewNotebookDialog } from "./NewNotebookDialog";
import type { GroupEntry, NotebookEntry, OpenTab } from "./types";

const TABS_STORAGE_KEY = "notebook-tabs-v1";
const VIEW_STORAGE_KEY = "notebook-view-v1";

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private window or blocked storage: the tab still works, it just forgets.
  }
}

export default function MarimoPage() {
  const catalog = useNotebookCatalog();
  const search = useSearch();
  const [, navigate] = useLocation();

  const storedView = readStored(VIEW_STORAGE_KEY, { sort: "edited" as SortOrder, mode: "titles" as SearchMode });
  const [sort, setSort] = useState<SortOrder>(storedView.sort);
  const [mode, setMode] = useState<SearchMode>(storedView.mode);
  const [text, setText] = useState("");
  const [categories, setCategories] = useState<Set<string>>(() => new Set());
  const [dataset, setDataset] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthView | null>(null);
  const [uncommittedOnly, setUncommittedOnly] = useState(false);

  const storedTabs = readStored(TABS_STORAGE_KEY, { tabs: [] as OpenTab[], activeKey: null as string | null });
  // The editor is one process that a reload does not reconnect to, so only run tabs are restored.
  const [tabs, setTabs] = useState<OpenTab[]>(() => storedTabs.tabs.filter((t) => t.mode === "run"));
  // The stored active tab is used only if it is one of the restored run tabs;
  // otherwise the last restored tab is shown, never an empty frame.
  const [activeKey, setActiveKey] = useState<string | null>(() => {
    const restored = storedTabs.tabs.filter((t) => t.mode === "run");
    return restored.some((t) => t.key === storedTabs.activeKey) ? storedTabs.activeKey : (restored.at(-1)?.key ?? null);
  });
  const [nonces, setNonces] = useState<Record<string, number>>({});
  // Most recently viewed first; only the first LIVE_FRAMES keep a frame mounted.
  const [recentKeys, setRecentKeys] = useState<string[]>([]);
  const [editorReadyPath, setEditorReadyPath] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const notebooks = catalog.data?.notebooks ?? [];
  const groups = catalog.data?.groups ?? [];
  const notebooksById = useMemo(() => new Map(notebooks.map((n) => [n.id, n])), [notebooks]);
  const groupsBySlug = useMemo(() => new Map<string, GroupEntry>(groups.map((g) => [g.slug, g])), [groups]);

  const startGroup = useStartGroup();
  const pendingStarts = usePendingStarts();
  const rescan = useRescan();
  const stopGroup = useStopGroup();
  const editor = useOpenEditor((notebook) => setEditorReadyPath(notebook.path));
  const togglePin = useTogglePin();
  const check = useHealthCheck();
  const cancelChecks = useCancelHealthChecks();

  const deferredText = useDeferredValue(text);
  const cellSearch = useNotebookSearch(mode === "cells" ? deferredText : "");

  useEffect(() => writeStored(VIEW_STORAGE_KEY, { sort, mode }), [sort, mode]);
  useEffect(() => writeStored(TABS_STORAGE_KEY, { tabs, activeKey }), [tabs, activeKey]);
  useEffect(() => {
    setRecentKeys((current) => {
      const next = touchRecent(current, activeKey, tabs.map((t) => t.key));
      return next.length === current.length && next.every((k, i) => k === current[i]) ? current : next;
    });
  }, [activeKey, tabs]);
  const liveKeys = recentKeys.slice(0, LIVE_FRAMES);

  const ensureGroup = (notebook: NotebookEntry) => {
    const group = groupsBySlug.get(notebook.groupSlug);
    if (group?.status === "ready" || group?.status === "starting" || pendingStarts.includes(notebook.groupSlug)) return;
    startGroup.mutate(notebook.groupSlug);
  };

  const openNotebook = (notebook: NotebookEntry) => {
    const key = `run:${notebook.id}`;
    setTabs((current) => openTab(current, { key, notebookId: notebook.id, mode: "run" }));
    setActiveKey(key);
    ensureGroup(notebook);
  };

  const editNotebook = (notebook: NotebookEntry) => {
    const key = `edit:${notebook.id}`;
    setTabs((current) => openTab(current, { key, notebookId: notebook.id, mode: "edit" }));
    setActiveKey(key);
    if (editorReadyPath !== notebook.path) {
      setEditorReadyPath(null);
      editor.mutate(notebook);
    }
  };

  const closeTab = (key: string) => {
    setTabs((current) => {
      const index = current.findIndex((t) => t.key === key);
      const next = current.filter((t) => t.key !== key);
      if (key === activeKey) setActiveKey(next[Math.min(index, next.length - 1)]?.key ?? null);
      return next;
    });
    if (key.startsWith("edit:")) setEditorReadyPath(null);
  };

  // Tabs whose notebook left the catalog (renamed, deleted) are closed once the catalog has loaded.
  useEffect(() => {
    if (!catalog.data) return;
    const kept = tabs.filter((t) => notebooksById.has(t.notebookId));
    if (kept.length !== tabs.length) setTabs(kept);
    if (!kept.some((t) => t.key === activeKey)) {
      const fallback = kept.at(-1)?.key ?? null;
      if (fallback !== activeKey) setActiveKey(fallback);
    }
  }, [catalog.data, notebooksById, tabs, activeKey]);

  // A restored run tab needs its environment: start the group once the catalog says it is down.
  const restoredStart = useRef(false);
  useEffect(() => {
    if (restoredStart.current || !catalog.data) return;
    restoredStart.current = true;
    const active = tabs.find((t) => t.key === activeKey);
    const notebook = active ? notebooksById.get(active.notebookId) : undefined;
    if (notebook) ensureGroup(notebook);
  });

  // ?notebook=<id | relative path | path tail> opens that notebook: the link other
  // pages use. The URL then follows the active tab (replace, not push, so Back
  // leaves the page). `pendingLinkId` holds the URL still while a linked tab is
  // being opened, and `lastWrittenId` stops the page re-opening a URL it wrote.
  const requested = new URLSearchParams(search).get("notebook");
  const activeTab = tabs.find((t) => t.key === activeKey);
  const pendingLinkId = useRef<string | null>(null);
  const lastWrittenId = useRef<string | null>(null);

  useEffect(() => {
    if (!catalog.data || !requested) return;
    if (requested === activeTab?.notebookId || requested === lastWrittenId.current) return;
    lastWrittenId.current = requested;
    const notebook = resolveNotebookReference(notebooks, requested);
    if (notebook) {
      pendingLinkId.current = notebook.id;
      openNotebook(notebook);
    }
  }, [requested, catalog.data]);

  useEffect(() => {
    if (!catalog.data) return;
    const id = activeTab?.notebookId ?? null;
    if (pendingLinkId.current) {
      if (id !== pendingLinkId.current) return;
      pendingLinkId.current = null;
    }
    if ((requested ?? null) === id) return;
    lastWrittenId.current = id;
    navigate(id ? `/marimo?notebook=${id}` : "/marimo", { replace: true });
  }, [activeTab?.notebookId, catalog.data, requested]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notebooks) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  }, [notebooks]);

  const { pinned, rest } = selectNotebooks(notebooks, { text: mode === "titles" ? text : "", categories, dataset, health, uncommittedOnly }, sort);

  const queue = catalog.data?.healthQueue ?? { queued: 0, running: 0 };
  const needsCheck = notebooks.filter((n) => {
    const view = healthView(n.health, n.modifiedAtIso);
    return view === "unchecked" || view === "changed";
  });
  const failing = notebooks.filter((n) => healthView(n.health, n.modifiedAtIso) === "fails").length;

  const create = useCreateNotebook((result) => {
    setNewOpen(false);
    // The catalog refetch lands the new entry; edit it as soon as it is there.
    pendingEdit.current = result.id;
  });
  const pendingEdit = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingEdit.current) return;
    const notebook = notebooksById.get(pendingEdit.current);
    if (!notebook) return;
    pendingEdit.current = null;
    editNotebook(notebook);
  });

  const actions = [
    { label: "New notebook", icon: FilePlus2, onClick: () => setNewOpen(true), variant: "outline" as const },
    queue.queued + queue.running > 0
      ? { label: `Cancel checks (${queue.running} running, ${queue.queued} queued)`, icon: XCircle, onClick: () => cancelChecks.mutate(), variant: "ghost" as const }
      : {
          label: needsCheck.length > 0 ? `Check ${needsCheck.length} unchecked or changed` : "Check all again",
          icon: Stethoscope,
          onClick: () => check.mutate(needsCheck.length > 0 ? needsCheck.map((n) => n.path) : []),
          variant: "ghost" as const,
        },
    { label: rescan.isPending ? "Rescanning…" : "Rescan", icon: RefreshCw, onClick: () => rescan.mutate(), variant: "ghost" as const },
  ];

  const toggleCategory = (name: string) =>
    setCategories((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <PageShell
      title="Notebooks"
      subtitle={
        catalog.data
          ? `${notebooks.length} marimo notebooks, each run in its own project environment${failing > 0 ? ` · ✕ ${failing} failing` : ""}`
          : "Every marimo notebook on this machine, run in its own project environment and shown here"
      }
      icon={NotebookPen}
      fillHeight
      actions={actions}
    >
      <ResizablePanelGroup direction="horizontal" autoSaveId="notebooks-split" className="h-full min-h-0" data-testid="notebooks-page">
        {/* ── Library ─────────────────────────────────────────── */}
        <ResizablePanel defaultSize={28} minSize={16} maxSize={60} className="flex min-w-0 flex-col gap-2 overflow-hidden">
          {catalog.isLoading && <p className="px-2 text-xs text-muted-foreground">Scanning notebook roots…</p>}
          {catalog.error && <p className="px-2 text-xs text-[#D55E00]">Catalog failed: {(catalog.error as Error).message}</p>}
          <NotebookList
            total={notebooks.length}
            categories={categoryCounts}
            pinned={pinned}
            rest={rest}
            sort={sort}
            onSortChange={setSort}
            text={text}
            onTextChange={setText}
            mode={mode}
            onModeChange={setMode}
            selectedCategories={categories}
            onToggleCategory={toggleCategory}
            onClearCategories={() => setCategories(new Set())}
            dataset={dataset}
            onDatasetChange={setDataset}
            health={health}
            onHealthChange={setHealth}
            uncommittedOnly={uncommittedOnly}
            onUncommittedChange={setUncommittedOnly}
            activeId={activeTab?.notebookId ?? null}
            onOpen={openNotebook}
            onTogglePin={(notebook) => togglePin.mutate({ path: notebook.path, pinned: !notebook.pinned })}
            search={{ data: cellSearch.data, isFetching: cellSearch.isFetching, error: cellSearch.error as Error | null }}
            notebooksById={notebooksById}
          />
          <EnvironmentPanel
            groups={groups}
            idleStopMinutes={catalog.data?.idleStopMinutes ?? 30}
            onStart={(slug) => startGroup.mutate(slug)}
            onStop={(slug) => stopGroup.mutate(slug)}
          />
        </ResizablePanel>

        <ResizableHandle withHandle className="mx-1.5 bg-transparent" />

        {/* ── Open notebooks ──────────────────────────────────── */}
        <ResizablePanel defaultSize={72} minSize={30} className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
          <NotebookTabs
            tabs={tabs}
            activeKey={activeKey}
            notebooksById={notebooksById}
            groupsBySlug={groupsBySlug}
            editorReadyPath={editorReadyPath}
            editorPending={editor.isPending}
            pendingStartSlugs={pendingStarts}
            editorError={editor.isError ? { path: editor.variables?.path ?? null, message: (editor.error as Error).message } : null}
            nonces={nonces}
            liveKeys={liveKeys}
            dataset={dataset}
            onActivate={setActiveKey}
            onClose={closeTab}
            onReload={(key) => setNonces((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }))}
            onEdit={editNotebook}
            onRun={openNotebook}
            onStartGroup={(slug) => startGroup.mutate(slug)}
            onCheck={(notebook) => check.mutate([notebook.path])}
            onTogglePin={(notebook) => togglePin.mutate({ path: notebook.path, pinned: !notebook.pinned })}
            onDatasetChange={setDataset}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      <NewNotebookDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        roots={catalog.data?.roots ?? []}
        pending={create.isPending}
        onCreate={(request) => create.mutate(request)}
      />
    </PageShell>
  );
}
