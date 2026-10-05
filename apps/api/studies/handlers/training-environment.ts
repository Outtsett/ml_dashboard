/**
 * Training environment: what a multimodal direction run knows while it runs.
 * Replaced Trading/quant/model/notebooks/training_environment.py.
 *
 * Reads the record scripts/train_multimodal_direction.py writes (stream.jsonl
 * plus bar / block / embedding / layer snapshots), as landed by
 * packages/ml-engine/src/studies/training_environment/build.py:
 *   derived_study_training_environment_runs               one row per run
 *   ..._epochs, ..._block_token_norms, ..._batch_losses   learning and token assembly
 *   ..._events                                            the raw stream
 *   ..._bars, ..._blocks, ..._block_features              the data it trains on
 *   ..._embedding_points                                  the representation, per epoch
 *   ..._layer_readings, ..._layer_activations             inside the network, per epoch
 * Every re-landing is a new recipe, so each query is pinned to the recipe whose
 * runs.landed_at is latest for the run asked for. A response carries one `part`
 * (overview, bars, block, embedding, activations), so a control changes only
 * the part it feeds. The nine statistics are computed here in SQL with the
 * notebook's conventions (sample standard deviation, skewness = mean of z^3,
 * excess kurtosis = mean of z^4 minus 3) rather than DuckDB's bias-adjusted
 * skewness() and kurtosis().
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident, text } from "../sql";
import type { StudyContext, StudyHandler } from "../types";
import {
  nearestEpoch,
  TRAINING_ENVIRONMENT_PARTS,
  type ActivationsBody,
  type BarRow,
  type BarsBody,
  type BatchLossRow,
  type BlockBody,
  type BlockCatalogueRow,
  type BlockNormRow,
  type EmbeddingBody,
  type EmbeddingEpochRow,
  type EmbeddingPoint,
  type EpochRow,
  type FeatureStatistics,
  type LayerReadingRow,
  type OverviewBody,
  type StreamEventRow,
  type TrainingEnvironmentBody,
  type TrainingRunRow,
} from "@shared/studies/training-environment";

const PREFIX = "derived_study_training_environment_";
const TABLES = [
  "runs", "epochs", "block_token_norms", "batch_losses", "events", "bars", "blocks", "block_features",
  "embedding_points", "layer_readings", "layer_activations",
] as const;
type Table = (typeof TABLES)[number];
const VIEWS = TABLES.map((table) => `${PREFIX}${table}`);
const EVENT_ROW_LIMIT = 1000;

const view = (table: Table): string => ident(`${PREFIX}${table}`);

export const QuerySchema = z.object({
  part: z.enum(TRAINING_ENVIRONMENT_PARTS).default("overview"),
  run: z.string().regex(/^[A-Za-z0-9_-]{0,80}$/).default(""),
  block: z.string().regex(/^[a-z0-9_]{0,40}$/).default(""),
  epoch: z.coerce.number().int().min(0).max(100_000).default(0),
  layer: z.string().regex(/^[A-Za-z0-9_.]{0,160}$/).default(""),
});
export type TrainingEnvironmentQuery = z.infer<typeof QuerySchema>;

export const RUNS_SQL = `
  SELECT run_name, recipe, status, symbol, timeframe, maximum_bars, window_bars, horizon_bars, barrier_points,
         epochs_configured, batch_size, learning_rate, model_dimension, modality_dropout, train_fraction,
         up_label_count, down_label_count, unresolved_label_count, epochs_seen, batches_streamed, event_count,
         latest_epoch, best_direction_accuracy, best_epoch, majority_baseline_accuracy, skill, parameter_count,
         elapsed_seconds, epoch_ms(stream_modified_at) AS stream_modified_ms, epoch_ms(landed_at) AS landed_at_ms,
         snapshot_format
  FROM ${view("runs")}
  QUALIFY row_number() OVER (PARTITION BY run_name ORDER BY landed_at DESC, recipe DESC) = 1
  ORDER BY stream_modified_at, run_name`;

/** The recipe pin every per-run query carries. */
export function pinned(run: string, recipe: string): string {
  return `run_name = ${text(run)} AND recipe = ${text(recipe)}`;
}

