/**
 * Process census: the response body and the pure compute the handler and the
 * page share.
 *
 * The notebook this replaced (notebooks/process_census.py) counted running
 * processes, separated LAUNCHER PLUMBING (a shell wrapper that starts the next
 * thing and idles) from RUNTIME (a process doing work), and modelled what each
 * launch strategy would cost with
 *
 *     N_total = C x (L + R) + 2M + P
 *
 * The snapshots are landed from data/diagnostics.duckdb by
 * packages/ml-engine/src/studies/process_census/build.py (`derived_study_process_census`). A
 * "live" snapshot is collected by the handler itself with the same rules, which
 * are ported here from scripts/process_census.py (CLASSIFICATION_RULES,
 * launcher_chain_depth and the tsx-watch supervisor relabel).
 */

import { eightNumberSummary } from "../lens/stats";
import type { EightNumberSummary } from "../analytics/types";

/** One process in one snapshot: the notebook's own columns. */
export interface ProcessRow {
  process_identifier: number;
  parent_process_identifier: number;
  process_name: string;
  owner_category: string;
  is_launcher_plumbing: boolean;
  resident_memory_megabytes: number;
  listening_port_count: number;
  /** Comma-separated, sorted. */
  listening_ports: string;
  launcher_chain_depth: number;
  command_line: string;
}

/** The node.exe headline of one snapshot, computed in SQL for the history. */
export interface SnapshotSummary {
  /** Wall-clock digits as the collector stamped them (local time), epoch ms. */
  snapshotTime: number;
  processCount: number;
  nodeCount: number;
  plumbingNodeCount: number;
  runtimeNodeCount: number;
  plumbingNodeMegabytes: number;
  runtimeNodeMegabytes: number;
}

export interface ProcessCensusBody {
  source: "landed" | "live";
  recipe: string | null;
  recipes: string[];
  /** The snapshot the rows belong to, epoch ms of its wall-clock digits; null when nothing is landed or collected. */
  snapshotTime: number | null;
  /** Every landed snapshot of the recipe, oldest first. */
  snapshots: SnapshotSummary[];
  rows: ProcessRow[];
  rowsCapped: boolean;
  /** The collector's summary lines (what scripts/process_census.py prints), for a live snapshot. */
  collectorLog: string[];
}

export function emptyProcessCensusBody(source: "landed" | "live" = "landed"): ProcessCensusBody {
  return { source, recipe: null, recipes: [], snapshotTime: null, snapshots: [], rows: [], rowsCapped: false, collectorLog: [] };
}

export const ROLE_PLUMBING = "launcher plumbing";
export const ROLE_RUNTIME = "runtime";
export type Role = typeof ROLE_PLUMBING | typeof ROLE_RUNTIME;

export function roleOf(row: Pick<ProcessRow, "is_launcher_plumbing">): Role {
  return row.is_launcher_plumbing ? ROLE_PLUMBING : ROLE_RUNTIME;
}

// ---------- classification (ported from scripts/process_census.py) ----------

interface Rule {
  ownerCategory: string;
  isLauncher: boolean;
  pattern: RegExp;
}

