/**
 * Pattern casebook: the handler (apps/api/studies/handlers/pattern-casebook.ts)
 * against a fake lake, and the shared arithmetic
 * (packages/shared/src/studies/pattern-casebook.ts) against numpy / scipy values.
 */

import { describe, expect, it } from "vitest";
import handler from "../../studies/handlers/pattern-casebook";
import type { StudyLake } from "../../studies/types";
import {
  againstRandom, eightNumbers, histogramShares, numpyHistogram, persistenceTerms, rankBestFirst, repriceRule, repriceSide,
  runningDollars, sampleWithoutReplacement,
  type CaseBody, type ColumnsBody, type DistributionBody, type LastMoveRule, type OverviewBody, type SideRow, type SidesBody,
} from "@shared/studies/pattern-casebook";

const RUN = {
  round_trip_cost_ticks: 5.6022, round_trip_cost_dollars: 2.8011, tick_size_points: 0.25, dollars_per_tick: 0.5,
  dollars_per_point: 2, trade_rule: "enter at the next open", random_draws: 200, empirical_draw_limit: 2000,
  minimum_trades: 20, seed: 20260915, build_seconds: 47, built_at_milliseconds: 0, source: "s", cost_model: "c",
};

const SIDE: SideRow = {
  timeframe: "1m", pattern: "engulfing", side: "bullish", trade_direction: "long", calendar_year: 2024, candle: 1,
  trade_count: 4, trading_days_with_a_trade: 2, sessions_in_year: 250,
  net_dollars_per_trade_mean: -1, net_dollars_per_trade_median: -1.5, net_dollars_per_trade_standard_deviation: 2,
  net_dollars_per_trade_skewness: 0, net_dollars_per_trade_excess_kurtosis: 0, net_dollars_per_trade_percentile_25: -2,
  net_dollars_per_trade_percentile_75: 0, net_dollars_per_trade_minimum: -3, net_dollars_per_trade_maximum: 2,
  share_of_trades_net_positive: 0.25, total_net_dollars: -4, net_dollars_per_session: -0.016,
  every_bar_same_direction_net_dollars_per_trade: -2.7, pattern_minus_every_bar_dollars_per_trade: 1.7,
  random_bars_total_net_dollars_percentile_5: -16, random_bars_total_net_dollars_median: -11,
  random_bars_total_net_dollars_percentile_95: -6, share_of_random_totals_at_or_above_pattern: 0.01,
  random_band_method: "200 draws",
};

const T0 = Date.UTC(2024, 0, 2, 14, 0);
const MINUTE = 60_000;

