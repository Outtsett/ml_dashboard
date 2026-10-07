/** The run page's reads and writes: all of them the run API (`apps/api/training/runs.router.ts`). */
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiRequest } from "@/infrastructure/api/query_client";
import type { CycleLogLine, CycleTrade } from "@shared/cycle/schema";
import type { RunListItem, RunnableModel, RunView, StartRunRequest, StartRunResponse } from "@shared/runs/types";

const LIST_POLL_MILLISECONDS = 3000;
const RUN_POLL_MILLISECONDS = 1000;
/** Lines kept in the page; the server's own buffer holds 5,000. */
const MAX_TERMINAL_LINES = 6000;

export interface PreflightCheck {
  name: "model" | "costs" | "bars" | "environment" | "disk" | "busy";
  ok: boolean;
  detail: string;
}
export interface Preflight {
  ready: boolean;
  checks: PreflightCheck[];
}

/** Everything a launch needs, checked for the form's current choice (`GET /api/runs/preflight`). */
export function usePreflight(request: { model: string; symbol: string; timeframe: string }) {
  const query = new URLSearchParams(request).toString();
  return useQuery<Preflight>({
    queryKey: ["/api/runs/preflight", query],
    queryFn: async ({ signal }) => {
      const response = await apiRequest("GET", `/api/runs/preflight?${query}`, undefined, signal);
      return (await response.json()) as Preflight;
    },
    enabled: request.model.trim().length > 0 && /^[A-Z][A-Z0-9_\-/]{0,19}$/.test(request.symbol),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

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
      toast.success(`Run ${response.name} started`);
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

// ─── the bars the run walked ──────────────────────────────────────────────

export interface RunBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  foldIndex: number | null;
  role: string;
  probabilityUp: number | null;
  position: number | null;
  equityUsd: number | null;
  correct: boolean | null;
}

export interface RunBarsPayload {
  status: string;
  bars: RunBar[];
  trades: CycleTrade[];
}

const BARS_POLL_MILLISECONDS = 3000;

/** The run's bars and trades, appended as a live run walks forward (each poll asks for bars after the last one held). */
export function useRunBars(runId: string | null, live: boolean) {
  const held = useRef<{ runId: string | null; bars: RunBar[] }>({ runId: null, bars: [] });
  return useQuery<RunBarsPayload>({
    queryKey: ["/api/runs", runId, "bars"],
    enabled: runId !== null,
    queryFn: async ({ signal }) => {
      if (held.current.runId !== runId) held.current = { runId, bars: [] };
      const last = held.current.bars[held.current.bars.length - 1];
      const after = last ? `?after=${last.time}` : "";
      const response = await apiRequest("GET", `/api/runs/${encodeURIComponent(runId!)}/bars${after}`, undefined, signal);
      const payload = (await response.json()) as RunBarsPayload;
      held.current.bars = last ? [...held.current.bars, ...payload.bars] : payload.bars;
      return { ...payload, bars: held.current.bars };
    },
    refetchInterval: live ? BARS_POLL_MILLISECONDS : false,
    refetchIntervalInBackground: true,
    staleTime: Infinity,
    retry: false,
  });
}
