/**
 * The chart-CNN study handler on a fake lake: the empty state when the round
 * is not landed, the overview's projection shaping, a pattern TA-Lib never
 * fires, the ROC's (0, 0) corner, the query schema, and the numpy.array_split
 * arithmetic the score groups reproduce.
 */

import { describe, expect, it } from "vitest";
import handler, { chartCnnQuery, examplesSql, groupsSql, visibleSql } from "../../studies/handlers/chart-cnn-pattern-recognition";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  CHART_CNN_VIEWS, PATTERN_NAMES, arraySplitGroup, correlationRatio, recognitionHeadline, shortPatternName,
  type OverviewBody, type PatternBody, type PatternScoreRow,
} from "@shared/studies/chart-cnn-pattern-recognition";

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

const ALL_VIEWS = Object.values(CHART_CNN_VIEWS);

describe("chart-cnn-pattern-recognition handler", () => {
  it("names every view it reads", () => {
    expect(handler.slug).toBe("chart-cnn-pattern-recognition");
    expect(handler.datasets).toEqual(ALL_VIEWS);
  });

  it("returns an empty overview with a note when the round is not landed", async () => {
    const ctx = context(fakeLake([], () => []));
    const body = (await handler.run(chartCnnQuery.parse({}), ctx)) as OverviewBody;
    expect(body.part).toBe("overview");
    expect(body.patterns).toEqual([]);
    expect(body.projection).toBeNull();
    expect(body.windowSample.rows).toEqual([]);
    expect(ctx.notes[0]).toContain(CHART_CNN_VIEWS.patternScores);
  });

  it("shapes the overview: projection targets ordered by frequency rank, indexes into that list", async () => {
    const lake = fakeLake(ALL_VIEWS, (sql) => {
      if (sql.includes(CHART_CNN_VIEWS.patternScores)) {
        return [{ pattern_name: "CDLDOJI", pattern_bar_count: 1, visible_window_count: 10, positive_window_count: 3, area_under_curve: 0.99, average_precision: 0.9, prevalence: 0.3 }];
      }
      if (sql.includes("ARG_MIN")) return [{ window_count: 126624, first_window_time: "2024-01-01 10:20:00-05:00", last_window_time: "2025-12-30 10:55:00-05:00" }];
      if (sql.includes(CHART_CNN_VIEWS.embeddingProjection)) {
        return [
          { window_id: 5, target_pattern: "CDLHAMMER", target_frequency_rank: 2, pattern_sign: 1, window_bar_count: 1, principal_component_1: 0.5, principal_component_2: -0.25 },
          { window_id: 9, target_pattern: "CDLDOJI", target_frequency_rank: 1, pattern_sign: 0, window_bar_count: 1, principal_component_1: -1, principal_component_2: 2 },
        ];
      }
      if (sql.includes(CHART_CNN_VIEWS.embeddingComponents)) {
        return [
          { component_number: 1, explained_variance_ratio: 0.2, embedding_dimension_count: 256 },
          { component_number: 2, explained_variance_ratio: 0.12, embedding_dimension_count: 256 },
        ];
      }
      if (sql.includes("GROUP BY target_pattern")) return [{ value: "CDLDOJI", window_count: 7 }];
      if (sql.includes("HASH(window_id)")) return [{ window_id: 4, target_pattern: "CDLDOJI", bar_1_open: 100.25 }];
      return [];
    });
    const body = (await handler.run(chartCnnQuery.parse({ part: "overview" }), context(lake))) as OverviewBody;
    expect(body.windowCount).toBe(126624);
    expect(body.firstWindowTime).toBe("2024-01-01 10:20:00-05:00");
    expect(body.projection?.targets).toEqual(["CDLDOJI", "CDLHAMMER"]);
    expect(body.projection?.target).toEqual([1, 0]);
    expect(body.projection?.explainedVarianceRatio).toEqual([0.2, 0.12]);
    expect(body.projection?.embeddingDimensionCount).toBe(256);
    expect(body.targetCounts).toEqual([{ value: "CDLDOJI", window_count: 7 }]);
    expect(body.windowSample).toEqual({ columns: ["window_id", "target_pattern", "bar_1_open"], rows: [[4, "CDLDOJI", 100.25]] });
  });

  it("explains a pattern TA-Lib never fires instead of drawing a ROC for it", async () => {
    const lake = fakeLake(ALL_VIEWS, (sql) => {
      if (sql.includes("SELECT pattern_bar_count")) return [{ pattern_bar_count: 2 }];
      if (sql.includes("area_under_curve")) return [{ area_under_curve: null, average_precision: null, positives: 0, negatives: 58277 }];
      if (sql.includes("score_group")) return [{ score_group: 1, window_count: 5828, positive_fraction: 0, lowest_score: 0, highest_score: 0.001 }];
      if (sql.includes("label = 0")) return [{ window_id: 3, score: 0.18, window_time_new_york: "2024-02-01 09:35:00-05:00", target_pattern: "CDLHARAMI", window_bar_count: 2 }];
      return [];
    });
    const ctx = context(lake);
    const body = (await handler.run(chartCnnQuery.parse({ part: "pattern", pattern: "CDLKICKING" }), ctx)) as PatternBody;
    expect(body.positiveWindowCount).toBe(0);
    expect(body.visibleWindowCount).toBe(58277);
    expect(body.areaUnderCurve).toBeNull();
    expect(body.roc).toEqual([]);
    expect(body.truePositives).toEqual([]);
    expect(body.falsePositives[0]?.score).toBe(0.18);
    expect(body.falsePositives[0]?.bars).toHaveLength(5);
    expect(body.histogram).toHaveLength(40);
    expect(ctx.notes[0]).toContain("never fires CDLKICKING");
  });

  it("starts the ROC at the (0, 0) corner and keeps AUC and average precision", async () => {
    const lake = fakeLake(ALL_VIEWS, (sql) => {
      if (sql.includes("SELECT pattern_bar_count")) return [{ pattern_bar_count: 2 }];
      if (sql.includes("false_positive_rate")) return [{ threshold: 0.9, false_positive_rate: 0.01, true_positive_rate: 0.8 }, { threshold: 0, false_positive_rate: 1, true_positive_rate: 1 }];
      if (sql.includes("area_under_curve")) return [{ area_under_curve: 0.995, average_precision: 0.965, positives: 7479, negatives: 50798 }];
      return [];
    });
    const body = (await handler.run(chartCnnQuery.parse({ part: "pattern" }), context(lake))) as PatternBody;
    expect(body.pattern).toBe("CDLENGULFING");
    expect(body.roc[0]).toEqual({ threshold: 1, falsePositiveRate: 0, truePositiveRate: 0 });
    expect(body.roc).toHaveLength(3);
    expect(body.areaUnderCurve).toBe(0.995);
    expect(body.averagePrecision).toBe(0.965);
  });

  it("accepts only the 61 pattern names and bounded numbers", () => {
    expect(PATTERN_NAMES).toHaveLength(61);
    expect(() => chartCnnQuery.parse({ pattern: "constructor" })).toThrow();
    expect(() => chartCnnQuery.parse({ pattern: "CDLDOJI; DROP" })).toThrow();
    expect(() => chartCnnQuery.parse({ groups: "500" })).toThrow();
    expect(chartCnnQuery.parse({ groups: "12", bins: "20" })).toMatchObject({ groups: 12, bins: 20, part: "overview" });
  });

  it("quotes the per-pattern columns and filters windows by the bars the pattern needs", () => {
    const sql = visibleSql("CDLENGULFING", 2);
    expect(sql).toContain('"network_score_cdlengulfing"');
    expect(sql).toContain('"talib_fires_cdlengulfing"');
    expect(sql).toContain("window_bar_count >= 2");
    expect(examplesSql("CDLDOJI", 1, "misses", 8)).toContain("ORDER BY score ASC");
  });
});