/** Four firings of one pattern side and a pool of 12 usable candles, all on MNQH4. */
function fakeLake(views: string[]): StudyLake & { sql: string[] } {
  const sql: string[] = [];
  const firing = (i: number, gross: number) => ({
    trade_direction: "long", pattern_candle_count: 2, bar_timestamp_milliseconds: T0 + i * 3 * MINUTE, contract_symbol: "MNQH4",
    pattern_close_price: 100 + i, entry_price_next_candle_open: 100 + i,
    exit_price_candle_1_close: 100 + i + gross * 0.25, gross_ticks_candle_1: gross,
    exit_price_candle_2_close: Number.NaN, gross_ticks_candle_2: Number.NaN,
    exit_price_candle_3_close: 101, gross_ticks_candle_3: 1, exit_price_candle_4_close: 101, gross_ticks_candle_4: 1,
    exit_price_candle_5_close: 101, gross_ticks_candle_5: 1, exit_price_candle_6_close: 101, gross_ticks_candle_6: 1,
  });
  return {
    sql,
    async query<T>(statement: string): Promise<T[]> {
      sql.push(statement);
      if (statement.includes("run_information")) return [RUN] as T[];
      if (statement.includes("recent_findings")) {
        return [{ finding_date: "2026-09-15", repository: "datalake", area: "candlestick patterns", finding: "f", result: "r", verdict: "no edge", in_trader_terms: "t", where_to_see_it: "w", computed_source: "c" }] as T[];
      }
      if (statement.includes("last_move_rules")) return [{ timeframe: "1m", rule: "fade the last move", period: "2024" }] as T[];
      if (statement.includes("pattern_side_dollars")) return [SIDE] as T[];
      if (statement.includes("GROUP BY pattern, side")) {
        return [{ pattern: "engulfing", side: "bullish", share_1: 0.5, share_2: null, share_3: 0, share_4: 0, share_5: 0, share_6: 0 }] as T[];
      }
      if (statement.includes("pattern_firing_trades") && statement.includes("EXCLUDE (recipe, bar_timestamp, trading_day)")) {
        return [0, 1, 2, 3].map((i) => ({
          timeframe: "1m", pattern: "engulfing", side: "bullish", trade_direction: "long", pattern_candle_count: 2, calendar_year: 2024,
          contract_symbol: i < 2 ? "MNQH4" : "MNQM4", entry_price_next_candle_open: 100 + i, gross_ticks_candle_1: [-3, 9, 1, -1][i],
          bar_timestamp_milliseconds: T0 + i * 30 * 86_400_000, trading_day: `2024-0${1 + i}-02`, net_dollars_candle_1: 0,
        })) as T[];
      }
      if (statement.includes("pattern_firing_trades")) return [firing(0, -3), firing(1, 9), firing(2, 1), firing(3, -1)] as T[];
      if (statement.includes("control_signed_body")) {
        return Array.from({ length: 12 }, (_, i) => ({
          timestamp_milliseconds: T0 + i * MINUTE, contract_symbol: "MNQH4", close: 100, entry_price: 100, exit_price: 100 + (i % 3) * 0.25,
        })) as T[];
      }
      if (statement.includes("derived_mnq_next_candles_1m")) {
        // The candle window: 3 before, the signal (T0), 2 after, and one on another contract.
        return [-3, -2, -1, 0, 1, 2].map((offset) => ({
          timestamp_milliseconds: T0 + offset * MINUTE, contract_symbol: offset === -3 ? "MNQZ3" : "MNQH4", trading_day: "2024-01-02",
          open: 100, high: 101, low: 99, close: 100,
        })) as T[];
      }
      return [];
    },
    async hasView(name) {
      return views.includes(name);
    },
    async columns() {
      return [];
    },
  };
}

const ALL_VIEWS = [
  "derived_study_pattern_casebook_run_information", "derived_study_pattern_casebook_recent_findings",
  "derived_study_pattern_casebook_pattern_side_dollars", "derived_study_pattern_casebook_last_move_rules",
  "derived_study_pattern_casebook_pattern_firing_trades", "derived_mnq_next_candles_1m",
];

async function run<T>(query: Record<string, string>, lake = fakeLake(ALL_VIEWS)) {
  const notes: string[] = [];
  const data = (await handler.run(handler.query.parse(query), { lake, notes })) as T;
  return { data, notes, lake };
}

