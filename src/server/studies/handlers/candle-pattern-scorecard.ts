/**
 * Candle pattern scorecard: can a network recognise TA-Lib candle patterns,
 * and does a pattern firing predict direction after cost? Replaced
 * datalake/notebooks/candle_pattern_scorecard.py.
 *
 * Reads derived_mnq_candle_pattern_scorecard (883 rows, built once by
 * datalake scripts/build_candle_pattern_scorecard.py: 4,000-resample
 * bootstrap, Benjamini-Yekutieli flag, MNQ round-trip cost). The table is
 * small, so every row goes to the page and the page filters as its controls
 * move. MNQ's point value comes from src/config/cost_model.json.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import type { ScorecardBody, ScorecardRow } from "../../../shared/studies/candle-pattern-scorecard";

const VIEW = "derived_mnq_candle_pattern_scorecard";

function mnqPointValue(): number {
  try {
    const model = JSON.parse(readFileSync(path.resolve(process.cwd(), "src/config/cost_model.json"), "utf8")) as Record<string, { point_value?: number }>;
    return model.MNQ?.point_value ?? 2;
  } catch {
    return 2;
  }
}

const handler: StudyHandler<z.ZodObject<Record<string, never>>, ScorecardBody> = {
  slug: "candle-pattern-scorecard",
  datasets: [VIEW],
  query: z.object({}),
  cacheSeconds: 600,
  async run(_query, context) {
    const pointValueUsd = mnqPointValue();
    if ((await missingViews(context, [VIEW])).length > 0) return { rows: [], pointValueUsd };
    const rows = await context.lake.query<ScorecardRow>(`SELECT * EXCLUDE (recipe) FROM "${VIEW}" ORDER BY timeframe, pattern_name, pattern_side, forward_candle_count`);
    return { rows, pointValueUsd };
  },
};

export default handler;
