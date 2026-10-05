/**
 * TrendState calibration: τ and η read from shuffled-return nulls, and whether the
 * calibrated flag earns anything on MNQ. Replaced
 * Trading/quant/analytics/notebooks/trend_state_calibration.py.
 *
 * Reads the nine tables Trading/quant/analytics trend.calibrate landed under
 * s3://derived/trend_state_calibration/recipe=<run>/table=<name>/ (served as
 * derived_trend_state_calibration_<name>). Everything but the sample bars is small
 * (≤ 360 rows per recipe) and goes whole to the page; the sample bars (≈ 12k minute
 * bars over the last ten Globex days) go one day at a time. The flag replay, τ
 * interpolation and ring-buffer stepper run in the browser on these rows
 * (packages/shared/src/studies/trend-state-calibration.ts).
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident, text } from "../sql";
import type { StudyHandler } from "../types";
import type {
  DistributionRow, EpisodeRow, MetricRow, NullQuantileRow, OverfittingRow, SampleBarRow, ThresholdGridRow, ThresholdRow,
  TrendStateCalibrationBody,
} from "@shared/studies/trend-state-calibration";

const PREFIX = "derived_trend_state_calibration";
const VIEW = {
  settings: `${PREFIX}_settings`,
  thresholds: `${PREFIX}_thresholds`,
  nullQuantiles: `${PREFIX}_null_quantiles`,
  thresholdGrid: `${PREFIX}_threshold_grid`,
  metrics: `${PREFIX}_metrics`,
  episodes: `${PREFIX}_episodes`,
  distributions: `${PREFIX}_distributions`,
  overfitting: `${PREFIX}_overfitting`,
  sampleBars: `${PREFIX}_sample_bars`,
} as const;

const RECIPE_PATTERN = /^[A-Za-z0-9_.-]{1,200}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RUNG_PATTERN = /^[0-9]+[a-z]+_[0-9]+$/;
const PER_RUNG_PREFIXES = ["trend_slope_log_points_per_bar_", "trend_t_statistic_scaled_", "trend_t_statistic_", "trend_r_squared_"];

/** A Globex day starts at 18:00 Eastern: the bar's close time minus 18 hours, as a date. */
const GLOBEX_DAY = "strftime(CAST(close_time - INTERVAL 18 HOUR AS DATE), '%Y-%m-%d')";

const querySchema = z.object({
  recipe: z.string().regex(RECIPE_PATTERN).optional(),
  day: z.string().regex(DAY_PATTERN).optional(),
});

function emptyBody(): TrendStateCalibrationBody {
  return {
    recipes: [], recipe: "", settings: {}, rungs: [], thresholds: [], nullQuantiles: [], thresholdGrid: [], metrics: [],
    episodes: [], distributions: [], overfitting: [], days: [], day: "", bars: [],
  };
}

/** The notebook's default: newest-named recipe that is not a smoke run. */
export function defaultRecipe(recipes: readonly string[]): string {
  return recipes.find((recipe) => !recipe.includes("smoke")) ?? recipes[0] ?? "";
}

/**
 * The day the page opens on: the newest Globex day that is most of a day. The
 * notebook opened on the newest day outright, which in the landed sample is the
 * last hour of 2025-12-30 (60 bars), so nothing on it could show the flag.
 */
export function defaultDay(rows: ReadonlyArray<{ day: string; bars?: number | null }>): string {
  const counts = rows.map((row) => (typeof row.bars === "number" ? row.bars : Number.NaN));
  const largest = Math.max(0, ...counts.filter((count) => Number.isFinite(count)));
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const count = counts[index] as number;
    if (!Number.isFinite(count) || count >= largest * 0.5) return (rows[index] as { day: string }).day;
  }
  return rows[rows.length - 1]?.day ?? "";
}

/** Rungs in ladder order: by window length in minutes (timeframe × bars), as trend_state lists them. */
const TIMEFRAME_MINUTES: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "2h": 120 };
export function orderRungs(thresholds: readonly ThresholdRow[]): string[] {
  const span = new Map<string, number>();
  for (const row of thresholds) {
    if (!RUNG_PATTERN.test(row.rung)) continue;
    span.set(row.rung, (TIMEFRAME_MINUTES[row.timeframe] ?? 1) * Number(row.window_bars));
  }
  return [...span.entries()].sort((a, b) => a[1] - b[1]).map(([rung]) => rung);
}

/** The sample-bar columns this recipe's rungs own, plus the close and the calibrated flag. */
export function sampleBarColumns(available: readonly string[], rungs: readonly string[]): string[] {
  const keep: string[] = [];
  for (const column of available) {
    if (column === "recipe" || column === "close_time") continue;
    if (column === "close" || column.startsWith("trend_regime_")) {
      keep.push(column);
      continue;
    }
    const prefix = PER_RUNG_PREFIXES.find((candidate) => column.startsWith(candidate));
    if (prefix && rungs.includes(column.slice(prefix.length))) keep.push(column);
  }
  return keep;
}

