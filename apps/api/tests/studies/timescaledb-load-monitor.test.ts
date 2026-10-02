/**
 * The timescaledb-load-monitor study: the handler on a fake lake (missing
 * views degrade to a note, the SQL it writes filters by the newest recipe and
 * computes the marginal with LAG, facts become a name-to-value map), and the
 * pure compute the page and handler share.
 */

import { describe, expect, it } from "vitest";
import handler, { batchesSql, factsSql, newestRecipeSql } from "../../studies/handlers/timescaledb-load-monitor";
import type { StudyLake } from "../../studies/types";
import {
  loadProgress, marginalWithinWindow, meanAndDeviation, projectedGigabytes, throughputFit, windowBatches,
  type BatchRow,
} from "@shared/studies/timescaledb-load-monitor";

function batch(batchNumber: number, rowsInMonth: number, seconds: number, bytes: number, rows: number): BatchRow {
  return {
    batch_number: batchNumber,
    recorded_at_epoch_milliseconds: 1_789_219_861_644 + batchNumber * 10_000,
    month_start_epoch_milliseconds: Date.UTC(2010, 5 + batchNumber - 1, 1),
    asset_class: "futures",
    timeframe: "1s",
    lake_row_count: rowsInMonth,
    elapsed_seconds: seconds,
    rows_per_second: rowsInMonth / seconds,
    hypertable_bytes: bytes,
    hypertable_row_count: rows,
    bytes_per_row: bytes / rows,
    marginal_bytes_per_row: null,
  };
}

// Batches whose seconds are exactly 2 + 3e-6 * rows, each adding exactly 160 bytes per row.
const SERIES: BatchRow[] = (() => {
  const monthRows = [1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000];
  let rows = 100_000_000;
  let bytes = 15_000_000_000;
  return monthRows.map((monthRowCount, index) => {
    rows += monthRowCount;
    bytes += monthRowCount * 160;
    return batch(index + 1, monthRowCount, 2 + 3e-6 * monthRowCount, bytes, rows);
  });
})();

function lakeWith(views: string[], responses: { recipe?: string; batches?: BatchRow[]; facts?: Array<{ fact: string; value: number }> }): { lake: StudyLake; sql: string[] } {
  const sql: string[] = [];
  const lake: StudyLake = {
    async query<T>(text: string): Promise<T[]> {
      sql.push(text);
      if (text.includes("GROUP BY recipe")) return (responses.recipe ? [{ recipe: responses.recipe }] : []) as T[];
      if (text.includes("LAG(")) return (responses.batches ?? []) as T[];
      return (responses.facts ?? []) as T[];
    },
    async hasView(name) {
      return views.includes(name);
    },
    async columns() {
      return [];
    },
  };
  return { lake, sql };
}

const VIEWS = ["derived_study_timescaledb_load_monitor_batches", "derived_study_timescaledb_load_monitor_load_facts"];

