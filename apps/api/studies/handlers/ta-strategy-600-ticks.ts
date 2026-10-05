/**
 * TA-indicator strategy vs 600 MNQ ticks a day. Replaced notebooks/ta_strategy_600_ticks.py.
 *
 * One part per chart group (`?part=`), so each tab of the page reads only what it draws:
 *   battery*      the model battery (derived_ta_strategy_600_ticks_*), sections 2-8
 *   rules*        conditional TA-Lib rules with 2:1 brackets (derived_ta_rule_strategies_600_ticks_*), section 9
 *   conditional*  multi-timeframe levels, zones and Optuna-tuned templates, plus the pre-registered
 *                 confirmation (derived_ta_conditional_strategies_600_ticks_*), section 10
 *   frequency     round 4, section 11; season: time of day, section 12; cascade*: section 13;
 *   zones*        trading at the zones, section 14; build*: how a zone is built, section 15, from
 *                 derived_study_ta_strategy_600_ticks_zone_build_* (landed by
 *                 packages/ml-engine/src/studies/ta_strategy_600_ticks/build.py, the notebook's own code path)
 *
 * Every value that reaches SQL is parsed by the Zod query and quoted by ../sql. Timestamps leave as epoch
 * milliseconds of the lake's stamps (futures: Pacific wall clock stored as UTC), session dates as
 * YYYY-MM-DD. Large frames are profiled here (eight numbers + histogram per column) instead of being sent.
 * "Latest" recipes follow the notebook: finished_at where a rounds table has it, max(recipe) per symbol
 * where it does not; the frequency round is chosen per market (the notebook's single max(recipe) showed NQ only).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ident, num, text, textList } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  BUILD_MARKETS, BUILD_TIMEFRAMES, TA_STRATEGY_PARTS, cumulativeSeries, type RoundTemplates, type SeriesSet,
  type BatteryBody, type BatteryConfigurationBody, type BatteryRoundBody, type BuildBody, type BuildDaysBody,
  type CascadeBody, type CascadeSessionBody, type ColumnProfile, type ConditionalBody, type ConditionalRoundBody,
  type ConditionalSessionBody, type ConditionalTemplateBody, type FrequencyBody, type OverviewBody, type Row,
  type RulePoint, type RulesBody, type RulesRoundBody, type RulesStrategyBody, type SeasonBody, type ZonesBody,
  type ZonesSessionBody, type BuildBar, type LevelEvent,
} from "@shared/studies/ta-strategy-600-ticks";

const BATTERY = "derived_ta_strategy_600_ticks_";
const RULE = "derived_ta_rule_strategies_600_ticks_";
const CONDITIONAL = "derived_ta_conditional_strategies_600_ticks_";
const BUILD = "derived_study_ta_strategy_600_ticks_";
const GOAL_TICKS = 600;

const v = {
  batteryRounds: `${BATTERY}rounds`, configurations: `${BATTERY}configurations`, batteryDaily: `${BATTERY}daily`,
  batteryTrades: `${BATTERY}trades`, batteryFolds: `${BATTERY}folds`, oracle: `${BATTERY}oracle_by_session`,
  importance: `${BATTERY}feature_importance`, batteryReviews: `${BATTERY}reviews`,
  ruleRounds: `${RULE}rounds`, strategies: `${RULE}strategies`, ruleDaily: `${RULE}daily`, ruleTrades: `${RULE}trades`,
  ruleYearly: `${RULE}yearly`, baselines: `${RULE}random_entry_baselines`, ruleReviews: `${RULE}reviews`,
  conditionalRounds: `${CONDITIONAL}rounds`, conditionalReviews: `${CONDITIONAL}reviews`, levelQuality: `${CONDITIONAL}level_quality`,
  levelQualityFixed: `${CONDITIONAL}level_quality_fractal_window_fixed`, zones15: `${CONDITIONAL}zones_15m`,
  levelEvents: `${CONDITIONAL}level_events`, templates: `${CONDITIONAL}templates`, conditionalFolds: `${CONDITIONAL}folds`,
  conditionalDaily: `${CONDITIONAL}daily`, trials: `${CONDITIONAL}trials`, conditionalTrades: `${CONDITIONAL}trades`,
  confirmationRounds: `${CONDITIONAL}confirmation_rounds`, confirmationStrategies: `${CONDITIONAL}confirmation_strategies`,
  confirmationDaily: `${CONDITIONAL}confirmation_daily`,
  frequencyRounds: `${CONDITIONAL}frequency_rounds`, frequencyVariants: `${CONDITIONAL}frequency_variants`,
  frequencyPortfolio: `${CONDITIONAL}frequency_portfolio`, frequencyYears: `${CONDITIONAL}frequency_years`,
  frequencyHours: `${CONDITIONAL}frequency_hours`,
  seasonBuckets: `${CONDITIONAL}season_buckets`, seasonSessions: `${CONDITIONAL}season_sessions`, seasonParts: `${CONDITIONAL}season_parts`,
  seasonEvents: `${CONDITIONAL}season_events`, seasonCalendar: `${CONDITIONAL}season_calendar`, seasonStability: `${CONDITIONAL}season_stability`,
  cascadeLevels: `${CONDITIONAL}cascade_levels`, cascadeOccupancy: `${CONDITIONAL}cascade_occupancy`, cascadeMoves: `${CONDITIONAL}cascade_stage_moves`,
  cascadeVolume: `${CONDITIONAL}cascade_volume_deciles`, cascadeVolumeSummary: `${CONDITIONAL}cascade_volume_summary`,
  cascadeVolatility: `${CONDITIONAL}cascade_volatility_indicators`, cascadeOracle: `${CONDITIONAL}cascade_oracle`,
  cascadeDetail: `${CONDITIONAL}cascade_levels_detail`, cascadeMinutes: `${CONDITIONAL}cascade_minute_state`,
  zoneSummary: `${CONDITIONAL}zone_summary`, zoneTouches: `${CONDITIONAL}zone_touches`, zoneLeak: `${CONDITIONAL}zone_leak_check`,
  buildSessions: `${BUILD}zone_build_sessions`, buildBars: `${BUILD}zone_build_bars`, buildEvents: `${BUILD}zone_build_events`,
  buildReference: `${BUILD}zone_build_reference_zones`,
} as const;

const ID = /^[A-Za-z0-9_.:+-]{1,160}$/;
const LIST = /^[A-Za-z0-9_,]{0,600}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["all", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

const querySchema = z.object({
  part: z.enum(TA_STRATEGY_PARTS).default("overview"),
  recipe: z.string().regex(ID).optional(),
  configuration: z.string().regex(ID).optional(),
  strategy: z.string().regex(ID).optional(),
  template: z.string().regex(ID).optional(),
  symbol: z.enum(BUILD_MARKETS).default("MNQ"),
  day: z.string().regex(DAY).optional(),
  families: z.string().regex(LIST).optional(),
  timeframes: z.string().regex(LIST).optional(),
  timeframe: z.enum(BUILD_TIMEFRAMES).default("5m"),
  period: z.enum(["all_years", "in_sample", "out_of_sample"]).default("all_years"),
  minimumTrades: z.coerce.number().int().min(0).max(1_000_000).default(100),
  bins: z.coerce.number().int().min(5).max(80).default(30),
  year: z.string().regex(/^(all|\d{4})$/).default("all"),
  weekday: z.enum(WEEKDAYS).default("all"),
  qualitySource: z.enum(["round", "corrected"]).default("round"),
  /** Changes after the page refreshes the lake views, so a cached "not landed yet" answer is not reused. */
  nonce: z.coerce.number().int().min(0).optional(),
  window: z.enum(["frozen", "overnight", "whole_day"]).default("whole_day"),
  cap: z.coerce.number().int().refine((value) => value === 0 || value === 2, "cap is 0 (unlimited) or 2").default(0),
  barSize: z.enum(["15m", "5m", "1m"]).default("15m"),
  strictness: z.enum(["frozen", "looser", "loosest"]).default("frozen"),
  measure: z.enum(["relative_volatility_to_session_average", "average_five_minute_range_ticks", "efficiency_relative_to_random_walk",
    "variance_ratio_five_minutes", "autocorrelation_lags_two_to_four_minutes", "breakout_follow_through_probability", "mean_volume_contracts"])
    .default("relative_volatility_to_session_average"),
});
type Query = z.infer<typeof querySchema>;

