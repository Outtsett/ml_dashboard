/**
 * The market-bars-validation study: the handler against a fake StudyLake (its
 * latest-per-check query, the missing-view degrade, the coherence note) and the
 * pure compute the page shares (packages/shared/src/studies/market-bars-validation.ts).
 */

import { describe, expect, it } from "vitest";
import handler, { LATEST_PER_CHECK_SQL } from "../../studies/handlers/market-bars-validation";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  EMPTY_BODY, computeCoverage, computeDistribution, computeFill, computeKpis, computeSums, computeTiers, nonNullBySlice,
  parseNumber, relativeDifference, sliceOf, sliceRowTotal, summarise,
  type CheckRow, type MeasurementRow,
} from "@shared/studies/market-bars-validation";

const STAMP = Date.UTC(2026, 8, 12, 21, 0, 0);

function check(tier: string, column_name: string, check_name: string, lake_value: string | null, postgres_value: string | null, matched = true, recorded_timestamp = STAMP): CheckRow {
  return { tier, column_name, check_name, lake_value, postgres_value, matched, recorded_timestamp };
}

const TABLE_COLUMNS = ["timestamp", "symbol", "open", "trade_count"];

const CHECKS: CheckRow[] = [
  check("exact", "*", "row_count [futures 1s]", "700", "700"),
  check("exact", "*", "row_count [forex 1m]", "300", "300"),
  check("exact", "open", "non_null [futures 1s]", "700", "700"),
  check("exact", "open", "non_null [forex 1m]", "300", "300"),
  check("exact", "trade_count", "non_null [futures 1s]", "0", "0"),
  check("exact", "trade_count", "non_null [forex 1m]", "0", "0"),
  check("exact", "symbol", "distinct set (identical set)", "9 values", "9 values"),
  check("sum", "open", "sum [futures 1s]", "8294216554050.838", "8294216554051.328"),
  check("sum", "open", "sum [forex 1m]", "2202814950.4893723", "2202814950.4893723"),
  check("sum", "trade_count", "sum [forex 1m]", "None", "None"),
  check("fingerprint", "open", "bit_xor of IEEE-754 bits [futures 1s]", "4634399743830843431", "4634399743830843431"),
  check("invariant", "high_below_low", "the bar's range is inverted", "0", "0"),
  check("invariant", "negative_volume", "traded volume cannot be negative", "3", "0", false),
  check("distribution", "open", "count", "1000.0", null),
  check("distribution", "open", "mean", "10.5", null),
  check("distribution", "open", "maximum", "99", null),
  check("distribution", "trade_count", "count", "0.0", null),
  check("distribution", "trade_count", "mean", "None", null),
];

const MEASUREMENT: MeasurementRow = {
  lake_row_count: 1000,
  comparison_target: "PostgreSQL / TimescaleDB market_bars hypertable",
  validator_script: "validate.py",
  recorded_check_count: 20,
  latest_check_count: CHECKS.length,
  tier_count: 5,
  table_column_count: 4,
  first_recorded_timestamp: STAMP,
  last_recorded_timestamp: STAMP,
};

function fakeLake(options: { views?: string[]; checks?: CheckRow[]; measurement?: MeasurementRow | null; recorded?: number } = {}) {
  const views = new Set(options.views ?? [
    "derived_study_market_bars_validation_checks",
    "derived_study_market_bars_validation_measurement",
    "derived_study_market_bars_validation_table_columns",
  ]);
  const statements: string[] = [];
  const lake: StudyLake = {
    async query<T>(sql: string): Promise<T[]> {
      statements.push(sql);
      if (sql === LATEST_PER_CHECK_SQL) return (options.checks ?? CHECKS) as T[];
      if (sql.includes("count(*) AS recorded")) return [{ recorded: options.recorded ?? 20 }] as T[];
      if (sql.includes("_measurement")) return (options.measurement === null ? [] : [options.measurement ?? MEASUREMENT]) as T[];
      if (sql.includes("_table_columns")) return TABLE_COLUMNS.map((column_name, index) => ({ column_position: index + 1, column_name })) as T[];
      throw new Error(`unexpected SQL: ${sql}`);
    },
    async hasView(name) {
      return views.has(name);
    },
    async columns() {
      return [];
    },
  };
  return { lake, statements };
}

