/**
 * Indicator study: every TA-Lib indicator on MNQ's 2025-Q4 candles, and what
 * each says about the next 1, 4 and 12 bars' direction. Replaced
 * datalake/notebooks/mnq_indicator_study.py.
 *
 * The study's numbers were computed once by the datalake repository's
 * scripts/build_mnq_indicator_study.py (block-bootstrap intervals,
 * circular-shift nulls, walk-forward logistic regressions, pattern-condition
 * consistency) and landed unchanged by packages/ml-engine/src/studies/indicator_study/build.py
 * as `derived_study_indicator_study_<table>`. The bar sets are the lake's
 * TA-Lib outputs: `derived_mnq_talib_1m`, `derived_mnq_talib_1h`, and the
 * 4-hour set copied as `derived_study_indicator_study_mnq_talib_4h_bars`.
 *
 * One handler, many parts (`?part=`): each tab of the page asks only for what
 * it draws. Nothing large goes to the browser: the chart is a window of at
 * most 1,500 bars, the pair scatter at most 20,000 points, the clause and
 * condition histograms are binned here, and the firing table is paged.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  DEFAULT_WINDOW_LENGTH, FIRINGS_PAGE_SIZE, INDICATOR_STUDY_PARTS, INDICATOR_STUDY_TIMEFRAMES, MAXIMUM_WINDOW_LENGTH,
  PAIR_SAMPLE_SIZE, prefixLocationWidth, predictabilityColumns, predictabilityVerdict, runningLocationWidth, scoreTreatment,
  transformedExpression, walkForwardSummary,
  type CallsBody, type CatalogueRow, type ChartBar, type ChartBody, type ChartMarker, type ClausePanel, type ConditionsBody,
  type ConsistencyRow, type ContextStatisticsRow, type CorrelationBody, type CorrelationColumn, type DistributionStatisticsRow,
  type DistributionsBody, type FamilywiseThresholdRow, type FeaturePanel, type FiringBody, type FiringsPageBody,
  type FormationBody, type FormationRuleRow, type HistogramBinRow, type HitRateRow, type IndependentCheckRow,
  type IndicatorStudyTimeframe, type InspectorBody, type InspectorRow, type MarketFeatureRow, type OverviewBody,
  type PairBody, type PredictabilityBody, type PredictabilityRow, type RunInformationRow, type TrendDefinitionRow,
  type TrendOutcomeRow, type TrendShareRow, type WalkForwardBody, type WalkForwardFoldRow, type WalkForwardMeanNullRow,
} from "@shared/studies/indicator-study";

const DATASET = "derived_study_indicator_study";
const RECIPE = "mnq_2025q4_talib_v1";
const BAR_RECIPE = "talib_v1";

const TABLES = [
  "bar_direction_targets", "bar_market_context", "bar_market_context_distribution_statistics", "candle_thresholds",
  "candlestick_pattern_condition_consistency", "candlestick_pattern_directional_hit_rates",
  "candlestick_pattern_firing_market_context", "candlestick_pattern_formation_rules", "candlestick_pattern_independent_check",
  "candlestick_pattern_outcome_by_textbook_trend", "candlestick_pattern_rule_clause_margin_summary",
  "candlestick_pattern_rule_clause_margins", "candlestick_pattern_semantics", "candlestick_pattern_session_consistency",
  "candlestick_pattern_textbook_trend_share", "indicator_catalogue", "indicator_cluster_order", "indicator_correlation_pairs",
  "indicator_directional_predictability", "indicator_distribution_statistics", "indicator_histogram_bins",
  "market_context_feature_catalogue", "market_context_trend_definitions", "mnq_talib_4h_bars",
  "pattern_formation_run_information", "predictability_familywise_thresholds", "study_run_information",
  "walk_forward_directional_model_folds", "walk_forward_mean_auc_null",
] as const;
type StudyTable = (typeof TABLES)[number];

const BAR_VIEWS: Record<IndicatorStudyTimeframe, string> = {
  "1m": "derived_mnq_talib_1m",
  "1h": "derived_mnq_talib_1h",
  "4h": `${DATASET}_mnq_talib_4h_bars`,
};

/** The view a study table is served as. */
function view(table: StudyTable): string {
  return ident(`${DATASET}_${table}`);
}

/** A study table restricted to this landing. */
function from(table: StudyTable): string {
  return `(SELECT * FROM ${view(table)} WHERE recipe = ${text(RECIPE)})`;
}

/** Every bar of a timeframe, numbered 0.. in time order as the notebook numbers them. */
function numberedBars(timeframe: IndicatorStudyTimeframe, columns: readonly string[]): string {
  const where = timeframe === "4h" ? "" : `WHERE recipe = ${text(BAR_RECIPE)}`;
  const list = ["\"timestamp\"", ...columns.map(ident)].join(", ");
  return `(SELECT row_number() OVER (ORDER BY "timestamp") - 1 AS bar_index, ${list} FROM ${ident(BAR_VIEWS[timeframe])} ${where})`;
}

const IDENTIFIER = /^[a-z][a-z0-9_]{0,95}$/;
const identifier = z.string().regex(IDENTIFIER);
const identifierList = z
  .string()
  .max(4000)
  .default("")
  .transform((value) => value.split(",").map((item) => item.trim()).filter((item) => item.length > 0))
  .refine((items) => items.every((item) => IDENTIFIER.test(item)) && items.length <= 40, "a comma-separated list of at most 40 column names");

