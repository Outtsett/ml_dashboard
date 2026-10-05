/**
 * Process census: why are there so many node processes? Counts running
 * processes, separates launcher plumbing from runtime, shows owner and launcher
 * chain depth, and feeds the launch-strategy model the page computes live.
 * Replaced notebooks/process_census.py.
 *
 * Two sources, chosen by `snapshot`:
 *   latest | <epoch ms>  a landed snapshot, read from `derived_study_process_census`
 *                        (packages/ml-engine/src/studies/process_census/build.py lands every
 *                        snapshot of data/diagnostics.duckdb; the newest recipe
 *                        is the default)
 *   live                 the notebook's "Take a new snapshot": the machine is
 *                        sampled now with systeminformation and classified by
 *                        the collector's own rules (shared/studies/process-census)
 *
 * One snapshot is a few hundred to a few thousand rows, so every row goes to
 * the browser and the filters, stacked bars, eight numbers and what-if redraw
 * there without a round trip. Nothing is cached: a live snapshot must be new.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  buildSnapshotRows,
  collectorSummary,
  emptyProcessCensusBody,
  type ProcessCensusBody,
  type ProcessRow,
  type RawProcess,
  type SnapshotSummary,
} from "@shared/studies/process-census";

export const CENSUS_VIEW = "derived_study_process_census";
export const ROW_CAP = 6000;
const COMMAND_LINE_CAP = 400;
const BYTES_PER_KILOBYTE = 1024;

export const querySchema = z.object({
  recipe: z.string().regex(/^[a-z0-9_]*$/).max(80).default(""),
  /** `latest`, `live`, or the epoch ms of a landed snapshot. */
  snapshot: z.string().regex(/^(latest|live|\d{1,16})$/).default("latest"),
});
export type ProcessCensusQuery = z.infer<typeof querySchema>;

/** Samples every process now. Injected so a test never touches the machine. */
export type CollectProcesses = () => Promise<RawProcess[]>;