// ── reading ──────────────────────────────────────────────────────────────────

const NUMERIC_TYPE = /^(DOUBLE|FLOAT|REAL|BIGINT|INTEGER|SMALLINT|TINYINT|HUGEINT|UBIGINT|UINTEGER|USMALLINT|UTINYINT|DECIMAL.*|BOOLEAN)$/i;
const typeCache = new Map<string, { at: number; types: Array<{ name: string; type: string }> }>();
const TYPE_CACHE_MS = 10 * 60_000;

/** Forgets every cached column list (a test, or a lake whose views were just re-landed, starts clean). */
export function clearColumnTypeCache(): void {
  typeCache.clear();
}

async function columnTypes(context: StudyContext, view: string): Promise<Array<{ name: string; type: string }>> {
  const hit = typeCache.get(view);
  if (hit && Date.now() - hit.at < TYPE_CACHE_MS) return hit.types;
  const rows = await context.lake.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${text(view)} ORDER BY ordinal_position`,
  );
  const types = rows.map((row) => ({ name: String(row.column_name), type: String(row.data_type) }));
  if (types.length > 0) typeCache.set(view, { at: Date.now(), types });
  return types;
}

/** One output expression per column: timestamps as epoch milliseconds, dates (and session_date) as YYYY-MM-DD. */
function outputExpression(name: string, type: string): string {
  const quoted = ident(name);
  if (name === "session_date" || /^DATE$/i.test(type)) return `strftime(CAST(${quoted} AS DATE), '%Y-%m-%d') AS ${quoted}`;
  if (/^TIMESTAMP/i.test(type)) return `epoch_ms(CAST(${quoted} AS TIMESTAMP)) AS ${quoted}`;
  return quoted;
}

interface ReadOptions {
  where?: string;
  orderBy?: string;
  limit?: number;
  columns?: readonly string[];
  exclude?: readonly string[];
}

async function readRows(context: StudyContext, view: string, options: ReadOptions = {}): Promise<Row[]> {
  const types = await columnTypes(context, view);
  const wanted = options.columns ? new Set(options.columns) : null;
  const excluded = new Set(options.exclude ?? []);
  const expressions = types
    .filter((column) => (wanted ? wanted.has(column.name) : true) && !excluded.has(column.name))
    .map((column) => outputExpression(column.name, column.type));
  if (expressions.length === 0) return [];
  const sql = [
    `SELECT ${expressions.join(", ")} FROM ${ident(view)}`,
    options.where ? `WHERE ${options.where}` : "",
    options.orderBy ? `ORDER BY ${options.orderBy}` : "",
    options.limit ? `LIMIT ${num(options.limit)}` : "",
  ].join(" ");
  return context.lake.query<Row>(sql);
}

/** Every numeric (and boolean, as 0/1) column of `view` under `where`: eight numbers and a histogram each. */
async function profileColumns(context: StudyContext, view: string, where: string, bins: number,
  exclude: readonly string[] = [], only?: readonly string[]): Promise<ColumnProfile[]> {
  const types = await columnTypes(context, view);
  const numeric = types.filter((column) => NUMERIC_TYPE.test(column.type) && !exclude.includes(column.name)
    && column.name !== "recipe" && (only ? only.includes(column.name) : true));
  if (numeric.length === 0) return [];
  const source = `SELECT ${numeric.map((column) => `CAST(${ident(column.name)} AS DOUBLE) AS ${ident(column.name)}`).join(", ")} FROM ${ident(view)} WHERE ${where}`;
  const clean = `WITH source AS (${source}), long AS (UNPIVOT source ON COLUMNS(*) INTO NAME column_name VALUE value), `
    + `clean AS (SELECT column_name, value FROM long WHERE isfinite(value))`;
  const stats = await context.lake.query<Record<string, unknown>>(
    `${clean} SELECT column_name, count(*) AS n, avg(value) AS mean, median(value) AS median, stddev_samp(value) AS standard_deviation, `
    + `skewness(value) AS skewness, kurtosis(value) AS kurtosis, quantile_cont(value, 0.25) AS percentile_25, `
    + `quantile_cont(value, 0.75) AS percentile_75, min(value) AS minimum, max(value) AS maximum FROM clean GROUP BY column_name`,
  );
  const histogram = await context.lake.query<{ column_name: string; bin: number; n: number }>(
    `${clean}, bounds AS (SELECT column_name, min(value) AS low, max(value) AS high FROM clean GROUP BY column_name) `
    + `SELECT c.column_name, CAST(CASE WHEN b.high > b.low THEN LEAST(FLOOR((c.value - b.low) / (b.high - b.low) * ${num(bins)}), ${num(bins - 1)}) ELSE 0 END AS INTEGER) AS bin, `
    + `count(*) AS n FROM clean c JOIN bounds b USING (column_name) GROUP BY 1, 2`,
  );
  const numberOrNull = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const byColumn = new Map(stats.map((row) => [String(row.column_name), row]));
  return numeric.flatMap((column) => {
    const row = byColumn.get(column.name);
    if (!row) return [];
    const low = numberOrNull(row.minimum) ?? 0;
    const high = numberOrNull(row.maximum) ?? low;
    const binCount = high > low ? bins : 1;
    const width = high > low ? (high - low) / bins : 1;
    const counts = new Array<number>(binCount).fill(0);
    for (const entry of histogram) {
      if (entry.column_name !== column.name) continue;
      const slot = Math.min(Number(entry.bin), binCount - 1);
      counts[slot] = (counts[slot] ?? 0) + Number(entry.n);
    }
    return [{
      column: column.name,
      count: Number(row.n),
      mean: numberOrNull(row.mean),
      median: numberOrNull(row.median),
      standardDeviation: numberOrNull(row.standard_deviation),
      skewness: numberOrNull(row.skewness),
      kurtosis: numberOrNull(row.kurtosis),
      percentile25: numberOrNull(row.percentile_25),
      percentile75: numberOrNull(row.percentile_75),
      minimum: numberOrNull(row.minimum),
      maximum: numberOrNull(row.maximum),
      bins: counts.map((count, index) => (high > low
        ? { lower: low + index * width, upper: low + (index + 1) * width, count }
        : { lower: low - 0.5, upper: low + 0.5, count })),
    }];
  });
}

async function scalar<T>(context: StudyContext, sql: string): Promise<T | null> {
  const rows = await context.lake.query<{ value: T }>(sql);
  const value = rows[0]?.value;
  return value === undefined ? null : value;
}

/** max(recipe) for one market: the notebook's rule for tables with no finished_at. */
async function latestForSymbol(context: StudyContext, view: string, symbol: string): Promise<string | null> {
  return scalar<string>(context, `SELECT max(recipe) AS value FROM ${ident(view)} WHERE symbol = ${text(symbol)}`);
}

/** The last recipe of a conditional round, by finished_at. */
async function latestRound(context: StudyContext, round: number): Promise<string | null> {
  return scalar<string>(context, `SELECT arg_max(recipe, finished_at) AS value FROM ${ident(v.conditionalRounds)} WHERE round = ${num(round)}`);
}

function listOf(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

function need(context: StudyContext, value: string | undefined, name: string): value is string {
  if (value) return true;
  context.notes.push(`Pick a ${name} first.`);
  return false;
}

// ── parts ────────────────────────────────────────────────────────────────────

function costModel(): { costTicks: number; tickValueUsd: number; tickSizePoints: number; costPerSideUsd: number; source: string } {
  try {
    const model = JSON.parse(readFileSync(path.resolve(process.cwd(), "packages/config/cost_model.json"), "utf8")) as
      Record<string, { tick_value?: number; tick_size?: number; total_per_side?: number; total_round_trip?: number; source?: string }>;
    const mnq = model.MNQ ?? {};
    const tickValue = mnq.tick_value ?? 0.5;
    return {
      costTicks: (mnq.total_round_trip ?? 2.78) / tickValue,
      tickValueUsd: tickValue,
      tickSizePoints: mnq.tick_size ?? 0.25,
      costPerSideUsd: mnq.total_per_side ?? 1.39,
      source: mnq.source ?? "packages/config/cost_model.json",
    };
  } catch {
    return { costTicks: 5.56, tickValueUsd: 0.5, tickSizePoints: 0.25, costPerSideUsd: 1.39, source: "defaults (cost_model.json unreadable)" };
  }
}

async function overview(): Promise<OverviewBody> {
  const cost = costModel();
  return { goalTicks: GOAL_TICKS, costTicks: cost.costTicks, tickValueUsd: cost.tickValueUsd, tickSizePoints: cost.tickSizePoints,
    costPerSideUsd: cost.costPerSideUsd, costSource: cost.source };
}

async function battery(context: StudyContext): Promise<BatteryBody> {
  if ((await missingViews(context, [v.batteryRounds])).length > 0) return { rounds: [], reviews: [] };
  const rounds = await readRows(context, v.batteryRounds, { orderBy: "round, finished_at" });
  const reviews = (await context.lake.hasView(v.batteryReviews)) ? await readRows(context, v.batteryReviews, { orderBy: "round, rank" }) : [];
  return { rounds, reviews };
}

async function batteryRound(query: Query, context: StudyContext): Promise<BatteryRoundBody> {
  const empty: BatteryRoundBody = { configurations: [], oracle: [], oracleProfiles: [], importance: [] };
  if (!need(context, query.recipe, "round")) return empty;
  if ((await missingViews(context, [v.configurations, v.oracle, v.importance])).length > 0) return empty;
  const recipe = `recipe = ${text(query.recipe)}`;
  const oracleNames = (await columnTypes(context, v.oracle)).map((column) => column.name);
  const profiled = oracleNames.filter((name) => name.endsWith("_ticks") || name.endsWith("_count"));
  const swings = oracleNames.filter((name) => name.endsWith("swing_net_ticks"));
  const [configurations, oracle, oracleProfiles, importance] = await Promise.all([
    readRows(context, v.configurations, { where: recipe, exclude: ["recipe"] }),
    readRows(context, v.oracle, { where: `${recipe} AND complete_session`, columns: ["session_date", ...swings], orderBy: "session_date" }),
    profileColumns(context, v.oracle, `${recipe} AND complete_session`, query.bins, [], profiled),
    readRows(context, v.importance, { where: recipe, columns: ["timeframe", "horizon_bars", "model", "feature", "gain_share_mean", "folds_present"], orderBy: "gain_share_mean DESC" }),
  ]);
  return { configurations, oracle, oracleProfiles, importance };
}

async function batteryConfiguration(query: Query, context: StudyContext): Promise<BatteryConfigurationBody> {
  const empty: BatteryConfigurationBody = { daily: [], folds: [], tradeProfiles: [], tradeCount: 0 };
  if (!need(context, query.recipe, "round") || !need(context, query.configuration, "configuration")) return empty;
  if ((await missingViews(context, [v.batteryDaily, v.batteryTrades, v.batteryFolds])).length > 0) return empty;
  const where = `recipe = ${text(query.recipe)} AND configuration_id = ${text(query.configuration)}`;
  const [daily, folds, tradeProfiles, tradeCount] = await Promise.all([
    readRows(context, v.batteryDaily, { where, orderBy: "session_date", columns: ["session_date", "net_usd", "buy_and_hold_usd", "exposed_bars", "bars", "trade_count", "fold_index"] }),
    readRows(context, v.batteryFolds, { where, orderBy: "fold_index", exclude: ["recipe"] }),
    profileColumns(context, v.batteryTrades, where, query.bins, ["round", "trade_number", "fold_index"]),
    scalar<number>(context, `SELECT count(*) AS value FROM ${ident(v.batteryTrades)} WHERE ${where}`),
  ]);
  return { daily, folds, tradeProfiles, tradeCount: Number(tradeCount ?? 0) };
}

async function rules(context: StudyContext): Promise<RulesBody> {
  if ((await missingViews(context, [v.ruleRounds])).length > 0) return { rounds: [], reviews: [] };
  const rounds = await readRows(context, v.ruleRounds, { orderBy: "round" });
  const reviews = (await context.lake.hasView(v.ruleReviews)) ? await readRows(context, v.ruleReviews, { orderBy: "round, rank" }) : [];
  return { rounds, reviews };
}

async function rulesRound(query: Query, context: StudyContext): Promise<RulesRoundBody> {
  const empty: RulesRoundBody = { strict: false, period: query.period, rateColumn: "", points: [], baselines: [], inVersusOut: [], top: [], profiles: [], keptStrategies: [], strategyCount: 0 };
  if (!need(context, query.recipe, "rule round")) return empty;
  if ((await missingViews(context, [v.strategies, v.ruleDaily])).length > 0) return empty;
  const recipe = `recipe = ${text(query.recipe)}`;
  // The notebook tested the column's presence; the lake's union-by-name view always has it, so test for values.
  const hasStrictColumn = (await columnTypes(context, v.strategies)).some((column) => column.name === "all_years_target_hit_rate");
  const strictCount = hasStrictColumn
    ? await scalar<number>(context, `SELECT count(all_years_target_hit_rate) AS value FROM ${ident(v.strategies)} WHERE ${recipe}`)
    : 0;
  const strict = Number(strictCount ?? 0) > 0;
  const period = strict || query.period !== "all_years" ? query.period : "out_of_sample";
  const timeframes = listOf(query.timeframes);
  const filterOn = (alias: string) => [`${alias}recipe = ${text(query.recipe as string)}`,
    `${alias}${ident(`${period}_trade_count`)} >= ${num(query.minimumTrades)}`,
    timeframes.length ? `${alias}timeframe IN (${textList(timeframes)})` : "FALSE"].join(" AND ");
  const filter = filterOn("");
  const rate = strict ? `${period}_target_hit_rate` : `${period}_win_rate`;
  const nullRate = strict ? `s.${ident(`${period}_matched_null_target_hit_rate`)}` : "b.random_rate";
  const label = strict ? "s.gate" : "s.filter";
  const baselineJoin = strict ? "" : `LEFT JOIN (SELECT timeframe, stop, avg(${ident(`${period}_win_rate`)}) AS random_rate, `
    + `avg(${ident(`${period}_profit_factor`)}) AS random_profit_factor FROM ${ident(v.baselines)} WHERE ${recipe} GROUP BY 1, 2) b USING (timeframe, stop)`;
  const points = await context.lake.query<RulePoint>(
    `SELECT s.strategy_id, s.timeframe, coalesce(${label}, 'none') AS filter, s.${ident(rate)} AS rate, ${nullRate} AS random_rate, `
    + `s.${ident(rate)} - ${nullRate} AS lift_over_random, s.${ident(`${period}_profit_factor`)} AS profit_factor, `
    + `s.${ident(`${period}_net_ticks_per_session_day`)} AS net_ticks_per_session_day, s.${ident(`${period}_trades_per_session_day`)} AS trades_per_session_day, `
    + `s.${ident(`${period}_payoff_ratio`)} AS payoff_ratio FROM ${ident(v.strategies)} s ${baselineJoin} WHERE ${filterOn("s.")}`,
  );
  const baselines = strict || !(await context.lake.hasView(v.baselines)) ? [] : await context.lake.query<Row>(
    `SELECT timeframe, stop, avg(${ident(`${period}_win_rate`)}) AS random_rate, avg(${ident(`${period}_profit_factor`)}) AS random_profit_factor `
    + `FROM ${ident(v.baselines)} WHERE ${recipe} GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const topColumns = ["strategy_id", "timeframe", "rule_description", "gate", "filter", "stop", `${period}_trade_count`, `${period}_trades_per_session_day`,
    rate, `${period}_matched_null_target_hit_rate`, `${period}_profit_factor`, `${period}_net_ticks_per_trade`, `${period}_net_ticks_per_session_day`,
    "years_with_positive_lift", "z_over_matched_null", "benjamini_hochberg_significant", "edge_confirmed", "passes_round"];
  const [inVersusOut, top, profiles, kept] = await Promise.all([
    readRows(context, v.strategies, { where: `${recipe} AND in_sample_trade_count >= 100`, columns: ["strategy_id", "timeframe", "in_sample_net_ticks_per_session_day", "out_of_sample_net_ticks_per_session_day"] }),
    readRows(context, v.strategies, { where: filter, columns: topColumns, orderBy: `${ident(`${period}_net_ticks_per_session_day`)} DESC NULLS LAST`, limit: 300 }),
    profileColumns(context, v.strategies, filter, query.bins, ["round"]),
    context.lake.query<{ strategy_id: string }>(`SELECT DISTINCT strategy_id FROM ${ident(v.ruleDaily)} WHERE ${recipe} ORDER BY 1`),
  ]);
  return { strict, period, rateColumn: rate, points, baselines, inVersusOut, top, profiles, keptStrategies: kept.map((row) => row.strategy_id), strategyCount: points.length };
}

