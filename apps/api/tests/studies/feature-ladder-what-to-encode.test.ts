/**
 * The feature-ladder study: its pure rules (earned, block summaries, order
 * robustness, tick conversion) and its handler against a fake lake.
 */

import { describe, expect, it } from "vitest";
import handler, { histogramSql, sampleSql, statisticsSql } from "../../studies/handlers/feature-ladder-what-to-encode";
import type { StudyLake } from "../../studies/types";
import {
  blockSummaries,
  finalScore,
  gapTicks,
  isEarned,
  robustnessRows,
  rungsOf,
  sampleRowsOf,
  signed,
  type LadderOrdering,
  type LadderRow,
} from "@shared/studies/feature-ladder-what-to-encode";

function row(ordering: LadderOrdering, target: string, rung: number, block: string, score: number, increment: number | null, best: number | null, beats: boolean): LadderRow {
  return {
    ordering,
    target,
    rung_index: rung,
    block_added: block,
    feature_count: rung * 3,
    train_row_count: 210917,
    test_row_count: 69871,
    score_holdout: score,
    score_increment_over_previous_rung: increment,
    shuffled_block_score_mean: best === null ? null : best - 0.001,
    shuffled_block_score_best_of_five: best,
    beats_its_shuffled_control: beats,
    metric: target === "next_bar_direction" ? "area_under_curve" : "r_squared",
    timeframe: "5m",
    recipe: ordering === "derivatives_first" ? "feature_ladder_v1" : "feature_ladder_volume_first_v1",
  };
}

const LADDER: LadderRow[] = [
  row("derivatives_first", "next_bar_range", 0, "intercept_only", 0, null, null, false),
  row("derivatives_first", "next_bar_range", 1, "range_memory", 0.0387, 0.0387, -0.0023, true),
  row("derivatives_first", "next_bar_range", 2, "momentum_rate_of_change", 0.0386, -0.0001, 0.0385, true),
  row("derivatives_first", "next_bar_range", 3, "volatility_rate_of_change", 0.0515, 0.0129, 0.0444, true),
  row("derivatives_first", "next_bar_direction", 0, "intercept_only", 0.5, null, null, false),
  row("derivatives_first", "next_bar_direction", 1, "range_memory", 0.501, 0.001, 0.5033, false),
  row("derivatives_first", "next_bar_direction", 2, "momentum_rate_of_change", 0.5045, 0.0036, 0.4996, true),
  row("volume_first", "next_bar_range", 0, "intercept_only", 0, null, null, false),
  row("volume_first", "next_bar_range", 1, "range_memory", 0.0387, 0.0387, -0.0023, true),
  row("volume_first", "next_bar_range", 2, "momentum_rate_of_change", 0.0384, -0.0003, 0.0385, true),
  row("volume_first", "next_bar_range", 3, "volatility_rate_of_change", 0.0540, 0.0156, 0.0444, true),
];

describe("ladder rules", () => {
  it("earns a place only with a positive increment AND a score above the best shuffle", () => {
    const rows = rungsOf(LADDER, "derivatives_first", "next_bar_range");
    expect(rows.map((entry) => isEarned(entry))).toEqual([false, true, false, true]);
    // beats its control but the increment is negative: not earned
    expect(isEarned(rows[2] as LadderRow)).toBe(false);
    // positive increment but inside shuffle noise: not earned
    expect(isEarned(rungsOf(LADDER, "derivatives_first", "next_bar_direction")[1] as LadderRow)).toBe(false);
    // the intercept rung never earns
    expect(isEarned(rows[0] as LadderRow)).toBe(false);
  });

  it("a materiality floor removes small gains", () => {
    const direction = rungsOf(LADDER, "derivatives_first", "next_bar_direction")[2] as LadderRow;
    expect(isEarned(direction, 0)).toBe(true);
    expect(isEarned(direction, 0.0036)).toBe(false);
    expect(isEarned(direction, 0.003)).toBe(true);
  });

  it("summarises each block: targets earned on, best earned increment, which targets", () => {
    const summaries = blockSummaries(LADDER, "derivatives_first");
    const byBlock = Object.fromEntries(summaries.map((summary) => [summary.block, summary]));
    expect(byBlock.range_memory).toMatchObject({ targetsEarnedOn: 1, targetCount: 2, bestIncrement: 0.0387, earnedTargets: ["next_bar_range"] });
    expect(byBlock.momentum_rate_of_change).toMatchObject({ targetsEarnedOn: 1, earnedTargets: ["next_bar_direction"] });
    expect(byBlock.volatility_rate_of_change?.targetsEarnedOn).toBe(1);
    expect(summaries[0]?.targetsEarnedOn).toBeGreaterThanOrEqual(summaries[summaries.length - 1]?.targetsEarnedOn ?? 0);
    expect(blockSummaries(LADDER, "derivatives_first", 0.02).find((summary) => summary.block === "volatility_rate_of_change")?.targetsEarnedOn).toBe(0);
  });

  it("compares the two orderings block by block", () => {
    const volatility = robustnessRows(LADDER, "next_bar_range").find((entry) => entry.block === "volatility_rate_of_change");
    expect(volatility?.derivativesFirst).toBeCloseTo(0.0129, 10);
    expect(volatility?.volumeFirst).toBeCloseTo(0.0156, 10);
    expect(volatility?.difference).toBeCloseTo(0.0027, 10);
    const absent = robustnessRows(LADDER, "next_bar_range").find((entry) => entry.block === "volume_level");
    expect(absent).toMatchObject({ derivativesFirst: null, volumeFirst: null, difference: null });
    expect(finalScore(LADDER, "volume_first", "next_bar_range")).toBeCloseTo(0.054, 10);
  });

  it("converts a gap in average ranges to ticks and prints signs", () => {
    // 0.0241524 average ranges at a 20.7396-point mean range is the notebook's 2.00 ticks
    expect(gapTicks(0.024152424467, 20.739569484)).toBeCloseTo(2.0036, 3);
    expect(gapTicks(-0.05, 10)).toBeCloseTo(2, 10);
    expect(signed(0.0129)).toBe("+0.0129");
    expect(signed(-0.0003)).toBe("−0.0003");
    expect(signed(null)).toBe("—");
  });
});

