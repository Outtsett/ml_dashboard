/**
 * The body of GET /api/studies/machine-health, shared by the handler and the
 * page, plus the pure pieces both need: the event-kind styles, the hours
 * between unclean shutdowns, the Sunday-start week, the log10(1 + value)
 * transform and the full-range histogram.
 *
 * The data is the crash indexer's (dotfiles scheduled task) tables, landed by
 * packages/ml-engine/src/studies/machine_health/build.py as `derived_study_machine_health_*`.
 * Every event time here is America/Los_Angeles wall clock carried as epoch
 * milliseconds read as UTC digits (the dashboard's convention for wall-clock
 * stamps), so `fmtTime` prints the local time the notebook showed.
 */

import type { LensEightNumberSummary } from "../lens/types";

/** The event kinds the notebook styled, with its colour and marker. Colour is never the only channel: every kind has its own glyph. */
export type MarkerShape = "circle" | "square" | "triangleUp" | "diamond" | "cross" | "triangleDown" | "triangleRight" | "stroke" | "ring";

export interface EventStyle {
  color: string;
  shape: MarkerShape;
  glyph: string;
}

export const EVENT_STYLE: Record<string, EventStyle> = {
  application_crash: { color: "#0072B2", shape: "circle", glyph: "●" },
  application_hang: { color: "#E69F00", shape: "square", glyph: "■" },
  hard_reset_without_bugcheck: { color: "#D55E00", shape: "triangleUp", glyph: "▲" },
  unclean_shutdown_after_bugcheck: { color: "#000000", shape: "diamond", glyph: "◆" },
  kernel_bugcheck: { color: "#CC79A7", shape: "cross", glyph: "✚" },
  kernel_bugcheck_report: { color: "#56B4E9", shape: "triangleDown", glyph: "▼" },
  live_kernel_event: { color: "#009E73", shape: "triangleRight", glyph: "▶" },
  unexpected_shutdown_logged: { color: "#999999", shape: "stroke", glyph: "▬" },
  windows_error_report: { color: "#BBBBBB", shape: "ring", glyph: "○" },
};

export const FALLBACK_EVENT_STYLE: EventStyle = { color: "#999999", shape: "circle", glyph: "●" };

export function styleOf(kind: string): EventStyle {
  return EVENT_STYLE[kind] ?? FALLBACK_EVENT_STYLE;
}

/** The two kinds that are an unclean shutdown (the notebook's `_resets` filter). */
export const UNCLEAN_SHUTDOWN_KINDS = ["hard_reset_without_bugcheck", "unclean_shutdown_after_bugcheck"] as const;
export const CRASH_KINDS = ["application_crash", "application_hang"] as const;

/** Shown by default: every kind but the 477 report rows (the notebook's default picker). */
export const DEFAULT_HIDDEN_KINDS = "windows_error_report";

/** The numeric columns of a process snapshot that the notebook profiles, one panel each. */
export const PROCESS_COLUMNS = [
  "private_megabytes",
  "working_set_megabytes",
  "cpu_seconds_total",
  "cpu_percent_of_one_core",
  "thread_count",
  "handle_count",
] as const;
export type ProcessColumn = (typeof PROCESS_COLUMNS)[number];

export const LIST_SEPARATOR = "|";

export function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(LIST_SEPARATOR).filter((item) => item.length > 0);
}

export function joinList(values: readonly string[]): string {
  return values.join(LIST_SEPARATOR);
}

// ---------- response body ----------

export interface EventRow {
  /** Local (Pacific) wall clock, epoch ms read as UTC digits. */
  localTime: number;
  eventKind: string;
  applicationName: string | null;
  bugcheckCode: string | null;
  exceptionCode: string | null;
  windowsErrorReportingBucket: string | null;
  faultingModuleName: string | null;
  dumpKept: boolean;
}

export interface KindCount {
  eventKind: string;
  eventCount: number;
}

export interface WeekCount {
  /** Sunday 00:00 of the week, local wall clock, epoch ms. */
  weekStart: number;
  eventKind: string;
  eventCount: number;
}

