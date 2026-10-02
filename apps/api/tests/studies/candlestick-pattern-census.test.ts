/**
 * The candlestick-pattern-census study: its handler on a fake lake (views
 * present, views missing, the SQL it writes) and the pure compute the page
 * shares (selection, counts, the summation, side split, symmetric-log
 * histograms, the notebook's moment estimators).
 */

import { describe, expect, it } from "vitest";
import handler, { CENSUS_VIEW, PROVENANCE_VIEW, REGISTRIES_VIEW, SCORECARD_VIEW } from "../../studies/handlers/candlestick-pattern-census";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  acrossTimeframes, barReadings, categoricalValue, effectiveThreshold, histogramBins, lengthBreakdown, neverFires, populationMoments, presenceOf,
  selectView, sidesObserved, singleSided, summationTerms, symlog, symlogInverse, valueCounts, viewCounts, type CensusRow,
} from "@shared/studies/candlestick-pattern-census";

function row(over: Partial<CensusRow> & Pick<CensusRow, "pattern_name" | "timeframe">): CensusRow {
  return {
    talib_function: `CDL${over.pattern_name.toUpperCase()}`,
    talib_pattern_number: 1,
    candle_count: 1,
    pattern_type: "reversal",
    talib_checks_prior_trend: false,
    shape_condition_count: 3,
    emitted_values: "+100 or -100",
    bar_count_scanned: 1000,
    firing_count_total: 0,
    firing_count_bullish: 0,
    firing_count_bearish: 0,
    firing_count_holdout_2025: 0,
    firing_rate_percent: 0,
    fires_in_this_timeframe: false,
    fires_anywhere_in_the_data: false,
    meets_minimum_firing_count_on_holdout: false,
    also_defined_as_hand_written_arithmetic_rule: false,
    recognition_area_under_curve: null,
    recognition_average_precision: null,
    recognition_positive_window_count: null,
    recognition_visible_window_count: null,
    recognition_prevalence: null,
    ...over,
  };
}

// alpha: 1 candle, both sides, fires on both timeframes. beta: 2 candles, bullish only, 1m only. gamma: 3 candles, never.
const CENSUS: CensusRow[] = [
  row({ pattern_name: "alpha", timeframe: "1m", talib_pattern_number: 1, candle_count: 1, firing_count_total: 500, firing_count_bullish: 300, firing_count_bearish: 200, firing_count_holdout_2025: 100, fires_in_this_timeframe: true, fires_anywhere_in_the_data: true }),
  row({ pattern_name: "alpha", timeframe: "5m", talib_pattern_number: 1, candle_count: 1, bar_count_scanned: 200, firing_count_total: 40, firing_count_bullish: 25, firing_count_bearish: 15, firing_count_holdout_2025: 10, fires_in_this_timeframe: true, fires_anywhere_in_the_data: true }),
  row({ pattern_name: "beta", timeframe: "1m", talib_pattern_number: 2, candle_count: 2, firing_count_total: 60, firing_count_bullish: 60, firing_count_holdout_2025: 60, fires_in_this_timeframe: true, fires_anywhere_in_the_data: true }),
  row({ pattern_name: "beta", timeframe: "5m", talib_pattern_number: 2, candle_count: 2, bar_count_scanned: 200, fires_anywhere_in_the_data: true }),
  row({ pattern_name: "gamma", timeframe: "1m", talib_pattern_number: 3, candle_count: 3 }),
  row({ pattern_name: "gamma", timeframe: "5m", talib_pattern_number: 3, candle_count: 3, bar_count_scanned: 200 }),
];

function fakeLake(present: readonly string[], log: string[] = []): StudyLake {
  return {
    async query<T>(sql: string): Promise<T[]> {
      log.push(sql);
      if (sql.includes(`FROM "${CENSUS_VIEW}"`)) return CENSUS as unknown as T[];
      if (sql.includes(`FROM "${REGISTRIES_VIEW}"`)) {
        return [{ registry_name: "TA-Lib", definition_count: 61, definition_kind: "library", where_it_lives: "x", how_counted: "y", definition_count_typed_in_notebook: 61, count_matches_notebook: true }] as unknown as T[];
      }
      if (sql.includes(`FROM "${PROVENANCE_VIEW}"`)) {
        return [{ source_name: "datalake interpreter (built the census)", talib_version: "0.7.1", library_function_count: 161, candlestick_function_count: 61, detail: "d" }] as unknown as T[];
      }
      if (sql.includes(SCORECARD_VIEW)) return [{ test_count: 883, pattern_side_count: 72, survivor_count: 0 }] as unknown as T[];
      return [];
    },
    async hasView(name) {
      return present.includes(name);
    },
    async columns() {
      return [];
    },
  };
}

