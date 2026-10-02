/**
 * Stock-index futures: the parts of notebooks/contract_specifications.py that
 * come from the lake. The specification table itself is the dashboard's own
 * config (packages/config/contract_specifications.json), which the page reads
 * through packages/shared/src/instruments.ts.
 *
 *   coverage  first / last day and day count of the daily front contract per
 *             root (ohlcv_1d), so the page states measured coverage instead
 *             of a hard-coded sentence;
 *   rolls     the daily front contract (the contract with the most volume
 *             that day) for one root and year, and every day the leader
 *             changed, from the notebook's own SQL;
 *   hours     1-minute bar counts per stamped hour (Pacific wall clock as
 *             stored), whose empty hour is the 4-5 p.m. CT Globex halt.
 */

import { z } from "zod";
import { missingViews } from "../views";
import { num, text } from "../sql";
import type { StudyHandler } from "../types";
import {
  LAKE_ROOTS,
  type ContractSpecificationsBody,
  type FrontDay,
  type HoursBody,
  type ObservedRoll,
  type RollsBody,
  type RootCoverage,
} from "@shared/studies/contract-specifications";

const DAILY_VIEW = "ohlcv_1d";
const MINUTE_VIEW = "ohlcv_1m";

const ROOT_LIST = LAKE_ROOTS.map((root) => text(root)).join(", ");

/** Outright contracts only: no bare-root series and no calendar spreads ("ESU0-ESZ0"). */
const DAILY_CONTRACT_VOLUME = `
  SELECT root, symbol, CAST(timestamp AS DATE) AS day, sum(volume) AS volume
  FROM ${DAILY_VIEW}
  WHERE root IN (${ROOT_LIST}) AND symbol <> root AND symbol NOT LIKE '%-%'
  GROUP BY 1, 2, 3`;

const FRONT_CONTRACT_BY_DAY = `
  WITH daily AS (${DAILY_CONTRACT_VOLUME}),
  front AS (
    SELECT root, day, arg_max(symbol, volume) AS front_contract, max(volume) AS front_contract_volume
    FROM daily GROUP BY 1, 2)`;

const query = z.object({
  rollRoot: z.enum(LAKE_ROOTS).default("MNQ"),
  rollYear: z.coerce.number().int().min(2010).max(2035).default(2025),
  hoursRoot: z.enum(LAKE_ROOTS).default("MNQ"),
  hoursSeries: z.enum(["allContracts", "rootSeries"]).default("allContracts"),
});

type Query = z.infer<typeof query>;

function emptyBody(input: Query): ContractSpecificationsBody {
  return {
    coverage: [],
    rolls: { root: input.rollRoot, year: input.rollYear, frontByDay: [], observedRolls: [], rollCountByYear: [] },
    hours: { root: input.hoursRoot, series: input.hoursSeries, counts: [], firstTimestamp: null, lastTimestamp: null, totalBars: 0 },
  };
}

