/**
 * Holt-Winters moving average stability: where the average stays an average
 * and where it compounds. Replaced notebooks/hwma_stability.py.
 *
 * Reads the notebook's three tables, landed by
 * packages/ml-engine/src/studies/hwma_stability/build.py from its standalone
 * hwma_stability.duckdb (built by scripts/hwma_stability.py on 2026-09-15):
 *   derived_study_hwma_stability_grid             6,859 (na, nb, nc) measurements
 *   derived_study_hwma_stability_price_series     the 2,000 MNQH6 closes they ran on
 *   derived_study_hwma_stability_run_information  one row: what, when, the defaults
 * Every row goes to the page (about 0.7 MB): the page re-runs the recursion on
 * the closes at the slider's parameters, draws the grid slice at its
 * acceleration and profiles every column, all in the browser. The state matrix,
 * eigenvalues and recursion are packages/shared/src/studies/hwma-stability.ts.
 */

import { z } from "zod";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import type { HwmaGridRow, HwmaPricePoint, HwmaRunInformation, HwmaStabilityBody } from "@shared/studies/hwma-stability";

const GRID = "derived_study_hwma_stability_grid";
const PRICES = "derived_study_hwma_stability_price_series";
const RUN_INFORMATION = "derived_study_hwma_stability_run_information";

export const EMPTY_BODY: HwmaStabilityBody = { runInformation: null, prices: [], grid: [] };

export const GRID_SQL = `
  SELECT na, nb, nc, spectral_radius, spectrally_stable, CAST(bars_emitted AS DOUBLE) AS bars_emitted,
         CAST(left_range_at_bar AS DOUBLE) AS left_range_at_bar, emitted_minimum, emitted_maximum,
         unbounded_minimum, unbounded_maximum, went_negative_unbounded, went_negative_emitted
  FROM "${GRID}"
  ORDER BY na, nb, nc`;

export const PRICES_SQL = `
  SELECT CAST(bar_index AS DOUBLE) AS bar_index, epoch_ms(timezone('UTC', "timestamp")) AS timestamp_ms, close
  FROM "${PRICES}"
  ORDER BY bar_index`;

export const RUN_INFORMATION_SQL = `
  SELECT epoch_ms(timezone('UTC', generated_at)) AS generated_at_ms, symbol, bars, snapshot, grid_step, grid_size,
         default_na, default_nb, default_nc, default_spectral_radius, range_multiple, source, measures, build_seconds, recipe
  FROM "${RUN_INFORMATION}"
  ORDER BY generated_at DESC
  LIMIT 1`;

const handler: StudyHandler<z.ZodObject<Record<string, never>>, HwmaStabilityBody> = {
  slug: "hwma-stability",
  datasets: [GRID, PRICES, RUN_INFORMATION],
  query: z.object({}),
  cacheSeconds: 600,
  async run(_query, context) {
    if ((await missingViews(context, [GRID, PRICES, RUN_INFORMATION])).length > 0) return EMPTY_BODY;
    const runInformation = (await context.lake.query<HwmaRunInformation>(RUN_INFORMATION_SQL))[0] ?? null;
    const prices = await context.lake.query<HwmaPricePoint>(PRICES_SQL);
    const grid = await context.lake.query<HwmaGridRow>(GRID_SQL);
    if (grid.length === 0 || prices.length === 0) context.notes.push("The HWMA stability tables are landed but empty.");
    return { runInformation, prices, grid };
  },
};

export default handler;
