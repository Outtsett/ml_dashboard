/** The open notebooks: a tab strip over one iframe per tab. Inactive frames stay
 *  mounted but hidden, so switching tabs keeps each notebook's state, sliders
 *  and scroll instead of reloading it. */

import { NotebookPen, Pencil, Play, RefreshCw, Star, Stethoscope, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/utils/utils";
import { DatasetChips, GitMarker, HealthBadge, healthTooltip } from "./Markers";
import type { GroupEntry, NotebookEntry, OpenTab } from "./types";

export interface NotebookTabsProps {
  tabs: OpenTab[];
  activeKey: string | null;
  notebooksById: Map<string, NotebookEntry>;
  groupsBySlug: Map<string, GroupEntry>;
  /** The file the editor process has open and is ready on, if any. */
  editorReadyPath: string | null;
  editorPending: boolean;
  /** Groups a start request is in flight for: shown as starting before the server says so. */
  pendingStartSlugs: string[];
  /** The editor's last start failure, and which notebook it was for. */
  editorError: { path: string | null; message: string } | null;
  nonces: Record<string, number>;
  /** Tabs whose frame stays mounted (the one in view and the most recently
   *  viewed); any other tab has no frame until it is shown again. */
  liveKeys: string[];
  dataset: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onReload: (key: string) => void;
  onEdit: (notebook: NotebookEntry) => void;
  onRun: (notebook: NotebookEntry) => void;
  onStartGroup: (slug: string) => void;
  onCheck: (notebook: NotebookEntry) => void;
  onTogglePin: (notebook: NotebookEntry) => void;
  onDatasetChange: (dataset: string | null) => void;
}

function frameUrl(tab: OpenTab, notebook: NotebookEntry, group: GroupEntry | undefined, editorReadyPath: string | null): string | null {
  if (tab.mode === "edit") return editorReadyPath === notebook.path ? "/marimo/editor/" : null;
  return group?.status === "ready" ? notebook.url : null;
}

function Waiting({ tab, notebook, group, editorPending, editorError, startRequested, onStartGroup, onEdit }: {
  tab: OpenTab;
  notebook: NotebookEntry;
  group: GroupEntry | undefined;
  editorPending: boolean;
  editorError: { path: string | null; message: string } | null;
  startRequested: boolean;
  onStartGroup: (slug: string) => void;
  onEdit: (notebook: NotebookEntry) => void;
}) {
  if (tab.mode === "edit" && !editorPending && editorError && editorError.path === notebook.path) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p className="text-[#D55E00]">✕ The editor did not start for {notebook.title}.</p>
        <pre className="max-h-40 max-w-xl overflow-auto whitespace-pre-wrap text-[10px]">{editorError.message}</pre>
        <Button size="sm" variant="outline" onClick={() => onEdit(notebook)}>Try again</Button>
      </div>
    );
  }
  if (tab.mode === "edit") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className={cn("h-5 w-5", editorPending && "animate-spin")} />
        <p>{editorPending ? `Opening ${notebook.title} in the editor…` : "The editor has another notebook open."}</p>
        {!editorPending && <Button size="sm" variant="outline" onClick={() => onEdit(notebook)}>Open {notebook.title} in the editor</Button>}
      </div>
    );
  }
  const starting = group?.status === "starting" || (startRequested && group?.status !== "error");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="tab-waiting">
      {starting ? (
        <>
          <RefreshCw className="h-5 w-5 animate-spin" />
          <p>Starting {group?.label} on port {group?.port}… (progress is under Environments)</p>
        </>
      ) : group?.status === "error" ? (
        <>
          <p className="text-[#D55E00]">✕ {group.label} failed to start.</p>
          <pre className="max-h-40 max-w-xl overflow-auto whitespace-pre-wrap text-[10px]">{group.error}</pre>
          <Button size="sm" variant="outline" onClick={() => onStartGroup(notebook.groupSlug)}>Try again</Button>
        </>
      ) : (
        <>
          <p>{group?.stoppedForIdleAtIso ? `${group.label} was stopped after sitting idle.` : `${group?.label ?? "Its environment"} is not running.`}</p>
          <Button size="sm" variant="outline" onClick={() => onStartGroup(notebook.groupSlug)}>
            <Play className="mr-1 h-3.5 w-3.5" /> Start {group?.label}
          </Button>
        </>
      )}
    </div>
  );
}

