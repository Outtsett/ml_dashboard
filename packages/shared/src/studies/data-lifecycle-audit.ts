/**
 * Data lifecycle audit: the response body of `GET /api/studies/data-lifecycle-audit`
 * and the pure compute the page and the handler's tests share. Replaced
 * notebooks/data_lifecycle_audit.py.
 *
 * The audit itself is a finished record (measured 2026-09-23, 43 findings
 * verified against the code by a second reader). Its tables live in the lake
 * under `s3://derived/data_lifecycle_audit/recipe=measured_audit_2026_09_23/`,
 * served as `derived_data_lifecycle_audit_<table>`. Nothing here recomputes a
 * measurement: this module filters, groups and bins what was measured.
 */

import { eightNumberSummary } from "../lens/stats";
import type { EightNumberSummary } from "../analytics/types";

// ── vocabulary ─────────────────────────────────────────────────────────────

export const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

export const EFFORT_ORDER = ["small", "medium", "large"] as const;
export type Effort = (typeof EFFORT_ORDER)[number];

/** The stages in the order a byte travels. */
export const STAGE_ORDER = [
  "store_layout", "retrieve", "transfer_serialize", "compute", "memory", "temporary_storage", "end_of_life",
] as const;

export const STAGE_LABEL: Record<string, string> = {
  store_layout: "1 · stored (layout on disk)",
  retrieve: "2 · retrieved (read / query)",
  transfer_serialize: "3 · moved (serialized, sent)",
  compute: "4 · computed on",
  memory: "5 · held in memory",
  temporary_storage: "6 · temporarily saved",
  end_of_life: "7 · destroyed (or not)",
};

/** The stage label up to its bracket, as the map's column headers show it. */
export function stageShortLabel(stage: string): string {
  return (STAGE_LABEL[stage] ?? stage).split(" (")[0] as string;
}

export const STRAND_LABEL: Record<string, string> = {
  lake_storage: "Lake (Iceberg + serving snapshot)",
  server_read_path: "Server read path + browser",
  temporary_storage: "Caches and temp stores",
  python_compute: "Python training + builders",
  gaps: "Gaps (critic)",
};

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

export function strandLabel(strand: string): string {
  return STRAND_LABEL[strand] ?? strand;
}

export function severityRank(severity: string): number {
  const rank = (SEVERITY_ORDER as readonly string[]).indexOf(severity);
  return rank < 0 ? SEVERITY_ORDER.length : rank;
}

export function effortRank(effort: string): number {
  const rank = (EFFORT_ORDER as readonly string[]).indexOf(effort);
  return rank < 0 ? EFFORT_ORDER.length : rank;
}

// ── the response body ──────────────────────────────────────────────────────

export interface FindingRow {
  identifier: string;
  strand: string;
  lifecycle_stage: string;
  component: string;
  file_path: string;
  line_number: number | null;
  title: string;
  current_behavior: string;
  evidence: string;
  measured_value: number | null;
  measured_unit: string | null;
  improvement: string;
  expected_gain: string;
  severity: string;
  effort: string;
  risk: string;
  confidence: string;
  verdict: string;
  verification_note: string;
  audit_date: string | null;
}

/** The two findings columns that hold numbers; every other one is text. */
export const FINDING_NUMERIC_COLUMNS: readonly string[] = ["line_number", "measured_value"];

export interface RefutedRow {
  identifier: string;
  verdict: string;
  title: string;
  verification_note: string;
}

export interface HeadlineRow {
  strand: string;
  measurement_name: string;
  value: number | null;
  unit: string | null;
  method: string;
  raw_table_name: string;
}

export interface DocumentationRow {
  strand: string;
  topic: string;
  source: string;
  fact: string;
}

export interface RawTableIndexRow {
  raw_table_name: string;
  strand: string;
  source_file: string;
  row_count: number;
  column_count: number;
  columns: string;
}

export interface RawColumn {
  name: string;
  /** "number" draws a histogram with the eight numbers; "text" (labels, booleans, stamps) draws counts. */
  type: "number" | "text";
}

export interface RawTable {
  name: string;
  columns: RawColumn[];
  rows: Array<Record<string, unknown>>;
  /** Rows in the table, which can exceed `rows.length` when the page was capped. */
  rowCount: number;
  truncated: boolean;
}

export interface AuditBody {
  /** The recipe every table was read from (the newest when none was asked for). */
  recipe: string | null;
  recipes: string[];
  findings: FindingRow[];
  refuted: RefutedRow[];
  headline: HeadlineRow[];
  documentation: DocumentationRow[];
  rawIndex: RawTableIndexRow[];
  rawTable: RawTable | null;
}

export const EMPTY_BODY: AuditBody = {
  recipe: null, recipes: [], findings: [], refuted: [], headline: [], documentation: [], rawIndex: [], rawTable: null,
};

// ── filtering ──────────────────────────────────────────────────────────────

export interface FindingFilters {
  stages: readonly string[];
  severities: readonly string[];
  efforts: readonly string[];
  strands: readonly string[];
  text: string;
}