function context(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

describe("market-bars-validation handler", () => {
  it("keeps the most recent result per (tier, column, check), not per run", () => {
    expect(LATEST_PER_CHECK_SQL).toContain("PARTITION BY tier, column_name, check_name");
    expect(LATEST_PER_CHECK_SQL).toContain("ORDER BY recorded_timestamp DESC");
    expect(LATEST_PER_CHECK_SQL).toContain("recency = 1");
  });

  it("reads three landed views and summarises them", async () => {
    const { lake, statements } = fakeLake();
    const ctx = context(lake);
    const body = await handler.run({}, ctx);
    expect(statements).toHaveLength(4);
    expect(body.available).toBe(true);
    expect(body.checks).toHaveLength(CHECKS.length);
    expect(body.supersededCount).toBe(20 - CHECKS.length);
    expect(body.lakeRowCount).toBe(1000);
    expect(body.lakeRowCountFromSlices).toBe(1000);
    expect(body.kpis.failedCount).toBe(1);
    expect(ctx.notes).toEqual([]);
  });

  it("returns the empty body with a note when a view is not landed", async () => {
    const { lake } = fakeLake({ views: ["derived_study_market_bars_validation_checks"] });
    const ctx = context(lake);
    const body = await handler.run({}, ctx);
    expect(body).toEqual(EMPTY_BODY);
    expect(ctx.notes[0]).toContain("derived_study_market_bars_validation_measurement");
  });

  it("notes when the denominator differs from the slice row counts", async () => {
    const { lake } = fakeLake({ measurement: { ...MEASUREMENT, lake_row_count: 999 } });
    const ctx = context(lake);
    const body = await handler.run({}, ctx);
    expect(body.lakeRowCount).toBe(999);
    expect(ctx.notes[0]).toContain("differs from the sum");
  });

  it("lists every view it reads as a dataset", () => {
    expect(handler.datasets).toHaveLength(3);
    expect(handler.slug).toBe("market-bars-validation");
  });
});

describe("market-bars-validation compute", () => {
  it("parses the validator's None as no number", () => {
    expect(parseNumber("None")).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("785766203")).toBe(785766203);
  });

  it("reads the slice out of a check name", () => {
    expect(sliceOf("sum [futures 1s]")).toBe("futures 1s");
    expect(sliceOf("row_count")).toBe("");
  });

  it("measures the relative difference on the validator's scale, never below 1", () => {
    expect(relativeDifference(100, 100)).toBe(0);
    expect(relativeDifference(2e12, 2e12 + 1)).toBeCloseTo(5e-13, 15);
    expect(relativeDifference(0.25, 0.75)).toBe(0.5);
  });

  it("counts covered columns against the real ones, not the invariant rule names", () => {
    const kpis = computeKpis(CHECKS, TABLE_COLUMNS);
    expect(kpis.columnsCovered).toBe(3);
    expect(kpis.uncoveredColumns).toEqual(["timestamp"]);
    expect(kpis.tierCount).toBe(5);
    expect(kpis.passedCount + kpis.failedCount).toBe(CHECKS.length);
  });

  it("totals passed and failed by tier, largest first", () => {
    const tiers = computeTiers(CHECKS);
    expect(tiers[0]?.tier).toBe("exact");
    expect(tiers.find((entry) => entry.tier === "invariant")).toMatchObject({ passed: 1, failed: 1, total: 2 });
  });

  it("builds coverage only for real columns", () => {
    const cells = computeCoverage(CHECKS, TABLE_COLUMNS);
    expect(cells.some((cell) => cell.column === "high_below_low")).toBe(false);
    expect(cells.find((cell) => cell.column === "open" && cell.tier === "sum")?.checkCount).toBe(2);
  });

  it("sums non-null counts over slices and divides by the lake rows", () => {
    const fill = computeFill(CHECKS, 1000);
    expect(fill.find((entry) => entry.column === "open")).toMatchObject({ nonNullRows: 1000, fillPercent: 100, sliceCount: 2 });
    expect(fill.find((entry) => entry.column === "trade_count")).toMatchObject({ nonNullRows: 0, fillPercent: 0 });
    expect(fill.map((entry) => entry.column)).not.toContain("*");
  });

  it("rounds the fill percent to four decimals", () => {
    const fill = computeFill([check("exact", "bid_open", "non_null [forex 1m]", "5191528", "5191528")], 785_766_203);
    expect(fill[0]?.fillPercent).toBeCloseTo(0.6607, 4);
  });

  it("rebuilds the lake row count from the slice counts", () => {
    expect(sliceRowTotal(CHECKS)).toBe(1000);
    expect(sliceRowTotal([])).toBeNull();
  });

  it("pivots the distribution tier to numbers and leaves absent ones null", () => {
    const rows = computeDistribution(CHECKS);
    expect(rows.find((row) => row.column === "open")?.statistics).toMatchObject({ count: 1000, mean: 10.5, maximum: 99, skewness: null });
    expect(rows.find((row) => row.column === "trade_count")?.statistics.mean).toBeNull();
  });

  it("measures each sum's relative difference and skips empty columns", () => {
    const sums = computeSums(CHECKS);
    expect(sums).toHaveLength(2);
    expect(sums[0]?.slice).toBe("futures 1s");
    expect(Math.abs((sums[0]?.relativeDifference ?? 0) - 0.49 / 8294216554051.328) / (0.49 / 8294216554051.328)).toBeLessThan(1e-3);
    expect(sums[1]?.relativeDifference).toBe(0);
  });

  it("lists one column's non-null count in each slice", () => {
    expect(nonNullBySlice(CHECKS, "open")).toEqual([
      { slice: "forex 1m", nonNullRows: 300 },
      { slice: "futures 1s", nonNullRows: 700 },
    ]);
  });

  it("summarises a record into the page body", () => {
    const body = summarise(CHECKS, TABLE_COLUMNS, MEASUREMENT, 2);
    expect(body.invariants).toHaveLength(2);
    expect(body.invariants.find((row) => !row.sidesAgree)?.invariant).toBe("negative_volume");
    expect(body.fingerprints).toHaveLength(1);
    expect(body.fingerprints[0]?.lakeBits).toBe("4634399743830843431");
    expect(body.supersededCount).toBe(2);
  });
});