describe("pattern-casebook handler", () => {
  it("declares every view it reads", () => {
    expect(handler.slug).toBe("pattern-casebook");
    expect(handler.datasets).toEqual(expect.arrayContaining(ALL_VIEWS));
  });

  it("returns an empty overview with a note when the casebook is not landed", async () => {
    const { data, notes } = await run<OverviewBody>({}, fakeLake([]));
    expect(data.findings).toEqual([]);
    expect(data.run).toBeNull();
    expect(notes[0]).toContain("derived_study_pattern_casebook_run_information");
  });

  it("reads the overview: run, findings, rules and the dashboard's MNQ cost in ticks", async () => {
    const { data } = await run<OverviewBody>({ part: "overview" });
    expect(data.run?.round_trip_cost_ticks).toBe(5.6022);
    expect(data.findings).toHaveLength(1);
    expect(data.rules[0]?.rule).toBe("fade the last move");
    expect(data.dashboardCostTicks).toBeCloseTo(5.56, 6);
  });

  it("reprices pattern sides at another cost and takes the share positive from the trades", async () => {
    const { data } = await run<SidesBody>({ part: "sides", cost: "0" });
    const row = data.rows[0] as SideRow;
    // 5.6022 ticks x $0.50 handed back per trade
    expect(row.net_dollars_per_trade_mean).toBeCloseTo(-1 + 2.8011, 9);
    expect(row.total_net_dollars).toBeCloseTo(-4 + 4 * 2.8011, 9);
    expect(row.random_bars_total_net_dollars_percentile_95).toBeCloseTo(-6 + 4 * 2.8011, 9);
    expect(row.share_of_trades_net_positive).toBe(0.5);
    expect(row.share_of_random_totals_at_or_above_pattern).toBe(0.01);
  });

  it("steps through the firings best first and draws the trade's own contract", async () => {
    const { data } = await run<CaseBody>({ part: "case", order: "best", step: "1" });
    expect(data.tradeCount).toBe(4);
    expect(data.trade?.gross_ticks).toBe(9);
    expect(data.trade?.rank_best_first).toBe(1);
    expect(data.trade?.net_dollars).toBeCloseTo((9 - 5.6022) * 0.5, 9);
    const worst = (await run<CaseBody>({ part: "case", order: "worst", step: "1" })).data;
    expect(worst.trade?.gross_ticks).toBe(-3);
    expect(worst.trade?.rank_best_first).toBe(4);
  });

  it("builds the window around the signal, other contracts left out", async () => {
    const { data, notes } = await run<CaseBody>({ part: "case", step: "1" });
    expect(data.trade?.bar_timestamp_milliseconds).toBe(T0);
    expect(data.window.map((candle) => candle.bars_from_signal)).toEqual([-2, -1, 0, 1, 2]);
    expect(data.aligned).toBe(true);
    expect(notes).toEqual([]);
  });

  it("clamps the step and trades random bars in the pattern's direction", async () => {
    const { data } = await run<CaseBody>({ part: "case", population: "random", draw: "7", step: "99" });
    expect(data.population).toBe("random");
    expect(data.tradeCount).toBe(4);
    expect(data.step).toBe(4);
    expect([0, 1, 2]).toContain(data.trade?.gross_ticks);
  });

  it("drops the firings with no exit at candle k", async () => {
    const { data, notes } = await run<CaseBody>({ part: "case", candle: "2" });
    expect(data.trade).toBeNull();
    expect(notes[0]).toContain("candle 2");
  });

  it("computes section 2: shares, running lines, the band shifted before costs, eight numbers", async () => {
    const { data } = await run<DistributionBody>({ part: "distribution", view: "gross", lines: "5" });
    expect(data.available).toBe(true);
    expect(data.randomLines).toHaveLength(5);
    const patternShare = data.histogram.reduce((sum, bin) => sum + bin.pattern_share_of_trades, 0);
    expect(patternShare).toBeCloseTo(1, 9);
    // before costs: the gross ticks in dollars
    expect(data.pattern?.total).toBeCloseTo((-3 + 9 + 1 - 1) * 0.5, 9);
    expect(data.stats?.meanPerTrade).toBeCloseTo(-1 + 2.8011, 9);
    expect(data.band?.low).toBeCloseTo(-16 + 4 * 2.8011, 9);
    expect(data.patternLine[data.patternLine.length - 1]?.running_dollars).toBeCloseTo(3, 9);
  });

  it("profiles every column of the selected firings", async () => {
    const { data } = await run<ColumnsBody>({ part: "columns", bins: "10" });
    expect(data.rowCount).toBe(4);
    expect(data.constants.map((entry) => entry.column)).toEqual(expect.arrayContaining(["timeframe", "pattern_candle_count", "calendar_year"]));
    expect(data.numeric.map((profile) => profile.column)).toEqual(expect.arrayContaining(["gross_ticks_candle_1", "entry_price_next_candle_open"]));
    expect(data.numeric.find((profile) => profile.column === "gross_ticks_candle_1")?.bins).toHaveLength(10);
    expect(data.categorical.find((entry) => entry.column === "contract_symbol")?.counts).toEqual([
      { value: "MNQH4", trades: 2 }, { value: "MNQM4", trades: 2 },
    ]);
    expect(data.months.map((entry) => entry.month)).toEqual(["2024-01", "2024-02", "2024-03", "2024-04"]);
  });

  it("quotes every parsed value and refuses a pattern outside its pattern", async () => {
    expect(() => handler.query.parse({ pattern: "x'; DROP" })).toThrow();
    const { lake } = await run<CaseBody>({ part: "case", side: "breakout, bullish" });
    expect(lake.sql.some((statement) => statement.includes("side = 'breakout, bullish'"))).toBe(true);
  });
});

