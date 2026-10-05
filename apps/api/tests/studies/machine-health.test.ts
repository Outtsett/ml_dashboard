/**
 * The machine-health study: the pure compute the handler and the page share
 * (gaps, Sunday weeks, log transforms, full-range bins, the snapshot pivot),
 * the SQL the handler writes for the day window and the kind picker, and the
 * whole handler on a fake lake.
 */

import { describe, expect, it } from "vitest";
import handler, { VIEWS, querySchema, selectionClause } from "../../studies/handlers/machine-health";
import {
  DEFAULT_HIDDEN_KINDS, EVENT_STYLE, fullRangeBins, gapHours, logHours, logOnePlus, parseList, pivotComparison, sundayWeekStart,
  type MachineHealthBody,
} from "@shared/studies/machine-health";
import { eightNumberSummary } from "@shared/lens/stats";
import type { StudyContext, StudyLake } from "../../studies/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("pure compute", () => {
  it("gapHours is the diff of the sorted times in hours, one fewer than the events", () => {
    const t0 = Date.UTC(2026, 5, 1, 0, 0);
    expect(gapHours([t0 + 5 * HOUR, t0, t0 + 2 * HOUR])).toEqual([2, 3]);
    expect(gapHours([t0])).toEqual([]);
    expect(gapHours([])).toEqual([]);
  });

  it("logHours floors at 0.01 hours and logOnePlus floors the value at 0", () => {
    expect(logHours(100)).toBeCloseTo(2, 12);
    expect(logHours(0)).toBeCloseTo(-2, 12);
    expect(logHours(0.001)).toBeCloseTo(-2, 12);
    expect(logOnePlus(99)).toBeCloseTo(2, 12);
    expect(logOnePlus(-5)).toBe(0);
  });

  it("sundayWeekStart maps every day of a week to its Sunday 00:00", () => {
    const sunday = Date.UTC(2026, 4, 10); // 2026-05-10 is a Sunday
    expect(new Date(sunday).getUTCDay()).toBe(0);
    for (let offset = 0; offset < 7; offset += 1) {
      expect(sundayWeekStart(sunday + offset * DAY + 13 * HOUR)).toBe(sunday);
    }
    expect(sundayWeekStart(sunday + 7 * DAY)).toBe(sunday + 7 * DAY);
    expect(sundayWeekStart(sunday - 1)).toBe(sunday - 7 * DAY);
  });

  it("fullRangeBins keeps every value, the outlier included", () => {
    const values = [1, 1, 2, 2, 3, 100];
    const bins = fullRangeBins(values, 4);
    expect(bins).toHaveLength(4);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(values.length);
    expect(bins[0]?.lower).toBe(1);
    expect(bins[3]?.upper).toBe(100);
    expect(bins[3]?.count).toBe(1);
    expect(fullRangeBins([5, 5], 10)).toEqual([{ lower: 5, upper: 5, count: 2 }]);
    expect(fullRangeBins([], 10)).toEqual([]);
  });

  it("pivotComparison fills a label with no such process with 0 and sorts on the first label", () => {
    const rows = [
      { processName: "a.exe", snapshotLabel: "before", privateMegabytes: 10 },
      { processName: "b.exe", snapshotLabel: "before", privateMegabytes: 50 },
      { processName: "a.exe", snapshotLabel: "after_restart", privateMegabytes: 99 },
      { processName: "c.exe", snapshotLabel: "after_restart", privateMegabytes: 7 },
    ];
    const pivot = pivotComparison(rows, ["after_restart", "before"], 10);
    expect(pivot.map((row) => row.processName)).toEqual(["a.exe", "c.exe", "b.exe"]);
    expect(pivot[0]?.privateMegabytes).toEqual({ after_restart: 99, before: 10 });
    expect(pivot[2]?.privateMegabytes).toEqual({ after_restart: 0, before: 50 });
    expect(pivotComparison(rows, ["before"], 1)).toHaveLength(1);
  });

  it("styles every event kind the notebook drew with its own shape", () => {
    const shapes = Object.values(EVENT_STYLE).map((style) => style.shape);
    const colours = Object.values(EVENT_STYLE).map((style) => style.color);
    expect(Object.keys(EVENT_STYLE)).toHaveLength(9);
    // Only the two circle kinds share a shape, and they differ in colour and ring versus filled.
    expect(new Set(shapes).size).toBe(9);
    expect(new Set(colours).size).toBe(9);
  });

  it("the gap eight-number summary matches the pandas estimators on a known series", () => {
    // pandas: Series([1, 2, 4, 8, 16]) -> mean 6.2, median 4, std 6.09918, skew 1.32531, 25% 2, 75% 8; Series([1, 2, 4, 8, 16, 40]).kurt() is 3.23520.
    const summary = eightNumberSummary([1, 2, 4, 8, 16]);
    expect(summary.mean).toBeCloseTo(6.2, 10);
    expect(summary.median).toBe(4);
    expect(summary.standardDeviation).toBeCloseTo(6.099180272790763, 10);
    expect(summary.skewness).toBeCloseTo(1.3253147098134048, 10);
    expect(summary.percentile25).toBe(2);
    expect(summary.percentile75).toBe(8);
    expect(eightNumberSummary([1, 2, 4, 8, 16, 40]).kurtosis).toBeCloseTo(3.2351989437497437, 10);
    expect(eightNumberSummary([1, 2, 3]).kurtosis).toBeNull();
  });
});

