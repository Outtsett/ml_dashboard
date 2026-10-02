/**
 * Contract specifications study: the handler with a fake lake (SQL routed by
 * its shape, every interpolated value checked), and the pure compute the page
 * shares (third Friday, CME roll date, roll matching, tick value, profit,
 * staircase, hours, verification counts). Reference values for the dates come
 * from Python's calendar module, which the notebook used.
 */

import { describe, expect, it } from "vitest";
import handler from "../../studies/handlers/contract-specifications";
import type { StudyLake } from "../../studies/types";
import {
  LAKE_ROOTS,
  SPECIFICATION_SOURCE,
  barsByHour,
  centralHourOf,
  cmeRollDate,
  compareRolls,
  filterSpecifications,
  profitInCurrency,
  quarterlyExpiries,
  specificationRows,
  staircase,
  thirdFriday,
  ticksMoved,
  verificationSummary,
} from "@shared/studies/contract-specifications";

interface Seen {
  sql: string[];
}

function fakeLake(seen: Seen, served: string[] = ["ohlcv_1d", "ohlcv_1m"]): StudyLake {
  return {
    async query<T>(sql: string): Promise<T[]> {
      seen.sql.push(sql);
      if (sql.includes("lag(front_contract)")) {
        return [
          { roll_day: "2025-03-18", previous_contract: "MNQH5", front_contract: "MNQM5", front_contract_volume: 1404163 },
          { roll_day: "2025-06-16", previous_contract: "MNQM5", front_contract: "MNQU5", front_contract_volume: 827810 },
          { roll_day: "2026-01-05", previous_contract: "MNQH6", front_contract: "MNQM6", front_contract_volume: 10 },
        ] as T[];
      }
      if (sql.includes("min(day)")) {
        return [{ root: "MNQ", first_day: "2019-05-05", last_day: "2026-03-27", day_count: 2079n }] as T[];
      }
      if (sql.includes("hour(timestamp)")) {
        return [
          { stamped_hour_pacific: 13, one_minute_bar_count: 10n, first_timestamp: "2024-03-01 13:00", last_timestamp: "2025-12-30 13:59" },
          { stamped_hour_pacific: 15, one_minute_bar_count: 5n, first_timestamp: "2024-03-03 15:00", last_timestamp: "2026-03-27 15:30" },
        ] as T[];
      }
      return [{ day: "2025-03-17", front_contract: "MNQH5" }, { day: "2025-03-18", front_contract: "MNQM5" }] as T[];
    },
    async hasView(name) {
      return served.includes(name);
    },
    async columns() {
      return [];
    },
  };
}

