/**
 * useTrainingConfig — Fetches the model/feature/timeframe registry from the server.
 *
 * Think of it as: the catalog of available training programs. Tells you what
 * model types exist, what features they support, and what timeframes are valid.
 *
 * As of 2026-05-09, the response also carries the decomposed
 * `algorithms` / `tasks` / `runners` triple that drives the Train-stage's two-picker UI
 * (Algorithm + Task). The pre-existing `models` map (composite-keyed) is retained
 * so existing single-select consumers keep working.
 */

import { useQuery } from "@tanstack/react-query";
import { trainingApi } from "@/infrastructure/api/api_service";
import { QUERY_KEYS } from "@/shared/utils/types";
import type {
  AlgorithmEntry,
  ModelRegistryEntry,
  RunnerEntry,
  TaskEntry,
} from "@shared/trainingTypes";

export interface TrainingConfigResponse {
  /** Composite-keyed runtime registry (e.g. "xgboost+direction_classifier" → entry). */
  models: Record<string, ModelRegistryEntry>;
  /** Algorithm metadata (architecture only). Empty when running on legacy models.json fallback. */
  algorithms: Record<string, AlgorithmEntry>;
  /** Task metadata (head + label-strategy compatibility). Empty on fallback. */
  tasks: Record<string, TaskEntry>;
  /** (algorithm × task) → runner wiring. Empty on fallback. */
  runners: Record<string, RunnerEntry>;
  /** Legacy modelType key → composite key map (for hydrating cached UI state). */
  aliases: Record<string, string>;
  features: Record<string, Record<string, unknown>>;
  timeframes: Record<string, number>;
}

export function useTrainingConfig() {
  return useQuery<TrainingConfigResponse>({
    queryKey: [...QUERY_KEYS.trainingConfig],
    queryFn: () => trainingApi.getConfig() as Promise<TrainingConfigResponse>,
    staleTime: 300_000, // 5 min
  });
}
