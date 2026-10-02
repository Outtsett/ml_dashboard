/**
 * Empirical source of truth: the insights ledger whole (a few hundred rows, filtered on the page)
 * and the conditional-edges cells for one timeframe and horizon, both from the newest recipe.
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident, num, text } from "../sql";
import type { StudyHandler } from "../types";
import {
  EDGE_HORIZONS, EDGE_TIMEFRAMES, LEDGER_VIEWS,
  type BaselineRow, type EdgeRow, type EdgeVerdictCount, type InsightRow, type LedgerBody,
} from "@shared/studies/empirical-source-of-truth";

const query = z.object({
  timeframe: z.enum(EDGE_TIMEFRAMES).default("1m"),
  horizon: z.coerce.number().int().refine((h) => (EDGE_HORIZONS as readonly number[]).includes(h)).default(1),
});

const EMPTY: LedgerBody = { insights: [], edges: [], baselines: [], edgeVerdicts: [], definitions: [] };

async function newest(context: Parameters<StudyHandler["run"]>[1], view: string): Promise<string> {
  const rows = await context.lake.query<{ recipe: string }>(`SELECT DISTINCT recipe FROM ${ident(view)}`);
  return rows.map((r) => r.recipe).sort().at(-1) ?? "";
}

const handler: StudyHandler<typeof query, LedgerBody> = {
  slug: "empirical-source-of-truth",
  datasets: Object.values(LEDGER_VIEWS),
  query,
  cacheSeconds: 600,
  async run(q, context) {
    const missing = await missingViews(context, Object.values(LEDGER_VIEWS));
    if (missing.length === Object.values(LEDGER_VIEWS).length) return EMPTY;
    const has = (view: string) => !missing.includes(view);
    const body: LedgerBody = { ...EMPTY };
    if (has(LEDGER_VIEWS.insights)) {
      const recipe = text(await newest(context, LEDGER_VIEWS.insights));
      body.insights = await context.lake.query<InsightRow>(
        `SELECT * EXCLUDE (recipe) FROM ${ident(LEDGER_VIEWS.insights)} WHERE recipe = ${recipe} ORDER BY category, study_slug, insight_id`);
    }
    if (has(LEDGER_VIEWS.edges) && has(LEDGER_VIEWS.baselines) && has(LEDGER_VIEWS.definitions)) {
      const recipe = text(await newest(context, LEDGER_VIEWS.edges));
      const edges = ident(LEDGER_VIEWS.edges);
      const [cells, baselines, counts, definitions] = await Promise.all([
        context.lake.query<EdgeRow>(
          `SELECT * EXCLUDE (recipe) FROM ${edges} WHERE recipe = ${recipe} AND timeframe = ${text(q.timeframe)} AND horizon_bars = ${num(q.horizon)}`),
        context.lake.query<BaselineRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(LEDGER_VIEWS.baselines)} WHERE recipe = ${recipe}`),
        context.lake.query<EdgeVerdictCount>(
          `SELECT timeframe, horizon_bars, verdict, count(*)::INTEGER AS cell_count FROM ${edges} WHERE recipe = ${recipe} GROUP BY ALL`),
        context.lake.query<{ name: string; value: string }>(
          `SELECT name, value FROM ${ident(LEDGER_VIEWS.definitions)} WHERE recipe = ${recipe}`),
      ]);
      Object.assign(body, { edges: cells, baselines, edgeVerdicts: counts, definitions });
    }
    for (const view of missing) context.notes.push(`${view} is not landed yet.`);
    return body;
  },
};

export default handler;
