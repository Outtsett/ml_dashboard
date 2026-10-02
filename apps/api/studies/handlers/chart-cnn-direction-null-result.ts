/**
 * Chart-image CNN direction report: does a 48-bar chart image predict the direction of a symmetric +/-B*ATR
 * barrier better than a 1D numeric control? Replaced Trading/quant/chart_cnn/pkg/report.py.
 *
 * Reads the four tables packages/ml-engine/src/studies/chart_cnn_direction_null_result/build.py landed (a few hundred rows in
 * all, so every row goes to the page and its controls filter in the browser): the out-of-sample results with
 * DeLong intervals, the paired 2D-minus-1D AUC difference, up-rate and mean R by predicted-score bin (5, 10
 * and 20 bins), and the 32 first-layer filters.
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident, text } from "../sql";
import type { StudyHandler } from "../types";
import type {
  DirectionNullBody, FilterWeightRow, ModelComparisonRow, ModelResultRow, ScoreBinRow,
} from "@shared/studies/chart-cnn-direction-null-result";

const PREFIX = "derived_study_chart_cnn_direction_null_result_";
const VIEWS = {
  results: `${PREFIX}model_results`,
  comparison: `${PREFIX}model_comparison`,
  bins: `${PREFIX}score_bins`,
  filters: `${PREFIX}first_layer_filters`,
} as const;

const EMPTY: DirectionNullBody = { recipe: "", modelResults: [], comparisons: [], scoreBins: [], filters: [] };

const handler: StudyHandler<z.ZodObject<Record<string, never>>, DirectionNullBody> = {
  slug: "chart-cnn-direction-null-result",
  datasets: Object.values(VIEWS),
  query: z.object({}),
  cacheSeconds: 600,
  async run(_query, context) {
    if ((await missingViews(context, Object.values(VIEWS))).length > 0) return EMPTY;

    // A second landing would add a recipe; the page shows the newest one. (DISTINCT then ORDER BY: DuckDB 1.5.5 raises an
    // internal error on max() over the hive `recipe` column of these views.)
    const latest = await context.lake.query<{ recipe: string }>(
      `SELECT recipe FROM (SELECT DISTINCT recipe FROM ${ident(VIEWS.results)}) ORDER BY recipe DESC LIMIT 1`,
    );
    const recipe = String(latest[0]?.recipe ?? "");
    const where = `WHERE recipe = ${text(recipe)}`;

    const [modelResults, comparisons, scoreBins, filters] = await Promise.all([
      context.lake.query<ModelResultRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.results)} ${where} ORDER BY dataset_tag, model_name`),
      context.lake.query<ModelComparisonRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.comparison)} ${where} ORDER BY dataset_tag`),
      context.lake.query<ScoreBinRow>(
        `SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.bins)} ${where} ORDER BY dataset_tag, model_name, bin_count_requested, bin_number`,
      ),
      context.lake.query<FilterWeightRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(VIEWS.filters)} ${where} ORDER BY filter_number, price_row, time_column`),
    ]);
    if (modelResults.length === 0) context.notes.push("The direction tables are defined but hold no rows for the newest recipe.");
    return { recipe, modelResults, comparisons, scoreBins, filters };
  },
};

export default handler;
