/**
 * The TA-strategy study: the handler (apps/api/studies/handlers/ta-strategy-600-ticks.ts) against a fake lake
 * that answers by SQL shape, and the shared arithmetic the page runs (packages/shared/src/studies/ta-strategy-600-ticks.ts):
 * the goal formula at the notebook's defaults, the frequency curve, the expected move, the zone merge ported from
 * levels.zones_for_bars, its ladder, and the columnar cumulative series.
 */

import { beforeEach, describe, expect, it } from "vitest";
import handler, { clearColumnTypeCache } from "../../studies/handlers/ta-strategy-600-ticks";
import type { StudyLake } from "../../studies/types";
import {
  cumulativeSeries, expectedMove, requiredGrossPerTrade, sessionDayOf, winRateBreakEven, winRateCurve, winRateNeeded, zoneLadder, zonesForBars,
  type LevelEvent,
} from "@shared/studies/ta-strategy-600-ticks";

type Answer = (sql: string) => Record<string, unknown>[] | undefined;

function fakeLake(views: string[], answers: Answer[]): StudyLake & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    async query<T>(statement: string): Promise<T[]> {
      sql.push(statement);
      for (const answer of answers) {
        const rows = answer(statement);
        if (rows) return rows as T[];
      }
      return [] as T[];
    },
    async hasView(name) {
      return views.includes(name);
    },
    async columns() {
      return [];
    },
  };
}

const columnsOf = (table: string, columns: Array<[string, string]>): Answer => (statement) =>
  statement.includes("information_schema.columns") && statement.includes(`'${table}'`)
    ? columns.map(([column_name, data_type]) => ({ column_name, data_type }))
    : undefined;

async function run(query: Record<string, unknown>, lake: StudyLake) {
  const notes: string[] = [];
  const data = await handler.run(handler.query.parse(query), { lake, notes });
  return { data: data as Record<string, unknown>, notes };
}