/** Every classification rule, in priority order: the collector's CLASSIFICATION_RULES. */
export const CLASSIFICATION_RULES: readonly Rule[] = [
  { ownerCategory: "claude_code_model_context_protocol_server", isLauncher: true, pattern: /npx-cli\.js/i },
  {
    ownerCategory: "claude_code_model_context_protocol_server",
    isLauncher: false,
    pattern: /_npx|modelcontextprotocol|mcp-server|\/mcp\/|chrome-devtools-mcp|desktop-commander|firebase-tools|mongodb-mcp|@playwright\/mcp|aikidosec|notebooklm-mcp/i,
  },
  { ownerCategory: "dashboard_launcher_npm", isLauncher: true, pattern: /npm-cli\.js.*run\s+dev/i },
  { ownerCategory: "dashboard_launcher_cross_env", isLauncher: true, pattern: /cross-env\/src\/bin\/cross-env\.js/i },
  { ownerCategory: "dashboard_launcher_tsx_command_line", isLauncher: true, pattern: /tsx\/dist\/cli\.mjs/i },
  { ownerCategory: "dashboard_launcher_node_watch_supervisor", isLauncher: true, pattern: /--watch.*--import\s+tsx.*apps\/api\/main\.ts/i },
  { ownerCategory: "dashboard_server_runtime", isLauncher: false, pattern: /ml_dashboard.*tsx\/dist\/preflight/i },
  { ownerCategory: "dashboard_server_runtime", isLauncher: false, pattern: /--import\s+tsx.*apps\/api\/main\.ts/i },
  { ownerCategory: "dashboard_production_runtime", isLauncher: false, pattern: /ml_dashboard.*dist\/index\.cjs/i },
  { ownerCategory: "dashboard_hardware_telemetry_node", isLauncher: false, pattern: /hardware_node\.py/i },
  { ownerCategory: "dashboard_esbuild_service", isLauncher: false, pattern: /esbuild.*--service=/i },
  { ownerCategory: "dashboard_marimo_notebook_server", isLauncher: false, pattern: /marimo\s+(run|edit)/i },
];

/** Backslashes to forward slashes so one pattern matches either spelling. */
export function normalizeCommandLine(commandLine: string): string {
  return commandLine.replace(/\\/g, "/");
}

/** The owner category and whether the process is launcher plumbing. */
export function classifyProcess(commandLine: string, processName: string): { ownerCategory: string; isLauncherPlumbing: boolean } {
  const normalized = normalizeCommandLine(commandLine);
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(normalized)) return { ownerCategory: rule.ownerCategory, isLauncherPlumbing: rule.isLauncher };
  }
  if (["cmd.exe", "conhost.exe"].includes(processName.toLowerCase())) return { ownerCategory: "shell_wrapper", isLauncherPlumbing: true };
  return { ownerCategory: "other_application", isLauncherPlumbing: false };
}

/** What a collector (psutil, systeminformation) sees of one process. */
export interface RawProcess {
  processIdentifier: number;
  parentProcessIdentifier: number;
  processName: string;
  commandLine: string;
  residentMegabytes: number;
  listeningPorts: number[];
}

const MAXIMUM_ANCESTOR_STEPS = 25;
const MAXIMUM_COMMAND_LINE_LENGTH = 2000;

/**
 * The collector's whole pass over one snapshot: classify each process, count
 * the launcher ancestors above it (`launcher_chain_depth`), then relabel a
 * `tsx --watch` supervisor (both it and the app carry the same preflight
 * command line; the parent of a preflight process only watches and restarts).
 */
export function buildSnapshotRows(raw: readonly RawProcess[]): ProcessRow[] {
  const byPid = new Map<number, ProcessRow>();
  for (const process of raw) {
    const ports = [...new Set(process.listeningPorts)].sort((a, b) => a - b);
    const commandLine = process.commandLine.slice(0, MAXIMUM_COMMAND_LINE_LENGTH);
    const { ownerCategory, isLauncherPlumbing } = classifyProcess(commandLine, process.processName);
    byPid.set(process.processIdentifier, {
      process_identifier: process.processIdentifier,
      parent_process_identifier: process.parentProcessIdentifier || 0,
      process_name: process.processName,
      owner_category: ownerCategory,
      is_launcher_plumbing: isLauncherPlumbing,
      resident_memory_megabytes: Math.round(process.residentMegabytes * 10) / 10,
      listening_port_count: ports.length,
      listening_ports: ports.join(","),
      launcher_chain_depth: 0,
      command_line: commandLine,
    });
  }
  // Depth = how many ancestors share the dashboard / MCP launch chain.
  for (const row of byPid.values()) {
    let depth = 0;
    let cursor = row.parent_process_identifier;
    let guard = 0;
    while (byPid.has(cursor) && guard < MAXIMUM_ANCESTOR_STEPS) {
      const parent = byPid.get(cursor) as ProcessRow;
      if (!(parent.is_launcher_plumbing || parent.owner_category.startsWith("dashboard"))) break;
      depth += 1;
      cursor = parent.parent_process_identifier;
      guard += 1;
    }
    row.launcher_chain_depth = depth;
  }
  const runtimeParents = new Set<number>();
  for (const row of byPid.values()) if (row.owner_category === "dashboard_server_runtime") runtimeParents.add(row.parent_process_identifier);
  for (const [pid, row] of byPid) {
    if (row.owner_category !== "dashboard_server_runtime") continue;
    if (runtimeParents.has(pid)) {
      row.owner_category = "dashboard_launcher_tsx_watch_supervisor";
      row.is_launcher_plumbing = true;
    }
  }
  return [...byPid.values()];
}

