/** Data hooks for the notebook tab — one hook per concern, every fetch with the
 *  query's AbortSignal, every mutation with an error toast. */

import { useIsMutating, useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/shared/hooks/use-toast";
import type { CatalogResponse, LineageDataset, NotebookEntry, SearchResponse } from "./types";

export const NOTEBOOKS_KEY = ["marimo", "notebooks"] as const;
/** Every group start shares this key, so the page can see which starts are in flight. */
const START_KEY = ["marimo", "start"] as const;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof parsed?.error === "string" ? parsed.error : `${response.status} ${response.statusText}`);
  return parsed as T;
}

/** The catalog, polled quickly while a start request is in flight or a group
 *  is starting or a health check is queued or running, slowly while any group
 *  is running (memory and idle time move), and not at all otherwise. A start
 *  request counts from the click: the server may still say "stopped" while it
 *  probes the port, and polling only on "starting" would miss the whole start. */
export function useNotebookCatalog() {
  const startsInFlight = useIsMutating({ mutationKey: START_KEY });
  return useQuery({
    queryKey: NOTEBOOKS_KEY,
    queryFn: ({ signal }) => getJson<CatalogResponse>("/api/marimo/notebooks", signal),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (startsInFlight > 0) return 1_000;
      if (!data) return false;
      if (data.groups.some((g) => g.status === "starting")) return 1_000;
      if (data.healthQueue.queued + data.healthQueue.running > 0) return 2_000;
      if (data.groups.some((g) => g.status === "ready")) return 15_000;
      return false;
    },
    // Keep polling while the page is in a background tab, so a start or a long
    // health check that finishes meanwhile is shown when you come back — the fast
    // intervals above apply only while something is in flight.
    refetchIntervalInBackground: true,
  });
}

export function useNotebookSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["marimo", "search", trimmed],
    queryFn: ({ signal }) => getJson<SearchResponse>(`/api/marimo/search?q=${encodeURIComponent(trimmed)}`, signal),
    enabled: trimmed.length >= 2,
    staleTime: 15_000,
  });
}

export function useNotebookLineage() {
  return useQuery({
    queryKey: ["marimo", "lineage"],
    queryFn: ({ signal }) => getJson<{ datasets: LineageDataset[] }>("/api/marimo/lineage", signal),
    staleTime: 60_000,
  });
}

function useCatalogMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  failureTitle: string,
  onSuccess?: (result: TResult, variables: TVariables) => void,
) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (result, variables) => {
      onSuccess?.(result, variables);
      queryClient.invalidateQueries({ queryKey: ["marimo"] });
    },
    onError: (error: Error) => toast({ title: failureTitle, description: error.message, variant: "destructive" }),
  });
}

/** Starts a group. Each call is its own mutation under START_KEY, so starting a
 *  second group while the first is still starting is never skipped. */
export function useStartGroup() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: START_KEY,
    // wait=0: the server answers at once and the list shows the start's progress;
    // a request held open for the whole start would occupy one of the browser's
    // six connections to this host for up to a minute.
    mutationFn: (slug: string) => postJson<{ status: string; url: string }>(`/api/marimo/groups/${slug}/start?wait=0`).then(() => slug),
    onError: (error: Error) => toast({ title: "Could not start the notebook environment", description: error.message, variant: "destructive" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTEBOOKS_KEY }),
  });
}

/** Slugs of the groups a start request is in flight for. */
export function usePendingStarts(): string[] {
  return useMutationState({
    filters: { mutationKey: START_KEY, status: "pending" },
    select: (mutation) => mutation.state.variables as string,
  });
}

/** Rescan: asks the server to walk the notebook folders now (?refresh=1) rather
 *  than serve its catalog of up to 15 seconds ago. */
export function useRescan() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: () => getJson<CatalogResponse>("/api/marimo/notebooks?refresh=1"),
    onSuccess: (data) => queryClient.setQueryData(NOTEBOOKS_KEY, data),
    onError: (error: Error) => toast({ title: "Rescan failed", description: error.message, variant: "destructive" }),
  });
}

export function useStopGroup() {
  return useCatalogMutation((slug: string) => postJson<{ status: string }>(`/api/marimo/groups/${slug}/stop`), "Could not stop the environment");
}

export function useOpenEditor(onReady?: (notebook: NotebookEntry) => void) {
  return useCatalogMutation(
    (notebook: NotebookEntry) => postJson<{ url: string }>("/api/marimo/editor", { path: notebook.path }).then(() => notebook),
    "Could not open the editor",
    (notebook) => onReady?.(notebook),
  );
}

export function useTogglePin() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (variables: { path: string; pinned: boolean }) => postJson<{ pinnedPaths: string[] }>("/api/marimo/pins", variables),
    // Optimistic: the star flips at once and rolls back if the server refuses.
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: NOTEBOOKS_KEY });
      const previous = queryClient.getQueryData<CatalogResponse>(NOTEBOOKS_KEY);
      if (previous) {
        queryClient.setQueryData<CatalogResponse>(NOTEBOOKS_KEY, {
          ...previous,
          notebooks: previous.notebooks.map((n) => (n.path === variables.path ? { ...n, pinned: variables.pinned } : n)),
        });
      }
      return { previous };
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(NOTEBOOKS_KEY, context.previous);
      toast({ title: "Could not change the pin", description: error.message, variant: "destructive" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTEBOOKS_KEY }),
  });
}

export function useHealthCheck() {
  return useCatalogMutation((paths: string[]) => postJson<{ queued: number }>("/api/marimo/health/check", { paths }), "Could not queue the health check");
}

export function useCancelHealthChecks() {
  return useCatalogMutation((_: void) => postJson<{ cancelled: number }>("/api/marimo/health/cancel"), "Could not cancel the health checks");
}

export interface NewNotebookRequest {
  rootPath: string;
  fileName: string;
  title: string;
  description: string;
}

export function useCreateNotebook(onCreated?: (result: { path: string; id: string }) => void) {
  return useCatalogMutation(
    (request: NewNotebookRequest) => postJson<{ path: string; id: string }>("/api/marimo/notebooks/new", request),
    "Could not create the notebook",
    (result) => onCreated?.(result),
  );
}