describe("numpy.array_split arithmetic", () => {
  it("puts one extra item in each of the first count % groups groups", () => {
    const count = 23;
    const groups = 10;
    const sizes = new Array(groups).fill(0);
    for (let index = 0; index < count; index += 1) sizes[arraySplitGroup(index, count, groups)] += 1;
    expect(sizes).toEqual([3, 3, 3, 2, 2, 2, 2, 2, 2, 2]);
  });

  it("writes the same boundary into the groups SQL", () => {
    const sql = groupsSql("CDLENGULFING", 2, 58277, 10);
    // 58,277 = 10 x 5,827 + 7: seven groups of 5,828 then three of 5,827.
    expect(sql).toContain("position < 40796 THEN position // 5828");
    expect(sql).toContain("7 + (position - 40796) // 5827");
  });
});

describe("correlation ratio", () => {
  it("is 1 when groups separate the values completely and 0 when they share a mean", () => {
    expect(correlationRatio([1, 1, 5, 5], ["a", "a", "b", "b"])).toBe(1);
    expect(correlationRatio([1, 5, 1, 5], ["a", "a", "b", "b"])).toBe(0);
    expect(correlationRatio([2, 2], [1, 2])).toBeNull();
  });
});

describe("headline", () => {
  it("counts only finite AUCs, as the notebook's nanmean does", () => {
    const rows: PatternScoreRow[] = [0.99, 0.97, 0.9, null].map((auc, index) => ({
      pattern_name: `P${index}`, pattern_bar_count: 1, visible_window_count: 10, positive_window_count: auc === null ? 0 : 1,
      area_under_curve: auc, average_precision: auc, prevalence: 0.1,
    }));
    const headline = recognitionHeadline(rows);
    expect(headline.scoredCount).toBe(3);
    expect(headline.unscoredCount).toBe(1);
    expect(headline.aboveCutCount).toBe(2);
    expect(headline.medianAreaUnderCurve).toBe(0.97);
    expect(headline.meanAreaUnderCurve).toBeCloseTo((0.99 + 0.97 + 0.9) / 3, 12);
    expect(shortPatternName("CDLDOJI")).toBe("DOJI");
  });
});
