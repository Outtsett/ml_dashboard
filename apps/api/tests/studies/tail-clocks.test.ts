/**
 * tail-clocks study: the handler on a fake lake (canned rows per view), and the
 * pure arithmetic it shares with the page (bell-curve tail, histogram density,
 * activity window). Expected numbers for the tail are scipy's 2 * norm.sf(k).
 */

import { describe, expect, it } from "vitest";
import handler from "../../studies/handlers/tail-clocks";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  ACTIVITY_WINDOW_HOURS, EMPTY_BODY, HISTOGRAM_BIN_COUNT, activityWindowStart, breakAtGaps, consequenceNumbers, erfc, histogramBinCentre,
  histogramBinIndex, histogramDensity, normalDensity, observedOverPredicted, predictedBeyond, ruleSaysOneEvery, seenOneBarEvery,
  shapeFromMoments, twoSidedTail, type ClockSeries, type TailClocksBody,
} from "@shared/studies/tail-clocks";

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}

describe("bell-curve arithmetic", () => {
  it("matches scipy 2 * norm.sf(k)", () => {
    const expected: Array<[number, number]> = [
      [1, 0.31731050786291415],
      [2, 0.04550026389635842],
      [3, 0.0026997960632601866],
      [4, 6.334248366623996e-5],
      [5, 5.733031437583878e-7],
      [6, 1.973175290075e-9],
    ];
    for (const [sigma, value] of expected) expect(relativeError(twoSidedTail(sigma), value)).toBeLessThan(1e-9);
  });

  it("erfc is continuous across its two branches and symmetric", () => {
    // series branch (below 2.5) and continued-fraction branch (2.5 and above), against the C library
    expect(relativeError(erfc(2.4), 6.88513896645079e-4)).toBeLessThan(1e-9);
    expect(relativeError(erfc(2.5), 4.06952017444959e-4)).toBeLessThan(1e-12);
    expect(relativeError(erfc(7), 4.183825607779414e-23)).toBeLessThan(1e-12);
    expect(erfc(0)).toBe(1);
    expect(erfc(-1) + erfc(1)).toBeCloseTo(2, 12);
    expect(relativeError(erfc(0.5), 0.4795001221869535)).toBeLessThan(1e-12);
  });

  it("states the rule as odds and the predicted count as the notebook did (MNQ 4h, 6,399 bars, 4 sigma)", () => {
    expect(ruleSaysOneEvery(4)).toBe(15787);
    expect(ruleSaysOneEvery(3)).toBe(370);
    expect(predictedBeyond(6399, 4)).toBeCloseTo(0.4053, 4);
    expect(observedOverPredicted(45, predictedBeyond(6399, 4))).toBeCloseTo(111.02, 2);
    expect(observedOverPredicted(1, 0)).toBeNull();
    expect(seenOneBarEvery(6399, 45)).toBe(142);
    expect(seenOneBarEvery(6399, 0)).toBeNull();
  });

  it("standard normal density peaks at 1/sqrt(2 pi)", () => {
    expect(normalDensity(0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 12);
  });

  it("population skewness and excess kurtosis come from central moments (a normal has 0 excess)", () => {
    const normal = shapeFromMoments(1, 0, 3, 1000);
    expect(normal).toEqual({ skewness: 0, kurtosis: 0 });
    expect(shapeFromMoments(0, 0, 0, 10)).toEqual({ skewness: null, kurtosis: null });
    expect(shapeFromMoments(1, 0.2, 5, 3).kurtosis).toBeNull();
  });
});

describe("histogram", () => {
  it("bins -10..10 into 160 bins with the last bin closed, as numpy does", () => {
    expect(histogramBinIndex(-10)).toBe(0);
    expect(histogramBinIndex(10)).toBe(HISTOGRAM_BIN_COUNT - 1);
    expect(histogramBinIndex(0)).toBe(80);
    expect(histogramBinIndex(10.01)).toBeNull();
    expect(histogramBinIndex(Number.NaN)).toBeNull();
    expect(histogramBinCentre(0)).toBeCloseTo(-9.9375, 10);
  });

  it("density integrates to 1 over the in-range bars and leaves empty bins null", () => {
    const counts = new Array<number>(HISTOGRAM_BIN_COUNT).fill(0);
    counts[80] = 30;
    counts[81] = 10;
    const density = histogramDensity(counts);
    const area = density.reduce<number>((sum, value) => sum + (value ?? 0) * 0.125, 0);
    expect(area).toBeCloseTo(1, 12);
    expect(density[0]).toBeNull();
    expect(histogramDensity(counts.map(() => 0)).every((value) => value === null)).toBe(true);
  });
});

describe("activity window", () => {
  it("starts at len // 2 at 50 percent and clamps so a full fortnight fits", () => {
    expect(activityWindowStart(23_615, 50)).toBe(11_807);
    expect(activityWindowStart(23_615, 0)).toBe(0);
    expect(activityWindowStart(23_615, 100)).toBe(23_615 - ACTIVITY_WINDOW_HOURS);
    expect(activityWindowStart(100, 50)).toBe(0);
  });

  it("breaks the line at the bar that follows a gap of more than two hours", () => {
    const hour = 3_600_000;
    const timestamps = [0, hour, 2 * hour, 50 * hour, 51 * hour];
    expect(breakAtGaps(timestamps, [5, 6, 7, 8, 9])).toEqual([5, 6, 7, null, 9]);
  });
});

function series(clock: ClockSeries["clock"], observed: number, predicted: number, returnCount: number): ClockSeries {
  return {
    clock, producedBarCount: returnCount + 1, calibrationTargetBarCount: returnCount + 1, developmentBarCount: returnCount + 1, returnCount,
    thresholdPerBar: null, thresholdUnit: "seconds", firstTimestamp: 0, lastTimestamp: 1, logReturnMean: 0, logReturnStandardDeviation: 0.005,
    standardised: { count: returnCount, mean: 0, median: 0, standardDeviation: 1, skewness: 0, kurtosis: 0, percentile25: -0.5, percentile75: 0.5, minimum: -5, maximum: 5 },
    percent: { count: returnCount, mean: 0, median: 0, standardDeviation: 0.5, skewness: 0, kurtosis: 0, percentile25: -0.3, percentile75: 0.3, minimum: -2, maximum: 2 },
    gates: [], beyond: { sigma: 4, observed, predicted, ratio: predicted > 0 ? observed / predicted : null }, biggestMoveSigma: 9.3,
    histogramCounts: new Array<number>(HISTOGRAM_BIN_COUNT).fill(0), outsideHistogramCount: 0,
  };
}

describe("page prose numbers", () => {
  it("quotes the observed and predicted counts of the calendar clock", () => {
    const numbers = consequenceNumbers(series("time", 45, 0.41, 6399));
    expect(numbers).toMatchObject({ sigma: 4, bars: 6399, observed: 45, predicted: 0.41 });
    expect(numbers?.shareOfBars).toBeCloseTo(0.00703, 4);
    expect(consequenceNumbers(undefined)).toBeNull();
    expect(consequenceNumbers(series("time", 0, 0, 0))).toBeNull();
  });
});

// ── the handler, on a fake lake ────────────────────────────────────────────

const SUMMARY = "derived_study_tail_clocks_series_summary";
const RETURNS = "derived_study_tail_clocks_bar_returns";
const HOURLY = "derived_study_tail_clocks_hourly_volume";

interface Recorded {
  sql: string[];
}

function moment(clock: string, count: number, second: number, fourth: number) {
  return {
    clock, observation_count: count, mean_value: 0, median_value: 0, standard_deviation: 1, percentile_25: -0.6, percentile_75: 0.6,
    minimum_value: -8, maximum_value: 9, second_moment: second, third_moment: -0.3, fourth_moment: fourth,
  };
}

function fakeLake(views: string[], recorded: Recorded): StudyLake {
  return {
    async hasView(name) {
      return views.includes(name);
    },
    async columns() {
      return [];
    },
    async query<T>(sql: string): Promise<T[]> {
      recorded.sql.push(sql);
      if (sql.includes("GROUP BY root ORDER BY one_minute_bar_count")) {
        return [{ root: "MNQ", one_minute_bar_count: 2_758_687 }, { root: "ES", one_minute_bar_count: 2_427_802 }] as T[];
      }
      if (sql.includes("calibration_target_bar_count")) {
        return ["time", "volume", "dollar"].map((clock, index) => ({
          clock, calibration_target_bar_count: 8001, bar_count: 8001 + index, development_bar_count: 6400, return_count: 6399,
          threshold_per_bar: clock === "time" ? Number.NaN : 198_417.86, threshold_unit: clock === "time" ? "seconds" : "contracts",
          log_return_mean: 1e-5, log_return_standard_deviation: 0.0054, first_milliseconds: 1_609_474_800_000, last_milliseconds: 1_760_000_000_000,
        })) as T[];
      }
      if (sql.includes('SELECT clock, "standardised_return" AS value')) {
        return [moment("time", 6399, 1, 10.95), moment("volume", 6399, 1, 4.82), moment("dollar", 6400, 1, 7.56)] as T[];
      }
      if (sql.includes('SELECT clock, "percent_return" AS value')) {
        return [moment("time", 6399, 0.3, 0.6), moment("volume", 6399, 0.3, 0.4), moment("dollar", 6400, 0.3, 0.5)] as T[];
      }
      if (sql.includes("AS gate_0")) {
        return [
          { clock: "time", return_count: 6399, biggest_move: 9.3, gate_0: 1800, gate_1: 250, gate_2: 90, gate_3: 45, gate_4: 45 },
          { clock: "volume", return_count: 6399, biggest_move: 6.5, gate_0: 1900, gate_1: 290, gate_2: 50, gate_3: 13, gate_4: 13 },
          { clock: "dollar", return_count: 6400, biggest_move: 9.1, gate_0: 1850, gate_1: 280, gate_2: 60, gate_3: 21, gate_4: 21 },
        ] as T[];
      }
      if (sql.includes("log10(contracts_traded)")) return [{ bin: 4, hour_count: 1 }, { bin: 12, hour_count: 1 }] as T[];
      if (sql.includes("AS bin")) return [{ clock: "time", bin: 80, bar_count: 100 }, { clock: "time", bin: 159, bar_count: 2 }] as T[];
      if (sql.includes("size_rank")) {
        return [{ clock: "time", bar_milliseconds: 1_700_000_000_000, standardised_return: -9.3, percent_return: -4.4, bar_hour: 8, bar_year: 2023 }] as T[];
      }
      if (sql.includes("hour(bar_timestamp) AS bar_hour, count")) return [{ clock: "time", bar_hour: 8, bar_count: 45 }] as T[];
      if (sql.includes("year(bar_timestamp) AS bar_year, count")) return [{ clock: "time", bar_year: 2023, bar_count: 45 }] as T[];
      if (sql.includes("hour_milliseconds")) {
        return [{ hour_milliseconds: 0, contracts_traded: 10 }, { hour_milliseconds: 3_600_000, contracts_traded: 1000 }] as T[];
      }
      if (sql.includes("hour(hour_timestamp) AS hour_of_day")) return [{ hour_of_day: 8, median_contracts: 500 }] as T[];
      if (sql.includes("'hourly' AS clock")) return [moment("hourly", 2, 1, 3)] as T[];
      return [];
    },
  };
}

function context(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

describe("tail-clocks handler", () => {
  it("declares the three landed views and parses its query with defaults", () => {
    expect(handler.slug).toBe("tail-clocks");
    expect(handler.datasets).toEqual([SUMMARY, RETURNS, HOURLY]);
    expect(handler.query.parse({})).toEqual({ root: "MNQ", size: "4h", sigma: 4 });
    expect(handler.query.parse({ root: "ES", size: "15m", sigma: "2.5" })).toEqual({ root: "ES", size: "15m", sigma: 2.5 });
  });

  it("refuses a root, size or sigma that could reach the SQL as something else", () => {
    expect(() => handler.query.parse({ root: "MNQ'; DROP TABLE x; --" })).toThrow();
    expect(() => handler.query.parse({ size: "5m" })).toThrow();
    expect(() => handler.query.parse({ sigma: "0" })).toThrow();
    expect(() => handler.query.parse({ sigma: "9" })).toThrow();
  });

  it("returns the notebook's stat row, the gate counts and the extreme bars", async () => {
    const recorded: Recorded = { sql: [] };
    const ctx = context(fakeLake([SUMMARY, RETURNS, HOURLY], recorded));
    const body = (await handler.run(handler.query.parse({}), ctx)) as TailClocksBody;

    expect(body.roots.map((entry) => entry.root)).toEqual(["MNQ", "ES"]);
    expect(body.series.map((entry) => entry.clock)).toEqual(["time", "volume", "dollar"]);
    const time = body.series[0] as ClockSeries;
    expect(time.returnCount).toBe(6399);
    expect(time.beyond.observed).toBe(45);
    expect(time.beyond.predicted).toBeCloseTo(0.4053, 4);
    expect(time.beyond.ratio).toBeCloseTo(111.02, 1);
    expect(time.gates.map((gate) => gate.sigma)).toEqual([1, 2, 3, 4]);
    expect(time.gates.map((gate) => gate.observed)).toEqual([1800, 250, 90, 45]);
    // excess kurtosis = fourth / second^2 - 3; skewness = third / second^1.5
    expect(time.standardised.kurtosis).toBeCloseTo(10.95 - 3, 10);
    expect(time.standardised.skewness).toBeCloseTo(-0.3, 10);
    // the calendar's threshold is its bar length, not the lake's NaN
    expect(time.thresholdPerBar).toBe(14_400);
    expect(time.thresholdUnit).toBe("seconds");
    expect((body.series[1] as ClockSeries).thresholdPerBar).toBeCloseTo(198_417.86, 2);
    // the histogram keeps only the bins the query returned
    expect(time.histogramCounts[80]).toBe(100);
    expect(time.histogramCounts[159]).toBe(2);
    expect(time.outsideHistogramCount).toBe(6399 - 102);
    expect(body.extremes).toEqual([{ clock: "time", timestamp: 1_700_000_000_000, standardisedReturn: -9.3, percentReturn: -4.4, hour: 8, year: 2023 }]);
    expect(body.countByHour).toEqual([{ clock: "time", hour: 8, count: 45 }]);
    expect(body.countByYear).toEqual([{ clock: "time", year: 2023, count: 45 }]);
    expect(body.activity.hourCount).toBe(2);
    expect(body.activity.hours.contracts).toEqual([10, 1000]);
    expect(body.activity.logHistogram).toEqual([{ lowerLog10: 1, upperLog10: 1.25, count: 1 }, { lowerLog10: 3, upperLog10: 3.25, count: 1 }]);
    expect(ctx.notes.some((note) => note.includes("sealed"))).toBe(true);
  });

  it("puts the selected gate into the ladder when it is not one of 1 to 4", async () => {
    const recorded: Recorded = { sql: [] };
    const ctx = context(fakeLake([SUMMARY, RETURNS, HOURLY], recorded));
    await handler.run(handler.query.parse({ sigma: "2.5" }), ctx);
    const gateSql = recorded.sql.find((sql) => sql.includes("AS gate_0")) ?? "";
    expect(gateSql).toContain("abs(standardised_return) > 2.5");
    expect(gateSql).toContain("AS gate_4");
  });

  it("quotes the root and the bar size as literals", async () => {
    const recorded: Recorded = { sql: [] };
    await handler.run(handler.query.parse({ root: "ES", size: "1h" }), context(fakeLake([SUMMARY, RETURNS, HOURLY], recorded)));
    const filtered = recorded.sql.filter((sql) => sql.includes(RETURNS));
    expect(filtered.length).toBeGreaterThan(3);
    for (const sql of filtered) expect(sql).toContain("root = 'ES' AND bar_size = '1h'");
  });

  it("degrades to the empty body with a note when the data is not landed", async () => {
    const recorded: Recorded = { sql: [] };
    const ctx = context(fakeLake([], recorded));
    const body = await handler.run(handler.query.parse({}), ctx);
    expect(body).toEqual(EMPTY_BODY);
    expect(ctx.notes[0]).toContain("Not in the lake yet");
    expect(recorded.sql).toHaveLength(0);
  });

  it("names the landed roots when the requested one is not among them", async () => {
    const recorded: Recorded = { sql: [] };
    const ctx = context(fakeLake([SUMMARY, RETURNS, HOURLY], recorded));
    const body = (await handler.run(handler.query.parse({ root: "CL" }), ctx)) as TailClocksBody;
    expect(body.series).toEqual([]);
    expect(body.roots.map((entry) => entry.root)).toEqual(["MNQ", "ES"]);
    expect(ctx.notes[0]).toContain("CL");
    expect(ctx.notes[0]).toContain("MNQ, ES");
  });
});