describe("selectionClause", () => {
  const base = querySchema.parse({});

  it("scopes to the recipe and the local-time window, with no kind filter by default", () => {
    const sql = selectionClause("indexed_2026_09_30", base, "2026-05-13", 124);
    expect(sql).toContain("recipe = 'indexed_2026_09_30'");
    expect(sql).toContain("event_local_timestamp >= (CAST('2026-05-13' AS TIMESTAMP) + to_days(0))");
    // dayEnd -1 is the last day, so the exclusive end is total_days + 1 days after the first day.
    expect(sql).toContain("event_local_timestamp < (CAST('2026-05-13' AS TIMESTAMP) + to_days(125))");
    expect(sql).not.toContain("NOT IN");
  });

  it("hides the listed kinds and quotes them", () => {
    const query = querySchema.parse({ hiddenKinds: "windows_error_report|live_kernel_event|it's", dayStart: "3", dayEnd: "40" });
    const sql = selectionClause("r", query, "2026-05-13", 124);
    expect(sql).toContain("event_kind NOT IN ('windows_error_report', 'live_kernel_event', 'it''s')");
    expect(sql).toContain("to_days(3)");
    expect(sql).toContain("to_days(41)");
  });

  it("refuses a query outside its schema", () => {
    expect(() => querySchema.parse({ recipe: "x; DROP TABLE" })).toThrow();
    expect(() => querySchema.parse({ dayStart: "-1" })).toThrow();
    expect(() => querySchema.parse({ dayEnd: "-2" })).toThrow();
    expect(parseList(DEFAULT_HIDDEN_KINDS)).toEqual(["windows_error_report"]);
  });
});

// ---------- the handler on a fake lake ----------

const T0 = Date.UTC(2026, 4, 13, 13, 24);

