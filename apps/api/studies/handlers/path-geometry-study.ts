/**
 * Path geometry on MNQ 1m: "rise over run" as shape (the efficiency ratio),
 * whether it forecasts future path shape (four targets, all null), and whether
 * the direction label sits on the right bar. Replaced
 * Trading/quant/model/notebooks/path_geometry_study.py.
 *
 * Sections 1 to 3 and 5 are live SQL over `mnq_ohlcv_1m` (the same series the
 * notebook loaded from the retired parquet tree: volume > 0 and every price
 * > 0, then the most recent `bars` rows). The efficiency ratio is a trailing
 * window sum, so the read is one scan per query. Section 4 reads the landed
 * `derived_study_path_geometry_study_{targets,folds}` (built by
 * packages/ml-engine/src/studies/path_geometry_study/build.py from the four best_meta.json
 * files of scripts/train_path_geometry.py, training is minutes of ridge and
 * gradient boosting and never belongs in a web request).
 *
 * Futures timestamps in the lake are Pacific wall clock stored as UTC, so the
 * "hour" of a bar is the wall-clock hour as stamped.
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident, num, text } from "../sql";
import type { StudyContext, StudyHandler } from "../types";
import {
  DEFAULT_WINDOWS, DELTA_BINS, DELTA_LIMIT, FRAME_ROWS, HISTOGRAM_BINS, HISTOGRAM_LIMIT, emptyBody, randomWalkNull,
  type Distribution, type ExtremeWindow, type FoldRow, type LabelSummary, type LakeLabelCheck, type PathGeometryBody,
  type SliceBars, type TargetRow, type WindowHistogram, type WindowStatistics,
} from "@shared/studies/path-geometry-study";

export const BARS_VIEW = "mnq_ohlcv_1m";
export const TARGETS_VIEW = "derived_study_path_geometry_study_targets";
export const FOLDS_VIEW = "derived_study_path_geometry_study_folds";
export const LABELS_VIEW = "derived_labels";
const SYMBOL = "MNQ";
const QUERY_TIMEOUT_MS = 100_000;

function parseWindows(raw: string): number[] {
  return [...new Set(raw.split(",").map((part) => Number(part)))].sort((a, b) => a - b);
}

export const pathGeometryQuery = z.object({
  /** How many of the most recent bars to read (the notebook's max_bars = 400,000). */
  bars: z.coerce.number().int().min(20_000).max(2_400_000).default(400_000),
  /** Comma-separated window lengths for sections 2 and 3. */
  windows: z
    .string()
    .regex(/^\d{1,4}(,\d{1,4}){0,5}$/)
    .default(DEFAULT_WINDOWS.join(","))
    .transform(parseWindows)
    .refine((list) => list.every((value) => Number.isInteger(value) && value >= 2 && value <= 2880), { message: "each window is 2 to 2880 bars" }),
  /** The window length whose straightest and choppiest instances section 1 draws. */
  extremeWindow: z.coerce.number().int().min(5).max(1440).default(60),
  /** Bars ahead the direction label looks (section 5). */
  horizon: z.coerce.number().int().min(1).max(1440).default(60),
  /** Labels whose move is smaller than this many points are left out (0 uses every bar). */
  flatThreshold: z.coerce.number().min(0).max(50).default(0),
  /** Short horizon for the candlestick chart, so the bar each arrow refers to is on screen. */
  showHorizon: z.coerce.number().int().min(1).max(240).default(10),
  /** Candles drawn in the candlestick chart. */
  showBars: z.coerce.number().int().min(20).max(120).default(45),
  /** Bars of the price-and-arrows chart. */
  segmentBars: z.coerce.number().int().min(100).max(1000).default(400),
  /** Where in the loaded bars the inspection slices start (0.5 is the middle). */
  position: z.coerce.number().min(0).max(0.95).default(0.5),
});

export type PathGeometryQuery = z.infer<typeof pathGeometryQuery>;

// ── SQL ────────────────────────────────────────────────────────────────────

const FILTERS = "symbol = 'MNQ' AND volume > 0 AND open > 0 AND high > 0 AND low > 0 AND close > 0";

