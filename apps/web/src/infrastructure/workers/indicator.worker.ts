/**
 * Indicator Web Worker
 * Offloads heavy technical indicator calculations from the main UI thread.
 */

import { computeAllIndicators, computeIndicator, type ComputedIndicator, type OHLCVBar } from "@/market/lib/indicator_compute";
import type { ActiveIndicator } from "@/market/lib/useActiveIndicators";

// Define the shape of incoming requests
export interface WorkerRequest {
  type: 'COMPUTE_ALL' | 'COMPUTE_SINGLE';
  payload: {
    indicators?: ActiveIndicator[];
    indicator?: ActiveIndicator;
    bars: OHLCVBar[];
  };
  requestId: string;
}

// Define the shape of outgoing responses
export interface WorkerResponse {
  type: 'COMPUTE_SUCCESS' | 'COMPUTE_ERROR';
  payload: ComputedIndicator[] | ComputedIndicator | null | string;
  requestId: string;
}

/**
 * Handle messages from the main thread.
 */
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { type, payload, requestId } = event.data;

  try {
    let result: ComputedIndicator[] | ComputedIndicator | null;

    if (type === 'COMPUTE_ALL') {
      if (!payload.indicators) throw new Error('Missing indicators payload');
      result = computeAllIndicators(payload.indicators, payload.bars);
    } else if (type === 'COMPUTE_SINGLE') {
      if (!payload.indicator) throw new Error('Missing indicator payload');
      result = computeIndicator(payload.indicator, payload.bars);
    } else {
      throw new Error(`Unknown request type: ${type}`);
    }

    // Send successful result back
    self.postMessage({
      type: 'COMPUTE_SUCCESS',
      payload: result,
      requestId,
    } as WorkerResponse);

  } catch (error) {
    // Send error back
    self.postMessage({
      type: 'COMPUTE_ERROR',
      payload: (error as Error).message || 'Unknown worker error',
      requestId,
    } as WorkerResponse);
  }
};