/** The lines scripts/process_census.py prints after a snapshot. */
export function collectorSummary(rows: readonly ProcessRow[], elapsedMilliseconds: number): string[] {
  const node = rows.filter(isNode);
  const lines = [
    `snapshot rows collected : ${rows.length}`,
    `node.exe processes      : ${node.length}`,
  ];
  const categories = [...new Set(node.map((row) => row.owner_category))].sort();
  for (const category of categories) {
    const group = node.filter((row) => row.owner_category === category);
    const megabytes = group.reduce((sum, row) => sum + row.resident_memory_megabytes, 0);
    lines.push(`  ${category.padEnd(46)} ${String(group.length).padStart(3)}  ${megabytes.toFixed(0).padStart(8)} MB`);
  }
  lines.push(`collected in ${(elapsedMilliseconds / 1000).toFixed(1)} s`);
  return lines;
}

// ---------- the notebook's aggregates ----------

export function isNode(row: Pick<ProcessRow, "process_name">): boolean {
  return row.process_name.toLowerCase() === "node.exe";
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

export interface Headline {
  plumbingCount: number;
  plumbingMegabytes: number;
  runtimeCount: number;
  runtimeMegabytes: number;
  totalCount: number;
  totalMegabytes: number;
  machineProcessCount: number;
}

/** "Right now": node.exe plumbing against runtime across the whole snapshot (no filter applied). */
export function headline(rows: readonly ProcessRow[]): Headline {
  const node = rows.filter(isNode);
  const plumbing = node.filter((row) => row.is_launcher_plumbing);
  const runtime = node.filter((row) => !row.is_launcher_plumbing);
  return {
    plumbingCount: plumbing.length,
    plumbingMegabytes: sum(plumbing.map((row) => row.resident_memory_megabytes)),
    runtimeCount: runtime.length,
    runtimeMegabytes: sum(runtime.map((row) => row.resident_memory_megabytes)),
    totalCount: node.length,
    totalMegabytes: sum(node.map((row) => row.resident_memory_megabytes)),
    machineProcessCount: rows.length,
  };
}

export const PROCESS_NAME_OPTIONS = ["node.exe", "python.exe", "all processes"] as const;
export type ProcessNameFilter = (typeof PROCESS_NAME_OPTIONS)[number];

/** The notebook's "Show processes named" and "Hide anything under (MB)". */
export function filterProcesses(rows: readonly ProcessRow[], processName: string, minimumMegabytes: number): ProcessRow[] {
  return rows.filter((row) => {
    if (processName !== "all processes" && row.process_name.toLowerCase() !== processName.toLowerCase()) return false;
    return row.resident_memory_megabytes >= minimumMegabytes;
  });
}

export interface OwnerRoleTotal {
  ownerCategory: string;
  role: Role;
  processCount: number;
  residentMegabytes: number;
}

/** The notebook's groupby (owner_category, is_launcher_plumbing) with count and summed memory. */
export function ownerRoleTotals(rows: readonly ProcessRow[]): OwnerRoleTotal[] {
  const groups = new Map<string, OwnerRoleTotal>();
  for (const row of rows) {
    const role = roleOf(row);
    const key = `${row.owner_category}|${role}`;
    const group = groups.get(key) ?? { ownerCategory: row.owner_category, role, processCount: 0, residentMegabytes: 0 };
    group.processCount += 1;
    group.residentMegabytes += row.resident_memory_megabytes;
    groups.set(key, group);
  }
  return [...groups.values()];
}

export interface OwnerBar {
  ownerCategory: string;
  plumbingCount: number;
  runtimeCount: number;
  plumbingMegabytes: number;
  runtimeMegabytes: number;
  totalCount: number;
  totalMegabytes: number;
}

/** One bar per owner with both roles stacked, sorted by `by` descending. */
export function ownerBars(rows: readonly ProcessRow[], by: "count" | "memory"): OwnerBar[] {
  const bars = new Map<string, OwnerBar>();
  for (const total of ownerRoleTotals(rows)) {
    const bar = bars.get(total.ownerCategory) ?? {
      ownerCategory: total.ownerCategory, plumbingCount: 0, runtimeCount: 0, plumbingMegabytes: 0, runtimeMegabytes: 0, totalCount: 0, totalMegabytes: 0,
    };
    if (total.role === ROLE_PLUMBING) {
      bar.plumbingCount += total.processCount;
      bar.plumbingMegabytes += total.residentMegabytes;
    } else {
      bar.runtimeCount += total.processCount;
      bar.runtimeMegabytes += total.residentMegabytes;
    }
    bar.totalCount = bar.plumbingCount + bar.runtimeCount;
    bar.totalMegabytes = bar.plumbingMegabytes + bar.runtimeMegabytes;
    bars.set(total.ownerCategory, bar);
  }
  const list = [...bars.values()];
  list.sort((a, b) => (by === "count" ? b.totalCount - a.totalCount : b.totalMegabytes - a.totalMegabytes) || a.ownerCategory.localeCompare(b.ownerCategory));
  return list;
}

/** The chain ladder: dashboard-owned rows by depth, then process identifier. */
export function dashboardChain(rows: readonly ProcessRow[]): ProcessRow[] {
  return rows
    .filter((row) => row.owner_category.startsWith("dashboard"))
    .sort((a, b) => a.launcher_chain_depth - b.launcher_chain_depth || a.process_identifier - b.process_identifier);
}

export interface OwnerStatistics {
  ownerCategory: string;
  summary: EightNumberSummary;
}

/** Eight numbers of resident memory per owner (pandas estimators: sample skew and excess kurtosis, NaN below 3 and 4 rows). */
export function ownerStatistics(rows: readonly ProcessRow[]): OwnerStatistics[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const values = groups.get(row.owner_category) ?? [];
    values.push(row.resident_memory_megabytes);
    groups.set(row.owner_category, values);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ownerCategory, values]) => ({ ownerCategory, summary: eightNumberSummary(values) }));
}