/** The loader's filters, then the most recent `count` bars in time order, numbered from 1. */
export function barsCte(count: number): string {
  return `bars AS (SELECT row_number() OVER (ORDER BY t) AS i, t, open, high, low, close, volume FROM (`
    + `SELECT epoch_ms(timestamp) AS t, open, high, low, close, volume FROM ${ident(BARS_VIEW)} WHERE ${FILTERS} `
    + `ORDER BY timestamp DESC LIMIT ${num(count)}) ORDER BY t)`;
}

export function availableSql(): string {
  return `SELECT count(*) AS available FROM ${ident(BARS_VIEW)} WHERE ${FILTERS}`;
}

/**
 * Per-bar efficiency ratio for each window: |ln p_t - ln p_(t-W)| over the sum
 * of the last W absolute log steps, null until W full steps exist and while
 * the path is (numerically) zero. `frameHorizon` adds the forward close change.
 */
export function efficiencyCte(windows: readonly number[], frameHorizon?: number): string {
  const frames = [...windows.map((w) => `w${w} AS (ORDER BY i ROWS BETWEEN ${num(w - 1)} PRECEDING AND CURRENT ROW)`), "o AS (ORDER BY i)"].join(", ");
  const columns = windows.map((w) => {
    const net = `abs(lp - lag(lp, ${num(w)}) OVER o)`;
    return `CASE WHEN count(step) OVER w${w} = ${num(w)} AND ${net} IS NOT NULL AND sum(step) OVER w${w} > 1e-12 THEN ${net} / sum(step) OVER w${w} END AS er_${w}`;
  });
  const forward = frameHorizon === undefined ? "" : `, lead(close, ${num(frameHorizon)}) OVER (ORDER BY i) - close AS forward_delta`;
  return `steps AS (SELECT i, t, open, high, low, close, volume, ln(close) AS lp, ln(close) - lag(ln(close)) OVER (ORDER BY i) AS log_return, `
    + `abs(ln(close) - lag(ln(close)) OVER (ORDER BY i)) AS step${forward} FROM bars), `
    + `er AS (SELECT i, t, open, high, low, close, volume, log_return, ${frameHorizon === undefined ? "" : "forward_delta, "}${columns.join(", ")} FROM steps WINDOW ${frames})`;
}

function distributionColumns(expression: string, alias: string): string {
  return [
    `count(${expression}) AS ${alias}_count`,
    `avg(${expression}) AS ${alias}_mean`,
    `quantile_cont(${expression}, 0.5) AS ${alias}_median`,
    `stddev_samp(${expression}) AS ${alias}_sd`,
    `skewness(${expression}) AS ${alias}_skew`,
    `kurtosis(${expression}) AS ${alias}_kurt`,
    `quantile_cont(${expression}, 0.25) AS ${alias}_p25`,
    `quantile_cont(${expression}, 0.75) AS ${alias}_p75`,
    `quantile_cont(${expression}, 0.95) AS ${alias}_p95`,
    `min(${expression}) AS ${alias}_min`,
    `max(${expression}) AS ${alias}_max`,
  ].join(", ");
}

export function statisticsSql(count: number, windows: readonly number[]): string {
  const select = windows
    .map((w) => `${distributionColumns(`er_${w}`, `e${w}`)}, ${distributionColumns(`er_${w} * sqrt(${num(w)})`, `n${w}`)}`)
    .join(", ");
  return `WITH ${barsCte(count)}, ${efficiencyCte(windows)} SELECT ${select} FROM er`;
}

export function histogramSql(count: number, windows: readonly number[]): string {
  const width = `(${num(HISTOGRAM_LIMIT)}.0 / ${num(HISTOGRAM_BINS)})`;
  const parts = windows.map(
    (w) => `SELECT ${num(w)} AS w, least(floor(er_${w} * sqrt(${num(w)}) / ${width}), ${num(HISTOGRAM_BINS - 1)})::INTEGER AS bin, count(*) AS c FROM er `
      + `WHERE er_${w} IS NOT NULL AND er_${w} * sqrt(${num(w)}) <= ${num(HISTOGRAM_LIMIT)} GROUP BY 1, 2`,
  );
  return `WITH ${barsCte(count)}, ${efficiencyCte(windows)} ${parts.join(" UNION ALL ")}`;
}