describe("contract-specifications handler", () => {
  it("returns the front-contract days, the year's rolls, per-year counts, hours and coverage", async () => {
    const seen: Seen = { sql: [] };
    const notes: string[] = [];
    const parsed = handler.query.parse({ rollRoot: "MNQ", rollYear: "2025", hoursRoot: "MNQ", hoursSeries: "rootSeries" });
    const body = await handler.run(parsed, { lake: fakeLake(seen), notes });

    expect(body.coverage).toEqual([{ root: "MNQ", first_day: "2019-05-05", last_day: "2026-03-27", day_count: 2079 }]);
    expect(body.rolls.observedRolls.map((roll) => roll.roll_day)).toEqual(["2025-03-18", "2025-06-16"]);
    expect(body.rolls.rollCountByYear).toEqual([{ year: 2025, roll_count: 2 }, { year: 2026, roll_count: 1 }]);
    expect(body.rolls.frontByDay).toHaveLength(2);
    expect(body.hours.counts).toEqual([
      { stamped_hour_pacific: 13, one_minute_bar_count: 10 },
      { stamped_hour_pacific: 15, one_minute_bar_count: 5 },
    ]);
    expect(body.hours.firstTimestamp).toBe("2024-03-01 13:00");
    expect(body.hours.lastTimestamp).toBe("2026-03-27 15:30");
    expect(body.hours.totalBars).toBe(15);
    expect(notes).toEqual([]);
  });

  it("writes SQL with arg_max, outright contracts only, and the parsed root and year", async () => {
    const seen: Seen = { sql: [] };
    const parsed = handler.query.parse({ rollRoot: "ES", rollYear: "2019", hoursRoot: "NQ" });
    await handler.run(parsed, { lake: fakeLake(seen), notes: [] });
    const all = seen.sql.join("\n");
    expect(all).toContain("arg_max(symbol, volume)");
    expect(all).not.toMatch(/\bfirst\(|\blast\(/i);
    expect(all).toContain("symbol <> root AND symbol NOT LIKE '%-%'");
    expect(all).toContain("root = 'ES'");
    expect(all).toContain("DATE '2019-01-01'");
    expect(all).toContain("root = 'NQ' AND symbol <> root");
  });

  it("counts symbol = root when asked, and notes that only MNQ has such a series", async () => {
    const seen: Seen = { sql: [] };
    const empty: StudyLake = {
      ...fakeLake(seen),
      async query<T>(sql: string): Promise<T[]> {
        seen.sql.push(sql);
        return [] as T[];
      },
    };
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({ hoursRoot: "ES", hoursSeries: "rootSeries" }), { lake: empty, notes });
    expect(seen.sql.some((sql) => sql.includes("symbol = 'ES'"))).toBe(true);
    expect(body.hours.counts).toEqual([]);
    expect(notes.join(" ")).toContain("only MNQ carries a bare-root series");
  });

  it("refuses a root outside the lake's eight and a year outside its range", () => {
    expect(handler.query.safeParse({ rollRoot: "ES'; DROP TABLE x;--" }).success).toBe(false);
    expect(handler.query.safeParse({ rollYear: "1999" }).success).toBe(false);
    expect(handler.query.safeParse({ hoursSeries: "everything" }).success).toBe(false);
    expect(LAKE_ROOTS).toHaveLength(8);
  });

  it("degrades to an empty body and a note when a view is not served", async () => {
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({}), { lake: fakeLake({ sql: [] }, ["ohlcv_1d"]), notes });
    expect(body.coverage).toEqual([]);
    expect(body.hours.counts).toEqual([]);
    expect(notes.join(" ")).toContain("ohlcv_1m");
  });
});

describe("specification compute", () => {
  it("reads 42 contracts and 8 lake roots from the dashboard's own config", () => {
    const rows = specificationRows();
    expect(rows).toHaveLength(SPECIFICATION_SOURCE.contractCount);
    expect(rows.filter((row) => row.in_lake).map((row) => row.symbol).sort()).toEqual([...LAKE_ROOTS].sort());
    const mnq = rows.find((row) => row.symbol === "MNQ");
    expect(mnq?.tick_size_index_points).toBe(0.25);
    expect(mnq?.tick_value_per_contract).toBe(0.5);
    expect(mnq?.contract_multiplier_per_index_point).toBe(2);
    expect(mnq?.contract_months).toBe("H,M,U,Z");
  });

  it("tick value equals tick size times multiplier for the eight lake roots", () => {
    for (const row of specificationRows().filter((entry) => entry.in_lake)) {
      expect(row.tick_size_index_points * row.contract_multiplier_per_index_point).toBeCloseTo(row.tick_value_per_contract, 9);
    }
  });

  it("filters by hidden exchange groups, hidden currencies and the lake-only switch", () => {
    const rows = specificationRows();
    const lakeOnly = filterSpecifications(rows, [], [], true);
    expect(lakeOnly).toHaveLength(8);
    const withoutCme = filterSpecifications(rows, ["CME Group"], [], false);
    expect(withoutCme.every((row) => row.exchange_group !== "CME Group")).toBe(true);
    expect(filterSpecifications(rows, [], rows.map((row) => row.currency), false)).toHaveLength(0);
  });

  it("counts contracts and lake roots per verification source", () => {
    const summary = verificationSummary(specificationRows());
    expect(summary.reduce((sum, row) => sum + row.contracts, 0)).toBe(42);
    expect(summary.reduce((sum, row) => sum + row.in_lake, 0)).toBe(8);
  });
});