// ---------- what a launch strategy costs ----------

export interface LaunchMode {
  key: string;
  label: string;
  /** L: idle launcher processes above the app, per chain. */
  launchersPerChain: number;
}

/** The notebook's four launch modes; L is what sets the cost. */
export const LAUNCH_MODES: readonly LaunchMode[] = [
  { key: "npm_run_dev", label: "npm run dev: npm, cross-env, tsx, nested node watch, app", launchersPerChain: 4 },
  { key: "dev_lean", label: "npm run dev:lean: node --watch, one supervisor, app", launchersPerChain: 1 },
  { key: "direct_watch", label: "node --watch --env-file=.env --import tsx (direct)", launchersPerChain: 1 },
  { key: "direct_no_watch", label: "node --env-file=.env --import tsx (direct, no watch)", launchersPerChain: 0 },
];

/** Runtime processes per chain: the one that actually serves. Fixed at 1. */
export const RUNTIME_PER_CHAIN = 1;
/** The baseline the notebook's delta is measured against: one `npm run dev` chain (L = 4). */
export const BASELINE_LAUNCHERS_PER_CHAIN = 4;

export interface LaunchCostInput {
  chains: number;
  launchersPerChain: number;
  mcpServers: number;
  children: number;
}

export interface LaunchCost {
  dashboardTotal: number;
  dashboardRuntime: number;
  dashboardLaunchers: number;
  mcpTotal: number;
  children: number;
  total: number;
  baseline: number;
  deltaFromBaseline: number;
}

