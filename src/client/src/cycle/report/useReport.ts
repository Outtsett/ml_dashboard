/**
 * The open run's in-depth metric tables: `GET /api/training/cycle/:modelId/metrics`.
 *
 * The tables land with the run's record at every fold end, so a live run is
 * re-read every 15 s and whenever a fold's scoreboard arrives; a finished run is
 * read once. A run with no tables in the lake yet answers 404, which reads as
 * `null` (the panel says the tables arrive with the first finished fold).
 */
import { useQuery } from "@tanstack/react-query";

import { cycleReportSchema, type CycleReport } from "@shared/cycle/report";

export const LIVE_REFETCH_MILLISECONDS = 15_000;

export async function fetchCycleReport(modelId: string, signal?: AbortSignal): Promise<CycleReport | null> {
  const response = await fetch(`/api/training/cycle/${encodeURIComponent(modelId)}/metrics`, { credentials: "include", signal });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status}: ${body || response.statusText}`);
  }
  return cycleReportSchema.parse(await response.json());
}

export function useCycleReport(modelId: string | null, revision: string, live: boolean) {
  return useQuery({
    queryKey: ["cycle-report", modelId, revision],
    queryFn: ({ signal }) => fetchCycleReport(modelId as string, signal),
    enabled: modelId !== null,
    refetchInterval: live ? LIVE_REFETCH_MILLISECONDS : false,
    staleTime: live ? 0 : Number.POSITIVE_INFINITY,
    retry: 1,
  });
}
