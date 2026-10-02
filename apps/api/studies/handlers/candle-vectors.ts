/**
 * MNQ candle vectors: how a model learns what a hammer is, and what the market
 * does around one. Replaced datalake/notebooks/mnq_candle_vectors.py.
 *
 * One request answers one `section` of the page, so a tab reads only what it
 * draws. Three kinds of source:
 *   - `derived_study_candle_vectors_<table>`: the round's results, landed from
 *     the standalone results file by packages/ml-engine/src/studies/candle_vectors/build.py
 *     (recogniser metrics, neighbour lists and tests, average paths, learned
 *     shape tables, the next-candle screen, and the section 9.1 shape-model
 *     reconstructions, which need torch and were run there).
 *   - `derived_mnq_candle_windows_<1m|1h|4h>`: every bar's 16-bar window as 64
 *     numbers, its market state and its forward path (sections 1, 4, 8, 9.1).
 *   - `derived_mnq_next_candles_<tf>`: the section 10.3 trades, net of the
 *     round-trip cost the round stored.
 * Every value that reaches SQL is parsed by the Zod query and quoted by ../sql.
 */

import { z } from "zod";
import { ident, num, text, textList } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  COMPONENTS, EMBEDDING_METHODS, EVALUATION_SETS, FORWARD_PATH_BARS, MAP_PROJECTIONS, MASKED_PRESETS, NEXT_FAMILIES,
  NEXT_SPLITS, NEXT_TIMEFRAMES, PATTERNS, PATTERN_FIRING, PROFILED_COLUMNS, RECOGNIZER_MODELS, SECTIONS, SHAPE_CLIP_AVERAGE_RANGES,
  SHAPE_MODELS, VECTOR_TIMEFRAMES, VOCABULARIES, WINDOW_BARS, forwardPathColumn, overviewTiles, shapeColumn,
  type AnatomyBar, type AnatomyBody, type Candle, type ColumnProfile, type ColumnsBody, type EvaluationBody, type EvaluationRow,
  type LearnedBody, type LearnedMapBody, type MapBody, type MapPoint, type NeighbourMember, type NeighboursBody,
  type NextPatternBody, type NextPatternOption, type NextSummaryBody, type NextTradesBody, type OverviewBody, type PathsBody,
  type PatternName, type RecogniserBody, type RecognizerMetricRow, type ReconstructionBody, type Row, type TradeSummary,
  type VectorStoreBody,
} from "@shared/studies/candle-vectors";

const DATASET = "study_candle_vectors";
export const resultView = (table: string) => `derived_${DATASET}_${table}`;
export const windowsView = (timeframe: string) => `derived_mnq_candle_windows_${timeframe}`;
export const nextCandlesView = (timeframe: string) => `derived_mnq_next_candles_${timeframe}`;

/** The notebook samples a timeframe with more rows than this before profiling its columns (section 8). */
export const PROFILE_SAMPLE_ROWS = 300_000;
const ANATOMY_BARS = 26;
const TRADE_HISTOGRAM_BINS = 60;
const MINIMUM_TRADES = 30;
/** One MNQ tick in index points (the notebook's 0.25). */
const TICK_POINTS = 0.25;

const oneOf = <T extends number>(allowed: readonly T[], fallback: T) =>
  z.coerce.number().int().refine((value) => (allowed as readonly number[]).includes(value), { message: `one of ${allowed.join(", ")}` }).default(fallback);

const query = z.object({
  section: z.enum(SECTIONS).default("overview"),
  timeframe: z.enum(VECTOR_TIMEFRAMES).default("1h"),
  pattern: z.enum(PATTERNS).default("hammer"),
  horizon: oneOf([1, 4, 12], 4),
  occurrence: z.coerce.number().int().min(1).max(10_000_000).default(1),
  projection: z.enum(MAP_PROJECTIONS).default("the recogniser's 32 internal numbers"),
  perPattern: z.coerce.number().int().min(200).max(2500).default(1200),
  model: z.enum(RECOGNIZER_MODELS).default("neural network"),
  evaluationSet: z.enum(EVALUATION_SETS).default("1m 2025 (held out)"),
  vector: z.enum(["shape", "market"]).default("shape"),
  neighbours: z.coerce.number().int().min(1).max(50).default(8),
  nearest: oneOf([5, 20, 50], 50),
  bins: z.coerce.number().int().min(10).max(80).default(40),
  vocabulary: z.enum(VOCABULARIES).default("last-three-candle vector-quantised"),
  method: z.enum(EMBEDDING_METHODS).default("last-three-candle autoencoder (8)"),
  shapeModel: z.enum(SHAPE_MODELS).default("last-three-candle autoencoder"),
  hidden: z.string().refine((value) => (MASKED_PRESETS as readonly string[]).includes(value), { message: "not a precomputed hidden set" }).default("0"),
  nextTimeframe: z.enum(NEXT_TIMEFRAMES).default("15m"),
  family: z.enum(NEXT_FAMILIES).default("TA-Lib pattern"),
  split: z.enum(NEXT_SPLITS).default("discovery"),
  candle: z.coerce.number().int().min(1).max(6).default(3),
  patternSide: z.string().max(80).regex(/^[a-z0-9_ ]+\|[a-z, ]+$/, "pattern|side").optional(),
  tail: z.coerce.number().min(90).max(100).default(98),
});
export type CandleVectorsQuery = z.infer<typeof query>;

// ---------------------------------------------------------------------------
// SQL fragments
// ---------------------------------------------------------------------------

const UTC_LABEL = (column: string) => `strftime(timezone('UTC', ${ident(column)}), '%Y-%m-%d %H:%M UTC')`;

