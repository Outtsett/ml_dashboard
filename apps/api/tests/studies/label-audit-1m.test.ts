/**
 * The label-audit-1m study (apps/api/studies/handlers/label-audit-1m.ts and
 * packages/shared/src/studies/label-audit-1m.ts): its query schema, a missing lake
 * degrading to notes and an empty body, the body built from a fake lake, and
 * the pure arithmetic (flat dead zone, np.digitize bucketing, the persistence
 * forecast) against independent reimplementations.
 */

import { describe, expect, it } from "vitest";
import handler from "../../studies/handlers/label-audit-1m";
import type { StudyLake } from "../../studies/types";
import {
  bucketCentre, bucketIndex, exponentialForecast, fillBuckets, flatCurve, flatPoint, magnitudeQuantile, majorityBaseline, rSquared, rangeSummary,
  type MagnitudeGroup,
} from "@shared/studies/label-audit-1m";

type Row = Record<string, unknown>;

/** A lake that answers each query by the first rule whose pattern the SQL contains, and records every SQL. */
function fakeLake(views: ReadonlySet<string>, rules: Array<[RegExp, Row[]]>) {
  const seen: string[] = [];
  const lake: StudyLake = {
    async query<T>(sql: string): Promise<T[]> {
      seen.push(sql);
      for (const [pattern, rows] of rules) if (pattern.test(sql)) return rows as T[];
      return [] as T[];
    },
    async hasView(name) {
      return views.has(name);
    },
    async columns() {
      return [];
    },
  };
  return { lake, seen };
}

const RECORD_VIEWS = handler.datasets.filter((name) => name.startsWith("derived_study_label_audit_1m_"));

describe("label-audit-1m query", () => {
  it("defaults to the notebook's pinned parameters", () => {
    expect(handler.query.parse({})).toEqual({
      horizon: 1440, flatThreshold: 0, bucketSize: 2, bucketCount: 21, bins: 120, cutoff: -5, policy: "floored", shiftBars: 7,
    });
  });

  it("refuses a horizon with no stored labels, an off-tick threshold and an even bucket count", () => {
    expect(handler.query.safeParse({ horizon: "7" }).success).toBe(false);
    expect(handler.query.safeParse({ flatThreshold: "0.3" }).success).toBe(false);
    expect(handler.query.safeParse({ bucketSize: "1.1" }).success).toBe(false);
    expect(handler.query.safeParse({ bucketCount: "20" }).success).toBe(false);
    expect(handler.query.safeParse({ policy: "clipped" }).success).toBe(false);
    expect(handler.query.safeParse({ horizon: "60", flatThreshold: "2.75", bucketSize: "1.25", bucketCount: "31" }).success).toBe(true);
  });

  it("lists the stored labels, the bars and every landed record table as its datasets", () => {
    expect(handler.datasets).toContain("mnq_labels_1m");
    expect(handler.datasets).toContain("mnq_ohlcv_1m");
    expect(RECORD_VIEWS).toHaveLength(9);
  });
});

