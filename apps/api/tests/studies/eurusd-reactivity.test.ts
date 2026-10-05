/**
 * The EURUSD reactivity study (apps/api/studies/handlers/eurusd-reactivity.ts)
 * with a fake lake that records the SQL it is asked: the four parts, the query
 * schema refusing what must not reach SQL, a missing `bars` view degrading to
 * a note and empty data, and the pure computations the page shares
 * (packages/shared/src/studies/eurusd-reactivity.ts).
 */

import { describe, expect, it } from "vitest";
import handler from "../../studies/handlers/eurusd-reactivity";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  DAY_MILLISECONDS, causalRollingZScore, chooseTimeframe,
  type BrushBody, type ColumnsBody, type OverviewBody, type PageBody,
} from "@shared/studies/eurusd-reactivity";

type Canned = Array<{ match: string; rows: Array<Record<string, unknown>> }>;

function fakeLake(canned: Canned, served = true): { lake: StudyLake; sql: string[] } {
  const sql: string[] = [];
  const lake: StudyLake = {
    async query<T>(text: string): Promise<T[]> {
      sql.push(text);
      const hit = canned.find((entry) => text.includes(entry.match));
      return (hit ? hit.rows : []) as T[];
    },
    async hasView(name) {
      return served && name === "bars";
    },
    async columns() {
      return [];
    },
  };
  return { lake, sql };
}

