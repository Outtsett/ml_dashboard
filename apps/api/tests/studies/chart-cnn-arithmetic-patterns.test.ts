/**
 * The chart-CNN arithmetic-pattern handler on a fake lake: the empty state
 * when the round is not landed, an untagged round, the overview's shaping and
 * pairing, a pattern with no positives, the ROC's (0, 0) corner, the query
 * schema, the SQL it writes, and the numpy.array_split arithmetic the score
 * groups reproduce.
 */

import { describe, expect, it } from "vitest";
import handler, { arithmeticQuery, groupsSql, thresholdSql, visibleSql } from "../../studies/handlers/chart-cnn-arithmetic-patterns";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  ARITHMETIC_VIEWS, DIRECTION_VIEW, PATTERN_NAMES, arraySplitGroup, arraySplitSizes, patternLabel, precisionLift, recognitionHeadline,
  type OverviewBody, type PatternBody, type PatternScoreRow,
} from "@shared/studies/chart-cnn-arithmetic-patterns";

type Responder = (sql: string) => Array<Record<string, unknown>>;

function fakeLake(views: readonly string[], respond: Responder): StudyLake & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async query<T>(sql: string): Promise<T[]> {
      seen.push(sql);
      return respond(sql) as T[];
    },
    async hasView(name) {
      return views.includes(name);
    },
    async columns() {
      return [];
    },
  };
}