async function rulesStrategy(query: Query, context: StudyContext): Promise<RulesStrategyBody> {
  const empty: RulesStrategyBody = { daily: [], exits: [], yearly: [], tradeProfiles: [], tradeCount: 0 };
  if (!need(context, query.recipe, "rule round") || !need(context, query.strategy, "strategy")) return empty;
  if ((await missingViews(context, [v.ruleDaily, v.ruleTrades])).length > 0) return empty;
  const where = `recipe = ${text(query.recipe)} AND strategy_id = ${text(query.strategy)}`;
  const [daily, exits, yearly, tradeProfiles, tradeCount] = await Promise.all([
    readRows(context, v.ruleDaily, { where, columns: ["session_date", "net_ticks", "period"], orderBy: "session_date" }),
    context.lake.query<Row>(`SELECT exit_reason, count(*) AS trades, avg(net_ticks) AS mean_net_ticks FROM ${ident(v.ruleTrades)} WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`),
    (await context.lake.hasView(v.ruleYearly)) ? readRows(context, v.ruleYearly, { where, orderBy: "year", exclude: ["recipe"] }) : Promise.resolve([]),
    profileColumns(context, v.ruleTrades, where, query.bins, ["round"]),
    scalar<number>(context, `SELECT count(*) AS value FROM ${ident(v.ruleTrades)} WHERE ${where}`),
  ]);
  return { daily, exits, yearly, tradeProfiles, tradeCount: Number(tradeCount ?? 0) };
}

