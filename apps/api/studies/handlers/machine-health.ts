/**
 * Machine health: every application crash and hang, kernel bugcheck and hard
 * reset from the Windows event logs, the time between unclean shutdowns, which
 * programs crash and whether a dump was kept, the dump files on disk, a
 * background-process snapshot, and the configuration changes made (each with
 * its exact revert command). Replaced dotfiles/diagnostics/notebooks/machine_health.py.
 *
 * Reads seven views landed by packages/ml-engine/src/studies/machine_health/build.py from the
 * crash indexer's DuckDB file (`derived_study_machine_health_<table>`, one
 * recipe per landing; the newest recipe is the default). Event times are
 * Pacific wall clock, converted at landing exactly as the notebook did.
 *
 * The day window and the kind picker are applied here in SQL (a window is one
 * aggregate, not 722 rows of browser filtering); the gap, histogram and
 * per-column statistics are computed from the returned arrays by the shared
 * pure functions the page also uses. `message` and `event_data_json` are never
 * selected for a list.
 */

import { z } from "zod";
import { ident, num, text, textList } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  CRASH_KINDS,
  PROCESS_COLUMNS,
  UNCLEAN_SHUTDOWN_KINDS,
  emptyColumns,
  emptyMachineHealthBody,
  parseList,
  pivotComparison,
  type ConfigurationRow,
  type CoverageRow,
  type DumpRow,
  type EventRow,
  type IndexRun,
  type KindCount,
  type MachineHealthBody,
  type MachineSnapshot,
  type ProcessColumn,
  type ProcessGroup,
  type StartupRow,
  type WeekCount,
} from "@shared/studies/machine-health";

const PREFIX = "derived_study_machine_health_";
export const EVENTS_VIEW = `${PREFIX}crash_event_with_dump`;
export const DUMPS_VIEW = `${PREFIX}dump_file`;
export const PROCESSES_VIEW = `${PREFIX}process_snapshot`;
export const MEMORY_VIEW = `${PREFIX}memory_snapshot`;
export const STARTUP_VIEW = `${PREFIX}startup_snapshot`;
export const CONFIGURATION_VIEW = `${PREFIX}configuration_change`;
export const INDEX_RUN_VIEW = `${PREFIX}index_run`;
export const VIEWS = [EVENTS_VIEW, DUMPS_VIEW, PROCESSES_VIEW, MEMORY_VIEW, STARTUP_VIEW, CONFIGURATION_VIEW, INDEX_RUN_VIEW] as const;

const EVENT_ROW_CAP = 3000;
const COVERAGE_ROW_CAP = 400;
const DUMP_ROW_CAP = 2000;
const PROCESS_ROW_CAP = 20_000;
const COMPARISON_ROW_CAP = 300;
const TABLE_ROW_CAP = 500;

export const querySchema = z.object({
  recipe: z.string().regex(/^[a-z0-9_]*$/).max(80).default(""),
  /** The day window in days since the first local day (the notebook's range slider); -1 for the end means the last day. */
  dayStart: z.coerce.number().int().min(0).max(100_000).default(0),
  dayEnd: z.coerce.number().int().min(-1).max(100_000).default(-1),
  /** Event kinds hidden from the strip and the weekly bars, separated by "|". */
  hiddenKinds: z.string().max(2000).default(""),
  /** A snapshot label of the background-process section; empty is the first label. */
  snapshotLabel: z.string().max(200).default(""),
});
export type MachineHealthQuery = z.infer<typeof querySchema>;

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function count(value: unknown): number {
  return finite(value) ?? 0;
}