export function NotebookTabs(props: NotebookTabsProps) {
  const { tabs, activeKey, notebooksById, groupsBySlug } = props;
  const activeTab = tabs.find((t) => t.key === activeKey) ?? null;
  const active = activeTab ? notebooksById.get(activeTab.notebookId) : undefined;
  const activeGroup = active ? groupsBySlug.get(active.groupSlug) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Tab strip ──────────────────────────────────────── */}
      <div className="flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border px-1 pt-1" role="tablist" data-testid="notebook-tabs">
        {tabs.map((tab) => {
          const notebook = notebooksById.get(tab.notebookId);
          const selected = tab.key === activeKey;
          return (
            <div
              key={tab.key}
              role="tab"
              aria-selected={selected}
              tabIndex={0}
              onClick={() => props.onActivate(tab.key)}
              onKeyDown={(event) => event.key === "Enter" && props.onActivate(tab.key)}
              onAuxClick={(event) => event.button === 1 && props.onClose(tab.key)}
              className={cn(
                "group flex max-w-[14rem] cursor-pointer items-center gap-1 rounded-t-md border border-b-0 px-2 py-1 text-[11px]",
                selected ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/50",
              )}
              title={notebook ? `${notebook.title}\n${notebook.relativePath}` : tab.notebookId}
              data-testid="notebook-tab"
            >
              {tab.mode === "edit" && <Pencil className="h-3 w-3 shrink-0" aria-label="editing" />}
              <span className="truncate">{notebook?.title ?? "missing notebook"}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClose(tab.key);
                }}
                className="shrink-0 rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
                aria-label={`Close ${notebook?.title ?? "tab"}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {tabs.length === 0 && <span className="px-2 py-1 text-[11px] text-muted-foreground">No notebook open</span>}
      </div>

      {/* ── Active notebook header ─────────────────────────── */}
      {active && activeTab && (
        <header className="shrink-0 space-y-1 border-b border-border px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
              <span className="truncate">{active.title}</span>
              <HealthBadge health={active.health} modifiedAtIso={active.modifiedAtIso} />
              <GitMarker state={active.gitState} />
            </h2>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => props.onTogglePin(active)} title={active.pinned ? "Unpin" : "Pin: keep it at the top and its environment warm"}>
                <Star className="h-3.5 w-3.5" style={active.pinned ? { color: "#E69F00", fill: "#E69F00" } : undefined} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => props.onCheck(active)}
                disabled={active.health?.status === "running" || active.health?.status === "queued"}
                title={`Run every cell now with marimo export.

${healthTooltip(active.health, active.modifiedAtIso)}`}
              >
                <Stethoscope className="mr-1 h-3.5 w-3.5" />
                Check
              </Button>
              {activeTab.mode === "run" ? (
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => props.onEdit(active)} disabled={props.editorPending}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  {props.editorPending ? "Opening…" : "Edit"}
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => props.onRun(active)}>
                  <Play className="mr-1 h-3.5 w-3.5" />
                  Run view
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => props.onReload(activeTab.key)} title="Reload this notebook">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {active.description && <p className="line-clamp-2 text-[11px] text-muted-foreground">{active.description}</p>}
          <p className="truncate font-mono text-[10px] text-muted-foreground" title={activeGroup?.python}>
            {active.relativePath} · {active.cellCount} cells · runs in {activeGroup?.label ?? active.groupSlug}
          </p>
          <DatasetChips datasets={active.datasets} active={props.dataset} onSelect={(name) => props.onDatasetChange(props.dataset === name ? null : name)} limit={6} />
        </header>
      )}
      {active?.health?.status === "failed" && activeTab && (
        <pre className="max-h-24 shrink-0 overflow-auto whitespace-pre-wrap border-b border-border bg-[#D55E00]/5 px-3 py-1 font-mono text-[10px] text-[#D55E00]" data-testid="health-error">
          ✕ {active.health.error}
        </pre>
      )}

      {/* ── Frames ─────────────────────────────────────────── */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          const notebook = notebooksById.get(tab.notebookId);
          if (!notebook) return null;
          const group = groupsBySlug.get(notebook.groupSlug);
          const url = frameUrl(tab, notebook, group, props.editorReadyPath);
          const visible = tab.key === activeKey;
          if (!visible && !props.liveKeys.includes(tab.key)) return null;
          return (
            <div key={tab.key} className={cn("absolute inset-0", !visible && "invisible")} aria-hidden={!visible}>
              {url ? (
                <iframe key={`${tab.key}:${props.nonces[tab.key] ?? 0}:${url}`} src={url} className="h-full w-full border-none" title={notebook.title} />
              ) : (
                <Waiting
                  tab={tab}
                  notebook={notebook}
                  group={group}
                  editorPending={props.editorPending}
                  editorError={props.editorError}
                  startRequested={props.pendingStartSlugs.includes(notebook.groupSlug)}
                  onStartGroup={props.onStartGroup}
                  onEdit={props.onEdit}
                />
              )}
            </div>
          );
        })}
        {tabs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <NotebookPen className="h-8 w-8 opacity-20" />
            <p>Select a notebook to run it here. Up to six stay open as tabs.</p>
          </div>
        )}
      </div>
    </div>
  );
}
