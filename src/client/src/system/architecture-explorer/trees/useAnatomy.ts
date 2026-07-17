/**
 * useAnatomy — TanStack Query hooks over the /api/anatomy endpoints.
 *
 * The backend is contract-first (see types.ts): these hooks consume the
 * payload shapes verbatim and degrade gracefully — a 404 resolves to null
 * (per-model endpoints) or an empty list (models index) instead of an error,
 * so the page renders its dashed placeholders while the server side is still
 * being wired.
 */

import { useQuery } from "@tanstack/react-query";
import type {
  AnatomyModelMeta,
  AnatomyModelsResponse,
  ForestSummary,
  ModelTreesResponse,
} from "./types";

const STALE_MS = 5 * 60_000;

async function fetchJson<T>(url: string, signal: AbortSignal | undefined): Promise<T | null> {
  const res = await fetch(url, { signal, credentials: "include" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

/** GET /api/anatomy/models — dumpable model artifacts under data/models. */
export function useAnatomyModels() {
  return useQuery<AnatomyModelMeta[]>({
    queryKey: ["anatomy-models"],
    queryFn: async ({ signal }) => {
      const body = await fetchJson<AnatomyModelsResponse>("/api/anatomy/models", signal);
      // 404 (route not shipped yet) folds into the same empty state the
      // contract's `{ models: [] }` produces.
      return body?.models ?? [];
    },
    staleTime: STALE_MS,
  });
}

/**
 * GET /api/anatomy/trees/:modelId?start=&count= — a window of raw xgboost
 * dump trees. `null` result = model unknown (404). Disabled until a modelId
 * is selected.
 */
export function useModelTrees(
  modelId: string | null | undefined,
  start = 0,
  count = 4,
) {
  return useQuery<ModelTreesResponse | null>({
    queryKey: ["anatomy-trees", modelId ?? "", start, count],
    enabled: !!modelId,
    queryFn: async ({ signal }) => {
      const url = `/api/anatomy/trees/${encodeURIComponent(modelId ?? "")}?start=${start}&count=${count}`;
      return fetchJson<ModelTreesResponse>(url, signal);
    },
    staleTime: STALE_MS,
  });
}

/**
 * GET /api/anatomy/forest/:modelId — whole-ensemble rollup (feature usage,
 * depth histogram, leaf-value distribution). `null` result = model unknown.
 */
export function useForestSummary(modelId: string | null | undefined) {
  return useQuery<ForestSummary | null>({
    queryKey: ["anatomy-forest", modelId ?? ""],
    enabled: !!modelId,
    queryFn: async ({ signal }) => {
      const url = `/api/anatomy/forest/${encodeURIComponent(modelId ?? "")}`;
      return fetchJson<ForestSummary>(url, signal);
    },
    staleTime: STALE_MS,
  });
}
