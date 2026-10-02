// @vitest-environment jsdom
/**
 * The process-census study: the classification rules ported from
 * scripts/process_census.py, the pure compute the handler and the page share
 * (headline, owner bars, eight numbers per owner, the launch-strategy model),
 * the SQL the handler writes, and the whole handler on a fake lake with a
 * fake collector (no test samples the machine).
 *
 * Parity with the notebook: the eight numbers of the 13 MCP-server processes
 * in the newest landed snapshot (2026-09-22 16:59) equal pandas' describe +
 * skew + kurt on the same column.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "@/studies/pages/process-census/Page";
import handler, {
  CENSUS_VIEW, ROW_CAP, createProcessCensusHandler, querySchema, snapshotRowsSql, snapshotSummarySql,
} from "../../studies/handlers/process-census";
import {
  LAUNCH_MODES, buildSnapshotRows, emptyProcessCensusBody, chainSockets, classifyProcess, collectorSummary, dashboardChain, filterProcesses, headline,
  launchCost, measuredCensus, ownerBars, ownerLabel, ownerStatistics, type ProcessCensusBody, type ProcessRow, type RawProcess,
} from "@shared/studies/process-census";
import type { StudyContext, StudyLake } from "../../studies/types";

function raw(pid: number, ppid: number, name: string, commandLine: string, megabytes: number, ports: number[] = []): RawProcess {
  return { processIdentifier: pid, parentProcessIdentifier: ppid, processName: name, commandLine, residentMegabytes: megabytes, listeningPorts: ports };
}

describe("classification", () => {
  it("matches the collector's rules in priority order, on either slash", () => {
    const cases: Array<[string, string, string, boolean]> = [
      [String.raw`C:\Program Files\nodejs\node.exe C:\Users\x\npm\node_modules\npm\bin\npx-cli.js -y @azure/mcp@latest`, "node.exe", "claude_code_model_context_protocol_server", true],
      [String.raw`node C:\Users\x\npm-cache\_npx\abc\node_modules\.bin\..\@aikidosec\mcp\dist\index.js`, "node.exe", "claude_code_model_context_protocol_server", false],
      [String.raw`node C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js run dev`, "node.exe", "dashboard_launcher_npm", true],
      [String.raw`node E:\r\ml_dashboard\node_modules\cross-env\src\bin\cross-env.js NODE_ENV=development tsx`, "node.exe", "dashboard_launcher_cross_env", true],
      [String.raw`node E:\r\ml_dashboard\node_modules\tsx\dist\cli.mjs --watch apps/api/main.ts`, "node.exe", "dashboard_launcher_tsx_command_line", true],
      ["node --watch --env-file=.env --import tsx apps/api/main.ts", "node.exe", "dashboard_launcher_node_watch_supervisor", true],
      ["node --env-file=.env --import tsx apps/api/main.ts", "node.exe", "dashboard_server_runtime", false],
      [String.raw`node E:\r\ml_dashboard\node_modules\tsx\dist\preflight.cjs`, "node.exe", "dashboard_server_runtime", false],
      [String.raw`node E:\r\ml_dashboard\dist\index.cjs`, "node.exe", "dashboard_production_runtime", false],
      ["python hardware_node.py", "python.exe", "dashboard_hardware_telemetry_node", false],
      ["esbuild.exe --service=0.25.0 --ping", "esbuild.exe", "dashboard_esbuild_service", false],
      ["python -m marimo run notebooks/x.py", "python.exe", "dashboard_marimo_notebook_server", false],
      ["C:\\WINDOWS\\system32\\cmd.exe /d /s /c something", "cmd.exe", "shell_wrapper", true],
      ["chrome.exe --type=renderer", "chrome.exe", "other_application", false],
    ];
    for (const [commandLine, name, owner, plumbing] of cases) {
      expect(classifyProcess(commandLine, name), commandLine).toEqual({ ownerCategory: owner, isLauncherPlumbing: plumbing });
    }
  });
});

describe("buildSnapshotRows", () => {
  // The five-link chain an npm run dev starts: npm -> cross-env -> tsx -> watch supervisor -> app (the app listens).
  const chain = [
    raw(10, 1, "node.exe", "node npm-cli.js run dev", 54),
    raw(11, 10, "node.exe", "node cross-env/src/bin/cross-env.js NODE_ENV=development tsx", 49),
    raw(12, 11, "node.exe", "node tsx/dist/cli.mjs --watch apps/api/main.ts", 54),
    raw(13, 12, "node.exe", "node ml_dashboard tsx/dist/preflight.cjs --import apps/api/main.ts", 59),
    raw(14, 13, "node.exe", "node ml_dashboard tsx/dist/preflight.cjs --import apps/api/main.ts", 453, [5000, 5000, 4999]),
    raw(20, 1, "chrome.exe", "chrome.exe", 300),
  ];

  it("counts launcher ancestors as depth and sorts the listening ports", () => {
    const rows = buildSnapshotRows(chain);
    const byPid = new Map(rows.map((row) => [row.process_identifier, row]));
    expect([10, 11, 12, 13, 14].map((pid) => byPid.get(pid)?.launcher_chain_depth)).toEqual([0, 1, 2, 3, 4]);
    expect(byPid.get(20)?.launcher_chain_depth).toBe(0);
    expect(byPid.get(14)?.listening_ports).toBe("4999,5000");
    expect(byPid.get(14)?.listening_port_count).toBe(2);
  });

  it("relabels the preflight process that has a preflight child as the tsx watch supervisor", () => {
    const rows = buildSnapshotRows(chain);
    const byPid = new Map(rows.map((row) => [row.process_identifier, row]));
    expect(byPid.get(13)).toMatchObject({ owner_category: "dashboard_launcher_tsx_watch_supervisor", is_launcher_plumbing: true });
    expect(byPid.get(14)).toMatchObject({ owner_category: "dashboard_server_runtime", is_launcher_plumbing: false });
  });

  it("stops at a parent that is neither plumbing nor dashboard-owned, and survives a parent cycle", () => {
    const rows = buildSnapshotRows([
      raw(1, 2, "node.exe", "node --import tsx apps/api/main.ts", 10),
      raw(2, 1, "node.exe", "node --import tsx apps/api/main.ts", 10),
      raw(3, 4, "node.exe", "node --import tsx apps/api/main.ts", 10),
      raw(4, 0, "explorer.exe", "explorer.exe", 10),
    ]);
    const byPid = new Map(rows.map((row) => [row.process_identifier, row]));
    expect(byPid.get(3)?.launcher_chain_depth).toBe(0);
    expect(byPid.get(1)?.launcher_chain_depth).toBeLessThanOrEqual(25);
  });

  it("rounds memory to one decimal and cuts a command line at 2000 characters", () => {
    const [row] = buildSnapshotRows([raw(1, 0, "a.exe", "x".repeat(2500), 12.3456)]);
    expect(row?.resident_memory_megabytes).toBe(12.3);
    expect(row?.command_line).toHaveLength(2000);
  });

  it("writes the collector's summary lines", () => {
    const lines = collectorSummary(buildSnapshotRows(chain), 1500);
    expect(lines[0]).toBe("snapshot rows collected : 6");
    expect(lines[1]).toBe("node.exe processes      : 5");
    expect(lines.some((line) => line.includes("dashboard_server_runtime") && line.includes("453 MB"))).toBe(true);
    expect(lines[lines.length - 1]).toBe("collected in 1.5 s");
  });
});

// A small fixed snapshot for the aggregates.
function row(overrides: Partial<ProcessRow>): ProcessRow {
  return {
    process_identifier: 1, parent_process_identifier: 0, process_name: "node.exe", owner_category: "other_application", is_launcher_plumbing: false,
    resident_memory_megabytes: 10, listening_port_count: 0, listening_ports: "", launcher_chain_depth: 0, command_line: "", ...overrides,
  };
}

const SNAPSHOT: ProcessRow[] = [
  row({ process_identifier: 1, is_launcher_plumbing: true, owner_category: "dashboard_launcher_npm", resident_memory_megabytes: 37.7 }),
  row({ process_identifier: 2, owner_category: "dashboard_server_runtime", resident_memory_megabytes: 453.4, listening_port_count: 1, listening_ports: "5000", launcher_chain_depth: 1 }),
  row({ process_identifier: 3, process_name: "python.exe", owner_category: "dashboard_hardware_telemetry_node", resident_memory_megabytes: 41 }),
  row({ process_identifier: 4, process_name: "Chrome.EXE", resident_memory_megabytes: 200 }),
  row({ process_identifier: 5, process_name: "cmd.exe", is_launcher_plumbing: true, owner_category: "shell_wrapper", resident_memory_megabytes: 2 }),
];

describe("aggregates", () => {
  it("headline counts node.exe only, plumbing against runtime, over the whole snapshot", () => {
    expect(headline(SNAPSHOT)).toEqual({
      plumbingCount: 1, plumbingMegabytes: 37.7, runtimeCount: 1, runtimeMegabytes: 453.4,
      totalCount: 2, totalMegabytes: 37.7 + 453.4, machineProcessCount: 5,
    });
  });

  it("filters by process name (case-insensitive) and by memory floor, inclusive", () => {
    expect(filterProcesses(SNAPSHOT, "all processes", 0)).toHaveLength(5);
    expect(filterProcesses(SNAPSHOT, "node.exe", 0).map((r) => r.process_identifier)).toEqual([1, 2]);
    expect(filterProcesses(SNAPSHOT, "chrome.exe", 0).map((r) => r.process_identifier)).toEqual([4]);
    expect(filterProcesses(SNAPSHOT, "all processes", 41).map((r) => r.process_identifier)).toEqual([2, 3, 4]);
    expect(filterProcesses(SNAPSHOT, "python.exe", 42)).toEqual([]);
  });

  it("ownerBars splits each owner by role and sorts by the asked metric", () => {
    const byCount = ownerBars([...SNAPSHOT, row({ process_identifier: 6, owner_category: "dashboard_server_runtime", resident_memory_megabytes: 1 })], "count");
    expect(byCount[0]).toMatchObject({ ownerCategory: "dashboard_server_runtime", runtimeCount: 2, plumbingCount: 0, totalCount: 2 });
    expect(byCount[0]?.runtimeMegabytes).toBeCloseTo(454.4, 10);
    const byMemory = ownerBars(SNAPSHOT, "memory");
    expect(byMemory.map((bar) => bar.ownerCategory)).toEqual(["dashboard_server_runtime", "other_application", "dashboard_hardware_telemetry_node", "dashboard_launcher_npm", "shell_wrapper"]);
  });

  it("dashboardChain keeps dashboard rows ordered by depth then identifier, and reports who holds a socket", () => {
    const chain = dashboardChain(SNAPSHOT);
    expect(chain.map((r) => r.process_identifier)).toEqual([1, 3, 2]);
    expect(chainSockets(chain)).toEqual({ holding: 1, holdingRuntime: 1, holdingPlumbing: 0, total: 3 });
  });

  it("ownerLabel turns underscores into spaces and cuts long names", () => {
    expect(ownerLabel("shell_wrapper")).toBe("shell wrapper");
    expect(ownerLabel("claude_code_model_context_protocol_server")).toHaveLength(34);
    expect(ownerLabel("claude_code_model_context_protocol_server").endsWith("…")).toBe(true);
  });
});

describe("eight numbers per owner (parity with pandas)", () => {
  const MCP = [5.7, 4.8, 86.5, 78.9, 4.5, 4.5, 5.6, 4.6, 114.8, 98.0, 5.6, 4.6, 97.7];

  it("equals pandas count, mean, median, std, skew, kurt, quartiles, min and max", () => {
    const rows = MCP.map((megabytes, index) =>
      row({ process_identifier: index, owner_category: "claude_code_model_context_protocol_server", resident_memory_megabytes: megabytes }),
    );
    const [entry] = ownerStatistics(rows);
    expect(entry?.ownerCategory).toBe("claude_code_model_context_protocol_server");
    const summary = entry!.summary;
    expect(summary.count).toBe(13);
    expect(summary.mean).toBeCloseTo(39.67692307692308, 10);
    expect(summary.median).toBeCloseTo(5.6, 10);
    expect(summary.standardDeviation).toBeCloseTo(46.34247788379746, 10);
    expect(summary.skewness).toBeCloseTo(0.6397589033040451, 10);
    expect(summary.kurtosis).toBeCloseTo(-1.7292762369426269, 10);
    expect(summary.percentile25).toBeCloseTo(4.6, 10);
    expect(summary.percentile75).toBeCloseTo(86.5, 10);
    expect(summary.minimum).toBe(4.5);
    expect(summary.maximum).toBe(114.8);
  });

  it("reports NaN (null) for skewness below 3 rows and kurtosis below 4, never drops the owner", () => {
    const [one] = ownerStatistics([row({ resident_memory_megabytes: 5 })]);
    expect(one?.summary).toMatchObject({ count: 1, mean: 5, skewness: null, kurtosis: null, standardDeviation: null });
    const [three] = ownerStatistics([1, 2, 4].map((megabytes) => row({ resident_memory_megabytes: megabytes })));
    expect(three?.summary.skewness).not.toBeNull();
    expect(three?.summary.kurtosis).toBeNull();
  });
});

describe("launch strategy model: N = C x (L + R) + 2M + P", () => {
  const npm = LAUNCH_MODES[0]!;
  const lean = LAUNCH_MODES[1]!;
  const none = LAUNCH_MODES[3]!;

  it("has the notebook's four modes with L = 4, 1, 1, 0", () => {
    expect(LAUNCH_MODES.map((mode) => mode.launchersPerChain)).toEqual([4, 1, 1, 0]);
  });

  it("the notebook's defaults (one npm run dev chain, 7 MCP servers, 3 children) make 22 processes, delta 0", () => {
    const cost = launchCost({ chains: 1, launchersPerChain: npm.launchersPerChain, mcpServers: 7, children: 3 });
    expect(cost).toMatchObject({ dashboardTotal: 5, mcpTotal: 14, children: 3, total: 22, baseline: 22, deltaFromBaseline: 0, dashboardRuntime: 1, dashboardLaunchers: 4 });
  });

  it("scales the chain term by C and reports the delta against one npm run dev chain", () => {
    expect(launchCost({ chains: 3, launchersPerChain: lean.launchersPerChain, mcpServers: 0, children: 0 })).toMatchObject({ total: 6, baseline: 5, deltaFromBaseline: 1, dashboardRuntime: 3, dashboardLaunchers: 3 });
    expect(launchCost({ chains: 1, launchersPerChain: none.launchersPerChain, mcpServers: 7, children: 3 }).deltaFromBaseline).toBe(-4);
    expect(launchCost({ chains: 6, launchersPerChain: npm.launchersPerChain, mcpServers: 20, children: 10 }).total).toBe(6 * 5 + 40 + 10);
  });

  it("measures C, L, M and P from a snapshot", () => {
    const measured = measuredCensus([
      ...SNAPSHOT,
      row({ process_identifier: 10, owner_category: "claude_code_model_context_protocol_server", is_launcher_plumbing: true }),
      row({ process_identifier: 11, owner_category: "claude_code_model_context_protocol_server" }),
      row({ process_identifier: 12, owner_category: "dashboard_esbuild_service", process_name: "esbuild.exe" }),
    ]);
    expect(measured).toEqual({ chains: 1, dashboardLauncherCount: 1, launchersPerChain: 1, mcpServers: 1, mcpLaunchers: 1, children: 2 });
    expect(measuredCensus([]).launchersPerChain).toBeNull();
  });
});

describe("SQL", () => {
  it("scopes the history to one quoted recipe and counts node.exe by role", () => {
    const sql = snapshotSummarySql("snapshots_2026_09_22_1659");
    expect(sql).toContain(`FROM "${CENSUS_VIEW}" WHERE recipe = 'snapshots_2026_09_22_1659'`);
    expect(sql).toContain("GROUP BY snapshot_timestamp ORDER BY snapshot_timestamp");
    expect(sql).toContain("lower(process_name) = 'node.exe' AND is_launcher_plumbing");
    expect(sql).toContain("lower(process_name) = 'node.exe' AND NOT is_launcher_plumbing");
  });

  it("reads one snapshot by its epoch milliseconds, caps the rows and cuts the command line", () => {
    const sql = snapshotRowsSql("r", 1790096369795);
    expect(sql).toContain("epoch_ms(snapshot_timestamp) = 1790096369795");
    expect(sql).toContain(`LIMIT ${ROW_CAP + 1}`);
    expect(sql).toContain("substr(coalesce(command_line, ''), 1, 400)");
  });

  it("refuses a query outside its schema", () => {
    expect(() => querySchema.parse({ recipe: "x; DROP TABLE" })).toThrow();
    expect(() => querySchema.parse({ snapshot: "1; DROP" })).toThrow();
    expect(() => querySchema.parse({ snapshot: "-5" })).toThrow();
    expect(querySchema.parse({})).toEqual({ recipe: "", snapshot: "latest" });
    expect(querySchema.parse({ snapshot: "live" }).snapshot).toBe("live");
    expect(querySchema.parse({ snapshot: "1790096369795" }).snapshot).toBe("1790096369795");
  });
});

// ---------- the handler on a fake lake ----------

const FIRST = Date.UTC(2026, 8, 22, 16, 44, 11);
const LAST = Date.UTC(2026, 8, 22, 16, 59, 29);

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
      if (sql.startsWith("SELECT DISTINCT recipe")) return [{ recipe: "snapshots_2026_09_21_0900" }, { recipe: "snapshots_2026_09_22_1659" }] as T[];
      if (sql.includes("AS plumbing_node_count")) {
        return [
          { snapshot_time: FIRST, process_count: 412, node_count: 5, plumbing_node_count: 4, runtime_node_count: 1, plumbing_node_megabytes: 190.5, runtime_node_megabytes: 450 },
          { snapshot_time: LAST, process_count: 419, node_count: 2, plumbing_node_count: 1, runtime_node_count: 1, plumbing_node_megabytes: 37.7, runtime_node_megabytes: 453.4 },
        ] as T[];
      }
      if (sql.includes("AS command_line")) {
        return [
          { process_identifier: 406n, parent_process_identifier: 388, process_name: "node.exe", owner_category: "dashboard_server_runtime", is_launcher_plumbing: false, resident_memory_megabytes: 453.4, listening_port_count: 1n, listening_ports: "5000", launcher_chain_depth: 1, command_line: "node --import tsx apps/api/main.ts" },
          { process_identifier: 388, parent_process_identifier: 1, process_name: "node.exe", owner_category: "dashboard_launcher_node_watch_supervisor", is_launcher_plumbing: true, resident_memory_megabytes: 37.7, listening_port_count: 0, listening_ports: null, launcher_chain_depth: 0, command_line: null },
        ] as T[];
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 120)}`);
    },
  };
}

function context(lake: StudyLake): StudyContext {
  return { lake, notes: [] };
}

const noMachine = async (): Promise<RawProcess[]> => {
  throw new Error("a test must not sample the machine");
};

describe("handler", () => {
  it("declares the landed view, never caches and exports a default handler", () => {
    expect(handler.slug).toBe("process-census");
    expect(handler.datasets).toEqual([CENSUS_VIEW]);
    expect(CENSUS_VIEW).toBe("derived_study_process_census");
    expect(handler.cacheSeconds).toBe(0);
  });

  it("returns an empty body and a note when nothing is landed", async () => {
    const ctx = context(fakeLake([]));
    const body = (await createProcessCensusHandler(noMachine).run(querySchema.parse({}), ctx)) as ProcessCensusBody;
    expect(body.rows).toEqual([]);
    expect(body.recipe).toBeNull();
    expect(body.snapshots).toEqual([]);
    expect(ctx.notes[0]).toContain(CENSUS_VIEW);
  });

  it("serves the newest snapshot of the newest recipe as plain numbers", async () => {
    const log: string[] = [];
    const ctx = context(fakeLake([CENSUS_VIEW], log));
    const body = (await createProcessCensusHandler(noMachine).run(querySchema.parse({}), ctx)) as ProcessCensusBody;
    expect(body.source).toBe("landed");
    expect(body.recipe).toBe("snapshots_2026_09_22_1659");
    expect(body.recipes).toHaveLength(2);
    expect(body.snapshotTime).toBe(LAST);
    expect(body.snapshots).toHaveLength(2);
    expect(body.snapshots[1]).toMatchObject({ processCount: 419, nodeCount: 2, plumbingNodeCount: 1, runtimeNodeCount: 1, runtimeNodeMegabytes: 453.4 });
    expect(body.rows[0]).toMatchObject({ process_identifier: 406, listening_port_count: 1, listening_ports: "5000", is_launcher_plumbing: false });
    expect(body.rows[1]).toMatchObject({ listening_ports: "", command_line: "", is_launcher_plumbing: true });
    expect(body.rowsCapped).toBe(false);
    expect(log.find((sql) => sql.includes("AS command_line"))).toContain(`epoch_ms(snapshot_timestamp) = ${LAST}`);
    expect(log.find((sql) => sql.includes("AS command_line"))).toContain("recipe = 'snapshots_2026_09_22_1659'");
  });

  it("reads a named snapshot and a named recipe, and falls back with a note when they are not there", async () => {
    const log: string[] = [];
    const ctx = context(fakeLake([CENSUS_VIEW], log));
    const body = (await createProcessCensusHandler(noMachine).run(querySchema.parse({ snapshot: String(FIRST), recipe: "snapshots_2026_09_21_0900" }), ctx)) as ProcessCensusBody;
    expect(body.recipe).toBe("snapshots_2026_09_21_0900");
    expect(body.snapshotTime).toBe(FIRST);
    expect(log.find((sql) => sql.includes("AS command_line"))).toContain(`epoch_ms(snapshot_timestamp) = ${FIRST}`);

    const missing = context(fakeLake([CENSUS_VIEW]));
    const fallback = (await createProcessCensusHandler(noMachine).run(querySchema.parse({ snapshot: "5", recipe: "nope" }), missing)) as ProcessCensusBody;
    expect(fallback.recipe).toBe("snapshots_2026_09_22_1659");
    expect(fallback.snapshotTime).toBe(LAST);
    expect(missing.notes.join(" ")).toContain("nope");
    expect(missing.notes.join(" ")).toContain("Snapshot 5");
  });

  it("takes a live snapshot with the injected collector, classified by the collector's rules", async () => {
    const collect = async (): Promise<RawProcess[]> => [
      raw(10, 1, "node.exe", "node npm-cli.js run dev", 54),
      raw(11, 10, "node.exe", "node --import tsx apps/api/main.ts", 450, [5000]),
    ];
    const ctx = context(fakeLake([CENSUS_VIEW]));
    const body = (await createProcessCensusHandler(collect).run(querySchema.parse({ snapshot: "live" }), ctx)) as ProcessCensusBody;
    expect(body.source).toBe("live");
    expect(body.rows.map((r) => [r.owner_category, r.launcher_chain_depth])).toEqual([["dashboard_launcher_npm", 0], ["dashboard_server_runtime", 1]]);
    expect(body.collectorLog[0]).toBe("snapshot rows collected : 2");
    expect(body.snapshotTime).toBeGreaterThan(Date.UTC(2026, 0, 1));
    // The landed history still rides along for the comparison chart.
    expect(body.snapshots).toHaveLength(2);
  });

  it("says so, with no rows, when the live collector fails", async () => {
    const ctx = context(fakeLake([]));
    const body = (await createProcessCensusHandler(noMachine).run(querySchema.parse({ snapshot: "live" }), ctx)) as ProcessCensusBody;
    expect(body.source).toBe("live");
    expect(body.rows).toEqual([]);
    expect(ctx.notes.join(" ")).toContain("a test must not sample the machine");
  });
});

// ---------- the page, rendered from a synthetic body ----------

describe("page", () => {
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = Observer;

  const rows = buildSnapshotRows([
    raw(10, 1, "node.exe", "node npm-cli.js run dev", 54),
    raw(11, 10, "node.exe", "node --watch --env-file=.env --import tsx apps/api/main.ts", 38),
    raw(12, 11, "node.exe", "node --import tsx apps/api/main.ts", 453, [5000]),
    raw(13, 1, "node.exe", "node C:/x/npm-cache/_npx/a/node_modules/.bin/../@aikidosec/mcp/dist/index.js", 5),
    raw(14, 1, "node.exe", "node npx-cli.js -y @azure/mcp", 60),
    raw(15, 1, "python.exe", "python hardware_node.py", 41),
    ...Array.from({ length: 12 }, (_, index) => raw(100 + index, 1, "chrome.exe", "chrome.exe --type=renderer", 80 + index * 13)),
  ]);
  const body: ProcessCensusBody = {
    source: "landed",
    recipe: "snapshots_2026_09_22_1659",
    recipes: ["snapshots_2026_09_22_1659"],
    snapshotTime: LAST,
    snapshots: [
      { snapshotTime: FIRST, processCount: 412, nodeCount: 5, plumbingNodeCount: 4, runtimeNodeCount: 1, plumbingNodeMegabytes: 190.5, runtimeNodeMegabytes: 450 },
      { snapshotTime: LAST, processCount: rows.length, nodeCount: 5, plumbingNodeCount: 3, runtimeNodeCount: 2, plumbingNodeMegabytes: 152, runtimeNodeMegabytes: 458 },
    ],
    rows,
    rowsCapped: false,
    collectorLog: [],
  };

  afterEach(() => {
    vi.restoreAllMocks();
    // The page keeps its controls in the URL; start every test from the defaults.
    window.history.replaceState(null, "", "/");
  });

  function renderPage(requests: string[]) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      const live = String(input).includes("snapshot=live");
      const answer = live ? { ...body, source: "live", collectorLog: ["snapshot rows collected : 18", "collected in 2.0 s"] } : body;
      return new Response(JSON.stringify({ slug: "process-census", notes: [], data: answer }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(createElement(QueryClientProvider, { client }, createElement(Page)));
  }

  it("draws every section from the snapshot and the notebook's default launch model (22 processes)", async () => {
    const requests: string[] = [];
    const { container } = renderPage(requests);
    await waitFor(() => expect(screen.getByText("Right now")).toBeTruthy());
    const text = container.textContent ?? "";
    for (const title of ["Who owns each process", "The chain", "What each launch strategy would cost", "Distribution of resident memory, by owner", "Collector output", "Every numeric column, one panel each"]) {
      expect(text, title).toContain(title);
    }
    expect(text).toContain("22 node processes.");
    expect(text).toContain("Total node.exe");
    expect(requests[0]).toContain("/api/studies/process-census?snapshot=latest");
    expect(container.querySelectorAll(".katex").length).toBeGreaterThan(0);
  });

  it("Take a new snapshot asks the server for a live snapshot and shows the collector's output", async () => {
    const requests: string[] = [];
    const { container } = renderPage(requests);
    await waitFor(() => expect(screen.getByText("Right now")).toBeTruthy());
    fireEvent.click(screen.getByText("Take a new snapshot"));
    await waitFor(() => expect(container.textContent).toContain("snapshot rows collected : 18"));
    expect(requests.some((url) => url.includes("snapshot=live"))).toBe(true);
  });

  it("explains what to run when nothing is landed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ slug: "process-census", notes: ["Not in the lake yet: derived_study_process_census."], data: emptyProcessCensusBody() }), { status: 200 }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(createElement(QueryClientProvider, { client }, createElement(Page)));
    await waitFor(() => expect(container.textContent).toContain("No process snapshot is landed yet"));
    expect(container.textContent).toContain("What each launch strategy would cost");
  });
});