async function conditional(context: StudyContext): Promise<ConditionalBody> {
  const empty: ConditionalBody = { rounds: [], reviews: [], confirmation: { rounds: [], strategies: [], cumulativeExcess: { dates: [], series: [] }, pooled: [] } };
  if ((await missingViews(context, [v.conditionalRounds])).length > 0) return empty;
  const rounds = await readRows(context, v.conditionalRounds, { orderBy: "round, finished_at" });
  const reviews = (await context.lake.hasView(v.conditionalReviews)) ? await readRows(context, v.conditionalReviews, { orderBy: "round, rank" }) : [];
  if (!(await context.lake.hasView(v.confirmationRounds))) return { rounds, reviews, confirmation: empty.confirmation };
  const confirmationRounds = await readRows(context, v.confirmationRounds, { orderBy: "finished_at" });
  const last = confirmationRounds[confirmationRounds.length - 1];
  if (!last) return { rounds, reviews, confirmation: empty.confirmation };
  const recipe = `recipe = ${text(String(last.recipe))}`;
  const [strategies, daily] = await Promise.all([
    readRows(context, v.confirmationStrategies, { where: recipe }),
    readRows(context, v.confirmationDaily, { where: recipe, columns: ["name", "session_date", "excess_ticks"], orderBy: "session_date, name" }),
  ]);
  // the notebook's pooled line: the mean excess across strategies on each day, summed over days
  const byDay = new Map<string, { total: number; count: number }>();
  for (const row of daily) {
    const day = String(row.session_date);
    const entry = byDay.get(day) ?? { total: 0, count: 0 };
    entry.total += typeof row.excess_ticks === "number" ? row.excess_ticks : 0;
    entry.count += 1;
    byDay.set(day, entry);
  }
  let running = 0;
  const pooled = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([session_date, entry]) => {
    const pooledExcess = entry.total / entry.count;
    running += pooledExcess;
    return { session_date, pooled_excess_ticks: pooledExcess, cumulative_pooled_excess_ticks: running };
  });
  return { rounds, reviews, confirmation: { rounds: confirmationRounds, strategies, cumulativeExcess: cumulativeSeries(daily, "name", "excess_ticks"), pooled } };
}

