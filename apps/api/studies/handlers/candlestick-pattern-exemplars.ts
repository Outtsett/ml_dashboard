/**
 * Candlestick pattern exemplars: which candle actually is the pattern, and
 * does its prior-trend context agree. Replaced notebooks/candlestick_pattern_exemplars.py.
 *
 * Reads three views landed by packages/ml-engine/src/studies/candlestick_pattern_exemplars/build.py
 * (the notebook's two diagnostics.duckdb tables, which the dashboard could not
 * attach, plus the daily bars the firings were found on):
 *   derived_study_candlestick_pattern_exemplars_exemplars    4,528 firings (MNQ 1d, 44 of 61 patterns)
 *   derived_study_candlestick_pattern_exemplars_rules        61 rules
 *   derived_study_candlestick_pattern_exemplars_daily_bars   2,074 bars
 *
 * The query carries the two choices that change WHICH rows are sent: the
 * pattern and the context filter. Everything else (how many exemplars to
 * draw, the context-table scope, sorting) is applied in the browser.
 * Timestamps leave the database as epoch milliseconds and a UTC date string,
 * never as a Date, so the server's session time zone cannot shift a day.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import {
  EMPTY_BODY, EMPTY_SHAPES, MAXIMUM_EXEMPLARS, WINDOW_BARS_BEFORE, groupWindows,
  type Archetype, type ContextFilter, type ContextRow, type ExemplarsBody, type FiringRow, type Headline, type RuleRow,
  type ShapeColumns, type WindowBar,
} from "@shared/studies/candlestick-pattern-exemplars";

export const EXEMPLARS_VIEW = "derived_study_candlestick_pattern_exemplars_exemplars";
export const RULES_VIEW = "derived_study_candlestick_pattern_exemplars_rules";
export const DAILY_BARS_VIEW = "derived_study_candlestick_pattern_exemplars_daily_bars";

const DEFAULT_PATTERN = "CDLHAMMER";

/** The bar stamp as epoch milliseconds and a yyyy-mm-dd string, both read in UTC whatever the session zone. */
const STAMP_MILLISECONDS = "epoch_ms(timezone('UTC', bar_timestamp))";
const STAMP_DATE = "strftime(timezone('UTC', bar_timestamp), '%Y-%m-%d')";

/** The notebook's filter in SQL: pandas `==` / `!=` on strings, a missing value counting as different. */
function contextCondition(context: ContextFilter, alias = ""): string {
  const prior = `${alias}prior_trend_direction`;
  const required = `${alias}required_prior_trend`;
  if (context === "confirmed") return `${prior} IS NOT DISTINCT FROM ${required}`;
  if (context === "contradicted") return `${prior} IS DISTINCT FROM ${required}`;
  return "TRUE";
}

const query = z.object({
  pattern: z.string().regex(/^CDL[A-Z0-9_]{1,40}$/, "a TA-Lib pattern function name such as CDLHAMMER").default(DEFAULT_PATTERN),
  context: z.enum(["all", "confirmed", "contradicted"]).default("all"),
});

