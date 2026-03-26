/**
 * useModelCatalog — Data hooks for the Model Catalog page.
 *
 * SRP: one hook per data concern. Components call these hooks
 * and never touch fetch() directly (DIP).
 *
 * ISP: each hook returns only the data its consumer needs.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query_client";
import { toast } from "sonner";
import type {
  CatalogStats,
  CatalogTaxonomy,
  CatalogListResponse,
  CatalogModelDetail,
} from "@/lib/catalog_types";

// ─── Query keys (mirror API paths per project convention) ───────────────────

const KEYS = {
  stats: ["/api/model-catalog/stats"] as const,
  taxonomy: ["/api/model-catalog/taxonomy"] as const,
  list: (qs: string) => ["/api/model-catalog", qs] as const,
  detail: (id: string) => ["/api/model-catalog", id] as const,
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

// ─── Refresh (invalidate cache) ─────────────────────────────────────────────

export function useRefreshCatalog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest("POST", "/api/model-catalog/refresh"),
    onSuccess: () => {
      toast.success("Catalog refreshed");
      // Invalidate all catalog queries so they refetch
      qc.invalidateQueries({ queryKey: ["/api/model-catalog"] });
      qc.invalidateQueries({ queryKey: KEYS.stats });
      qc.invalidateQueries({ queryKey: KEYS.taxonomy });
    },
  });
}
