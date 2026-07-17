/**
 * Centralized API service layer.
 *
 * Every fetch call in the client should go through this module instead of
 * writing raw `fetch('/api/...')` inside components or hooks.
 *
 * DIP: Components/hooks depend on this abstraction — never on `fetch` directly.
 * OCP: Add new endpoints here — consumers don't change.
 */

import { apiRequest } from "@/infrastructure/api/query_client";
import type { Instrument } from '@shared/schema';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fire a GET and parse JSON response. Accepts optional AbortSignal for cancellation. */
async function get<T = unknown>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await apiRequest('GET', url, undefined, signal);
  return res.json() as Promise<T>;
}

/** Fire a GET and guarantee an array result (safe when backend returns error objects). */
async function getArray<T = unknown>(url: string, signal?: AbortSignal): Promise<T[]> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Fire a POST/PUT/DELETE, parse JSON response. */
async function mutate<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, url, body);
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ── Model Checkpoints ────────────────────────────────────────────────────────

export const checkpointApi = {
  list:         (params?: Record<string, string>) =>
    getArray(`/api/models${params ? '?' + new URLSearchParams(params) : ''}`),
  get:          (id: number)    => get(`/api/models/${id}`),
  diagnostics:  (id: number)    => get(`/api/models/${id}/diagnostics`),
  activate:     (id: number)    => mutate('PATCH', `/api/models/${id}/activate`),
  predSummary:  (id: number)    => get(`/api/models/${id}/predictions/summary`),
} as const;

// ── ML Models ────────────────────────────────────────────────────────────────

export const mlApi = {
  getModels:      ()  => getArray('/api/ml/models'),
  getTrades:      ()  => getArray('/api/ml/trades'),
  getForecasts:   (params: Record<string, string>) =>
    get(`/api/ml/forecasts?${new URLSearchParams(params)}`),
  getForecastById: (id: string) => get(`/api/ml/forecasts/${id}`),
  getForecasList:  () => getArray('/api/ml/forecasts'),
  runForecast:     (body: unknown) => mutate('POST', '/api/ml/forecast', body),
  getXAI:          (modelName: string, method: string) =>
    get(`/api/ml/xai/${encodeURIComponent(modelName)}?method=${method}`),
} as const;

// ── Training (unified — model lifecycle + CRUD) ─────────────────────────────

export const trainingApi = {
  getConfig:      ()                 => get('/api/training/config'),
  start:          (body: unknown)    => mutate('POST', '/api/training/start', body),
  stop:           (modelId: string)  => mutate('POST', `/api/training/stop/${modelId}`),
  getStatus:      ()                 => get('/api/training/status'),
  getModels:      ()                 => getArray('/api/training/models'),
  getDiagnostics: (id: string)       => get(`/api/training/models/${id}/diagnostics`),
  getConvergence: (id: string)       => getArray(`/api/training/models/${id}/convergence`),
  getAssignments: (params: Record<string, string>) =>
    get(`/api/training/models/${params.modelId}/assignments?${new URLSearchParams(params)}`),
  deleteModel:    (id: string)       => mutate('DELETE', `/api/training/models/${id}`),
} as const;

/** @deprecated Use `trainingApi` instead — consolidated to avoid DRY violation. */
export const regimeApi = trainingApi;

// ── Charts ───────────────────────────────────────────────────────────────────

export const chartApi = {
  getOhlcv:   (params: Record<string, string>, signal?: AbortSignal) =>
    get(`/api/charts/ohlcv?${new URLSearchParams(params)}`, signal),
  getSymbols: (signal?: AbortSignal) => getArray('/api/charts/symbols', signal),
} as const;

// ── XAI ──────────────────────────────────────────────────────────────────────

export const xaiApi = {
  getMethods: () => get('/api/xai/methods'),
  explain:    (body: unknown) => mutate('POST', '/api/xai/explain', body),
  getRegimeImportance: (modelId: string) =>
    get<{ success: boolean; importance: Array<{ feature: string; value: number; contribution: number; direction: string }> }>(
      `/api/xai/regime-importance/${encodeURIComponent(modelId)}`
    ),
  getShap: (modelId: string, opts?: { regime?: number; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.regime !== undefined) params.set('regime', String(opts.regime));
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    return get(`/api/xai/shap/${encodeURIComponent(modelId)}?${params}`);
  },
} as const;

// ── Labels ───────────────────────────────────────────────────────────────────

export const labelApi = {
  getLabels: (symbol: string) =>
    getArray(`/api/labels?symbol=${symbol}`),
  generate:  (body: unknown) =>
    mutate('POST', '/api/labels/generate', body),
  preview:   (body: unknown) =>
    mutate('POST', '/api/labels/preview', body),
  delete:    (id: number) =>
    mutate('DELETE', `/api/labels/${id}`),
} as const;

// ── Instruments ──────────────────────────────────────────────────────────────

export const instrumentApi = {
  getAll: () => getArray<Instrument>('/api/instruments'),
} as const;

// ── Databases ────────────────────────────────────────────────────────────────

export const databaseApi = {
  query:      (body: unknown) => mutate('POST', '/api/databases/query', body),
  getUploads: () => getArray('/api/databases/uploads'),
} as const;

// ── Backtest ─────────────────────────────────────────────────────────────────

export interface BacktestRunBody {
  symbol: string;
  timeframe: string;
  splitRatio?: number;
  initialCapital?: number;
  positionSize?: number;
  minConfidence?: number;
  modelId?: number;
  useLastTrained?: boolean;
  experimentId?: string;
  brokerConfigId?: number;
  stopLossTicks?: number;
  takeProfitTicks?: number;
  start?: string;
  end?: string;
}

export interface BacktestRunResponse {
  run: { id: number; [key: string]: unknown };
  metrics: { totalTrades: number; winRate: number; [key: string]: unknown };
  [key: string]: unknown;
}

export const backtestApi = {
  getTrades: (params: Record<string, string>) =>
    getArray(`/api/backtest/trades?${new URLSearchParams(params)}`),
  getTradesForRun: (runId: number) => get(`/api/backtest/trades/${runId}`),
  /** Dispatch a backtest run. Used by EvaluateStage's parallel runner. */
  run: (body: BacktestRunBody) => mutate<BacktestRunResponse>('POST', '/api/backtest/run', body),
} as const;

// ── MotiveWave ───────────────────────────────────────────────────────────────

export interface MwStatus {
  running: boolean;
  config: {
    watchDir: string;
    enabled: boolean;
    debounceMs: number;
    autoStart: boolean;
    patterns: string[];
  };
  trackedFiles: number;
  recentImports: MwImportRecord[];
}

export interface MwImportRecord {
  filename: string;
  symbol: string;
  timeframe: string;
  rowsImported: number;
  rowsSkipped: number;
  timestamp: number;
  durationMs: number;
  status: "success" | "error";
  error?: string;
}

export const motiveWaveApi = {
  getStatus:   () => get<MwStatus>("/api/motivewave/status"),
  configure:   (body: Partial<MwStatus["config"]>) => mutate("POST", "/api/motivewave/configure", body),
  start:       () => mutate("POST", "/api/motivewave/start"),
  stop:        () => mutate("POST", "/api/motivewave/stop"),
  importPath:  (filePath: string, symbol?: string) =>
    mutate("POST", "/api/motivewave/import-path", { filePath, symbol }),
} as const;
