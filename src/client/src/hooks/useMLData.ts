/**
 * Shared ML data hooks — single source for model, trade, and training queries.
 *
 * SRP: Each hook fetches one data concern.
 * DIP: Uses apiService abstraction, never raw fetch().
 */

import { useQuery } from '@tanstack/react-query';
import { mlApi } from '@/lib/apiService';
import { QUERY_KEYS } from '@/lib/types';
import type { MlModel, Trade, SavedModel } from '@/lib/types';

// ── Models ───────────────────────────────────────────────────────────────────

export function useMLModels() {
  return useQuery<MlModel[]>({
    queryKey: [...QUERY_KEYS.mlModels],
    queryFn: () => mlApi.getModels() as Promise<MlModel[]>,
  });
}

// ── Saved Models ─────────────────────────────────────────────────────────────

interface SavedModelsResponse {
  models: SavedModel[];
}

export function useSavedModels() {
  const query = useQuery<SavedModelsResponse>({
    queryKey: [...QUERY_KEYS.mlSavedModels],
    queryFn: () => mlApi.getSavedModels() as Promise<SavedModelsResponse>,
  });
  return {
    ...query,
    savedModels: query.data?.models ?? [],
  };
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

// ── Training Status ──────────────────────────────────────────────────────────

interface TrainingStatusResponse {
  active: boolean;
  [key: string]: unknown;
}

export function useTrainStatus(refetchInterval = 5000) {
  return useQuery<TrainingStatusResponse | null>({
    queryKey: [...QUERY_KEYS.mlTrainStatus],
    queryFn: async () => {
      const res = await fetch('/api/ml/train/status');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval,
  });
}

// ── Feature Info ─────────────────────────────────────────────────────────────

export function useMLFeatures() {
  return useQuery({
    queryKey: [...QUERY_KEYS.mlFeatures],
    queryFn: async () => {
      const res = await fetch('/api/ml/universal/features');
      if (!res.ok) return null;
      return res.json();
    },
  });
}