function fakeLake(present: readonly string[], log: string[] = []): StudyLake {
  return {
    async hasView(name) {
      return present.includes(name);
    },
    async columns() {
      return [];
    },
    async query<T>(sql: string): Promise<T[]> {
      log.push(sql);
      const rows = (() => {
        if (sql.startsWith("SELECT DISTINCT recipe")) return [{ recipe: "indexed_2026_09_29" }, { recipe: "indexed_2026_09_30" }];
        if (sql.includes("AS total_event_count")) return [{ total_event_count: 722, first_day: "2026-05-13", last_day: "2026-09-13", total_days: 124 }];
        if (sql.includes("GROUP BY event_kind ORDER BY event_kind"))
          return [{ event_kind: "application_crash", event_count: 119 }, { event_kind: "hard_reset_without_bugcheck", event_count: 33 }, { event_kind: "windows_error_report", event_count: 477 }];
        if (sql.includes("AS selected_count")) return [{ selected_count: 2 }];
        if (sql.includes("AS dump_kept"))
          return [
            { local_time: T0, event_kind: "application_crash", application_name: "Code.exe", bugcheck_code: null, exception_code: "0xc0000005", windows_error_reporting_bucket: null, faulting_module_name: "a.dll", dump_kept: true },
            { local_time: T0 + DAY, event_kind: "hard_reset_without_bugcheck", application_name: null, bugcheck_code: "0x0", exception_code: null, windows_error_reporting_bucket: null, faulting_module_name: null, dump_kept: false },
          ];
        if (sql.includes("AS week_start")) return [{ week_start: Date.UTC(2026, 4, 10), event_kind: "application_crash", event_count: 1 }, { week_start: Date.UTC(2026, 4, 10), event_kind: "hard_reset_without_bugcheck", event_count: 1 }];
        if (sql.includes("epoch_us")) return [{ local_time: T0 + DAY, local_day: "2026-05-14" }, { local_time: T0 + 3 * DAY, local_day: "2026-05-16" }];
        if (sql.includes("AS first_day FROM")) return [{ first_day: "2026-05-13" }];
        if (sql.startsWith("WITH grouped"))
          return [
            { application_name: "Code.exe", event_kind: "application_crash", event_count: 5, events_with_dump: 2, events_without_dump: 3, total: 6 },
            { application_name: "Code.exe", event_kind: "application_hang", event_count: 1, events_with_dump: 0, events_without_dump: 1, total: 6 },
            { application_name: null, event_kind: "application_crash", event_count: 2, events_with_dump: 0, events_without_dump: 2, total: 2 },
          ];
        if (sql.includes("AS created_time"))
          return [{ dump_path: "C:\\d\\Code.exe.1.dmp", dump_kind: "user_mode_crash_default_folder", application_name: "Code.exe", process_identifier: 1, size_megabytes: 7.5, created_time: T0, modified_time: T0 + HOUR }];
        if (sql.includes("AS file_count, coalesce")) return [{ file_count: 45, total_megabytes: 1234.5 }];
        if (sql.startsWith("SELECT DISTINCT snapshot_label")) return [{ snapshot_label: "before" }];
        if (sql.includes("boot_timestamp"))
          return [{ snapshot_label: "before", snapshot_time: T0, boot_time: T0 - DAY, physical_total_gigabytes: 127.1, physical_available_gigabytes: 58.4, pagefile_total_gigabytes: 46.2, pagefile_used_gigabytes: 11.4, process_count: 715, private_total_gigabytes: 71.1, cpu_sample_seconds: 30 }];
        if (sql.includes("GROUP BY process_name"))
          return [{ process_name: "chrome.exe", process_count: 30, private_megabytes: 9000.5, cpu_percent_of_one_core: 12.5, cpu_seconds_total: 400 }];
        if (sql.includes("handle_count"))
          return [
            { private_megabytes: 10, working_set_megabytes: 12, cpu_seconds_total: 1, cpu_percent_of_one_core: 0, thread_count: 4, handle_count: 100 },
            { private_megabytes: 20, working_set_megabytes: null, cpu_seconds_total: 2, cpu_percent_of_one_core: 1, thread_count: 6, handle_count: 200 },
          ];
        if (sql.includes("round(sum(")) return [{ process_name: "chrome.exe", snapshot_label: "before", private_megabytes: 9001 }];
        if (sql.includes("revert_command"))
          return [{ changed_time: T0, setting_path: "HKCU\\Run", setting_name: "X", value_before: null, value_after: "0300", change_reason: "reason", revert_command: "Remove-ItemProperty 'x'" }];
        if (sql.includes("startup_location")) return [{ snapshot_label: "before", snapshot_time: T0, startup_location: "HKCU Run", entry_name: "OneDrive", enabled: true }];
        if (sql.includes("events_added")) return [{ run_time: T0, events_added: 10, dump_files_added: 2, reports_added: 0, duration_seconds: 3.5 }];
        throw new Error(`unexpected SQL: ${sql.slice(0, 120)}`);
      })();
      return rows as T[];
    },
  };
}