describe("timescaledb-load-monitor handler", () => {
  it("returns an empty body and a note when the log is not landed", async () => {
    const { lake } = lakeWith([], {});
    const notes: string[] = [];
    const body = await handler.run({}, { lake, notes });
    expect(body).toEqual({ batches: [], facts: {}, recipe: null });
    expect(notes.join(" ")).toContain("Not in the lake yet");
  });

  it("reads the newest recipe, filters both tables by it and maps facts by name", async () => {
    const { lake, sql } = lakeWith(VIEWS, {
      recipe: "measured_2026_09_12",
      batches: SERIES,
      facts: [{ fact: "lake_total_row_count", value: 785_766_203 }, { fact: "forex_proven_bytes_per_row", value: 125.3 }],
    });
    const notes: string[] = [];
    const body = await handler.run({}, { lake, notes });
    expect(body.recipe).toBe("measured_2026_09_12");
    expect(body.batches).toHaveLength(5);
    expect(body.facts).toEqual({ lake_total_row_count: 785_766_203, forex_proven_bytes_per_row: 125.3 });
    expect(sql.filter((text) => text.includes("recipe = 'measured_2026_09_12'"))).toHaveLength(2);
    expect(notes.join(" ")).toContain("PostgreSQL");
  });

  it("writes SQL with LAG for the marginal, never max(recipe), and quotes the recipe", () => {
    expect(newestRecipeSql("derived_study_timescaledb_load_monitor_batches")).not.toMatch(/max\(/i);
    const batches = batchesSql("o'brien");
    expect(batches).toContain("LAG(hypertable_bytes) OVER (ORDER BY batch_number)");
    expect(batches).toContain("recipe = 'o''brien'");
    expect(factsSql("x")).toContain('"derived_study_timescaledb_load_monitor_load_facts"');
  });
});

describe("load monitor compute", () => {
  it("windows by batch number, inclusive", () => {
    expect(windowBatches(SERIES, 2, 4).map((row) => row.batch_number)).toEqual([2, 3, 4]);
  });

  it("marginal bytes per row within a window drops the window's first batch and recovers 160", () => {
    const marginal = marginalWithinWindow(windowBatches(SERIES, 2, 5));
    expect(marginal.map((row) => row.batch_number)).toEqual([3, 4, 5]);
    for (const row of marginal) expect(row.marginal_bytes_per_row).toBeCloseTo(160, 9);
  });

  it("cumulative bytes per row sits between the starting density and the marginal", () => {
    const last = SERIES[SERIES.length - 1] as BatchRow;
    expect(last.bytes_per_row).toBeGreaterThan(150);
    expect(last.bytes_per_row).toBeLessThan(160);
  });

  it("progress comes from the last batch: completion, remaining, bytes per row, mean rate, eta", () => {
    const last = SERIES[SERIES.length - 1] as BatchRow;
    const progress = loadProgress(SERIES, last.hypertable_row_count + 6_000_000);
    expect(progress.servingRows).toBe(last.hypertable_row_count);
    expect(progress.remainingRows).toBe(6_000_000);
    expect(progress.bytesPerRow).toBeCloseTo(last.hypertable_bytes / last.hypertable_row_count, 12);
    expect(progress.measuredMonths).toBe(5);
    const meanRate = SERIES.reduce((sum, row) => sum + row.rows_per_second, 0) / 5;
    expect(progress.meanRowsPerSecond).toBeCloseTo(meanRate, 6);
    expect(progress.etaMinutes).toBeCloseTo(6_000_000 / meanRate / 60, 9);
    expect(loadProgress(SERIES, last.hypertable_row_count).remainingRows).toBe(0);
    expect(loadProgress([], 100)).toMatchObject({ servingRows: 0, completePercent: 0, etaMinutes: 0 });
  });

  it("projects the full table in decimal gigabytes", () => {
    expect(projectedGigabytes(785_766_203, 824)).toBeCloseTo(647.49, 1);
  });

  it("mean and sample deviation, null when too few", () => {
    expect(meanAndDeviation([1, 2, 3, 4])).toMatchObject({ mean: 2.5, count: 4 });
    expect(meanAndDeviation([1, 2, 3, 4]).deviation).toBeCloseTo(1.2909944487358056, 12);
    expect(meanAndDeviation([5]).deviation).toBeNull();
    expect(meanAndDeviation([]).mean).toBeNull();
  });

  it("fits seconds on rows exactly when they are linear, and names the slowest month", () => {
    const series = SERIES.map((row, index) => (index === 2 ? { ...row, elapsed_seconds: row.elapsed_seconds + 9 } : row));
    const exact = throughputFit(SERIES);
    expect(exact?.fit.slope).toBeCloseTo(3e-6, 15);
    expect(exact?.fit.intercept).toBeCloseTo(2, 9);
    expect(exact?.fit.rSquared).toBeCloseTo(1, 12);
    const stalled = throughputFit(series);
    expect(stalled?.slowest[0]?.batch_number).toBe(3);
    expect(throughputFit(SERIES.slice(0, 3))).toBeNull();
  });
});
