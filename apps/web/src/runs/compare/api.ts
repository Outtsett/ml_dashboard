/**
 * The Analytics tab's data: several runs' views at once, and the saved
 * comparisons on disk (`/api/runs/comparisons`).
 */
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiRequest } from "@/infrastructure/api/query_client";
import type { RunView } from "@shared/runs/types";

const RUN_POLL_MILLISECONDS = 3_000;

/** One view per chosen run, polled while any of them runs. The terminal lines are not fetched (`logAt=0` gives only the tail). */
export function useRunViews(runIds: readonly string[]) {
  return useQueries({
    queries: runIds.map((runId) => ({
      queryKey: ["/api/runs", runId, "compare"],
      queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<RunView> => {
        const response = await apiRequest("GET", `/api/runs/${encodeURIComponent(runId)}?logAt=0`, undefined, signal);
        const view = (await response.json()) as RunView;
        return { ...view, logs: [] as RunView["logs"] };
      },
      refetchInterval: (query: { state: { data?: RunView } }) => (query.state.data?.status === "running" ? RUN_POLL_MILLISECONDS : false),
      refetchIntervalInBackground: true,
      staleTime: 60_000,
      retry: false,
    })),
  });
}

export interface SavedComparison {
  id: string;
  name: string;
  runIds: string[];
  savedAt: number;
}

export function useComparisons() {
  return useQuery<SavedComparison[]>({
    queryKey: ["/api/runs/comparisons"],
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", "/api/runs/comparisons", undefined, signal);
      return ((await response.json()) as { comparisons: SavedComparison[] }).comparisons;
    },
    staleTime: 30_000,
  });
}

export function useSaveComparison() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; runIds: string[] }) => {
      const response = await apiRequest("POST", "/api/runs/comparisons", body);
      return (await response.json()) as SavedComparison;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/runs/comparisons"] });
    },
  });
}

export function useDeleteComparison() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/runs/comparisons/${encodeURIComponent(id)}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/runs/comparisons"] });
    },
  });
}