const query = z.object({
  part: z.enum(INDICATOR_STUDY_PARTS).default("overview"),
  timeframe: z.enum(INDICATOR_STUDY_TIMEFRAMES).default("1h"),
  horizon: z.coerce.number().int().refine((value) => value === 1 || value === 4 || value === 12, "1, 4 or 12").default(1),
  windowEnd: z.coerce.number().int().min(-1).max(10_000_000).default(-1),
  windowLength: z.coerce.number().int().min(20).max(MAXIMUM_WINDOW_LENGTH).optional(),
  overlays: identifierList,
  panels: identifierList,
  pattern: identifier.optional(),
  side: z.enum(["positive", "negative"]).default("positive"),
  context: z.coerce.number().int().min(5).max(60).default(15),
  occurrence: z.coerce.number().int().min(1).max(1_000_000).default(1),
  variant: z.enum(["transformed", "raw"]).default("transformed"),
  method: z.enum(["spearman", "pearson"]).default("spearman"),
  statistic: z.enum(["information_coefficient", "area_under_curve"]).default("information_coefficient"),
  columnA: identifier.optional(),
  columnB: identifier.optional(),
  group: z.string().max(80).regex(/^[A-Za-z ]+$/).default("Momentum Indicators"),
  bins: z.coerce.number().int().min(10).max(60).default(20),
  view: z.enum(["rank", "raw"]).default("rank"),
  band: z.coerce.number().min(0.01).max(0.5).default(0.1),
  legendFeature: identifier.default("prior_trend_zscore_20_bars"),
  trendDefinition: identifier.default("return_zscore_20_bars_beyond_1"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});
type Query = z.infer<typeof query>;

type Body =
  | OverviewBody | ChartBody | InspectorBody | CorrelationBody | PairBody | PredictabilityBody | CallsBody
  | DistributionsBody | FormationBody | FiringBody | FiringsPageBody | ConditionsBody | WalkForwardBody | { empty: true };

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function count(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

/** Numbers for every numeric-looking field (DuckDB hands some aggregates back as strings or bigints). */
function numeric<T extends object>(row: T, fields: readonly string[]): T {
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const field of fields) out[field] = numberOrNull((row as Record<string, unknown>)[field]);
  return out as T;
}

async function catalogue(context: StudyContext, timeframe: IndicatorStudyTimeframe): Promise<CatalogueRow[]> {
  const rows = await context.lake.query<CatalogueRow>(`
    SELECT c.timeframe, c.column_name, c.talib_function, c.talib_output, c.talib_group, c.parameters, c.lookback_bars,
           c.feature_kind, c.transformation_formula, c.pattern_semantics, s.semantics_description, c.null_count,
           c.infinite_count, c.excluded_reason, c.duplicate_of
    FROM ${from("indicator_catalogue")} c
    LEFT JOIN ${from("candlestick_pattern_semantics")} s ON s.talib_function = c.talib_function
    WHERE c.timeframe = ${text(timeframe)}
    ORDER BY c.talib_group, c.column_name`);
  return rows.map((row) => numeric(row, ["lookback_bars", "null_count", "infinite_count"]));
}

/** The pattern columns the bar set carries and the catalogue does not exclude. */
async function patternColumns(context: StudyContext, timeframe: IndicatorStudyTimeframe, rows?: CatalogueRow[]): Promise<CatalogueRow[]> {
  const available = new Set(await context.lake.columns(BAR_VIEWS[timeframe]));
  const list = rows ?? (await catalogue(context, timeframe));
  return list.filter((row) => row.feature_kind === "candlestick_pattern" && row.excluded_reason === null && available.has(row.column_name));
}

// ── overview ───────────────────────────────────────────────────────────────

async function overview(q: Query, context: StudyContext): Promise<OverviewBody> {
  const rows = await catalogue(context, q.timeframe);
  const patterns = await patternColumns(context, q.timeframe, rows);
  const counts = patterns.length
    ? (await context.lake.query<Record<string, unknown>>(
        `SELECT ${patterns.map((row) => `count(*) FILTER (WHERE ${ident(row.column_name)} <> 0) AS ${ident(row.column_name)}`).join(", ")}
         FROM ${numberedBars(q.timeframe, patterns.map((row) => row.column_name))}`,
      ))[0] ?? {}
    : {};
  const [contracts, runInformation, familywiseThresholds, independentCheck, marketFeatures, trendDefinitions, formationPatterns, contextStatistics] =
    await Promise.all([
      context.lake.query<{ contract_symbol: string; bar_count: number }>(
        `SELECT contract_symbol, count(*) AS bar_count FROM ${numberedBars(q.timeframe, ["contract_symbol"])} GROUP BY ALL ORDER BY contract_symbol`,
      ),
      context.lake.query<RunInformationRow>(`SELECT * EXCLUDE (recipe, first_usable_timestamp, last_usable_timestamp) FROM ${from("study_run_information")} ORDER BY timeframe, horizon_bars`),
      context.lake.query<FamilywiseThresholdRow>(`SELECT * EXCLUDE (recipe) FROM ${from("predictability_familywise_thresholds")} ORDER BY timeframe, horizon_bars, variant, statistic`),
      context.lake.query<IndependentCheckRow>(`SELECT * EXCLUDE (recipe) FROM ${from("candlestick_pattern_independent_check")} ORDER BY timeframe, talib_function`),
      context.lake.query<MarketFeatureRow>(`SELECT * EXCLUDE (recipe) FROM ${from("market_context_feature_catalogue")}`),
      context.lake.query<TrendDefinitionRow>(`SELECT * EXCLUDE (recipe) FROM ${from("market_context_trend_definitions")}`),
      context.lake.query<{ column_name: string; signal_side: string; firing_count: number }>(
        `SELECT column_name, signal_side, count(*) AS firing_count FROM ${from("candlestick_pattern_firing_market_context")}
         WHERE timeframe = ${text(q.timeframe)} GROUP BY ALL ORDER BY firing_count DESC, column_name, signal_side`,
      ),
      context.lake.query<ContextStatisticsRow>(
        `SELECT * EXCLUDE (recipe, timeframe) FROM ${from("bar_market_context_distribution_statistics")} WHERE timeframe = ${text(q.timeframe)}`,
      ),
    ]);
  const numericRun = [
    "horizon_bars", "bar_count", "usable_bar_count", "up_bar_count", "down_bar_count", "tie_excluded_count", "roll_excluded_count",
    "warmup_or_end_excluded_count", "mean_block_length_bars", "bootstrap_draws", "permutation_shift_count", "indicator_column_count",
    "usable_indicator_count", "scored_indicator_count", "duplicate_indicator_count",
  ];
  return {
    timeframe: q.timeframe,
    barCount: contracts.reduce((total, row) => total + count(row.bar_count), 0),
    contracts: contracts.map((row) => ({ contract_symbol: row.contract_symbol, bar_count: count(row.bar_count) })),
    catalogue: rows,
    runInformation: runInformation.map((row) => numeric(row, numericRun)),
    familywiseThresholds: familywiseThresholds.map((row) =>
      numeric(row, ["horizon_bars", "studentized_threshold_95", "tested_indicator_count", "familywise_significant_count", "benjamini_hochberg_q_below_0p10_count", "expected_false_discoveries_at_5_percent"]),
    ),
    independentCheck: independentCheck.map((row) =>
      numeric(row, ["compared_bar_count", "agreeing_bar_count", "agreement_percent", "talib_signal_bar_count", "reference_signal_bar_count"]),
    ),
    patternFiringCounts: patterns
      .map((row) => ({ column_name: row.column_name, firing_count: count(counts[row.column_name]) }))
      .sort((a, b) => b.firing_count - a.firing_count || a.column_name.localeCompare(b.column_name)),
    marketFeatures,
    trendDefinitions: trendDefinitions.map((row) => numeric(row, ["threshold"])),
    formationPatterns: formationPatterns.map((row) => ({ ...row, firing_count: count(row.firing_count) })),
    contextStatistics: contextStatistics.map((row) =>
      numeric(row, ["finite_count", "mean", "median", "standard_deviation", "skewness", "excess_kurtosis", "percentile_25", "percentile_75", "minimum", "maximum"]),
    ),
  };
}

// ── chart ──────────────────────────────────────────────────────────────────

async function chart(q: Query, context: StudyContext): Promise<ChartBody> {
  const available = new Set(await context.lake.columns(BAR_VIEWS[q.timeframe]));
  const overlays = q.overlays.filter((column) => available.has(column));
  const panels = q.panels.filter((column) => available.has(column) && !overlays.includes(column));
  const refused = [...q.overlays, ...q.panels].filter((column) => !available.has(column));
  if (refused.length) context.notes.push(`Not a column of the ${q.timeframe} bar set, left out: ${refused.join(", ")}.`);
  const patterns = await patternColumns(context, q.timeframe);

  const total = count((await context.lake.query<{ bars: number }>(`SELECT count(*) AS bars FROM ${numberedBars(q.timeframe, [])}`))[0]?.bars);
  const length = q.windowLength ?? DEFAULT_WINDOW_LENGTH[q.timeframe];
  const last = q.windowEnd < 0 ? total - 1 : Math.min(q.windowEnd, total - 1);
  const first = Math.max(0, last - length + 1);

  const base = ["contract_symbol", "open", "high", "low", "close", "volume", "bars_since_contract_roll"];
  const valueColumns = [...overlays, ...panels];
  const numbered = numberedBars(q.timeframe, [...new Set([...base, ...valueColumns, ...patterns.map((row) => row.column_name)])]);
  const window = `(SELECT * FROM ${numbered} WHERE bar_index BETWEEN ${num(first)} AND ${num(last)})`;

  const barRows = await context.lake.query<Record<string, unknown>>(`
    SELECT w.bar_index, epoch_ms(w."timestamp") AS timestamp_milliseconds, w.contract_symbol, w.open, w.high, w.low, w.close,
           w.volume, w.bars_since_contract_roll, t.direction_binary, t.exclusion_reason
           ${valueColumns.map((column) => `, w.${ident(column)}`).join("")}
    FROM ${window} w
    LEFT JOIN ${from("bar_direction_targets")} t
      ON t."timestamp" = w."timestamp" AND t.timeframe = ${text(q.timeframe)} AND t.horizon_bars = ${num(q.horizon)}
    ORDER BY w.bar_index`);
  const bars: ChartBar[] = barRows.map((row) => ({
    bar_index: count(row.bar_index),
    timestamp: count(row.timestamp_milliseconds),
    open: count(row.open),
    high: count(row.high),
    low: count(row.low),
    close: count(row.close),
    volume: count(row.volume),
    contract_symbol: String(row.contract_symbol ?? ""),
    bars_since_contract_roll: numberOrNull(row.bars_since_contract_roll),
    direction_binary: numberOrNull(row.direction_binary),
    exclusion_reason: typeof row.exclusion_reason === "string" ? row.exclusion_reason : null,
    values: Object.fromEntries(valueColumns.map((column) => [column, numberOrNull(row[column])])),
  }));

  let markers: ChartMarker[] = [];
  if (patterns.length) {
    const casts = patterns.map((row) => `CAST(${ident(row.column_name)} AS DOUBLE) AS ${ident(row.column_name)}`).join(", ");
    const rows = await context.lake.query<{ bar_index: number; pattern: string; value: number }>(`
      WITH w AS (SELECT bar_index, ${casts} FROM ${window})
      SELECT bar_index, pattern, value FROM (UNPIVOT w ON ${patterns.map((row) => ident(row.column_name)).join(", ")} INTO NAME pattern VALUE value)
      WHERE value <> 0 ORDER BY bar_index, pattern`);
    markers = rows.map((row) => ({ bar_index: count(row.bar_index), pattern: row.pattern, value: count(row.value) }));
  }
  return { barCount: total, firstBarIndex: first, lastBarIndex: last, horizon: q.horizon, overlays, panels, bars, markers };
}

// ── inspector ──────────────────────────────────────────────────────────────

async function inspector(q: Query, context: StudyContext): Promise<InspectorBody> {
  const patterns = await patternColumns(context, q.timeframe);
  const pattern = q.pattern ?? "candlestick_engulfing";
  if (!patterns.some((row) => row.column_name === pattern)) {
    context.notes.push(`${pattern} is not a pattern column at ${q.timeframe}.`);
    return { pattern, occurrenceCount: 0, occurrence: 0, barIndex: null, hasReference: false, rows: [] };
  }
  const numbered = numberedBars(q.timeframe, ["open", "high", "low", "close", pattern]);
  const occurrenceCount = count((await context.lake.query<{ hits: number }>(`SELECT count(*) FILTER (WHERE ${ident(pattern)} <> 0) AS hits FROM ${numbered}`))[0]?.hits);
  if (occurrenceCount === 0) return { pattern, occurrenceCount, occurrence: 0, barIndex: null, hasReference: false, rows: [] };
  const occurrence = Math.min(q.occurrence, occurrenceCount);
  const barIndex = count((await context.lake.query<{ bar_index: number }>(
    `SELECT bar_index FROM ${numbered} WHERE ${ident(pattern)} <> 0 ORDER BY bar_index LIMIT 1 OFFSET ${num(occurrence - 1)}`,
  ))[0]?.bar_index);
  const referenceColumn = `independent_reimplementation_${pattern}`;
  const hasReference = (await context.lake.columns(`${DATASET}_candle_thresholds`)).includes(referenceColumn);
  const rows = await context.lake.query<InspectorRow & { timestamp_milliseconds: number }>(`
    SELECT b.bar_index, epoch_ms(b."timestamp") AS timestamp_milliseconds, b.open, b.high, b.low, b.close,
           CAST(b.${ident(pattern)} AS DOUBLE) AS talib_value,
           ${hasReference ? `t.${ident(referenceColumn)}` : "CAST(NULL AS DOUBLE)"} AS independent_reimplementation,
           t.real_body, t.upper_shadow, t.lower_shadow, t.high_low_range, t.body_long_or_short_threshold, t.body_doji_threshold,
           t.shadow_very_short_threshold, t.shadow_short_threshold, t.near_threshold
    FROM ${numbered} b
    LEFT JOIN ${from("candle_thresholds")} t ON t.timeframe = ${text(q.timeframe)} AND t."timestamp" = b."timestamp"
    WHERE b.bar_index BETWEEN ${num(barIndex - q.context)} AND ${num(barIndex + q.context)}
    ORDER BY b.bar_index`);
  return {
    pattern,
    occurrenceCount,
    occurrence,
    barIndex,
    hasReference,
    rows: rows.map(({ timestamp_milliseconds, ...row }) => ({
      ...numeric(row as unknown as Record<string, unknown>, [
        "bar_index", "open", "high", "low", "close", "talib_value", "independent_reimplementation", "real_body", "upper_shadow",
        "lower_shadow", "high_low_range", "body_long_or_short_threshold", "body_doji_threshold", "shadow_very_short_threshold",
        "shadow_short_threshold", "near_threshold",
      ]),
      timestamp: count(timestamp_milliseconds),
    })) as InspectorRow[],
  };
}

// ── correlation ────────────────────────────────────────────────────────────

async function correlation(q: Query, context: StudyContext): Promise<CorrelationBody> {
  const columns = (await context.lake.query<CorrelationColumn>(`
    SELECT c.column_name, c.talib_group, c.feature_kind, o.cluster_position, o.cluster_number
    FROM ${from("indicator_catalogue")} c
    JOIN ${from("indicator_cluster_order")} o ON o.column_name = c.column_name AND o.timeframe = c.timeframe
    WHERE c.timeframe = ${text(q.timeframe)} AND c.excluded_reason IS NULL
    ORDER BY o.cluster_position`)).map((row) => numeric(row, ["cluster_position", "cluster_number"]));
  const index = new Map(columns.map((column, position) => [column.column_name, position]));
  const size = columns.length;
  const correlations: Array<number | null> = new Array<number | null>(size * size).fill(null);
  const pairCounts: Array<number | null> = new Array<number | null>(size * size).fill(null);
  const cells = await context.lake.query<{ column_a: string; column_b: string; correlation: number | null; pair_count: number }>(`
    SELECT column_a, column_b, correlation, pair_count FROM ${from("indicator_correlation_pairs")}
    WHERE timeframe = ${text(q.timeframe)} AND variant = ${text(q.variant)} AND method = ${text(q.method)}`);
  for (const cell of cells) {
    const row = index.get(cell.column_a);
    const column = index.get(cell.column_b);
    if (row === undefined || column === undefined) continue;
    const value = numberOrNull(cell.correlation);
    correlations[row * size + column] = value === null ? null : Math.round(value * 10_000) / 10_000;
    pairCounts[row * size + column] = numberOrNull(cell.pair_count);
  }
  return { variant: q.variant, method: q.method, columns, correlations, pairCounts };
}

async function pair(q: Query, context: StudyContext): Promise<PairBody> {
  const kinds = new Map((await catalogue(context, q.timeframe)).filter((row) => row.excluded_reason === null).map((row) => [row.column_name, row.feature_kind]));
  const columnA = q.columnA ?? "";
  const columnB = q.columnB ?? "";
  const kindA = kinds.get(columnA);
  const kindB = kinds.get(columnB);
  if (kindA === undefined || kindB === undefined) {
    context.notes.push("Pick two indicators from the matrix.");
    return { columnA, columnB, variant: q.variant, correlation: null, pairCount: null, finiteCount: 0, sampled: false, points: [] };
  }
  const value = (column: string, kind: string) => {
    const quoted = `CAST(${ident(column)} AS DOUBLE)`;
    return q.variant === "raw" ? quoted : transformedExpression(kind, quoted, `lag(${quoted}) OVER (ORDER BY "timestamp")`);
  };
  const columns = [...new Set(["close", columnA, columnB])];
  const values = `(SELECT "timestamp", ${value(columnA, kindA)} AS a, ${value(columnB, kindB)} AS b FROM ${numberedBars(q.timeframe, columns)})`;
  const finite = `(SELECT * FROM ${values} WHERE a IS NOT NULL AND b IS NOT NULL AND isfinite(a) AND isfinite(b))`;
  const finiteCount = count((await context.lake.query<{ points: number }>(`SELECT count(*) AS points FROM ${finite}`))[0]?.points);
  const sampled = finiteCount > PAIR_SAMPLE_SIZE;
  const rows = await context.lake.query<{ a: number; b: number; timestamp_milliseconds: number }>(
    sampled
      ? `SELECT a, b, epoch_ms("timestamp") AS timestamp_milliseconds FROM ${finite} USING SAMPLE reservoir(${PAIR_SAMPLE_SIZE} ROWS) REPEATABLE (7)`
      : `SELECT a, b, epoch_ms("timestamp") AS timestamp_milliseconds FROM ${finite}`,
  );
  const stored = (await context.lake.query<{ correlation: number | null; pair_count: number | null }>(`
    SELECT correlation, pair_count FROM ${from("indicator_correlation_pairs")}
    WHERE timeframe = ${text(q.timeframe)} AND variant = ${text(q.variant)} AND method = ${text(q.method)}
      AND column_a = ${text(columnA)} AND column_b = ${text(columnB)}`))[0];
  return {
    columnA,
    columnB,
    variant: q.variant,
    correlation: numberOrNull(stored?.correlation),
    pairCount: numberOrNull(stored?.pair_count),
    finiteCount,
    sampled,
    points: rows.map((row) => [count(row.a), count(row.b), count(row.timestamp_milliseconds)]),
  };
}

// ── predictability, patterns as calls, walk-forward, distributions ─────────

async function predictability(q: Query, context: StudyContext): Promise<PredictabilityBody> {
  const names = predictabilityColumns(q.statistic);
  const where = `timeframe = ${text(q.timeframe)} AND horizon_bars = ${num(q.horizon)}`;
  const [rows, thresholds, both, run] = await Promise.all([
    context.lake.query<Record<string, unknown>>(`
      SELECT column_name, talib_group, feature_kind, usable_bar_count, up_bar_count, down_bar_count,
             ${ident(names.score)} AS score, ${ident(names.lower)} AS lower_95, ${ident(names.upper)} AS upper_95,
             ${ident(names.pValue)} AS permutation_p_value, ${ident(names.qValue)} AS benjamini_hochberg_q_value,
             ${ident(names.threshold)} AS familywise_threshold
      FROM ${from("indicator_directional_predictability")}
      WHERE ${where} AND variant = ${text(q.variant)} AND NOT constant_after_filter`),
    context.lake.query<FamilywiseThresholdRow>(`SELECT * EXCLUDE (recipe) FROM ${from("predictability_familywise_thresholds")} WHERE ${where} ORDER BY variant, statistic`),
    context.lake.query<{ column_name: string; talib_group: string; feature_kind: string; variant: string; score: number | null }>(`
      SELECT column_name, talib_group, feature_kind, variant, ${ident(names.score)} AS score
      FROM ${from("indicator_directional_predictability")} WHERE ${where}`),
    context.lake.query<RunInformationRow>(`SELECT * EXCLUDE (recipe, first_usable_timestamp, last_usable_timestamp) FROM ${from("study_run_information")} WHERE ${where}`),
  ]);
  const scored: PredictabilityRow[] = rows.map((raw) => {
    const row = numeric(raw, ["usable_bar_count", "up_bar_count", "down_bar_count", "score", "lower_95", "upper_95", "permutation_p_value", "benjamini_hochberg_q_value", "familywise_threshold"]);
    return {
      ...(row as unknown as Omit<PredictabilityRow, "verdict">),
      verdict: predictabilityVerdict(row.score as number | null, row.familywise_threshold as number | null, row.benjamini_hochberg_q_value as number | null),
    };
  });
  const pivot = new Map<string, { column_name: string; talib_group: string; feature_kind: string; raw: number | null; transformed: number | null }>();
  for (const row of both) {
    const entry = pivot.get(row.column_name) ?? { column_name: row.column_name, talib_group: row.talib_group, feature_kind: row.feature_kind, raw: null, transformed: null };
    if (row.variant === "raw") entry.raw = numberOrNull(row.score);
    if (row.variant === "transformed") entry.transformed = numberOrNull(row.score);
    pivot.set(row.column_name, entry);
  }
  const comparison = [...pivot.values()]
    .filter((row): row is typeof row & { raw: number; transformed: number } => row.raw !== null && row.transformed !== null)
    .map((row) => ({ ...row, treatment: scoreTreatment(row.feature_kind) }));
  const runRow = run[0];
  return {
    rows: scored,
    thresholds: thresholds.map((row) => numeric(row, ["horizon_bars", "studentized_threshold_95", "tested_indicator_count", "familywise_significant_count", "benjamini_hochberg_q_below_0p10_count", "expected_false_discoveries_at_5_percent"])),
    comparison,
    run: runRow
      ? numeric(runRow, ["horizon_bars", "bar_count", "usable_bar_count", "up_bar_count", "down_bar_count", "mean_block_length_bars", "bootstrap_draws", "permutation_shift_count"])
      : null,
  };
}

async function calls(q: Query, context: StudyContext): Promise<CallsBody> {
  const rows = await context.lake.query<HitRateRow>(`
    SELECT * EXCLUDE (recipe) FROM ${from("candlestick_pattern_directional_hit_rates")}
    WHERE timeframe = ${text(q.timeframe)} AND horizon_bars = ${num(q.horizon)}`);
  return {
    rows: rows.map((row) =>
      numeric(row, [
        "horizon_bars", "signal_bar_count", "probability_up_given_signal", "probability_up_given_signal_lower_95", "probability_up_given_signal_upper_95",
        "hit_rate_in_claimed_direction", "base_rate_up", "base_rate_up_lower_95", "base_rate_up_upper_95", "permutation_p_value",
      ]),
    ),
  };
}

async function walkForward(q: Query, context: StudyContext): Promise<WalkForwardBody> {
  const where = `timeframe = ${text(q.timeframe)} AND horizon_bars = ${num(q.horizon)}`;
  const [folds, nulls] = await Promise.all([
    context.lake.query<Record<string, unknown>>(`
      SELECT * EXCLUDE (recipe, timeframe, horizon_bars, test_start_timestamp, test_end_timestamp),
             epoch_ms(test_start_timestamp) AS test_start_timestamp, epoch_ms(test_end_timestamp) AS test_end_timestamp
      FROM ${from("walk_forward_directional_model_folds")} WHERE ${where} ORDER BY fold_number, model_name`),
    context.lake.query<WalkForwardMeanNullRow>(`
      SELECT model_name, null_mean_area_under_roc_curve_95th_percentile, mean_area_under_roc_curve_permutation_p_value, null_rule
      FROM ${from("walk_forward_mean_auc_null")} WHERE ${where}`),
  ]);
  const foldRows = folds.map((row) =>
    numeric(row, [
      "fold_number", "train_bar_count", "test_bar_count", "independent_window_count", "test_start_timestamp", "test_end_timestamp", "test_base_rate_up",
      "area_under_roc_curve", "area_under_roc_curve_null_95th_percentile", "area_under_roc_curve_permutation_p_value", "log_loss", "accuracy",
      "chosen_inverse_regularization", "feature_count",
    ]),
  ) as unknown as WalkForwardFoldRow[];
  const nullRows = nulls.map((row) => numeric(row, ["null_mean_area_under_roc_curve_95th_percentile", "mean_area_under_roc_curve_permutation_p_value"]));
  return { folds: foldRows, summary: walkForwardSummary(foldRows, nullRows) };
}

async function distributions(q: Query, context: StudyContext): Promise<DistributionsBody> {
  const [bins, statistics] = await Promise.all([
    context.lake.query<HistogramBinRow>(`
      SELECT b.column_name, b.bin_index, b.bin_lower, b.bin_upper, b.bar_count
      FROM ${from("indicator_histogram_bins")} b
      JOIN ${from("indicator_catalogue")} c ON c.column_name = b.column_name AND c.timeframe = b.timeframe
      WHERE b.timeframe = ${text(q.timeframe)} AND b.variant = ${text(q.variant)} AND c.talib_group = ${text(q.group)}
      ORDER BY b.column_name, b.bin_index`),
    context.lake.query<DistributionStatisticsRow>(`
      SELECT column_name, finite_count, mean, median, standard_deviation, skewness, excess_kurtosis, percentile_25, percentile_75, minimum, maximum
      FROM ${from("indicator_distribution_statistics")}
      WHERE timeframe = ${text(q.timeframe)} AND variant = ${text(q.variant)} AND talib_group = ${text(q.group)} ORDER BY column_name`),
  ]);
  return {
    bins: bins.map((row) => numeric(row, ["bin_index", "bin_lower", "bin_upper", "bar_count"])),
    statistics: statistics.map((row) =>
      numeric(row, ["finite_count", "mean", "median", "standard_deviation", "skewness", "excess_kurtosis", "percentile_25", "percentile_75", "minimum", "maximum"]),
    ),
  };
}

// ── pattern conditions (section 10) ────────────────────────────────────────

const CONSISTENCY_NUMBERS = [
  "firing_count", "firing_count_with_feature", "firing_median", "all_bar_median", "mean_difference_in_all_bar_standard_deviations",
  "firing_percentile_rank_25", "firing_percentile_rank_75", "location_shift_percentile_points", "location_shift_null_95th_percentile_absolute",
  "location_shift_permutation_p_value", "location_shift_benjamini_hochberg_q_value", "middle_half_width_percentile_points",
  "middle_half_width_null_median", "middle_half_width_null_5th_percentile", "middle_half_width_permutation_p_value",
  "middle_half_width_benjamini_hochberg_q_value",
];
const CONSISTENCY_COLUMNS = ["column_name", "talib_function", "signal_side", "feature_name", "gradable", "consistency_grade", ...CONSISTENCY_NUMBERS];

async function conditions(q: Query, context: StudyContext): Promise<ConditionsBody> {
  const tf = text(q.timeframe);
  const [run, grades, share, outcome, margins, cells, shares, outcomes] = await Promise.all([
    context.lake.query<{ firing_count: number; pattern_count: number }>(`SELECT firing_count, pattern_count FROM ${from("pattern_formation_run_information")} WHERE timeframe = ${tf}`),
    context.lake.query<{ consistency_grade: string | null; pairs: number }>(`SELECT consistency_grade, count(*) AS pairs FROM ${from("candlestick_pattern_condition_consistency")} WHERE timeframe = ${tf} GROUP BY ALL`),
    context.lake.query<Record<string, unknown>>(`
      SELECT count(*) FILTER (WHERE gradable) AS graded,
             count(*) FILTER (WHERE gradable AND share_benjamini_hochberg_q_value < 0.10 AND share_minus_all_bar_share > 0) AS above,
             count(*) FILTER (WHERE gradable AND share_benjamini_hochberg_q_value < 0.10 AND share_minus_all_bar_share < 0) AS below,
             median(share_in_required_trend) FILTER (WHERE gradable) AS median_share,
             median(all_bar_share_in_required_trend) FILTER (WHERE gradable) AS median_base
      FROM ${from("candlestick_pattern_textbook_trend_share")} WHERE timeframe = ${tf}`),
    context.lake.query<Record<string, unknown>>(`
      SELECT count(*) FILTER (WHERE reportable) AS tested,
             count(*) FILTER (WHERE reportable AND difference_benjamini_hochberg_q_value < 0.10) AS changed
      FROM ${from("candlestick_pattern_outcome_by_textbook_trend")} WHERE timeframe = ${tf}`),
    context.lake.query<{ firings: number }>(`
      SELECT count(*) AS firings FROM (SELECT DISTINCT column_name, signal_side, formation_bar_number
        FROM ${from("candlestick_pattern_rule_clause_margins")} WHERE timeframe = ${tf})`),
    context.lake.query<ConsistencyRow>(`
      SELECT ${CONSISTENCY_COLUMNS.map(ident).join(", ")} FROM ${from("candlestick_pattern_condition_consistency")}
      WHERE timeframe = ${tf} AND gradable ORDER BY column_name, signal_side, feature_name`),
    context.lake.query<TrendShareRow>(`
      SELECT * EXCLUDE (recipe) FROM ${from("candlestick_pattern_textbook_trend_share")}
      WHERE timeframe = ${tf} AND trend_definition = ${text(q.trendDefinition)} AND gradable`),
    context.lake.query<TrendOutcomeRow>(`
      SELECT * EXCLUDE (recipe) FROM ${from("candlestick_pattern_outcome_by_textbook_trend")}
      WHERE timeframe = ${tf} AND trend_definition = ${text(q.trendDefinition)} AND horizon_bars = ${num(q.horizon)} AND reportable`),
  ]);
  const runRow = run[0];
  const shareRow = share[0] ?? {};
  const outcomeRow = outcome[0] ?? {};
  const shareNumbers = [
    "firing_count", "firing_count_with_trend_label", "firing_count_in_required_trend", "share_in_required_trend", "share_in_required_trend_wilson_lower_95",
    "share_in_required_trend_wilson_upper_95", "share_in_required_trend_day_block_lower_95", "share_in_required_trend_day_block_upper_95",
    "all_bar_share_in_required_trend", "share_minus_all_bar_share", "circular_shift_null_share_median", "permutation_p_value", "firing_share_up",
    "firing_share_none", "firing_share_down", "all_bar_share_up", "all_bar_share_none", "all_bar_share_down", "share_benjamini_hochberg_q_value",
    "share_benjamini_yekutieli_q_value",
  ];
  const outcomeNumbers = Object.keys(outcomes[0] ?? {}).filter((key) => !["timeframe", "column_name", "talib_function", "signal_side", "claimed_direction", "required_prior_trend", "trend_definition", "reportable"].includes(key));
  return {
    tiles: runRow
      ? {
          firingCount: count(runRow.firing_count),
          patternCount: count(runRow.pattern_count),
          firingsWithClauseHeadroom: count(margins[0]?.firings),
          grades: Object.fromEntries(grades.map((row) => [row.consistency_grade ?? "ungraded", count(row.pairs)])),
          trendShareGraded: count(shareRow.graded),
          trendShareAbove: count(shareRow.above),
          trendShareBelow: count(shareRow.below),
          medianShare: numberOrNull(shareRow.median_share),
          medianBase: numberOrNull(shareRow.median_base),
          outcomesTested: count(outcomeRow.tested),
          outcomesChanged: count(outcomeRow.changed),
        }
      : null,
    cells: cells.map((row) => numeric(row, CONSISTENCY_NUMBERS)),
    shares: shares.map((row) => numeric(row, shareNumbers)),
    outcomes: outcomes.map((row) => numeric(row, outcomeNumbers)),
  };
}

function firingWhere(q: Query): string {
  return `timeframe = ${text(q.timeframe)} AND column_name = ${text(q.pattern ?? "candlestick_hammer")} AND signal_side = ${text(q.side)}`;
}

async function marketFeatureNames(context: StudyContext): Promise<MarketFeatureRow[]> {
  return context.lake.query<MarketFeatureRow>(`SELECT * EXCLUDE (recipe) FROM ${from("market_context_feature_catalogue")}`);
}

/** Percentile ranks of a feature among every bar, the notebook's (left + right) / 2 / N placement, binned. */
function allBarRankBins(timeframe: string, feature: string, bins: number): string {
  return `
    SELECT least(greatest(floor(u * ${num(bins)}), 0), ${num(bins - 1)}) AS bin, count(*) AS bars FROM (
      SELECT (2 * (rank() OVER (ORDER BY x) - 1) + count(*) OVER (PARTITION BY x)) / (2.0 * count(*) OVER ()) AS u
      FROM (SELECT CAST(${ident(feature)} AS DOUBLE) AS x FROM ${from("bar_market_context")} WHERE timeframe = ${text(timeframe)} AND ${ident(feature)} IS NOT NULL))
    GROUP BY ALL`;
}

function binnedWithin(expression: string, low: number, high: number, bins: number): string {
  const span = high - low > 0 ? high - low : 1;
  return `least(greatest(floor((least(greatest(${expression}, ${num(low)}), ${num(high)}) - ${num(low)}) / ${num(span)} * ${num(bins)}), 0), ${num(bins - 1)})`;
}

function sharesOf(rows: Array<{ bin: unknown; bars: unknown }>, bins: number): { shares: number[]; total: number } {
  const counts = new Array<number>(bins).fill(0);
  for (const row of rows) {
    const bin = count(row.bin);
    if (bin >= 0 && bin < bins) counts[bin] = (counts[bin] ?? 0) + count(row.bars);
  }
  const total = counts.reduce((a, b) => a + b, 0);
  return { shares: counts.map((value) => value / Math.max(1, total)), total };
}

async function legendRanks(q: Query, context: StudyContext, feature: string): Promise<Array<number | null>> {
  const rows = await context.lake.query<{ rank: number | null }>(`
    SELECT CAST(${ident(`${feature}_percentile_rank_among_all_bars`)} AS DOUBLE) AS rank
    FROM ${from("candlestick_pattern_firing_market_context")} WHERE ${firingWhere(q)} ORDER BY formation_bar_number, formation_timestamp`);
  return rows.map((row) => numberOrNull(row.rank));
}

async function formation(q: Query, context: StudyContext): Promise<FormationBody> {
  const features = await marketFeatureNames(context);
  const featureNames = features.map((row) => row.feature_name);
  const legendFeature = featureNames.includes(q.legendFeature) ? q.legendFeature : (featureNames[0] ?? "prior_trend_zscore_20_bars");
  const column = q.pattern ?? "candlestick_hammer";
  const rankColumns = featureNames.map((name) => ident(`${name}_percentile_rank_among_all_bars`));
  const firings = from("candlestick_pattern_firing_market_context");

  const [head, ruleRows, summary, consistency, session] = await Promise.all([
    context.lake.query<Record<string, unknown>>(`
      SELECT count(*) AS firings, min(position) FILTER (WHERE complete) AS first_complete, any_value(talib_function) AS talib_function FROM (
        SELECT row_number() OVER (ORDER BY formation_bar_number, formation_timestamp) AS position, talib_function,
               ${rankColumns.length ? rankColumns.map((name) => `${name} IS NOT NULL`).join(" AND ") : "true"} AS complete
        FROM ${firings} WHERE ${firingWhere(q)})`),
    context.lake.query<FormationRuleRow>(`
      SELECT r.talib_function, r.candle_count, r.pattern_type, r.required_prior_trend_for_bullish_signal, r.required_prior_trend_for_bearish_signal,
             r.talib_checks_prior_trend, r.trend_check_detail, r.shape_conditions, r.catalogue_correction, r.rule_margins_transcribed
      FROM ${from("candlestick_pattern_formation_rules")} r
      JOIN ${from("indicator_catalogue")} c ON c.talib_function = r.talib_function
      WHERE c.timeframe = ${text(q.timeframe)} AND c.column_name = ${text(column)}`),
    context.lake.query<Record<string, unknown>>(`
      SELECT * EXCLUDE (recipe) FROM ${from("candlestick_pattern_rule_clause_margin_summary")}
      WHERE ${firingWhere(q)} ORDER BY share_within_10_percent_of_limit DESC NULLS LAST, rule_branch, clause_name`),
    context.lake.query<ConsistencyRow>(`
      SELECT ${CONSISTENCY_COLUMNS.map(ident).join(", ")} FROM ${from("candlestick_pattern_condition_consistency")} WHERE ${firingWhere(q)}`),
    context.lake.query<FormationBody["session"][number]>(`
      SELECT session_eastern, session_hours, firing_count_in_session, firing_share, all_bar_share, total_variation_distance,
             total_variation_distance_null_95th_percentile, total_variation_distance_permutation_p_value, total_variation_distance_benjamini_hochberg_q_value
      FROM ${from("candlestick_pattern_session_consistency")} WHERE ${firingWhere(q)}`),
  ]);
  const firingCount = count(head[0]?.firings);

  // 10.1: the clause headroom histograms, 30 bins over [0, 99th percentile].
  const margins = `(SELECT rule_branch, clause_name, CAST(headroom AS DOUBLE) AS headroom FROM ${from("candlestick_pattern_rule_clause_margins")}
                    WHERE ${firingWhere(q)} AND headroom IS NOT NULL)`;
  const limits = await context.lake.query<Record<string, unknown>>(`
    SELECT rule_branch, clause_name, count(*) AS value_count, count(*) FILTER (WHERE headroom < ${num(q.band)}) AS barely,
           quantile_cont(headroom, 0.99) FILTER (WHERE isfinite(headroom)) AS upper_quantile
    FROM ${margins} GROUP BY ALL`);
  const upperOf = new Map<string, { upper: number; values: number; barely: number }>();
  for (const row of limits) {
    const quantile = numberOrNull(row.upper_quantile);
    upperOf.set(`${row.rule_branch}|${row.clause_name}`, {
      upper: quantile !== null && quantile > 0 ? quantile : 1,
      values: count(row.value_count),
      barely: count(row.barely),
    });
  }
  const clauseBins = upperOf.size
    ? await context.lake.query<{ rule_branch: string; clause_name: string; bin: number; bars: number }>(`
        SELECT m.rule_branch, m.clause_name, least(floor(least(greatest(m.headroom, 0), u.upper) / u.upper * 30), 29) AS bin, count(*) AS bars
        FROM ${margins} m
        JOIN (VALUES ${[...upperOf.entries()].map(([key, value]) => {
          const [branch, clause] = key.split("|") as [string, string];
          return `(${text(branch)}, ${text(clause)}, ${num(value.upper)})`;
        }).join(", ")}) AS u(rule_branch, clause_name, upper)
          ON u.rule_branch = m.rule_branch AND u.clause_name = m.clause_name
        WHERE isfinite(m.headroom) GROUP BY ALL`)
    : [];
  const clauses: ClausePanel[] = [];
  for (const raw of summary) {
    const key = `${raw.rule_branch}|${raw.clause_name}`;
    const limit = upperOf.get(key);
    if (!limit || limit.values === 0) continue;
    const counts = new Array<number>(30).fill(0);
    for (const row of clauseBins) {
      if (row.rule_branch === raw.rule_branch && row.clause_name === raw.clause_name) counts[count(row.bin)] = count(row.bars);
    }
    clauses.push({
      rule_branch: String(raw.rule_branch),
      clause_name: String(raw.clause_name),
      clause_description: typeof raw.clause_description === "string" ? raw.clause_description : null,
      firing_count: count(raw.firing_count),
      share_with_zero_scale: numberOrNull(raw.share_with_zero_scale),
      headroom_median: numberOrNull(raw.headroom_median),
      headroom_percentile_25: numberOrNull(raw.headroom_percentile_25),
      headroom_percentile_75: numberOrNull(raw.headroom_percentile_75),
      headroom_minimum: numberOrNull(raw.headroom_minimum),
      share_within_10_percent_of_limit: numberOrNull(raw.share_within_10_percent_of_limit),
      share_within_1_percent_of_limit: numberOrNull(raw.share_within_1_percent_of_limit),
      valueCount: limit.values,
      upper: limit.upper,
      barelyShare: limit.barely / limit.values,
      bins: counts.map((value) => value / limit.values),
    });
  }

  // 10.2: every bar against the firings, on percentile rank or on the feature's own values.
  const gradeOf = new Map(consistency.map((row) => [row.feature_name, row]));
  const panels: FeaturePanel[] = [];
  for (const feature of features) {
    const name = feature.feature_name;
    let low = 0;
    let high = 1;
    let allRows: Array<{ bin: unknown; bars: unknown }>;
    let firingRows: Array<{ bin: unknown; bars: unknown }>;
    if (q.view === "rank") {
      allRows = await context.lake.query(allBarRankBins(q.timeframe, name, q.bins));
      firingRows = await context.lake.query(`
        SELECT ${binnedWithin(`CAST(${ident(`${name}_percentile_rank_among_all_bars`)} AS DOUBLE)`, 0, 1, q.bins)} AS bin, count(*) AS bars
        FROM ${firings} WHERE ${firingWhere(q)} AND ${ident(`${name}_percentile_rank_among_all_bars`)} IS NOT NULL GROUP BY ALL`);
    } else {
      const range = (await context.lake.query<{ low: number | null; high: number | null }>(`
        SELECT quantile_cont(${ident(name)}, 0.005) AS low, quantile_cont(${ident(name)}, 0.995) AS high
        FROM ${from("bar_market_context")} WHERE timeframe = ${text(q.timeframe)} AND ${ident(name)} IS NOT NULL`))[0];
      low = numberOrNull(range?.low) ?? 0;
      high = numberOrNull(range?.high) ?? 1;
      allRows = await context.lake.query(`
        SELECT ${binnedWithin(`CAST(${ident(name)} AS DOUBLE)`, low, high, q.bins)} AS bin, count(*) AS bars
        FROM ${from("bar_market_context")} WHERE timeframe = ${text(q.timeframe)} AND ${ident(name)} IS NOT NULL GROUP BY ALL`);
      firingRows = await context.lake.query(`
        SELECT ${binnedWithin(`CAST(${ident(name)} AS DOUBLE)`, low, high, q.bins)} AS bin, count(*) AS bars
        FROM ${firings} WHERE ${firingWhere(q)} AND ${ident(name)} IS NOT NULL GROUP BY ALL`);
    }
    const every = sharesOf(allRows, q.bins);
    const fired = sharesOf(firingRows, q.bins);
    if (every.total === 0) continue;
    const grade = gradeOf.get(name);
    panels.push({
      feature_name: name,
      description: feature.description,
      units: feature.units,
      low,
      high,
      allBarCount: every.total,
      firingCount: fired.total,
      allBarShares: every.shares,
      firingShares: fired.shares,
      width: numberOrNull(grade?.middle_half_width_percentile_points),
      shift: numberOrNull(grade?.location_shift_percentile_points),
      grade: grade?.consistency_grade ?? null,
    });
  }

  const legendAllBarCount = count((await context.lake.query<{ bars: number }>(`
    SELECT count(${ident(legendFeature)}) AS bars FROM ${from("bar_market_context")} WHERE timeframe = ${text(q.timeframe)}`))[0]?.bars);
  const running = runningLocationWidth(await legendRanks(q, context, legendFeature));
  const rule = ruleRows[0];

  return {
    column,
    side: q.side,
    firingCount,
    firstCompleteFiring: numberOrNull(head[0]?.first_complete) ?? 1,
    rule: rule ? numeric(rule, ["candle_count"]) : null,
    clauses,
    features: panels,
    consistency: consistency.map((row) => numeric(row, CONSISTENCY_NUMBERS)),
    session: session.map((row) =>
      numeric(row, [
        "firing_count_in_session", "firing_share", "all_bar_share", "total_variation_distance", "total_variation_distance_null_95th_percentile",
        "total_variation_distance_permutation_p_value", "total_variation_distance_benjamini_hochberg_q_value",
      ]),
    ),
    legendFeature,
    legendAllBarCount,
    running,
  };
}

/** One firing's row as the page shows it: timestamps in milliseconds, the timeframe and recipe dropped. */
function firingSelect(): string {
  return `SELECT * EXCLUDE (recipe, timeframe) REPLACE (epoch_ms(formation_timestamp) AS formation_timestamp, epoch_ms(context_timestamp) AS context_timestamp)`;
}

function plainFiring(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = typeof value === "bigint" ? Number(value) : value;
  return out;
}

async function firing(q: Query, context: StudyContext): Promise<FiringBody> {
  const firings = from("candlestick_pattern_firing_market_context");
  const row = (await context.lake.query<Record<string, unknown>>(`
    ${firingSelect()} FROM ${firings} WHERE ${firingWhere(q)}
    ORDER BY formation_bar_number, formation_timestamp LIMIT 1 OFFSET ${num(q.occurrence - 1)}`))[0];
  if (!row) return { occurrence: q.occurrence, firing: null, clauseHeadroom: [], prefix: { location: null, width: null, count: 0 } };
  const bar = count(row.formation_bar_number);
  const features = (await marketFeatureNames(context)).map((feature) => feature.feature_name);
  const legendFeature = features.includes(q.legendFeature) ? q.legendFeature : (features[0] ?? "prior_trend_zscore_20_bars");
  const [clauseHeadroom, ranks] = await Promise.all([
    context.lake.query<{ rule_branch: string; clause_name: string; headroom: number | null }>(`
      SELECT rule_branch, clause_name, headroom FROM ${from("candlestick_pattern_rule_clause_margins")}
      WHERE ${firingWhere(q)} AND formation_bar_number = ${num(bar)}`),
    legendRanks(q, context, legendFeature),
  ]);
  return {
    occurrence: q.occurrence,
    firing: plainFiring(row),
    clauseHeadroom: clauseHeadroom.map((entry) => ({ ...entry, headroom: numberOrNull(entry.headroom) })),
    prefix: prefixLocationWidth(ranks, q.occurrence),
  };
}

async function firingsPage(q: Query, context: StudyContext): Promise<FiringsPageBody> {
  const firings = from("candlestick_pattern_firing_market_context");
  const total = count((await context.lake.query<{ firings: number }>(`SELECT count(*) AS firings FROM ${firings} WHERE ${firingWhere(q)}`))[0]?.firings);
  const page = Math.min(q.page, Math.max(1, Math.ceil(total / FIRINGS_PAGE_SIZE)));
  const rows = await context.lake.query<Record<string, unknown>>(`
    ${firingSelect()} FROM ${firings} WHERE ${firingWhere(q)}
    ORDER BY formation_bar_number, formation_timestamp LIMIT ${num(FIRINGS_PAGE_SIZE)} OFFSET ${num((page - 1) * FIRINGS_PAGE_SIZE)}`);
  return { page, pageSize: FIRINGS_PAGE_SIZE, total, rows: rows.map(plainFiring) };
}

// ── the handler ────────────────────────────────────────────────────────────

/** The views each part reads, so a part whose data is not landed says so instead of failing. */
function viewsFor(q: Query): string[] {
  const study = (tables: StudyTable[]) => tables.map((table) => `${DATASET}_${table}`);
  const bars = BAR_VIEWS[q.timeframe];
  switch (q.part) {
    case "overview":
      return [bars, ...study(["indicator_catalogue", "candlestick_pattern_semantics", "study_run_information", "predictability_familywise_thresholds", "candlestick_pattern_independent_check", "market_context_feature_catalogue", "market_context_trend_definitions", "candlestick_pattern_firing_market_context", "bar_market_context_distribution_statistics"])];
    case "chart":
      return [bars, ...study(["indicator_catalogue", "bar_direction_targets"])];
    case "inspector":
      return [bars, ...study(["indicator_catalogue", "candle_thresholds"])];
    case "correlation":
      return study(["indicator_catalogue", "indicator_cluster_order", "indicator_correlation_pairs"]);
    case "pair":
      return [bars, ...study(["indicator_catalogue", "indicator_correlation_pairs"])];
    case "predictability":
      return study(["indicator_directional_predictability", "predictability_familywise_thresholds", "study_run_information"]);
    case "calls":
      return study(["candlestick_pattern_directional_hit_rates"]);
    case "walkForward":
      return study(["walk_forward_directional_model_folds", "walk_forward_mean_auc_null"]);
    case "distributions":
      return study(["indicator_histogram_bins", "indicator_catalogue", "indicator_distribution_statistics"]);
    case "conditions":
      return study(["pattern_formation_run_information", "candlestick_pattern_condition_consistency", "candlestick_pattern_textbook_trend_share", "candlestick_pattern_outcome_by_textbook_trend", "candlestick_pattern_rule_clause_margins"]);
    case "formation":
      return study(["candlestick_pattern_firing_market_context", "candlestick_pattern_formation_rules", "indicator_catalogue", "candlestick_pattern_rule_clause_margin_summary", "candlestick_pattern_rule_clause_margins", "candlestick_pattern_condition_consistency", "candlestick_pattern_session_consistency", "market_context_feature_catalogue", "bar_market_context"]);
    case "firing":
      return study(["candlestick_pattern_firing_market_context", "candlestick_pattern_rule_clause_margins", "market_context_feature_catalogue"]);
    case "firings":
      return study(["candlestick_pattern_firing_market_context"]);
  }
}

const RUNNERS: Record<Query["part"], (q: Query, context: StudyContext) => Promise<Body>> = {
  overview,
  chart,
  inspector,
  correlation,
  pair,
  predictability,
  calls,
  walkForward,
  distributions,
  conditions,
  formation,
  firing,
  firings: firingsPage,
};

const handler: StudyHandler<typeof query, Body> = {
  slug: "indicator-study",
  datasets: [BAR_VIEWS["1m"], BAR_VIEWS["1h"], ...TABLES.map((table) => `${DATASET}_${table}`)],
  query,
  cacheSeconds: 900,
  timeoutMs: 180_000,
  async run(q, context) {
    if ((await missingViews(context, viewsFor(q))).length > 0) return { empty: true };
    return RUNNERS[q.part](q, context);
  },
};

export default handler;