/** The first bar with the highest and the first with the lowest efficiency ratio at one window. */
export function extremesSql(count: number, window: number): string {
  return `WITH ${barsCte(count)}, ${efficiencyCte([window])} `
    + `(SELECT 'straightest' AS kind, i, t, er_${window} AS er FROM er WHERE er_${window} IS NOT NULL ORDER BY er_${window} DESC, i ASC LIMIT 1) `
    + `UNION ALL (SELECT 'choppiest' AS kind, i, t, er_${window} AS er FROM er WHERE er_${window} IS NOT NULL ORDER BY er_${window} ASC, i ASC LIMIT 1)`;
}

/** The W + 1 closes ending at each given bar number (1-based). */
export function windowClosesSql(count: number, window: number, ends: readonly number[]): string {
  const ranges = ends.map((end) => `(i BETWEEN ${num(end - window)} AND ${num(end)})`).join(" OR ");
  return `WITH ${barsCte(count)} SELECT i, t, close FROM bars WHERE ${ranges} ORDER BY i`;
}

export function frameSql(count: number, windows: readonly number[], horizon: number, step: number): string {
  const efficiency = windows.flatMap((w) => [`er_${w} AS efficiency_ratio_${w}_bars`, `er_${w} * sqrt(${num(w)}) AS efficiency_ratio_vs_random_walk_${w}_bars`]);
  return `WITH ${barsCte(count)}, ${efficiencyCte(windows, horizon)} `
    + `SELECT open, high, low, close, volume, log_return AS close_to_close_log_return, ${efficiency.join(", ")}, forward_delta AS forward_close_change_points_${horizon}_bars `
    + `FROM er WHERE i % ${num(step)} = 0 ORDER BY i`;
}

/** Bars with the close `horizon` bars ahead (lead) and `show` bars ahead; the labelling base of section 5. */
export function labelCte(horizon: number, show: number): string {
  return `lab AS (SELECT i, t, open, close, lead(close, ${num(horizon)}) OVER (ORDER BY i) AS ahead, lead(close, ${num(show)}) OVER (ORDER BY i) AS show_ahead FROM bars)`;
}

export function labelSummarySql(count: number, horizon: number, show: number, flat: number): string {
  const kept = `ahead IS NOT NULL AND abs(ahead - close) >= ${num(flat)}`;
  const shown = `show_ahead IS NOT NULL AND abs(show_ahead - close) >= ${num(flat)}`;
  return `WITH ${barsCte(count)}, ${labelCte(horizon, show)} SELECT count(*) AS bar_count, min(t) AS first_ms, max(t) AS last_ms, count(ahead) AS finite_count, `
    + `count(*) FILTER (WHERE ${kept} AND ahead > close) AS up_count, count(*) FILTER (WHERE ${kept} AND NOT ahead > close) AS down_count, `
    + `count(*) FILTER (WHERE ahead IS NOT NULL AND abs(ahead - close) < ${num(flat)}) AS flat_count, `
    + `count(*) FILTER (WHERE i > ${num(Math.max(0, count - horizon))} AND ahead IS NOT NULL) AS tail_labelled_count, `
    + `quantile_cont(abs(ahead - close), 0.5) AS median_absolute_move, `
    + `count(*) FILTER (WHERE ${shown}) AS agreement_checked, `
    + `count(*) FILTER (WHERE ${shown} AND ((close >= open) = (show_ahead > close))) AS agreement_count FROM lab`;
}

/** Every labelled bar re-derived by joining on position (i + H), and against a label shifted one bar further. */
export function alignmentSql(count: number, horizon: number, flat: number): string {
  return `WITH ${barsCte(count)}, ${labelCte(horizon, 1)} SELECT count(*) AS checked, `
    + `count(*) FILTER (WHERE (l.ahead > l.close) != (b2.close > l.close)) AS mismatches, `
    + `count(b3.i) AS off_by_one_checked, count(*) FILTER (WHERE b3.i IS NOT NULL AND (b3.close > l.close) != (l.ahead > l.close)) AS off_by_one_mismatches `
    + `FROM lab l JOIN bars b2 ON b2.i = l.i + ${num(horizon)} LEFT JOIN bars b3 ON b3.i = l.i + ${num(horizon + 1)} `
    + `WHERE l.ahead IS NOT NULL AND abs(l.ahead - l.close) >= ${num(flat)}`;
}

