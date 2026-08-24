/**
 * useEvaluationResults — Fetch evaluation test results from SQLite.
 *
 * SRP: API data fetching only. No rendering or business logic.
 * ISP: Separate queries for results vs summary — components use what they need.
 */

import { useQuery } from "@tanstack/react-query";

interface EvaluationResultRow {
  id: number;
  sessionId: number;
  stage: string;
  testName: string;
  testValue: number | null;
  testPassed: number | null;
  pValue: number | null;
  details: string | null;
  computedAt: number;
}

interface EvaluationStageSummary {
  stage: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
}

export function useEvaluationResults(sessionId: number | null, stage?: string) {
  return useQuery<{ results: EvaluationResultRow[] }>({
    queryKey: ["evaluationResults", sessionId, stage],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (stage) params.set("stage", stage);
      const res = await fetch(`/api/training/sessions/${sessionId}/evaluation?${params}`, { signal });
      if (!res.ok) throw new Error("Failed to fetch evaluation results");
      return res.json();
    },
    enabled: sessionId != null,
  });
}

export function useEvaluationSummary(sessionId: number | null) {
  return useQuery<{ summary: EvaluationStageSummary[] }>({
    queryKey: ["evaluationSummary", sessionId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/training/sessions/${sessionId}/evaluation/summary`, { signal });
      if (!res.ok) throw new Error("Failed to fetch evaluation summary");
      return res.json();
    },
    enabled: sessionId != null,
  });
}
