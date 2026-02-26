/**
 * Shared Regime data hooks — single source for regime model, diagnostics, and assignment queries.
 *
 * SRP: Each hook fetches one data concern.
 * DIP: Uses apiService abstraction, never raw fetch().
 */

import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/lib/types';
import { instrumentApi } from '@/lib/apiService';
import type {
  RegimeModel,
  Diagnostics,
  ConvergencePoint,
} from '@/components/training/types';

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
    queryFn: async () => {
      const res = await fetch('/api/training/models');
      if (!res.ok) throw new Error('Failed to load regime models');
      return res.json();
    },
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
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/diagnostics`);
      if (!res.ok) throw new Error('Failed to load diagnostics');
      return res.json();
    },
    enabled: !!modelId,
  });
}

// ── Regime Convergence ───────────────────────────────────────────────────────

export function useRegimeConvergence(modelId: string | null) {
  return useQuery<Record<string, ConvergencePoint[]> | null>({
    queryKey: [...QUERY_KEYS.regimeConvergence(modelId || '')],
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/convergence`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!modelId,
  });
}

// ── Regime Assignments ───────────────────────────────────────────────────────

export interface RegimeRow {
  ts: string;
  regime: number;
  regime_label: string;
  split: string;
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
    queryFn: async () => {
      const res = await fetch(`/api/training/models/${modelId}/assignments?limit=${limit}`);
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
    queryFn: async () => {
      const res = await fetch('/api/training/status');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: isTraining ? 3000 : false,
  });
}