export function hourSql(count: number, horizon: number, flat: number): string {
  return `WITH ${barsCte(count)}, ${labelCte(horizon, 1)} SELECT ((t // 3600000) % 24)::INTEGER AS hour, count(*) AS n, count(*) FILTER (WHERE ahead > close) AS up `
    + `FROM lab WHERE ahead IS NOT NULL AND abs(ahead - close) >= ${num(flat)} GROUP BY 1 ORDER BY 1`;
}

export function deltaSql(count: number, horizon: number): string {
  const width = `(${num(2 * DELTA_LIMIT)}.0 / ${num(DELTA_BINS)})`;
  return `WITH ${barsCte(count)}, ${labelCte(horizon, 1)} SELECT least(floor((ahead - close + ${num(DELTA_LIMIT)}) / ${width}), ${num(DELTA_BINS - 1)})::INTEGER AS bin, count(*) AS c `
    + `FROM lab WHERE ahead IS NOT NULL AND ahead - close BETWEEN -${num(DELTA_LIMIT)} AND ${num(DELTA_LIMIT)} GROUP BY 1 ORDER BY 1`;
}

export function sliceSql(count: number, start: number, rows: number): string {
  return `WITH ${barsCte(count)} SELECT t, open, high, low, close FROM bars WHERE i > ${num(start)} AND i <= ${num(start + rows)} ORDER BY i`;
}

/** The landed direction label set for MNQ 1m: its recipe and the bars it looks ahead. */
export function landedRecipeSql(): string {
  return `SELECT recipe, max(resolution_bars) AS horizon FROM ${ident(LABELS_VIEW)} WHERE symbol = 'MNQ' AND recipe LIKE 'direction_MNQ_1m_%' GROUP BY recipe ORDER BY count(*) DESC, recipe LIMIT 1`;
}

/** Signed labels of the landed set against the sign of the forward close change, recomputed here. */
export function landedCheckSql(count: number, recipe: string, horizon: number): string {
  return `WITH ${barsCte(count)}, ${labelCte(horizon, 1)} SELECT count(*) AS directional, `
    + `count(*) FILTER (WHERE (d.label > 0) != (l.ahead > l.close)) AS disagreements FROM lab l `
    + `JOIN ${ident(LABELS_VIEW)} d ON d.recipe = ${text(recipe)} AND d.symbol = 'MNQ' AND epoch_ms(d.timestamp) = l.t `
    + `WHERE l.ahead IS NOT NULL AND d.label <> 0`;
}

// ── reading rows ───────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readDistribution(row: Row, alias: string): Distribution {
  return {
    count: integer(row[`${alias}_count`]),
    mean: number(row[`${alias}_mean`]),
    median: number(row[`${alias}_median`]),
    standardDeviation: number(row[`${alias}_sd`]),
    skewness: number(row[`${alias}_skew`]),
    kurtosis: number(row[`${alias}_kurt`]),
    percentile25: number(row[`${alias}_p25`]),
    percentile75: number(row[`${alias}_p75`]),
    percentile95: number(row[`${alias}_p95`]),
    minimum: number(row[`${alias}_min`]),
    maximum: number(row[`${alias}_max`]),
  };
}

function readStatistics(row: Row | undefined, windows: readonly number[]): WindowStatistics[] {
  if (!row) return [];
  return windows.map((window) => ({
    window,
    nullRatio: randomWalkNull(window),
    efficiency: readDistribution(row, `e${window}`),
    normalized: readDistribution(row, `n${window}`),
  }));
}

function readHistograms(rows: Row[], windows: readonly number[]): WindowHistogram[] {
  return windows.map((window) => {
    const counts = new Array<number>(HISTOGRAM_BINS).fill(0);
    for (const row of rows) {
      if (integer(row.w) !== window) continue;
      const bin = integer(row.bin);
      if (bin >= 0 && bin < HISTOGRAM_BINS) counts[bin] = integer(row.c);
    }
    return { window, inRangeCount: counts.reduce((sum, value) => sum + value, 0), counts };
  });
}

