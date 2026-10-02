/**
 * Lake audit study: the handler on a fake StudyLake (no DuckDB) and the pure
 * compute it shares with the page (packages/shared/src/studies/lake-audit.ts).
 */

import { describe, expect, it } from "vitest";
import handler from "../../studies/handlers/lake-audit";
import type { StudyContext, StudyLake } from "../../studies/types";
import {
  differenceBetweenRuns, fractionalYear, isClean, orderChecks, partitionLabel, sharePercent, stalenessBand, verdict,
  type AuditCheck, type AuditRun, type CheckHistoryPoint,
} from "@shared/studies/lake-audit";

const PREFIX = "derived_study_lake_audit_";
const ALL_VIEWS = ["runs", "checks", "check_partitions", "coverage", "duplicate_partitions", "remediation_partitions"].map((name) => PREFIX + name);

function run(recipe: string, at: number, errors: number): AuditRun {
  return {
    recipe, table_name: "market.bars", generated_at: at, snapshot_id: "6786228328517026624", row_count: 1_000_000, partition_count: 10,
    error_row_count: errors, warning_row_count: 0, droppable_row_count: errors, duplicate_key_row_count: 0, row_pass_seconds: 40.5,
    duplicate_pass_seconds: 600, unique_key: "ts, symbol, timeframe", check_count: 2, scope_predicate: null, has_remediation: errors > 0,
    remediation_generated_at: null, remediation_dry_run: errors > 0 ? true : null, remediation_partitions_planned: errors > 0 ? 2 : null,
    remediation_partitions_rewritten: null, remediation_partitions_skipped: null, remediation_rows_removed: errors > 0 ? errors : null,
    source_report: `s3://meta/audits/${recipe}.json`,
  };
}

const RUNS = [run("market_bars_20260910T153515", 1_000, 500), run("market_bars_20260910T170145", 2_000, 0)];

function check(name: string, violations: number, severity: "error" | "warning" = "error", remediation: "drop_row" | "review" = "drop_row"): AuditCheck {
  return { check_name: name, severity, remediation, description: `${name} description`, predicate: "high < low", violation_row_count: violations, violation_share_of_table: violations / 1_000_000, affected_partition_count: violations > 0 ? 2 : 0 };
}

interface Seen { sql: string[] }

function fakeLake(seen: Seen, options: { views?: string[]; unlandedFiles?: number; throwGlob?: boolean; runs?: AuditRun[] } = {}): StudyLake {
  const views = new Set(options.views ?? ALL_VIEWS);
  const runs = options.runs ?? RUNS;
  return {
    async hasView(name) {
      return views.has(name);
    },
    async columns() {
      return [];
    },
    async query<T>(sql: string): Promise<T[]> {
      seen.sql.push(sql);
      if (sql.includes("glob(")) {
        if (options.throwGlob) throw new Error("no s3");
        return [{ report_count: options.unlandedFiles ?? runs.length }] as T[];
      }
      if (sql.includes("GROUP BY table_name")) return [{ table_name: "market.bars", run_count: runs.length }] as T[];
      if (sql.includes(`FROM "${PREFIX}runs" WHERE`)) return runs as T[];
      if (sql.includes(`FROM "${PREFIX}checks" c JOIN`)) return [{ recipe: "a", check_name: "x", violation_row_count: 1 }] as T[];
      if (sql.includes(`FROM "${PREFIX}checks"`)) return [check("non_positive_price", 500), check("high_below_low", 0)] as T[];
      if (sql.includes(`FROM "${PREFIX}check_partitions"`)) return [{ check_name: "non_positive_price", asset_class: "spread", root: "ES", timeframe: "1s", partition_start_timestamp: 1_577_836_800_000, violation_row_count: 500 }] as T[];
      if (sql.includes(`FROM "${PREFIX}coverage"`)) return [{ asset_class: "futures", timeframe: "1s", row_count: 9, symbol_count: 3, first_timestamp: 1, last_timestamp: 2, hours_since_last_row: 6090 }] as T[];
      return [] as T[];
    },
  };
}

async function runHandler(lake: StudyLake, raw: Record<string, string> = {}) {
  const context: StudyContext = { lake, notes: [] };
  const body = await handler.run(handler.query.parse(raw), context);
  return { body, notes: context.notes };
}