function words(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function recipeFilter(recipe: string): string {
  return `recipe = ${text(recipe)}`;
}

async function chooseRecipe(context: StudyContext, query: MachineHealthQuery): Promise<{ recipe: string | null; recipes: string[] }> {
  const rows = await context.lake.query<{ recipe: string }>(`SELECT DISTINCT recipe FROM ${ident(EVENTS_VIEW)} ORDER BY recipe`);
  const recipes = rows.map((row) => String(row.recipe));
  if (query.recipe) {
    if (recipes.includes(query.recipe)) return { recipe: query.recipe, recipes };
    context.notes.push(`Recipe ${query.recipe} is not landed; showing the newest.`);
  }
  return { recipe: recipes[recipes.length - 1] ?? null, recipes };
}

/** One SQL `WHERE` body for the events the picker and the day window keep. */
export function selectionClause(recipe: string, query: MachineHealthQuery, firstDay: string, totalDays: number): string {
  const parts = [recipeFilter(recipe)];
  const hidden = parseList(query.hiddenKinds);
  if (hidden.length > 0) parts.push(`event_kind NOT IN (${textList(hidden)})`);
  const dayEnd = query.dayEnd < 0 ? totalDays : query.dayEnd;
  const start = `(CAST(${text(firstDay)} AS TIMESTAMP) + to_days(${num(query.dayStart)}))`;
  const end = `(CAST(${text(firstDay)} AS TIMESTAMP) + to_days(${num(dayEnd + 1)}))`;
  parts.push(`event_local_timestamp >= ${start}`, `event_local_timestamp < ${end}`);
  return parts.join(" AND ");
}

async function eventsSection(context: StudyContext, recipe: string, query: MachineHealthQuery): Promise<MachineHealthBody["events"]> {
  const all = ident(EVENTS_VIEW);
  const [span] = await context.lake.query<Record<string, unknown>>(
    `SELECT count(*) AS total_event_count, strftime(min(event_local_timestamp), '%Y-%m-%d') AS first_day, ` +
      `strftime(max(event_local_timestamp), '%Y-%m-%d') AS last_day, ` +
      `date_diff('day', CAST(date_trunc('day', min(event_local_timestamp)) AS DATE), CAST(date_trunc('day', max(event_local_timestamp)) AS DATE)) + 1 AS total_days ` +
      `FROM ${all} WHERE ${recipeFilter(recipe)}`,
  );
  const firstDay = words(span?.first_day);
  const totalDays = count(span?.total_days);
  const kinds = await context.lake.query<Record<string, unknown>>(
    `SELECT event_kind, count(*) AS event_count FROM ${all} WHERE ${recipeFilter(recipe)} GROUP BY event_kind ORDER BY event_kind`,
  );
  const kindCounts: KindCount[] = kinds.map((row) => ({ eventKind: String(row.event_kind), eventCount: count(row.event_count) }));
  if (!firstDay) {
    return { totalEventCount: 0, firstDay: null, lastDay: null, totalDays: 0, kinds: kindCounts, selectedCount: 0, rows: [], weeks: [], rowsCapped: false };
  }
  const where = selectionClause(recipe, query, firstDay, totalDays);
  const [selected] = await context.lake.query<Record<string, unknown>>(`SELECT count(*) AS selected_count FROM ${all} WHERE ${where}`);
  const rowResult = await context.lake.query<Record<string, unknown>>(
    `SELECT epoch_ms(event_local_timestamp) AS local_time, event_kind, application_name, bugcheck_code, exception_code, ` +
      `windows_error_reporting_bucket, faulting_module_name, dump_path IS NOT NULL AS dump_kept ` +
      `FROM ${all} WHERE ${where} ORDER BY event_local_timestamp, event_record_identifier LIMIT ${num(EVENT_ROW_CAP)}`,
  );
  const rows: EventRow[] = rowResult.map((row) => ({
    localTime: count(row.local_time),
    eventKind: String(row.event_kind),
    applicationName: words(row.application_name),
    bugcheckCode: words(row.bugcheck_code),
    exceptionCode: words(row.exception_code),
    windowsErrorReportingBucket: words(row.windows_error_reporting_bucket),
    faultingModuleName: words(row.faulting_module_name),
    dumpKept: row.dump_kept === true,
  }));
  const weekRows = await context.lake.query<Record<string, unknown>>(
    `SELECT epoch_ms(CAST(date_trunc('week', event_local_timestamp + INTERVAL 1 DAY) - INTERVAL 1 DAY AS TIMESTAMP)) AS week_start, ` +
      `event_kind, count(*) AS event_count FROM ${all} WHERE ${where} GROUP BY ALL ORDER BY 1, 2`,
  );
  const weeks: WeekCount[] = weekRows.map((row) => ({ weekStart: count(row.week_start), eventKind: String(row.event_kind), eventCount: count(row.event_count) }));
  const selectedCount = count(selected?.selected_count);
  return {
    totalEventCount: count(span?.total_event_count),
    firstDay,
    lastDay: words(span?.last_day),
    totalDays,
    kinds: kindCounts,
    selectedCount,
    rows,
    weeks,
    rowsCapped: selectedCount > rows.length,
  };
}

async function shutdownSection(context: StudyContext, recipe: string): Promise<MachineHealthBody["shutdowns"]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    `SELECT CAST(epoch_us(event_local_timestamp) AS DOUBLE) / 1000.0 AS local_time, strftime(event_local_timestamp, '%Y-%m-%d') AS local_day ` +
      `FROM ${ident(EVENTS_VIEW)} WHERE ${recipeFilter(recipe)} AND event_kind IN (${textList(UNCLEAN_SHUTDOWN_KINDS)}) ORDER BY event_local_timestamp`,
  );
  const [first] = await context.lake.query<Record<string, unknown>>(
    `SELECT strftime(min(event_local_timestamp), '%Y-%m-%d') AS first_day FROM ${ident(EVENTS_VIEW)} WHERE ${recipeFilter(recipe)}`,
  );
  return {
    uncleanShutdownCount: rows.length,
    firstEventDay: words(first?.first_day),
    localTimes: rows.map((row) => count(row.local_time)),
  };
}

