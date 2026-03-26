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
import { mlApi } from '@/lib/api_service';
import { QUERY_KEYS } from '@/lib/types';
import type { MlModel, Trade } from '@/lib/types';

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
    queryFn: async () => {
      const res = await fetch(`/api/ml/trades?limit=${limit}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });
}