async function conditionalRound(query: Query, context: StudyContext): Promise<ConditionalRoundBody> {
  const empty: ConditionalRoundBody = { levelQuality: [], levelQualitySource: "", templates: [], folds: [], sessionDays: [], families: [] };
  if (!need(context, query.recipe, "conditional round")) return empty;
  if ((await missingViews(context, [v.levelQuality, v.templates, v.conditionalFolds, v.zones15, v.levelEvents])).length > 0) return empty;
  const recipe = `recipe = ${text(query.recipe)}`;
  let levelQuality: Row[];
  let levelQualitySource = `${v.levelQuality} (${query.recipe})`;
  if (query.qualitySource === "corrected" && (await context.lake.hasView(v.levelQualityFixed))) {
    const fixed = await scalar<string>(context, `SELECT max(recipe) AS value FROM ${ident(v.levelQualityFixed)}`);
    levelQuality = fixed ? await readRows(context, v.levelQualityFixed, { where: `recipe = ${text(fixed)}` }) : [];
    levelQualitySource = `${v.levelQualityFixed} (${fixed ?? "none"})`;
  } else {
    levelQuality = await readRows(context, v.levelQuality, { where: recipe });
  }
  const [templates, folds, days, families] = await Promise.all([
    readRows(context, v.templates, { where: recipe, orderBy: "excess_ticks_per_session_day DESC NULLS LAST", exclude: ["recipe"] }),
    readRows(context, v.conditionalFolds, { where: recipe, orderBy: "template, test_year", exclude: ["recipe"] }),
    context.lake.query<{ day: string }>(`SELECT DISTINCT strftime(CAST(bar_timestamp + INTERVAL 9 HOUR AS DATE), '%Y-%m-%d') AS day FROM ${ident(v.zones15)} WHERE ${recipe} ORDER BY 1`),
    context.lake.query<{ family: string }>(`SELECT DISTINCT family FROM ${ident(v.levelEvents)} WHERE ${recipe} ORDER BY 1`),
  ]);
  return { levelQuality, levelQualitySource, templates, folds, sessionDays: days.map((row) => row.day), families: families.map((row) => row.family) };
}

async function conditionalSession(query: Query, context: StudyContext): Promise<ConditionalSessionBody> {
  const empty: ConditionalSessionBody = { bars: [], levels: [] };
  if (!need(context, query.recipe, "conditional round") || !need(context, query.day, "session day")) return empty;
  if ((await missingViews(context, [v.zones15, v.levelEvents])).length > 0) return empty;
  const recipe = `recipe = ${text(query.recipe)}`;
  const dayFilter = `${recipe} AND CAST(bar_timestamp + INTERVAL 9 HOUR AS DATE) = CAST(${text(query.day)} AS DATE)`;
  const bars = await readRows(context, v.zones15, {
    where: dayFilter, orderBy: "bar_timestamp",
    columns: ["bar_timestamp", "close", "atr", "support_low", "support_high", "support_strength", "support_families",
      "resistance_low", "resistance_high", "resistance_strength", "resistance_families", "inside_zone", "zones_within_2_atr"],
  });
  const families = listOf(query.families);
  if (bars.length === 0 || families.length === 0) return { bars, levels: [] };
  const levels = await context.lake.query<Row>(
    `WITH b AS (SELECT min(bar_timestamp) AS t0, max(bar_timestamp) AS t1, min(close) AS low, max(close) AS high FROM ${ident(v.zones15)} WHERE ${dayFilter}) `
    + `SELECT e.family, e.source, e.price, epoch_ms(CAST(greatest(e.known_from_timestamp, b.t0) AS TIMESTAMP)) AS drawn_from, `
    + `epoch_ms(CAST(least(e.valid_until_timestamp, b.t1) AS TIMESTAMP)) AS drawn_to, epoch_ms(CAST(e.known_from_timestamp AS TIMESTAMP)) AS known_from, `
    + `epoch_ms(CAST(e.valid_until_timestamp AS TIMESTAMP)) AS valid_until FROM ${ident(v.levelEvents)} e, b `
    + `WHERE e.${recipe} AND e.known_from_timestamp <= b.t1 AND e.valid_until_timestamp > b.t0 AND e.family IN (${textList(families)}) `
    + `AND e.price > b.low - ((b.high - b.low) * 0.3 + 10) AND e.price < b.high + ((b.high - b.low) * 0.3 + 10) ORDER BY e.known_from_timestamp LIMIT 3000`,
  );
  return { bars, levels };
}

async function conditionalTemplate(query: Query, context: StudyContext): Promise<ConditionalTemplateBody> {
  const empty: ConditionalTemplateBody = { daily: [], trials: [], exits: [], tradeProfiles: [], tradeCount: 0 };
  if (!need(context, query.recipe, "conditional round") || !need(context, query.template, "template")) return empty;
  if ((await missingViews(context, [v.conditionalDaily, v.trials, v.conditionalTrades])).length > 0) return empty;
  const where = `recipe = ${text(query.recipe)} AND template = ${text(query.template)}`;
  const [daily, trials, exits, tradeProfiles, tradeCount] = await Promise.all([
    readRows(context, v.conditionalDaily, { where, columns: ["session_date", "net_ticks", "matched_null_net_ticks", "excess_ticks"], orderBy: "session_date" }),
    readRows(context, v.trials, { where, columns: ["fold", "test_year", "trial", "objective_excess_sharpe_per_day", "raw_excess_sharpe_per_day", "trades_per_session_day", "feasible", "duplicate_of_earlier_trial"] }),
    context.lake.query<Row>(`SELECT exit_reason, count(*) AS trades, avg(net_ticks) AS mean_net_ticks, avg(net_r_multiple) AS mean_net_r_multiple FROM ${ident(v.conditionalTrades)} WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`),
    profileColumns(context, v.conditionalTrades, where, query.bins, ["round", "test_year"]),
    scalar<number>(context, `SELECT count(*) AS value FROM ${ident(v.conditionalTrades)} WHERE ${where}`),
  ]);
  return { daily, trials, exits, tradeProfiles, tradeCount: Number(tradeCount ?? 0) };
}

