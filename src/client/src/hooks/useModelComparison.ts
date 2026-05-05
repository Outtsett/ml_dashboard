/**
 * useModelComparison — Manages model selection state and builds metric snapshots.
 *
 * Think of it as: a control panel where you flip model switches on/off,
 * and it automatically fetches and normalizes each model's diagnostics
 * so the metrics panels have clean side-by-side data.
 *
 * SRP: Selection state + snapshot building. No rendering.
 * ISP: Exposes only what comparison UI needs (toggle, snapshots, loading).
 */

import { useCallback, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/types';
import type { Diagnostics, RegimeModel } from '@/components/training/types';
import { buildMetricSnapshot, type MetricSnapshot } from '@/lib/metric_extractors';
import { resolveMetricsConfig } from '@shared/categoryMetrics';

const MAX_SELECTIONS = 4;

export interface UseModelComparisonReturn {
  /** IDs of currently toggled-on models */
  selectedIds: Set<string>;
  /** Toggle a model on/off */
  toggle: (modelId: string) => void;
  /** Clear all selections */
  clearAll: () => void;
  /** Max number of simultaneous selections */
  maxSelections: number;
  /** Built metric snapshots (one per toggled model with loaded diagnostics) */
  snapshots: MetricSnapshot[];
  /** True if any diagnostics query is in-flight */
  isLoading: boolean;
  /** The resolved category metrics key for current model type */
  categoryKey: string | null;
}

export function useModelComparison(
  models: RegimeModel[],
  modelCategory = 'unsupervised',
  modelSubcategory?: string,
): UseModelComparisonReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((modelId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) {
        next.delete(modelId);
      } else if (next.size < MAX_SELECTIONS) {
        next.add(modelId);
      }
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setSelectedIds(new Set()), []);

  // Determine category metrics key
  const metricsConfig = resolveMetricsConfig(modelCategory, modelSubcategory);
  const categoryKey = metricsConfig?.id ?? null;

  // Build an array of selected model IDs for stable query keys
  const selectedArray = useMemo(
    () => Array.from(selectedIds).filter((id) => models.some((m) => m.id === id)),
    [selectedIds, models],
  );

  // Fetch diagnostics for each selected model in parallel
  const diagnosticsQueries = useQueries({
    queries: selectedArray.map((modelId) => ({
      queryKey: [...QUERY_KEYS.regimeDiagnostics(modelId)],
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Diagnostics> => {
        const res = await fetch(`/api/training/models/${modelId}/diagnostics`, { signal });
        if (!res.ok) throw new Error(`Failed to load diagnostics for ${modelId}`);
        return res.json();
      },
      staleTime: 5 * 60 * 1000,
      enabled: true,
    })),
  });

  const isLoading = diagnosticsQueries.some((q) => q.isLoading);

  // Build MetricSnapshots from loaded diagnostics
  const snapshots = useMemo(() => {
    const results: MetricSnapshot[] = [];
    for (let i = 0; i < selectedArray.length; i++) {
      const modelId = selectedArray[i]!;
      const query = diagnosticsQueries[i];
      if (!query?.data) continue;

      const model = models.find((m) => m.id === modelId);
      if (!model) continue;

      const label = `${model.symbol} ${model.timeframe}`;
      const snap = buildMetricSnapshot(
        modelId,
        label,
        categoryKey ?? 'clustering',
        query.data,
      );
      results.push(snap);
    }
    return results;
  }, [selectedArray, diagnosticsQueries, models, categoryKey]);

  return {
    selectedIds,
    toggle,
    clearAll,
    maxSelections: MAX_SELECTIONS,
    snapshots,
    isLoading,
    categoryKey,
  };
}
