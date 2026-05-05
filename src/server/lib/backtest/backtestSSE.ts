/**
 * Backtest SSE — streams progress updates during backtest execution.
 */
import { EventEmitter } from 'events';

export const backtestEmitter = new EventEmitter();
backtestEmitter.setMaxListeners(50);

export interface BacktestProgress {
  runId: number;
  phase: 'loading_data' | 'generating_signals' | 'simulating' | 'computing_metrics' | 'persisting';
  progress: number; // 0-100
  barsProcessed: number;
  totalBars: number;
  currentEquity?: number;
  openPosition?: boolean;
  tradesCompleted?: number;
  message?: string;
}

export function emitProgress(progress: BacktestProgress): void {
  backtestEmitter.emit(`progress:${progress.runId}`, progress);
}