/** systeminformation: processes (name, parent, command line, resident KB) and the listening TCP sockets by pid. */
export const collectWithSystemInformation: CollectProcesses = async () => {
  const si = (await import("systeminformation")).default;
  const [processes, connections] = await Promise.all([si.processes(), si.networkConnections()]);
  const listening = new Map<number, number[]>();
  for (const connection of connections) {
    if (connection.state !== "LISTEN" || !connection.pid || !connection.protocol.startsWith("tcp")) continue;
    const port = Number(connection.localPort);
    if (!Number.isFinite(port)) continue;
    const ports = listening.get(connection.pid) ?? [];
    ports.push(port);
    listening.set(connection.pid, ports);
  }
  return processes.list.map((process) => ({
    processIdentifier: process.pid,
    parentProcessIdentifier: process.parentPid,
    processName: process.name,
    // The collector joined the argument vector with spaces; systeminformation returns the quoted command string.
    commandLine: `${process.command ?? ""} ${process.params ?? ""}`.replace(/"/g, "").replace(/\s+/g, " ").trim(),
    residentMegabytes: (process.memRss ?? 0) / BYTES_PER_KILOBYTE,
    listeningPorts: listening.get(process.pid) ?? [],
  }));
};

function finite(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "bigint" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : 0;
}

function summaryFromRow(row: Record<string, unknown>): SnapshotSummary {
  return {
    snapshotTime: finite(row.snapshot_time),
    processCount: finite(row.process_count),
    nodeCount: finite(row.node_count),
    plumbingNodeCount: finite(row.plumbing_node_count),
    runtimeNodeCount: finite(row.runtime_node_count),
    plumbingNodeMegabytes: finite(row.plumbing_node_megabytes),
    runtimeNodeMegabytes: finite(row.runtime_node_megabytes),
  };
}

function rowFromLake(row: Record<string, unknown>): ProcessRow {
  return {
    process_identifier: finite(row.process_identifier),
    parent_process_identifier: finite(row.parent_process_identifier),
    process_name: String(row.process_name ?? ""),
    owner_category: String(row.owner_category ?? ""),
    is_launcher_plumbing: row.is_launcher_plumbing === true,
    resident_memory_megabytes: finite(row.resident_memory_megabytes),
    listening_port_count: finite(row.listening_port_count),
    listening_ports: String(row.listening_ports ?? ""),
    launcher_chain_depth: finite(row.launcher_chain_depth),
    command_line: String(row.command_line ?? ""),
  };
}

/** Per-snapshot node.exe headline, all in one aggregate over the recipe. */
export function snapshotSummarySql(recipe: string): string {
  const node = "lower(process_name) = 'node.exe'";
  return (
    `SELECT epoch_ms(snapshot_timestamp) AS snapshot_time, count(*) AS process_count, ` +
    `count(*) FILTER (WHERE ${node}) AS node_count, ` +
    `count(*) FILTER (WHERE ${node} AND is_launcher_plumbing) AS plumbing_node_count, ` +
    `count(*) FILTER (WHERE ${node} AND NOT is_launcher_plumbing) AS runtime_node_count, ` +
    `coalesce(sum(resident_memory_megabytes) FILTER (WHERE ${node} AND is_launcher_plumbing), 0) AS plumbing_node_megabytes, ` +
    `coalesce(sum(resident_memory_megabytes) FILTER (WHERE ${node} AND NOT is_launcher_plumbing), 0) AS runtime_node_megabytes ` +
    `FROM ${ident(CENSUS_VIEW)} WHERE recipe = ${text(recipe)} GROUP BY snapshot_timestamp ORDER BY snapshot_timestamp`
  );
}

/** One snapshot's rows; the command line is cut to what the ladder shows. */
export function snapshotRowsSql(recipe: string, snapshotTime: number): string {
  return (
    `SELECT process_identifier, parent_process_identifier, process_name, owner_category, is_launcher_plumbing, ` +
    `resident_memory_megabytes, listening_port_count, coalesce(listening_ports, '') AS listening_ports, launcher_chain_depth, ` +
    `substr(coalesce(command_line, ''), 1, ${num(COMMAND_LINE_CAP)}) AS command_line ` +
    `FROM ${ident(CENSUS_VIEW)} WHERE recipe = ${text(recipe)} AND epoch_ms(snapshot_timestamp) = ${num(snapshotTime)} ` +
    `ORDER BY process_identifier LIMIT ${num(ROW_CAP + 1)}`
  );
}

async function landedHistory(context: StudyContext, requestedRecipe: string): Promise<{ recipe: string | null; recipes: string[]; snapshots: SnapshotSummary[] }> {
  const recipeRows = await context.lake.query<{ recipe: string }>(`SELECT DISTINCT recipe FROM ${ident(CENSUS_VIEW)} ORDER BY recipe`);
  const recipes = recipeRows.map((row) => String(row.recipe));
  let recipe = recipes[recipes.length - 1] ?? null;
  if (requestedRecipe) {
    if (recipes.includes(requestedRecipe)) recipe = requestedRecipe;
    else context.notes.push(`Recipe ${requestedRecipe} is not landed; showing the newest.`);
  }
  if (recipe === null) return { recipe, recipes, snapshots: [] };
  const summaries = await context.lake.query<Record<string, unknown>>(snapshotSummarySql(recipe));
  return { recipe, recipes, snapshots: summaries.map(summaryFromRow) };
}

export function createProcessCensusHandler(collect: CollectProcesses = collectWithSystemInformation): StudyHandler<typeof querySchema, ProcessCensusBody> {
  return {
    slug: "process-census",
    datasets: [CENSUS_VIEW],
    query: querySchema,
    cacheSeconds: 0,
    timeoutMs: 60_000,
    async run(query, context) {
      const live = query.snapshot === "live";
      const landedAvailable = (await missingViews(context, [CENSUS_VIEW])).length === 0;
      const history = landedAvailable ? await landedHistory(context, query.recipe) : { recipe: null, recipes: [], snapshots: [] };

      if (live) {
        const started = Date.now();
        let rows: ProcessRow[] = [];
        try {
          rows = buildSnapshotRows(await collect());
        } catch (error) {
          context.notes.push(`The live snapshot could not be taken: ${error instanceof Error ? error.message : String(error)}`);
          return { ...emptyProcessCensusBody("live"), ...history };
        }
        // Wall-clock digits, like the collector's local `datetime.now()`.
        const snapshotTime = Date.now() - new Date().getTimezoneOffset() * 60_000;
        context.notes.push("A live snapshot is sampled by the dashboard server; command lines the operating system hides from it classify as other_application.");
        return {
          source: "live",
          recipe: history.recipe,
          recipes: history.recipes,
          snapshotTime,
          snapshots: history.snapshots,
          rows: rows.slice(0, ROW_CAP),
          rowsCapped: rows.length > ROW_CAP,
          collectorLog: collectorSummary(rows, Date.now() - started),
        };
      }

      if (!landedAvailable || history.recipe === null || history.snapshots.length === 0) {
        return { ...emptyProcessCensusBody("landed"), ...history };
      }
      const wanted = /^\d+$/.test(query.snapshot) ? Number(query.snapshot) : null;
      let chosen = history.snapshots[history.snapshots.length - 1] as SnapshotSummary;
      if (wanted !== null) {
        const match = history.snapshots.find((snapshot) => snapshot.snapshotTime === wanted);
        if (match) chosen = match;
        else context.notes.push(`Snapshot ${wanted} is not in recipe ${history.recipe}; showing the newest.`);
      }
      const rowResult = await context.lake.query<Record<string, unknown>>(snapshotRowsSql(history.recipe, chosen.snapshotTime));
      return {
        source: "landed",
        recipe: history.recipe,
        recipes: history.recipes,
        snapshotTime: chosen.snapshotTime,
        snapshots: history.snapshots,
        rows: rowResult.slice(0, ROW_CAP).map(rowFromLake),
        rowsCapped: rowResult.length > ROW_CAP,
        collectorLog: [],
      };
    },
  };
}

const handler = createProcessCensusHandler();
export default handler;