describe("pattern-casebook arithmetic", () => {
  it("matches scipy's biased skewness and excess kurtosis and numpy's percentiles", () => {
    const summary = eightNumbers([1, 2, 3, 4, 10]);
    expect(summary.mean).toBe(4);
    expect(summary.median).toBe(3);
    expect(summary.standardDeviation).toBeCloseTo(3.5355339059327378, 12);
    expect(summary.skewness).toBeCloseTo(1.1384199576606167, 12);
    expect(summary.kurtosis).toBeCloseTo(-0.21199999999999974, 12);
    expect(summary.percentile25).toBe(2);
    expect(summary.percentile75).toBe(4);
    expect(eightNumbers([2, 2, 2, 2]).skewness).toBeNull();
  });

  it("bins like numpy.histogram and clips like the notebook", () => {
    expect(numpyHistogram([1, 2, 2, 3, 9], 4).map((bin) => bin.count)).toEqual([3, 1, 0, 1]);
    const shares = histogramShares([-3, 1, 2, 0.5, -1, 4, 2], [0, 1, -2, 3, 5, -4, 1, 1, 2], 90, 4);
    const expectedPattern = [1 / 7, 1 / 7, 4 / 7, 1 / 7];
    const expectedEvery = [2 / 9, 1 / 9, 4 / 9, 2 / 9];
    shares.forEach((bin, index) => {
      expect(bin.pattern_share_of_trades).toBeCloseTo(expectedPattern[index] as number, 12);
      expect(bin.every_bar_share_of_trades).toBeCloseTo(expectedEvery[index] as number, 12);
    });
  });

  it("samples distinct bars, in time order, the same for the same seed", () => {
    const first = sampleWithoutReplacement(1000, 50, 3);
    expect(new Set(first).size).toBe(50);
    expect([...first].sort((a, b) => a - b)).toEqual(first);
    expect(sampleWithoutReplacement(1000, 50, 3)).toEqual(first);
    expect(sampleWithoutReplacement(1000, 50, 4)).not.toEqual(first);
    expect(sampleWithoutReplacement(5, 9, 1)).toEqual([0, 1, 2, 3, 4]);
  });

  it("adds the rule's terms and finds the break-even hit rate", () => {
    const terms = persistenceTerms(0.5, 4, 4, 5.6);
    expect(terms.terms.map((term) => term.value)).toEqual([2, -2, -5.6]);
    expect(terms.net).toBeCloseTo(-5.6, 12);
    expect(terms.breakEvenHitRate).toBeCloseTo((5.6 + 4) / 8, 12);
    const rule = { gross_ticks_per_trade: 0.3, trades_per_session: 1000, always_long_net_dollars_per_trade: -2.8, round_trip_cost_ticks: 5.6, average_winning_trade_ticks: 4, average_losing_trade_ticks: 4 } as LastMoveRule;
    const priced = repriceRule(rule, 0.3, 0.5);
    expect(priced.netDollarsPerTrade).toBeCloseTo(0, 12);
    expect(priced.alwaysLongNetDollarsPerTrade).toBeCloseTo(-2.8 + 5.3 * 0.5, 12);
  });

  it("classes a side against its random band per trade", () => {
    expect(againstRandom(SIDE)).toEqual({ low: -4, high: -1.5, against: "above random bars" });
    expect(againstRandom({ ...SIDE, net_dollars_per_trade_mean: -2 }).against).toBe("inside random bars");
    expect(againstRandom({ ...SIDE, net_dollars_per_trade_mean: -5 }).against).toBe("below random bars");
    // a cost moves the mean and the band together, so the class does not change
    expect(againstRandom(repriceSide(SIDE, 5.6022, 0, 0.5, null)).against).toBe("above random bars");
  });

  it("ranks best first with ties in order and thins running dollars to one point per timestamp", () => {
    expect(rankBestFirst([1, 3, 3, -2])).toEqual([3, 1, 2, 4]);
    const line = runningDollars([1, 2, 2, 3], [1, 1, 1, -5]);
    expect(line).toEqual([
      { bar_timestamp_milliseconds: 1, running_dollars: 1 },
      { bar_timestamp_milliseconds: 2, running_dollars: 3 },
      { bar_timestamp_milliseconds: 3, running_dollars: -2 },
    ]);
  });
});