export function blockMatrixSql(run: string, recipe: string, block: string): string {
  return `SELECT bar_index, feature_index, value FROM ${view("block_features")}
          WHERE ${pinned(run, recipe)} AND block = ${text(block)} ORDER BY bar_index, feature_index`;
}

/**
 * The nine statistics per feature, over every bar of the block: moments on
 * the sample standard deviation, skewness the mean of z^3, excess kurtosis
 * the mean of z^4 minus 3, percentiles by linear interpolation.
 */
export function blockStatisticsSql(run: string, recipe: string, block: string): string {
  return `
  WITH base AS (
    SELECT feature, feature_index, value FROM ${view("block_features")}
    WHERE ${pinned(run, recipe)} AND block = ${text(block)} AND value IS NOT NULL
  ), moments AS (
    SELECT feature, count(*) AS n, avg(value) AS mean, stddev_samp(value) AS deviation FROM base GROUP BY feature
  )
  SELECT base.feature, any_value(moments.n) AS count, any_value(moments.mean) AS mean,
         quantile_cont(base.value, 0.5) AS median, any_value(moments.deviation) AS standard_deviation,
         avg(pow((base.value - moments.mean) / NULLIF(moments.deviation, 0), 3)) AS skewness,
         avg(pow((base.value - moments.mean) / NULLIF(moments.deviation, 0), 4)) - 3 AS excess_kurtosis,
         quantile_cont(base.value, 0.25) AS percentile_25, quantile_cont(base.value, 0.75) AS percentile_75,
         min(base.value) AS minimum, max(base.value) AS maximum
  FROM base JOIN moments USING (feature)
  GROUP BY base.feature ORDER BY min(base.feature_index)`;
}

function emptyBody(part: TrainingEnvironmentQuery["part"]): TrainingEnvironmentBody {
  switch (part) {
    case "overview":
      return { part, runs: [], run: null, epochs: [], blockNorms: [], batches: [], events: [], blocks: [], embeddingEpochs: [], layers: [] };
    case "bars":
      return { part, run: null, bars: [] };
    case "block":
      return { part, run: null, block: null, features: [], values: [], statistics: [] };
    case "embedding":
      return { part, run: null, epoch: null, variance_explained: null, points: [] };
    case "activations":
      return { part, run: null, epoch: null, layer: null, values: [] };
  }
}

type RunRow = TrainingRunRow & { recipe: string };

async function chooseRun(query: TrainingEnvironmentQuery, context: StudyContext): Promise<{ runs: RunRow[]; chosen: RunRow | null }> {
  const runs = await context.lake.query<RunRow>(RUNS_SQL);
  const chosen = runs.find((row) => row.run_name === query.run) ?? runs[runs.length - 1] ?? null;
  return { runs, chosen };
}

function withoutRecipe(row: RunRow): TrainingRunRow {
  const { recipe: _recipe, ...rest } = row;
  return rest;
}

