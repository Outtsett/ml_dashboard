/**
 * The data-lifecycle-audit study: the handler's SQL run for real on an
 * in-memory DuckDB whose tables carry the landed views' names and columns
 * (recipe pinning, the raw table chosen from the audit's own index, column
 * typing, timestamp and boolean handling, truncation, the missing-view
 * degradation and the query refusals), plus the pure compute the page shares:
 * filters, the lifecycle cells, the jitter-free packing, the nice bins, the
 * column panels and the z-score walk against the dashboard's eight numbers.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler, {
  DOCUMENTATION_VIEW, FINDINGS_VIEW, HEADLINE_VIEW, INDEX_VIEW, REFUTED_VIEW, querySchema, rawColumnSelect,
} from "../../studies/handlers/data-lifecycle-audit";
import { plainRow } from "../../studies/sql";
import type { StudyContext, StudyLake } from "../../studies/types";
import { eightNumberSummary } from "@shared/lens/stats";
import {
  buildColumnPanel, cellKey, countBySeverity, filterFindings, joinList, kurtosisFromScores, lifecycleCells, markSize, niceBins,
  packInBox, parseList, restrictToCells, restrictToIdentifiers, skewnessFromScores, sortFindings, stageShortLabel, toggleIn,
  zScoreWalk, type FindingRow,
} from "@shared/studies/data-lifecycle-audit";

const NEW = "measured_audit_2026_09_23";
const OLD = "measured_audit_2026_01_01";

let instance: DuckDBInstance;

async function run(sql: string) {
  const connection = await instance.connect();
  try {
    return (await connection.runAndReadAll(sql)).getRowObjectsJS().map((row) => plainRow(row as Record<string, unknown>));
  } finally {
    connection.closeSync();
  }
}

const lake: StudyLake = {
  async query<T>(sql: string): Promise<T[]> {
    return (await run(sql)) as T[];
  },
  async hasView(name) {
    return Number((await run(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = '${name}'`))[0]?.n) > 0;
  },
  async columns() {
    return [];
  },
};

const emptyLake: StudyLake = { async query() { return []; }, async hasView() { return false; }, async columns() { return []; } };

async function call(rawQuery: Record<string, string> = {}, using: StudyLake = lake) {
  const context: StudyContext = { lake: using, notes: [] };
  const body = await handler.run(querySchema.parse(rawQuery), context);
  return { body, notes: context.notes };
}

function finding(identifier: string, over: Partial<FindingRow> = {}): FindingRow {
  return {
    identifier, strand: "lake_storage", lifecycle_stage: "retrieve", component: "component", file_path: "a/b.py", line_number: 10,
    title: `title ${identifier}`, current_behavior: "behaviour", evidence: "evidence", measured_value: 1, measured_unit: "s", improvement: "fix",
    expected_gain: "gain", severity: "medium", effort: "small", risk: "risk", confidence: "high", verdict: "confirmed", verification_note: "note",
    audit_date: "2026-09-23", ...over,
  };
}

function findingInsert(row: FindingRow, recipe: string): string {
  const q = (value: string | null) => (value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`);
  return `INSERT INTO ${FINDINGS_VIEW} VALUES (${q(row.identifier)}, ${q(row.strand)}, ${q(row.lifecycle_stage)}, ${q(row.component)}, ${q(row.file_path)}, ${row.line_number ?? "NULL"}, ${q(row.title)}, ${q(row.current_behavior)}, ${q(row.evidence)}, ${row.measured_value ?? "NULL"}, ${q(row.measured_unit)}, ${q(row.improvement)}, ${q(row.expected_gain)}, ${q(row.severity)}, ${q(row.effort)}, ${q(row.risk)}, ${q(row.confidence)}, ${q(row.verdict)}, ${q(row.verification_note)}, DATE '${row.audit_date}', ${q(recipe)})`;
}

beforeAll(async () => {
  instance = await DuckDBInstance.create(":memory:");
  await run(
    `CREATE TABLE ${FINDINGS_VIEW} (identifier VARCHAR, strand VARCHAR, lifecycle_stage VARCHAR, component VARCHAR, file_path VARCHAR, line_number BIGINT, title VARCHAR, current_behavior VARCHAR, evidence VARCHAR, measured_value DOUBLE, measured_unit VARCHAR, improvement VARCHAR, expected_gain VARCHAR, severity VARCHAR, effort VARCHAR, risk VARCHAR, confidence VARCHAR, verdict VARCHAR, verification_note VARCHAR, audit_date DATE, recipe VARCHAR)`,
  );
  await run(findingInsert(finding("LAKE-01", { severity: "critical" }), NEW));
  await run(findingInsert(finding("LAKE-02", { measured_value: null, line_number: null, measured_unit: null }), NEW));
  await run(findingInsert(finding("OLD-01", { audit_date: "2026-01-01" }), OLD));
  await run(`CREATE TABLE ${REFUTED_VIEW} AS SELECT 'PY-07' AS identifier, 'refuted' AS verdict, 'a claim' AS title, 'why' AS verification_note, '${NEW}' AS recipe`);
  await run(`CREATE TABLE ${HEADLINE_VIEW} AS SELECT 'gaps' AS strand, 'files' AS measurement_name, 12.0 AS value, 'count' AS unit, 'listed' AS method, 'raw_small' AS raw_table_name, '${NEW}' AS recipe`);
  await run(`CREATE TABLE ${DOCUMENTATION_VIEW} AS SELECT 'gaps' AS strand, 'topic' AS topic, 'docs' AS source, 'a fact' AS fact, '${NEW}' AS recipe`);
  await run(
    `CREATE TABLE ${INDEX_VIEW} AS SELECT * FROM (VALUES ` +
      `('raw_small', 'gaps', 'small.csv', 2::BIGINT, 5::BIGINT, 'label, n, stamp, flag, big'), ` +
      `('raw_large', 'lake_storage', 'large.csv', 3::BIGINT, 1::BIGINT, 'n'), ` +
      `('raw_liar', 'gaps', 'liar.csv', 9999::BIGINT, 1::BIGINT, 'n')` +
      `) AS t(raw_table_name, strand, source_file, row_count, column_count, columns), (VALUES ('${NEW}')) AS r(recipe)`,
  );
  await run(
    `CREATE TABLE derived_data_lifecycle_audit_raw_small AS SELECT * FROM (VALUES ` +
      `('a', 1::BIGINT, TIMESTAMPTZ '2026-09-09 05:40:55+00', true, 10::HUGEINT), ('b', NULL::BIGINT, TIMESTAMPTZ '2026-09-11 04:21:35+00', false, 20::HUGEINT)` +
      `) AS t(label, n, stamp, flag, big), (VALUES ('${NEW}')) AS r(recipe)`,
  );
  await run(`CREATE TABLE derived_data_lifecycle_audit_raw_large AS SELECT * FROM (VALUES (1.5), (2.5), (9.0)) AS t(n), (VALUES ('${NEW}')) AS r(recipe)`);
  await run(`CREATE TABLE derived_data_lifecycle_audit_raw_liar AS SELECT * FROM (VALUES (1.0)) AS t(n), (VALUES ('${NEW}')) AS r(recipe)`);
});

afterAll(() => {
  instance.closeSync();
});

describe("the handler", () => {
  it("lists the five core views and the 36 raw tables as datasets", () => {
    expect(handler.slug).toBe("data-lifecycle-audit");
    expect(handler.datasets).toHaveLength(41);
    expect(handler.datasets).toContain("derived_data_lifecycle_audit_findings");
    expect(handler.datasets).toContain("derived_data_lifecycle_audit_raw_table_index");
  });

  it("reads only the newest recipe and turns the audit date into text", async () => {
    const { body } = await call();
    expect(body.recipe).toBe(NEW);
    expect(body.recipes).toEqual([NEW, OLD]);
    expect(body.findings.map((row) => row.identifier)).toEqual(["LAKE-01", "LAKE-02"]);
    expect(body.findings[0]?.audit_date).toBe("2026-09-23");
    expect(body.findings[1]?.measured_value).toBeNull();
    expect(body.findings[1]?.line_number).toBeNull();
    expect(body.findings[0]).not.toHaveProperty("recipe");
    expect(body.refuted).toHaveLength(1);
    expect(body.headline[0]).toMatchObject({ measurement_name: "files", value: 12, raw_table_name: "raw_small" });
    expect(body.documentation[0]?.fact).toBe("a fact");
  });

  it("pins an older recipe when asked and says so when the recipe is unknown", async () => {
    const old = await call({ recipe: OLD });
    expect(old.body.findings.map((row) => row.identifier)).toEqual(["OLD-01"]);
    const unknown = await call({ recipe: "nope" });
    expect(unknown.body.recipe).toBe(NEW);
    expect(unknown.notes.join(" ")).toContain("nope");
  });

  it("indexes the raw tables largest first and opens the largest by default", async () => {
    const { body } = await call();
    expect(body.rawIndex.map((entry) => entry.raw_table_name)).toEqual(["raw_liar", "raw_large", "raw_small"]);
    expect(body.rawIndex[0]?.row_count).toBe(9999);
    expect(body.rawTable?.name).toBe("raw_liar");
  });

  it("types the chosen raw table: numbers stay numbers, stamps and booleans are read as text and labels", async () => {
    const { body } = await call({ table: "raw_small" });
    const table = body.rawTable;
    expect(table?.columns).toEqual([
      { name: "label", type: "text" }, { name: "n", type: "number" }, { name: "stamp", type: "text" }, { name: "flag", type: "text" }, { name: "big", type: "number" },
    ]);
    expect(table?.rows[0]).toEqual({ label: "a", n: 1, stamp: "2026-09-09 05:40:55 UTC", flag: true, big: 10 });
    expect(table?.rows[1]?.n).toBeNull();
    expect(table?.rowCount).toBe(2);
    expect(table?.truncated).toBe(false);
  });

  it("flags a table whose index row count exceeds what was read", async () => {
    const { body, notes } = await call({ table: "raw_liar" });
    expect(body.rawTable?.truncated).toBe(true);
    expect(body.rawTable?.rows).toHaveLength(1);
    expect(notes.join(" ")).toContain("raw_liar");
  });

  it("draws a BIGINT identifier that arrives as a string (past 2^53) as a label, not a number", async () => {
    const stub: StudyLake = {
      async query<T>(sql: string): Promise<T[]> {
        if (sql.includes("information_schema.columns")) return [{ column_name: "snapshot_identifier", data_type: "BIGINT" }, { column_name: "bytes", data_type: "BIGINT" }] as T[];
        if (sql.includes("DISTINCT recipe")) return [{ recipe: NEW }] as T[];
        if (sql.includes(INDEX_VIEW)) return [{ raw_table_name: "raw_small", strand: "gaps", source_file: "s.csv", row_count: 1, column_count: 2, columns: "" }] as T[];
        if (sql.includes("raw_small")) return [{ snapshot_identifier: "7161664417363269075", bytes: 5 }] as T[];
        return [];
      },
      async hasView() { return true; },
      async columns() { return []; },
    };
    const { body } = await call({}, stub);
    expect(body.rawTable?.columns).toEqual([{ name: "snapshot_identifier", type: "text" }, { name: "bytes", type: "number" }]);
  });

  it("falls back to the largest table, with a note, when the name is not in the audit's index", async () => {
    const { body, notes } = await call({ table: "raw_missing" });
    expect(body.rawTable?.name).toBe("raw_liar");
    expect(notes.join(" ")).toContain("raw_missing");
  });

  it("refuses a table name that is not a plain identifier, before any SQL", () => {
    expect(() => querySchema.parse({ table: "raw_small; DROP TABLE x" })).toThrow();
    expect(() => querySchema.parse({ table: "Raw" })).toThrow();
    expect(() => querySchema.parse({ recipe: "a'b" })).toThrow();
    expect(querySchema.parse({ table: "raw_gaps__iceberg_snapshots" }).table).toBe("raw_gaps__iceberg_snapshots");
  });

  it("degrades to an empty body and a note when the audit is not landed", async () => {
    const { body, notes } = await call({}, emptyLake);
    expect(body.findings).toEqual([]);
    expect(body.rawTable).toBeNull();
    expect(notes[0]).toContain("derived_data_lifecycle_audit_findings");
  });

  it("maps column types to how a column is selected", () => {
    expect(rawColumnSelect("count", "BIGINT")).toEqual({ select: '"count"', column: { name: "count", type: "number" } });
    expect(rawColumnSelect("amount", "DECIMAL(18,3)").select).toBe('CAST("amount" AS DOUBLE) AS "amount"');
    expect(rawColumnSelect("at", "TIMESTAMP WITH TIME ZONE").select).toContain("AT TIME ZONE 'UTC'");
    expect(rawColumnSelect("day", "DATE")).toEqual({ select: 'CAST("day" AS VARCHAR) AS "day"', column: { name: "day", type: "text" } });
    expect(rawColumnSelect("ok", "BOOLEAN").column.type).toBe("text");
    expect(() => rawColumnSelect("bad name", "BIGINT")).toThrow();
  });
});

describe("filters, cells and ordering", () => {
  const rows = [
    finding("A-1", { severity: "critical", effort: "medium", lifecycle_stage: "store_layout", strand: "gaps", title: "Versioning never expires" }),
    finding("A-2", { severity: "low", effort: "small", lifecycle_stage: "store_layout", strand: "gaps", title: "A cache that never evicts" }),
    finding("B-1", { severity: "high", effort: "small", lifecycle_stage: "compute", strand: "python_compute", component: "Numba kernels" }),
    finding("B-2", { severity: "medium", effort: "large", lifecycle_stage: "compute", strand: "python_compute", file_path: "packages/ml-engine/src/float32.py" }),
  ];
  const everything = {
    stages: ["store_layout", "retrieve", "transfer_serialize", "compute", "memory", "temporary_storage", "end_of_life"],
    severities: ["critical", "high", "medium", "low"], efforts: ["small", "medium", "large"], strands: ["gaps", "python_compute", "lake_storage"], text: "",
  };

  it("keeps a finding only when every selector includes it", () => {
    expect(filterFindings(rows, everything)).toHaveLength(4);
    expect(filterFindings(rows, { ...everything, severities: ["critical"] }).map((row) => row.identifier)).toEqual(["A-1"]);
    expect(filterFindings(rows, { ...everything, efforts: ["small"], strands: ["python_compute"] }).map((row) => row.identifier)).toEqual(["B-1"]);
    expect(filterFindings(rows, { ...everything, stages: [] })).toEqual([]);
  });

  it("searches title, component, behaviour, fix and file path, case-insensitively", () => {
    expect(filterFindings(rows, { ...everything, text: "EVICTS" }).map((row) => row.identifier)).toEqual(["A-2"]);
    expect(filterFindings(rows, { ...everything, text: "numba" }).map((row) => row.identifier)).toEqual(["B-1"]);
    expect(filterFindings(rows, { ...everything, text: "float32" }).map((row) => row.identifier)).toEqual(["B-2"]);
    expect(filterFindings(rows, { ...everything, text: "   " })).toHaveLength(4);
  });

  it("counts every severity, zero included", () => {
    expect(countBySeverity(rows.slice(0, 2))).toEqual({ critical: 1, high: 0, medium: 0, low: 1 });
  });

  it("groups by stage and part, each cell carrying its count, worst severity and titles", () => {
    const cells = lifecycleCells(rows);
    expect(cells).toHaveLength(2);
    const first = cells.find((cell) => cell.stage === "store_layout");
    expect(first).toMatchObject({ strand: "gaps", count: 2, worstSeverity: "critical" });
    expect(first?.titles).toEqual(["Versioning never expires", "A cache that never evicts"]);
    expect(cells.find((cell) => cell.stage === "compute")).toMatchObject({ count: 2, worstSeverity: "high" });
  });

  it("narrows to clicked cells and picked identifiers, and to everything when none is clicked", () => {
    expect(restrictToCells(rows, [])).toHaveLength(4);
    expect(restrictToCells(rows, [cellKey("compute", "python_compute")]).map((row) => row.identifier)).toEqual(["B-1", "B-2"]);
    expect(restrictToIdentifiers(rows, ["A-2", "B-2"]).map((row) => row.identifier)).toEqual(["A-2", "B-2"]);
    expect(restrictToIdentifiers(rows, [])).toHaveLength(4);
  });

  it("orders the table by severity, then effort, then identifier", () => {
    expect(sortFindings(rows).map((row) => row.identifier)).toEqual(["A-1", "B-1", "B-2", "A-2"]);
  });

  it("round-trips the URL lists and toggles a value in place", () => {
    expect(parseList("")).toEqual([]);
    expect(parseList("a,b")).toEqual(["a", "b"]);
    expect(joinList(["a", "b"])).toBe("a,b");
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleIn(["a"], "c")).toEqual(["a", "c"]);
    expect(stageShortLabel("store_layout")).toBe("1 · stored");
    expect(stageShortLabel("unknown")).toBe("unknown");
  });

  it("grows a mark's area with the count", () => {
    expect(markSize(1, 10)).toBeCloseTo(22, 6);
    expect(markSize(10, 10)).toBeCloseTo(46, 6);
    expect(markSize(5, 10) ** 2).toBeCloseTo(22 ** 2 + (46 ** 2 - 22 ** 2) * (4 / 9), 6);
    expect(markSize(3, 1)).toBe(34);
  });
});

describe("packing marks so none hides another", () => {
  it("puts as many in a row as fit and centres the rows", () => {
    const one = packInBox(5, 100, 40, 15);
    expect(one.size).toBe(15);
    expect(one.points).toEqual([{ dx: -30, dy: 0 }, { dx: -15, dy: 0 }, { dx: 0, dy: 0 }, { dx: 15, dy: 0 }, { dx: 30, dy: 0 }]);
    const two = packInBox(5, 60, 40, 15);
    expect(two.points[0]).toEqual({ dx: -22.5, dy: -7.5 });
    expect(two.points[4]).toEqual({ dx: 0, dy: 7.5 });
    expect(new Set(two.points.map((point) => `${point.dx}|${point.dy}`)).size).toBe(5);
  });

  it("wraps into rows and shrinks the marks when the box is too short", () => {
    const { points, size } = packInBox(17, 120, 30, 15);
    expect(size).toBeLessThan(15);
    const rowsUsed = new Set(points.map((point) => point.dy)).size;
    expect(rowsUsed * size).toBeLessThanOrEqual(30 + 1e-9);
    expect(new Set(points.map((point) => `${point.dx}|${point.dy}`)).size).toBe(17);
  });

  it("returns nothing for nothing", () => {
    expect(packInBox(0, 100, 50, 15).points).toEqual([]);
  });
});

describe("column panels", () => {
  it("bins on a nice step with at most the asked number of bins and loses no value", () => {
    const values = [3, 7, 12, 18, 25, 26, 40, 41, 77, 99];
    for (const maximum of [5, 10, 20, 50]) {
      const bins = niceBins(values, maximum);
      expect(bins.length).toBeLessThanOrEqual(maximum + 1);
      expect(bins.reduce((total, bin) => total + bin.count, 0)).toBe(values.length);
      const step = (bins[0] as { upper: number; lower: number }).upper - (bins[0] as { lower: number }).lower;
      expect([1, 2, 5].some((mantissa) => Math.abs(Math.log10(step / mantissa) - Math.round(Math.log10(step / mantissa))) < 1e-9)).toBe(true);
    }
    expect(niceBins([5, 5, 5], 10)).toHaveLength(1);
    expect(niceBins([], 10)).toEqual([]);
  });

  it("gives a number its histogram and eight numbers, and nothing when it has no value", () => {
    const panel = buildColumnPanel("measured_value", [1, 2, 3, 4, 100, null], true, 12, 20);
    expect(panel?.kind).toBe("number");
    if (panel?.kind === "number") {
      expect(panel.summary.count).toBe(5);
      expect(panel.summary.maximum).toBe(100);
    }
    expect(buildColumnPanel("x", [null, null], true, 12, 20)).toBeNull();
  });

  it("counts a label column per value, most frequent first, empty values named", () => {
    const panel = buildColumnPanel("severity", ["low", "low", "high", null, "low", true], false, 2, 20);
    expect(panel).toMatchObject({ kind: "category", distinct: 4 });
    if (panel?.kind === "category") expect(panel.values).toEqual([{ value: "low", count: 3 }, { value: "(empty)", count: 1 }]);
  });

  it("draws characters per row for a long-text column whose values are nearly all different", () => {
    const texts = Array.from({ length: 60 }, (_, index) => `${"word ".repeat(index + 1)}${index}`);
    const panel = buildColumnPanel("evidence", texts, false, 12, 20);
    expect(panel?.kind).toBe("text");
    if (panel?.kind === "text") {
      expect(panel.distinct).toBe(60);
      expect(panel.summary.count).toBe(60);
      expect(panel.summary.minimum).toBe(("word ".length + 1));
    }
  });
});

describe("the z-score walk behind the shape numbers", () => {
  const values = [1, 2, 2, 3, 3, 3, 4, 9, 15, 40];

  it("reproduces the dashboard's skewness and excess kurtosis exactly", () => {
    const walk = zScoreWalk(values);
    const reference = eightNumberSummary(values);
    expect(walk?.count).toBe(10);
    expect(skewnessFromScores(walk!)).toBeCloseTo(reference.skewness as number, 10);
    expect(kurtosisFromScores(walk!)).toBeCloseTo(reference.kurtosis as number, 10);
    expect(walk?.standardDeviation).toBeCloseTo(reference.standardDeviation as number, 12);
  });

  it("is undefined below two values and null for the shape numbers below three and four", () => {
    expect(zScoreWalk([1])).toBeNull();
    expect(zScoreWalk([NaN, 4])).toBeNull();
    expect(skewnessFromScores(zScoreWalk([1, 2])!)).toBeNull();
    expect(kurtosisFromScores(zScoreWalk([1, 2, 9])!)).toBeNull();
    expect(zScoreWalk([4, 4, 4])?.scores).toEqual([0, 0, 0]);
  });
});