/** Comma-separated control value to a list; "" is the empty list. */
export function parseList(value: string): string[] {
  return value === "" ? [] : value.split(",").filter((part) => part !== "");
}

export function joinList(values: readonly string[]): string {
  return values.join(",");
}

/** Toggle one value in a list (the order of the list is kept stable). */
export function toggleIn(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

const SEARCH_COLUMNS = ["title", "component", "current_behavior", "improvement", "file_path"] as const;

export function filterFindings(rows: readonly FindingRow[], filters: FindingFilters): FindingRow[] {
  const needle = filters.text.trim().toLowerCase();
  return rows.filter((row) => {
    if (!filters.stages.includes(row.lifecycle_stage)) return false;
    if (!filters.severities.includes(row.severity)) return false;
    if (!filters.efforts.includes(row.effort)) return false;
    if (!filters.strands.includes(row.strand)) return false;
    if (needle === "") return true;
    return SEARCH_COLUMNS.map((column) => row[column] ?? "").join(" ").toLowerCase().includes(needle);
  });
}

export function countBySeverity(rows: readonly FindingRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const severity of SEVERITY_ORDER) counts[severity] = 0;
  for (const row of rows) counts[row.severity] = (counts[row.severity] ?? 0) + 1;
  return counts;
}

/** Severity, then effort, then identifier: the order of the findings table. */
export function sortFindings(rows: readonly FindingRow[]): FindingRow[] {
  return [...rows].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || effortRank(a.effort) - effortRank(b.effort) || a.identifier.localeCompare(b.identifier),
  );
}

// ── the lifecycle map ──────────────────────────────────────────────────────

export interface LifecycleCell {
  stage: string;
  strand: string;
  count: number;
  worstSeverity: Severity;
  titles: string[];
}

export function cellKey(stage: string, strand: string): string {
  return `${stage}|${strand}`;
}

/** One cell per (stage, strand) that has a finding; the cell carries its worst severity. */
export function lifecycleCells(rows: readonly FindingRow[]): LifecycleCell[] {
  const cells = new Map<string, { stage: string; strand: string; worst: number; titles: string[] }>();
  for (const row of rows) {
    const key = cellKey(row.lifecycle_stage, row.strand);
    const cell = cells.get(key) ?? { stage: row.lifecycle_stage, strand: row.strand, worst: SEVERITY_ORDER.length - 1, titles: [] };
    cell.worst = Math.min(cell.worst, severityRank(row.severity));
    cell.titles.push(row.title);
    cells.set(key, cell);
  }
  return [...cells.values()].map((cell) => ({
    stage: cell.stage,
    strand: cell.strand,
    count: cell.titles.length,
    worstSeverity: SEVERITY_ORDER[cell.worst] as Severity,
    titles: cell.titles,
  }));
}

/** The findings inside the clicked cells (every finding when none is clicked). */
export function restrictToCells(rows: readonly FindingRow[], keys: readonly string[]): FindingRow[] {
  if (keys.length === 0) return [...rows];
  return rows.filter((row) => keys.includes(cellKey(row.lifecycle_stage, row.strand)));
}

export function restrictToIdentifiers(rows: readonly FindingRow[], identifiers: readonly string[]): FindingRow[] {
  if (identifiers.length === 0) return [...rows];
  return rows.filter((row) => identifiers.includes(row.identifier));
}

/** Side length of a map mark for `count` findings: area grows linearly with the count. */
export function markSize(count: number, maximumCount: number, smallest = 22, largest = 46): number {
  if (maximumCount <= 1) return (smallest + largest) / 2;
  const share = Math.max(0, Math.min(1, (count - 1) / (maximumCount - 1)));
  const areaSmall = smallest * smallest;
  const areaLarge = largest * largest;
  return Math.sqrt(areaSmall + (areaLarge - areaSmall) * share);
}

// ── the priority chart ─────────────────────────────────────────────────────

export interface PackedPoint {
  /** Offset from the centre of the box, in pixels. */
  dx: number;
  dy: number;
}

/**
 * Lay `count` marks of side `size` out inside a box so none hides another:
 * as many per row as fit, rows centred vertically; the marks shrink only when
 * even that does not fit. Returns the offsets and the size actually used.
 */
export function packInBox(count: number, width: number, height: number, size: number): { points: PackedPoint[]; size: number } {
  if (count <= 0) return { points: [], size };
  let side = Math.max(4, size);
  let columns = Math.max(1, Math.min(count, Math.floor(width / side)));
  let rows = Math.ceil(count / columns);
  while (rows * side > height && side > 4) {
    side -= 1;
    columns = Math.max(1, Math.min(count, Math.floor(width / side)));
    rows = Math.ceil(count / columns);
  }
  const points: PackedPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const inRow = row === rows - 1 ? count - row * columns : columns;
    points.push({ dx: (column - (inRow - 1) / 2) * side, dy: (row - (rows - 1) / 2) * side });
  }
  return { points, size: side };
}

