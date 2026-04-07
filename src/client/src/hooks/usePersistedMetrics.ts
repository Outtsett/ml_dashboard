/**
 * usePersistedMetrics — Fetch per-iteration convergence data from SQLite.
 *
 * SRP: API data fetching only. Separate from live SSE metrics (useTrainingMetrics).
 * ISP: Returns metric rows + names — nothing more.
 */

import { useQuery } from "@tanstack/react-query";

interface TrainingMetricRow {
  id: number;
  sessionId: number;
  iteration: number;
  metricName: string;
  metricValue: number;
  timestamp: number;
}

export function usePersistedMetrics(sessionId: number | null, metricName?: string) {
  return useQuery<{ metrics: TrainingMetricRow[] }>({
    queryKey: ["persistedMetrics", sessionId, metricName],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (metricName) params.set("metricName", metricName);
      const res = await fetch(`/api/training/sessions/${sessionId}/metrics?${params}`, { signal });
      if (!res.ok) throw new Error("Failed to fetch training metrics");
      return res.json();
    },
    enabled: sessionId != null,
  });
}

export function usePersistedMetricNames(sessionId: number | null) {
  return useQuery<{ names: string[] }>({
    queryKey: ["persistedMetricNames", sessionId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/training/sessions/${sessionId}/metrics/names`, { signal });
      if (!res.ok) throw new Error("Failed to fetch metric names");
      return res.json();
    },
    enabled: sessionId != null,
  });
}