/** The notebook's firing_mask for a pattern, as a WHERE term (a null TA-Lib value never fires). */
export function firingCondition(pattern: PatternName): string {
  const { column, sign } = PATTERN_FIRING[pattern];
  return sign === 0 ? `${ident(column)} <> 0` : `sign(${ident(column)}) = ${num(sign)}`;
}

/** 2025 firings with a whole window: the section 1 and 9.1 sliders. */
function testFiringWhere(pattern: PatternName): string {
  return `${firingCondition(pattern)} AND ${ident(shapeColumn(0, "close"))} IS NOT NULL AND sample_split = 'test'`;
}

const SHAPE_SELECT = Array.from({ length: WINDOW_BARS }, (_, index) => WINDOW_BARS - 1 - index)
  .flatMap((barsBack) => COMPONENTS.map((component) => ident(shapeColumn(barsBack, component))))
  .join(", ");

function shapeOf(row: Row): Array<Array<number | null>> {
  return Array.from({ length: WINDOW_BARS }, (_, index) => WINDOW_BARS - 1 - index).map((barsBack) =>
    COMPONENTS.map((component) => numberOrNull(row[shapeColumn(barsBack, component)])));
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampOccurrence(requested: number, count: number): number {
  return Math.max(1, Math.min(requested, Math.max(count, 1)));
}

async function count(context: StudyContext, sql: string): Promise<number> {
  const rows = await context.lake.query<{ n: number }>(sql);
  return Number(rows[0]?.n ?? 0);
}

async function landed(context: StudyContext, views: string[]): Promise<boolean> {
  return (await missingViews(context, views)).length === 0;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function overview(context: StudyContext): Promise<OverviewBody> {
  const views = [resultView("recognizer_metrics"), resultView("neighbour_forecast_evaluation"), resultView("vector_store_recall_check")];
  if (!(await landed(context, views))) return { landed: false, tiles: null };
  const [metrics, evaluation, recall] = await Promise.all([
    context.lake.query<RecognizerMetricRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[0]!)}`),
    context.lake.query<EvaluationRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[1]!)} WHERE nearest_k = 50`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[2]!)}`),
  ]);
  return { landed: true, tiles: overviewTiles(metrics, evaluation, recall) };
}

async function anatomy(q: CandleVectorsQuery, context: StudyContext): Promise<AnatomyBody> {
  const windows = windowsView(q.timeframe);
  const average = resultView("pattern_average_window");
  const empty: AnatomyBody = { landed: false, firingCount: 0, occurrence: 1, bars: [], storedVector: [], averageWindow: [] };
  if (!(await landed(context, [windows, average]))) return empty;
  const where = testFiringWhere(q.pattern);
  const firingCount = await count(context, `SELECT count(*) AS n FROM ${ident(windows)} WHERE ${where}`);
  const occurrence = clampOccurrence(q.occurrence, firingCount);
  const averageWindow = await context.lake.query<AnatomyBody["averageWindow"][number]>(
    `SELECT population, bars_back, price, mean, median, window_count FROM ${ident(average)}
     WHERE timeframe = ${text(q.timeframe)} AND population IN (${textList([q.pattern, "every bar"])}) ORDER BY population, bars_back DESC, price`,
  );
  if (firingCount === 0) return { ...empty, landed: true, averageWindow };
  const rows = await context.lake.query<Row>(`
    WITH firing AS (SELECT "timestamp" AS firing_timestamp FROM ${ident(windows)} WHERE ${where} ORDER BY "timestamp" LIMIT 1 OFFSET ${num(occurrence - 1)})
    SELECT epoch_ms(w."timestamp") AS timestamp_milliseconds, ${UTC_LABEL("timestamp")} AS time_label,
           w.open, w.high, w.low, w.close, ${SHAPE_SELECT}
    FROM ${ident(windows)} w, firing WHERE w."timestamp" <= firing.firing_timestamp
    ORDER BY w."timestamp" DESC LIMIT ${num(ANATOMY_BARS)}`);
  const ordered = [...rows].reverse();
  const bars: AnatomyBar[] = ordered.map((row) => ({
    timestamp_milliseconds: Number(row.timestamp_milliseconds), time_label: String(row.time_label),
    open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
  }));
  const last = ordered[ordered.length - 1];
  return { landed: true, firingCount, occurrence, bars, storedVector: last ? shapeOf(last) : [], averageWindow };
}

async function map(q: CandleVectorsQuery, context: StudyContext): Promise<MapBody> {
  const view = resultView("recognizer_window_map");
  if (!(await landed(context, [view]))) return { landed: false, points: [], explainedVariance: null };
  const probabilities = PATTERNS.map((pattern) => {
    const column = `neural_network_probability_${pattern}`;
    return `round(${ident(column)}, 3) AS ${ident(column)}`;
  }).join(", ");
  // Each pattern capped at the slider's count (ordinary windows at four times it), as the notebook caps it.
  const rows = await context.lake.query<Row>(`
    SELECT ${UTC_LABEL("timestamp")} AS time_label, pattern, every_pattern_on_the_bar,
           round(horizontal, 4) AS horizontal, round(vertical, 4) AS vertical,
           explained_variance_horizontal, explained_variance_vertical, ${probabilities}
    FROM ${ident(view)} WHERE projection = ${text(q.projection)}
    QUALIFY row_number() OVER (PARTITION BY pattern ORDER BY hash(bar_number))
            <= CASE WHEN pattern = 'no pattern' THEN ${num(4 * q.perPattern)} ELSE ${num(q.perPattern)} END`);
  const first = rows[0];
  const explainedVariance: [number, number] | null = first
    ? [Number(first.explained_variance_horizontal), Number(first.explained_variance_vertical)]
    : null;
  const points = rows.map(({ explained_variance_horizontal: _h, explained_variance_vertical: _v, ...point }) => point as MapPoint);
  return { landed: true, points, explainedVariance };
}

async function recogniser(q: CandleVectorsQuery, context: StudyContext): Promise<RecogniserBody> {
  const views = ["recognizer_metrics", "recognizer_score_histogram", "recognizer_feature_importance", "recognizer_training_log"].map(resultView);
  // The importance was measured for the network and the trees only; logistic regression shows the network's.
  const importanceModel = q.model === "logistic regression" ? "neural network" : q.model;
  const empty: RecogniserBody = { landed: false, metrics: [], histogram: [], importance: [], importanceModel, trainingLog: [] };
  if (!(await landed(context, views))) return empty;
  const [metrics, histogram, importance, trainingLog] = await Promise.all([
    context.lake.query<RecognizerMetricRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[0]!)} ORDER BY evaluation_set, pattern, model_name`),
    context.lake.query<RecogniserBody["histogram"][number]>(
      `SELECT population, bin_lower, bin_upper, window_count FROM ${ident(views[1]!)}
       WHERE model_name = ${text(q.model)} AND evaluation_set = ${text(q.evaluationSet)} AND pattern = ${text(q.pattern)}
       ORDER BY population, bin_lower`),
    context.lake.query<RecogniserBody["importance"][number]>(
      `SELECT bars_back, price, average_precision_drop_when_shuffled, baseline_average_precision FROM ${ident(views[2]!)}
       WHERE pattern = ${text(q.pattern)} AND model_name = ${text(importanceModel)} ORDER BY bars_back DESC, price`),
    context.lake.query<RecogniserBody["trainingLog"][number]>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[3]!)} ORDER BY epoch`),
  ]);
  return { landed: true, metrics, histogram, importance, importanceModel, trainingLog };
}

async function neighbours(q: CandleVectorsQuery, context: StudyContext): Promise<NeighboursBody> {
  const firings = resultView("neighbour_query_firings");
  const lists = resultView("neighbour_lists");
  const windows = windowsView(q.timeframe);
  const pathBars = FORWARD_PATH_BARS[q.timeframe];
  if (!(await landed(context, [firings, lists, windows]))) return { landed: false, firingCount: 0, occurrence: 1, members: [], pathBars };
  const scope = `timeframe = ${text(q.timeframe)} AND pattern = ${text(q.pattern)}`;
  const firingCount = await count(context, `SELECT count(*) AS n FROM ${ident(firings)} WHERE ${scope}`);
  const occurrence = clampOccurrence(q.occurrence, firingCount);
  if (firingCount === 0) return { landed: true, firingCount, occurrence, members: [], pathBars };
  const paths = Array.from({ length: pathBars }, (_, index) => ident(forwardPathColumn(index + 1))).join(", ");
  // rank -1 is the firing itself; its neighbours keep the builder's rank (0 = nearest).
  const rows = await context.lake.query<Row>(`
    WITH chosen AS (SELECT query_timestamp FROM ${ident(firings)} WHERE ${scope} AND occurrence = ${num(occurrence)}),
    listed AS (
      SELECT l.rank, l.neighbour_timestamp, l.squared_distance FROM ${ident(lists)} l, chosen c
      WHERE l.timeframe = ${text(q.timeframe)} AND l.vector = ${text(q.vector)} AND l.query_timestamp = c.query_timestamp
      ORDER BY l.rank LIMIT ${num(q.neighbours)}),
    members AS (
      SELECT -1 AS rank, query_timestamp AS member_timestamp, CAST(NULL AS DOUBLE) AS squared_distance FROM chosen
      UNION ALL SELECT rank, neighbour_timestamp, squared_distance FROM listed)
    SELECT m.rank, m.squared_distance, epoch_ms(w."timestamp") AS timestamp_milliseconds, ${UTC_LABEL("timestamp")} AS time_label,
           ${SHAPE_SELECT}, ${paths}
    FROM members m JOIN ${ident(windows)} w ON w."timestamp" = m.member_timestamp ORDER BY m.rank`);
  const members: NeighbourMember[] = rows.map((row) => ({
    rank: Number(row.rank), squared_distance: numberOrNull(row.squared_distance),
    timestamp_milliseconds: Number(row.timestamp_milliseconds), time_label: String(row.time_label),
    shape: shapeOf(row),
    path: Array.from({ length: pathBars }, (_, index) => numberOrNull(row[forwardPathColumn(index + 1)])),
  }));
  return { landed: true, firingCount, occurrence, members, pathBars };
}

async function paths(q: CandleVectorsQuery, context: StudyContext): Promise<PathsBody> {
  const path = resultView("pattern_average_path");
  const contextView = resultView("pattern_market_context_five_years");
  if (!(await landed(context, [path, contextView]))) return { landed: false, paths: [], context: [] };
  const [pathRows, contextRows] = await Promise.all([
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(path)} WHERE timeframe = ${text(q.timeframe)}
      AND population IN (${textList([q.pattern, "every bar"])}) ORDER BY population, bars_from_pattern`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(contextView)} WHERE timeframe = ${text(q.timeframe)}
      AND population = ${text(q.pattern)} ORDER BY feature_name`),
  ]);
  return { landed: true, paths: pathRows, context: contextRows };
}

async function evaluation(q: CandleVectorsQuery, context: StudyContext): Promise<EvaluationBody> {
  const view = resultView("neighbour_forecast_evaluation");
  if (!(await landed(context, [view]))) return { landed: false, rows: [] };
  const rows = await context.lake.query<EvaluationRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(view)}
    WHERE vector = ${text(q.vector)} AND nearest_k = ${num(q.nearest)} AND horizon_bars = ${num(q.horizon)}
      AND area_under_roc_curve IS NOT NULL ORDER BY timeframe, population`);
  return { landed: true, rows };
}

