/**
 * The body of GET /api/studies/training-environment, shared by the handler and
 * the page, plus the pure computations both run.
 *
 * The page reads the record a multimodal direction run writes
 * (scripts/train_multimodal_direction.py in the quant workspace), as landed in
 * the lake by packages/ml-engine/src/studies/training_environment/build.py. The response has
 * one body per `part`, so the page asks for exactly what a control changed:
 *   overview    the runs, the chosen run's status, learning curves, events, layer readings
 *   bars        the OHLCV the model trained on
 *   block       one modality block as numbers, with its nine statistics per feature
 *   embedding   the 2-D representation of the bar tokens at one epoch
 *   activations a slice of one layer's real activations at one epoch
 */

export const TRAINING_ENVIRONMENT_PARTS = ["overview", "bars", "block", "embedding", "activations"] as const;
export type TrainingEnvironmentPart = (typeof TRAINING_ENVIRONMENT_PARTS)[number];

export type RunStatus = "finished" | "running" | "starting";

export interface TrainingRunRow {
  run_name: string;
  status: RunStatus;
  symbol: string;
  timeframe: string;
  maximum_bars: number;
  window_bars: number;
  horizon_bars: number;
  barrier_points: number;
  epochs_configured: number;
  batch_size: number;
  learning_rate: number;
  model_dimension: number;
  modality_dropout: number;
  train_fraction: number;
  up_label_count: number;
  down_label_count: number;
  unresolved_label_count: number;
  epochs_seen: number;
  batches_streamed: number;
  event_count: number;
  latest_epoch: number | null;
  best_direction_accuracy: number | null;
  best_epoch: number | null;
  majority_baseline_accuracy: number | null;
  skill: number | null;
  parameter_count: number | null;
  elapsed_seconds: number | null;
  stream_modified_ms: number;
  landed_at_ms: number;
  snapshot_format: string | null;
}

export interface EpochRow {
  epoch: number;
  epochs_configured: number;
  train_loss: number | null;
  direction_accuracy: number | null;
  majority_baseline_accuracy: number | null;
  skill: number | null;
  seconds: number | null;
}

export interface BlockNormRow {
  epoch: number;
  block: string;
  token_norm: number | null;
}

export interface BatchLossRow {
  step: number;
  epoch: number;
  batch: number;
  batch_count: number;
  loss: number | null;
}

export interface StreamEventRow {
  event_index: number;
  event_type: string;
  epoch: number | null;
  batch: number | null;
  batch_count: number | null;
  loss: number | null;
  snapshot_file: string | null;
  elapsed_seconds: number | null;
  detail: string;
}

export interface BlockCatalogueRow {
  block: string;
  block_index: number;
  feature: string;
  feature_index: number;
  bar_count: number;
}

export interface EmbeddingEpochRow {
  epoch: number;
  variance_explained: number | null;
  point_count: number;
}

export interface LayerReadingRow {
  epoch: number;
  layer_order: number;
  layer_name: string;
  module_type: string;
  output_shape: string;
  parameter_count: number;
  mean: number | null;
  standard_deviation: number | null;
  minimum: number | null;
  maximum: number | null;
  zero_fraction: number | null;
  saturated_fraction: number | null;
  gradient_norm: number;
}

export interface OverviewBody {
  part: "overview";
  /** Every landed run, oldest stream first. */
  runs: TrainingRunRow[];
  /** The run every other row belongs to (the newest when none was asked for); null when nothing is landed. */
  run: string | null;
  epochs: EpochRow[];
  blockNorms: BlockNormRow[];
  batches: BatchLossRow[];
  events: StreamEventRow[];
  blocks: BlockCatalogueRow[];
  embeddingEpochs: EmbeddingEpochRow[];
  layers: LayerReadingRow[];
}