function context(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

describe("candlestick-pattern-census handler", () => {
  it("returns the census, registries, provenance and the scorecard cross-tabulation", async () => {
    const log: string[] = [];
    const ctx = context(fakeLake([CENSUS_VIEW, REGISTRIES_VIEW, PROVENANCE_VIEW, SCORECARD_VIEW], log));
    const body = await handler.run({}, ctx);
    expect(body.rows).toHaveLength(6);
    expect(body.registries[0]?.definition_count).toBe(61);
    expect(body.provenance[0]?.talib_version).toBe("0.7.1");
    expect(body.scorecard).toEqual({ testCount: 883, patternSideCount: 72, survivorCount: 0 });
    expect(ctx.notes).toEqual([]);
    // The hive timeframe column is cast to text in the query.
    expect(log[0]).toContain("CAST(timeframe AS VARCHAR)");
  });

  it("returns an empty body and a note when the census is not landed", async () => {
    const ctx = context(fakeLake([]));
    const body = await handler.run({}, ctx);
    expect(body).toEqual({ rows: [], registries: [], provenance: [], scorecard: null });
    expect(ctx.notes[0]).toContain(CENSUS_VIEW);
  });

  it("keeps the census when the optional views are missing, and says which", async () => {
    const ctx = context(fakeLake([CENSUS_VIEW]));
    const body = await handler.run({}, ctx);
    expect(body.rows).toHaveLength(6);
    expect(body.registries).toEqual([]);
    expect(body.provenance).toEqual([]);
    expect(body.scorecard).toBeNull();
    expect(ctx.notes.join(" ")).toContain(REGISTRIES_VIEW);
    expect(ctx.notes.join(" ")).toContain(SCORECARD_VIEW);
  });

  it("declares every view it reads", () => {
    expect(handler.slug).toBe("candlestick-pattern-census");
    expect(handler.datasets).toEqual([CENSUS_VIEW, REGISTRIES_VIEW, PROVENANCE_VIEW, SCORECARD_VIEW]);
  });
});

describe("census selection and counts", () => {
  it("sums each pattern over the timeframes and lists the ones that never fire", () => {
    const totals = acrossTimeframes(CENSUS);
    expect(totals.map((entry) => [entry.pattern_name, entry.firingCountAllTimeframes])).toEqual([["alpha", 540], ["beta", 60], ["gamma", 0]]);
    expect(neverFires(totals)).toEqual(["gamma"]);
    expect(totals[0]?.timeframesItFiresOn).toBe(2);
  });

  it("reads bar readings from one pattern's scanned bars summed over timeframes", () => {
    expect(barReadings(CENSUS)).toBe(1200);
  });

  it("selects pooled or one timeframe, holdout or all bars, and the candle counts", () => {
    const pooled = selectView(CENSUS, { timeframe: "all", holdoutOnly: false, candleCounts: [1, 2, 3, 4, 5] });
    expect(pooled.patterns.map((entry) => entry.firingCountSelected)).toEqual([540, 60, 0]);
    expect(pooled.barsInView).toBe(1200);
    const holdout = selectView(CENSUS, { timeframe: "all", holdoutOnly: true, candleCounts: [1, 2, 3, 4, 5] });
    expect(holdout.patterns.map((entry) => entry.firingCountSelected)).toEqual([110, 60, 0]);
    const oneMinute = selectView(CENSUS, { timeframe: "1m", holdoutOnly: false, candleCounts: [1, 2, 3, 4, 5] });
    expect(oneMinute.patterns.map((entry) => entry.firingCountSelected)).toEqual([500, 60, 0]);
    expect(oneMinute.barsInView).toBe(1000);
    const single = selectView(CENSUS, { timeframe: "all", holdoutOnly: false, candleCounts: [1] });
    expect(single.patterns.map((entry) => entry.pattern_name)).toEqual(["alpha"]);
    // An empty choice reads as every length, as the notebook's did.
    expect(selectView(CENSUS, { timeframe: "all", holdoutOnly: false, candleCounts: [] }).patterns).toHaveLength(3);
  });

  it("counts present, below and thin against the threshold, with 0 still meaning one firing", () => {
    const view = selectView(CENSUS, { timeframe: "all", holdoutOnly: false, candleCounts: [1, 2, 3, 4, 5] });
    expect(viewCounts(view.patterns, 60)).toMatchObject({ inView: 3, fireAtLeastOnce: 2, present: 2, below: 1, thin: 0, dead: ["gamma"] });
    expect(viewCounts(view.patterns, 100)).toMatchObject({ present: 1, below: 2, thin: 1 });
    expect(effectiveThreshold(0)).toBe(1);
    expect(viewCounts(view.patterns, 0).present).toBe(2);
    expect(presenceOf(0, 60)).toBe("never fires");
    expect(presenceOf(59, 60)).toBe("fires, but below the threshold");
    expect(presenceOf(60, 60)).toBe("clears the threshold");
  });

  it("writes the count out as a sum in TA-Lib order with a running total", () => {
    const view = selectView(CENSUS, { timeframe: "all", holdoutOnly: false, candleCounts: [1, 2, 3, 4, 5] });
    const terms = summationTerms(view.patterns, 100);
    expect(terms.map((term) => [term.index, term.pattern.pattern_name, term.indicator, term.runningTotal])).toEqual([
      [1, "alpha", 1, 1], [2, "beta", 0, 1], [3, "gamma", 0, 1],
    ]);
    // The final running total equals the count the table reports.
    expect(terms[terms.length - 1]?.runningTotal).toBe(viewCounts(view.patterns, 100).present);
  });

  it("breaks the patterns down by length", () => {
    expect(lengthBreakdown(acrossTimeframes(CENSUS))).toEqual([
      { candleCount: 1, patternsDefined: 1, patternsThatFire: 1, patternsThatNeverFire: 0, totalFirings: 540 },
      { candleCount: 2, patternsDefined: 1, patternsThatFire: 1, patternsThatNeverFire: 0, totalFirings: 60 },
      { candleCount: 3, patternsDefined: 1, patternsThatFire: 0, patternsThatNeverFire: 1, totalFirings: 0 },
    ]);
  });

  it("names the side each pattern fired on and finds the single-sided ones", () => {
    expect(sidesObserved(3, 2)).toBe("both sides");
    expect(sidesObserved(3, 0)).toBe("bullish only");
    expect(sidesObserved(0, 2)).toBe("bearish only");
    expect(sidesObserved(0, 0)).toBe("never fired");
    const view = selectView(CENSUS, { timeframe: "all", holdoutOnly: false, candleCounts: [1, 2, 3, 4, 5] });
    expect(singleSided(view.patterns).map((entry) => entry.pattern_name)).toEqual(["beta"]);
    expect(categoricalValue(CENSUS[2] as CensusRow, "sides_observed")).toBe("bullish only");
  });
});

describe("symmetric log, histograms and estimators", () => {
  it("keeps zero at zero and inverts", () => {
    expect(symlog(0)).toBe(0);
    expect(symlog(99)).toBeCloseTo(2, 12);
    expect(symlogInverse(symlog(12345))).toBeCloseTo(12345, 6);
    expect(symlog(-99)).toBeCloseTo(-2, 12);
  });

  it("bins every value once, in symlog space when asked", () => {
    const values = [0, 0, 1, 10, 100, 1000, 10000];
    const bins = histogramBins(values, 5, true);
    expect(bins).toHaveLength(5);
    expect(bins.reduce((total, bin) => total + bin.count, 0)).toBe(values.length);
    expect(bins[0]?.lower).toBeCloseTo(0, 9);
    expect(bins[4]?.upper).toBeCloseTo(10000, 4);
    expect(histogramBins([], 5, false)).toEqual([]);
    expect(histogramBins([3, 3], 5, false)).toEqual([{ lower: 3, upper: 3, count: 2 }]);
  });

  it("counts categorical values, largest first", () => {
    expect(valueCounts(["a", "b", "a", null, true])).toEqual([
      { value: "a", count: 2 }, { value: "b", count: 1 }, { value: "missing", count: 1 }, { value: "true", count: 1 },
    ]);
  });

  it("computes the eight numbers with the notebook's estimators (n - 1 deviation, mean of standardised powers)", () => {
    const moments = populationMoments([1, 2, 3, 4, 10]);
    expect(moments?.count).toBe(5);
    expect(moments?.mean).toBeCloseTo(4, 12);
    expect(moments?.median).toBe(3);
    expect(moments?.standardDeviation).toBeCloseTo(Math.sqrt(50 / 4), 12);
    expect(moments?.percentile25).toBe(2);
    expect(moments?.percentile75).toBe(4);
    expect(moments?.minimum).toBe(1);
    expect(moments?.maximum).toBe(10);
    // Hand-computed: z = (x - 4) / sd, skewness = mean(z^3), excess kurtosis = mean(z^4) - 3.
    const sd = Math.sqrt(12.5);
    const z = [1, 2, 3, 4, 10].map((x) => (x - 4) / sd);
    expect(moments?.skewness).toBeCloseTo(z.reduce((t, v) => t + v ** 3, 0) / 5, 12);
    expect(moments?.excessKurtosis).toBeCloseTo(z.reduce((t, v) => t + v ** 4, 0) / 5 - 3, 12);
  });

  it("reports the higher moments as null below four values or with no spread, and null for no values", () => {
    expect(populationMoments([1, 2, 3])?.skewness).toBeNull();
    expect(populationMoments([5, 5, 5, 5])?.excessKurtosis).toBeNull();
    expect(populationMoments([])).toBeNull();
    expect(populationMoments([7])?.standardDeviation).toBeNull();
  });
});