async function vectorStore(context: StudyContext): Promise<VectorStoreBody> {
  const recallView = resultView("vector_store_recall_check");
  const corporaView = resultView("corpora");
  if (!(await landed(context, [recallView, corporaView]))) return { landed: false, recall: [], corpora: [] };
  const [recall, corpora] = await Promise.all([
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(recallView)} ORDER BY timeframe, vector`),
    context.lake.query<Row>(`SELECT corpus_name, dimensions, row_count, ${UTC_LABEL("knowable_by")} AS knowable_by,
      ${UTC_LABEL("usable_from")} AS usable_from FROM ${ident(corporaView)} ORDER BY corpus_name`),
  ]);
  return { landed: true, recall, corpora };
}

/**
 * Section 8: every profiled column's histogram (clipped to its 0.1th-99.9th
 * percentiles, as numpy bins it) and eight numbers, skewness and excess
 * kurtosis from population moments as scipy computes them.
 */
async function columns(q: CandleVectorsQuery, context: StudyContext): Promise<ColumnsBody> {
  const view = windowsView(q.timeframe);
  if (!(await landed(context, [view]))) return { landed: false, sampledRows: null, totalRows: 0, profiles: [] };
  const available = new Set(await context.lake.columns(view));
  const names = PROFILED_COLUMNS.filter((name) => available.has(name));
  if (names.length === 0) return { landed: true, sampledRows: null, totalRows: 0, profiles: [] };
  const totalRows = await count(context, `SELECT count(*) AS n FROM ${ident(view)}`);
  const sampled = totalRows > PROFILE_SAMPLE_ROWS;
  if (sampled) context.notes.push(`Section 8 profiles a repeatable random sample of ${PROFILE_SAMPLE_ROWS.toLocaleString("en-US")} of the ${totalRows.toLocaleString("en-US")} ${q.timeframe} windows, as the notebook does.`);
  const bins = q.bins;
  const rows = await context.lake.query<Row>(`
    WITH sample AS MATERIALIZED (
      SELECT ${names.map((name) => `CAST(${ident(name)} AS DOUBLE) AS ${ident(name)}`).join(", ")} FROM ${ident(view)}
      ${sampled ? `USING SAMPLE reservoir(${num(PROFILE_SAMPLE_ROWS)} ROWS) REPEATABLE (7)` : ""}),
    long AS MATERIALIZED (UNPIVOT sample ON ${names.map(ident).join(", ")} INTO NAME column_name VALUE value),
    stats AS (
      SELECT column_name, count(*) AS count, avg(value) AS mean, quantile_cont(value, 0.5) AS median,
             stddev_samp(value) AS standard_deviation, quantile_cont(value, 0.25) AS percentile_25,
             quantile_cont(value, 0.75) AS percentile_75, min(value) AS minimum, max(value) AS maximum,
             quantile_cont(value, 0.001) AS clip_low, quantile_cont(value, 0.999) AS clip_high
      FROM long GROUP BY column_name),
    moments AS (
      SELECT l.column_name, avg(power(l.value - s.mean, 2)) AS m2, avg(power(l.value - s.mean, 3)) AS m3,
             avg(power(l.value - s.mean, 4)) AS m4
      FROM long l JOIN stats s USING (column_name) GROUP BY l.column_name),
    edges AS (
      SELECT column_name,
             CASE WHEN clip_high > clip_low THEN clip_low ELSE clip_low - 0.5 END AS lower_edge,
             CASE WHEN clip_high > clip_low THEN clip_high ELSE clip_high + 0.5 END AS upper_edge,
             clip_low, clip_high
      FROM stats),
    binned AS (
      SELECT l.column_name,
             LEAST(GREATEST(CAST(floor((LEAST(GREATEST(l.value, e.clip_low), e.clip_high) - e.lower_edge)
                   / (e.upper_edge - e.lower_edge) * ${num(bins)}) AS INTEGER), 0), ${num(bins - 1)}) AS bin,
             count(*) AS bin_count
      FROM long l JOIN edges e USING (column_name) GROUP BY ALL)
    SELECT b.column_name, b.bin, b.bin_count, e.lower_edge, e.upper_edge, s.count, s.mean, s.median, s.standard_deviation,
           s.percentile_25, s.percentile_75, s.minimum, s.maximum, m.m2, m.m3, m.m4
    FROM binned b JOIN stats s USING (column_name) JOIN moments m USING (column_name) JOIN edges e USING (column_name)
    ORDER BY b.column_name, b.bin`);
  const profiles = new Map<string, ColumnProfile>();
  for (const row of rows) {
    const name = String(row.column_name);
    let profile = profiles.get(name);
    if (!profile) {
      const m2 = numberOrNull(row.m2), m3 = numberOrNull(row.m3), m4 = numberOrNull(row.m4);
      const n = Number(row.count);
      const spread = m2 !== null && m2 > 0;
      const lower = Number(row.lower_edge), upper = Number(row.upper_edge);
      profile = {
        column_name: name, count: n, mean: numberOrNull(row.mean), median: numberOrNull(row.median),
        standard_deviation: numberOrNull(row.standard_deviation),
        skewness: spread && n >= 3 && m3 !== null ? m3 / m2 ** 1.5 : null,
        excess_kurtosis: spread && n >= 4 && m4 !== null ? m4 / m2 ** 2 - 3 : null,
        percentile_25: numberOrNull(row.percentile_25), percentile_75: numberOrNull(row.percentile_75),
        minimum: numberOrNull(row.minimum), maximum: numberOrNull(row.maximum),
        bins: Array.from({ length: bins }, (_, index) => ({
          lower: lower + ((upper - lower) * index) / bins, upper: lower + ((upper - lower) * (index + 1)) / bins, count: 0,
        })),
      };
      profiles.set(name, profile);
    }
    const bin = profile.bins[Number(row.bin)];
    if (bin) bin.count = Number(row.bin_count);
  }
  return {
    landed: true, sampledRows: sampled ? PROFILE_SAMPLE_ROWS : null, totalRows,
    profiles: names.map((name) => profiles.get(name)).filter((profile): profile is ColumnProfile => profile !== undefined),
  };
}

async function learned(q: CandleVectorsQuery, context: StudyContext): Promise<LearnedBody> {
  const tables = ["shape_embedding_neighbour_purity", "shape_embedding_cluster_agreement", "shape_embedding_volatility_tracking",
    "shape_embedding_linear_probe", "shape_embedding_training_log", "shape_vocabulary_codes", "shape_vocabulary_prototypes"];
  const views = tables.map(resultView);
  const empty: LearnedBody = { landed: false, purity: [], clusters: [], tracking: [], probe: [], trainingLog: [], codes: [], prototypes: [] };
  if (!(await landed(context, views))) return empty;
  const all = (view: string, order: string) => context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(view)} ORDER BY ${order}`);
  const [purity, clusters, tracking, probe, trainingLog, codes, prototypes] = await Promise.all([
    all(views[0]!, "timeframe, method, pattern"),
    all(views[1]!, "timeframe, method"),
    all(views[2]!, "timeframe, method"),
    all(views[3]!, "timeframe, method, pattern"),
    all(views[4]!, "model_name, epoch"),
    all(views[5]!, "vocabulary, code"),
    context.lake.query<Row>(`SELECT code, bars_back, price, value FROM ${ident(views[6]!)} WHERE vocabulary = ${text(q.vocabulary)}
      ORDER BY code, bars_back DESC, price`),
  ]);
  return { landed: true, purity, clusters, tracking, probe, trainingLog, codes, prototypes };
}

