/**
 * The Lens training environment's client data layer.
 *
 * Endpoints, all under `/api`:
 *   GET  /lens/training/runs                              every run on disk
 *   GET  /lens/training/runs/:run?after=N                 the event stream
 *   GET  /lens/training/runs/:run/snapshot/:file?array=…  one parquet snapshot
 *   POST /lens/training/start                             the run button
 */
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";

// ── Event shapes, as the Python writer emits them ────────────────────────────

/** Stamped on every event by `TrainingStream._write`, so it belongs on the base. */
interface StreamEventBase { elapsed_seconds: number }

export interface RunStartedEvent extends StreamEventBase {
  type: "run_started";
  run_name: string;
  config: Record<string, string | number | boolean>;
  block_shapes: Record<string, number[]>;
  label_counts: { up: number; down: number; unresolved: number };
}

export interface BlocksEvent extends StreamEventBase {
  type: "blocks";
  file: string;
  fields: Record<string, string[]>;
  count: number;
}

export interface EpochEvent extends StreamEventBase {
  type: "epoch";
  epoch: number;
  epochs: number;
  metrics: Record<string, number | null>;
  block_norms: Record<string, number>;
  seconds: number;
}

export interface BatchEvent extends StreamEventBase {
  type: "batch";
  epoch: number;
  batch: number;
  batches: number;
  loss: number;
}

export interface LayerReadingEvent {
  name: string;
  module_type: string;
  output_shape: number[];
  parameter_count: number;
  mean: number;
  standard_deviation: number;
  minimum: number;
  maximum: number;
  zero_fraction: number;
  saturated_fraction: number;
}

export interface LayersEvent extends StreamEventBase {
  type: "layers";
  epoch: number;
  file: string;
  readings: LayerReadingEvent[];
  gradient_norms: Record<string, number>;
}

export interface EmbeddingEvent extends StreamEventBase {
  type: "embedding";
  epoch: number;
  file: string;
  variance_explained: number;
  count: number;
}

export interface BarsEvent extends StreamEventBase { type: "bars"; file: string; count: number }
export interface RunFinishedEvent extends StreamEventBase {
  type: "run_finished";
  metrics: Record<string, number>;
  artefacts: Record<string, string>;
}

export type TrainingStreamEvent =
  | RunStartedEvent | BarsEvent | BlocksEvent | EpochEvent | BatchEvent
  | LayersEvent | EmbeddingEvent | RunFinishedEvent
  | ({ type: string; [key: string]: unknown } & Partial<StreamEventBase>);

export interface RunSummary {
  run: string;
  modifiedAt: string;
  status: "starting" | "running" | "finished";
  config: Record<string, string | number | boolean>;
  epoch: number;
  epochs: number;
  metrics: Record<string, number>;
  finalMetrics: Record<string, number> | null;
  eventCount: number;
}

export interface SnapshotResponse {
  file: string;
  format: "long" | "wide";
  columns: string[];
  rowCount: number;
  rows: Record<string, number | string>[];
}

export interface StartRunRequest {
  symbol: string;
  timeframe: string;
  maxBars: number;
  epochs: number;
  horizon: number;
  window: number;
  barrierPoints: number;
}

// ── Transport ────────────────────────────────────────────────────────────────

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  return body as T;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * @param refreshMs 0 disables polling. A running run wants a few seconds; a
 *   finished one wants nothing, and the caller decides because only it knows.
 */
export function useTrainingRuns(refreshMs = 0) {
  return useQuery({
    queryKey: ["lens", "training", "runs"],
    queryFn: ({ signal }) =>
      getJson<{ runs: RunSummary[]; root: string }>("/api/lens/training/runs", signal),
    refetchInterval: refreshMs > 0 ? refreshMs : false,
    staleTime: 2_000,
  });
}

export function useTrainingStream(run: string | null, refreshMs = 0) {
  return useQuery({
    queryKey: ["lens", "training", "stream", run],
    enabled: run !== null,
    queryFn: ({ signal }) =>
      getJson<{ run: string; total: number; from: number; events: TrainingStreamEvent[] }>(
        `/api/lens/training/runs/${encodeURIComponent(run!)}`, signal),
    refetchInterval: refreshMs > 0 ? refreshMs : false,
    // Keep the previous stream on screen while the next poll lands, so panels
    // do not blank between ticks.
    placeholderData: keepPreviousData,
  });
}