async function coverageSection(context: StudyContext, recipe: string): Promise<MachineHealthBody["coverage"]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    `WITH grouped AS (SELECT application_name, event_kind, count(*) AS event_count, count(dump_path) AS events_with_dump, ` +
      `count(*) - count(dump_path) AS events_without_dump FROM ${ident(EVENTS_VIEW)} WHERE ${recipeFilter(recipe)} ` +
      `AND event_kind IN (${textList(CRASH_KINDS)}) GROUP BY ALL), ` +
      `totals AS (SELECT application_name, sum(event_count) AS total FROM grouped GROUP BY application_name) ` +
      `SELECT grouped.*, totals.total FROM grouped JOIN totals USING (application_name) ` +
      `ORDER BY totals.total DESC, application_name, event_kind LIMIT ${num(COVERAGE_ROW_CAP)}`,
  );
  const result: CoverageRow[] = rows.map((row) => ({
    applicationName: words(row.application_name) ?? "(unknown)",
    eventKind: String(row.event_kind),
    eventCount: count(row.event_count),
    eventsWithDump: count(row.events_with_dump),
    eventsWithoutDump: count(row.events_without_dump),
  }));
  return { rows: result, applicationCount: new Set(result.map((row) => row.applicationName)).size };
}

async function dumpSection(context: StudyContext, recipe: string): Promise<MachineHealthBody["dumps"]> {
  const view = ident(DUMPS_VIEW);
  const rows = await context.lake.query<Record<string, unknown>>(
    `SELECT dump_path, dump_kind, application_name, process_identifier, size_megabytes, epoch_ms(created_timestamp) AS created_time, ` +
      `epoch_ms(modified_timestamp) AS modified_time FROM ${view} WHERE ${recipeFilter(recipe)} ORDER BY modified_timestamp DESC, dump_path LIMIT ${num(DUMP_ROW_CAP)}`,
  );
  const [total] = await context.lake.query<Record<string, unknown>>(
    `SELECT count(*) AS file_count, coalesce(sum(size_megabytes), 0) AS total_megabytes FROM ${view} WHERE ${recipeFilter(recipe)}`,
  );
  const result: DumpRow[] = rows.map((row) => ({
    dumpPath: String(row.dump_path),
    dumpKind: String(row.dump_kind),
    applicationName: words(row.application_name),
    processIdentifier: finite(row.process_identifier),
    sizeMegabytes: finite(row.size_megabytes),
    createdTime: finite(row.created_time),
    modifiedTime: finite(row.modified_time),
  }));
  return { rows: result, fileCount: count(total?.file_count), totalMegabytes: count(total?.total_megabytes) };
}