export interface EventsSection {
  totalEventCount: number;
  /** First and last local day over ALL events, as YYYY-MM-DD; the day slider is 0..totalDays from the first. */
  firstDay: string | null;
  lastDay: string | null;
  totalDays: number;
  kinds: KindCount[];
  /** Events inside the day window and the kind picker. */
  selectedCount: number;
  rows: EventRow[];
  weeks: WeekCount[];
  /** Whether `rows` was cut at the row cap (the weekly counts are never cut). */
  rowsCapped: boolean;
}

export interface ShutdownSection {
  /** hard_reset_without_bugcheck plus unclean_shutdown_after_bugcheck, over all events. */
  uncleanShutdownCount: number;
  firstEventDay: string | null;
  /** Local times of those events, ascending, epoch ms. The gaps are derived from them by `gapHours`. */
  localTimes: number[];
}

export interface CoverageRow {
  applicationName: string;
  eventKind: string;
  eventCount: number;
  eventsWithDump: number;
  eventsWithoutDump: number;
}

export interface CoverageSection {
  /** Rows of the top applications by total crash and hang events, largest first. */
  rows: CoverageRow[];
  applicationCount: number;
}

export interface DumpRow {
  dumpPath: string;
  dumpKind: string;
  applicationName: string | null;
  processIdentifier: number | null;
  sizeMegabytes: number | null;
  createdTime: number | null;
  modifiedTime: number | null;
}

export interface DumpSection {
  rows: DumpRow[];
  fileCount: number;
  totalMegabytes: number;
}

export interface ProcessGroup {
  processName: string;
  processCount: number;
  privateMegabytes: number;
  cpuPercentOfOneCore: number;
  cpuSecondsTotal: number;
}

export interface MachineSnapshot {
  snapshotLabel: string;
  snapshotTime: number | null;
  bootTime: number | null;
  physicalTotalGigabytes: number | null;
  physicalAvailableGigabytes: number | null;
  pagefileTotalGigabytes: number | null;
  pagefileUsedGigabytes: number | null;
  processCount: number | null;
  privateTotalGigabytes: number | null;
  cpuSampleSeconds: number | null;
}

export interface ProcessSection {
  /** Every snapshot label in the memory_snapshot table, alphabetical (the notebook's dropdown). */
  labels: string[];
  label: string | null;
  machine: MachineSnapshot | null;
  /** Every process group of the label (process_id <> 0), largest private memory first. */
  groups: ProcessGroup[];
  /** One array per numeric column, one entry per process of the label. */
  columns: Record<ProcessColumn, number[]>;
  processCount: number;
}

export interface ComparisonRow {
  processName: string;
  /** Private megabytes per snapshot label (0 where the label has no such process). */
  privateMegabytes: Record<string, number>;
}

export interface ConfigurationRow {
  changedTime: number | null;
  settingPath: string;
  settingName: string;
  valueBefore: string | null;
  valueAfter: string | null;
  changeReason: string | null;
  revertCommand: string | null;
}

export interface StartupRow {
  snapshotLabel: string;
  snapshotTime: number | null;
  startupLocation: string;
  entryName: string;
  enabled: boolean;
}

export interface IndexRun {
  runTime: number | null;
  eventsAdded: number;
  dumpFilesAdded: number;
  reportsAdded: number;
  durationSeconds: number | null;
}

export interface MachineHealthBody {
  recipe: string | null;
  recipes: string[];
  events: EventsSection;
  shutdowns: ShutdownSection;
  coverage: CoverageSection;
  dumps: DumpSection;
  processes: ProcessSection;
  comparison: ComparisonRow[];
  configuration: ConfigurationRow[];
  startup: StartupRow[];
  indexRuns: IndexRun[];
}

export function emptyColumns(): Record<ProcessColumn, number[]> {
  return { private_megabytes: [], working_set_megabytes: [], cpu_seconds_total: [], cpu_percent_of_one_core: [], thread_count: [], handle_count: [] };
}

