import { useEffect, useMemo } from 'react';
import * as Comlink from 'comlink';
import MathWorker from './math.worker.ts?worker';
import type { MathProcessor } from './math.worker';

/**
 * Hook to instantiate and communicate with the math web worker
 * without blocking the main React UI thread.
 */
export function useMathWorker() {
  const workerApi = useMemo(() => {
    const worker = new MathWorker();
    const api = Comlink.wrap<typeof MathProcessor>(worker);
    return { worker, api };
  }, []);

  useEffect(() => {
    return () => {
      workerApi.worker.terminate();
    };
  }, [workerApi]);

  return workerApi.api;
}
