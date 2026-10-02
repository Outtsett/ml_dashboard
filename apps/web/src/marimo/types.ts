/** The notebook tab's view of GET /api/marimo/notebooks and its sibling routes
 *  (apps/api/marimo/marimo.router.ts). */

export type DatasetKind = "lake view" | "lake dataset" | "Iceberg table" | "serving table" | "lake loader" | "DuckDB file";

export interface DatasetReference {
  name: string;
  kind: DatasetKind;
}

export type GitState = "clean" | "modified" | "untracked" | "not_in_git";

export type HealthStatus = "passed" | "failed" | "queued" | "running" | "cancelled";

export interface HealthRecord {
  status: HealthStatus;
  checkedAtIso: string;
  sourceModifiedAtIso: string;
  durationSeconds: number | null;
  ranAlongside?: number;
  error?: string;
  outputSizeBytes?: number;
}

export interface NotebookEntry {
  id: string;
  path: string;
  groupSlug: string;
  category: string;
  repoLabel: string;
  relativePath: string;
  title: string;
  description: string;
  sizeBytes: number;
  modifiedAtIso: string;
  createdAtIso: string;
  url: string;
  datasets: DatasetReference[];
  cellCount: number;
  gitState: GitState;
  pinned: boolean;
  health: HealthRecord | null;
}

export type GroupStatus = "stopped" | "starting" | "ready" | "error";

export interface GroupEntry {
  slug: string;
  label: string;
  python: string;
  cwd: string;
  port: number;
  status: GroupStatus;
  error?: string;
  startingSinceIso?: string;
  lastOutputLine?: string;
  expectedStartupSeconds: number | null;
  stoppedForIdleAtIso?: string;
  memoryBytes: number | null;
  openConnections: number;
  idleSeconds: number | null;
  keptWarm: boolean;
}

export interface RootEntry {
  groupSlug: string;
  groupLabel: string;
  path: string;
  category: string;
  repoLabel: string;
}

export interface CatalogResponse {
  groups: GroupEntry[];
  notebooks: NotebookEntry[];
  roots: RootEntry[];
  idleStopMinutes: number;
  healthQueue: { queued: number; running: number };
}

export interface SourceMatch {
  lineNumber: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchResult {
  id: string;
  path: string;
  title: string;
  relativePath: string;
  total: number;
  matches: SourceMatch[];
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  notebookCount: number;
}

export interface LineageDataset {
  name: string;
  kind: DatasetKind;
  notebooks: Array<{ id: string; title: string; relativePath: string }>;
}

/** One open tab: a notebook run in its group, or the one notebook in the editor. */
export interface OpenTab {
  key: string;
  notebookId: string;
  mode: "run" | "edit";
}