/** N_total = C x (L + R) + 2M + P, and the notebook's delta against one `npm run dev` chain. */
export function launchCost(input: LaunchCostInput): LaunchCost {
  const dashboardTotal = input.chains * (input.launchersPerChain + RUNTIME_PER_CHAIN);
  const mcpTotal = 2 * input.mcpServers;
  const total = dashboardTotal + mcpTotal + input.children;
  const baseline = 1 * (BASELINE_LAUNCHERS_PER_CHAIN + RUNTIME_PER_CHAIN) + 2 * input.mcpServers + input.children;
  return {
    dashboardTotal,
    dashboardRuntime: input.chains * RUNTIME_PER_CHAIN,
    dashboardLaunchers: input.chains * input.launchersPerChain,
    mcpTotal,
    children: input.children,
    total,
    baseline,
    deltaFromBaseline: total - baseline,
  };
}

export interface MeasuredCensus {
  /** C: dashboard runtime processes (each chain has exactly one). */
  chains: number;
  /** Dashboard launcher processes, all chains. */
  dashboardLauncherCount: number;
  /** L: launchers per chain, null when no chain is running. */
  launchersPerChain: number | null;
  /** M: MCP server processes that run the server (the `2M` counts each with its `npx` launcher). */
  mcpServers: number;
  mcpLaunchers: number;
  /** P: hardware-telemetry and esbuild children. */
  children: number;
}

const DASHBOARD_RUNTIME_OWNERS = ["dashboard_server_runtime", "dashboard_production_runtime"];
const CHILD_OWNERS = ["dashboard_hardware_telemetry_node", "dashboard_esbuild_service"];
const MCP_OWNER = "claude_code_model_context_protocol_server";

/** C, L, M and P as this snapshot actually shows them (counted from the rows, every process name). */
export function measuredCensus(rows: readonly ProcessRow[]): MeasuredCensus {
  const chains = rows.filter((row) => DASHBOARD_RUNTIME_OWNERS.includes(row.owner_category)).length;
  const dashboardLauncherCount = rows.filter((row) => row.owner_category.startsWith("dashboard_launcher")).length;
  return {
    chains,
    dashboardLauncherCount,
    launchersPerChain: chains > 0 ? dashboardLauncherCount / chains : null,
    mcpServers: rows.filter((row) => row.owner_category === MCP_OWNER && !row.is_launcher_plumbing).length,
    mcpLaunchers: rows.filter((row) => row.owner_category === MCP_OWNER && row.is_launcher_plumbing).length,
    children: rows.filter((row) => CHILD_OWNERS.includes(row.owner_category)).length,
  };
}

/** Listening sockets among the dashboard chain: how many rows hold one, and whether they are the deepest row of their chain. */
export function chainSockets(chain: readonly ProcessRow[]): { holding: number; holdingRuntime: number; holdingPlumbing: number; total: number } {
  const holding = chain.filter((row) => row.listening_port_count > 0);
  return {
    holding: holding.length,
    holdingRuntime: holding.filter((row) => !row.is_launcher_plumbing).length,
    holdingPlumbing: holding.filter((row) => row.is_launcher_plumbing).length,
    total: chain.length,
  };
}

/** Shorten an owner category for an axis: underscores to spaces, cut with an ellipsis. */
export function ownerLabel(ownerCategory: string, limit = 34): string {
  const words = ownerCategory.replace(/_/g, " ");
  return words.length <= limit ? words : `${words.slice(0, limit - 1)}…`;
}
