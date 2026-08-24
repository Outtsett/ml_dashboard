/**
 * Pure type definitions for the dashboard context tree.
 * Separate file to prevent circular imports between focused context providers.
 */

// ── Market types ───────────────────────────────────────────────────────────

export type AssetType = 'futures' | 'forex';

// ── Chart overlay types ────────────────────────────────────────────────────

/** A trade entry/exit marker to render on the price chart */
export interface TradeMarker {
  id: string;
  timestamp: number;       // ms epoch
  type: 'entry' | 'exit';
  side: 'long' | 'short';
  price: number;
  label?: string;          // e.g. "Buy @1850.25" or "Exit +$42"
  pnl?: number;            // only on exits
  source: 'backtest' | 'live' | 'model'; // where did this come from?
  modelName?: string;
}

/** A model prediction marker to render on the price chart */
export interface PredictionMarker {
  timestamp: number;       // ms epoch — which bar this prediction is FOR
  direction: 1 | 0 | -1;  // up / neutral / down
  confidence?: number;     // 0–1
  modelName: string;
  source: 'backtest' | 'live' | 'forecast';
}

/** Active overlay configuration */
export interface ChartOverlays {
  tradeMarkers: TradeMarker[];
  predictionMarkers: PredictionMarker[];
  /** Highlight a time range on the chart (e.g., training data range) */
  highlightRange?: {
    start: number;  // ms
    end: number;    // ms
    label: string;
    color: string;
  };
}

// ── Training types ─────────────────────────────────────────────────────────

/** Training progress with bar-level context for chart replay */
export interface TrainingBarContext {
  /** The date range being used for training */
  dataStart: string;       // ISO
  dataEnd: string;         // ISO
  /** Current epoch progress */
  epoch: number;
  totalEpochs: number;
  loss: number;
  valLoss: number;
  accuracy: number;
  valAccuracy: number;
  /** Original status fields */
  status: 'training' | 'completed' | 'error' | 'stopped';
  message?: string;
  /** How much of the data has been seen this epoch (0–1) */
  progress?: number;
  /** Bar-level: which bar indices are currently in the batch window */
  currentBatchStart?: number;
  currentBatchEnd?: number;
  trainSize?: number;
  valSize?: number;
  symbol: string;
  modelName?: string;
}

// ── Log types ──────────────────────────────────────────────────────────────

export interface DashboardLog {
  id: string;
  timestamp: number;
  level: 'info' | 'success' | 'warning' | 'error';
  source: 'training' | 'backtest' | 'forecast' | 'data' | 'system';
  message: string;
}