async function learnedMap(q: CandleVectorsQuery, context: StudyContext): Promise<LearnedMapBody> {
  const view = resultView("shape_embedding_map");
  if (!(await landed(context, [view]))) return { landed: false, points: [] };
  const vocabularyColumn = q.method.includes("three") ? "last_three_candle_vocabulary_code" : "whole_window_vocabulary_code";
  const points = await context.lake.query<LearnedMapBody["points"][number]>(`
    SELECT ${UTC_LABEL("timestamp")} AS time_label, pattern, ${ident(vocabularyColumn)} AS vocabulary_code,
           round(horizontal, 4) AS horizontal, round(vertical, 4) AS vertical
    FROM ${ident(view)} WHERE method = ${text(q.method)}`);
  return { landed: true, points };
}

async function reconstruction(q: CandleVectorsQuery, context: StudyContext): Promise<ReconstructionBody> {
  const windows = windowsView("1m");
  const view = resultView("shape_reconstructions");
  const hidden = q.shapeModel === "masked candles" ? q.hidden : "";
  const empty: ReconstructionBody = {
    landed: false, firingCount: 0, occurrence: 1, time_label: null, real: [], rebuilt: null, candlesRebuilt: 0,
    reconstructionLoss: null, vocabularyCode: null, availableHidden: [], hidden,
  };
  if (!(await landed(context, [windows, view]))) return empty;
  const where = testFiringWhere(q.pattern);
  const firingCount = await count(context, `SELECT count(*) AS n FROM ${ident(windows)} WHERE ${where}`);
  const occurrence = clampOccurrence(q.occurrence, firingCount);
  if (firingCount === 0) return { ...empty, landed: true, firingCount };
  const firing = `firing AS (SELECT "timestamp" AS firing_timestamp FROM ${ident(windows)} WHERE ${where} ORDER BY "timestamp" LIMIT 1 OFFSET ${num(occurrence - 1)})`;
  const [realRows, rebuiltRows, hiddenRows] = await Promise.all([
    context.lake.query<Row>(`WITH ${firing} SELECT ${UTC_LABEL("timestamp")} AS time_label, ${SHAPE_SELECT}
      FROM ${ident(windows)} w, firing WHERE w."timestamp" = firing.firing_timestamp`),
    context.lake.query<Row>(`WITH ${firing}
      SELECT candles_rebuilt, reconstruction_loss, vocabulary_code, UNNEST(rebuilt_open) AS open, UNNEST(rebuilt_high) AS high,
             UNNEST(rebuilt_low) AS low, UNNEST(rebuilt_close) AS close
      FROM ${ident(view)} r, firing WHERE r."timestamp" = firing.firing_timestamp
        AND r.model_name = ${text(q.shapeModel)} AND r.hidden_bars_back = ${text(hidden)}`),
    context.lake.query<{ hidden_bars_back: string }>(`WITH ${firing}
      SELECT DISTINCT hidden_bars_back FROM ${ident(view)} r, firing WHERE r."timestamp" = firing.firing_timestamp
        AND r.model_name = 'masked candles'`),
  ]);
  const realRow = realRows[0];
  const clip = (value: number | null) => (value === null ? Number.NaN : Math.max(-SHAPE_CLIP_AVERAGE_RANGES, Math.min(SHAPE_CLIP_AVERAGE_RANGES, value)));
  const real: Candle[] = realRow
    ? shapeOf(realRow).map(([open, high, low, close]) => ({ open: clip(open ?? null), high: clip(high ?? null), low: clip(low ?? null), close: clip(close ?? null) }))
    : [];
  const first = rebuiltRows[0];
  const order = (preset: string) => MASKED_PRESETS.indexOf(preset as (typeof MASKED_PRESETS)[number]);
  if (!first && q.shapeModel === "masked candles") {
    context.notes.push(`The masked-candle model was run with hidden bars back ${hidden} only for the first 100 firings of each pattern; this firing has ${hiddenRows.map((row) => row.hidden_bars_back).join(", ") || "none"}.`);
  }
  return {
    landed: true, firingCount, occurrence, time_label: realRow ? String(realRow.time_label) : null, real,
    rebuilt: rebuiltRows.length ? rebuiltRows.map((row) => ({ open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close) })) : null,
    candlesRebuilt: first ? Number(first.candles_rebuilt) : 0,
    reconstructionLoss: first ? numberOrNull(first.reconstruction_loss) : null,
    vocabularyCode: first && first.vocabulary_code !== null && first.vocabulary_code !== undefined ? Number(first.vocabulary_code) : null,
    availableHidden: hiddenRows.map((row) => row.hidden_bars_back).sort((a, b) => order(a) - order(b)),
    hidden,
  };
}