async function processSection(context: StudyContext, recipe: string, query: MachineHealthQuery): Promise<{ section: MachineHealthBody["processes"]; labels: string[] }> {
  const memory = ident(MEMORY_VIEW);
  const snapshots = ident(PROCESSES_VIEW);
  const labelRows = await context.lake.query<{ snapshot_label: string }>(
    `SELECT DISTINCT snapshot_label FROM ${memory} WHERE ${recipeFilter(recipe)} ORDER BY snapshot_label`,
  );
  const labels = labelRows.map((row) => String(row.snapshot_label));
  let label = labels[0] ?? null;
  if (query.snapshotLabel) {
    if (labels.includes(query.snapshotLabel)) label = query.snapshotLabel;
    else context.notes.push(`Snapshot ${query.snapshotLabel} does not exist; showing ${label ?? "none"}.`);
  }
  if (label === null) {
    return { section: { labels, label: null, machine: null, groups: [], columns: emptyColumns(), processCount: 0 }, labels };
  }
  const scope = `${recipeFilter(recipe)} AND snapshot_label = ${text(label)}`;
  const [machineRow] = await context.lake.query<Record<string, unknown>>(
    `SELECT snapshot_label, epoch_ms(snapshot_timestamp) AS snapshot_time, epoch_ms(boot_timestamp) AS boot_time, physical_total_gigabytes, ` +
      `physical_available_gigabytes, pagefile_total_gigabytes, pagefile_used_gigabytes, process_count, private_total_gigabytes, cpu_sample_seconds ` +
      `FROM ${memory} WHERE ${scope} LIMIT 1`,
  );
  const machine: MachineSnapshot | null = machineRow
    ? {
        snapshotLabel: String(machineRow.snapshot_label),
        snapshotTime: finite(machineRow.snapshot_time),
        bootTime: finite(machineRow.boot_time),
        physicalTotalGigabytes: finite(machineRow.physical_total_gigabytes),
        physicalAvailableGigabytes: finite(machineRow.physical_available_gigabytes),
        pagefileTotalGigabytes: finite(machineRow.pagefile_total_gigabytes),
        pagefileUsedGigabytes: finite(machineRow.pagefile_used_gigabytes),
        processCount: finite(machineRow.process_count),
        privateTotalGigabytes: finite(machineRow.private_total_gigabytes),
        cpuSampleSeconds: finite(machineRow.cpu_sample_seconds),
      }
    : null;
  const groupRows = await context.lake.query<Record<string, unknown>>(
    `SELECT process_name, count(*) AS process_count, sum(private_megabytes) AS private_megabytes, ` +
      `sum(cpu_percent_of_one_core) AS cpu_percent_of_one_core, sum(cpu_seconds_total) AS cpu_seconds_total ` +
      `FROM ${snapshots} WHERE ${scope} AND process_id <> 0 GROUP BY process_name ORDER BY private_megabytes DESC, process_name`,
  );
  const groups: ProcessGroup[] = groupRows.map((row) => ({
    processName: String(row.process_name),
    processCount: count(row.process_count),
    privateMegabytes: count(row.private_megabytes),
    cpuPercentOfOneCore: count(row.cpu_percent_of_one_core),
    cpuSecondsTotal: count(row.cpu_seconds_total),
  }));
  const processRows = await context.lake.query<Record<string, unknown>>(
    `SELECT ${PROCESS_COLUMNS.map((column) => `CAST(${ident(column)} AS DOUBLE) AS ${ident(column)}`).join(", ")} ` +
      `FROM ${snapshots} WHERE ${scope} AND process_id <> 0 LIMIT ${num(PROCESS_ROW_CAP)}`,
  );
  const columns = emptyColumns();
  for (const row of processRows) {
    for (const column of PROCESS_COLUMNS) {
      const value = finite(row[column]);
      if (value !== null) columns[column as ProcessColumn].push(value);
    }
  }
  return { section: { labels, label, machine, groups, columns, processCount: processRows.length }, labels };
}