export function emptyMachineHealthBody(): MachineHealthBody {
  return {
    recipe: null,
    recipes: [],
    events: { totalEventCount: 0, firstDay: null, lastDay: null, totalDays: 0, kinds: [], selectedCount: 0, rows: [], weeks: [], rowsCapped: false },
    shutdowns: { uncleanShutdownCount: 0, firstEventDay: null, localTimes: [] },
    coverage: { rows: [], applicationCount: 0 },
    dumps: { rows: [], fileCount: 0, totalMegabytes: 0 },
    processes: { labels: [], label: null, machine: null, groups: [], columns: emptyColumns(), processCount: 0 },
    comparison: [],
    configuration: [],
    startup: [],
    indexRuns: [],
  };
}

// ---------- pure compute ----------

const HOUR_MILLISECONDS = 3_600_000;
const DAY_MILLISECONDS = 86_400_000;

/**
 * Hours between consecutive events (the notebook's `diff()` of the sorted
 * local times, over 3600). The first event has no predecessor, so `n` events
 * give `n - 1` gaps. `times` need not be sorted.
 */
export function gapHours(times: readonly number[]): number[] {
  const sorted = [...times].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) gaps.push(((sorted[i] as number) - (sorted[i - 1] as number)) / HOUR_MILLISECONDS);
  return gaps;
}

/** The notebook's `np.log10(clip(hours, lower=0.01))`. */
export function logHours(hours: number): number {
  return Math.log10(Math.max(hours, 0.01));
}

/** The notebook's `np.log10(1 + clip(value, lower=0))`. */
export function logOnePlus(value: number): number {
  return Math.log10(1 + Math.max(value, 0));
}

/** The Sunday 00:00 that starts the week holding `localTime` (Vega-Lite's `yearweek` weeks start on Sunday). */
export function sundayWeekStart(localTime: number): number {
  const day = Math.floor(localTime / DAY_MILLISECONDS);
  // 1970-01-01 was a Thursday, so the day count plus 4 is 0 on a Sunday.
  const weekday = (((day + 4) % 7) + 7) % 7;
  return (day - weekday) * DAY_MILLISECONDS;
}

export interface FullRangeBin {
  lower: number;
  upper: number;
  count: number;
}

/**
 * Equal-width bins over the whole range [min, max] (no quantile trimming, so
 * the outliers the notebook's histogram showed stay visible). A single value
 * is one bin.
 */
export function fullRangeBins(values: readonly number[], binCount: number): FullRangeBin[] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0 || binCount < 1) return [];
  let lower = Infinity;
  let upper = -Infinity;
  for (const value of finite) {
    if (value < lower) lower = value;
    if (value > upper) upper = value;
  }
  if (!(upper > lower)) return [{ lower, upper, count: finite.length }];
  const width = (upper - lower) / binCount;
  const bins: FullRangeBin[] = Array.from({ length: binCount }, (_, i) => ({ lower: lower + i * width, upper: lower + (i + 1) * width, count: 0 }));
  for (const value of finite) {
    const index = Math.min(binCount - 1, Math.floor((value - lower) / width));
    (bins[index] as FullRangeBin).count += 1;
  }
  return bins;
}

/** Private memory per process group per snapshot label, largest first by the first label (the notebook's pivot sorted on `snapshot_labels[0]`). */
export function pivotComparison(
  rows: ReadonlyArray<{ processName: string; snapshotLabel: string; privateMegabytes: number }>,
  labels: readonly string[],
  limit: number,
): ComparisonRow[] {
  const byName = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const entry = byName.get(row.processName) ?? Object.fromEntries(labels.map((label) => [label, 0]));
    entry[row.snapshotLabel] = row.privateMegabytes;
    byName.set(row.processName, entry);
  }
  const first = labels[0];
  return [...byName.entries()]
    .map(([processName, privateMegabytes]) => ({ processName, privateMegabytes }))
    .sort((a, b) => (first ? (b.privateMegabytes[first] ?? 0) - (a.privateMegabytes[first] ?? 0) : 0) || a.processName.localeCompare(b.processName))
    .slice(0, limit);
}

export type { LensEightNumberSummary };
