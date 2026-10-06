/** The run page's reads and writes: all of them the run API (`apps/api/training/runs.router.ts`). */
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiRequest } from "@/infrastructure/api/query_client";
import type { CycleLogLine } from "@shared/cycle/schema";
import type { RunListItem, RunnableModel, RunView, StartRunRequest, StartRunResponse } from "@shared/runs/types";

const LIST_POLL_MILLISECONDS = 3000;
const RUN_POLL_MILLISECONDS = 1000;
/** Lines kept in the page; the server's own buffer holds 5,000. */
const MAX_TERMINAL_LINES = 6000;

export function useRunnableModels() {
  return useQuery<RunnableModel[]>({
    queryKey: ["/api/runs/models"],
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", "/api/runs/models", undefined, signal);
      return ((await response.json()) as { models: RunnableModel[] }).models;
    },
    staleTime: 5 * 60_000,
  });
}

/** Polled, so a run launched from anywhere (this page, a Claude session, curl) shows up on its own. */
export function useRunList() {
  return useQuery<RunListItem[]>({
    queryKey: ["/api/runs"],
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", "/api/runs", undefined, signal);
      return ((await response.json()) as { runs: RunListItem[] }).runs;
    },
    refetchInterval: LIST_POLL_MILLISECONDS,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

/**
 * One run's view, polled every second while it runs and read once when it is
 * over. Each poll sends the last terminal line this page holds and gets back
 * only the lines after it.
 */
export function useRun(runId: string | null) {
  const terminal = useRef<{ runId: string | null; lines: CycleLogLine[] }>({ runId: null, lines: [] });
  return useQuery<RunView>({
    queryKey: ["/api/runs", runId],
    enabled: runId !== null,
    queryFn: async ({ signal }) => {
      if (terminal.current.runId !== runId) terminal.current = { runId, lines: [] };
      const last = terminal.current.lines[terminal.current.lines.length - 1];
      const cursor = last ? `?logAt=${last.receivedAt}&logSeq=${last.seq ?? ""}` : "";
      const response = await apiRequest("GET", `/api/runs/${encodeURIComponent(runId!)}${cursor}`, undefined, signal);
      const view = (await response.json()) as RunView;
      const lines = view.logsReset ? view.logs : [...terminal.current.lines, ...view.logs];
      terminal.current.lines = lines.length > MAX_TERMINAL_LINES ? lines.slice(-MAX_TERMINAL_LINES) : lines;
      return { ...view, logs: terminal.current.lines };
    },
    refetchInterval: (query) => (query.state.data?.status === "running" ? RUN_POLL_MILLISECONDS : false),
    refetchIntervalInBackground: true,
    staleTime: Infinity,
    retry: false,
  });
}

export function useStartRun(onStarted: (response: StartRunResponse) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: StartRunRequest) => {
      const response = await apiRequest("POST", "/api/runs", request);
      return (await response.json()) as StartRunResponse;
    },
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/runs"], exact: true });
      onStarted(response);
    },
    onError: (error) => {
      toast.error("The run did not start", { description: error instanceof Error ? error.message : String(error) });
    },
  });
}

export function useStopRun() {
  return useMutation({
    mutationFn: async (runId: string) => {
      await apiRequest("POST", `/api/runs/${encodeURIComponent(runId)}/stop`);
    },
    onError: (error) => {
      toast.error("The run did not stop", { description: error instanceof Error ? error.message : String(error) });
    },
  });
}