describe("handler SQL", () => {
  it("reads only the holdout bars with a known next open, and quotes every view", () => {
    for (const sql of [statisticsSql(), sampleSql(), histogramSql("per_bar", 60, 0.2, 20.74)]) {
      expect(sql).toContain("sample_split = 'holdout'");
      expect(sql).toContain('"derived_mnq_next_candles_5m"');
      expect(sql).toContain("next_candle_1_open_from_close_in_average_ranges IS NOT NULL");
    }
  });

  it("bins in ticks up to the clip, both on one mean range and on each bar's range", () => {
    const meanRange = histogramSql("mean_range", 40, 0.25, 20);
    const perBar = histogramSql("per_bar", 40, 0.25, 20);
    expect(meanRange).toContain("gap_ratio * 20 / 0.25");
    expect(perBar).toContain("gap_ratio * range_points / 0.25");
    // clip 0.25 average ranges at 20 points is 20 ticks
    expect(meanRange).toContain("<= 20");
    expect(meanRange).toContain("* 40) AS INTEGER), 39)");
  });

  it("computes the eight numbers with order-safe aggregates, never first() or last()", () => {
    const sql = statisticsSql();
    for (const aggregate of ["skewness(", "kurtosis(", "quantile_cont(", "stddev_samp(", "median(", "min(", "max("]) expect(sql).toContain(aggregate);
    expect(sql).not.toMatch(/\bfirst\(|\blast\(/);
  });
});

function statsRow(): Record<string, unknown> {
  const row: Record<string, unknown> = {
    gap_bar_count: 69951,
    mean_range_points: 20.739569484353385,
    edge_bar_count: 263,
    edge_mean_gap_ratio: 0.026737432274878903,
    other_mean_gap_ratio: 0.024142668740798505,
    edge_squared_gap: 0.5593441191878146,
    total_squared_gap: 111.20605858023626,
  };
  const means = [0.024152424467084953, 20.739569484353385, 0.3519034758622479, 1.4076139034489916];
  const medians = [0.017211703583598137, 15.425, 0.25, 1.0];
  means.forEach((mean, index) => {
    Object.assign(row, {
      [`c${index}_count`]: 69951,
      [`c${index}_mean`]: mean,
      [`c${index}_median`]: medians[index],
      [`c${index}_standard_deviation`]: 1,
      [`c${index}_skewness`]: 2,
      [`c${index}_kurtosis`]: 3,
      [`c${index}_percentile25`]: 0.1,
      [`c${index}_percentile75`]: 0.9,
      [`c${index}_minimum`]: 0,
      [`c${index}_maximum`]: 100,
    });
  });
  return row;
}

function fakeLake(present: string[]): { lake: StudyLake; sql: string[] } {
  const sql: string[] = [];
  const lake: StudyLake = {
    async query<T>(statement: string): Promise<T[]> {
      sql.push(statement);
      if (statement.includes("UNION ALL") || statement.includes('FROM "derived_mnq_feature_ladder')) {
        const wanted = LADDER.filter((entry) => (entry.ordering === "derivatives_first" ? statement.includes('"derived_mnq_feature_ladder"') : statement.includes("volume_first")));
        return wanted as unknown as T[];
      }
      if (statement.includes("holdout_bar_count")) return [{ holdout_bar_count: 70254 }] as T[];
      if (statement.includes("total_bar_count")) return [{ total_bar_count: 353478 }] as T[];
      if (statement.includes("gap_bar_count")) return [statsRow()] as T[];
      if (statement.includes("hash(")) return [{ gap_magnitude_in_average_ranges: 0.03, average_range_10_bars_points: 20, gap_magnitude_points: 0.6, gap_magnitude_ticks_per_bar: 2.4 }] as T[];
      if (statement.includes("SELECT bin")) return [{ bin: 0, bar_count: 10 }, { bin: 2, bar_count: 5 }] as T[];
      return [];
    },
    async hasView(name) {
      return present.includes(name);
    },
    async columns() {
      return [];
    },
  };
  return { lake, sql };
}

const ALL = ["derived_mnq_feature_ladder", "derived_mnq_feature_ladder_volume_first", "derived_mnq_next_candles_5m"];

describe("feature-ladder handler", () => {
  it("parses its query with defaults and refuses out-of-range values", () => {
    expect(handler.query.parse({})).toEqual({ bins: 60, clip: 0.2 });
    expect(handler.query.parse({ bins: "80", clip: "0.35" })).toEqual({ bins: 80, clip: 0.35 });
    expect(handler.query.safeParse({ bins: "5" }).success).toBe(false);
    expect(handler.query.safeParse({ clip: "0" }).success).toBe(false);
    expect(handler.query.safeParse({ clip: "drop table" }).success).toBe(false);
  });

  it("returns both ladders, the gap aggregates, bins filled with zeros and the session-edge check", async () => {
    const { lake } = fakeLake(ALL);
    const notes: string[] = [];
    const body = await handler.run({ bins: 4, clip: 0.2 }, { lake, notes });

    expect(notes).toEqual([]);
    expect(body.ladder).toHaveLength(LADDER.length);
    expect(body.totalBarCount).toBe(353478);
    const gap = body.gap;
    expect(gap).not.toBeNull();
    if (!gap) return;
    expect(gap.holdoutBarCount).toBe(70254);
    expect(gap.gapBarCount).toBe(69951);
    // the notebook's number: mean |gap| in ranges times the mean range, over a 0.25-point tick
    expect(gap.notebookMeanGapTicks).toBeCloseTo(2.0036, 3);
    expect(gap.notebookMedianGapTicks).toBeCloseTo(1.4279, 3);
    // bar by bar the mean is lower
    expect(gap.perBarMeanGapTicks).toBeCloseTo(1.4076, 3);
    expect(gap.perBarMedianGapTicks).toBe(1);
    expect(gap.clipTicks).toBeCloseTo((0.2 * 20.739569484353385) / 0.25, 8);
    expect(gap.histogramAtMeanRange).toHaveLength(4);
    expect(gap.histogramAtMeanRange.map((bin) => bin.count)).toEqual([10, 0, 5, 0]);
    expect(gap.histogramAtMeanRange[3]?.upper).toBeCloseTo(gap.clipTicks, 8);
    expect(gap.keptShareAtMeanRange).toBeCloseTo(15 / 69951, 10);
    expect(gap.summaries.map((summary) => summary.column)).toEqual([
      "gap_magnitude_in_average_ranges",
      "average_range_10_bars_points",
      "gap_magnitude_points",
      "gap_magnitude_ticks_per_bar",
    ]);
    expect(gap.sessionEdge?.edgeShare).toBeCloseTo(263 / 69951, 10);
    expect(gap.sessionEdge?.edgeMultiple).toBeCloseTo(1.1075, 3);
    expect(gap.sessionEdge?.squaredGapShare).toBeCloseTo(0.00503, 4);
    expect(Object.keys(gap.sampleColumns)).toHaveLength(4);
    expect(sampleRowsOf(gap.sampleColumns)).toEqual([{ gap_magnitude_in_average_ranges: 0.03, average_range_10_bars_points: 20, gap_magnitude_points: 0.6, gap_magnitude_ticks_per_bar: 2.4 }]);
  });

  it("puts a view that is not landed in the notes and returns what it can", async () => {
    const { lake, sql } = fakeLake(["derived_mnq_feature_ladder"]);
    const notes: string[] = [];
    const body = await handler.run({ bins: 60, clip: 0.2 }, { lake, notes });
    expect(notes[0]).toContain("derived_mnq_feature_ladder_volume_first");
    expect(notes[0]).toContain("derived_mnq_next_candles_5m");
    expect(body.ladder.every((entry) => entry.ordering === "derivatives_first")).toBe(true);
    expect(body.gap).toBeNull();
    expect(body.totalBarCount).toBeNull();
    expect(sql.some((statement) => statement.includes("derived_mnq_next_candles_5m"))).toBe(false);
  });

  it("returns an empty body when nothing is landed", async () => {
    const { lake, sql } = fakeLake([]);
    const notes: string[] = [];
    const body = await handler.run({ bins: 60, clip: 0.2 }, { lake, notes });
    expect(body).toEqual({ ladder: [], totalBarCount: null, gap: null });
    expect(sql).toEqual([]);
    expect(notes).toHaveLength(1);
  });

  it("declares every view it reads", () => {
    expect(handler.slug).toBe("feature-ladder-what-to-encode");
    expect(handler.datasets).toEqual(ALL);
  });
});
