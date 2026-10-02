/**
 * Walk-forward out-of-sample results of the quantlab MNQ transformer. Replaced
 * Trading/quantlab/notebooks/oos_results.py.
 *
 * Reads the four tables of dataset `study_quant_oos_results`, landed by
 * packages/ml-engine/src/studies/quant_oos_results/build.py from the run's own output
 * (scripts/run_oos_evaluation.py): `folds` (6 rows), `conviction` (30 rows,
 * one per fold and traded fraction), `summary` (1 row: the pooled numbers and
 * the two the notebook hard-coded, re-measured) and `fold_targets` (6 rows).
 * Everything is tiny, so all of it goes to the page. The conviction table is
 * aggregated here by the notebook's own query: trades summed, the three
 * rates averaged over folds, per traded fraction, widest first.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ident } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import type {
  OosConvictionFoldRow, OosConvictionRow, OosFoldRow, OosFoldTargetRow, OosResultsBody, OosSummaryRow,
} from "@shared/studies/quant-oos-results";

const PREFIX = "derived_study_quant_oos_results_";
export const OOS_VIEWS = {
  folds: `${PREFIX}folds`,
  conviction: `${PREFIX}conviction`,
  summary: `${PREFIX}summary`,
  foldTargets: `${PREFIX}fold_targets`,
} as const;

function mnqPointValue(): number {
  try {
    const model = JSON.parse(readFileSync(path.resolve(process.cwd(), "packages/config/cost_model.json"), "utf8")) as Record<string, { point_value?: number }>;
    return model.MNQ?.point_value ?? 2;
  } catch {
    return 2;
  }
}

const EMPTY: Omit<OosResultsBody, "pointValueUsd"> = { recipe: null, folds: [], conviction: [], convictionByFold: [], foldTargets: [], summary: null };

/** Rows of the latest recipe only, so a second landed recipe never doubles the tables. */
function latest(view: string): string {
  const name = ident(view);
  return `recipe = (SELECT max(recipe) FROM ${name})`;
}

const handler: StudyHandler<z.ZodObject<Record<string, never>>, OosResultsBody> = {
  slug: "quant-oos-results",
  datasets: Object.values(OOS_VIEWS),
  query: z.object({}),
  cacheSeconds: 600,
  async run(_query, context) {
    const pointValueUsd = mnqPointValue();
    if ((await missingViews(context, Object.values(OOS_VIEWS))).length > 0) return { ...EMPTY, pointValueUsd };
    const { folds, conviction, summary, foldTargets } = OOS_VIEWS;

    const foldRows = await context.lake.query<OosFoldRow & { recipe: string }>(
      `SELECT * FROM ${ident(folds)} WHERE ${latest(folds)} ORDER BY fold_index`,
    );
    const convictionRows = await context.lake.query<OosConvictionRow>(
      `SELECT traded_fraction,
              sum(trade_count)                 AS trade_count,
              avg(directional_accuracy)        AS directional_accuracy,
              avg(gross_mean_return_per_trade) AS gross_mean_return_per_trade,
              avg(net_mean_return_per_trade)   AS net_mean_return_per_trade
         FROM ${ident(conviction)}
        WHERE ${latest(conviction)}
        GROUP BY traded_fraction
        ORDER BY traded_fraction DESC`,
    );
    const convictionByFold = await context.lake.query<OosConvictionFoldRow>(
      `SELECT fold_index, traded_fraction, trade_count, directional_accuracy, gross_mean_return_per_trade,
              net_mean_return_per_trade, net_total_return
         FROM ${ident(conviction)}
        WHERE ${latest(conviction)}
        ORDER BY fold_index, traded_fraction DESC`,
    );
    const summaryRows = await context.lake.query<OosSummaryRow>(
      `SELECT * EXCLUDE (recipe) FROM ${ident(summary)} WHERE ${latest(summary)} LIMIT 1`,
    );
    const targetRows = await context.lake.query<OosFoldTargetRow>(
      `SELECT * EXCLUDE (recipe) FROM ${ident(foldTargets)} WHERE ${latest(foldTargets)} ORDER BY fold_index`,
    );

    const recipe = foldRows[0]?.recipe ?? null;
    return {
      recipe,
      folds: foldRows.map(({ recipe: _recipe, ...row }) => row as OosFoldRow),
      conviction: convictionRows,
      convictionByFold,
      foldTargets: targetRows,
      summary: summaryRows[0] ?? null,
      pointValueUsd,
    };
  },
};

export default handler;