async function frequency(query: Query, context: StudyContext): Promise<FrequencyBody> {
  const empty: FrequencyBody = { rounds: [], variants: [], portfolio: [], years: [], prices: [], hours: [] };
  if ((await missingViews(context, [v.frequencyRounds, v.frequencyVariants, v.frequencyPortfolio, v.frequencyYears, v.frequencyHours])).length > 0) return empty;
  const rounds = await readRows(context, v.frequencyRounds, { orderBy: "finished_at" });
  const latest = await context.lake.query<{ recipe: string }>(
    `SELECT arg_max(p.recipe, r.finished_at) AS recipe FROM (SELECT DISTINCT symbol, recipe FROM ${ident(v.frequencyVariants)}) p `
    + `JOIN ${ident(v.frequencyRounds)} r USING (recipe) GROUP BY p.symbol`,
  );
  const recipes = latest.map((row) => row.recipe).filter(Boolean);
  if (recipes.length === 0) return { ...empty, rounds };
  const where = `recipe IN (${textList(recipes)})`;
  // the book settings the page's radios pick; years and hours are filtered here, the small tables go whole
  const keys = `symbol = ${text(query.symbol)} AND maximum_entries_per_session = ${num(query.cap)} AND timeframe = ${text(query.barSize)} `
    + `AND entry_strictness = ${text(query.strictness)}`;
  const [variants, portfolio, years, prices, hours] = await Promise.all([
    readRows(context, v.frequencyVariants, { where, exclude: ["recipe"] }),
    readRows(context, v.frequencyPortfolio, { where, exclude: ["recipe"] }),
    readRows(context, v.frequencyYears, { where: `${where} AND ${keys} AND session_window = ${text(query.window)} AND row_kind = 'all_books'`, orderBy: "year", exclude: ["recipe", "variant"] }),
    context.lake.query<Row>(`SELECT year, avg(average_close_price) AS average_close_price FROM ${ident(v.frequencyYears)} WHERE ${where} `
      + `AND symbol = ${text(query.symbol)} AND row_kind = 'variant' GROUP BY year ORDER BY year`),
    readRows(context, v.frequencyHours, {
      where: `${where} AND ${keys} AND (session_window = ${text(query.window)} OR name = 'opening_range_breakout_runner')`,
      orderBy: "name, entry_hour_pacific", exclude: ["recipe", "variant", "round"],
    }),
  ]);
  return { rounds, variants, portfolio, years, prices, hours };
}

const SEASON_MEASURES = ["relative_volatility_to_session_average", "average_five_minute_range_ticks", "efficiency_relative_to_random_walk",
  "variance_ratio_five_minutes", "autocorrelation_lags_two_to_four_minutes", "breakout_follow_through_probability", "mean_volume_contracts"];

async function season(query: Query, context: StudyContext): Promise<SeasonBody> {
  const empty: SeasonBody = { recipe: "", years: [], buckets: [], heat: [], shapeYear: "", shape: [], events: [], sessions: [], sessionProfiles: [], parts: [], calendar: [], stability: [],
    roundFive: EMPTY_ROUND };
  const views = [v.seasonBuckets, v.seasonSessions, v.seasonParts, v.seasonEvents, v.seasonCalendar, v.seasonStability];
  if ((await missingViews(context, views)).length > 0) return empty;
  const recipe = await latestForSymbol(context, v.seasonBuckets, query.symbol);
  if (!recipe) {
    context.notes.push(`The timing study has no ${query.symbol} rows.`);
    return empty;
  }
  const bySymbol = async (view: string) => (await latestForSymbol(context, view, query.symbol)) ?? recipe;
  const own = `symbol = ${text(query.symbol)} AND recipe = ${text(recipe)}`;
  const yearsRows = await context.lake.query<{ year: string }>(`SELECT DISTINCT year FROM ${ident(v.seasonBuckets)} WHERE ${own} ORDER BY 1`);
  const years = yearsRows.map((row) => String(row.year));
  const shapeYear = years.filter((year) => year !== "all").sort().pop() ?? "all";
  const bucketColumns = ["bucket_start_pacific", "session_offset_minutes", "session_part", "session_count", "weekday", "year",
    "mean_absolute_one_minute_return_basis_points", ...SEASON_MEASURES];
  const [sessionsRecipe = recipe, partsRecipe = recipe, eventsRecipe = recipe, calendarRecipe = recipe, stabilityRecipe = recipe] = await Promise.all(
    [v.seasonSessions, v.seasonParts, v.seasonEvents, v.seasonCalendar, v.seasonStability].map(bySymbol));
  const where = (view_recipe: string) => `symbol = ${text(query.symbol)} AND recipe = ${text(view_recipe)}`;
  const sessionColumns = ["session_date", "weekday", "overnight_to_regular_hours_volatility_ratio", "overnight_share_of_session_variance",
    ...["overnight", "regular_hours"].flatMap((part) => ["realized_volatility_basis_points", "range_ticks", "efficiency_ratio", "volume_contracts"].map((measure) => `${part}_${measure}`))];
  const [buckets, heat, shape, events, sessions, sessionProfiles, parts, calendar, stability] = await Promise.all([
    readRows(context, v.seasonBuckets, { where: `${own} AND year = ${text(query.year)} AND weekday = ${text(query.weekday)}`, columns: bucketColumns, orderBy: "session_offset_minutes" }),
    readRows(context, v.seasonBuckets, { where: `${own} AND year = 'all' AND weekday <> 'all'`, columns: ["weekday", "bucket_start_pacific", "session_offset_minutes", query.measure], orderBy: "session_offset_minutes" }),
    readRows(context, v.seasonBuckets, { where: `${own} AND weekday = 'all' AND year = ${text(shapeYear)}`, columns: ["session_offset_minutes", "bucket_start_pacific", "relative_volatility_to_session_average", "mean_absolute_one_minute_return_basis_points"], orderBy: "session_offset_minutes" }),
    readRows(context, v.seasonEvents, { where: `${where(eventsRecipe)} AND year = 'all'`, orderBy: "event, minutes_from_event", exclude: ["recipe"] }),
    readRows(context, v.seasonSessions, { where: where(sessionsRecipe), orderBy: "session_date", columns: sessionColumns }),
    profileColumns(context, v.seasonSessions, where(sessionsRecipe), query.bins, ["year"]),
    readRows(context, v.seasonParts, { where: `${where(partsRecipe)} AND year = 'all'`, exclude: ["recipe"] }),
    readRows(context, v.seasonCalendar, { where: where(calendarRecipe), exclude: ["recipe"] }),
    readRows(context, v.seasonStability, { where: where(stabilityRecipe), orderBy: "year", exclude: ["recipe"] }),
  ]);
  const roundFive = await conditionalRoundTemplates(context, 5, "excess_ticks");
  return { recipe, years, buckets, heat, shapeYear, shape, events, sessions, sessionProfiles, parts, calendar, stability, roundFive };
}

const EMPTY_SERIES: SeriesSet = { dates: [], series: [] };
const EMPTY_ROUND: RoundTemplates = { recipe: null, rounds: [], templates: [], cumulative: EMPTY_SERIES };

/** The last recipe of a conditional round: its rounds rows, templates and the cumulative daily `measure` per template. */
async function conditionalRoundTemplates(context: StudyContext, round: number, measure: "excess_ticks" | "net_ticks"): Promise<RoundTemplates> {
  if (!(await context.lake.hasView(v.conditionalRounds))) return EMPTY_ROUND;
  const recipe = await latestRound(context, round);
  if (!recipe) return EMPTY_ROUND;
  const where = `recipe = ${text(recipe)}`;
  const [rounds, templates, daily] = await Promise.all([
    readRows(context, v.conditionalRounds, { where: `round = ${num(round)}`, orderBy: "finished_at" }),
    readRows(context, v.templates, { where, exclude: ["recipe"] }),
    readRows(context, v.conditionalDaily, { where, columns: ["template", "session_date", measure], orderBy: "session_date, template" }),
  ]);
  return { recipe, rounds, templates, cumulative: cumulativeSeries(daily, "template", measure) };
}

