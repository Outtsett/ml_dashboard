/** Reads of the metric registry and of each model's own metrics record (`apps/api/ml/modelMetrics.router.ts`). */
import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@/infrastructure/api/query_client";
import type { MetricRegistry, SpecificationMetrics } from "@shared/cycle/metrics";

const REGISTRY_STALE_MILLISECONDS = 10 * 60_000;

/** A 404 means "this model carries no record", which the panel says in words; anything else is an error. */
async function recordOrNull<T>(url: string, signal: AbortSignal): Promise<T | null> {
  try {
    const response = await apiRequest("GET", url, undefined, signal);
    return (await response.json()) as T;
  } catch (error) {
    if ((error as Error).message.startsWith("404")) return null;
    throw error;
  }
}

/** Metric types, every metric with its definition, the objectives and the evaluation profiles. */
export function useMetricRegistry() {
  return useQuery<MetricRegistry>({
    queryKey: ["/api/model-metrics/registry"],
    queryFn: async ({ signal }) => (await (await apiRequest("GET", "/api/model-metrics/registry", undefined, signal)).json()) as MetricRegistry,
    staleTime: REGISTRY_STALE_MILLISECONDS,
  });
}

export interface ModelMetricsResponse {
  key: string;
  displayName: string;
  kind: string;
  catalogSpecId: string | null;
  record: SpecificationMetrics;
}

/** A runnable model's record, by registry key or runner key. */
export function useModelMetrics(modelKey: string | null) {
  return useQuery<ModelMetricsResponse | null>({
    queryKey: ["/api/model-metrics/models", modelKey],
    queryFn: ({ signal }) => recordOrNull<ModelMetricsResponse>(`/api/model-metrics/models/${encodeURIComponent(modelKey ?? "")}`, signal),
    enabled: modelKey !== null && modelKey !== "",
    staleTime: REGISTRY_STALE_MILLISECONDS,
  });
}

export interface SpecificationMetricsResponse {
  id: string;
  name: string;
  record: SpecificationMetrics;
}

/** A catalog specification's record, by spec id. */
export function useSpecificationMetrics(specificationId: string | null) {
  return useQuery<SpecificationMetricsResponse | null>({
    queryKey: ["/api/model-metrics/specifications", specificationId],
    queryFn: ({ signal }) => recordOrNull<SpecificationMetricsResponse>(`/api/model-metrics/specifications/${encodeURIComponent(specificationId ?? "")}`, signal),
    enabled: specificationId !== null && specificationId !== "",
    staleTime: REGISTRY_STALE_MILLISECONDS,
  });
}
