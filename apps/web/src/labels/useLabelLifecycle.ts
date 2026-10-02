/**
 * Data hooks for the label catalog: the lifecycle of every set, the suite, and
 * the actions a person takes on a set. One hook per concern (SRP); components
 * render what these return and never fetch themselves (DIP).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LabelLifecycleResponse, LabelValidationReport } from "@shared/labels/contract";

export interface LabelSetRecord {
  id: number;
  name: string;
  generatorType: string;
  category: string;
  symbol: string;
  timeframeMinutes: number;
  config: string;
  sampleCount: number;
  labelDistribution: string | null;
  status: string;
  stage: string;
  recipe: string | null;
  parquetPath: string | null;
  validation: string | null;
  maxHorizonBars: number | null;
  purgeBars: number | null;
  embargoBars: number | null;
  errorMessage: string | null;
  generationTimeMs: number | null;
  createdAt: string;
  updatedAt: string;
  landedAt: string | null;
  retiredAt: string | null;
  staleReason: string | null;
}

export interface SuiteEntry {
  name: string;
  generatorType: string;
  symbol: string;
  timeframeMinutes: number;
  params: Record<string, unknown>;
}

export interface SuiteResponse {
  entries: SuiteEntry[];
  state: {
    running: boolean;
    startedAt: number | null;
    finishedAt: number | null;
    total: number;
    completed: number;
    current: string | null;
    results: Array<{ entry: SuiteEntry; result: { labelSetId?: number; stage?: string; sampleCount?: number; error?: string }; milliseconds: number }>;
  };
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(json.error ?? `${url} → ${response.status}`);
  return json;
}

export const LABEL_QUERY_KEYS = {
  lifecycle: ["/api/labels/lifecycle"] as const,
  sets: ["/api/labels", "catalog"] as const,
  suite: ["/api/labels/suite"] as const,
};

/** Where every set stands. Refreshes every 15 s while a job or the suite is running. */
export function useLabelLifecycle(live: boolean) {
  return useQuery<LabelLifecycleResponse>({
    queryKey: LABEL_QUERY_KEYS.lifecycle,
    queryFn: ({ signal }) => getJson("/api/labels/lifecycle", signal),
    staleTime: 10_000,
    refetchInterval: live ? 15_000 : false,
  });
}

export function useLabelSets(live: boolean) {
  return useQuery<LabelSetRecord[]>({
    queryKey: LABEL_QUERY_KEYS.sets,
    queryFn: ({ signal }) => getJson("/api/labels?limit=500", signal),
    staleTime: 10_000,
    refetchInterval: live ? 15_000 : false,
  });
}

export function useLabelSuite(live: boolean) {
  return useQuery<SuiteResponse>({
    queryKey: LABEL_QUERY_KEYS.suite,
    queryFn: ({ signal }) => getJson("/api/labels/suite", signal),
    staleTime: 5_000,
    refetchInterval: live ? 10_000 : false,
  });
}

export function parseValidation(text: string | null): LabelValidationReport | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as LabelValidationReport;
  } catch {
    return null;
  }
}

export function useLabelActions() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: LABEL_QUERY_KEYS.lifecycle });
    void queryClient.invalidateQueries({ queryKey: LABEL_QUERY_KEYS.sets });
    void queryClient.invalidateQueries({ queryKey: LABEL_QUERY_KEYS.suite });
  };

  const runSuite = useMutation({
    mutationFn: (body: { force?: boolean; symbol?: string; timeframeMinutes?: number; generatorType?: string }) =>
      postJson<{ accepted: boolean }>("/api/labels/suite", body),
    onSuccess: invalidate,
  });

  const regenerate = useMutation({
    mutationFn: (labelSetId: number) => postJson<{ labelSetId: number }>(`/api/labels/${labelSetId}/regenerate`),
    onSuccess: invalidate,
  });

  const retire = useMutation({
    mutationFn: ({ labelSetId, reason }: { labelSetId: number; reason?: string }) =>
      postJson<{ success: boolean }>(`/api/labels/${labelSetId}/retire`, { reason }),
    onSuccess: invalidate,
  });

  const generate = useMutation({
    mutationFn: (body: {
      name: string;
      generatorType: string;
      symbol: string;
      params: Record<string, unknown>;
      timeframeMinutes: number;
      startTimestamp?: number;
      endTimestamp?: number;
      force?: boolean;
    }) => postJson<{ labelSetId: number; recipe?: string; stage?: string; existing?: boolean }>("/api/labels/generate", body),
    onSuccess: invalidate,
  });

  return { runSuite, regenerate, retire, generate, invalidate };
}
