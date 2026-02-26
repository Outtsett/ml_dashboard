/**
 * useTrainingConfig — Fetches the model/feature/timeframe registry from the server.
 *
 * Think of it as: the catalog of available training programs. Tells you what
 * model types exist, what features they support, and what timeframes are valid.
 */

import { useQuery } from "@tanstack/react-query";
import { trainingApi } from "@/lib/apiService";
import type { ModelRegistryEntry } from "@shared/trainingTypes";

export interface TrainingConfigResponse {
  models: Record<string, ModelRegistryEntry>;
  features: Record<string, Record<string, unknown>>;
  timeframes: Record<string, number>;
}

export function useTrainingConfig() {
  return useQuery<TrainingConfigResponse>({
    queryKey: ["training", "config"],
    queryFn: () => trainingApi.getConfig(),
    staleTime: 300_000, // 5 min
  });
}