describe("lake-audit handler", () => {
  it("reads the six landed tables and selects the newest run by default", async () => {
    const seen: Seen = { sql: [] };
    const { body, notes } = await runHandler(fakeLake(seen));
    expect(body.table).toBe("market.bars");
    expect(body.tables).toEqual(["market.bars"]);
    expect(body.runs).toHaveLength(2);
    expect(body.selected?.recipe).toBe("market_bars_20260910T170145");
    expect(body.checks.map((c) => c.check_name)).toEqual(["non_positive_price", "high_below_low"]);
    expect(body.checkPartitions).toHaveLength(1);
    expect(body.coverage[0]?.hours_since_last_row).toBe(6090);
    expect(notes).toEqual([]);
    // Every read is scoped to the selected run by a quoted literal.
    expect(seen.sql.some((sql) => sql.includes("recipe = 'market_bars_20260910T170145'"))).toBe(true);
  });

  it("shows an older run when its recipe is asked for, and says so when the recipe is unknown", async () => {
    const seen: Seen = { sql: [] };
    const older = await runHandler(fakeLake(seen), { run: "market_bars_20260910T153515" });
    expect(older.body.selected?.recipe).toBe("market_bars_20260910T153515");
    expect(seen.sql.some((sql) => sql.includes("recipe = 'market_bars_20260910T153515'"))).toBe(true);

    const unknown = await runHandler(fakeLake({ sql: [] }), { run: "nope_20200101T000000" });
    expect(unknown.body.selected?.recipe).toBe("market_bars_20260910T170145");
    expect(unknown.notes.join(" ")).toContain("nope_20200101T000000");
  });

  it("falls back to a table that has a report and names the substitution", async () => {
    const { body, notes } = await runHandler(fakeLake({ sql: [] }), { table: "market.ticks" });
    expect(body.table).toBe("market.bars");
    expect(notes.join(" ")).toContain("market.ticks");
  });

  it("refuses run and table names that are not plain identifiers before any SQL is built", () => {
    expect(() => handler.query.parse({ run: "x'; DROP TABLE t; --" })).toThrow();
    expect(() => handler.query.parse({ table: "a b" })).toThrow();
    expect(() => handler.query.parse({ run: "market_bars_20260910T170145", table: "market.bars" })).not.toThrow();
  });

  it("degrades to an empty body and a note when a view is not landed", async () => {
    const { body, notes } = await runHandler(fakeLake({ sql: [] }, { views: [PREFIX + "runs"] }));
    expect(body.selected).toBeNull();
    expect(body.runs).toEqual([]);
    expect(notes.join(" ")).toContain("derived_study_lake_audit_checks");
  });

  it("notes audit reports that are in s3://meta/audits but not landed", async () => {
    const { body, notes } = await runHandler(fakeLake({ sql: [] }, { unlandedFiles: 3 }));
    expect(body.unlandedReportCount).toBe(1);
    expect(notes.join(" ")).toContain("build.py");
  });

  it("does not fail when the audits folder cannot be listed", async () => {
    const { body, notes } = await runHandler(fakeLake({ sql: [] }, { throwGlob: true }));
    expect(body.unlandedReportCount).toBeNull();
    expect(body.selected).not.toBeNull();
    expect(notes).toEqual([]);
  });

  it("lists every view it reads as its datasets", () => {
    expect(handler.datasets).toEqual(ALL_VIEWS);
  });
});

describe("lake-audit compute", () => {
  it("calls a run clean only with no error rows and no duplicate keys, and words the verdict", () => {
    expect(isClean({ error_row_count: 0, duplicate_key_row_count: 0 })).toBe(true);
    expect(isClean({ error_row_count: 1, duplicate_key_row_count: 0 })).toBe(false);
    expect(isClean({ error_row_count: 0, duplicate_key_row_count: 2 })).toBe(false);
    expect(verdict({ error_row_count: 0, duplicate_key_row_count: 0 })).toBe("Every check passed.");
    expect(verdict({ error_row_count: 4_012_524, duplicate_key_row_count: 0 })).toBe("4,012,524 rows fail an error-severity check.");
    expect(verdict({ error_row_count: 0, duplicate_key_row_count: 7 })).toBe("7 rows share a uniqueness key.");
  });

  it("rounds the share to six places in percent, as the notebook did", () => {
    expect(sharePercent({ violation_share_of_table: 0.00510651130664626 })).toBe(0.510651);
    expect(sharePercent({ violation_share_of_table: 0 })).toBe(0);
  });

  it("orders checks by violations (ties by name), name or severity", () => {
    const checks = [check("b", 5), check("a", 5), check("w", 9, "warning", "review"), check("z", 0)];
    expect(orderChecks(checks, "violations").map((c) => c.check_name)).toEqual(["w", "a", "b", "z"]);
    expect(orderChecks(checks, "name").map((c) => c.check_name)).toEqual(["a", "b", "w", "z"]);
    expect(orderChecks(checks, "severity").map((c) => c.check_name)).toEqual(["a", "b", "z", "w"]);
  });

  it("differences two runs per check, counting an absent check as zero", () => {
    const history: CheckHistoryPoint[] = [
      { recipe: "old", check_name: "non_positive_price", violation_row_count: 4_012_524 },
      { recipe: "old", check_name: "high_below_low", violation_row_count: 0 },
      { recipe: "new", check_name: "non_positive_price", violation_row_count: 0 },
      { recipe: "new", check_name: "high_below_low", violation_row_count: 0 },
      { recipe: "new", check_name: "added_later", violation_row_count: 3 },
    ];
    const difference = differenceBetweenRuns(history, "old", "new");
    expect(difference[0]).toEqual({ check_name: "non_positive_price", previous: 4_012_524, current: 0, change: -4_012_524 });
    expect(difference.find((row) => row.check_name === "added_later")).toEqual({ check_name: "added_later", previous: 0, current: 3, change: 3 });
  });

  it("labels a partition and bands staleness", () => {
    expect(partitionLabel({ asset_class: "spread", root: "ES", timeframe: "1s", partition_start_timestamp: Date.UTC(2020, 0, 1) })).toBe("spread ES 1s 2020");
    expect(partitionLabel({ asset_class: null, root: null, timeframe: null, partition_start_timestamp: null })).toBe("? ? ? ?");
    expect(stalenessBand(6)).toBe("fresh");
    expect(stalenessBand(373)).toBe("weeks");
    expect(stalenessBand(6090)).toBe("months");
  });

  it("turns an epoch stamp into a fractional calendar year", () => {
    expect(fractionalYear(Date.UTC(2020, 0, 1))).toBe(2020);
    expect(fractionalYear(Date.UTC(2021, 0, 1) - 1)).toBeCloseTo(2021, 6);
    expect(fractionalYear(null)).toBeNull();
  });
});
