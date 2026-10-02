/**
 * Shared ML data hooks — single source for model and trade queries.
 *
 * SRP: Each hook fetches one data concern.
 * DIP: Uses apiService abstraction, never raw fetch().
 *
 * NOTE: Training status and saved models are handled by useRegimeData.ts hooks
 * (useRegimeModels, useRegimeTrainStatus) which hit /api/training/* endpoints.
 */

import { useQuery } from '@tanstack/react-query';
import { mlApi } from "@/infrastructure/api/api_service";
import { QUERY_KEYS } from "@/shared/utils/types";
import type { MlModel, Trade } from "@/shared/utils/types";

// ── Models ───────────────────────────────────────────────────────────────────

export function useMLModels() {
  return useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: () => mlApi.getModels() as Promise<MlModel[]>,
  });
}

// ── Trades ───────────────────────────────────────────────────────────────────

export function useMLTrades(limit = 50) {
  return useQuery<Trade[]>({
    queryKey: [...QUERY_KEYS.mlTrades],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/ml/trades?limit=${limit}`, { signal });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });
}