async function cascade(query: Query, context: StudyContext): Promise<CascadeBody> {
  const empty: CascadeBody = { recipe: "", levels: [], occupancy: [], moves: [], volumeDeciles: [], volumeSummary: [], volatility: [], oracle: [], sessionDays: [],
    roundTen: EMPTY_ROUND };
  const views = [v.cascadeLevels, v.cascadeOccupancy, v.cascadeMoves, v.cascadeVolume, v.cascadeVolumeSummary, v.cascadeVolatility, v.cascadeOracle, v.cascadeMinutes];
  if ((await missingViews(context, views)).length > 0) return empty;
  const recipes = await Promise.all(views.map((view) => latestForSymbol(context, view, query.symbol)));
  if (!recipes[2]) {
    context.notes.push(`The cascade study has no ${query.symbol} rows.`);
    return empty;
  }
  const where = (index: number) => `symbol = ${text(query.symbol)} AND recipe = ${text(recipes[index] ?? "")}`;
  const [levels, occupancy, moves, volumeDeciles, volumeSummary, volatility, oracle, days] = await Promise.all([
    readRows(context, v.cascadeLevels, { where: where(0), exclude: ["recipe"] }),
    readRows(context, v.cascadeOccupancy, { where: where(1), orderBy: "state, stage", exclude: ["recipe"] }),
    readRows(context, v.cascadeMoves, { where: where(2), orderBy: "direction, stage", exclude: ["recipe"] }),
    readRows(context, v.cascadeVolume, { where: where(3), orderBy: "timeframe, decile", exclude: ["recipe"] }),
    readRows(context, v.cascadeVolumeSummary, { where: where(4), exclude: ["recipe"] }),
    readRows(context, v.cascadeVolatility, { where: where(5), exclude: ["recipe"] }),
    readRows(context, v.cascadeOracle, { where: where(6), exclude: ["recipe"] }),
    context.lake.query<{ day: string }>(`SELECT DISTINCT strftime(CAST(session_date AS DATE), '%Y-%m-%d') AS day FROM ${ident(v.cascadeMinutes)} WHERE ${where(7)} ORDER BY 1`),
  ]);
  const ten = await conditionalRoundTemplates(context, 10, "net_ticks");
  return { recipe: recipes[2] ?? "", levels, occupancy, moves, volumeDeciles, volumeSummary, volatility, oracle, sessionDays: days.map((row) => row.day),
    roundTen: ten };
}

async function sessionTrades(context: StudyContext, round: number, template: string | undefined, day: string): Promise<Row[]> {
  if (!template || !(await context.lake.hasView(v.conditionalTrades))) return [];
  const recipe = await latestRound(context, round);
  if (!recipe) return [];
  return readRows(context, v.conditionalTrades, {
    where: `recipe = ${text(recipe)} AND template = ${text(template)} AND CAST(session_date AS DATE) = CAST(${text(day)} AS DATE)`,
    columns: ["entry_timestamp", "exit_timestamp", "side", "entry_price", "exit_price", "net_ticks", "exit_reason"], orderBy: "entry_timestamp",
  });
}

async function cascadeSession(query: Query, context: StudyContext): Promise<CascadeSessionBody> {
  const empty: CascadeSessionBody = { minutes: [], levels: [], trades: [] };
  if (!need(context, query.day, "session day")) return empty;
  if ((await missingViews(context, [v.cascadeMinutes, v.cascadeDetail])).length > 0) return empty;
  const [minuteRecipe, detailRecipe] = await Promise.all([latestForSymbol(context, v.cascadeMinutes, query.symbol), latestForSymbol(context, v.cascadeDetail, query.symbol)]);
  if (!minuteRecipe) return empty;
  const minuteWhere = `symbol = ${text(query.symbol)} AND recipe = ${text(minuteRecipe)} AND CAST(session_date AS DATE) = CAST(${text(query.day)} AS DATE)`;
  const minutes = await readRows(context, v.cascadeMinutes, { where: minuteWhere, columns: ["timestamp", "close", "volume", "stage_up", "stage_down", "direction"], orderBy: "timestamp" });
  if (minutes.length === 0) return empty;
  const levels = detailRecipe ? await context.lake.query<Row>(
    `WITH b AS (SELECT min(timestamp) AS t0, max(timestamp) AS t1 FROM ${ident(v.cascadeMinutes)} WHERE ${minuteWhere}) `
    + `SELECT d.timeframe, d.price, d.side, d.broken, epoch_ms(CAST(greatest(d.known_timestamp, b.t0) AS TIMESTAMP)) AS drawn_from, `
    + `epoch_ms(CAST(least(d.end_timestamp, b.t1) AS TIMESTAMP)) AS drawn_to, epoch_ms(CAST(d.known_timestamp AS TIMESTAMP)) AS known_timestamp, `
    + `epoch_ms(CAST(d.end_timestamp AS TIMESTAMP)) AS end_timestamp FROM ${ident(v.cascadeDetail)} d, b `
    + `WHERE d.symbol = ${text(query.symbol)} AND d.recipe = ${text(detailRecipe)} AND d.known_timestamp <= b.t1 AND d.end_timestamp >= b.t0 ORDER BY d.known_timestamp LIMIT 5000`,
  ) : [];
  const trades = await sessionTrades(context, 10, query.template, query.day as string);
  return { minutes, levels, trades };
}

const ZONE_PROFILE_COLUMNS = ["favourable_ticks", "next_zone_distance_ticks", "zone_width_ticks", "stop_ticks_zone_to_zone", "break_even_hit_rate_zone_to_zone",
  "strength", "approach_speed_ticks_per_minute", "approach_length_atr", "rsi_14_previous_bar", "relative_volume_15", "seasonal_ahead_ratio_30",
  "seasonal_expected_move_60_ticks", "hour_pacific", "null_bounce_rate", "null_next_zone_reach_rate"];

