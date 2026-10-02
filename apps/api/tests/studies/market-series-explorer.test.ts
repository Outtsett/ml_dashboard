/**
 * The market-series-explorer study: the handler's real SQL run on an in-memory
 * DuckDB whose `bars` table carries the lake's columns (two futures contracts
 * that roll on a known day at a known 1.1 ratio, and a forex pair with quotes),
 * the pure computations it shares with the page (polars-convention statistics,
 * span, thinning, causal z-score), and the page rendered to a string from the
 * handler's body. Opt-in at the bottom: MARKET_SERIES_EXPLORER_LIVE=1 runs the
 * handler over the real lake and holds it to the notebook's own numbers.
 */

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler, { buildBody, interleaveSql, querySchema, seriesSql, universeSql } from "../../studies/handlers/market-series-explorer";
import { plainRow } from "../../studies/sql";
import type { StudyLake } from "../../studies/types";
import Page from "@/studies/pages/market-series-explorer/Page";
import { DEFAULTS, serverControls } from "@/studies/pages/market-series-explorer/controls";
import {
  BAR_COLUMNS, EMPTY_BODY, SERIES_COLUMNS, buildOverview, causalZscore, compareHistograms, distributionSummary, inSession,
  logReturnStandardDeviation, positionsInSpan, resolveSpan, rollStartPositions, spanInstants, thinPositions, trailingWindow,
  type ExplorerBody,
} from "@shared/studies/market-series-explorer";

let instance: DuckDBInstance;

async function run(sql: string) {
  const connection = await instance.connect();
  try {
    await connection.run("SET TimeZone='UTC'");
    return (await connection.runAndReadAll(sql)).getRowObjectsJS().map((row) => plainRow(row as Record<string, unknown>));
  } finally {
    connection.closeSync();
  }
}

