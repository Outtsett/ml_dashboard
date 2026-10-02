/** Formatting and pure selection logic for the notebook tab — no React here, so
 *  every rule is unit-tested on its own (apps/web/tests/marimo-notebooks.test.ts). */

import type { HealthRecord, NotebookEntry } from "./types";

/** Local date and time, to the minute: "15 Sep 2026, 21:54". The catalog sends
 *  UTC ISO strings; a research library is read in the clock you worked in. */
export function whenLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown";
  return at.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** The local calendar day a timestamp falls on, as YYYY-MM-DD. Bucketing on the
 *  UTC date instead put 2026-09-16 06:01 UTC and 2026-09-15 23:31 UTC in
 *  different groups that both rendered as "Today", because the label is local
 *  and the key was not. */
export function localDayKey(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Today / Yesterday / the date — the heading a notebook is filed under. */
export function dayBucket(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "Undated";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return at.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function bytesLabel(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

export function durationLabel(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${Math.round(seconds % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** What the health badge says. A result older than the file is not a result
 *  about this version, so it is reported as changed rather than as passed. */
export type HealthView = "passes" | "fails" | "checking" | "queued" | "changed" | "unchecked";

export function healthView(health: HealthRecord | null, modifiedAtIso: string): HealthView {
  if (!health || health.status === "cancelled") return "unchecked";
  if (health.status === "running") return "checking";
  if (health.status === "queued") return "queued";
  if (Date.parse(modifiedAtIso) > Date.parse(health.sourceModifiedAtIso)) return "changed";
  return health.status === "passed" ? "passes" : "fails";
}

export type SortOrder = "edited" | "name" | "category";

export interface ListFilters {
  text: string;
  categories: ReadonlySet<string>;
  dataset: string | null;
  health: HealthView | null;
  uncommittedOnly: boolean;
}

/** The notebooks the list shows, in the order it shows them. Pinned ones are
 *  returned separately so they always sit at the top whatever the sort. */
export function selectNotebooks(
  notebooks: NotebookEntry[],
  filters: ListFilters,
  sort: SortOrder,
): { pinned: NotebookEntry[]; rest: NotebookEntry[] } {
  const needle = filters.text.trim().toLowerCase();
  const kept = notebooks.filter((n) => {
    if (filters.categories.size > 0 && !filters.categories.has(n.category)) return false;
    if (filters.dataset && !n.datasets.some((d) => d.name === filters.dataset)) return false;
    if (filters.health && healthView(n.health, n.modifiedAtIso) !== filters.health) return false;
    if (filters.uncommittedOnly && n.gitState !== "modified" && n.gitState !== "untracked") return false;
    if (!needle) return true;
    return [n.title, n.description, n.relativePath, n.category].some((field) => field.toLowerCase().includes(needle));
  });
  const compare = (a: NotebookEntry, b: NotebookEntry) => {
    if (sort === "name") return a.title.localeCompare(b.title);
    if (sort === "category") return a.category.localeCompare(b.category) || a.title.localeCompare(b.title);
    return b.modifiedAtIso.localeCompare(a.modifiedAtIso);
  };
  const sorted = [...kept].sort(compare);
  return { pinned: sorted.filter((n) => n.pinned), rest: sorted.filter((n) => !n.pinned) };
}

/** Headed sections for the unpinned list: by day for "edited", by category for
 *  "category", one alphabetical section for "name". */
export function sectionNotebooks(notebooks: NotebookEntry[], sort: SortOrder, now = new Date()): Array<{ key: string; label: string; entries: NotebookEntry[] }> {
  if (sort === "name") return notebooks.length ? [{ key: "all", label: "A to Z", entries: notebooks }] : [];
  const sections = new Map<string, { key: string; label: string; entries: NotebookEntry[] }>();
  for (const notebook of notebooks) {
    const key = sort === "category" ? notebook.category : localDayKey(notebook.modifiedAtIso);
    const label = sort === "category" ? notebook.category : dayBucket(notebook.modifiedAtIso, now);
    const section = sections.get(key);
    if (section) section.entries.push(notebook);
    else sections.set(key, { key, label, entries: [notebook] });
  }
  const list = [...sections.values()];
  return sort === "category" ? list : list.sort((a, b) => b.key.localeCompare(a.key));
}

/** Finds a notebook from a link: its id, its relative path, or the tail of that
 *  path (`notebooks/model_cycle_runs.py`), so another page can link to the file
 *  it knows without computing a hash. */
export function resolveNotebookReference(notebooks: NotebookEntry[], reference: string | null): NotebookEntry | undefined {
  if (!reference) return undefined;
  const byId = notebooks.find((n) => n.id === reference);
  if (byId) return byId;
  const tail = reference.split("\\").join("/").toLowerCase();
  return notebooks.find((n) => n.relativePath.toLowerCase() === tail)
    ?? notebooks.find((n) => n.relativePath.toLowerCase().endsWith(`/${tail}`));
}

/** Progress of a starting group, 0 to 1: elapsed over the last measured startup,
 *  held under 0.95 so the bar never claims "done" before the group says so.
 *  With no measurement yet it creeps toward 0.95 over about half a minute. */
export function startupProgress(startingSinceIso: string | undefined, expectedSeconds: number | null, nowMs = Date.now()): number {
  if (!startingSinceIso) return 0;
  const elapsed = Math.max(0, (nowMs - Date.parse(startingSinceIso)) / 1000);
  if (expectedSeconds && expectedSeconds > 0) return Math.min(0.95, elapsed / expectedSeconds);
  return 0.95 * (1 - Math.exp(-elapsed / 12));
}

export const MAXIMUM_OPEN_TABS = 6;

/** How many tabs keep a live notebook frame. Chrome allows six HTTP/1.1
 *  connections per host, the dashboard's own event streams hold several, and a
 *  notebook frame loads ~250 files and keeps kernel calls open: measured
 *  2026-09-28, four frames restored at once queued every other request on the
 *  page — including the request that starts an environment — for over a minute.
 *  The tab in view and the two viewed before it stay live; an older tab reloads
 *  when it is shown again. */
export const LIVE_FRAMES = 3;

/** Moves `key` to the front of the most-recently-viewed list, dropping keys of
 *  closed tabs. */
export function touchRecent(recent: string[], key: string | null, openKeys: string[]): string[] {
  const open = new Set(openKeys);
  const kept = recent.filter((k) => k !== key && open.has(k));
  return key && open.has(key) ? [key, ...kept] : kept;
}

/** Adds a tab, or focuses it if it is already open. The editor is one process
 *  with one file, so opening a second file in it replaces the first edit tab.
 *  Past MAXIMUM_OPEN_TABS the oldest tab that is not the new one is closed. */
export function openTab<T extends { key: string; mode: "run" | "edit" }>(tabs: T[], tab: T): T[] {
  if (tabs.some((t) => t.key === tab.key)) return tabs;
  const kept = tab.mode === "edit" ? tabs.filter((t) => t.mode !== "edit") : tabs;
  const next = [...kept, tab];
  return next.length > MAXIMUM_OPEN_TABS ? next.slice(next.length - MAXIMUM_OPEN_TABS) : next;
}