function context(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

const DAY_ROWS = [
  { date: 1_577_836_800_000, open: 1.12, high: 1.13, low: 1.11, close: 1.125, minute_count: 1400, log_range: -3.9, log_return_basis_points: null, total_minutes: 4300, first_minute: 1_577_916_000_000, last_minute: 1_578_400_000_000 },
  { date: 1_577_923_200_000, open: 1.125, high: 1.135, low: 1.12, close: 1.13, minute_count: 1440, log_range: -4.2, log_return_basis_points: 44.4, total_minutes: 4300, first_minute: 1_577_916_000_000, last_minute: 1_578_400_000_000 },
];

describe("query schema", () => {
  it("defaults to the overview of EURUSD", () => {
    const parsed = handler.query.parse({});
    expect(parsed.part).toBe("overview");
    expect(parsed.pair).toBe("EURUSD");
    expect(parsed.target).toBe(200);
  });

  it("refuses a pair that is not one of the eighteen, so no text reaches SQL", () => {
    expect(handler.query.safeParse({ pair: "EURUSD' OR 1=1 --" }).success).toBe(false);
    expect(handler.query.safeParse({ pair: "constructor" }).success).toBe(false);
  });

  it("needs from and to for a brush, in order", () => {
    expect(handler.query.safeParse({ part: "brush" }).success).toBe(false);
    expect(handler.query.safeParse({ part: "brush", from: 10, to: 5 }).success).toBe(false);
    expect(handler.query.safeParse({ part: "brush", from: 5, to: 10 }).success).toBe(true);
  });

  it("bounds the page size and the bins", () => {
    expect(handler.query.safeParse({ part: "page", pageSize: 100_000 }).success).toBe(false);
    expect(handler.query.safeParse({ part: "columns", bins: 3 }).success).toBe(false);
  });
});

describe("overview part", () => {
  it("returns the daily frame on a UTC day boundary with measured timings", async () => {
    const { lake, sql } = fakeLake([
      { match: "date_trunc('day'", rows: DAY_ROWS },
      { match: "LIMIT 1000", rows: [{ timestamp: 1_577_916_000_000, open: 1.12, high: 1.121, low: 1.119, close: 1.12, volume: 40 }] },
    ]);
    const body = (await handler.run(handler.query.parse({}), context(lake))) as OverviewBody;
    expect(body.part).toBe("overview");
    expect(body.rows).toHaveLength(2);
    expect(body.rows[1]?.log_return_basis_points).toBeCloseTo(44.4, 6);
    expect(body.minuteCount).toBe(4300);
    expect(body.firstMinute).toBe(1_577_916_000_000);
    expect(body.timings.map((timing) => timing.stage)).toEqual(expect.arrayContaining(["aggregate one-minute bars to UTC days"]));
    expect(body.timings.every((timing) => timing.milliseconds >= 0)).toBe(true);
    expect(body.overviewKilobytes).toBeGreaterThan(0);
    const daily = sql.find((text) => text.includes("date_trunc('day'")) as string;
    expect(daily).toContain("AT TIME ZONE 'UTC'");
    expect(daily).toContain("root = 'EURUSD'");
    expect(daily).toContain("arg_min(open, t)");
    expect(daily).toContain("arg_max(close, t)");
    expect(daily).toContain("WHERE high > low");
  });

  it("answers empty data and a note when bars is not served", async () => {
    const { lake, sql } = fakeLake([], false);
    const ctx = context(lake);
    const body = (await handler.run(handler.query.parse({}), ctx)) as OverviewBody;
    expect(body.rows).toEqual([]);
    expect(ctx.notes[0]).toContain("Not in the lake yet: bars");
    expect(sql).toHaveLength(0);
  });
});

describe("brush part", () => {
  const from = 1_778_716_800_000;
  const to = from + 89 * DAY_MILLISECONDS;

  const canned: Canned = [
    {
      match: "time_bucket(",
      rows: [
        { time: from, open: 1.17, high: 1.172, low: 1.166, close: 1.168, volume: 100, minute_count: 1435 },
        { time: from + DAY_MILLISECONDS, open: 1.168, high: 1.17, low: 1.16, close: 1.165, volume: 120, minute_count: 1440 },
      ],
    },
    {
      match: "stddev_samp(r)",
      rows: [
        { grp: "brushed", n: 100, mean: 0, standard_deviation: 0.86, minimum: -41, maximum: 40, median: 0, percentile_1: -2.2, percentile_5: -1.2, percentile_25: -0.35, percentile_75: 0.35, percentile_95: 1.2, percentile_99: 2.2, range_low: -4, range_high: 4, skewness: 2.1, excess_kurtosis: 179 },
        { grp: "rest of history", n: 900, mean: 0, standard_deviation: 1.34, minimum: -114, maximum: 102, median: 0, percentile_1: -3.6, percentile_5: -1.8, percentile_25: -0.5, percentile_75: 0.5, percentile_95: 1.8, percentile_99: 3.6, range_low: -4.6, range_high: 4.6, skewness: -0.3, excess_kurtosis: 159 },
      ],
    },
    {
      match: "AS bucket",
      rows: [
        { grp: "brushed", bucket: 20, n: 60 },
        { grp: "brushed", bucket: -1, n: 2 },
        { grp: "rest of history", bucket: 20, n: 500 },
        { grp: "rest of history", bucket: 40, n: 7 },
      ],
    },
  ];

  it("picks about 200 candles, includes the last day whole, and returns both groups", async () => {
    const { lake, sql } = fakeLake(canned);
    const body = (await handler.run(handler.query.parse({ part: "brush", from, to }), context(lake))) as BrushBody;
    expect(body.timeframe).toBe("1d");
    expect(body.sliceEnd).toBe(to + DAY_MILLISECONDS);
    expect(body.spanMinutes).toBe(90 * 1440);
    expect(body.candles).toHaveLength(2);
    expect(body.candles[0]?.log_return_basis_points).toBeNull();
    expect(body.candles[1]?.log_return_basis_points).toBeCloseTo((Math.log(1.165) - Math.log(1.168)) * 1e4, 8);
    expect(body.minuteBarCount).toBe(2875);
    expect(body.summaries.map((summary) => summary.group)).toEqual(["brushed", "rest of history"]);
    expect(body.summaries[0]?.excess_kurtosis).toBe(179);
    expect(body.densityRange).toEqual([-4.6, 4.6]);
    expect(body.density).toHaveLength(40);
    const total = body.density.reduce((sum, bin) => sum + bin.brushed_density * (bin.upper - bin.lower), 0);
    expect(total).toBeCloseTo(60 / 100, 8);
    expect(body.timings.map((timing) => timing.stage)).toEqual([
      "brush to filter and resample", "nine-statistic describe, both groups", "density of brushed against rest",
    ]);
    const bucketed = sql.find((text) => text.includes("time_bucket(")) as string;
    expect(bucketed).toContain("INTERVAL '1 day'");
    expect(bucketed).toContain(`t < epoch_ms(${to + DAY_MILLISECONDS})`);
    const describe = sql.find((text) => text.includes("stddev_samp(r)")) as string;
    expect(describe).toContain("pow((returns.r - g.mean) / g.standard_deviation, 4)) - 3");
    expect(describe).toContain("isfinite(r)");
  });

  it("follows the target: a short span at a high target draws finer candles", async () => {
    const { lake } = fakeLake(canned);
    const body = (await handler.run(handler.query.parse({ part: "brush", from, to: from, target: 300 }), context(lake))) as BrushBody;
    expect(body.timeframe).toBe("5m");
  });

  it("answers an empty body when bars is not served", async () => {
    const { lake } = fakeLake([], false);
    const ctx = context(lake);
    const body = (await handler.run(handler.query.parse({ part: "brush", from, to }), ctx)) as BrushBody;
    expect(body.candles).toEqual([]);
    expect(body.summaries).toEqual([]);
    expect(ctx.notes).toHaveLength(1);
  });
});

describe("columns part", () => {
  it("profiles each column with a histogram whose bins and tails account for every value", async () => {
    const summary = (column: string, n: number) => ({
      column_name: column, n, mean: 1, standard_deviation: 0.5, minimum: 0, maximum: 2, median: 1, percentile_1: 0.1, percentile_5: 0.2,
      percentile_25: 0.5, percentile_75: 1.5, percentile_95: 1.8, percentile_99: 1.9, range_low: 0, range_high: 2, skewness: 0.1, excess_kurtosis: -0.2,
    });
    const { lake, sql } = fakeLake([
      { match: "avg(pow(", rows: [summary("open", 1000), summary("volume", 1000)] },
      { match: "AS bucket", rows: [{ column_name: "open", bucket: 0, n: 400 }, { column_name: "open", bucket: 39, n: 590 }, { column_name: "open", bucket: -1, n: 4 }, { column_name: "open", bucket: 40, n: 6 }] },
    ]);
    const body = (await handler.run(handler.query.parse({ part: "columns", bins: 40 }), context(lake))) as ColumnsBody;
    const open = body.columns.find((column) => column.column === "open");
    expect(open?.label).toBe("open price (absolute)");
    expect(open?.histogram).toHaveLength(40);
    const total = (open?.histogram.reduce((sum, bin) => sum + bin.count, 0) ?? 0) + (open?.belowRange ?? 0) + (open?.aboveRange ?? 0);
    expect(total).toBe(1000);
    expect(body.minuteCount).toBe(1000);
    expect(sql.some((text) => text.includes("UNPIVOT minute ON"))).toBe(true);
  });
});

describe("page part", () => {
  it("returns one page and finds the page holding a date", async () => {
    const { lake, sql } = fakeLake([
      { match: "count(*) AS total_rows", rows: [{ total_rows: 2_447_021, before_start: 1_000 }] },
      { match: "LIMIT 8 OFFSET", rows: [{ timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }] },
    ]);
    const body = (await handler.run(handler.query.parse({ part: "page", startAt: 1_700_000_000_000 }), context(lake))) as PageBody;
    expect(body.totalRows).toBe(2_447_021);
    expect(body.pageCount).toBe(Math.ceil(2_447_021 / 8));
    expect(body.page).toBe(125);
    expect(sql.some((text) => text.includes("OFFSET 1000"))).toBe(true);
  });

  it("clamps a page past the end", async () => {
    const { lake } = fakeLake([{ match: "count(*) AS total_rows", rows: [{ total_rows: 20, before_start: 0 }] }]);
    const body = (await handler.run(handler.query.parse({ part: "page", page: 999, pageSize: 8 }), context(lake))) as PageBody;
    expect(body.pageCount).toBe(3);
    expect(body.page).toBe(2);
  });
});

describe("shared computations", () => {
  it("chooses the timeframe nearest the target and breaks a tie toward the finer one", () => {
    expect(chooseTimeframe(90 * 1440, 200)).toBe("1d");
    expect(chooseTimeframe(7 * 1440, 200)).toBe("1h");
    expect(chooseTimeframe(200, 200)).toBe("1m");
    expect(chooseTimeframe(1, 200)).toBe("1m");
    expect(chooseTimeframe(2 * 5 * 15, 10)).toBe("15m");
    // 100 one-minute bars and 20 five-minute bars are both 40 from a target of 60: the finer wins.
    expect(chooseTimeframe(100, 60)).toBe("1m");
  });

  it("scores causally: null until a full window, sample deviation, nothing ahead of the day is read", () => {
    const values = [1, 2, 3, 4, 10];
    const z = causalRollingZScore(values, 3);
    expect(z.slice(0, 2)).toEqual([null, null]);
    expect(z[2]).toBeCloseTo((3 - 2) / 1, 12);
    expect(z[4]).toBeCloseTo((10 - 17 / 3) / Math.sqrt((((3 - 17 / 3) ** 2) + ((4 - 17 / 3) ** 2) + ((10 - 17 / 3) ** 2)) / 2), 12);
    const changedFuture = causalRollingZScore([1, 2, 3, 4, 999], 3);
    expect(changedFuture.slice(0, 4)).toEqual(z.slice(0, 4));
  });

  it("leaves a window holding an unknown or a constant unscored", () => {
    expect(causalRollingZScore([1, null, 3, 4, 5], 3)).toEqual([null, null, null, null, (5 - 4) / 1]);
    expect(causalRollingZScore([2, 2, 2, 2], 3)).toEqual([null, null, null, null]);
    expect(causalRollingZScore([1, 2, 3], 1)).toEqual([null, null, null]);
  });
});