function context(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

const REQUIRED = Object.values(ARITHMETIC_VIEWS);

const SCORE_ROW = {
  pattern_name: "doji", pattern_bar_count: 1, rule_in_words: "body is at most 10% of the bar's range", window_count: 100,
  positive_window_count: 10, prevalence: 0.1, area_under_curve: 0.98, average_precision: 0.86, recipe: "arithmetic_mnq5m",
};

describe("chart-cnn-arithmetic-patterns handler", () => {
  it("names every view it reads, including the direction pairing", () => {
    expect(handler.slug).toBe("chart-cnn-arithmetic-patterns");
    expect(handler.datasets).toEqual([...REQUIRED, DIRECTION_VIEW]);
  });

  it("returns an empty overview with a note when the round is not landed", async () => {
    const ctx = context(fakeLake([], () => []));
    const body = (await handler.run(arithmeticQuery.parse({}), ctx)) as OverviewBody;
    expect(body.part).toBe("overview");
    expect(body.patterns).toEqual([]);
    expect(body.windowSample.rows).toEqual([]);
    expect(body.direction).toBeNull();
    expect(ctx.notes[0]).toContain(ARITHMETIC_VIEWS.patternScores);
  });

  it("says which tags are landed when the asked tag is not", async () => {
    const lake = fakeLake(REQUIRED, (sql) => (sql.includes("SELECT DISTINCT recipe") ? [{ recipe: "arithmetic_mnq5m" }] : []));
    const ctx = context(lake);
    const body = (await handler.run(arithmeticQuery.parse({ tag: "mnq1h" }), ctx)) as OverviewBody;
    expect(body.patterns).toEqual([]);
    expect(body.tags).toEqual(["mnq5m"]);
    expect(ctx.notes[0]).toContain("mnq1h");
    expect(ctx.notes[0]).toContain("mnq5m");
  });

  it("shapes the overview and pairs the direction row for the same tag", async () => {
    const lake = fakeLake([...REQUIRED, DIRECTION_VIEW], (sql) => {
      if (sql.includes("SELECT DISTINCT recipe")) return [{ recipe: "arithmetic_mnq5m" }];
      if (sql.includes(DIRECTION_VIEW)) {
        return [{ test_observation_count: 100, area_under_curve: 0.505, area_under_curve_interval_low: 0.502, area_under_curve_interval_high: 0.508, base_up_rate: 0.51 }];
      }
      if (sql.includes("COUNT(*) AS window_count, MIN(")) {
        return [{ window_count: 100, first_window_time: "2023-05-04 08:15:00-04:00", last_window_time: "2025-12-30 07:30:00-05:00" }];
      }
      if (sql.includes("SUBSTR(window_time_new_york")) return [{ month: "2023-05", window_count: 60 }, { month: "2023-06", window_count: 40 }];
      if (sql.includes("ORDER BY HASH(window_id)")) return [{ window_id: 3, window_time_new_york: "x", network_score_doji: 0.5, arithmetic_label_doji: 1 }];
      if (sql.includes(ARITHMETIC_VIEWS.patternScores)) return [SCORE_ROW];
      return [];
    });
    const body = (await handler.run(arithmeticQuery.parse({}), context(lake))) as OverviewBody;
    expect(body.tag).toBe("mnq5m");
    expect(body.patterns).toHaveLength(1);
    expect(body.patterns[0]?.area_under_curve).toBe(0.98);
    expect(body.windowCount).toBe(100);
    expect(body.monthlyWindowCounts.map((row) => row.month)).toEqual(["2023-05", "2023-06"]);
    expect(body.windowSample.columns).toEqual(["window_id", "window_time_new_york", "network_score_doji", "arithmetic_label_doji"]);
    expect(body.direction).toEqual({ testObservationCount: 100, areaUnderCurve: 0.505, intervalLow: 0.502, intervalHigh: 0.508, baseUpRate: 0.51 });
    // Every read is scoped to the asked tag's recipe.
    expect(lake.seen.filter((sql) => sql.includes(ARITHMETIC_VIEWS.windowScores)).every((sql) => sql.includes("'arithmetic_mnq5m'"))).toBe(true);
  });

  it("leaves the pairing null when the direction view is absent", async () => {
    const lake = fakeLake(REQUIRED, (sql) => (sql.includes("SELECT DISTINCT recipe") ? [{ recipe: "arithmetic_mnq5m" }] : sql.includes(ARITHMETIC_VIEWS.patternScores) ? [SCORE_ROW] : []));
    const body = (await handler.run(arithmeticQuery.parse({}), context(lake))) as OverviewBody;
    expect(body.direction).toBeNull();
    expect(body.patterns).toHaveLength(1);
  });

  it("notes a pattern the rule never fires and returns no ROC", async () => {
    const lake = fakeLake(REQUIRED, (sql) => {
      if (sql.includes("pattern_bar_count, rule_in_words")) return [{ pattern_bar_count: 3, rule_in_words: "three rising bars" }];
      if (sql.includes("ANY_VALUE(t.positives)")) return [{ area_under_curve: null, average_precision: null, positives: 0, negatives: 50 }];
      if (sql.includes("VALUES")) return [{ threshold: 0, true_positives: 0, false_positives: 50 }];
      return [];
    });
    const ctx = context(lake);
    const body = (await handler.run(arithmeticQuery.parse({ part: "pattern", pattern: "three_soldiers" }), ctx)) as PatternBody;
    expect(body.areaUnderCurve).toBeNull();
    expect(body.roc).toEqual([]);
    expect(body.groups).toEqual([]);
    expect(body.ruleInWords).toBe("three rising bars");
    expect(ctx.notes.join(" ")).toContain("never fires");
  });

  it("prepends the flag-nothing corner to the ROC and fills every histogram bin", async () => {
    const lake = fakeLake(REQUIRED, (sql) => {
      if (sql.includes("pattern_bar_count, rule_in_words")) return [{ pattern_bar_count: 1, rule_in_words: "small body" }];
      if (sql.includes("ANY_VALUE(t.positives)")) return [{ area_under_curve: 0.98, average_precision: 0.86, positives: 10, negatives: 90 }];
      if (sql.includes("c.false_positives / t.negatives")) return [{ threshold: 0.9, false_positive_rate: 0.01, true_positive_rate: 0.5 }, { threshold: 0.1, false_positive_rate: 1, true_positive_rate: 1 }];
      if (sql.includes("FLOOR(score *")) return [{ bin: 0, positives: 1, negatives: 80 }, { bin: 39, positives: 9, negatives: 1 }];
      return [];
    });
    const body = (await handler.run(arithmeticQuery.parse({ part: "pattern" }), context(lake))) as PatternBody;
    expect(body.roc[0]).toEqual({ threshold: 1, falsePositiveRate: 0, truePositiveRate: 0 });
    expect(body.roc).toHaveLength(3);
    expect(body.histogram).toHaveLength(40);
    expect(body.histogram[39]?.positives).toBe(9);
    expect(body.histogram[5]?.negatives).toBe(0);
    expect(body.windowCount).toBe(100);
  });

  it("parses and bounds the query", () => {
    expect(arithmeticQuery.parse({})).toMatchObject({ part: "overview", tag: "mnq5m", pattern: "doji", groups: 10, bins: 40 });
    expect(() => arithmeticQuery.parse({ pattern: "hammer; DROP" })).toThrow();
    expect(() => arithmeticQuery.parse({ tag: "a'b" })).toThrow();
    expect(() => arithmeticQuery.parse({ groups: 1 })).toThrow();
    expect(() => arithmeticQuery.parse({ bins: 500 })).toThrow();
  });
});

describe("chart-cnn-arithmetic-patterns SQL", () => {
  it("reads the pattern's own score and label columns for one recipe", () => {
    const sql = visibleSql("mnq5m", "evening_star");
    expect(sql).toContain('"network_score_evening_star"');
    expect(sql).toContain('"arithmetic_label_evening_star"');
    expect(sql).toContain("recipe = 'arithmetic_mnq5m'");
  });

  it("quotes the threshold list and the split boundaries as numbers", () => {
    expect(thresholdSql("mnq5m", "doji")).toContain("(0.995)");
    const sql = groupsSql("mnq5m", "doji", 187849, 10);
    // 187,849 = 10 x 18,784 + 9: the first nine groups hold 18,785.
    expect(sql).toContain("position < 169065");
    expect(sql).toContain("position // 18785");
  });

  it("refuses a pattern name that is not a plain identifier", () => {
    expect(() => visibleSql("mnq5m", 'x"; DROP')).toThrow();
  });
});

describe("chart-cnn-arithmetic-patterns shared helpers", () => {
  it("cuts counts the way numpy.array_split does", () => {
    expect(arraySplitSizes(187849, 10)).toEqual([18785, 18785, 18785, 18785, 18785, 18785, 18785, 18785, 18785, 18784]);
    expect(arraySplitSizes(7, 3)).toEqual([3, 2, 2]);
    expect(arraySplitSizes(2, 5)).toEqual([1, 1]);
    const sizes = arraySplitSizes(23, 4);
    const counts = Array.from({ length: 4 }, () => 0);
    for (let index = 0; index < 23; index += 1) counts[arraySplitGroup(index, 23, 4)] += 1;
    expect(counts).toEqual(sizes);
  });

  it("summarises the AUCs: mean, median, count above the cut", () => {
    const rows = [0.9, 0.96, 0.99].map((value, index): PatternScoreRow => ({
      pattern_name: `p${index}`, pattern_bar_count: 1, rule_in_words: "", window_count: 10, positive_window_count: 2,
      prevalence: 0.2, area_under_curve: value, average_precision: 0.5,
    }));
    const headline = recognitionHeadline(rows);
    expect(headline.scoredCount).toBe(3);
    expect(headline.medianAreaUnderCurve).toBeCloseTo(0.96, 12);
    expect(headline.meanAreaUnderCurve).toBeCloseTo((0.9 + 0.96 + 0.99) / 3, 12);
    expect(headline.aboveCutCount).toBe(2);
    expect(recognitionHeadline([]).meanAreaUnderCurve).toBeNull();
  });

  it("computes precision lift and labels", () => {
    expect(precisionLift({ average_precision: 0.236, prevalence: 0.0187 })).toBeCloseTo(12.6, 1);
    expect(precisionLift({ average_precision: 0.5, prevalence: 0 })).toBeNull();
    expect(patternLabel("bull_engulfing")).toBe("bull engulfing");
    expect(PATTERN_NAMES).toHaveLength(17);
  });
});
