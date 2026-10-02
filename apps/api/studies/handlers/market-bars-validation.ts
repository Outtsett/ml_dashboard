/**
 * Every column of market_bars validated against the lake. Replaced
 * datalake/notebooks/market_bars_columns.py.
 *
 * Reads the validation record of the one-time copy of Iceberg market.bars into
 * PostgreSQL / TimescaleDB (derived_study_market_bars_validation_*, landed by
 * packages/ml-engine/src/studies/market_bars_validation/build.py from the notebook's standalone
 * workspace.duckdb). The notebook's latest-result-per-check query runs here
 * unchanged; the aggregations (tiers, coverage, fill rate, invariants, the
 * eight numbers, sum differences) are the pure functions in
 * packages/shared/src/studies/market-bars-validation.ts. The table is 1.6k rows, so the
 * page gets every latest check and filters it as its controls move.
 */

import { z } from "zod";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import { EMPTY_BODY, summarise, type CheckRow, type MeasurementRow, type ValidationBody } from "@shared/studies/market-bars-validation";

const CHECKS = "derived_study_market_bars_validation_checks";
const MEASUREMENT = "derived_study_market_bars_validation_measurement";
const TABLE_COLUMNS = "derived_study_market_bars_validation_table_columns";

/**
 * The MOST RECENT result per check, not the most recent run: the tiers cost
 * very different amounts (the fingerprint streams every float in the table) and
 * are run individually as often as together, so keying on the run would show
 * whichever tier went last and drop the rest.
 */
export const LATEST_PER_CHECK_SQL = `
  SELECT tier, column_name, check_name, lake_value, postgres_value, matched, recorded_timestamp
  FROM (
    SELECT tier, column_name, check_name, lake_value, postgres_value, matched, recorded_timestamp,
           row_number() OVER (PARTITION BY tier, column_name, check_name ORDER BY recorded_timestamp DESC) AS recency
    FROM "${CHECKS}"
  )
  WHERE recency = 1
  ORDER BY tier, column_name, check_name`;

const MEASUREMENT_SQL = `
  SELECT lake_row_count, comparison_target, validator_script, recorded_check_count, latest_check_count,
         tier_count, table_column_count, first_recorded_timestamp, last_recorded_timestamp
  FROM "${MEASUREMENT}"
  ORDER BY last_recorded_timestamp DESC
  LIMIT 1`;

const TABLE_COLUMNS_SQL = `SELECT DISTINCT column_position, column_name FROM "${TABLE_COLUMNS}" ORDER BY column_position`;

const handler: StudyHandler<z.ZodObject<Record<string, never>>, ValidationBody> = {
  slug: "market-bars-validation",
  datasets: [CHECKS, MEASUREMENT, TABLE_COLUMNS],
  query: z.object({}),
  cacheSeconds: 600,
  async run(_query, context) {
    if ((await missingViews(context, [CHECKS, MEASUREMENT, TABLE_COLUMNS])).length > 0) return EMPTY_BODY;
    const checks = await context.lake.query<CheckRow>(LATEST_PER_CHECK_SQL);
    const recorded = await context.lake.query<{ recorded: number }>(`SELECT count(*) AS recorded FROM "${CHECKS}"`);
    const measurement = (await context.lake.query<MeasurementRow>(MEASUREMENT_SQL))[0] ?? null;
    const tableColumns = (await context.lake.query<{ column_name: string }>(TABLE_COLUMNS_SQL)).map((row) => row.column_name);
    const superseded = Math.max(0, Number(recorded[0]?.recorded ?? checks.length) - checks.length);
    const body = summarise(checks, tableColumns, measurement, superseded);
    if (body.lakeRowCountFromSlices !== null && body.lakeRowCount !== body.lakeRowCountFromSlices) {
      context.notes.push(
        `The fill-rate denominator (${body.lakeRowCount?.toLocaleString("en-US") ?? "unknown"} rows) differs from the sum of the exact tier's slice row counts (${body.lakeRowCountFromSlices.toLocaleString("en-US")}); the slices may be from different runs.`,
      );
    }
    return body;
  },
};

export default handler;
