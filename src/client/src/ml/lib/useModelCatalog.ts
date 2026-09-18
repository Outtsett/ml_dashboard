/**
 * useModelCatalog — Data hooks for the Model Catalog page.
 *
 * SRP: one hook per data concern. Components call these hooks
 * and never touch fetch() directly (DIP).
 *
 * ISP: each hook returns only the data its consumer needs.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/infrastructure/api/query_client";
import { toast } from "sonner";
import type {
  CatalogStats,
  CatalogTaxonomy,
  CatalogListResponse,
  CatalogModelDetail,
} from "@/ml/lib/catalog_types";
import type { TrainableCatalogResponse } from "@shared/trainableModelTypes";
import type { CatalogLifecycleResponse } from "@shared/catalogLifecycle";

// Re-export trainable types so picker/composer consumers have one import surface.
export type {
  TrainableModel,
  TemplateId,
  RunnerSource,
  TrainableCatalogResponse,
} from "@shared/trainableModelTypes";

// ─── Query keys (mirror API paths per project convention) ───────────────────

const KEYS = {
  stats: ["/api/model-catalog/stats"] as const,
  taxonomy: ["/api/model-catalog/taxonomy"] as const,
  list: (qs: string) => ["/api/model-catalog", qs] as const,
  detail: (id: string) => ["/api/model-catalog", id] as const,
  trainable: ["/api/model-catalog/trainable"] as const,
  lifecycle: ["/api/model-catalog/lifecycle"] as const,
};

// ─── Stats (top-level badge counts) ─────────────────────────────────────────

export function useCatalogStats() {
  return useQuery<CatalogStats>({
    queryKey: KEYS.stats,
    staleTime: 5 * 60_000,
  });
}

// ─── Taxonomy (category → subcategory tree for sidebar) ─────────────────────

export function useCatalogTaxonomy() {
  return useQuery<CatalogTaxonomy>({
    queryKey: KEYS.taxonomy,
    staleTime: 5 * 60_000,
  });
}

// ─── Filtered model list ────────────────────────────────────────────────────

export interface CatalogFilterParams {
  category: string | null;
  subcategory: string | null;
  search: string;
}

function buildQueryString(filter: CatalogFilterParams): string {
  const params = new URLSearchParams();
  if (filter.category) params.set("category", filter.category);
  if (filter.subcategory) params.set("subcategory", filter.subcategory);
  if (filter.search.trim().length >= 2) params.set("search", filter.search.trim());
  params.set("includeEmpty", "true");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useCatalogList(filter: CatalogFilterParams) {
  const qs = buildQueryString(filter);
  return useQuery<CatalogListResponse>({
    queryKey: KEYS.list(qs),
    staleTime: 60_000,
  });
}

// ─── Single model detail ────────────────────────────────────────────────────

export function useCatalogDetail(id: string | null) {
  return useQuery<CatalogModelDetail>({
    queryKey: KEYS.detail(id ?? ""),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });
}

// ─── Trainable catalog (unified registry + catalog with runner metadata) ───
//
// Backed by `GET /api/model-catalog/trainable` (backend-lead W2.a).
// One round-trip replaces the legacy 2-query merge of `/api/training/config`
// + `/api/model-catalog`. Server now does the merge in `getTrainableModels()`
// (`src/server/lib/catalogBridge.ts`) so the client can render the 3-state
// picker badge directly off `entry.runnerSource` without local heuristics.
//
// Used by:
//   - W2.d ModelCatalogPicker        — primary consumer
//   - W4   ArchitectureComposer      — sub-pickers + `filter` prop
//   - W7   PromoteStage              — version-detail catalog lookups

export function useTrainableCatalog() {
  return useQuery<TrainableCatalogResponse>({
    queryKey: KEYS.trainable,
    staleTime: 5 * 60_000,
  });
}

// ─── Lifecycle (what has been DONE with each spec) ─────────────────────────
//
// Short stale time: this is the page you come back to after a run finishes,
// and a five-minute-old "0 completed" would be a lie by then.

export function useCatalogLifecycle() {
  return useQuery<CatalogLifecycleResponse>({
    queryKey: KEYS.lifecycle,
    staleTime: 15_000,
  });
}

// ─── Refresh (invalidate cache) ─────────────────────────────────────────────

export function useRefreshCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest("POST", "/api/model-catalog/refresh"),
    onSuccess: () => {
      toast.success("Catalog refreshed");
      // Invalidate all catalog queries so they refetch (`/api/model-catalog`
      // prefix covers list, detail, and trainable).
      qc.invalidateQueries({ queryKey: ["/api/model-catalog"] });
      qc.invalidateQueries({ queryKey: KEYS.stats });
      qc.invalidateQueries({ queryKey: KEYS.taxonomy });
      qc.invalidateQueries({ queryKey: KEYS.trainable });
      qc.invalidateQueries({ queryKey: KEYS.lifecycle });
    },
  });
}