const handler: StudyHandler<typeof querySchema, TrendStateCalibrationBody> = {
  slug: "trend-state-calibration",
  datasets: Object.values(VIEW),
  query: querySchema,
  cacheSeconds: 600,
  async run(query, context) {
    if ((await missingViews(context, Object.values(VIEW))).length > 0) return emptyBody();
    const { lake } = context;

    const recipes = (await lake.query<{ recipe: string }>(`SELECT recipe FROM ${ident(VIEW.settings)} GROUP BY recipe ORDER BY recipe DESC`))
      .map((row) => String(row.recipe));
    if (recipes.length === 0) {
      context.notes.push(`${VIEW.settings} is defined but holds no run.`);
      return emptyBody();
    }
    let recipe = defaultRecipe(recipes);
    if (query.recipe !== undefined) {
      if (recipes.includes(query.recipe)) recipe = query.recipe;
      else context.notes.push(`No calibration run named ${query.recipe}; showing ${recipe}.`);
    }
    const where = `WHERE recipe = ${text(recipe)}`;
    const metricColumns = await lake.columns(VIEW.metrics);
    // Runs recorded before 2026-09-26 named the sample-size column `n`.
    const observationCount = metricColumns.includes("n") ? "COALESCE(observation_count, n)" : "observation_count";

    const [settingsRows, thresholds, nullQuantiles, thresholdGrid, metrics, episodes, distributions, overfitting, dayRows, barColumns] = await Promise.all([
      lake.query<Record<string, string | number | boolean | null>>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEW.settings)} ${where} LIMIT 1`),
      lake.query<ThresholdRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEW.thresholds)} ${where} ORDER BY rung, session_type`),
      lake.query<NullQuantileRow>(
        `SELECT null_scheme, rung, session_type, quantile_level, scaled_t_quantile, null_observations FROM ${ident(VIEW.nullQuantiles)} ${where} ORDER BY null_scheme, rung, session_type, quantile_level`,
      ),
      lake.query<ThresholdGridRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEW.thresholdGrid)} ${where} ORDER BY session_type, entry_probability, exit_probability`),
      lake.query<MetricRow>(
        `SELECT metric, stratum, value, ${observationCount} AS observation_count, target, null_mean, null_low, null_high, real_over_null, low, high,
                rung, expected_absolute_move_points, round_trip_cost_points, below_minimum_sample
           FROM ${ident(VIEW.metrics)} ${where}`,
      ),
      lake.query<EpisodeRow>(
        `SELECT epoch_ms(entry_time::TIMESTAMP) AS entry_time, epoch_ms(exit_time::TIMESTAMP) AS exit_time, * EXCLUDE (entry_time, exit_time, recipe)
           FROM ${ident(VIEW.episodes)} ${where} ORDER BY entry_time`,
      ),
      lake.query<DistributionRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEW.distributions)} ${where}`),
      lake.query<OverfittingRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEW.overfitting)} ${where}`),
      lake.query<{ day: string; bars: number }>(`SELECT ${GLOBEX_DAY} AS day, COUNT(*) AS bars FROM ${ident(VIEW.sampleBars)} ${where} GROUP BY day ORDER BY day`),
      lake.columns(VIEW.sampleBars),
    ]);

    const rungs = orderRungs(thresholds);
    const days = dayRows.map((row) => String(row.day));
    let day = defaultDay(dayRows);
    if (query.day !== undefined) {
      if (days.includes(query.day)) day = query.day;
      else if (days.length > 0) context.notes.push(`${query.day} is not in the landed sample of ${days[0]} to ${days[days.length - 1]}; showing ${day}.`);
    }
    let bars: SampleBarRow[] = [];
    if (day) {
      const columns = sampleBarColumns(barColumns, rungs);
      const missingRungs = rungs.filter((rung) => !columns.includes(`trend_t_statistic_scaled_${rung}`));
      if (missingRungs.length > 0) context.notes.push(`The sample bars carry no scaled t for ${missingRungs.join(", ")}; the live day cannot replay the flag.`);
      bars = await lake.query<SampleBarRow>(
        `SELECT epoch_ms(close_time::TIMESTAMP) AS close_time, ${columns.map(ident).join(", ")}
           FROM ${ident(VIEW.sampleBars)} ${where} AND ${GLOBEX_DAY} = ${text(day)} ORDER BY close_time`,
      );
    } else {
      context.notes.push(`The run ${recipe} landed no sample bars; the live-day replay is empty.`);
    }

    return {
      recipes, recipe, settings: settingsRows[0] ?? {}, rungs, thresholds, nullQuantiles, thresholdGrid, metrics, episodes,
      distributions, overfitting, days, day, bars,
    };
  },
};

export default handler;