describe("ta-strategy-600-ticks handler", () => {
  beforeEach(() => clearColumnTypeCache());

  it("names every view it reads and parses the notebook's controls", () => {
    expect(handler.slug).toBe("ta-strategy-600-ticks");
    expect(handler.datasets).toContain("derived_ta_strategy_600_ticks_configurations");
    expect(handler.datasets).toContain("derived_study_ta_strategy_600_ticks_zone_build_bars");
    const parsed = handler.query.parse({ part: "rules_round", minimumTrades: "125", bins: "40" });
    expect(parsed).toMatchObject({ part: "rules_round", minimumTrades: 125, bins: 40, period: "all_years", symbol: "MNQ" });
  });

  it("refuses anything that could reach SQL unquoted", () => {
    expect(handler.query.safeParse({ part: "battery_round", recipe: "x'; DROP TABLE t; --" }).success).toBe(false);
    expect(handler.query.safeParse({ part: "nope" }).success).toBe(false);
    expect(handler.query.safeParse({ part: "build", day: "2025-13-99x" }).success).toBe(false);
    expect(handler.query.safeParse({ part: "frequency", cap: "3" }).success).toBe(false);
  });

  it("answers the cost model and goal without touching the lake", async () => {
    const lake = fakeLake([], []);
    const { data } = await run({ part: "overview" }, lake);
    expect(data.goalTicks).toBe(600);
    expect(data.costTicks).toBeCloseTo(5.56, 6);
    expect(lake.sql).toHaveLength(0);
  });

  it("turns a missing dataset into a note and an empty body", async () => {
    const { data, notes } = await run({ part: "battery" }, fakeLake([], []));
    expect(data).toEqual({ rounds: [], reviews: [] });
    expect(notes[0]).toContain("derived_ta_strategy_600_ticks_rounds");
    const build = await run({ part: "build", day: "2025-12-29" }, fakeLake([], []));
    expect(build.data).toEqual({ session: null, bars: [], events: [], reference: [] });
    expect(build.notes[0]).toContain("zone_build");
  });

  it("asks for a round before reading one", async () => {
    const { data, notes } = await run({ part: "battery_round" }, fakeLake(["derived_ta_strategy_600_ticks_configurations"], []));
    expect(data.configurations).toEqual([]);
    expect(notes).toEqual(["Pick a round first."]);
  });

  it("reads timestamps as epoch milliseconds, session dates as text, and quotes the recipe", async () => {
    const lake = fakeLake(["derived_ta_strategy_600_ticks_rounds", "derived_ta_strategy_600_ticks_reviews"], [
      columnsOf("derived_ta_strategy_600_ticks_rounds", [["round", "BIGINT"], ["recipe", "VARCHAR"], ["finished_at", "VARCHAR"]]),
      columnsOf("derived_ta_strategy_600_ticks_reviews", [["round", "BIGINT"], ["rank", "BIGINT"], ["reviewed_at", "TIMESTAMP_NS"]]),
      (statement) => (statement.includes('FROM "derived_ta_strategy_600_ticks_rounds"') ? [{ round: 1, recipe: "round_1", finished_at: "x" }] : undefined),
    ]);
    const { data } = await run({ part: "battery" }, lake);
    expect(data.rounds).toEqual([{ round: 1, recipe: "round_1", finished_at: "x" }]);
    const reviews = lake.sql.find((statement) => statement.includes('FROM "derived_ta_strategy_600_ticks_reviews"'));
    expect(reviews).toContain('epoch_ms(CAST("reviewed_at" AS TIMESTAMP)) AS "reviewed_at"');
    expect(reviews).toContain("ORDER BY round, rank");
  });

  it("profiles a large frame on the server: eight numbers and a histogram per column", async () => {
    const views = ["derived_ta_strategy_600_ticks_daily", "derived_ta_strategy_600_ticks_trades", "derived_ta_strategy_600_ticks_folds"];
    const lake = fakeLake(views, [
      columnsOf("derived_ta_strategy_600_ticks_trades", [["trade_number", "BIGINT"], ["net_ticks", "DOUBLE"], ["side", "VARCHAR"], ["recipe", "VARCHAR"]]),
      columnsOf("derived_ta_strategy_600_ticks_daily", [["session_date", "TIMESTAMP_NS"], ["net_usd", "DOUBLE"]]),
      columnsOf("derived_ta_strategy_600_ticks_folds", [["fold_index", "BIGINT"]]),
      (statement) => (statement.includes("skewness(value)")
        ? [{ column_name: "net_ticks", n: 4, mean: 1, median: 1, standard_deviation: 2, skewness: 0, kurtosis: -1.2, percentile_25: 0, percentile_75: 2, minimum: -2, maximum: 4 }]
        : undefined),
      (statement) => (statement.includes("AS bin") ? [{ column_name: "net_ticks", bin: 0, n: 1 }, { column_name: "net_ticks", bin: 2, n: 2 }, { column_name: "net_ticks", bin: 2, n: 1 }] : undefined),
      (statement) => (statement.startsWith("SELECT count(*) AS value") ? [{ value: 4 }] : undefined),
      (statement) => (statement.includes('FROM "derived_ta_strategy_600_ticks_daily"') ? [{ session_date: "2025-01-02", net_usd: 10 }] : undefined),
    ]);
    const { data } = await run({ part: "battery_configuration", recipe: "round_2", configuration: "1h_h12_logistic_gate30", bins: 5 }, lake);
    const profiles = data.tradeProfiles as Array<{ column: string; count: number; bins: Array<{ lower: number; upper: number; count: number }> }>;
    expect(profiles.map((profile) => profile.column)).toEqual(["net_ticks"]);   // trade_number excluded, text skipped
    expect(profiles[0]?.count).toBe(4);
    expect(profiles[0]?.bins.map((bin) => bin.count)).toEqual([1, 0, 3, 0, 0]);
    expect(profiles[0]?.bins[0]).toMatchObject({ lower: -2, upper: -0.8 });
    expect(data.tradeCount).toBe(4);
    const unpivot = lake.sql.find((statement) => statement.includes("UNPIVOT"));
    expect(unpivot).toContain(`recipe = 'round_2' AND configuration_id = '1h_h12_logistic_gate30'`);
    expect(unpivot).not.toContain('CAST("side" AS DOUBLE)');
  });

  it("tests a rule round for values, not for a column the union-by-name view always has", async () => {
    const views = ["derived_ta_rule_strategies_600_ticks_strategies", "derived_ta_rule_strategies_600_ticks_daily"];
    const lake = fakeLake(views, [
      columnsOf("derived_ta_rule_strategies_600_ticks_strategies", [["strategy_id", "VARCHAR"], ["all_years_target_hit_rate", "DOUBLE"]]),
      (statement) => (statement.includes("count(all_years_target_hit_rate)") ? [{ value: 0 }] : undefined),
    ]);
    const { data } = await run({ part: "rules_round", recipe: "round_1", period: "all_years", timeframes: "5m,15m", minimumTrades: 50 }, lake);
    expect(data.strict).toBe(false);
    expect(data.period).toBe("out_of_sample");   // round 1 has no all_years period, as in the notebook
    expect(data.rateColumn).toBe("out_of_sample_win_rate");
    const points = lake.sql.find((statement) => statement.includes("AS lift_over_random"));
    expect(points).toContain(`s.timeframe IN ('5m', '15m')`);
    expect(points).toContain(`s."out_of_sample_trade_count" >= 50`);
  });
});

