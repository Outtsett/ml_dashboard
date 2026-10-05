/**
 * Per-pair FX signal research: what each of 18 spot pairs costs to trade, how
 * many independent bets the panel holds, and which of 50 price-structure
 * features beat a best-of-N day-block permutation null. Replaced
 * Trading/forexmodel/notebooks/19_pair_signals.py.
 *
 * Reads the eight tables packages/ml-engine/src/studies/fx_pair_signals/build.py landed from
 * forexmodel's result CSVs (`derived_study_fx_pair_signals_<table>`), pinned to
 * the newest recipe. The notebook's group-bys run here in SQL (the hour curve's
 * median of medians, participation ratios, mean absolute correlations, the
 * survival table, the strongest survivors, the near duplicates); the small
 * tables go to the page whole. The screen (5,400 rows) is filtered here by the
 * page's controls and only its numeric columns are sent for the profiles; the
 * five large frames travel column by column (`encodeBody`), about 0.5 MB in all.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  EMPTY_WIRE, SCREEN_TARGETS, SCREEN_TIMEFRAMES, encodeBody,
  type BodyVersusTailRow, type CorrelationRow, type EigenRow, type FxPairSignalsWire, type HeatCell, type HourAcrossPairsRow,
  type InventoryRow, type ParticipationRow, type RedundancyRow, type ScreenProfileRow, type ScreenRow, type SpreadHourRow,
  type SpreadRow, type SurvivalRow, type TradabilityRow, type UnidentifiableRow,
} from "@shared/studies/fx-pair-signals";

const PREFIX = "derived_study_fx_pair_signals_";
export const VIEWS = {
  inventory: `${PREFIX}pair_inventory`,
  spread: `${PREFIX}pair_spread`,
  spreadHour: `${PREFIX}pair_spread_hour`,
  tradability: `${PREFIX}pair_tradability`,
  correlation: `${PREFIX}pair_correlation`,
  eigen: `${PREFIX}correlation_eigen`,
  screen: `${PREFIX}structure_screen`,
  redundancy: `${PREFIX}structure_redundancy`,
} as const;

const RECIPE_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const querySchema = z.object({
  pair: z.string().regex(/^(all|[A-Z]{6})$/).default("all"),
  timeframe: z.enum(["all", ...SCREEN_TIMEFRAMES]).default("all"),
  family: z.string().regex(/^(all|[a-z_]{1,40})$/).default("all"),
  target: z.enum(["both", ...SCREEN_TARGETS]).default("both"),
  criterion: z.enum(["family_wise", "per_feature"]).default("family_wise"),
  topCount: z.coerce.number().int().min(5).max(100).default(25),
  redundancyThreshold: z.coerce.number().min(0.5).max(0.999).default(0.95),
  heatmapTimeframe: z.enum(SCREEN_TIMEFRAMES).default("1h"),
  heatmapTarget: z.enum(SCREEN_TARGETS).default("forward_log_range"),
});
export type FxPairSignalsQuery = z.infer<typeof querySchema>;

/**
 * The newest recipe the inventory holds (every table of one build shares it).
 * DISTINCT + ORDER BY, not max(recipe): DuckDB 1.5.5 raises an internal error
 * ("Attempted to access index 8 within vector of size 8") aggregating the hive
 * partition column of a union_by_name read.
 */
async function newestRecipe(context: StudyContext): Promise<string | null> {
  const rows = await context.lake.query<{ recipe: string | null }>(
    `SELECT DISTINCT recipe FROM ${ident(VIEWS.inventory)} ORDER BY recipe DESC LIMIT 1`,
  );
  const recipe = rows[0]?.recipe ?? null;
  return recipe && RECIPE_PATTERN.test(recipe) ? recipe : null;
}

/** The screen filters as one WHERE clause (recipe first). */
export function screenWhere(query: FxPairSignalsQuery, recipe: string): string {
  const clauses = [`recipe = ${text(recipe)}`];
  if (query.pair !== "all") clauses.push(`pair = ${text(query.pair)}`);
  if (query.timeframe !== "all") clauses.push(`timeframe = ${text(query.timeframe)}`);
  if (query.family !== "all") clauses.push(`family = ${text(query.family)}`);
  if (query.target !== "both") clauses.push(`target = ${text(query.target)}`);
  return clauses.join(" AND ");
}

export function survivalColumn(criterion: FxPairSignalsQuery["criterion"]): string {
  return ident(criterion === "per_feature" ? "survives_per_feature" : "survives_family_wise");
}

