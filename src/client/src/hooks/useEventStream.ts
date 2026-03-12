import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type SSEChannel = 'pipeline' | 'training' | 'system';

interface EventStreamOptions {
  channel: SSEChannel;
  onEvent?: (event: { type: string; data: unknown; metadata: unknown }) => void;
  enabled?: boolean;
}

export function useEventStream({ channel, onEvent, enabled = true }: EventStreamOptions) {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource(`/api/events/${channel}`);
    eventSourceRef.current = source;

    // Connected handler
    source.addEventListener('connected', (e) => {
      console.log(`[SSE:${channel}] connected`, JSON.parse(e.data));
    });

    // Cache invalidation (system channel)
    source.addEventListener('cache.invalidate', (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const keys: string[] = parsed.data?.keys ?? [];
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
      } catch { /* ignore */ }
    });

    // Pipeline events
    const pipelineEvents = [
      'pipeline.started', 'pipeline.step.started', 'pipeline.step.completed',
      'pipeline.step.failed', 'pipeline.completed', 'pipeline.failed',
      'pipeline.compensating', 'pipeline.compensated',
    ];
    for (const eventType of pipelineEvents) {
      source.addEventListener(eventType, (e) => {
        try {
          const parsed = JSON.parse(e.data);
          onEvent?.(parsed);
          queryClient.invalidateQueries({ queryKey: ['pipelines'] });
        } catch { /* ignore */ }
      });
    }

    source.onerror = () => {
      console.warn(`[SSE:${channel}] error, auto-reconnecting`);
    };

    return () => { source.close(); eventSourceRef.current = null; };
  }, [channel, enabled, queryClient, onEvent]);
}