export function useSnapshot(run: string | null, file: string | null,
                           array?: string, limit = 60_000) {
  return useQuery({
    queryKey: ["lens", "training", "snapshot", run, file, array ?? null, limit],
    enabled: run !== null && file !== null,
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({ limit: String(limit) });
      if (array) query.set("array", array);
      return getJson<SnapshotResponse>(
        `/api/lens/training/runs/${encodeURIComponent(run!)}/snapshot/${encodeURIComponent(file!)}?${query}`,
        signal);
    },
    // A snapshot for a given (run, file, array) never changes — the writer names
    // each epoch's file uniquely — so it is cached for the session.
    staleTime: Infinity,
  });
}

export function useStartTraining() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: StartRunRequest) =>
      fetch("/api/lens/training/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? `${response.status}`);
        return body as { run: string; pid: number | null; command: string };
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["lens", "training"] });
    },
  });
}

// ── Helpers shared by the stage panels ───────────────────────────────────────

/** Long-format snapshot rows -> a dense (rows x columns) matrix. */
export function toMatrix(rows: Record<string, number | string>[]): number[][] {
  if (rows.length === 0) return [];
  let maxRow = 0;
  let maxColumn = 0;
  for (const row of rows) {
    maxRow = Math.max(maxRow, Number(row.row_index));
    maxColumn = Math.max(maxColumn, Number(row.column_index));
  }
  const matrix: number[][] = Array.from(
    { length: maxRow + 1 }, () => new Array<number>(maxColumn + 1).fill(Number.NaN));
  for (const row of rows) {
    matrix[Number(row.row_index)]![Number(row.column_index)] = Number(row.value);
  }
  return matrix;
}

export function eventsOfType<T extends TrainingStreamEvent>(
  events: TrainingStreamEvent[] | undefined, type: string): T[] {
  return (events ?? []).filter(e => e.type === type) as T[];
}

// ── The vector space ─────────────────────────────────────────────────────────

/** Which blocks form the space. Projection and k-NN always use the same one. */
export type VectorBasis = "continuous" | "full";

export interface AxisReport {
  varianceExplained: number;
  blockShare: Record<string, number>;
  topLoadings: { field: string; loading: number }[];
}

export interface VectorPoint {
  barIndex: number;
  timestamp: string;
  x: number;
  y: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  patternCount: number;
}

export interface VectorSpaceResponse {
  run: string;
  basis: VectorBasis;
  bases: VectorBasis[];
  bars: number;
  dimensions: number;
  fields: string[];
  blocks: { name: string; width: number; offset: number }[];
  axes: [AxisReport, AxisReport];
  points: VectorPoint[];
}

export interface NeighbourResponse {
  run: string;
  basis: VectorBasis;
  bar: number;
  k: number;
  dimensions: number;
  neighbours: (VectorPoint & { distance: number })[];
}

/**
 * The space is built once per (run, basis) on the server and never changes
 * after, so it is cached for the session rather than refetched per epoch.
 */
export function useVectorSpace(run: string | null, basis: VectorBasis) {
  return useQuery({
    queryKey: ["lens", "training", "vectors", run, basis],
    enabled: run !== null,
    queryFn: ({ signal }) =>
      getJson<VectorSpaceResponse>(
        `/api/lens/training/runs/${encodeURIComponent(run!)}/vectors?basis=${basis}`, signal),
    staleTime: Infinity,
  });
}

export function useNeighbours(
  run: string | null, basis: VectorBasis, bar: number | null, k = 12,
) {
  return useQuery({
    queryKey: ["lens", "training", "neighbours", run, basis, bar, k],
    enabled: run !== null && bar !== null,
    queryFn: ({ signal }) =>
      getJson<NeighbourResponse>(
        `/api/lens/training/runs/${encodeURIComponent(run!)}/vectors/${bar}/neighbours`
        + `?k=${k}&basis=${basis}`, signal),
    staleTime: Infinity,
  });
}