describe("formula compute", () => {
  it("MNQ: 40 ticks of 0.25 at 0.50 per tick is +20 for one contract and +100 for five", () => {
    const ticks = ticksMoved(10, 0.25);
    expect(ticks).toBe(40);
    expect(profitInCurrency(ticks, 0.5, 1)).toBe(20);
    expect(profitInCurrency(ticks, 0.5, 5)).toBe(100);
  });

  it("the staircase runs from tick 0 to tick k, one tick value per step, in either direction", () => {
    const up = staircase(3, 0.25, 0.5, 2);
    expect(up.map((point) => point.tick_index)).toEqual([0, 1, 2, 3]);
    expect(up.map((point) => point.running_total)).toEqual([0, 1, 2, 3]);
    expect(up[3]?.index_price_move_points).toBe(0.75);
    const down = staircase(-2, 0.25, 0.5, 1);
    expect(down.map((point) => point.tick_index)).toEqual([0, -1, -2]);
    expect(down.map((point) => point.running_total)).toEqual([0, -0.5, -1]);
    expect(staircase(0, 0.25, 0.5, 1)).toHaveLength(1);
  });
});

describe("months compute", () => {
  it("third Fridays match Python's calendar for 2025 and 2024", () => {
    expect(thirdFriday(2025, 3)).toBe("2025-03-21");
    expect(thirdFriday(2025, 6)).toBe("2025-06-20");
    expect(thirdFriday(2025, 9)).toBe("2025-09-19");
    expect(thirdFriday(2025, 12)).toBe("2025-12-19");
    expect(thirdFriday(2024, 3)).toBe("2024-03-15");
    expect(thirdFriday(2026, 2)).toBe("2026-02-20");
  });

  it("CME's roll date is the Monday four days before the third Friday", () => {
    expect(cmeRollDate("2025-03-21")).toBe("2025-03-17");
    expect(cmeRollDate("2025-12-19")).toBe("2025-12-15");
    for (const expiry of quarterlyExpiries(2025)) {
      expect(new Date(`${expiry.cme_roll_date}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  it("matches the lake's first roll from 21 days before to 3 days after each expiry", () => {
    const comparison = compareRolls(quarterlyExpiries(2025), [
      { roll_day: "2025-03-18", previous_contract: "MNQH5", front_contract: "MNQM5", front_contract_volume: 1 },
      { roll_day: "2025-06-16", previous_contract: "MNQM5", front_contract: "MNQU5", front_contract_volume: 1 },
      { roll_day: "2025-12-15", previous_contract: "MNQZ5", front_contract: "MNQH6", front_contract_volume: 1 },
    ]);
    expect(comparison.map((row) => row.lake_observed_roll_day)).toEqual(["2025-03-18", "2025-06-16", null, "2025-12-15"]);
    expect(comparison.map((row) => row.days_before_expiry)).toEqual([3, 4, null, 4]);
    expect(comparison[0]?.from_contract).toBe("MNQH5");
    expect(comparison[0]?.to_contract).toBe("MNQM5");
  });
});

describe("hours compute", () => {
  it("fills 24 stamped hours, flags the empty one and converts to Central (+2)", () => {
    const rows = barsByHour(Array.from({ length: 24 }, (_unused, hour) => ({ stamped_hour_pacific: hour, one_minute_bar_count: 100 })).filter((row) => row.stamped_hour_pacific !== 14));
    expect(rows).toHaveLength(24);
    expect(rows.filter((row) => row.no_bars).map((row) => row.stamped_hour_pacific)).toEqual([14]);
    expect(rows[14]?.hour_central_time).toBe(16);
    expect(centralHourOf(22)).toBe(0);
  });
});
