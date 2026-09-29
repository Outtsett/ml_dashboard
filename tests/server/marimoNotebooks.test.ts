/**
 * The notebook tab's server logic, on real shapes: lineage and cell search read
 * from source (lineage.ts), git's porcelain output (git.ts), marimo export's
 * failure text as measured on 2026-09-28 (health.ts), the process table
 * (servers.ts), and the new-notebook name rules and template (template.ts).
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { countCells, extractDatasets, searchSource } from "../../src/server/marimo/lineage";
import { gitStateOf, parsePorcelain } from "../../src/server/marimo/git";
import { summarizeFailure } from "../../src/server/marimo/health";
import { parseProcessTable, treeWorkingSetBytes } from "../../src/server/marimo/servers";
import { renderNotebookTemplate, validateFileName } from "../../src/server/marimo/template";
import { isGroupPath } from "../../src/server/marimo/proxy";
import { mkdirSync, mkdtempSync } from "fs";
import os from "os";

const NOTEBOOK = `import marimo

app = marimo.App()


@app.cell
def _(con):
    runs = con.sql("SELECT * FROM derived_model_cycle_runs_runs").df()
    trades = con.sql(f"SELECT * FROM derived_model_cycle_runs_{table}")
    return


@app.cell
def _(con):
    bars = con.sql("SELECT * FROM mnq_ohlcv_1m JOIN my_own_scratch_table USING (timestamp)")
    daily = con.sql("select close from ohlcv_1d")
    path = "s3://derived/regression_tab_performance/recipe=measured/table=x/part-0.parquet"
    snapshot = "s3://derived/recipe=questdb_full_2026-09-09/table=ohlcv/"
    iceberg = catalog.load_table("market.bars")
    return
`;

describe("extractDatasets", () => {
  it("names every lake source the code reads, and nothing it built itself", () => {
    const names = extractDatasets(NOTEBOOK).map((d) => `${d.kind}: ${d.name}`);
    expect(names).toEqual([
      "lake view: derived_model_cycle_runs_*",
      "lake view: derived_model_cycle_runs_runs",
      "lake dataset: derived/regression_tab_performance",
      "Iceberg table: market.bars",
      "serving table: mnq_ohlcv_1m",
      "serving table: ohlcv_1d",
    ]);
    expect(names.join()).not.toContain("my_own_scratch_table");
    expect(names.join()).not.toContain("derived/recipe");
  });

  it("takes a serving table from the live list even when its name has no known shape", () => {
    const names = extractDatasets("con.sql('FROM candle_patterns_daily')", new Set(["candle_patterns_daily"])).map((d) => d.name);
    expect(names).toEqual(["candle_patterns_daily"]);
  });

  it("counts one cell per @app.cell decorator", () => {
    expect(countCells(NOTEBOOK)).toBe(2);
  });
});

describe("searchSource", () => {
  it("finds the word case-insensitively with its line number and highlight span", () => {
    const { matches, total } = searchSource(NOTEBOOK, "OHLCV_1D");
    expect(total).toBe(1);
    expect(matches[0]!.lineNumber).toBe(16);
    expect(matches[0]!.text.slice(matches[0]!.matchStart, matches[0]!.matchEnd)).toBe("ohlcv_1d");
  });

  it("clips a long line around the hit and caps the snippets but counts every line", () => {
    const long = `${"x".repeat(500)} needle ${"y".repeat(500)}`;
    const source = Array.from({ length: 9 }, () => long).join("\n");
    const { matches, total } = searchSource(source, "needle", 5);
    expect(total).toBe(9);
    expect(matches).toHaveLength(5);
    expect(matches[0]!.text.length).toBeLessThanOrEqual(160);
    expect(matches[0]!.text.slice(matches[0]!.matchStart, matches[0]!.matchEnd)).toBe("needle");
  });
});

describe("git state", () => {
  const top = path.resolve("E:/source/repos/datalake");
  const porcelain = [" M notebooks/lake_audit.py", "?? notebooks/new_study.py", "R  notebooks/renamed.py", "notebooks/old_name.py", ""].join("\0");
  const status = parsePorcelain(porcelain, top);

  it("reads modified, untracked and renamed files from porcelain -z", () => {
    expect(gitStateOf(path.join(top, "notebooks/lake_audit.py"), status)).toBe("modified");
    expect(gitStateOf(path.join(top, "notebooks/new_study.py"), status)).toBe("untracked");
    expect(gitStateOf(path.join(top, "notebooks/renamed.py"), status)).toBe("modified");
    // The old path of a rename is not a file of its own.
    expect(gitStateOf(path.join(top, "notebooks/old_name.py"), status)).toBe("clean");
    expect(gitStateOf(path.join(top, "notebooks/tails.py"), status)).toBe("clean");
  });

  it("says not_in_git when the folder is outside any repository", () => {
    expect(gitStateOf(path.join(top, "notebooks/tails.py"), null)).toBe("not_in_git");
  });
});

describe("summarizeFailure", () => {
  it("leads with the exception marimo printed, as measured on a failing notebook", () => {
    const stderr = "MarimoExceptionRaisedError: deliberate probe failure\nError: Export was successful, but some cells failed to execute.\n";
    const summary = summarizeFailure(stderr, 1, false);
    expect(summary.split("\n")[0]).toBe("MarimoExceptionRaisedError: deliberate probe failure");
    expect(summary).toContain("some cells failed to execute");
  });

  it("leaves out Python warnings and their source line so the error stays in the tail", () => {
    const stderr = [
      "E:/datalake/src/lake/serving.py:104: UserWarning: derived view derived_x not defined",
      "  derived_views(con)",
      "MarimoExceptionRaisedError: 'close'",
      "Error: Export was successful, but some cells failed to execute.",
    ].join("\n");
    const summary = summarizeFailure(stderr, 1, false);
    expect(summary).not.toContain("UserWarning");
    expect(summary).not.toContain("derived_views(con)");
    expect(summary.startsWith("MarimoExceptionRaisedError: 'close'")).toBe(true);
  });

  it("names the exit code when no exception line was printed, and the limit on a timeout", () => {
    expect(summarizeFailure("Traceback (most recent call last):\n  boom", 2, false)).toMatch(/^marimo export exited with code 2\./);
    expect(summarizeFailure("", null, true)).toBe("Stopped after 15 minutes without finishing.");
  });
});

describe("process-tree memory", () => {
  it("adds the launcher's child interpreter to its own working set, and ignores unrelated processes", () => {
    const csv = [
      '"ProcessId","ParentProcessId","WorkingSetSize"',
      '"0","0","8192"',
      '"4100","900","5242880"',
      '"4200","4100","432013312"',
      '"4300","4200","1048576"',
      '"5000","900","99999999"',
    ].join("\r\n");
    const processes = parseProcessTable(csv);
    expect(processes.size).toBe(5);
    expect(treeWorkingSetBytes(4100, processes)).toBe(5242880 + 432013312 + 1048576);
    expect(treeWorkingSetBytes(0, processes)).toBe(8192);
    expect(treeWorkingSetBytes(12345, processes)).toBeNull();
  });
});

describe("new notebook", () => {
  it("accepts snake case and refuses a name that would shadow a package", () => {
    expect(validateFileName("volume_at_the_open")).toBeNull();
    expect(validateFileName("Volume")).toMatch(/lower-case/);
    expect(validateFileName("9lives")).toMatch(/lower-case/);
    expect(validateFileName("lake")).toMatch(/shadow the lake package/);
    expect(validateFileName("duckdb")).toMatch(/shadow/);
  });

  it("renders a marimo notebook whose header the catalog reads, with quotes and backslashes made safe", () => {
    const source = renderNotebookTemplate('Volume """at""" the \\open', "Where the volume sits.");
    expect(source).toContain("marimo.App(");
    expect(source).toContain('# Volume "at" the /open');
    expect(source).toContain("Where the volume sits.");
    expect(source).not.toContain('"""at"""');
    expect(countCells(source)).toBe(9);
    expect(source).toContain("SET TimeZone='UTC'");
    expect(source).toContain("#0072B2");
  });
});

describe("review fixes (2026-09-28)", () => {
  it("does not read prose as a table read: comments and mo.md text are skipped by the FROM scan", () => {
    const source = [
      "# the rows from bars are resampled below",
      "mo.md(\"\"\"We read it from ohlcv_1d, see derived_labels.\"\"\")",
      "x = con.sql('SELECT 1 FROM mnq_ohlcv_1m')",
    ].join("\n");
    const names = extractDatasets(source).map((d) => d.name);
    expect(names).toContain("mnq_ohlcv_1m");
    expect(names).not.toContain("bars");
    expect(names).not.toContain("ohlcv_1d");
    // A derived view named in prose still names a real object.
    expect(names).toContain("derived_labels");
  });

  it("refuses Windows device names and a name that would shadow a sibling package", () => {
    expect(validateFileName("con")).toMatch(/device name/);
    expect(validateFileName("lpt1")).toMatch(/device name/);
    const root = mkdtempSync(path.join(os.tmpdir(), "notebook-root-"));
    mkdirSync(path.join(root, "trend"));
    expect(validateFileName("trend", root)).toMatch(/already a folder or package/);
    expect(validateFileName("trend_study", root)).toBeNull();
  });

  it("routes /marimo/quantlab to quantlab, not to the quant group that shares its prefix", () => {
    expect(isGroupPath("/marimo/quant/", "quant")).toBe(true);
    expect(isGroupPath("/marimo/quant", "quant")).toBe(true);
    expect(isGroupPath("/marimo/quantlab/", "quant")).toBe(false);
    expect(isGroupPath("/marimo/quantlab/assets/x.js", "quantlab")).toBe(true);
  });
});