function context(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

describe("handler", () => {
  it("declares every lake view it reads", () => {
    expect(handler.slug).toBe("machine-health");
    expect(handler.datasets).toEqual([...VIEWS]);
    expect(VIEWS.every((name) => name.startsWith("derived_study_machine_health_"))).toBe(true);
  });

  it("returns an empty body and a note when the tables are not landed", async () => {
    const ctx = context(fakeLake([]));
    const body = (await handler.run(querySchema.parse({}), ctx)) as MachineHealthBody;
    expect(body.recipe).toBeNull();
    expect(body.events.rows).toEqual([]);
    expect(body.processes.labels).toEqual([]);
    expect(ctx.notes[0]).toContain("derived_study_machine_health_crash_event_with_dump");
  });

  it("returns every section for the newest recipe, as plain numbers", async () => {
    const log: string[] = [];
    const ctx = context(fakeLake([...VIEWS], log));
    const body = (await handler.run(querySchema.parse({ hiddenKinds: DEFAULT_HIDDEN_KINDS }), ctx)) as MachineHealthBody;

    expect(body.recipe).toBe("indexed_2026_09_30");
    expect(body.recipes).toEqual(["indexed_2026_09_29", "indexed_2026_09_30"]);
    expect(log.every((sql) => sql.includes("indexed_2026_09_30") || sql.startsWith("SELECT DISTINCT recipe"))).toBe(true);
    expect(log.some((sql) => sql.includes("message") || sql.includes("event_data_json"))).toBe(false);

    expect(body.events.totalEventCount).toBe(722);
    expect(body.events.totalDays).toBe(124);
    expect(body.events.selectedCount).toBe(2);
    expect(body.events.rowsCapped).toBe(false);
    expect(body.events.kinds.map((kind) => kind.eventKind)).toEqual(["application_crash", "hard_reset_without_bugcheck", "windows_error_report"]);
    expect(body.events.rows[0]).toMatchObject({ localTime: T0, eventKind: "application_crash", applicationName: "Code.exe", dumpKept: true });
    expect(body.events.rows[1]?.applicationName).toBeNull();
    expect(body.events.weeks).toHaveLength(2);

    expect(body.shutdowns.uncleanShutdownCount).toBe(2);
    expect(gapHours(body.shutdowns.localTimes)).toEqual([48]);
    expect(body.shutdowns.firstEventDay).toBe("2026-05-13");

    expect(body.coverage.applicationCount).toBe(2);
    expect(body.coverage.rows[2]?.applicationName).toBe("(unknown)");
    expect(body.dumps.fileCount).toBe(45);
    expect(body.dumps.rows[0]?.sizeMegabytes).toBe(7.5);

    expect(body.processes.label).toBe("before");
    expect(body.processes.machine?.processCount).toBe(715);
    expect(body.processes.groups[0]).toMatchObject({ processName: "chrome.exe", processCount: 30 });
    expect(body.processes.columns.private_megabytes).toEqual([10, 20]);
    expect(body.processes.columns.working_set_megabytes).toEqual([12]);
    expect(body.comparison).toEqual([{ processName: "chrome.exe", privateMegabytes: { before: 9001 } }]);
    expect(body.configuration[0]?.revertCommand).toBe("Remove-ItemProperty 'x'");
    expect(body.startup[0]?.enabled).toBe(true);
    expect(body.indexRuns[0]?.eventsAdded).toBe(10);
  });

  it("uses a named recipe and says when it is not landed", async () => {
    const ctx = context(fakeLake([...VIEWS]));
    const body = (await handler.run(querySchema.parse({ recipe: "indexed_2026_09_29" }), ctx)) as MachineHealthBody;
    expect(body.recipe).toBe("indexed_2026_09_29");
    const missing = context(fakeLake([...VIEWS]));
    const fallback = (await handler.run(querySchema.parse({ recipe: "nope" }), missing)) as MachineHealthBody;
    expect(fallback.recipe).toBe("indexed_2026_09_30");
    expect(missing.notes[0]).toContain("nope");
  });

  it("falls back to the first snapshot label when the asked one does not exist", async () => {
    const ctx = context(fakeLake([...VIEWS]));
    const body = (await handler.run(querySchema.parse({ snapshotLabel: "after_restart" }), ctx)) as MachineHealthBody;
    expect(body.processes.label).toBe("before");
    expect(ctx.notes.join(" ")).toContain("after_restart");
  });
});
