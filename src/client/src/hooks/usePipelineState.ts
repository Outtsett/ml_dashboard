import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/query_client';

interface PipelineState {
  id: string;
  status: string;
  currentStep: string | null;
  steps: Array<{
    name: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
  }>;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

interface Pipeline {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface PipelineEvent {
  id: string;
  pipelineId: string;
  type: string;
  data: unknown;
  metadata: unknown;
  timestamp: string;
}

/** GET /api/pipelines/:id/state */
export function usePipelineState(pipelineId: string | undefined) {
  return useQuery<PipelineState>({
    queryKey: ['pipelines', pipelineId, 'state'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/pipelines/${pipelineId}/state`);
      return res.json();
    },
    enabled: !!pipelineId,
  });
}

/** GET /api/pipelines */
export function usePipelines() {
  return useQuery<Pipeline[]>({
    queryKey: ['pipelines'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/pipelines');
      return res.json();
    },
  });
}

/** GET /api/pipelines/:id/events */
export function usePipelineEvents(pipelineId: string | undefined) {
  return useQuery<PipelineEvent[]>({
    queryKey: ['pipelines', pipelineId, 'events'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/pipelines/${pipelineId}/events`);
      return res.json();
    },
    enabled: !!pipelineId,
  });
}
