import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSSEConnection } from "@/infrastructure/lib/useSSEConnection";
import { logError, logWarn } from "@/infrastructure/lib/error_logger";

type SSEChannel = 'pipeline' | 'training' | 'system';

interface EventStreamOptions {
  channel: SSEChannel;
  onEvent?: (type: string, data: unknown) => void;
  enabled?: boolean;
}

const PIPELINE_EVENTS = [
  'pipeline.started', 'pipeline.step.started', 'pipeline.step.completed',
  'pipeline.step.failed', 'pipeline.completed', 'pipeline.failed',
  'pipeline.compensating', 'pipeline.compensated',
] as const;

export function useEventStream(options: EventStreamOptions) {
  const { channel, onEvent, enabled = true } = options;
  const queryClient = useQueryClient();

  const eventMap = useMemo(() => {
    const map: Record<string, (data: unknown) => void> = {};

    map['connected'] = () => {
      logWarn('useEventStream', 'SSE connected', { channel });
    };

    map['cache.invalidate'] = (data: unknown) => {
      const msg = data as { queryKey?: string[] };
      if (msg.queryKey) {
        try {
          queryClient.invalidateQueries({ queryKey: msg.queryKey });
        } catch (err) {
          logError('useEventStream', 'Cache invalidation failed', {
            queryKey: msg.queryKey, error: String(err),
          });
        }
      }
    };

    for (const eventType of PIPELINE_EVENTS) {
      map[eventType] = (data: unknown) => {
        onEvent?.(eventType, data);
      };
    }

    return map;
  }, [queryClient, onEvent, channel]);

  const url = `/api/events/${channel}`;
  const { connected, error, reconnectAttempt } = useSSEConnection({
    url, enabled, eventMap,
  });

  return { connected, error, reconnectAttempt };
}