async function readExtremes(context: StudyContext, loaded: number, window: number): Promise<{ straightest: ExtremeWindow | null; choppiest: ExtremeWindow | null }> {
  const picks = await context.lake.query<Row>(extremesSql(loaded, window), QUERY_TIMEOUT_MS);
  const byKind = new Map(picks.map((row) => [String(row.kind), row]));
  const ends = picks.map((row) => integer(row.i));
  if (ends.length === 0) return { straightest: null, choppiest: null };
  const closes = await context.lake.query<Row>(windowClosesSql(loaded, window, ends), QUERY_TIMEOUT_MS);
  const build = (kind: string): ExtremeWindow | null => {
    const pick = byKind.get(kind);
    if (!pick) return null;
    const end = integer(pick.i);
    const inside = closes.filter((row) => integer(row.i) >= end - window && integer(row.i) <= end);
    return {
      index: end - 1,
      timestampMs: integer(pick.t),
      efficiency: number(pick.er) ?? 0,
      closes: inside.map((row) => number(row.close) ?? 0),
      timestamps: inside.map((row) => integer(row.t)),
    };
  };
  return { straightest: build("straightest"), choppiest: build("choppiest") };
}

function readLabels(row: Row | undefined, alignment: Row | undefined, query: PathGeometryQuery): LabelSummary | null {
  if (!row) return null;
  return {
    horizon: query.horizon,
    flatThreshold: query.flatThreshold,
    barCount: integer(row.bar_count),
    finiteCount: integer(row.finite_count),
    upCount: integer(row.up_count),
    downCount: integer(row.down_count),
    flatCount: integer(row.flat_count),
    tailLabelledCount: integer(row.tail_labelled_count),
    alignmentChecked: integer(alignment?.checked),
    alignmentMismatches: integer(alignment?.mismatches),
    offByOneChecked: integer(alignment?.off_by_one_checked),
    offByOneMismatches: integer(alignment?.off_by_one_mismatches),
    medianAbsoluteMove: number(row.median_absolute_move),
    showHorizon: query.showHorizon,
    agreementChecked: integer(row.agreement_checked),
    agreementCount: integer(row.agreement_count),
  };
}