async function nextSummary(q: CandleVectorsQuery, context: StudyContext): Promise<NextSummaryBody> {
  const tables = ["next_candles_screen", "next_candles_placebo", "next_candles_frozen_rules", "next_candles_rule_trades",
    "next_candles_run_information", "next_candles_firing_counts", "next_candles_matched_baseline_fit", "next_candles_effects"];
  const views = tables.map(resultView);
  const empty: NextSummaryBody = { landed: false, screen: [], placebo: [], rules: [], ruleTrades: [], runInformation: null, testableCounts: [], baselineFit: [], detectable: [] };
  if (!(await landed(context, views))) return empty;
  const [screen, placebo, rules, ruleTrades, run, testableCounts, baselineFit, detectable] = await Promise.all([
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[0]!)} ORDER BY timeframe, family, pattern, side, question`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[1]!)} ORDER BY question, placebo_set`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[2]!)} ORDER BY rule`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[3]!)} WHERE version = 'one position at a time' ORDER BY rule, split`),
    context.lake.query<Row>(`SELECT round_trip_cost_ticks, stress_cost_ticks FROM ${ident(views[4]!)} LIMIT 1`),
    context.lake.query<{ timeframe: string; cells: number }>(`SELECT timeframe, count(DISTINCT pattern || side || family) AS cells
      FROM ${ident(views[5]!)} WHERE testable GROUP BY 1 ORDER BY 1`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[6]!)} WHERE predicted = '2024-2025' ORDER BY timeframe, measure, candle`),
    context.lake.query<Row>(`SELECT timeframe, candle, median(minimum_detectable_difference_ticks) AS median_ticks,
        quantile_cont(minimum_detectable_difference_ticks, 0.25) AS lower_quartile,
        quantile_cont(minimum_detectable_difference_ticks, 0.75) AS upper_quartile, count(*) AS pattern_sides
      FROM ${ident(views[7]!)} WHERE testable AND question = 'matched' AND measure = 'move from the next open to the close of candle k'
        AND split = ${text(q.split)} GROUP BY 1, 2 ORDER BY 1, 2`),
  ]);
  return { landed: true, screen, placebo, rules, ruleTrades, runInformation: run[0] ?? null, testableCounts, baselineFit, detectable };
}

/** "pattern|side", defaulting as the notebook does to bullish engulfing, else the most frequent side. */
function resolvePatternSide(requested: string | undefined, options: NextPatternOption[]): { pattern: string; side: string } {
  const pick = (value: string | undefined) => {
    if (!value) return null;
    const [pattern, side] = value.split("|");
    return options.find((option) => option.pattern === pattern && option.side === side) ?? null;
  };
  const chosen = pick(requested) ?? options.find((option) => option.pattern === "engulfing" && option.side === "bullish") ?? options[0];
  return chosen ? { pattern: chosen.pattern, side: chosen.side } : { pattern: "", side: "" };
}

async function patternOptions(q: CandleVectorsQuery, context: StudyContext): Promise<NextPatternOption[]> {
  const rows = await context.lake.query<NextPatternOption>(`
    SELECT pattern, side, bool_or(testable) AS testable, sum(firings_analysed) AS firings
    FROM ${ident(resultView("next_candles_firing_counts"))}
    WHERE timeframe = ${text(q.nextTimeframe)} AND family = ${text(q.family)} GROUP BY 1, 2 ORDER BY firings DESC, pattern, side`);
  return rows.map((row) => ({ pattern: String(row.pattern), side: String(row.side), testable: Boolean(row.testable), firings: Number(row.firings) }));
}

async function nextPattern(q: CandleVectorsQuery, context: StudyContext): Promise<NextPatternBody> {
  const tables = ["next_candles_firing_counts", "next_candles_average_candles", "next_candles_effects", "next_candles_bars",
    "next_candles_direction_shares", "next_candles_trades_by_pattern"];
  const views = tables.map(resultView);
  const empty: NextPatternBody = { landed: false, options: [], pattern: "", side: "", averageCandles: [], effects: [], bars: null, shares: [], grid: [], rangeEffects: [] };
  if (!(await landed(context, views))) return empty;
  const options = await patternOptions(q, context);
  const { pattern, side } = resolvePatternSide(q.patternSide, options);
  const scope = `timeframe = ${text(q.nextTimeframe)} AND family = ${text(q.family)}`;
  const chosen = `${scope} AND pattern = ${text(pattern)} AND side = ${text(side)} AND split = ${text(q.split)}`;
  const [averageCandles, effects, bars, shares, grid, rangeEffects] = await Promise.all([
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[1]!)} WHERE ${chosen} ORDER BY population, candle_offset`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[2]!)} WHERE ${chosen}
      AND measure IN ('move from the next open to the close of candle k', 'jump from the pattern close to the next open (not tradeable)')
      ORDER BY measure, question, candle`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[3]!)} WHERE timeframe = ${text(q.nextTimeframe)}`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[4]!)} WHERE ${chosen} ORDER BY direction, population, candle`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[5]!)} WHERE ${scope} AND split = ${text(q.split)} AND testable
      ORDER BY pattern, side, candle`),
    context.lake.query<Row>(`SELECT * EXCLUDE (recipe) FROM ${ident(views[2]!)} WHERE ${scope} AND split = ${text(q.split)}
      AND measure = 'range of candle k' AND question = 'matched' AND candle = ${num(q.candle)} AND testable ORDER BY pattern, side`),
  ]);
  return { landed: true, options, pattern, side, averageCandles, effects, bars: bars[0] ?? null, shares, grid, rangeEffects };
}