describe("a rule round whose view has no target-hit column", () => {
  beforeEach(() => clearColumnTypeCache());

  it("never reads the column, and takes the round-1 path", async () => {
    const lake = fakeLake(["derived_ta_rule_strategies_600_ticks_strategies", "derived_ta_rule_strategies_600_ticks_daily"], []);
    const notes: string[] = [];
    const data = (await handler.run(handler.query.parse({ part: "rules_round", recipe: "round_1" }), { lake, notes })) as { strict: boolean; rateColumn: string };
    expect(data.strict).toBe(false);
    expect(data.rateColumn).toBe("out_of_sample_win_rate");
    expect(lake.sql.some((statement) => statement.includes("count(all_years_target_hit_rate)"))).toBe(false);
  });
});

describe("the goal formula", () => {
  const defaults = { goalTicks: 600, tradesPerDay: 20, riskTicks: 80, rewardToRisk: 1, contracts: 1, costTicks: 5.56 };

  it("needs a 72.2% win rate at the notebook's defaults, 53.5% to break even", () => {
    expect(winRateNeeded(defaults)).toBeCloseTo(0.72225, 5);
    expect(winRateBreakEven(defaults)).toBeCloseTo(0.53475, 5);
  });

  it("falls with more contracts and a better reward-to-risk, and clamps the curve at 1.2", () => {
    expect(winRateNeeded({ ...defaults, contracts: 10 })).toBeLessThan(winRateNeeded(defaults));
    expect(winRateNeeded({ ...defaults, rewardToRisk: 2 })).toBeCloseTo((30 + 5.56 + 80) / 240, 9);
    const curve = winRateCurve(defaults);
    expect(curve).toHaveLength(100);
    expect(curve[0]?.winRateNeeded).toBe(1.2);
    expect(curve[99]?.winRateNeeded).toBeCloseTo((6 + 85.56) / 160, 9);
  });

  it("asks each of N trades for G/N + c gross ticks", () => {
    expect(requiredGrossPerTrade(600, 10, 5.56)).toBeCloseTo(65.56, 9);
  });
});

describe("the expected move", () => {
  it("equals the flat-day move when every minute has the average shape", () => {
    const flat = new Array(1380).fill(1);
    const move = expectedMove(flat, 900, 60, 1, 1.5, 23_000);
    expect(move.windowMinutes).toBe(60);
    expect(move.movePoints).toBeCloseTo(move.flatMovePoints, 9);
    expect(move.movePoints).toBeCloseTo(Math.sqrt(8 / Math.PI) * Math.sqrt(Math.PI / 2) * (1.5 / 1e4) * Math.sqrt(60) * 23_000, 9);
    expect(move.clock).toBe("06:00");
  });

  it("stops at the session end", () => {
    expect(expectedMove(new Array(1380).fill(2), 1375, 60, 1, 1, 1).windowMinutes).toBe(4);
  });
});