const handler: StudyHandler<typeof query, ExemplarsBody> = {
  slug: "candlestick-pattern-exemplars",
  datasets: [EXEMPLARS_VIEW, RULES_VIEW, DAILY_BARS_VIEW],
  query,
  cacheSeconds: 600,
  async run({ pattern: requested, context: contextFilter }, context) {
    if ((await missingViews(context, [EXEMPLARS_VIEW, RULES_VIEW, DAILY_BARS_VIEW])).length > 0) {
      return { ...EMPTY_BODY, context: contextFilter };
    }
    const { lake } = context;
    const exemplars = ident(EXEMPLARS_VIEW);
    const rules = ident(RULES_VIEW);
    const dailyBars = ident(DAILY_BARS_VIEW);

    const patterns = await lake.query<{ talib_function: string; firings: number }>(
      `SELECT talib_function, CAST(count(*) AS BIGINT) AS firings FROM ${exemplars} GROUP BY talib_function ORDER BY firings DESC, talib_function`,
    );
    const fired = new Set(patterns.map((row) => row.talib_function));
    const pattern = fired.has(requested) ? requested : (patterns[0]?.talib_function ?? null);
    if (pattern !== requested && patterns.length > 0) {
      context.notes.push(`${requested} never fired in this data, so ${pattern} is shown instead.`);
    }

    const [headlineRows, contextRows, shapeRows] = await Promise.all([
      lake.query<Headline>(
        `SELECT
           (SELECT CAST(count(*) AS BIGINT) FROM ${rules}) AS pattern_count,
           (SELECT CAST(count(*) AS BIGINT) FROM ${rules}
              WHERE required_prior_trend_for_bullish_signal IN ('up', 'down') OR required_prior_trend_for_bearish_signal IN ('up', 'down')) AS patterns_needing_prior_trend,
           (SELECT CAST(coalesce(sum(CASE WHEN talib_verifies_prior_trend THEN 1 ELSE 0 END), 0) AS BIGINT) FROM ${rules}) AS patterns_talib_verifies_prior_trend,
           CAST(count(DISTINCT talib_function) AS BIGINT) AS fired_pattern_count,
           CAST(count(*) AS BIGINT) AS firing_count,
           CAST(coalesce(sum(CASE WHEN required_prior_trend IN ('up', 'down') THEN 1 ELSE 0 END), 0) AS BIGINT) AS gated_firing_count,
           CAST(coalesce(sum(CASE WHEN required_prior_trend IN ('up', 'down') AND prior_trend_direction = required_prior_trend THEN 1 ELSE 0 END), 0) AS BIGINT) AS gated_held_count,
           CAST(min(symbol) AS VARCHAR) AS symbol,
           CAST(min(timeframe) AS VARCHAR) AS timeframe,
           strftime(timezone('UTC', min(bar_timestamp)), '%Y-%m-%d') AS first_bar_date,
           strftime(timezone('UTC', max(bar_timestamp)), '%Y-%m-%d') AS last_bar_date
         FROM ${exemplars}`,
      ),
      lake.query<ContextRow>(
        `WITH fired AS (
           SELECT talib_function,
                  count(*) AS firings,
                  sum(CASE WHEN required_prior_trend IN ('up', 'down') THEN 1 ELSE 0 END) AS context_required,
                  sum(CASE WHEN required_prior_trend IN ('up', 'down') AND prior_trend_direction = required_prior_trend THEN 1 ELSE 0 END) AS context_held
           FROM ${exemplars} GROUP BY talib_function
         )
         SELECT r.talib_function, CAST(r.bars_the_rule_reads AS INTEGER) AS bars_the_rule_reads, r.pattern_type,
                r.required_prior_trend_for_bullish_signal, r.required_prior_trend_for_bearish_signal,
                r.talib_verifies_prior_trend,
                CAST(coalesce(f.firings, 0) AS BIGINT) AS firings,
                CAST(coalesce(f.context_required, 0) AS BIGINT) AS context_required,
                CAST(coalesce(f.context_held, 0) AS BIGINT) AS context_held,
                CASE WHEN coalesce(f.context_required, 0) > 0 THEN 100.0 * f.context_held / f.context_required END AS context_held_percent
         FROM ${rules} r LEFT JOIN fired f USING (talib_function)
         ORDER BY r.bars_the_rule_reads, r.talib_function`,
      ),
      lake.query<{ timestamp_ms: number; talib_function: string; body: number; upper: number; lower: number }>(
        `SELECT ${STAMP_MILLISECONDS} AS timestamp_ms, talib_function,
                body_fraction_of_range AS body, upper_shadow_fraction_of_range AS upper, lower_shadow_fraction_of_range AS lower
         FROM ${exemplars}
         WHERE body_fraction_of_range IS NOT NULL AND upper_shadow_fraction_of_range IS NOT NULL AND lower_shadow_fraction_of_range IS NOT NULL
         ORDER BY bar_timestamp, talib_function`,
      ),
    ]);

    const shapes: ShapeColumns = { ...EMPTY_SHAPES, patterns: patterns.map((row) => row.talib_function), timestamp_ms: [], pattern_index: [], body: [], upper: [], lower: [] };
    const indexOf = new Map(shapes.patterns.map((name, position) => [name, position]));
    for (const row of shapeRows) {
      shapes.timestamp_ms.push(row.timestamp_ms);
      shapes.pattern_index.push(indexOf.get(row.talib_function) ?? -1);
      shapes.body.push(row.body);
      shapes.upper.push(row.upper);
      shapes.lower.push(row.lower);
    }

    let rule: RuleRow | null = null;
    let archetype: Archetype | null = null;
    let firings: FiringRow[] = [];
    let windows: Record<string, WindowBar[]> = {};
    if (pattern !== null) {
      const literal = text(pattern);
      const condition = contextCondition(contextFilter);
      const [ruleRows, archetypeRows, firingRows, windowRows] = await Promise.all([
        lake.query<RuleRow>(
          `SELECT talib_function, CAST(bars_the_rule_reads AS INTEGER) AS bars_the_rule_reads, pattern_type,
                  required_prior_trend_for_bullish_signal, required_prior_trend_for_bearish_signal,
                  talib_verifies_prior_trend, emitted_values, shape_conditions, adaptive_settings_used
           FROM ${rules} WHERE talib_function = ${literal}`,
        ),
        lake.query<Archetype>(
          `SELECT median(body_fraction_of_range) AS body_fraction_of_range,
                  median(upper_shadow_fraction_of_range) AS upper_shadow_fraction_of_range,
                  median(lower_shadow_fraction_of_range) AS lower_shadow_fraction_of_range
           FROM ${exemplars} WHERE talib_function = ${literal}`,
        ),
        lake.query<FiringRow>(
          `SELECT ${STAMP_MILLISECONDS} AS bar_timestamp_ms, ${STAMP_DATE} AS bar_date,
                  CAST(prototypicality_rank AS BIGINT) AS prototypicality_rank, signal_direction, CAST(emitted_value AS INTEGER) AS emitted_value,
                  body_fraction_of_range, upper_shadow_fraction_of_range, lower_shadow_fraction_of_range,
                  close_versus_open, close_versus_previous_close, prior_trend_direction, required_prior_trend,
                  archetype_distance, body_size_points, total_range_points, volume
           FROM ${exemplars}
           WHERE talib_function = ${literal} AND ${condition}
           ORDER BY prototypicality_rank, bar_timestamp`,
        ),
        lake.query<WindowBar & { firing_timestamp_ms: number }>(
          `WITH ordered AS (
             SELECT row_number() OVER (ORDER BY bar_timestamp) AS bar_index, bar_timestamp,
                    absolute_open_price, absolute_high_price, absolute_low_price, absolute_close_price
             FROM ${dailyBars}
           ),
           chosen AS (
             SELECT e.bar_timestamp AS firing_timestamp, o.bar_index AS firing_index
             FROM ${exemplars} e JOIN ordered o ON o.bar_timestamp = e.bar_timestamp
             WHERE e.talib_function = ${literal} AND ${contextCondition(contextFilter, "e.")}
             ORDER BY e.prototypicality_rank, e.bar_timestamp
             LIMIT ${num(MAXIMUM_EXEMPLARS)}
           )
           SELECT epoch_ms(timezone('UTC', c.firing_timestamp)) AS firing_timestamp_ms,
                  CAST(o.bar_index - c.firing_index AS INTEGER) AS bar_offset,
                  epoch_ms(timezone('UTC', o.bar_timestamp)) AS bar_timestamp_ms,
                  o.absolute_open_price, o.absolute_high_price, o.absolute_low_price, o.absolute_close_price
           FROM chosen c JOIN ordered o ON o.bar_index BETWEEN c.firing_index - ${num(WINDOW_BARS_BEFORE)} AND c.firing_index
           ORDER BY c.firing_timestamp, o.bar_index`,
        ),
      ]);
      rule = ruleRows[0] ?? null;
      archetype = archetypeRows[0] ?? null;
      firings = firingRows;
      windows = groupWindows(windowRows);
    }

    return {
      landed: true,
      headline: headlineRows[0] ?? null,
      patterns,
      pattern,
      context: contextFilter,
      rule,
      archetype,
      firings,
      windows,
      contextRows,
      shapes,
    };
  },
};

export default handler;