async function overview(query: TrainingEnvironmentQuery, context: StudyContext): Promise<OverviewBody> {
  const { runs, chosen } = await chooseRun(query, context);
  if (!chosen) return emptyBody("overview") as OverviewBody;
  const at = pinned(chosen.run_name, chosen.recipe);
  const [epochs, blockNorms, batches, events, blocks, embeddingEpochs, layers] = await Promise.all([
    context.lake.query<EpochRow>(`SELECT epoch, epochs_configured, train_loss, direction_accuracy, majority_baseline_accuracy, skill, seconds FROM ${view("epochs")} WHERE ${at} ORDER BY epoch`),
    context.lake.query<BlockNormRow>(`SELECT epoch, block, token_norm FROM ${view("block_token_norms")} WHERE ${at} ORDER BY epoch, block`),
    context.lake.query<BatchLossRow>(`SELECT step, epoch, batch, batch_count, loss FROM ${view("batch_losses")} WHERE ${at} ORDER BY step`),
    context.lake.query<StreamEventRow>(`SELECT event_index, event_type, epoch, batch, batch_count, loss, snapshot_file, elapsed_seconds, detail FROM ${view("events")} WHERE ${at} ORDER BY event_index LIMIT ${EVENT_ROW_LIMIT}`),
    context.lake.query<BlockCatalogueRow>(`SELECT block, block_index, feature, feature_index, bar_count FROM ${view("blocks")} WHERE ${at} ORDER BY block_index, feature_index`),
    context.lake.query<EmbeddingEpochRow>(`SELECT epoch, any_value(variance_explained) AS variance_explained, count(*) AS point_count FROM ${view("embedding_points")} WHERE ${at} GROUP BY epoch ORDER BY epoch`),
    context.lake.query<LayerReadingRow>(`SELECT epoch, layer_order, layer_name, module_type, output_shape, parameter_count, mean, standard_deviation, minimum, maximum, zero_fraction, saturated_fraction, gradient_norm FROM ${view("layer_readings")} WHERE ${at} ORDER BY epoch, layer_order`),
  ]);
  if (events.length >= EVENT_ROW_LIMIT) context.notes.push(`The stream table shows the first ${EVENT_ROW_LIMIT} events of ${chosen.event_count}.`);
  return { part: "overview", runs: runs.map(withoutRecipe), run: chosen.run_name, epochs, blockNorms, batches, events, blocks, embeddingEpochs, layers };
}

async function bars(query: TrainingEnvironmentQuery, context: StudyContext): Promise<BarsBody> {
  const { chosen } = await chooseRun(query, context);
  if (!chosen) return emptyBody("bars") as BarsBody;
  const rows = await context.lake.query<BarRow>(
    `SELECT bar_index, epoch_ms("timestamp") AS timestamp_ms, open, high, low, close, volume FROM ${view("bars")} WHERE ${pinned(chosen.run_name, chosen.recipe)} ORDER BY bar_index`,
  );
  return { part: "bars", run: chosen.run_name, bars: rows };
}

async function block(query: TrainingEnvironmentQuery, context: StudyContext): Promise<BlockBody> {
  const { chosen } = await chooseRun(query, context);
  if (!chosen) return emptyBody("block") as BlockBody;
  const catalogue = await context.lake.query<BlockCatalogueRow>(
    `SELECT block, block_index, feature, feature_index, bar_count FROM ${view("blocks")} WHERE ${pinned(chosen.run_name, chosen.recipe)} ORDER BY block_index, feature_index`,
  );
  const names = [...new Set(catalogue.map((row) => row.block))];
  const name = names.includes(query.block) ? query.block : (names[0] ?? null);
  if (name === null) return { ...(emptyBody("block") as BlockBody), run: chosen.run_name };
  const features = catalogue.filter((row) => row.block === name).map((row) => row.feature);
  const [cells, statistics] = await Promise.all([
    context.lake.query<{ bar_index: number; feature_index: number; value: number | null }>(blockMatrixSql(chosen.run_name, chosen.recipe, name)),
    context.lake.query<FeatureStatistics>(blockStatisticsSql(chosen.run_name, chosen.recipe, name)),
  ]);
  const barCount = catalogue.find((row) => row.block === name)?.bar_count ?? 0;
  const values: Array<Array<number | null>> = Array.from({ length: barCount }, () => new Array<number | null>(features.length).fill(null));
  for (const cell of cells) {
    const row = values[cell.bar_index];
    if (row) row[cell.feature_index] = cell.value;
  }
  return { part: "block", run: chosen.run_name, block: name, features, values, statistics };
}

