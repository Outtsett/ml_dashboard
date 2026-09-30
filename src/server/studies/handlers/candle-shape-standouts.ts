/**
 * Candle shape standouts: MNQ 1-minute candles whose proportions or size stand out against the
 * bars before them (src/ml/studies/candle_shape_standouts/build.py). The rules and the 328-cell
 * shape catalog go to the page whole; the standouts themselves (15,335 rows) are filtered by
 * reason, counted by calendar here, and sent sorted and capped, plus a fixed sample for the
 * every-column grid.
 */

import { z } from "zod";
import { missingViews } from "../views";
import { ident, num, text } from "../sql";
import type { StudyHandler } from "../types";
import {
  SORT_COLUMNS, STANDOUT_REASONS, STANDOUT_VIEWS,
  type CalendarCell, type RuleRow, type ShapeCatalogRow, type StandoutRow, type StandoutsBody,
} from "../../../shared/studies/candle-shape-standouts";

const query = z.object({
  reason: z.enum(["any", ...STANDOUT_REASONS]).default("any"),
  sort: z.enum(SORT_COLUMNS).default("range_to_trailing_mean_range_ratio"),
  weekday: z.string().regex(/^[a-z]{0,10}$/).default(""),
  month: z.string().regex(/^[a-z]{0,10}$/).default(""),
  limit: z.coerce.number().int().min(10).max(2000).default(200),
});

const EMPTY: StandoutsBody = { rules: [], catalog: [], weekdayByMonth: [], weekdayByHour: [], rows: [], sample: [], matching: 0 };

const COLUMNS = `* EXCLUDE (recipe, trading_day), CAST(trading_day AS VARCHAR) AS trading_day`;

const handler: StudyHandler<typeof query, StandoutsBody> = {
  slug: "candle-shape-standouts",
  datasets: Object.values(STANDOUT_VIEWS),
  query,
  cacheSeconds: 600,
  async run(q, context) {
    if ((await missingViews(context, Object.values(STANDOUT_VIEWS))).length > 0) return EMPTY;
    const view = ident(STANDOUT_VIEWS.standouts);
    const conditions = [q.reason === "any" ? "reason_count > 0" : `${ident(q.reason)}`];
    const calendarWhere = conditions.join(" AND ");
    if (q.weekday) conditions.push(`trading_day_of_week = ${text(q.weekday)}`);
    if (q.month) conditions.push(`month = ${text(q.month)}`);
    const where = conditions.join(" AND ");
    const ascending = q.sort === "trailing_shape_share_percent";
    const [rules, catalog, weekdayByMonth, weekdayByHour, rows, sample, count] = await Promise.all([
      context.lake.query<RuleRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(STANDOUT_VIEWS.rules)}`),
      context.lake.query<ShapeCatalogRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(STANDOUT_VIEWS.catalog)} ORDER BY bar_count`),
      context.lake.query<CalendarCell>(
        `SELECT trading_day_of_week AS row_key, month AS column_key, count(*)::INTEGER AS standout_count FROM ${view} WHERE ${calendarWhere} GROUP BY 1, 2`),
      context.lake.query<CalendarCell>(
        `SELECT trading_day_of_week AS row_key, new_york_hour AS column_key, count(*)::INTEGER AS standout_count FROM ${view} WHERE ${calendarWhere} GROUP BY 1, 2`),
      context.lake.query<StandoutRow>(
        `SELECT ${COLUMNS} FROM ${view} WHERE ${where} ORDER BY ${ident(q.sort)} ${ascending ? "ASC" : "DESC"} NULLS LAST, timestamp LIMIT ${num(q.limit)}`),
      context.lake.query<StandoutRow>(
        `SELECT ${COLUMNS} FROM ${view} WHERE ${where} ORDER BY hash(timestamp) LIMIT 4000`),
      context.lake.query<{ n: number }>(`SELECT count(*)::INTEGER AS n FROM ${view} WHERE ${where}`),
    ]);
    if ((count[0]?.n ?? 0) > sample.length) {
      context.notes.push(`The every-column grid shows a fixed sample of ${sample.length.toLocaleString()} of the ${(count[0]?.n ?? 0).toLocaleString()} matching standouts.`);
    }
    return { rules, catalog, weekdayByMonth, weekdayByHour, rows, sample, matching: count[0]?.n ?? 0 };
  },
};

export default handler;