/**
 * Which candles of `derived_mnq_next_candles_<tf>` a pattern side fires on, as the notebook's 10.3 masks them;
 * null for a side the notebook has no mask for (the caller notes it instead of failing).
 */
export function sideCondition(side: string, column: string): string | null {
  const value = `coalesce(${ident(column)}, 0)`;
  const masks: Record<string, string> = {
    fires: `${value} <> 0`, "up candle": `${value} > 0`, "down candle": `${value} < 0`, bullish: `${value} > 0`, bearish: `${value} < 0`,
    "breakout, bullish": `${value} = 100`, "breakout, bearish": `${value} = -100`,
    "confirmed, bullish": `${value} = 200`, "confirmed, bearish": `${value} = -200`,
  };
  return new Map(Object.entries(masks)).get(side) ?? null;
}

async function nextTrades(q: CandleVectorsQuery, context: StudyContext): Promise<NextTradesBody> {
  const view = nextCandlesView(q.nextTimeframe);
  const empty: NextTradesBody = { landed: false, enoughTrades: false, direction: 1, costTicks: null, firingTrades: 0, histogram: [], summary: [] };
  if (!(await landed(context, [view, resultView("next_candles_firing_counts"), resultView("next_candles_run_information"), resultView("pattern_candle_counts")]))) return empty;
  const options = await patternOptions(q, context);
  const { pattern, side } = resolvePatternSide(q.patternSide, options);
  if (!pattern) return { ...empty, landed: true };
  const available = new Set(await context.lake.columns(view));
  const run = await context.lake.query<{ round_trip_cost_ticks: number }>(`SELECT round_trip_cost_ticks FROM ${ident(resultView("next_candles_run_information"))} LIMIT 1`);
  const cost = Number(run[0]?.round_trip_cost_ticks ?? Number.NaN);
  let mask: string;
  let candles: number;
  let direction: 1 | -1 = 1;
  if (q.family === "TA-Lib pattern") {
    const counts = await context.lake.query<{ column_name: string; candles: number; hikkake_confirmation_bars: number }>(
      `SELECT column_name, candles, hikkake_confirmation_bars FROM ${ident(resultView("pattern_candle_counts"))} WHERE pattern = ${text(pattern)}`);
    const found = counts[0];
    if (!found || !available.has(found.column_name)) {
      context.notes.push(`No TA-Lib column for ${pattern} in ${view}, so its trades cannot be drawn.`);
      return { ...empty, landed: true, direction };
    }
    const sideMask = sideCondition(side, found.column_name);
    if (sideMask === null) {
      context.notes.push(`"${side}" is not a pattern side the round tested, so its trades cannot be drawn.`);
      return { ...empty, landed: true, direction };
    }
    mask = sideMask;
    candles = Number(found.candles) + (side.startsWith("confirmed") ? Number(found.hikkake_confirmation_bars) : 0);
    direction = side.includes("bearish") ? -1 : 1;
  } else {
    const column = q.family.startsWith("three") ? "last_three_candle_vocabulary_code" : "whole_window_vocabulary_code";
    const code = Number(pattern.split(" ").pop());
    if (!Number.isInteger(code) || !available.has(column)) {
      context.notes.push(`"${pattern}" is not a shape code with a column in ${view}, so its trades cannot be drawn.`);
      return { ...empty, landed: true, direction };
    }
    mask = `coalesce(${ident(column)}, -1) = ${num(code)}`;
    candles = column.startsWith("last") ? 3 : 16;
  }
  const closeColumn = `next_candle_${q.candle}_close_from_close_in_average_ranges`;
  const openColumn = "next_candle_1_open_from_close_in_average_ranges";
  // The subtraction runs in single precision as the notebook's float32 columns do, then scales to ticks.
  const trades = `
    base AS (
      SELECT CAST(${ident(closeColumn)} - ${ident(openColumn)} AS DOUBLE) * average_range_10_bars / ${num(TICK_POINTS)} AS move,
             (${mask}) AND bars_since_session_break >= ${num(candles - 1)} AS fires
      FROM ${ident(view)}
      WHERE average_range_10_bars IS NOT NULL AND control_signed_body IS NOT NULL AND sample_split = ${text(q.split)}),
    trades AS (
      SELECT 'firings' AS population, ${num(direction)} * move - ${num(cost)} AS net FROM base WHERE fires AND isfinite(${num(direction)} * move - ${num(cost)})
      UNION ALL
      SELECT 'every bar' AS population, ${num(direction)} * move - ${num(cost)} AS net FROM base WHERE isfinite(${num(direction)} * move - ${num(cost)}))`;
  const lowTail = (100 - q.tail) / 2 / 100;
  const stats = await context.lake.query<Row>(`
    WITH ${trades},
    bounds AS (SELECT quantile_cont(net, ${num(lowTail)}) AS low, quantile_cont(net, ${num(1 - lowTail)}) AS high FROM trades),
    summary AS (
      SELECT population, count(*) AS finite_count, avg(net) AS mean, quantile_cont(net, 0.5) AS median,
             stddev_samp(net) AS standard_deviation, quantile_cont(net, 0.25) AS percentile_25, quantile_cont(net, 0.75) AS percentile_75,
             min(net) AS minimum, max(net) AS maximum, avg(CASE WHEN net > 0 THEN 1.0 ELSE 0.0 END) AS share_net_positive
      FROM trades GROUP BY population),
    moments AS (
      SELECT t.population, avg(power(t.net - s.mean, 2)) AS m2, avg(power(t.net - s.mean, 3)) AS m3, avg(power(t.net - s.mean, 4)) AS m4
      FROM trades t JOIN summary s USING (population) GROUP BY t.population)
    SELECT s.*, m.m2, m.m3, m.m4, b.low, b.high FROM summary s JOIN moments m USING (population), bounds b`);
  const firingStats = stats.find((row) => row.population === "firings");
  const firingTrades = Number(firingStats?.finite_count ?? 0);
  if (firingTrades < MINIMUM_TRADES) return { landed: true, enoughTrades: false, direction, costTicks: cost, firingTrades, histogram: [], summary: [] };
  const low = Number(stats[0]?.low), high = Number(stats[0]?.high);
  const width = (high - low) / TRADE_HISTOGRAM_BINS;
  const binRows = await context.lake.query<{ population: "firings" | "every bar"; bin: number; share: number }>(`
    WITH ${trades},
    sizes AS (SELECT population, count(*) AS n FROM trades GROUP BY population)
    SELECT t.population,
           LEAST(GREATEST(CAST(floor((LEAST(GREATEST(t.net, ${num(low)}), ${num(high)}) - ${num(low)}) / ${num(width > 0 ? width : 1)}) AS INTEGER), 0), ${num(TRADE_HISTOGRAM_BINS - 1)}) AS bin,
           count(*) / any_value(z.n) AS share
    FROM trades t JOIN sizes z USING (population) GROUP BY ALL ORDER BY 1, 2`);
  const shareOf = new Map(binRows.map((row) => [`${row.population}|${row.bin}`, Number(row.share)]));
  const histogram: NextTradesBody["histogram"] = [];
  for (const population of ["firings", "every bar"] as const) {
    for (let bin = 0; bin < TRADE_HISTOGRAM_BINS; bin += 1) {
      histogram.push({ population, net_ticks: low + width * (bin + 0.5), share_of_trades: shareOf.get(`${population}|${bin}`) ?? 0 });
    }
  }
  const round = (value: number | null) => (value === null ? null : Math.round(value * 1000) / 1000);
  const summary: TradeSummary[] = (["firings", "every bar"] as const).map((population) => {
    const row = stats.find((candidate) => candidate.population === population) ?? {};
    const n = Number(row.finite_count ?? 0);
    const m2 = numberOrNull(row.m2), m3 = numberOrNull(row.m3), m4 = numberOrNull(row.m4);
    const spread = m2 !== null && m2 > 0;
    return {
      population, finite_count: n, mean: round(numberOrNull(row.mean)), median: round(numberOrNull(row.median)),
      standard_deviation: n > 1 ? round(numberOrNull(row.standard_deviation)) : null,
      skewness: spread && n >= 3 && m3 !== null ? round(m3 / m2 ** 1.5) : null,
      excess_kurtosis: spread && n >= 4 && m4 !== null ? round(m4 / m2 ** 2 - 3) : null,
      percentile_25: round(numberOrNull(row.percentile_25)), percentile_75: round(numberOrNull(row.percentile_75)),
      minimum: round(numberOrNull(row.minimum)), maximum: round(numberOrNull(row.maximum)),
      share_net_positive: round(numberOrNull(row.share_net_positive)),
    };
  });
  return { landed: true, enoughTrades: true, direction, costTicks: cost, firingTrades, histogram, summary };
}

