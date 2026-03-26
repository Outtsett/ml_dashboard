/**
 * Hook for interacting with the Indicator Web Worker.
 */

import { useEffect, useRef, useCallback } from 'react';
import type { ActiveIndicator } from '@/hooks/useActiveIndicators';
import type { ComputedIndicator } from '@/lib/indicator_compute';
import type { WorkerRequest, WorkerResponse } from '@/lib/indicator.worker';

// Use Vite's worker import syntax
import IndicatorWorker from '@/lib/indicator.worker?worker';

export function useIndicatorWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRequests = useRef<Map<string, (result: any) => void>>(new Map());

  // Initialize worker on mount
  useEffect(() => {
    const worker = new IndicatorWorker();
    
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { type, payload, requestId } = event.data;
      const resolver = pendingRequests.current.get(requestId);
      
      if (resolver) {
        if (type === 'COMPUTE_SUCCESS') {
          resolver(payload);
        } else {
          console.error('[IndicatorWorker] Error:', payload);
          resolver(null);
        }
        pendingRequests.current.delete(requestId);
      }
    };

    worker.onerror = (err) => {
      console.error('[IndicatorWorker] Fatal Error:', err);
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  /**
   * Compute all indicators via the worker.
   */
  const computeAll = useCallback(async (
    indicators: ActiveIndicator[], 
    bars: any[]
  ): Promise<ComputedIndicator[]> => {
    if (!workerRef.current || indicators.length === 0 || bars.length === 0) {
      return [];
    }

    const requestId = crypto.randomUUID();
    
    return new Promise((resolve) => {
      pendingRequests.current.set(requestId, resolve);
      
      workerRef.current?.postMessage({
        type: 'COMPUTE_ALL',
        payload: { indicators, bars },
        requestId,
      } as WorkerRequest);
    });
  }, []);

  return { computeAll };
}