// ── column panels ──────────────────────────────────────────────────────────

export interface PanelBin {
  lower: number;
  upper: number;
  count: number;
}

/**
 * Bins on a "nice" step (1, 2 or 5 times a power of ten) giving at most
 * `maximumBins` bins, the rule Vega-Lite's `bin: {maxbins}` follows, so a
 * panel reads like the notebook's. Empty input gives no bins.
 */
export function niceBins(values: readonly number[], maximumBins: number): PanelBin[] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return [];
  let lowest = Infinity;
  let highest = -Infinity;
  for (const value of finite) {
    if (value < lowest) lowest = value;
    if (value > highest) highest = value;
  }
  const span = highest - lowest || Math.abs(lowest) || 1;
  const maximum = Math.max(1, Math.floor(maximumBins));
  const level = Math.ceil(Math.log(maximum) / Math.LN10);
  let step = Math.pow(10, Math.round(Math.log(span) / Math.LN10) - level);
  while (Math.ceil(span / step) > maximum) step *= 10;
  for (const divisor of [5, 2]) {
    const finer = step / divisor;
    if (span / finer <= maximum) step = finer;
  }
  const start = Math.floor(lowest / step + 1e-14) * step;
  const binCount = Math.floor((highest - start) / step + 1e-14) + 1;
  const bins: PanelBin[] = Array.from({ length: binCount }, (_, index) => ({
    lower: start + index * step,
    upper: start + (index + 1) * step,
    count: 0,
  }));
  for (const value of finite) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - start) / step + 1e-14)));
    (bins[index] as PanelBin).count += 1;
  }
  return bins;
}

export interface NumberPanel {
  kind: "number";
  column: string;
  bins: PanelBin[];
  summary: EightNumberSummary;
}

export interface CategoryPanel {
  kind: "category";
  column: string;
  distinct: number;
  /** The commonest values, most frequent first. */
  values: Array<{ value: string; count: number }>;
}

export interface TextPanel {
  kind: "text";
  column: string;
  distinct: number;
  /** Characters written per row. */
  bins: PanelBin[];
  summary: EightNumberSummary;
}

export type ColumnPanel = NumberPanel | CategoryPanel | TextPanel;

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One small multiple for one column, by the column's data: a number gets a
 * histogram and its eight numbers; a label column gets a count per value; a
 * long-text column (nearly every value different) gets the characters written
 * per row. `null` when a number column has no value at all.
 */
export function buildColumnPanel(column: string, values: readonly unknown[], numeric: boolean, top: number, bins: number): ColumnPanel | null {
  if (numeric) {
    const numbers = values.map(asNumber).filter((value): value is number => value !== null);
    if (numbers.length === 0) return null;
    return { kind: "number", column, bins: niceBins(numbers, bins), summary: eightNumberSummary(numbers) };
  }
  const text = values.map((value) => (value === null || value === undefined ? "(empty)" : String(value)));
  const counts = new Map<string, number>();
  for (const entry of text) counts.set(entry, (counts.get(entry) ?? 0) + 1);
  const distinct = counts.size;
  if (distinct <= Math.max(top, 25) || distinct < 0.5 * text.length) {
    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, top)
      .map(([value, count]) => ({ value, count }));
    return { kind: "category", column, distinct, values: ranked };
  }
  const lengths = text.map((entry) => [...entry].length);
  return { kind: "text", column, distinct, bins: niceBins(lengths, bins), summary: eightNumberSummary(lengths) };
}

// ── the skewness walk-through ──────────────────────────────────────────────

export interface ZScoreWalk {
  count: number;
  mean: number;
  standardDeviation: number;
  /** z_i = (x_i - mean) / s for every observation, in row order. */
  scores: number[];
}

/** The standardised scores the skewness and kurtosis sums run over; null below two finite values. */
export function zScoreWalk(values: readonly number[]): ZScoreWalk | null {
  const finite = values.filter((value) => Number.isFinite(value));
  const count = finite.length;
  if (count < 2) return null;
  const mean = finite.reduce((total, value) => total + value, 0) / count;
  const variance = finite.reduce((total, value) => total + (value - mean) ** 2, 0) / (count - 1);
  const standardDeviation = Math.sqrt(variance);
  if (!(standardDeviation > 0)) return { count, mean, standardDeviation: 0, scores: finite.map(() => 0) };
  return { count, mean, standardDeviation, scores: finite.map((value) => (value - mean) / standardDeviation) };
}

/** Sample-adjusted skewness G1 from the walk's scores (null below three observations). */
export function skewnessFromScores(walk: ZScoreWalk): number | null {
  const n = walk.count;
  if (n < 3) return null;
  const sum = walk.scores.reduce((total, z) => total + z ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * sum;
}

/** Sample-adjusted excess kurtosis G2 from the walk's scores (null below four observations). */
export function kurtosisFromScores(walk: ZScoreWalk): number | null {
  const n = walk.count;
  if (n < 4) return null;
  const sum = walk.scores.reduce((total, z) => total + z ** 4, 0);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}