describe("zones, ported from levels.zones_for_bars", () => {
  const event = (price: number, group: string, known = 0, until = 10_000): LevelEvent => ({
    price, source: `${group}_level`, family: group, family_group: group, known_from_seconds: known, valid_until_seconds: until,
  });
  const events = [event(99, "session"), event(99.5, "round"), event(101.5, "fractal_1h"), event(150, "week"), event(100.9, "swing_5m", 500)];

  it("single-links the levels in reach and hands out the nearest support and resistance", () => {
    const [zone] = zonesForBars([{ bar_end_seconds: 100, close: 100, average_true_range_14: 2 }], events, 0.25, 0.25, 6);
    // gap = max(0.25 x 2, 1.00) = 1.00; 150 is out of reach; the swing is not known yet
    expect(zone).toMatchObject({
      support_low: 99, support_high: 99.5, support_price: 99.25, support_strength: 2, support_families: "round+session",
      resistance_low: 101.5, resistance_high: 101.5, resistance_strength: 1, resistance_families: "fractal_1h",
      zones_within_2_atr: 2, inside_zone: true,
    });
  });

  it("adds a level once it is known and drops it once it is no longer valid", () => {
    const [known, expired] = zonesForBars([
      { bar_end_seconds: 600, close: 100, average_true_range_14: 2 },
      { bar_end_seconds: 20_000, close: 100, average_true_range_14: 2 },
    ], events, 0.25, 0.25, 6);
    expect(known?.resistance_low).toBe(100.9);
    expect(known?.resistance_high).toBe(101.5);
    expect(known?.resistance_families).toBe("fractal_1h+swing_5m");
    expect(expired?.support_low).toBeNull();
    expect(expired?.zones_within_2_atr).toBeNull();
  });

  it("merges the VWAP bands whatever the reach, and returns nothing without an ATR", () => {
    const [zone, none] = zonesForBars([
      { bar_end_seconds: 100, close: 100, average_true_range_14: 2, vwap: { session_vwap: 99.8, session_vwap_upper_1: 200 } },
      { bar_end_seconds: 100, close: 100, average_true_range_14: null },
    ], events, 0.25, 0.25, 1);
    expect(zone?.support_families).toBe("round+session+vwap");
    expect(zone?.resistance_low).toBe(101.5);
    expect(none?.support_low).toBeNull();
    expect(none?.inside_zone).toBe(false);
  });

  it("shows the ladder: levels sorted, the gaps that start zones, and each zone's role", () => {
    const ladder = zoneLadder({ bar_end_seconds: 100, close: 100, average_true_range_14: 2 }, events, 0.25, 0.25, 6);
    expect(ladder.gap).toBe(1);
    expect(ladder.levels.map((level) => [level.price, level.starts_new_zone, level.zone])).toEqual([[99, true, 1], [99.5, false, 1], [101.5, true, 2]]);
    expect(ladder.zones.map((zone) => zone.role)).toEqual(["support", "resistance"]);
    expect(ladder.zones[0]?.width_ticks).toBe(2);
    expect(ladder.zones[1]?.distance_from_close_ticks).toBe(6);
  });
});

describe("small helpers", () => {
  it("names a CME session by the date it ends", () => {
    expect(sessionDayOf(Date.UTC(2025, 11, 28, 15, 0))).toBe("2025-12-29");
    expect(sessionDayOf(Date.UTC(2025, 11, 29, 13, 55))).toBe("2025-12-29");
  });

  it("builds cumulative series on one date axis, carrying totals over missing days", () => {
    const set = cumulativeSeries([
      { name: "a", session_date: "2025-01-02", value: 1 },
      { name: "b", session_date: "2025-01-03", value: 5 },
      { name: "a", session_date: "2025-01-06", value: 2 },
    ], "name", "value");
    expect(set.dates).toEqual(["2025-01-02", "2025-01-03", "2025-01-06"]);
    expect(set.series).toEqual([{ name: "a", values: [1, 1, 3] }, { name: "b", values: [null, 5, 5] }]);
  });
});