describe("label-audit-1m handler", () => {
  it("answers an empty body with notes when nothing is landed", async () => {
    const { lake, seen } = fakeLake(new Set(), []);
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({}), { lake, notes });
    expect(body.labelsServed).toBe(false);
    expect(body.recordServed).toBe(false);
    expect(body.direction.horizons).toEqual([]);
    expect(body.range.occupancy).toHaveLength(21);
    expect(seen).toHaveLength(0);
    expect(notes.join(" ")).toContain("mnq_labels_1m");
    expect(notes.join(" ")).toContain("derived_study_label_audit_1m_findings");
  });

  it("builds every section from the lake and quotes only allowlisted columns", async () => {
    const views = new Set(handler.datasets);
    const rules: Array<[RegExp, Row[]]> = [
      [/labelled_bar_count\s*,/, [{ lake_bar_count: 2344645, lake_first_timestamp: 1, lake_last_timestamp: 3, labelled_bar_count: 2340445, labelled_first_timestamp: 1, labelled_last_timestamp: 2 }]],
      [/"valid_1440"/, [{ valid_1: 100, up_1: 0.4811, valid_1440: 90, up_1440: 0.5566 }]],
      [/year\(timezone/, [{ year: 2022, valid_bar_count: 10, up_rate: 0.4683 }, { year: 2020, valid_bar_count: 10, up_rate: 0.5967 }]],
      [/AS ticks/, [{ ticks: 0, bar_count: 10, up_count: 0 }, { ticks: 4, bar_count: 30, up_count: 20 }, { ticks: 40, bar_count: 60, up_count: 40 }]],
      [/AS bucket_index/, [{ bucket_index: 10, bar_count: 60 }, { bucket_index: 9, bar_count: 20 }, { bucket_index: 11, bar_count: 20 }]],
      [/quantile_cont\(abs/, [{ q0: 1.75, q1: 3, q2: 7.5, q3: 21.5 }]],
      [/stddev_pop/, [{ count: 100, mean: 1.37, median: 1.45, standard_deviation: 1.74, skewness: -9.2, kurtosis: 115, percentile25: 0.92, percentile75: 2.08, minimum: -20.7, maximum: 6.4 }]],
      [/below_cutoff/, [{ bin: 0, count: 5, lower_edge: -1, upper_edge: 1, middle: 0.2, below_cutoff: 3 }, { bin: 119, count: 7, lower_edge: -1, upper_edge: 1, middle: 0.2, below_cutoff: 3 }]],
      [/AS log_range/, [{ time: 1, log_range: 1.2, zero_range: false }, { time: 2, log_range: -20.7, zero_range: true }]],
      [/honest_maximum/, [{ honest_maximum: 0, leaky_maximum: 1, leaky_mismatch_count: 5, compared_count: 10 }]],
      [/_findings"/, [{ finding_number: 1, finding: "f", evidence: "e", action: "a", status: "applied 2026-08-02" }]],
      [/_provenance"/, [{ audited_bar_count: 2340445, current_loader_bar_count: 646932, current_loader_first_timestamp: "2024-03-01T00:00:00+00:00", built_at: "x" }]],
      [/_barrier_grid"/, [{ vertical_barrier_bars: 60, vertical_timeout_share: 0.0038 }]],
    ];
    const { lake, seen } = fakeLake(views, rules);
    const notes: string[] = [];
    const body = await handler.run(handler.query.parse({ flatThreshold: "1" }), { lake, notes });

    expect(body.labelsServed).toBe(true);
    expect(body.recordServed).toBe(true);
    const horizonOne = body.direction.horizons.find((row) => row.horizon_bars === 1);
    expect(horizonOne?.majority_baseline).toBeCloseTo(0.5189, 6);
    expect(horizonOne?.free_edge_over_coin_flip).toBeCloseTo(0.0189, 6);
    expect(body.direction.years.map((row) => row.majority_baseline)).toEqual([expect.closeTo(0.5317, 6), expect.closeTo(0.5967, 6)]);
    expect(body.direction.flatSelected).toMatchObject({ kept_bar_count: 90, dropped_flat_bar_count: 10 });
    expect(body.direction.flatSelected?.up_rate_among_kept).toBeCloseTo(60 / 90, 9);
    expect(body.direction.flatPinned).toHaveLength(6);
    expect(body.range.summary.centre_share).toBeCloseTo(0.6, 9);
    expect(body.range.summary.empty_bucket_count).toBe(18);
    expect(body.range.suggestedBucketSize).toBeCloseTo(1, 9);
    expect(body.volatility.histogram).toHaveLength(120);
    expect(body.volatility.histogram[0]?.count).toBe(5);
    expect(body.volatility.histogram[119]?.count).toBe(7);
    expect(body.volatility.belowCutoffCount).toBe(3);
    expect(body.volatility.eight?.kurtosis).toBe(115);
    expect(body.shift?.leakyMaximum).toBe(1);
    expect(body.findings[0]?.status).toBe("applied 2026-08-02");
    expect(notes.some((note) => note.includes("646,932"))).toBe(true);

    const everySql = seen.join("\n");
    expect(everySql).toContain('"dir_h1440"');
    expect(everySql).toContain("ln(1e-9)");
    for (const quoted of everySql.match(/"[^"]+"/g) ?? []) expect(quoted).toMatch(/^"[A-Za-z_][A-Za-z0-9_]*"$/);
  });

  it("reads the masked series when asked, without the floor", async () => {
    const { lake, seen } = fakeLake(new Set(handler.datasets), []);
    await handler.run(handler.query.parse({ policy: "masked" }), { lake, notes: [] });
    expect(seen.join("\n")).not.toContain("ln(1e-9)");
  });
});

describe("label-audit-1m arithmetic", () => {
  it("takes the majority class as the free baseline, on either side of one half", () => {
    expect(majorityBaseline(0.4811)).toBeCloseTo(0.5189, 9);
    expect(majorityBaseline(0.5566)).toBeCloseTo(0.5566, 9);
    expect(majorityBaseline(null)).toBeNull();
  });

  it("keeps a bar in the flat dead zone when |delta| >= threshold, as generate_direction_labels does", () => {
    const groups: MagnitudeGroup[] = [
      { ticks: 0, bar_count: 5, up_count: 0 },
      { ticks: 4, bar_count: 10, up_count: 7 },
      { ticks: 8, bar_count: 5, up_count: 1 },
    ];
    expect(flatPoint(groups, 0)).toMatchObject({ kept_bar_count: 20, kept_share: 1, dropped_flat_bar_count: 0 });
    expect(flatPoint(groups, 1)).toMatchObject({ kept_bar_count: 15, dropped_flat_bar_count: 5 });
    expect(flatPoint(groups, 1.25)).toMatchObject({ kept_bar_count: 5 });
    expect(flatPoint(groups, 1)?.up_rate_among_kept).toBeCloseTo(8 / 15, 12);
    const curve = flatCurve(groups, 2, 8);
    expect(curve[0]?.flat_threshold_points).toBe(0);
    expect(curve[curve.length - 1]?.flat_threshold_points).toBe(2);
    for (const point of curve) expect(point.flat_threshold_points / 0.25).toBe(Math.round(point.flat_threshold_points / 0.25));
    expect(magnitudeQuantile(groups, 0.5)).toBe(1);
    expect(magnitudeQuantile(groups, 0.95)).toBe(2);
  });

  it("buckets a delta exactly as np.digitize against the edges between the centres", () => {
    const digitize = (value: number, size: number, countOfBuckets: number) => {
      const centres = Array.from({ length: countOfBuckets }, (_, index) => bucketCentre(index, size, countOfBuckets));
      const edges = centres.slice(0, -1).map((centre, index) => (centre + (centres[index + 1] as number)) / 2);
      return edges.filter((edge) => edge <= value).length;
    };
    for (const size of [0.25, 0.5, 1, 1.25, 2, 3.75]) {
      for (const countOfBuckets of [3, 11, 21]) {
        for (let ticks = -200; ticks <= 200; ticks += 1) {
          expect(bucketIndex(ticks * 0.25, size, countOfBuckets)).toBe(digitize(ticks * 0.25, size, countOfBuckets));
        }
      }
    }
    expect(bucketCentre(10, 2, 21)).toBe(0);
    expect(bucketCentre(0, 2, 21)).toBe(-20);
  });

  it("fills empty buckets and counts the sparse ones", () => {
    const buckets = fillBuckets([{ bucket_index: 1, bar_count: 9990 }, { bucket_index: 2, bar_count: 10 }], 1, 3);
    expect(buckets.map((row) => row.bar_count)).toEqual([0, 9990, 10]);
    const summary = rangeSummary(buckets);
    expect(summary.centre_share).toBeCloseTo(0.999, 9);
    expect(summary.chance_share).toBeCloseTo(1 / 3, 9);
    expect(summary.sparse_bucket_count).toBe(1);
    expect(summary.empty_bucket_count).toBe(1);
  });

  it("carries the persistence forecast across a missing bar and scores it with R squared", () => {
    const forecast = exponentialForecast([2, Number.NaN, 4], 0.5);
    expect(forecast).toEqual([2, 2, 3]);
    expect(rSquared([1, 2, 3], [1, 2, 3])).toBe(1);
    expect(rSquared([1, 2, 3], [2, 2, 2])).toBe(0);
  });
});
