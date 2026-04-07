/**
 * Shared Regime data hooks — single source for regime model, diagnostics, and assignment queries.
 *
 * SRP: Each hook fetches one data concern.
 * DIP: Uses apiService abstraction, never raw fetch().
 */

import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/types';
import { instrumentApi } from '@/lib/api_service';
import type {
  RegimeModel,
  ConvergencePoint,
} from '@/components/training/types';
import type { Diagnostics } from '@/components/regime-analytics/types';

// ── Instruments (shared across regime + other pages) ─────────────────────────

export function useInstruments() {
  return useQuery({
    queryKey: [...QUERY_KEYS.instruments],
    queryFn: () => instrumentApi.getAll(),
  });
}

// ── Regime Models ────────────────────────────────────────────────────────────

interface RegimeModelsResponse {
  models: RegimeModel[];
}

export function useRegimeModels(isTraining = false) {
  const query = useQuery<RegimeModelsResponse>({
    queryKey: [...QUERY_KEYS.regimeModels],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/training/models', { signal });
      if (!res.ok) throw new Error('Failed to load regime models');
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: isTraining ? 5000 : false,
  });
  return {
    ...query,
    models: query.data?.models ?? [],
  };
}

// ── Regime Diagnostics ───────────────────────────────────────────────────────

export function useRegimeDiagnostics(modelId: string | null) {
  return useQuery<Diagnostics>({
    queryKey: [...QUERY_KEYS.regimeDiagnostics(modelId || '')],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/training/models/${modelId}/diagnostics`, { signal });
      if (!res.ok) throw new Error('Failed to load diagnostics');
      return res.json();
    },
    enabled: !!modelId,
    staleTime: 5 * 60 * 1000,
  });
}

// ── Regime Convergence ───────────────────────────────────────────────────────

export function useRegimeConvergence(modelId: string | null) {
  return useQuery<Record<string, ConvergencePoint[]> | null>({
    queryKey: [...QUERY_KEYS.regimeConvergence(modelId || '')],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/training/models/${modelId}/convergence`, { signal });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!modelId,
    staleTime: 5 * 60 * 1000,
  });
}

// ── Regime Assignments ───────────────────────────────────────────────────────

export interface RegimeRow {
  ts: string;
  regime: number;
  regime_label: string;
  split: string;
  category?: "trend" | "reversal" | "range";
  [key: string]: unknown;
}

export interface RegimeAssignmentsResponse {
  rows: RegimeRow[];
  total: number;
  limit: number;
  offset: number;
}

export function useRegimeAssignments(modelId: string | null, opts?: { enabled?: boolean; limit?: number }) {
  const limit = opts?.limit ?? 100000;
  return useQuery<RegimeAssignmentsResponse>({
    queryKey: [...QUERY_KEYS.regimeAssignments(modelId || ''), 'chart'],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/training/models/${modelId}/assignments?limit=${limit}`, { signal });
      if (!res.ok) throw new Error('Failed to load regime assignments');
      return res.json();
    },
    enabled: (opts?.enabled ?? true) && !!modelId,
    staleTime: 120_000,
  });
}

// ── Regime Training Status ───────────────────────────────────────────────────

export function useRegimeTrainStatus(isTraining = false) {
  return useQuery({
    queryKey: [...QUERY_KEYS.regimeTrainStatus],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/training/status', { signal });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: isTraining ? 3000 : false,
  });
}
