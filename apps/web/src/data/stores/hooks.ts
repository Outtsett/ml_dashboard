/**
 * Every request the Data page makes, one hook per concern. Each throws on a
 * non-OK answer, so a failure is drawn as a failure and never replaced by a
 * stand-in list.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QUERY_ROW_LIMIT } from "@shared/stores/limits";

export type LakeObjectKind = "candles" | "features" | "labels" | "news" | "calendar" | "events";

export interface LakeObject {
  objectId: string;
  viewName: string;
  displayName: string;
  kind: LakeObjectKind;
  origin: "iceberg" | "snapshot" | "manifest";
  dataset?: string;
  table?: string;
}

export interface LakeObjectsByKind {
  kinds: Array<{ kind: LakeObjectKind; count: number; objects: LakeObject[] }>;
  total: number;
}

export interface StoresOverview {
  lake: { objectCount: number; catalog: string; namespace: string };
  duckdb: { version: string };
  sqlite: {
    path: string;
    /** The database file plus its write-ahead log; null when the file could not be read. */
    sizeBytes: number | null;
    objectCount: number;
    /** rowCount is null when the count failed; an unknown is never reported as 0. */
    objects: Array<{ name: string; kind: string; rowCount: number | null }>;
  };
}

export interface ObjectDetail {
  store: "lake" | "sqlite";
  name: string;
  columns: Array<{ name: string; type: string; numeric: boolean }>;
  rowCount: number | null;
  rowCountSource?: RowCountSource;
}

/** `counted` = SELECT count(*) on the view; `iceberg_snapshot` = the catalog's own total. */
export type RowCountSource = "counted" | "iceberg_snapshot" | "failed";

export interface LakeInventory {
  countedAt: string;
  durationMilliseconds: number;
  objects: Array<{ name: string; rowCount: number | null; rowCountSource: RowCountSource; error?: string }>;
}

export interface PgAdminStatus {
  status: "ready" | "starting" | "stopped" | "error";
  port: number;
  url: string;
  pid: number | null;
  adopted: boolean;
  startedAt?: string;
  error?: string;
  restarts: number;
}

export async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = body && typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`;
    throw new Error(reason);
  }
  return body as T;
}

/** The lake's objects grouped by kind, from the server's object registry. */
export function useLakeObjectsByKind() {
  return useQuery({
    queryKey: ["stores", "objects-by-kind"],
    queryFn: ({ signal }) => readJson<LakeObjectsByKind>("/api/stores/objects-by-kind", signal),
    staleTime: 60_000,
  });
}

/** Every lake object's row count. The server counts once per ten minutes and shares the answer. */
export function useLakeInventory() {
  return useQuery({
    queryKey: ["stores", "inventory"],
    queryFn: ({ signal }) => readJson<LakeInventory>("/api/stores/inventory", signal),
    staleTime: 5 * 60_000,
  });
}

/** The three stores in one answer; the SQLite tables carry their counted rows. */
export function useStoresOverview() {
  return useQuery({
    queryKey: ["stores", "overview"],
    queryFn: ({ signal }) => readJson<StoresOverview>("/api/stores/overview", signal),
    staleTime: 30_000,
  });
}

/** Turns a view name, an object id or a bare dataset name into the object it names. */
export function useResolvedLakeObject(nameOrId: string | null) {
  return useQuery({
    queryKey: ["stores", "object", nameOrId],
    queryFn: ({ signal }) => readJson<LakeObject>(`/api/stores/object/${encodeURIComponent(nameOrId ?? "")}`, signal),
    enabled: Boolean(nameOrId),
    staleTime: 60_000,
    retry: false,
  });
}

/** Columns and the counted rows of one object. Shares its cache entry with the rows grid. */
export function useObjectDetail(store: "lake" | "sqlite", name: string | null) {
  return useQuery({
    queryKey: ["stores", "object", store, name],
    queryFn: ({ signal }) =>
      readJson<ObjectDetail>(`/api/stores/objects/${store}/${encodeURIComponent(name ?? "")}`, signal),
    enabled: Boolean(name),
    staleTime: 60_000,
  });
}

/** How many model specifications the catalog serves, for the link to the Model Catalog. */
export function useCatalogCount() {
  return useQuery({
    queryKey: ["stores", "catalog-count"],
    queryFn: async ({ signal }) => {
      const body = await readJson<{ count: number }>("/api/model-catalog", signal);
      return body.count;
    },
    staleTime: 5 * 60_000,
  });
}

export interface PostgresDatabaseFacts {
  database: string;
  reachable: boolean;
  error?: string;
  serverVersion?: string;
  extensions?: Array<{ name: string; version: string }>;
  databaseSizeBytes?: number;
  tables?: Array<{ name: string; estimatedRowCount: number; lastAnalyzedAt: string | null; totalSizeBytes: number | null }>;
  views?: string[];
  hypertables?: Array<{
    name: string;
    chunkCount: number;
    totalSizeBytes: number | null;
    approximateRowCount: number | null;
    earliestChunkStart: string | null;
    latestChunkEnd: string | null;
  }>;
  measuredAt: string;
  durationMilliseconds: number;
}

/** What the PostgreSQL server says it holds, per database. Read only while `enabled`. */
export function usePostgresFacts(enabled: boolean) {
  return useQuery({
    queryKey: ["stores", "postgres"],
    queryFn: ({ signal }) => readJson<{ databases: PostgresDatabaseFacts[] }>("/api/stores/postgres", signal),
    enabled,
    staleTime: 30_000,
  });
}

/** The pgAdmin supervisor's state. Polled only while `enabled`, faster until it is ready. */
export function usePgAdminStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["pgadmin", "status"],
    queryFn: ({ signal }) => readJson<PgAdminStatus>("/api/pgadmin/status", signal),
    enabled,
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === "ready" ? 15_000 : 2_500),
  });
}

/**
 * Restarts pgAdmin and resolves only once the supervisor reports `ready`, so the
 * success message means the frame can load. Gives up after 60 seconds.
 */
export function useRestartPgAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/pgadmin/restart", { method: "POST" });
      if (!response.ok) throw new Error(`the restart request answered ${response.status}`);
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const status = await readJson<PgAdminStatus>("/api/pgadmin/status");
        queryClient.setQueryData(["pgadmin", "status"], status);
        if (status.status === "ready") return status;
        if (status.status === "error") throw new Error(status.error ?? "pgAdmin reported an error while starting");
      }
      throw new Error("pgAdmin did not report ready within 60 seconds");
    },
  });
}

export interface QueryRun {
  source: "lake" | "sqlite";
  statement: string;
  rows: Array<Record<string, unknown>>;
  elapsedMilliseconds: number;
}

/**
 * Runs one read-only statement through the server's query route. The lake
 * answers with a bare array and SQLite with `{ rows }`; both come back as rows.
 */
export function useRunQuery() {
  return useMutation({
    mutationFn: async ({ source, statement }: { source: "lake" | "sqlite"; statement: string }): Promise<QueryRun> => {
      const started = performance.now();
      const response = await fetch("/api/databases/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // One trailing semicolon is dropped: the server appends its own row limit to SQLite text.
        body: JSON.stringify({ sql: statement.trim().replace(/;\s*$/, ""), source, limit: QUERY_ROW_LIMIT }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body && typeof body.error === "string" ? body.error : `${response.status} ${response.statusText}`);
      }
      const rows = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : [];
      return { source, statement, rows, elapsedMilliseconds: Math.round(performance.now() - started) };
    },
  });
}