const handler: StudyHandler<typeof query, ContractSpecificationsBody> = {
  slug: "contract-specifications",
  datasets: [DAILY_VIEW, MINUTE_VIEW],
  query,
  cacheSeconds: 3600,
  async run(input, context) {
    const missing = await missingViews(context, [DAILY_VIEW, MINUTE_VIEW]);
    if (missing.length > 0) return emptyBody(input);

    const coverageRows = await context.lake.query<{ root: string; first_day: string; last_day: string; day_count: number }>(
      `${FRONT_CONTRACT_BY_DAY}
       SELECT root, strftime(min(day), '%Y-%m-%d') AS first_day, strftime(max(day), '%Y-%m-%d') AS last_day, count(*) AS day_count
       FROM front GROUP BY 1 ORDER BY 1`,
    );
    const coverage: RootCoverage[] = coverageRows.map((row) => ({
      root: row.root,
      first_day: row.first_day,
      last_day: row.last_day,
      day_count: Number(row.day_count),
    }));

    // Every day the volume leader changed, with the contract it changed from.
    const rollRows = await context.lake.query<{ roll_day: string; previous_contract: string; front_contract: string; front_contract_volume: number }>(
      `${FRONT_CONTRACT_BY_DAY},
       sequenced AS (
         SELECT root, day, front_contract, front_contract_volume,
                lag(front_contract) OVER (PARTITION BY root ORDER BY day) AS previous_contract
         FROM front WHERE root = ${text(input.rollRoot)})
       SELECT strftime(day, '%Y-%m-%d') AS roll_day, previous_contract, front_contract, front_contract_volume
       FROM sequenced WHERE previous_contract IS NOT NULL AND previous_contract <> front_contract
       ORDER BY day`,
    );
    const allRolls: ObservedRoll[] = rollRows.map((row) => ({
      roll_day: row.roll_day,
      previous_contract: row.previous_contract,
      front_contract: row.front_contract,
      front_contract_volume: Number(row.front_contract_volume),
    }));
    const countByYear = new Map<number, number>();
    for (const roll of allRolls) {
      const year = Number(roll.roll_day.slice(0, 4));
      countByYear.set(year, (countByYear.get(year) ?? 0) + 1);
    }

    const frontRows = await context.lake.query<FrontDay>(
      `${FRONT_CONTRACT_BY_DAY}
       SELECT strftime(day, '%Y-%m-%d') AS day, front_contract
       FROM front
       WHERE root = ${text(input.rollRoot)} AND day >= DATE ${text(`${num(input.rollYear)}-01-01`)} AND day <= DATE ${text(`${num(input.rollYear)}-12-31`)}
       ORDER BY day`,
    );
    const rolls: RollsBody = {
      root: input.rollRoot,
      year: input.rollYear,
      frontByDay: frontRows.map((row) => ({ day: row.day, front_contract: row.front_contract })),
      observedRolls: allRolls.filter((roll) => roll.roll_day.startsWith(`${input.rollYear}-`)),
      rollCountByYear: [...countByYear.entries()].sort(([a], [b]) => a - b).map(([year, roll_count]) => ({ year, roll_count })),
    };
    if (frontRows.length === 0) context.notes.push(`The lake has no daily bars for ${input.rollRoot} in ${input.rollYear}.`);

    // The notebook counts symbol = root; only MNQ carries such a series, so the default counts every outright contract of the root.
    const seriesFilter =
      input.hoursSeries === "rootSeries"
        ? `symbol = ${text(input.hoursRoot)}`
        : `root = ${text(input.hoursRoot)} AND symbol <> root AND symbol NOT LIKE '%-%'`;
    const hourRows = await context.lake.query<{ stamped_hour_pacific: number; one_minute_bar_count: number; first_timestamp: string; last_timestamp: string }>(
      `SELECT hour(timestamp) AS stamped_hour_pacific, count(*) AS one_minute_bar_count,
              strftime(min(timestamp), '%Y-%m-%d %H:%M') AS first_timestamp, strftime(max(timestamp), '%Y-%m-%d %H:%M') AS last_timestamp
       FROM ${MINUTE_VIEW} WHERE ${seriesFilter} GROUP BY 1 ORDER BY 1`,
      60_000,
    );
    const counts = hourRows.map((row) => ({ stamped_hour_pacific: Number(row.stamped_hour_pacific), one_minute_bar_count: Number(row.one_minute_bar_count) }));
    const hours: HoursBody = {
      root: input.hoursRoot,
      series: input.hoursSeries,
      counts,
      firstTimestamp: hourRows.reduce<string | null>((low, row) => (low === null || row.first_timestamp < low ? row.first_timestamp : low), null),
      lastTimestamp: hourRows.reduce<string | null>((high, row) => (high === null || row.last_timestamp > high ? row.last_timestamp : high), null),
      totalBars: counts.reduce((sum, row) => sum + row.one_minute_bar_count, 0),
    };
    if (counts.length === 0) {
      context.notes.push(
        input.hoursSeries === "rootSeries"
          ? `${input.hoursRoot} has no bars where symbol = ${input.hoursRoot} in ${MINUTE_VIEW}; only MNQ carries a bare-root series. Switch to every outright contract.`
          : `The lake has no 1-minute bars for ${input.hoursRoot}.`,
      );
    }

    return { coverage, rolls, hours };
  },
};

export default handler;