async function zones(query: Query, context: StudyContext): Promise<ZonesBody> {
  const empty: ZonesBody = { recipe: "", summary: [], leak: [], touchStatistics: { resolvedTouches: 0, sessionDays: 0, favourableTicksMedian: null, shareOfTouchesPayingCost: null },
    profiles: [], sessionDays: [], roundsTwelveThirteen: { recipes: [], templates: [], cumulative: EMPTY_SERIES } };
  if ((await missingViews(context, [v.zoneSummary, v.zoneTouches, v.zoneLeak])).length > 0) return empty;
  const [summaryRecipe, leakRecipe, touchRecipe] = await Promise.all([v.zoneSummary, v.zoneLeak, v.zoneTouches].map((view) => latestForSymbol(context, view, query.symbol)));
  if (!summaryRecipe || !touchRecipe) {
    context.notes.push(`The zone-touch study has no ${query.symbol} rows.`);
    return empty;
  }
  const symbol = `symbol = ${text(query.symbol)}`;
  const touchWhere = `${symbol} AND recipe = ${text(touchRecipe)}`;
  const resolved = `${touchWhere} AND resolved AND NOT gapped_through`;
  const cost = costModel().costTicks;
  const [summary, leak, statistics, profiles, days] = await Promise.all([
    readRows(context, v.zoneSummary, { where: `${symbol} AND recipe = ${text(summaryRecipe)}` }),
    leakRecipe ? readRows(context, v.zoneLeak, { where: `${symbol} AND recipe = ${text(leakRecipe)}` }) : Promise.resolve([]),
    context.lake.query<Record<string, number | null>>(
      `SELECT count(*) AS resolved_touches, count(DISTINCT session_date) AS session_days, median(favourable_ticks) AS favourable_median, `
      + `avg(CASE WHEN favourable_ticks > ${num(cost)} THEN 1.0 ELSE 0.0 END) AS share_paying FROM ${ident(v.zoneTouches)} WHERE ${resolved}`,
    ),
    profileColumns(context, v.zoneTouches, resolved, query.bins, [], ZONE_PROFILE_COLUMNS),
    context.lake.query<{ day: string }>(`SELECT DISTINCT strftime(CAST(session_date AS DATE), '%Y-%m-%d') AS day FROM ${ident(v.zoneTouches)} WHERE ${touchWhere} ORDER BY 1`),
  ]);
  const row = statistics[0] ?? {};
  let roundsTwelveThirteen: ZonesBody["roundsTwelveThirteen"] = { recipes: [], templates: [], cumulative: EMPTY_SERIES };
  if (await context.lake.hasView(v.conditionalRounds)) {
    const recipes = await context.lake.query<Row>(
      `SELECT round, arg_max(recipe, finished_at) AS recipe FROM ${ident(v.conditionalRounds)} WHERE round IN (12, 13) GROUP BY round ORDER BY round`,
    );
    const names = recipes.map((entry) => String(entry.recipe));
    if (names.length > 0) {
      const where = `recipe IN (${textList(names)})`;
      const [templates, daily] = await Promise.all([
        readRows(context, v.templates, { where, orderBy: "round, template" }),
        readRows(context, v.conditionalDaily, { where, columns: ["template", "session_date", "net_ticks"], orderBy: "session_date, template" }),
      ]);
      roundsTwelveThirteen = { recipes, templates, cumulative: cumulativeSeries(daily, "template", "net_ticks") };
    }
  }
  return {
    recipe: touchRecipe, summary, leak,
    touchStatistics: {
      resolvedTouches: Number(row.resolved_touches ?? 0), sessionDays: Number(row.session_days ?? 0),
      favourableTicksMedian: typeof row.favourable_median === "number" ? row.favourable_median : null,
      shareOfTouchesPayingCost: typeof row.share_paying === "number" ? row.share_paying : null,
    },
    profiles, sessionDays: days.map((entry) => entry.day), roundsTwelveThirteen,
  };
}

async function zonesSession(query: Query, context: StudyContext): Promise<ZonesSessionBody> {
  const empty: ZonesSessionBody = { touches: [], minutes: [], trades: [] };
  if (!need(context, query.day, "session day")) return empty;
  if ((await missingViews(context, [v.zoneTouches])).length > 0) return empty;
  const touchRecipe = await latestForSymbol(context, v.zoneTouches, query.symbol);
  if (!touchRecipe) return empty;
  const day = `CAST(session_date AS DATE) = CAST(${text(query.day as string)} AS DATE)`;
  const touches = await readRows(context, v.zoneTouches, {
    where: `symbol = ${text(query.symbol)} AND recipe = ${text(touchRecipe)} AND ${day}`, orderBy: "timestamp",
    columns: ["timestamp", "side", "side_name", "near_edge", "far_edge", "strength", "families", "favourable_ticks", "next_zone_distance_ticks",
      "break_even_hit_rate_zone_to_zone", "reached_next_zone", "gapped_through", "bounced", "broke", "timed_out", "session_part"],
  });
  let minutes: Row[] = [];
  if (await context.lake.hasView(v.cascadeMinutes)) {
    const minuteRecipe = await latestForSymbol(context, v.cascadeMinutes, query.symbol);
    if (minuteRecipe) {
      minutes = await readRows(context, v.cascadeMinutes, { where: `symbol = ${text(query.symbol)} AND recipe = ${text(minuteRecipe)} AND ${day}`, columns: ["timestamp", "close"], orderBy: "timestamp" });
    }
  }
  const trades = await sessionTrades(context, 12, query.template, query.day as string);
  return { touches, minutes, trades };
}

async function buildDays(query: Query, context: StudyContext): Promise<BuildDaysBody> {
  if ((await missingViews(context, [v.buildSessions])).length > 0) return { days: [] };
  const rows = await context.lake.query<{ day: string }>(
    `SELECT DISTINCT strftime(CAST(session_date AS DATE), '%Y-%m-%d') AS day FROM ${ident(v.buildSessions)} WHERE symbol = ${text(query.symbol)} ORDER BY 1`,
  );
  return { days: rows.map((row) => row.day) };
}

async function build(query: Query, context: StudyContext): Promise<BuildBody> {
  const empty: BuildBody = { session: null, bars: [], events: [], reference: [] };
  if (!need(context, query.day, "session day")) return empty;
  if ((await missingViews(context, [v.buildSessions, v.buildBars, v.buildEvents, v.buildReference])).length > 0) return empty;
  const recipe = await scalar<string>(context, `SELECT max(recipe) AS value FROM ${ident(v.buildSessions)} WHERE symbol = ${text(query.symbol)}`);
  if (!recipe) return empty;
  const where = `symbol = ${text(query.symbol)} AND recipe = ${text(recipe)} AND CAST(session_date AS DATE) = CAST(${text(query.day as string)} AS DATE)`;
  const [sessions, bars, events, reference] = await Promise.all([
    readRows(context, v.buildSessions, { where }),
    readRows(context, v.buildBars, { where: `${where} AND timeframe = ${text(query.timeframe)}`, orderBy: "bar", exclude: ["symbol", "session_date", "timeframe", "recipe"] }),
    readRows(context, v.buildEvents, { where, orderBy: "known_from_seconds", columns: ["price", "source", "family", "family_group", "known_from_seconds", "valid_until_seconds"] }),
    readRows(context, v.buildReference, { where: `${where} AND timeframe = ${text(query.timeframe)}`, orderBy: "bar", exclude: ["symbol", "session_date", "timeframe", "recipe"] }),
  ]);
  if (sessions.length === 0) context.notes.push(`No ${query.symbol} session ending ${query.day} was landed (2025 sessions are).`);
  return { session: sessions[0] ?? null, bars: bars as unknown as BuildBar[], events: events as unknown as LevelEvent[], reference };
}

// ── the handler ──────────────────────────────────────────────────────────────

const handler: StudyHandler<typeof querySchema, unknown> = {
  slug: "ta-strategy-600-ticks",
  datasets: [...new Set(Object.values(v))],
  query: querySchema,
  cacheSeconds: 600,
  timeoutMs: 180_000,
  async run(query, context) {
    switch (query.part) {
      case "overview": return overview();
      case "battery": return battery(context);
      case "battery_round": return batteryRound(query, context);
      case "battery_configuration": return batteryConfiguration(query, context);
      case "rules": return rules(context);
      case "rules_round": return rulesRound(query, context);
      case "rules_strategy": return rulesStrategy(query, context);
      case "conditional": return conditional(context);
      case "conditional_round": return conditionalRound(query, context);
      case "conditional_session": return conditionalSession(query, context);
      case "conditional_template": return conditionalTemplate(query, context);
      case "frequency": return frequency(query, context);
      case "season": return season(query, context);
      case "cascade": return cascade(query, context);
      case "cascade_session": return cascadeSession(query, context);
      case "zones": return zones(query, context);
      case "zones_session": return zonesSession(query, context);
      case "build_days": return buildDays(query, context);
      case "build": return build(query, context);
      default: return {};
    }
  },
};

export default handler;
