/**
 * useModelHistory — Fetch quality score trajectory for degradation tracking.
 *
 * SRP: API data fetching only.
 * ISP: Returns only quality trajectory, not full session data.
 */

import { useQuery } from "@tanstack/react-query";

interface ModelHistoryEntry {
  id: number;
  versionedModelId: string;
  qualityScore: number | null;
  evaluationGrade: string | null;
  startedAt: number;
  elapsedSec: number | null;
}

export function useModelHistory(symbol: string | null, modelType: string | null) {
  return useQuery<{ sessions: ModelHistoryEntry[] }>({
    queryKey: ["modelHistory", symbol, modelType],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (symbol) params.set("symbol", symbol);
      if (modelType) params.set("modelType", modelType);
      const res = await fetch(`/api/training/history?${params}`);
      if (!res.ok) throw new Error("Failed to fetch model history");
      return res.json();
    },
    enabled: !!symbol && !!modelType,
    staleTime: 30_000,
  });
}
