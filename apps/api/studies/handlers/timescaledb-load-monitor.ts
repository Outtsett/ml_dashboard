/**
 * TimescaleDB load monitor: the loader's per-month INSERT log (throughput,
 * bytes per row cumulative against marginal, seconds against batch size).
 * Replaced datalake/notebooks/timescaledb_load.py.
 *
 * Reads derived_study_timescaledb_load_monitor_batches (179 rows) and
 * ..._load_facts (the notebook's constants), landed once by
 * packages/ml-engine/src/studies/timescaledb_load_monitor/build.py from
 * E:\lake-workspace\workspace.duckdb. The marginal bytes per row is computed
 * here with LAG over the batch order. Both tables are tiny, so every row goes
 * to the page and the batch window is applied there.
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident, text } from "../sql";
import type { StudyHandler } from "../types";
import type { BatchRow, LoadMonitorBody } from "@shared/studies/timescaledb-load-monitor";

const BATCHES = "derived_study_timescaledb_load_monitor_batches";
const FACTS = "derived_study_timescaledb_load_monitor_load_facts";

/**
 * `SELECT max(recipe)` over a hive-partitioned view trips a DuckDB internal
 * error, so the newest recipe is read with GROUP BY and filtered by literal.
 */
export function newestRecipeSql(view: string): string {
  return `SELECT recipe FROM ${ident(view)} GROUP BY recipe ORDER BY recipe DESC LIMIT 1`;
}

export function batchesSql(recipe: string): string {
  return `SELECT batch_number,
       CAST(epoch_ms(recorded_at) AS DOUBLE) AS recorded_at_epoch_milliseconds,
       CAST(epoch_ms(month_start) AS DOUBLE) AS month_start_epoch_milliseconds,
       asset_class, timeframe, lake_row_count, elapsed_seconds, rows_per_second,
       hypertable_bytes, hypertable_row_count, bytes_per_row,
       CAST(hypertable_bytes - LAG(hypertable_bytes) OVER (ORDER BY batch_number) AS DOUBLE)
         / NULLIF(hypertable_row_count - LAG(hypertable_row_count) OVER (ORDER BY batch_number), 0) AS marginal_bytes_per_row
FROM ${ident(BATCHES)}
WHERE recipe = ${text(recipe)}
ORDER BY batch_number`;
}

export function factsSql(recipe: string): string {
  return `SELECT fact, value FROM ${ident(FACTS)} WHERE recipe = ${text(recipe)} ORDER BY fact`;
}

const handler: StudyHandler<z.ZodObject<Record<string, never>>, LoadMonitorBody> = {
  slug: "timescaledb-load-monitor",
  datasets: [BATCHES, FACTS],
  query: z.object({}),
  cacheSeconds: 60,
  async run(_query, context) {
    const empty: LoadMonitorBody = { batches: [], facts: {}, recipe: null };
    if ((await missingViews(context, [BATCHES, FACTS])).length > 0) return empty;
    const newest = await context.lake.query<{ recipe: string }>(newestRecipeSql(BATCHES));
    const recipe = newest[0]?.recipe;
    if (!recipe) return empty;
    const [batches, facts] = await Promise.all([
      context.lake.query<BatchRow>(batchesSql(recipe)),
      context.lake.query<{ fact: string; value: number }>(factsSql(recipe)),
    ]);
    context.notes.push(
      "The load finished on 2026-09-12; this is its landed measurement log. The notebook's live PostgreSQL read (planner row estimate and hypertable size, which needs the superuser password) is not repeated: serving-copy rows and bytes are the last logged batch's cumulative figures, and that size predates the index build.",
    );
    return { batches, facts: Object.fromEntries(facts.map((row) => [row.fact, row.value])), recipe };
  },
};

export default handler;