const lake: StudyLake = {
  async query<T>(sql: string): Promise<T[]> {
    return (await run(sql)) as T[];
  },
  async hasView(name) {
    const rows = await run(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = '${name}'`);
    return Number(rows[0]?.n) > 0;
  },
  async columns() {
    return [];
  },
};

const emptyLake: StudyLake = { async query() { return []; }, async hasView() { return false; }, async columns() { return []; } };

const DAYS = 10;
const MINUTES = DAYS * 1440;
/** Day index (0-based) whose first bar is the roll: contract ZZH1 until day 5, ZZM1 from day 5 on. */
const ROLL_DAY_INDEX = 5;
const RATIO = 1.1;

beforeAll(async () => {
  instance = await DuckDBInstance.create(":memory:");
  await run(`CREATE TABLE bars (ts TIMESTAMPTZ, symbol VARCHAR, timeframe VARCHAR, asset_class VARCHAR, root VARCHAR, open DOUBLE, high DOUBLE,
    low DOUBLE, close DOUBLE, volume DOUBLE, bid_close DOUBLE, ask_close DOUBLE)`);
  // Ten days of minute bars. Contract ZZH1 trades days 0-5, ZZM1 days 4-9 at RATIO times the same price, so days 4 and 5 carry both
  // (the chain must keep only the contract with the day's larger volume: H on day 4, M from day 5).
  await run(`INSERT INTO bars
    WITH m AS (
      SELECT k, TIMESTAMPTZ '2021-03-01 00:00:00+00' + to_minutes(CAST(k AS BIGINT)) AS ts, 100 + 5 * sin(k / 2000.0) + 0.5 * sin(k / 7.0) AS price,
             CAST(k / 1440 AS INT) AS day
      FROM range(${MINUTES}) t(k)),
    p AS (SELECT *, coalesce(lag(price) OVER (ORDER BY k), price) AS previous_price FROM m),
    c AS (SELECT 'ZZH1' AS symbol, 1.0 AS scale, * FROM p WHERE day <= ${ROLL_DAY_INDEX}
          UNION ALL SELECT 'ZZM1', ${RATIO}, * FROM p WHERE day >= ${ROLL_DAY_INDEX - 1})
    SELECT ts, symbol, '1m', 'futures', 'ZZ', previous_price * scale, greatest(price, previous_price) * scale + 0.2, least(price, previous_price) * scale - 0.2,
           price * scale, 10.0 + (k % 5), NULL, NULL FROM c`);
  // Daily bars: who trades more decides the chain. Day 4: H 1000 vs M 100; day 5: H 400 vs M 900; later days M only.
  await run(`INSERT INTO bars
    SELECT days.ts, s.symbol, '1d', 'futures', 'ZZ', s.close, s.close + 1, s.close - 1, s.close, 1000.0, NULL, NULL
    FROM (SELECT d, TIMESTAMPTZ '2021-03-01 00:00:00+00' + to_days(CAST(d AS INTEGER)) AS ts FROM range(${DAYS}) t(d)) AS days
    JOIN (VALUES ('ZZH1', 100.0, 0, ${ROLL_DAY_INDEX}), ('ZZM1', ${100 * RATIO}, ${ROLL_DAY_INDEX - 1}, ${DAYS - 1})) AS s(symbol, close, first_day, last_day)
      ON days.d BETWEEN s.first_day AND s.last_day`);
  await run(`UPDATE bars SET volume = CASE WHEN symbol = 'ZZH1' AND ts >= TIMESTAMPTZ '2021-03-06 00:00:00+00' THEN 400
                                           WHEN symbol = 'ZZM1' AND ts = TIMESTAMPTZ '2021-03-05 00:00:00+00' THEN 100
                                           WHEN symbol = 'ZZM1' AND ts = TIMESTAMPTZ '2021-03-06 00:00:00+00' THEN 900
                                           WHEN symbol = 'ZZM1' THEN 1200 ELSE 1000 END
            WHERE timeframe = '1d' AND root = 'ZZ'`);
  // A forex pair, six days of minutes, two-sided quotes 1.2 pips wide.
  await run(`INSERT INTO bars
    SELECT TIMESTAMPTZ '2021-03-01 00:00:00+00' + to_minutes(CAST(k AS BIGINT)), 'EURUSD', '1m', 'forex', 'EURUSD',
           1.1 + 0.01 * sin((k - 1) / 300.0), 1.1 + 0.01 * sin(k / 300.0) + 0.0002, 1.1 + 0.01 * sin(k / 300.0) - 0.0002, 1.1 + 0.01 * sin(k / 300.0),
           5.0, 1.1 + 0.01 * sin(k / 300.0) - 0.00006, 1.1 + 0.01 * sin(k / 300.0) + 0.00006
    FROM range(${6 * 1440}) t(k)`);
});

afterAll(() => {
  instance.closeSync();
});

function parse(overrides: Record<string, unknown> = {}) {
  return querySchema.parse({ instrument: "futures:ZZ", ...overrides });
}

async function runHandler(overrides: Record<string, unknown> = {}, notes: string[] = []): Promise<ExplorerBody> {
  return handler.run(parse(overrides), { lake, notes });
}

describe("market-series-explorer handler on a synthetic roll", () => {
  it("offers only instruments that have minute bars", async () => {
    const body = await runHandler();
    expect(body.instruments.map((option) => option.key)).toEqual(["forex:EURUSD", "futures:ZZ"]);
    const zz = body.instruments.find((option) => option.key === "futures:ZZ");
    expect(zz?.symbolCount).toBe(2);
    expect(zz?.minuteBarCount).toBe(2 * 6 * 1440);
  });

  it("keeps one contract per bar, rolls once at the known ratio and stays continuous across it", async () => {
    const body = await runHandler({ spanStart: 0, spanEnd: 100_000, targetBars: 1000 });
    const summary = body.summary;
    expect(summary?.barCount).toBe(DAYS * 24);
    expect(summary?.contractCount).toBe(2);
    expect(summary?.rollCount).toBe(1);
    expect(summary?.cumulativeAdjustmentFactor).toBeCloseTo(RATIO, 9);
    expect(summary?.interleaveRatio).toBeCloseTo((2 * 6 * 1440) / MINUTES, 9);
    expect(summary?.warmupBarCount).toBe(100);

    const roll = body.rolls[0];
    expect(roll?.fromContract).toBe("ZZH1");
    expect(roll?.toContract).toBe("ZZM1");
    expect(roll?.priceRatio).toBeCloseTo(RATIO, 9);
    expect(roll?.logJump).toBeCloseTo(Math.log(RATIO), 9);

    // Adjusted, no hourly return comes near the 9.5 percent jump the unadjusted roll would print.
    const returns = body.rows.map((row) => row.log_return).filter((value): value is number => typeof value === "number");
    // The span runs over the days that have a known range z-score (the notebook's slider): days 4 to 9, 144 of the 240 bars.
    expect(body.rows.length).toBe(6 * 24);
    expect(Math.max(...returns.map(Math.abs))).toBeLessThan(0.02);
    expect(summary?.returnStandardDeviationUnadjusted as number).toBeGreaterThan((summary?.returnStandardDeviationAdjusted as number) * 1.2);
    // The contract chain follows volume: H through day 4, M from the roll day on; the roll day's bars are flagged.
    expect(body.rows[0]?.contract_symbol).toBe("ZZH1");
    expect(body.rows[body.rows.length - 1]?.contract_symbol).toBe("ZZM1");
    const flagged = body.rows.filter((row) => row.is_contract_roll_day);
    expect(flagged.length).toBe(24);
    expect(new Date(flagged[0]?.timestamp as number).toISOString()).toBe("2021-03-06T00:00:00.000Z");
    // Bars before the roll carry the ratio, bars from it on carry 1.
    expect(body.rows[0]?.adjustment_factor).toBeCloseTo(RATIO, 9);
    expect(body.rows[body.rows.length - 1]?.adjustment_factor).toBeCloseTo(1, 9);
  });

  it("leaves the warmup unknown and matches the SQL z-scores with the shared TypeScript ones", async () => {
    const body = await runHandler({ spanStart: 0, spanEnd: 100_000, targetBars: 1000 });
    // The drawn bars are series bars 96 to 239: the return z-score is unknown through bar 99, the range z-score through bar 98.
    expect(body.rows.slice(0, 4).every((row) => row.return_zscore === null)).toBe(true);
    expect(body.rows[4]?.return_zscore).not.toBeNull();
    expect(body.rows.slice(0, 3).every((row) => row.range_zscore === null)).toBe(true);
    expect(body.rows[3]?.range_zscore).not.toBeNull();
    const returns = body.rows.map((row) => (typeof row.log_return === "number" ? row.log_return : Number.NaN));
    const ranges = body.rows.map((row) => row.log_range as number);
    // Rows 99 and later have a full 100-row window among the drawn bars, so the shared function can be held to the SQL.
    for (const index of [99, 120, 143]) {
      expect(body.rows[index]?.return_zscore as number).toBeCloseTo(causalZscore(returns, index) as number, 9);
      expect(body.rows[index]?.range_zscore as number).toBeCloseTo(causalZscore(ranges, index) as number, 9);
    }
    const example = body.zscoreExamples.find((item) => item.column === "return_zscore");
    expect(example?.windowValues.length).toBe(100);
    expect(example?.zscore).toBeCloseTo(body.rows[143]?.return_zscore as number, 9);
    // The stepper's sums reproduce the window's mean and deviation.
    const values = example?.windowValues ?? [];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeCloseTo(example?.windowMean as number, 12);
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    expect(deviation).toBeCloseTo(example?.windowStandardDeviation as number, 12);
  });

  it("opens on the last 90 days, slices an explicit span and thins by stride", async () => {
    const opening = await runHandler();
    // Range z-scores are known from the 100th bar, so 6 of the 10 days have a daily mean.
    expect(opening.overview.dayTimestamps.length).toBe(6);
    expect(opening.span?.isDefault).toBe(true);
    expect(opening.span?.startIndex).toBe(0);
    expect(opening.span?.endIndex).toBe(5);

    const chosen = await runHandler({ spanStart: 2, spanEnd: 3, targetBars: 20 });
    expect(chosen.span?.isDefault).toBe(false);
    expect(chosen.span?.dayCount).toBe(2);
    expect(chosen.span?.barsInSpan).toBe(48);
    expect(chosen.span?.stride).toBe(2);
    expect(chosen.span?.barsDrawn).toBe(24);
    expect(chosen.rows.length).toBe(24);
    const first = chosen.rows[0]?.timestamp as number;
    expect(new Date(first).toISOString()).toBe(new Date((chosen.overview.dayTimestamps[2] as number)).toISOString());
    // Reversed and out-of-range indices are put in order and clamped.
    const reversed = await runHandler({ spanStart: 4, spanEnd: 1 });
    expect([reversed.span?.startIndex, reversed.span?.endIndex]).toEqual([1, 4]);
    const clamped = await runHandler({ spanStart: 0, spanEnd: 999 });
    expect(clamped.span?.endIndex).toBe(5);
  });

  it("compares the brushed span with the rest, value for value", async () => {
    const body = await runHandler({ spanStart: 2, spanEnd: 3, targetBars: 1000 });
    const row = body.statistics.find((item) => item.column === "log_return");
    expect(row).toBeDefined();
    expect((row?.brushed.count ?? 0) + (row?.rest.count ?? 0)).toBe(DAYS * 24 - 1);
    expect(row?.brushed.count).toBe(48);
    // Recompute the brushed group from the returned bars (stride 1 here) with the shared function.
    const brushed = body.rows.map((item) => item.log_return).filter((value): value is number => typeof value === "number");
    expect(distributionSummary(brushed).standardDeviation).toBeCloseTo(row?.brushed.standardDeviation as number, 12);
    expect(distributionSummary(brushed).skewness).toBeCloseTo(row?.brushed.skewness as number, 12);
    expect(distributionSummary(brushed).percentile25).toBe(row?.brushed.percentile25);
    const sample = await runHandler({ spanStart: 2, spanEnd: 3, convention: "sample" });
    expect(sample.convention).toBe("sample");
    expect(sample.statistics.find((item) => item.column === "log_return")?.brushed.skewness).not.toBeCloseTo(row?.brushed.skewness as number, 6);
    const histogram = body.histogram;
    expect(histogram?.column).toBe("log_return");
    expect(histogram?.edges.length).toBe(41);
    expect(histogram?.brushedShare.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
    expect(histogram?.restShare.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
    const other = await runHandler({ statisticsColumn: "range_zscore", bins: 10 });
    expect(other.histogram?.column).toBe("range_zscore");
    expect(other.histogram?.edges.length).toBe(11);
  });

  it("builds a forex series unadjusted with the hourly median spread in pips", async () => {
    const body = await runHandler({ instrument: "forex:EURUSD" }, []);
    expect(body.summary?.key).toBe("forex:EURUSD");
    expect(body.summary?.barCount).toBe(6 * 24);
    expect(body.summary?.rollCount).toBe(0);
    expect(body.summary?.contractCount).toBe(1);
    expect(body.summary?.cumulativeAdjustmentFactor).toBe(1);
    expect(body.rolls).toEqual([]);
    expect(body.columns).toContain("median_spread_pips");
    expect(body.rows[0]?.median_spread_pips as number).toBeCloseTo(1.2, 6);
    const futures = await runHandler();
    expect(futures.columns).not.toContain("median_spread_pips");
  });

  it("falls back to a listed instrument and says so", async () => {
    const notes: string[] = [];
    const body = await runHandler({ instrument: "futures:QQ" }, notes);
    expect(notes.join(" ")).toContain("futures:QQ has no 1m bars");
    expect(body.summary?.key).toBe("forex:EURUSD");
  });

  it("degrades to an empty body with a note when bars is not served", async () => {
    const notes: string[] = [];
    const body = await handler.run(parse(), { lake: emptyLake, notes });
    expect(body.rows).toEqual([]);
    expect(body.summary).toBeNull();
    expect(notes.join(" ")).toContain("bars");
  });

  it("refuses an instrument that is not futures or forex, in capitals, and an unknown column", () => {
    expect(() => parse({ instrument: "futures:mnq" })).toThrow();
    expect(() => parse({ instrument: "equity:AAPL" })).toThrow();
    expect(() => parse({ instrument: "futures:MNQ'; DROP" })).toThrow();
    expect(() => parse({ statisticsColumn: "close" })).toThrow();
    expect(() => parse({ targetBars: 5 })).toThrow();
    expect(() => parse({ bins: 500 })).toThrow();
    expect(parse().instrument).toBe("futures:ZZ");
    expect(querySchema.parse({}).instrument).toBe("futures:MNQ");
  });

  it("writes SQL that quotes the root and binds both asset class and timeframe", () => {
    const sql = seriesSql("futures", "MNQ");
    expect(sql).toContain("root = 'MNQ'");
    expect(sql).toContain("asset_class = 'futures'");
    expect(sql).toContain("timeframe = '1m'");
    expect(sql).toContain("arg_min(o, ts)");
    expect(sql).not.toMatch(/first\(|last\(/i);
    expect(seriesSql("forex", "USDJPY")).toContain("/ 0.01)");
    expect(seriesSql("forex", "EURUSD")).toContain("/ 0.0001)");
    expect(universeSql()).toContain("timeframe = '1m'");
    expect(interleaveSql("futures", "MNQ")).toContain("count(DISTINCT ts)");
  });
});

describe("market-series-explorer pure computations", () => {
  it("summarises like polars: n-1 deviation, population moments, nearest-rank quartiles", () => {
    const eleven = distributionSummary(Array.from({ length: 11 }, (_unused, i) => i + 1));
    expect(eleven.count).toBe(11);
    expect(eleven.median).toBe(6);
    expect(eleven.percentile25).toBe(4); // (11 - 1) * 0.25 = 2.5 rounds away from zero to index 3
    expect(eleven.percentile75).toBe(9);
    expect(eleven.standardDeviation).toBeCloseTo(Math.sqrt(11), 12);
    expect(eleven.skewness).toBeCloseTo(0, 12);
    expect(eleven.kurtosis).toBeCloseTo(-1.22, 12);
    expect(distributionSummary([1, 2, 3, 4, 5, 6, 7]).kurtosis).toBeCloseTo(-1.25, 12);
    expect(distributionSummary([1, 2, 3, 4]).median).toBe(2.5);
    expect(distributionSummary([1, 2, 3, 4]).kurtosis).toBeCloseTo(-1.36, 12);
    expect(distributionSummary([1, 2]).kurtosis).toBeCloseTo(-2, 12);
    const skewed = distributionSummary(Array.from({ length: 11 }, (_unused, i) => (i + 1) ** 2));
    expect(skewed.skewness).toBeCloseTo(0.5763262253537196, 12);
  });

  it("reports unknown, never zero, for too little data or no spread", () => {
    const empty = distributionSummary([]);
    expect(empty.count).toBe(0);
    expect(empty.mean).toBeNull();
    const constant = distributionSummary([3, 3, 3]);
    expect(constant.skewness).toBeNull();
    expect(constant.kurtosis).toBeNull();
    expect(constant.standardDeviation).toBe(0);
    expect(distributionSummary([5]).standardDeviation).toBeNull();
    expect(distributionSummary([1, Number.NaN, 3, Number.POSITIVE_INFINITY]).count).toBe(2);
  });

  it("offers the dashboard's sample-adjusted conventions as an alternative", () => {
    const values = Array.from({ length: 11 }, (_unused, i) => (i + 1) ** 2);
    const notebook = distributionSummary(values, "notebook");
    const sample = distributionSummary(values, "sample");
    expect(sample.skewness).toBeCloseTo((notebook.skewness as number) * (Math.sqrt(11 * 10) / 9), 10);
    expect(sample.percentile25).not.toBe(notebook.percentile25);
  });

  it("resolves the span like the notebook's slider", () => {
    expect(resolveSpan(1551, -1, -1)).toEqual({ startIndex: 1461, endIndex: 1550, isDefault: true });
    expect(resolveSpan(50, -1, -1)).toEqual({ startIndex: 0, endIndex: 49, isDefault: true });
    expect(resolveSpan(100, 40, 10)).toEqual({ startIndex: 10, endIndex: 40, isDefault: false });
    expect(resolveSpan(100, 0, 500)).toEqual({ startIndex: 0, endIndex: 99, isDefault: false });
    expect(resolveSpan(0, -1, -1)).toEqual({ startIndex: 0, endIndex: 0, isDefault: true });
  });

  it("pushes the span's end to the last second of its day, so the last day's bars are kept", () => {
    const day = Date.UTC(2021, 2, 3);
    const instants = spanInstants([day, day + 86_400_000], 0, 1);
    expect(instants.start).toBe(day);
    expect(instants.end).toBe(day + 86_400_000 + 86_399_000);
    const hourly = Array.from({ length: 72 }, (_unused, i) => day + i * 3_600_000);
    expect(positionsInSpan(hourly, instants.start, instants.end).length).toBe(48);
  });

  it("thins by taking every nth bar, never re-aggregating", () => {
    const positions = Array.from({ length: 1681 }, (_unused, i) => i + 100);
    const thinned = thinPositions(positions, 200);
    expect(thinned.stride).toBe(8);
    expect(thinned.positions.length).toBe(211);
    expect(thinned.positions.slice(0, 3)).toEqual([100, 108, 116]);
    expect(thinPositions(positions.slice(0, 150), 200)).toEqual({ positions: positions.slice(0, 150), stride: 1 });
  });

  it("builds the daily strip from days that have a known range z-score, closing on each day's last bar", () => {
    const day = 86_400_000;
    const timestamps = [0, 3_600_000, day, day + 3_600_000, 3 * day];
    const z = [Number.NaN, Number.NaN, 1, 3, Number.NaN];
    const close = [10, 11, 12, 13, 14];
    const overview = buildOverview(timestamps, z, close);
    expect(overview.dayTimestamps).toEqual([day]);
    expect(overview.rangeZscoreMean).toEqual([2]);
    expect(overview.lastClose).toEqual([13]);
  });

  it("finds the first bar of each roll day", () => {
    expect(rollStartPositions([false, true, true, false, true, false, false, true])).toEqual([1, 4, 7]);
    expect(rollStartPositions([true, true, false])).toEqual([0]);
  });

  it("computes the causal z-score from the trailing window only", () => {
    const values = Array.from({ length: 120 }, (_unused, i) => Math.sin(i / 3) + i * 0.01);
    expect(causalZscore(values, 98)).toBeNull();
    expect(causalZscore(values, 99)).not.toBeNull();
    const before = causalZscore(values, 110);
    const changedFuture = values.slice();
    changedFuture[115] = 1000;
    expect(causalZscore(changedFuture, 110)).toBe(before);
    const window = trailingWindow(values, 110, 100);
    expect(window?.standardDeviation).toBeGreaterThan(0);
    const spike = values.slice();
    spike[110] = 1e6;
    expect(causalZscore(spike, 110)).toBe(5);
    expect(causalZscore(new Array(120).fill(1), 110)).toBeNull();
    expect(causalZscore([1, Number.NaN, 2], 2, 3)).toBeNull();
  });

  it("compares two groups on shared edges as shares", () => {
    const comparison = compareHistograms("x", [1, 2, 3], [1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 5);
    expect(comparison?.edges.length).toBe(6);
    expect(comparison?.brushedShare.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
    expect(comparison?.restShare.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
    expect(compareHistograms("x", [], [], 5)).toBeNull();
    const flat = compareHistograms("x", [2, 2], [2], 4);
    expect(flat?.edges[0]).toBeLessThan(2);
  });

  it("measures how much an unadjusted roll moves the return deviation", () => {
    const adjusted = [100, 101, 100, 101, 100, 101];
    const unadjusted = [100, 101, 100, 110, 109, 110];
    expect(logReturnStandardDeviation(unadjusted) as number).toBeGreaterThan(logReturnStandardDeviation(adjusted) as number);
    expect(logReturnStandardDeviation([1, 2])).toBeNull();
  });

  it("tests session membership on the stored clock's hours", () => {
    const at = (hour: number) => Date.UTC(2021, 2, 3, hour);
    expect(inSession(at(13), 13, 20)).toBe(true);
    expect(inSession(at(19), 13, 20)).toBe(true);
    expect(inSession(at(20), 13, 20)).toBe(false);
    expect(inSession(at(12), 13, 20)).toBe(false);
  });

  it("catalogues every column with a definition and a drawing kind", () => {
    expect(SERIES_COLUMNS.every((column) => column.definition.length > 20 && column.unit.length > 0)).toBe(true);
    expect(BAR_COLUMNS).toEqual(["body_normalized", "wick_difference_normalized", "log_return", "direction"]);
    expect(new Set(SERIES_COLUMNS.map((column) => column.name)).size).toBe(SERIES_COLUMNS.length);
  });

  it("builds an empty body when the series has no known range z-score", () => {
    const body = buildBody(
      { key: "futures:ZZ", length: 0, timestamps: new Float64Array(0), contracts: [], rollFlags: [], numeric: new Map(), summary: {
        key: "futures:ZZ", barCount: 0, firstTimestamp: 0, lastTimestamp: 0, contractCount: 0, rollCount: 0, cumulativeAdjustmentFactor: 1, interleaveRatio: null,
        returnStandardDeviationAdjusted: null, returnStandardDeviationUnadjusted: null, warmupBarCount: 0, loadSeconds: 0, fromMemory: false,
      } },
      parse(), [],
    );
    expect(body.rows).toEqual([]);
    expect(body.span).toBeNull();
  });
});

describe("market-series-explorer page", () => {
  function render(body: ExplorerBody, notes: string[] = []): string {
    const client = new QueryClient();
    client.setQueryData(["study", "market-series-explorer", serverControls(DEFAULTS)], { slug: "market-series-explorer", notes, data: body });
    return renderToString(createElement(QueryClientProvider, { client }, createElement(Page)));
  }

  it("renders every section from the handler's body", async () => {
    const body = await handler.run(querySchema.parse({ instrument: "futures:ZZ", spanStart: -1 }), { lake, notes: [] });
    // The page asks with its own default instrument; give it the synthetic body under that key.
    const html = render(body);
    for (const heading of ["History and span", "Candles with aligned panes", "The brushed span against the rest of history", "How the series is built", "Every column, for the bars drawn",
      "Ratio roll adjustment", "Causal z-score", "Rolls inside the span"]) {
      expect(html).toContain(heading);
    }
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Rolls adjusted");
    expect(text).toContain("One contract per bar");
    expect(text).toContain("log_return");
    expect(text).toContain("brushed span");
    expect(html).toContain("<svg");
  });

  it("renders the empty state from the empty body", () => {
    const html = render(EMPTY_BODY, ["Not in the lake yet: bars."]);
    expect(html.replace(/<[^>]+>/g, " ")).toContain("holds no");
    expect(html).toContain("Not in the lake yet");
  });
});

// Opt-in: MARKET_SERIES_EXPLORER_LIVE=1 runs the handler over the real lake and holds it to lake_explorer.py's own numbers
// (its cells run with polars on the datalake macros resample('MNQ','1m','1h'), 2026-09-30).
describe.runIf(process.env.MARKET_SERIES_EXPLORER_LIVE === "1")("market-series-explorer against the lake (notebook parity)", () => {
  it("reproduces the notebook's MNQ series and its brushed-versus-rest log return table", async () => {
    const { lake: realLake } = await import("../../studies/lake");
    const body = await handler.run(querySchema.parse({}), { lake: realLake, notes: [] });
    expect(body.summary?.barCount).toBe(29519);
    expect(body.summary?.rollCount).toBe(20);
    expect(body.summary?.cumulativeAdjustmentFactor).toBeCloseTo(1.171064679969602, 9);
    expect(body.summary?.interleaveRatio).toBeCloseTo(1.559224176764528, 9);
    expect(body.overview.dayTimestamps.length).toBe(1551);
    expect([body.span?.startIndex, body.span?.endIndex]).toEqual([1461, 1550]);
    expect([body.span?.barsInSpan, body.span?.stride, body.span?.barsDrawn]).toEqual([1681, 8, 211]);
    const statistics = body.statistics.find((row) => row.column === "log_return");
    expect(statistics?.brushed.count).toBe(1681);
    expect(statistics?.brushed.standardDeviation).toBeCloseTo(0.0022889841592786554, 12);
    expect(statistics?.brushed.kurtosis).toBeCloseTo(16.29740509843861, 8);
    expect(statistics?.rest.count).toBe(27837);
    expect(statistics?.rest.standardDeviation).toBeCloseTo(0.0029379370302684052, 12);
    expect(statistics?.rest.skewness).toBeCloseTo(0.15350694088705896, 9);
  }, 240_000);
});