const handler: StudyHandler<typeof querySchema, FxPairSignalsWire> = {
  slug: "fx-pair-signals",
  datasets: Object.values(VIEWS),
  query: querySchema,
  cacheSeconds: 600,
  async run(query, context) {
    if ((await missingViews(context, Object.values(VIEWS))).length > 0) return EMPTY_WIRE;
    const recipe = await newestRecipe(context);
    if (!recipe) {
      context.notes.push("The fx pair signal tables are defined but hold no recipe.");
      return EMPTY_WIRE;
    }
    const pinned = `recipe = ${text(recipe)}`;
    const lake = context.lake;
    const where = screenWhere(query, recipe);
    const survives = survivalColumn(query.criterion);

    const [
      inventory, spread, spreadHour, hourAcrossPairs, tradability, correlation, eigen, participation, bodyVersusTail,
      unidentifiable, survival, strongest, screenProfile, heatmap, nearDuplicates, redundancy, pairRows, familyRows,
    ] = await Promise.all([
      lake.query<InventoryRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.inventory)} WHERE ${pinned} ORDER BY pair`),
      lake.query<SpreadRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.spread)} WHERE ${pinned} ORDER BY spread_basis_points_median, pair`),
      lake.query<SpreadHourRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.spreadHour)} WHERE ${pinned} ORDER BY pair, hour_utc`),
      // The notebook: group_by(hour_utc).agg(spread_basis_points_median.median()).
      lake.query<HourAcrossPairsRow>(
        `SELECT hour_utc, median(spread_basis_points_median) AS median_basis_points, median(spread_pips_median) AS median_pips, ` +
          `count(*) AS pair_count FROM ${ident(VIEWS.spreadHour)} WHERE ${pinned} GROUP BY hour_utc ORDER BY hour_utc`,
      ),
      lake.query<TradabilityRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.tradability)} WHERE ${pinned} ORDER BY pair, timeframe`),
      lake.query<CorrelationRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.correlation)} WHERE ${pinned} ORDER BY timeframe, pair_a, pair_b`),
      lake.query<EigenRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.eigen)} WHERE ${pinned} ORDER BY timeframe, matrix, component`),
      // participation_ratio is constant within (timeframe, matrix); the notebook took first().
      lake.query<ParticipationRow>(
        `SELECT timeframe, matrix, max(participation_ratio) AS participation_ratio, max(observation_count) AS observation_count ` +
          `FROM ${ident(VIEWS.eigen)} WHERE ${pinned} GROUP BY timeframe, matrix ORDER BY timeframe, matrix`,
      ),
      lake.query<BodyVersusTailRow>(
        `SELECT timeframe, avg(abs(correlation_raw_pearson)) AS mean_absolute_raw, ` +
          `avg(abs(correlation_residual_pearson)) AS mean_absolute_residual, avg(abs(correlation_tail_decile)) AS mean_absolute_tail, ` +
          `count(*) AS pair_combination_count FROM ${ident(VIEWS.correlation)} WHERE ${pinned} GROUP BY timeframe ORDER BY timeframe`,
      ),
      lake.query<UnidentifiableRow>(
        `SELECT DISTINCT timeframe, pair_a, pair_b, shared_currency, correlation_residual_pearson FROM ${ident(VIEWS.correlation)} ` +
          `WHERE ${pinned} AND NOT residual_identifiable ORDER BY pair_a, pair_b, timeframe`,
      ),
      lake.query<SurvivalRow>(
        `SELECT target, family, count(*) AS tests, sum(CASE WHEN ${survives} THEN 1 ELSE 0 END) AS survived, ` +
          `max(abs(spearman_correlation)) AS max_absolute_spearman, ` +
          `sum(CASE WHEN ${survives} THEN 1 ELSE 0 END) / count(*) AS survival_rate ` +
          `FROM ${ident(VIEWS.screen)} WHERE ${where} GROUP BY target, family ORDER BY target, survival_rate DESC, family`,
      ),
      lake.query<ScreenRow>(
        `SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.screen)} WHERE ${where} AND ${survives} ` +
          `ORDER BY abs(spearman_correlation) DESC, pair, timeframe, target, feature LIMIT ${num(query.topCount)}`,
      ),
      lake.query<ScreenProfileRow>(
        `SELECT spearman_correlation, null_95th_percentile_per_feature, ` +
          `null_95th_percentile_family_wise, observation_count FROM ${ident(VIEWS.screen)} WHERE ${where}`,
      ),
      lake.query<HeatCell>(
        `SELECT pair, feature, family, spearman_correlation, ${survives} AS survives FROM ${ident(VIEWS.screen)} ` +
          `WHERE ${pinned} AND timeframe = ${text(query.heatmapTimeframe)} AND target = ${text(query.heatmapTarget)} ORDER BY family, feature, pair`,
      ),
      lake.query<RedundancyRow>(
        `SELECT feature_a, feature_b, family_a, family_b, spearman_correlation FROM ${ident(VIEWS.redundancy)} ` +
          `WHERE ${pinned} AND abs(spearman_correlation) > ${num(query.redundancyThreshold)} ` +
          `ORDER BY abs(spearman_correlation) DESC, feature_a, feature_b`,
      ),
      lake.query<RedundancyRow>(`SELECT feature_a, feature_b, family_a, family_b, spearman_correlation FROM ${ident(VIEWS.redundancy)} WHERE ${pinned}`),
      lake.query<{ pair: string }>(`SELECT DISTINCT pair FROM ${ident(VIEWS.inventory)} WHERE ${pinned} ORDER BY pair`),
      lake.query<{ family: string }>(`SELECT DISTINCT family FROM ${ident(VIEWS.screen)} WHERE ${pinned} ORDER BY family`),
    ]);

    if (query.pair !== "all" && !pairRows.some((row) => row.pair === query.pair)) context.notes.push(`No pair ${query.pair} in the screen.`);

    return encodeBody({
      recipe, inventory, spread, spreadHour, hourAcrossPairs, tradability, correlation, eigen, participation, bodyVersusTail,
      unidentifiable, survival, strongest, screenProfile, heatmap, nearDuplicates, redundancy,
      pairs: pairRows.map((row) => row.pair),
      families: familyRows.map((row) => row.family),
    });
  },
};

export default handler;