async function comparisonSection(context: StudyContext, recipe: string, memoryLabels: string[]): Promise<MachineHealthBody["comparison"]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    `SELECT process_name, snapshot_label, round(sum(private_megabytes)) AS private_megabytes FROM ${ident(PROCESSES_VIEW)} ` +
      `WHERE ${recipeFilter(recipe)} AND process_id <> 0 GROUP BY ALL`,
  );
  const parsed = rows.map((row) => ({ processName: String(row.process_name), snapshotLabel: String(row.snapshot_label), privateMegabytes: count(row.private_megabytes) }));
  const labels = [...new Set([...memoryLabels, ...parsed.map((row) => row.snapshotLabel)])];
  return pivotComparison(parsed, labels.length === memoryLabels.length ? memoryLabels : labels.sort(), COMPARISON_ROW_CAP);
}

async function configurationSection(context: StudyContext, recipe: string): Promise<ConfigurationRow[]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    `SELECT epoch_ms(changed_timestamp) AS changed_time, setting_path, setting_name, value_before, value_after, change_reason, revert_command ` +
      `FROM ${ident(CONFIGURATION_VIEW)} WHERE ${recipeFilter(recipe)} ORDER BY changed_timestamp, setting_path, setting_name LIMIT ${num(TABLE_ROW_CAP)}`,
  );
  return rows.map((row) => ({
    changedTime: finite(row.changed_time),
    settingPath: String(row.setting_path),
    settingName: String(row.setting_name),
    valueBefore: words(row.value_before),
    valueAfter: words(row.value_after),
    changeReason: words(row.change_reason),
    revertCommand: words(row.revert_command),
  }));
}

async function startupSection(context: StudyContext, recipe: string): Promise<StartupRow[]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    `SELECT snapshot_label, epoch_ms(snapshot_timestamp) AS snapshot_time, startup_location, entry_name, enabled ` +
      `FROM ${ident(STARTUP_VIEW)} WHERE ${recipeFilter(recipe)} ORDER BY snapshot_label, enabled DESC, entry_name LIMIT ${num(TABLE_ROW_CAP)}`,
  );
  return rows.map((row) => ({
    snapshotLabel: String(row.snapshot_label),
    snapshotTime: finite(row.snapshot_time),
    startupLocation: String(row.startup_location),
    entryName: String(row.entry_name),
    enabled: row.enabled === true,
  }));
}

async function indexRunSection(context: StudyContext, recipe: string): Promise<IndexRun[]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    `SELECT epoch_ms(run_timestamp) AS run_time, events_added, dump_files_added, reports_added, duration_seconds ` +
      `FROM ${ident(INDEX_RUN_VIEW)} WHERE ${recipeFilter(recipe)} ORDER BY run_timestamp`,
  );
  return rows.map((row) => ({
    runTime: finite(row.run_time),
    eventsAdded: count(row.events_added),
    dumpFilesAdded: count(row.dump_files_added),
    reportsAdded: count(row.reports_added),
    durationSeconds: finite(row.duration_seconds),
  }));
}

const handler: StudyHandler<typeof querySchema, MachineHealthBody> = {
  slug: "machine-health",
  datasets: [...VIEWS],
  query: querySchema,
  async run(query, context) {
    if ((await missingViews(context, VIEWS)).length > 0) return emptyMachineHealthBody();
    const { recipe, recipes } = await chooseRecipe(context, query);
    if (recipe === null) {
      context.notes.push("The event table is landed but holds no recipe.");
      return emptyMachineHealthBody();
    }
    const [events, shutdowns, coverage, dumps, processes, configuration, startup, indexRuns] = await Promise.all([
      eventsSection(context, recipe, query),
      shutdownSection(context, recipe),
      coverageSection(context, recipe),
      dumpSection(context, recipe),
      processSection(context, recipe, query),
      configurationSection(context, recipe),
      startupSection(context, recipe),
      indexRunSection(context, recipe),
    ]);
    const comparison = await comparisonSection(context, recipe, processes.labels);
    return { recipe, recipes, events, shutdowns, coverage, dumps, processes: processes.section, comparison, configuration, startup, indexRuns };
  },
};

export default handler;