async function readLandedCheck(context: StudyContext, loaded: number): Promise<LakeLabelCheck | null> {
  if (!(await context.lake.hasView(LABELS_VIEW))) {
    context.notes.push(`${LABELS_VIEW} is not served, so the landed label set was not cross-checked against the bars.`);
    return null;
  }
  const [recipeRow] = await context.lake.query<Row>(landedRecipeSql(), QUERY_TIMEOUT_MS);
  const recipe = typeof recipeRow?.recipe === "string" ? recipeRow.recipe : "";
  const horizon = integer(recipeRow?.horizon);
  if (!/^[A-Za-z0-9_]+$/.test(recipe) || horizon < 1) return null;
  try {
    const [check] = await context.lake.query<Row>(landedCheckSql(loaded, recipe, horizon), QUERY_TIMEOUT_MS);
    return { recipe, horizon, directionalChecked: integer(check?.directional), signDisagreements: integer(check?.disagreements) };
  } catch (error) {
    context.notes.push(`The landed label set ${recipe} could not be read, so it was not cross-checked: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
    return null;
  }
}

/**
 * The rows of the newest recipe of a landed table. The recipe is picked here,
 * not in SQL: the dashboard's DuckDB raises an internal error on an aggregate
 * or predicate over the hive `recipe` column of a manifested view.
 */
function newestRecipe<T extends { recipe?: unknown }>(rows: T[]): Array<Omit<T, "recipe">> {
  const recipes = rows.map((row) => String(row.recipe ?? ""));
  const newest = recipes.reduce((best, recipe) => (recipe > best ? recipe : best), "");
  return rows
    .filter((_, index) => recipes[index] === newest)
    .map((row) => {
      const { recipe: _recipe, ...rest } = row;
      void _recipe;
      return rest;
    });
}

async function readResults(context: StudyContext): Promise<{ targets: TargetRow[]; folds: FoldRow[] }> {
  if ((await missingViews(context, [TARGETS_VIEW, FOLDS_VIEW])).length > 0) return { targets: [], folds: [] };
  try {
    const [targets, folds] = await Promise.all([
      context.lake.query<TargetRow & { recipe?: unknown }>(`SELECT * FROM ${ident(TARGETS_VIEW)} ORDER BY target`),
      context.lake.query<FoldRow & { recipe?: unknown }>(`SELECT * FROM ${ident(FOLDS_VIEW)} ORDER BY target, fold`),
    ]);
    return { targets: newestRecipe(targets) as TargetRow[], folds: newestRecipe(folds) as FoldRow[] };
  } catch (error) {
    context.notes.push(`The landed forecast results could not be read: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
    return { targets: [], folds: [] };
  }
}

// ── the handler ────────────────────────────────────────────────────────────

const handler: StudyHandler<typeof pathGeometryQuery, PathGeometryBody> = {
  slug: "path-geometry-study",
  datasets: [BARS_VIEW, TARGETS_VIEW, FOLDS_VIEW, LABELS_VIEW],
  query: pathGeometryQuery,
  cacheSeconds: 600,
  async run(query, context) {
    const body = emptyBody();
    const results = await readResults(context);
    body.targets = results.targets;
    body.folds = results.folds;
    if ((await missingViews(context, [BARS_VIEW])).length > 0) return body;

    const [availableRow] = await context.lake.query<Row>(availableSql(), QUERY_TIMEOUT_MS);
    const available = integer(availableRow?.available);
    const loaded = Math.min(query.bars, available);
    if (loaded < 1) {
      context.notes.push("No MNQ one-minute bars pass the loader's filters.");
      return body;
    }
    const windows = query.windows;
    const need = Math.max(query.segmentBars, 12, query.showBars, 15) + Math.max(query.horizon, query.showHorizon);
    const sliceRows = Math.min(need, loaded);
    const sliceStart = Math.max(0, Math.min(Math.floor(loaded * query.position), loaded - sliceRows));
    const frameStep = Math.max(1, Math.floor(loaded / FRAME_ROWS));
    const run = <T extends Row>(sql: string) => context.lake.query<T>(sql, QUERY_TIMEOUT_MS);

    // A few queries at a time: each scans the bar view, and a dozen at once can starve the lake's object server.
    const [statisticsRows, histogramRows, frameRows] = await Promise.all([
      run(statisticsSql(loaded, windows)),
      run(histogramSql(loaded, windows)),
      run<Record<string, number | null>>(frameSql(loaded, windows, query.horizon, frameStep)),
    ]);
    const [extremes, summaryRows, alignmentRows] = await Promise.all([
      readExtremes(context, loaded, query.extremeWindow),
      run(labelSummarySql(loaded, query.horizon, query.showHorizon, query.flatThreshold)),
      run(alignmentSql(loaded, query.horizon, query.flatThreshold)),
    ]);
    const [hourRows, deltaRows, sliceRowsRaw, landed] = await Promise.all([
      run(hourSql(loaded, query.horizon, query.flatThreshold)),
      run(deltaSql(loaded, query.horizon)),
      run(sliceSql(loaded, sliceStart, sliceRows)),
      readLandedCheck(context, loaded),
    ]);

    body.bars = { requested: query.bars, loaded, available, firstMs: number(summaryRows[0]?.first_ms), lastMs: number(summaryRows[0]?.last_ms) };
    body.windows = windows;
    body.statistics = readStatistics(statisticsRows[0], windows);
    body.histograms = readHistograms(histogramRows, windows);
    body.extremes = { window: query.extremeWindow, ...extremes };
    body.frame = { step: frameStep, rows: frameRows };
    body.labels = readLabels(summaryRows[0], alignmentRows[0], query);
    body.hourRates = hourRows.map((row) => ({ hour: integer(row.hour), count: integer(row.n), upCount: integer(row.up) }));
    const deltaCounts = new Array<number>(DELTA_BINS).fill(0);
    for (const row of deltaRows) {
      const bin = integer(row.bin);
      if (bin >= 0 && bin < DELTA_BINS) deltaCounts[bin] = integer(row.c);
    }
    body.deltaCounts = deltaCounts;
    body.lakeLabelCheck = landed;
    const slice: SliceBars = {
      startIndex: sliceStart,
      rows: sliceRowsRaw.map((row) => [integer(row.t), number(row.open) ?? 0, number(row.high) ?? 0, number(row.low) ?? 0, number(row.close) ?? 0]),
    };
    body.slice = slice;
    if (loaded < query.bars) context.notes.push(`Only ${loaded.toLocaleString("en-US")} bars pass the filters, fewer than the ${query.bars.toLocaleString("en-US")} asked for.`);
    return body;
  },
};

export default handler;
