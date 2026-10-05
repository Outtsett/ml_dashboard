/**
 * Price Regression tab performance: how many points a scatter should draw,
 * and whether Redis would speed up the reads. Replaced
 * notebooks/regression_tab_performance.py.
 *
 * Reads the five frozen measurement tables landed on 2026-09-23
 * (derived_regression_tab_performance_*: 1,680 + 40 + 108 + 5 + 3 rows). The
 * per-budget medians, the 90th percentile, the share of faithful variables and
 * the latency medians are aggregated here in DuckDB, exactly as the notebook
 * aggregated them in polars; the raw frames go along (all small) so the page
 * can draw every column.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import {
  EMPTY_BODY,
  FAITHFUL_SHAPE_ERROR,
  OBJECT_LAYER,
  RULE_LAYERS,
  RULE_MEASUREMENT_SETS,
  RULE_TIMEFRAME,
  type BudgetSummary,
  type CacheOptionRow,
  type CanvasDrawRow,
  type ClientFitRow,
  type LatencyGroup,
  type LatencyRow,
  type ObjectLatency,
  type RegressionTabPerformanceBody,
  type RenderSeriesRow,
  type RuleLatency,
} from "@shared/studies/regression-tab-performance";

const PREFIX = "derived_regression_tab_performance_";
const RENDER = `${PREFIX}render_threshold`;
const CANVAS = `${PREFIX}canvas_draw`;
const LATENCY = `${PREFIX}latency_layers`;
const FIT = `${PREFIX}client_fit`;
const CACHE = `${PREFIX}cache_option_reference`;
const VIEWS = [RENDER, CANVAS, LATENCY, FIT, CACHE];

const DEFAULT_GEOMETRY = "thumbnail@panel700";

const query = z.object({
  geometry: z.string().regex(/^[A-Za-z0-9_@.-]{1,40}$/).default(DEFAULT_GEOMETRY),
  mode: z.string().regex(/^[a-z_]{1,30}$/).default("all"),
});

function textIn(values: readonly string[]): string {
  return values.map(text).join(", ");
}

const handler: StudyHandler<typeof query, RegressionTabPerformanceBody> = {
  slug: "regression-tab-performance",
  datasets: VIEWS,
  query,
  cacheSeconds: 900,
  async run({ geometry: requestedGeometry, mode: requestedMode }, context) {
    if ((await missingViews(context, VIEWS)).length > 0) return { ...EMPTY_BODY };
    const lake = context.lake;

    const geometries = (await lake.query<{ geometry: string }>(`SELECT DISTINCT geometry FROM ${ident(RENDER)} ORDER BY geometry`)).map((row) => row.geometry);
    const modes = (await lake.query<{ mode: string }>(`SELECT DISTINCT mode FROM ${ident(RENDER)} ORDER BY mode`)).map((row) => row.mode);
    const budgets = (await lake.query<{ requested_budget: number }>(`SELECT DISTINCT requested_budget FROM ${ident(RENDER)} ORDER BY requested_budget`)).map((row) => Number(row.requested_budget));

    let geometry = requestedGeometry;
    if (!geometries.includes(geometry)) {
      geometry = geometries.includes(DEFAULT_GEOMETRY) ? DEFAULT_GEOMETRY : (geometries[0] ?? DEFAULT_GEOMETRY);
      context.notes.push(`No measurement for panel "${requestedGeometry}"; showing ${geometry}.`);
    }
    let mode = requestedMode;
    if (mode !== "all" && !modes.includes(mode)) {
      context.notes.push(`No measurement for Y axis "${requestedMode}"; showing all.`);
      mode = "all";
    }
    const where = `geometry = ${text(geometry)}${mode === "all" ? "" : ` AND mode = ${text(mode)}`}`;

    const renderRows = await lake.query<RenderSeriesRow>(
      `SELECT bar_series || ' · ' || mode || ' · ' || variable AS series_label, bar_series, timeframe, mode, variable, geometry,
              plot_width_pixels, plot_height_pixels, radius_pixels, series_points, requested_budget, points_drawn, covered_pixels,
              coverage_fraction, marginal_new_pixels_per_added_point, histogram_total_variation
       FROM ${ident(RENDER)} WHERE ${where}
       ORDER BY bar_series, mode, variable, requested_budget`,
    );

    const byBudget = await lake.query<BudgetSummary>(
      `SELECT requested_budget,
              median(coverage_fraction) AS median_coverage_fraction,
              median(histogram_total_variation) AS median_shape_error,
              quantile_cont(histogram_total_variation, 0.9) AS ninetieth_percentile_shape_error,
              avg(CASE WHEN histogram_total_variation < ${num(FAITHFUL_SHAPE_ERROR)} THEN 1.0 ELSE 0.0 END) AS share_of_variables_faithful,
              median(points_drawn) AS median_points_drawn,
              count(*) AS series_count
       FROM ${ident(RENDER)} WHERE ${where}
       GROUP BY requested_budget ORDER BY requested_budget`,
    );

    const canvasDraw = await lake.query<CanvasDrawRow>(
      `SELECT run_index, surface, plot_width_pixels, plot_height_pixels, radius_pixels, points_drawn,
              median_draw_milliseconds, microseconds_per_point, note
       FROM ${ident(CANVAS)} ORDER BY surface, run_index, points_drawn`,
    );
    // Steady runs only (2 and 3): run 1 was taken while the page was busy with the regression grid.
    const steady = await lake.query<{ median: number | null; minimum: number | null; maximum: number | null }>(
      `SELECT median(microseconds_per_point) AS median, min(microseconds_per_point) AS minimum, max(microseconds_per_point) AS maximum
       FROM ${ident(CANVAS)} WHERE surface = 'thumbnail' AND run_index > 1`,
    );
    const steadyRow = steady[0];

    const latencyRows = await lake.query<LatencyRow>(
      `SELECT layer, endpoint, symbol, timeframe, bars_requested, object, cache_state, run_index,
              time_to_first_byte_milliseconds, total_milliseconds, payload_bytes, measurement_set
       FROM ${ident(LATENCY)} ORDER BY layer, measurement_set, object, cache_state, timeframe, run_index`,
    );
    const latencyGroups = await lake.query<LatencyGroup>(
      `SELECT layer, measurement_set, object, cache_state, timeframe,
              count(*) AS measurement_count,
              median(total_milliseconds) AS median_total_milliseconds,
              median(time_to_first_byte_milliseconds) AS median_time_to_first_byte_milliseconds
       FROM ${ident(LATENCY)}
       GROUP BY layer, measurement_set, object, cache_state, timeframe
       ORDER BY layer, measurement_set, object, cache_state, timeframe`,
    );
    const latencyByObject = await lake.query<ObjectLatency>(
      `SELECT object, cache_state, median(total_milliseconds) AS median_milliseconds
       FROM ${ident(LATENCY)} WHERE layer = ${text(OBJECT_LAYER)}
       GROUP BY object, cache_state ORDER BY object, cache_state`,
    );
    const latencyByRule = await lake.query<RuleLatency>(
      `SELECT measurement_set, cache_state, median(total_milliseconds) AS median_milliseconds
       FROM ${ident(LATENCY)}
       WHERE measurement_set IN (${textIn(RULE_MEASUREMENT_SETS)}) AND layer IN (${textIn(RULE_LAYERS)}) AND timeframe = ${text(RULE_TIMEFRAME)}
       GROUP BY measurement_set, cache_state ORDER BY measurement_set, cache_state`,
    );

    const clientFit = await lake.query<ClientFitRow>(`SELECT "where", bars, variables, milliseconds, note FROM ${ident(FIT)} ORDER BY milliseconds`);
    const cacheOptions = await lake.query<CacheOptionRow>(`SELECT "option", payload_megabytes, milliseconds, source FROM ${ident(CACHE)} ORDER BY milliseconds DESC`);

    if (renderRows.length === 0) context.notes.push("The selected panel and Y axis have no measured series.");

    return {
      geometry,
      mode,
      geometries,
      modes,
      budgets,
      renderRows,
      byBudget,
      canvasDraw,
      steadyMicrosecondsPerPoint: steadyRow?.median ?? null,
      steadyRange: steadyRow && steadyRow.minimum !== null && steadyRow.maximum !== null ? { minimum: steadyRow.minimum, maximum: steadyRow.maximum } : null,
      latencyRows,
      latencyGroups,
      latencyByObject,
      latencyByRule,
      clientFit,
      cacheOptions,
    };
  },
};

export default handler;
