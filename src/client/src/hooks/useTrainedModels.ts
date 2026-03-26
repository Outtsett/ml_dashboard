/**
 * useTrainedModels — Fetch and organize trained models for the ModelBrowser.
 *
 * Groups models by model type → instrument → checkpoints.
 * Provides filtering, sorting, and comparison helpers.
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query_client";
import { toast } from "sonner";

export interface TrainedModel {
  id: string;
  modelType: string;
  symbol: string;
  timeframe: string;
  n_regimes: number;
  n_bars: number;
  n_bars_total: number;
  n_bars_train_val: number;
  n_bars_test: number;
  quality_score: number;
  evaluation_grade: string;
  date_range: { start: string; end: string } | null;
  training_config: Record<string, unknown>;
  training_time_sec: number;
  trained_at: string;
}

export interface ModelGroup {
  modelType: string;
  instruments: InstrumentGroup[];
  totalModels: number;
  bestGrade: string;
}

export interface InstrumentGroup {
  symbol: string;
  timeframe: string;
  /** Unique key: "EURUSD_1h" */
  key: string;
  models: TrainedModel[];
  bestModel: TrainedModel | null;
}

const GRADE_ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "N/A"];

function gradeRank(grade: string): number {
  const idx = GRADE_ORDER.indexOf(grade);
  return idx >= 0 ? idx : GRADE_ORDER.length;
}

function bestGradeOf(models: TrainedModel[]): string {
  let best = "N/A";
  let bestRank = GRADE_ORDER.length;
  for (const m of models) {
    const r = gradeRank(m.evaluation_grade);
    if (r < bestRank) {
      bestRank = r;
      best = m.evaluation_grade;
    }
  }
  return best;
}

export function useTrainedModels() {
  const { data: models, isLoading, error } = useQuery<TrainedModel[]>({
    queryKey: ["/api/training/models"],
    staleTime: 30_000,
  });

  const grouped = useMemo((): ModelGroup[] => {
    if (!models?.length) return [];

    // Group: modelType → symbol_timeframe → models[]
    const byType = new Map<string, Map<string, TrainedModel[]>>();

    for (const m of models) {
      if (!byType.has(m.modelType)) byType.set(m.modelType, new Map());
      const typeMap = byType.get(m.modelType)!;
      const key = `${m.symbol}_${m.timeframe}`;
      if (!typeMap.has(key)) typeMap.set(key, []);
      typeMap.get(key)!.push(m);
    }

    const result: ModelGroup[] = [];

    for (const [modelType, instrumentMap] of byType) {
      const instruments: InstrumentGroup[] = [];
      let totalModels = 0;

      for (const [key, checkpoints] of instrumentMap) {
        // Sort by trained_at descending (newest first)
        checkpoints.sort((a, b) => (b.trained_at || "").localeCompare(a.trained_at || ""));
        totalModels += checkpoints.length;

        // Best = highest quality score
        const bestModel = checkpoints.reduce((best, m) =>
          m.quality_score > (best?.quality_score ?? -1) ? m : best,
          null as TrainedModel | null,
        );

        const [symbol, timeframe] = key.split("_");
        instruments.push({
          symbol: symbol!,
          timeframe: timeframe!,
          key,
          models: checkpoints,
          bestModel,
        });
      }

      // Sort instruments alphabetically
      instruments.sort((a, b) => a.key.localeCompare(b.key));

      const allModels = instruments.flatMap(i => i.models);
      result.push({
        modelType,
        instruments,
        totalModels,
        bestGrade: bestGradeOf(allModels),
      });
    }

    // Sort model types alphabetically
    result.sort((a, b) => a.modelType.localeCompare(b.modelType));
    return result;
  }, [models]);

  return { models: models ?? [], grouped, isLoading, error };
}

export function useDeleteModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => apiRequest("DELETE", `/api/training/models/${encodeURIComponent(modelId)}`),
    onSuccess: () => {
      toast.success("Model deleted");
      qc.invalidateQueries({ queryKey: ["/api/training/models"] });
    },
  });
}