export interface BarRow {
  bar_index: number;
  timestamp_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BarsBody {
  part: "bars";
  run: string | null;
  bars: BarRow[];
}

export interface FeatureStatistics {
  feature: string;
  count: number;
  mean: number | null;
  median: number | null;
  standard_deviation: number | null;
  skewness: number | null;
  excess_kurtosis: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface BlockBody {
  part: "block";
  run: string | null;
  block: string | null;
  features: string[];
  /** values[bar_index][feature_index], null where the number was not finite. */
  values: Array<Array<number | null>>;
  statistics: FeatureStatistics[];
}

export interface EmbeddingPoint {
  component_1: number;
  component_2: number;
  barrier_outcome: "up first" | "down first";
  pattern_fired: "fired" | "none fired";
}

export interface EmbeddingBody {
  part: "embedding";
  run: string | null;
  /** The snapshot epoch nearest the one asked for; null when the run has none. */
  epoch: number | null;
  variance_explained: number | null;
  points: EmbeddingPoint[];
}

export interface ActivationsBody {
  part: "activations";
  run: string | null;
  epoch: number | null;
  layer: string | null;
  /** values[row][unit] of the stored slice. */
  values: Array<Array<number | null>>;
}

export type TrainingEnvironmentBody = OverviewBody | BarsBody | BlockBody | EmbeddingBody | ActivationsBody;

// ── pure computations, shared by the handler, the page and the tests ─────────

/** The layer collapses below this output standard deviation (notebook cell 5). */
export const COLLAPSED_BELOW = 1e-4;

/**
 * The value in `available` nearest `wanted`; the first of equals, as the
 * notebook's `min(events, key=|epoch - wanted|)` picked. Null for an empty list.
 */
export function nearestEpoch(available: readonly number[], wanted: number): number | null {
  let best: number | null = null;
  for (const candidate of available) {
    if (best === null || Math.abs(candidate - wanted) < Math.abs(best - wanted)) best = candidate;
  }
  return best;
}

export interface StandardisedMoments {
  count: number;
  mean: number;
  /** Sample standard deviation (n - 1), the divisor the notebook's z-scores used. */
  standardDeviation: number | null;
  /** mean(z^3), z = (x - mean) / s. */
  skewness: number | null;
  /** mean(z^4) - 3. */
  excessKurtosis: number | null;
}

/**
 * The notebook's moments (training_environment.py cell 2): z-scores on the
 * sample standard deviation, skewness the mean of z cubed, excess kurtosis the
 * mean of z to the fourth minus 3. Not the bias-adjusted estimators DuckDB's
 * skewness() and kurtosis() return. Non-finite values are skipped; a constant
 * column has no z-score, so its moments are null.
 */
export function standardisedMoments(values: ReadonlyArray<number | null>): StandardisedMoments | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const n = finite.length;
  if (n === 0) return null;
  const mean = finite.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) return { count: n, mean, standardDeviation: null, skewness: null, excessKurtosis: null };
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const standardDeviation = Math.sqrt(variance);
  if (!(standardDeviation > 0)) return { count: n, mean, standardDeviation, skewness: null, excessKurtosis: null };
  let cubes = 0;
  let fourths = 0;
  for (const value of finite) {
    const z = (value - mean) / standardDeviation;
    cubes += z ** 3;
    fourths += z ** 4;
  }
  return { count: n, mean, standardDeviation, skewness: cubes / n, excessKurtosis: fourths / n - 3 };
}

export interface LayerHealth {
  /** Has parameters but no gradient reached it. */
  starved: LayerReadingRow[];
  /** Output standard deviation below COLLAPSED_BELOW: a constant. */
  collapsed: LayerReadingRow[];
}

/** The notebook's two layer-health calls (cell 5). */
export function layerHealth(readings: readonly LayerReadingRow[], collapsedBelow = COLLAPSED_BELOW): LayerHealth {
  return {
    starved: readings.filter((row) => row.gradient_norm <= 0 && row.parameter_count > 0),
    collapsed: readings.filter((row) => row.standard_deviation !== null && row.standard_deviation < collapsedBelow),
  };
}

/** Skill against the majority class: accuracy minus the share of the commonest class. */
export function skillOverMajority(accuracy: number, majorityBaseline: number): number {
  return accuracy - majorityBaseline;
}

/** Up labels over resolved labels (bars whose barrier was touched). */
export function resolvedLabels(row: Pick<TrainingRunRow, "up_label_count" | "down_label_count">): number {
  return row.up_label_count + row.down_label_count;
}

/** Variance the first two principal axes hold, from the singular values of the centred tokens. */
export function varianceExplainedByTwo(singularValues: readonly number[]): number | null {
  const total = singularValues.reduce((sum, value) => sum + value * value, 0);
  if (!(total > 0) || singularValues.length < 2) return null;
  return ((singularValues[0] as number) ** 2 + (singularValues[1] as number) ** 2) / total;
}

/**
 * Rows of a bar-major matrix cut to `[first, last]` and, when that is more than
 * `maximumColumns` bars, averaged into that many bins so a heatmap cell is at
 * least a pixel wide. Returns the feature-major matrix to draw
 * (matrix[feature][column]) with the bar span each column covers.
 */
export function windowedFeatureMatrix(
  values: ReadonlyArray<ReadonlyArray<number | null>>,
  featureCount: number,
  first: number,
  last: number,
  maximumColumns: number,
): { matrix: Array<Array<number | null>>; spans: Array<[number, number]> } {
  const from = Math.max(0, Math.min(first, values.length - 1));
  const to = Math.max(from, Math.min(last, values.length - 1));
  const bars = to - from + 1;
  const columns = Math.max(1, Math.min(bars, maximumColumns));
  const matrix: Array<Array<number | null>> = Array.from({ length: featureCount }, () => new Array<number | null>(columns).fill(null));
  const spans: Array<[number, number]> = [];
  for (let column = 0; column < columns; column += 1) {
    const start = from + Math.floor((column * bars) / columns);
    const end = from + Math.max(start - from, Math.floor(((column + 1) * bars) / columns) - 1);
    spans.push([start, end]);
    for (let feature = 0; feature < featureCount; feature += 1) {
      let sum = 0;
      let count = 0;
      for (let bar = start; bar <= end; bar += 1) {
        const value = values[bar]?.[feature];
        if (typeof value === "number" && Number.isFinite(value)) {
          sum += value;
          count += 1;
        }
      }
      (matrix[feature] as Array<number | null>)[column] = count > 0 ? sum / count : null;
    }
  }
  return { matrix, spans };
}