async function embedding(query: TrainingEnvironmentQuery, context: StudyContext): Promise<EmbeddingBody> {
  const { chosen } = await chooseRun(query, context);
  if (!chosen) return emptyBody("embedding") as EmbeddingBody;
  const at = pinned(chosen.run_name, chosen.recipe);
  const epochs = await context.lake.query<EmbeddingEpochRow>(
    `SELECT epoch, any_value(variance_explained) AS variance_explained, count(*) AS point_count FROM ${view("embedding_points")} WHERE ${at} GROUP BY epoch ORDER BY epoch`,
  );
  const wanted = query.epoch > 0 ? query.epoch : (epochs[epochs.length - 1]?.epoch ?? 0);
  const epoch = nearestEpoch(epochs.map((row) => row.epoch), wanted);
  if (epoch === null) return { part: "embedding", run: chosen.run_name, epoch: null, variance_explained: null, points: [] };
  const points = await context.lake.query<EmbeddingPoint>(
    `SELECT component_1, component_2, barrier_outcome, pattern_fired FROM ${view("embedding_points")} WHERE ${at} AND epoch = ${epoch} ORDER BY point_index`,
  );
  return { part: "embedding", run: chosen.run_name, epoch, variance_explained: epochs.find((row) => row.epoch === epoch)?.variance_explained ?? null, points };
}

async function activations(query: TrainingEnvironmentQuery, context: StudyContext): Promise<ActivationsBody> {
  const { chosen } = await chooseRun(query, context);
  if (!chosen) return emptyBody("activations") as ActivationsBody;
  const at = pinned(chosen.run_name, chosen.recipe);
  const layerEpochs = await context.lake.query<{ epoch: number }>(`SELECT DISTINCT epoch FROM ${view("layer_readings")} WHERE ${at} ORDER BY epoch`);
  const wanted = query.epoch > 0 ? query.epoch : (layerEpochs[layerEpochs.length - 1]?.epoch ?? 0);
  const epoch = nearestEpoch(layerEpochs.map((row) => row.epoch), wanted);
  if (epoch === null) return { part: "activations", run: chosen.run_name, epoch: null, layer: null, values: [] };
  const layerNames = await context.lake.query<{ layer_name: string }>(
    `SELECT layer_name FROM ${view("layer_readings")} WHERE ${at} AND epoch = ${epoch} ORDER BY layer_order`,
  );
  const names = layerNames.map((row) => row.layer_name);
  const layer = names.includes(query.layer) ? query.layer : (names[0] ?? null);
  if (layer === null) return { part: "activations", run: chosen.run_name, epoch, layer: null, values: [] };
  const cells = await context.lake.query<{ row_index: number; unit_index: number; activation: number | null }>(
    `SELECT row_index, unit_index, activation FROM ${view("layer_activations")} WHERE ${at} AND epoch = ${epoch} AND layer_name = ${text(layer)} ORDER BY row_index, unit_index`,
  );
  const rows = cells.reduce((most, cell) => Math.max(most, cell.row_index + 1), 0);
  const units = cells.reduce((most, cell) => Math.max(most, cell.unit_index + 1), 0);
  const values: Array<Array<number | null>> = Array.from({ length: rows }, () => new Array<number | null>(units).fill(null));
  for (const cell of cells) {
    const row = values[cell.row_index];
    if (row) row[cell.unit_index] = cell.activation;
  }
  return { part: "activations", run: chosen.run_name, epoch, layer, values };
}

const handler: StudyHandler<typeof QuerySchema, TrainingEnvironmentBody> = {
  slug: "training-environment",
  datasets: VIEWS,
  query: QuerySchema,
  // A run in progress is re-landed by build.py; the page's live refresh should see it soon.
  cacheSeconds: 20,
  async run(query, context) {
    if ((await missingViews(context, VIEWS)).length > 0) return emptyBody(query.part);
    switch (query.part) {
      case "overview":
        return overview(query, context);
      case "bars":
        return bars(query, context);
      case "block":
        return block(query, context);
      case "embedding":
        return embedding(query, context);
      case "activations":
        return activations(query, context);
    }
  },
};

export default handler;