// ---------------------------------------------------------------------------

const RESULT_TABLES = [
  "recognizer_metrics", "recognizer_score_histogram", "recognizer_feature_importance", "recognizer_training_log", "recognizer_window_map",
  "neighbour_forecast_evaluation", "neighbour_lists", "neighbour_query_firings", "vector_store_recall_check", "corpora",
  "pattern_average_window", "pattern_average_path", "pattern_market_context_five_years",
  "shape_embedding_neighbour_purity", "shape_embedding_cluster_agreement", "shape_embedding_linear_probe",
  "shape_embedding_volatility_tracking", "shape_embedding_training_log", "shape_embedding_map",
  "shape_vocabulary_codes", "shape_vocabulary_prototypes", "shape_reconstructions", "pattern_candle_counts",
  "next_candles_screen", "next_candles_placebo", "next_candles_frozen_rules", "next_candles_rule_trades",
  "next_candles_average_candles", "next_candles_effects", "next_candles_direction_shares", "next_candles_firing_counts",
  "next_candles_trades_by_pattern", "next_candles_matched_baseline_fit", "next_candles_bars", "next_candles_run_information",
];

const handler: StudyHandler<typeof query> = {
  slug: "candle-vectors",
  datasets: [
    ...RESULT_TABLES.map(resultView),
    ...VECTOR_TIMEFRAMES.map(windowsView),
    ...NEXT_TIMEFRAMES.map(nextCandlesView),
  ],
  query,
  cacheSeconds: 900,
  timeoutMs: 120_000,
  async run(q, context) {
    switch (q.section) {
      case "overview": return overview(context);
      case "anatomy": return anatomy(q, context);
      case "map": return map(q, context);
      case "recogniser": return recogniser(q, context);
      case "neighbours": return neighbours(q, context);
      case "paths": return paths(q, context);
      case "evaluation": return evaluation(q, context);
      case "vectorStore": return vectorStore(context);
      case "columns": return columns(q, context);
      case "learned": return learned(q, context);
      case "learnedMap": return learnedMap(q, context);
      case "reconstruction": return reconstruction(q, context);
      case "nextSummary": return nextSummary(q, context);
      case "nextPattern": return nextPattern(q, context);
      case "nextTrades": return nextTrades(q, context);
      default: throw new Error("unknown section");
    }
  },
};

export default handler;
