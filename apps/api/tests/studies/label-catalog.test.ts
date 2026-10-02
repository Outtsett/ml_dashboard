/**
 * The label-catalog study (apps/api/studies/handlers/label-catalog.ts) on a
 * fake lake, plus the pure pieces it shares with the page
 * (packages/shared/src/studies/label-catalog.ts): manifest flattening, histogram
 * shaping, monthly shares and the stepped AFML uniqueness trace.
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStudiesRouter } from "../../studies/studies.router";
import handler, { buildColumnProfiles, monthlyShares, setFilter } from "../../studies/handlers/label-catalog";
import type { StudyHandler, StudyLake } from "../../studies/types";
import {
  PROFILED_COLUMNS,
  flattenManifest,
  gapsInWindow,
  stableJson,
  uniquenessTrace,
  type LabelCatalogOverview,
  type LabelCatalogWindow,
  type WindowRow,
} from "@shared/studies/label-catalog";

const MANIFEST = [
  { written_at: "2026-09-27T02:00:00.000Z", recipe: "triple_barrier_MNQ_5m_aaa", label_set_id: 2, generator_type: "triple_barrier", label_encoding: "signed_direction", symbol: "MNQ", timeframe_minutes: 5, rows: 101, ts_min: "2024-06-01", ts_max: "2024-07-31", max_horizon_bars: 20, purge_bars: 20, parameters: { b: 2, a: [1, 2] }, validation: { passed: true, classBalanceRatio: 0.1, coverageFraction: 1, gates: { noLookahead: { passed: true, value: 0, detail: "every one kept its label" } } } },
  { written_at: "2026-09-27T01:00:00.000Z", recipe: "direction_MNQ_1m_bbb", label_set_id: 1, generator_type: "direction", label_encoding: "signed_direction", symbol: "MNQ", timeframe_minutes: 1, rows: 50, parameters: {}, validation: { passed: true } },
  { written_at: "2026-09-27T04:00:00.000Z", recipe: "triple_barrier_MNQ_5m_aaa", label_set_id: 2, generator_type: "triple_barrier", label_encoding: "signed_direction", symbol: "MNQ", timeframe_minutes: 5, rows: 100, parameters: { b: 2, a: [1, 2] }, label_distribution: { "-1": 40, "0": 10, "1": 50 }, validation: { passed: true, gates: { coverage: { passed: true, value: 1, detail: "100 rows over 100 bars" } } } },
]
  .map((line) => JSON.stringify(line))
  .join("\n");

const executed: string[] = [];
let labelsServed = true;
let failProfile = false;

function answer(sql: string): Record<string, unknown>[] {
  if (sql.includes("read_text(")) return [{ content: MANIFEST }];
  if (sql.includes("derived_label_audit_findings")) return [{ severity: "high", area: "barriers", location: "x.ts", finding: "f", action: "fixed" }];
  if (sql.includes("derived_label_audit_")) return [{ name: "row" }];
  if (failProfile && sql.includes("stddev_samp")) throw new Error("Binder Error: column sample_uniqueness_weight not found");
  if (sql.includes("stddev_samp")) {
    return PROFILED_COLUMNS.map((column) => ({ column_name: column, count: 3n, mean: 1, median: 1, standard_deviation: 0.5, skewness: 0.1, kurtosis: -1, percentile_25: 0.5, percentile_75: 1.5, minimum: 0, maximum: 2 }));
  }
  if (sql.includes("bounds AS")) return [{ column_name: "label", lo: -1, hi: 1, bin: 0n, rows: 4n }, { column_name: "label", lo: -1, hi: 1, bin: 9n, rows: 6n }];
  if (sql.includes("count(DISTINCT")) return [{ rows: 10n, distinct_labels: 3n, scatter_eligible: 9n }];
  if (sql.includes("USING SAMPLE")) return [{ volatility: 2, return_points: -3, label: -1 }, { volatility: 1, return_points: null, label: 1 }];
  if (sql.includes("usable_reason")) return [{ key: "ok", rows: 10n }, { key: "volatility_warmup", rows: 2n }];
  if (sql.includes("clears_round_trip_cost")) return [{ key: "clears the round trip", rows: 7n }];
  if (sql.includes("date_trunc") && sql.includes("avg(")) return [{ month: 0, mean_label: 0.2, rows: 10 }];
  if (sql.includes("date_trunc")) return [{ month: 0, label: -1, rows: 3 }, { month: 0, label: 1, rows: 1 }];
  if (sql.includes('GROUP BY "label"')) return [{ label: -1, rows: 4 }, { label: 1, rows: 6 }];
  if (sql.includes("OFFSET")) {
    return Array.from({ length: 3 }, (_, index) => ({ timestamp: index * 300_000, label: 1, resolution_bars: 1, resolution_timestamp: (index + 1) * 300_000, sample_uniqueness_weight: 0.5, concurrent_label_count: 2 }));
  }
  if (sql.includes("count(*) AS rows")) return [{ rows: 100n }];
  return [];
}

const lake: StudyLake = {
  async query<T>(sql: string): Promise<T[]> {
    executed.push(sql);
    return answer(sql) as T[];
  },
  async hasView(name) {
    if (name === "derived_labels") return labelsServed;
    return name.startsWith("derived_label_audit_") && name !== "derived_label_audit_suite";
  },
  async columns() {
    return [];
  },
};

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/api", createStudiesRouter([{ ...handler, cacheSeconds: 0 } as StudyHandler], lake));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/studies/label-catalog`;
});

afterAll(() => {
  server.close();
});

describe("label-catalog handler", () => {
  it("lists every manifest line, marks the superseded one and profiles the first set by label_set_id", async () => {
    labelsServed = true;
    const body = (await (await fetch(`${base}?bins=10`)).json()) as { notes: string[]; data: LabelCatalogOverview };
    const data = body.data;
    expect(data.part).toBe("overview");
    expect(data.manifest.map((row) => [row.label_set_id, row.current])).toEqual([[1, true], [2, false], [2, true]]);
    expect(data.recipeCount).toBe(2);
    expect(data.profile?.recipe).toBe("direction_MNQ_1m_bbb");
    expect(data.profile?.columns).toHaveLength(9);
    const label = data.profile?.columns.find((column) => column.column === "label");
    expect(label?.bins).toHaveLength(10);
    expect(label?.bins[0]).toEqual({ lower: -1, upper: -0.8, rows: 4 });
    expect(label?.bins[9]?.rows).toBe(6);
    expect(label?.summary.count).toBe(3);
    expect(label?.summary.kurtosis).toBeNull();
    expect(data.profile?.monthlyClasses.map((row) => row.share)).toEqual([0.75, 0.25]);
    expect(data.profile?.scatter).toEqual([{ volatility: 2, returnPoints: -3, label: -1 }]);
    expect(data.profile?.totalRows).toBe(12);
    expect(data.audit.findings).toHaveLength(1);
    expect(body.notes.join(" ")).toContain("derived_label_audit_suite");
  });

  it("reads the requested recipe with the usable filter off, and the manifest's gates", async () => {
    executed.length = 0;
    const body = (await (await fetch(`${base}?recipe=triple_barrier_MNQ_5m_aaa&usable=false`)).json()) as { data: LabelCatalogOverview };
    expect(body.data.profile?.recipe).toBe("triple_barrier_MNQ_5m_aaa");
    expect(body.data.profile?.gates).toEqual([{ gate: "coverage", passed: true, value: 1, detail: "100 rows over 100 bars" }]);
    expect(body.data.profile?.labelDistribution.map((row) => row.key)).toEqual(["-1", "0", "1"]);
    const summary = executed.find((sql) => sql.includes("stddev_samp")) ?? "";
    expect(summary).toContain(`"recipe" = 'triple_barrier_MNQ_5m_aaa'`);
    expect(summary).not.toContain('AND "usable"');
  });

  it("refuses a recipe that is not a plain name", async () => {
    expect((await fetch(`${base}?recipe=${encodeURIComponent("x' OR 1=1 --")}`)).status).toBe(400);
    expect((await fetch(`${base}?bins=5`)).status).toBe(400);
  });

  it("falls back to the first set, with a note, for an unknown recipe", async () => {
    const body = (await (await fetch(`${base}?recipe=nope_MNQ_1m_000`)).json()) as { notes: string[]; data: LabelCatalogOverview };
    expect(body.data.profile?.recipe).toBe("direction_MNQ_1m_bbb");
    expect(body.notes.join(" ")).toContain("nope_MNQ_1m_000");
  });

  it("notes a profile that cannot be read instead of failing the request", async () => {
    failProfile = true;
    const response = await fetch(base);
    failProfile = false;
    expect(response.status).toBe(200);
    const body = (await response.json()) as { notes: string[]; data: LabelCatalogOverview };
    expect(body.data.profile).toBeNull();
    expect(body.data.manifest.length).toBe(3);
    expect(body.notes.join(" ")).toContain("Could not profile direction_MNQ_1m_bbb");
  });

  it("clamps the window to the last sixty rows and numbers them from the start", async () => {
    const body = (await (await fetch(`${base}?part=window&recipe=triple_barrier_MNQ_5m_aaa&windowStart=99`)).json()) as { data: LabelCatalogWindow };
    expect(body.data.windowStart).toBe(40);
    expect(body.data.timeframeMinutes).toBe(5);
    expect(body.data.window.map((row) => row.rowIndex)).toEqual([40, 41, 42]);
  });

  it("answers an empty body with a note when derived_labels is not landed", async () => {
    labelsServed = false;
    const response = await fetch(base);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { notes: string[]; data: LabelCatalogOverview };
    expect(body.data.profile).toBeNull();
    expect(body.notes.join(" ")).toContain("derived_labels");
    labelsServed = true;
  });
});

describe("label-catalog pure pieces", () => {
  it("writes parameters as Python's json.dumps(sort_keys=True)", () => {
    expect(stableJson({ b: 2, a: [1, "x"] })).toBe('{"a": [1, "x"], "b": 2}');
    expect(flattenManifest(MANIFEST)[1]?.parameters).toBe('{"a": [1, 2], "b": 2}');
  });

  it("filters the set and optionally the usable rows", () => {
    expect(setFilter("r_1", true)).toBe(`FROM "derived_labels" WHERE "recipe" = 'r_1' AND "usable"`);
    expect(setFilter("r_1", false)).toBe(`FROM "derived_labels" WHERE "recipe" = 'r_1'`);
  });

  it("gives a constant column one unit-wide bin", () => {
    const [profile] = buildColumnProfiles([], [{ column_name: "label", lo: 1, hi: 1, bin: 0, rows: 5 }], 40);
    expect(profile?.bins).toEqual([{ lower: 1, upper: 2, rows: 5 }]);
  });

  it("shares a month's rows among its labels", () => {
    expect(monthlyShares([{ month: 1, label: 0, rows: 1 }, { month: 1, label: 1, rows: 3 }, { month: 2, label: 1, rows: 2 }]).map((row) => row.share)).toEqual([0.25, 0.75, 1]);
  });

  it("steps the uniqueness sum exactly as the notebook did", () => {
    const row = (resolutionBars: number | null): WindowRow => ({ rowIndex: 0, timestamp: 0, label: 1, resolutionBars, resolutionTimestamp: null, sampleUniquenessWeight: 0.4, concurrentLabelCount: null });
    // spans: [0,2] [1,2] [2,2]; label 0 covers bars 0,1,2 with c = 1,2,3.
    const trace = uniquenessTrace([row(2), row(1), row(0)], 0);
    expect(trace?.terms.map((term) => term.concurrency)).toEqual([1, 2, 3]);
    expect(trace?.runningSum).toBeCloseTo(1 + 1 / 2 + 1 / 3, 12);
    expect(trace?.estimate).toBeCloseTo((1 + 1 / 2 + 1 / 3) / 3, 12);
    expect(trace?.landedWeight).toBe(0.4);
    // a missing horizon counts as zero bars, and the step is clamped into the window.
    expect(uniquenessTrace([row(null)], 9)?.spanLength).toBe(1);
    expect(uniquenessTrace([], 0)).toBeNull();
  });

  it("counts steps between rows longer than one bar", () => {
    const at = (minutes: number): WindowRow => ({ rowIndex: 0, timestamp: minutes * 60_000, label: 0, resolutionBars: 0, resolutionTimestamp: null, sampleUniquenessWeight: null, concurrentLabelCount: null });
    expect(gapsInWindow([at(0), at(5), at(10), at(60)], 5)).toBe(1);
  });
});
