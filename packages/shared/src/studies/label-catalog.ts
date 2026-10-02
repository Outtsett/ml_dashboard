/**
 * Label catalog study: the body of GET /api/studies/label-catalog, shared by
 * the handler and the page, plus the one computation both sides agree on
 * (the stepped average-uniqueness trace, AFML 4.5).
 *
 * The request comes in two parts so a window slider does not re-read the set:
 *   part=overview  the manifest, the audit record and the chosen set's profile
 *   part=window    sixty consecutive rows of the chosen set for the stepper
 */

import type { LensEightNumberSummary } from "../lens/types";

/** The contract columns the notebook profiled, in its order. */
export const PROFILED_COLUMNS = [
  "label",
  "resolution_bars",
  "realized_return_points",
  "realized_return_fraction",
  "realized_return_volatility_units",
  "trailing_volatility_points",
  "concurrent_label_count",
  "sample_uniqueness_weight",
  "return_attribution_weight",
] as const;
export type ProfiledColumn = (typeof PROFILED_COLUMNS)[number];

/** Rows per stepper window, and the most labels drawn as separate classes. */
export const WINDOW_ROWS = 60;
export const MAXIMUM_CLASS_COUNT = 6;
export const SCATTER_SAMPLE_ROWS = 20_000;

/** One manifest line, flattened exactly as the notebook flattened it (17 columns) plus `current`. */
export interface ManifestRow {
  label_set_id: number | null;
  recipe: string;
  generator_type: string | null;
  label_encoding: string | null;
  symbol: string | null;
  timeframe_minutes: number | null;
  rows: number | null;
  first_event: string | null;
  last_event: string | null;
  max_horizon_bars: number | null;
  purge_bars: number | null;
  validation_passed: boolean | null;
  class_balance_ratio: number | null;
  coverage_fraction: number | null;
  no_lookahead: string | null;
  written_at: string | null;
  parameters: string;
  /** False when a later line re-landed the same recipe (the manifest keeps both). */
  current: boolean;
}

export interface ValidationGate {
  gate: string;
  passed: boolean | null;
  value: number | null;
  detail: string | null;
}

export interface HistogramBinRow {
  lower: number;
  upper: number;
  rows: number;
}

export interface ColumnProfile {
  column: ProfiledColumn;
  summary: LensEightNumberSummary;
  bins: HistogramBinRow[];
}

export interface MonthlyClassRow {
  /** Epoch milliseconds of the month's first instant, as stamped. */
  month: number;
  label: number | null;
  rows: number;
  share: number;
}

export interface MonthlyMeanRow {
  month: number;
  meanLabel: number | null;
  rows: number;
}

export interface ScatterPoint {
  volatility: number;
  returnPoints: number;
  label: number | null;
}

export interface CountRow {
  key: string;
  rows: number;
}

export interface AuditTables {
  findings: Array<Record<string, unknown>>;
  generators: Array<Record<string, unknown>>;
  legacyTables: Array<Record<string, unknown>>;
  suite: Array<Record<string, unknown>>;
}

export interface LabelSetProfile {
  recipe: string;
  usableOnly: boolean;
  bins: number;
  /** Rows in the set, and rows after the usable filter. */
  totalRows: number;
  rows: number;
  columns: ColumnProfile[];
  /** Distinct labels after the filter; at most MAXIMUM_CLASS_COUNT means the label is drawn as classes. */
  distinctLabelCount: number;
  labelClasses: Array<{ label: number | null; rows: number }>;
  monthlyClasses: MonthlyClassRow[];
  monthlyMeans: MonthlyMeanRow[];
  scatter: ScatterPoint[];
  /** Rows with both a realised return and a trailing volatility (the scatter's population). */
  scatterEligibleRows: number;
  /** Why rows are or are not usable, over the whole set. */
  usableReasons: CountRow[];
  /** Whether the realised move cleared one round trip, over the filtered rows. */
  clearsRoundTripCost: CountRow[];
  gates: ValidationGate[];
  labelDistribution: CountRow[];
}

export interface LabelCatalogOverview {
  part: "overview";
  manifest: ManifestRow[];
  recipeCount: number;
  profile: LabelSetProfile | null;
  audit: AuditTables;
}

export interface WindowRow {
  /** Row index inside the filtered set, ordered by timestamp. */
  rowIndex: number;
  timestamp: number;
  label: number | null;
  resolutionBars: number | null;
  resolutionTimestamp: number | null;
  sampleUniquenessWeight: number | null;
  concurrentLabelCount: number | null;
}

export interface LabelCatalogWindow {
  part: "window";
  recipe: string | null;
  usableOnly: boolean;
  rows: number;
  windowStart: number;
  timeframeMinutes: number | null;
  window: WindowRow[];
}

export type LabelCatalogBody = LabelCatalogOverview | LabelCatalogWindow;

// ─── The stepped uniqueness trace ──────────────────────────────────────────

export interface UniquenessTerm {
  /** Bar ordinal inside the window (the row index k, as the notebook counted it). */
  bar: number;
  /** c_t: labels in the window whose span covers this bar. */
  concurrency: number;
  /** 1 / c_t (null when no label covers the bar). */
  reciprocal: number | null;
  runningSum: number;
}

export interface UniquenessTrace {
  /** Position of the traced label inside the window. */
  position: number;
  eventBar: number;
  resolutionBar: number;
  spanLength: number;
  terms: UniquenessTerm[];
  runningSum: number;
  /** Σ(1/c_t) / (t_{i,1} − t_{i,0} + 1), over this window only. */
  estimate: number | null;
  landedWeight: number | null;
  spans: Array<{ position: number; eventBar: number; resolutionBar: number }>;
}

/**
 * The notebook's stepper, line for line: inside a window of consecutive rows
 * the event bar of row k is k and its resolution bar is k + resolution_bars
 * (row index as the bar ordinal — exact for a generator that labels every
 * bar, an approximation across a session gap or for a sparse generator).
 * A missing resolution_bars counts as 0.
 */
export function uniquenessTrace(window: readonly WindowRow[], step: number): UniquenessTrace | null {
  if (window.length === 0) return null;
  const spans = window.map((row, position) => {
    const bars = row.resolutionBars !== null && Number.isFinite(row.resolutionBars) ? Math.max(0, Math.trunc(row.resolutionBars)) : 0;
    return { position, eventBar: position, resolutionBar: position + bars };
  });
  const position = Math.min(Math.max(0, Math.trunc(step)), window.length - 1);
  const chosen = spans[position]!;
  const terms: UniquenessTerm[] = [];
  let running = 0;
  for (let bar = chosen.eventBar; bar <= chosen.resolutionBar; bar += 1) {
    let concurrency = 0;
    for (const span of spans) if (span.eventBar <= bar && span.resolutionBar >= bar) concurrency += 1;
    const reciprocal = concurrency > 0 ? 1 / concurrency : null;
    running += reciprocal ?? 0;
    terms.push({ bar, concurrency, reciprocal, runningSum: running });
  }
  const spanLength = chosen.resolutionBar - chosen.eventBar + 1;
  return {
    position,
    eventBar: chosen.eventBar,
    resolutionBar: chosen.resolutionBar,
    spanLength,
    terms,
    runningSum: running,
    estimate: spanLength > 0 ? running / spanLength : null,
    landedWeight: window[position]!.sampleUniquenessWeight,
    spans,
  };
}

/** Steps between consecutive window rows longer than one bar: where the row index stops being the bar count. */
export function gapsInWindow(window: readonly WindowRow[], timeframeMinutes: number | null): number {
  if (!timeframeMinutes || window.length < 2) return 0;
  const bar = timeframeMinutes * 60_000;
  let gaps = 0;
  for (let index = 1; index < window.length; index += 1) {
    if (window[index]!.timestamp - window[index - 1]!.timestamp > bar) gaps += 1;
  }
  return gaps;
}

/**
 * Flatten manifest JSON lines the way the notebook did (label_catalog.py
 * lines 47-75), sorted by label_set_id, marking a line superseded when a
 * later line re-landed the same recipe.
 */
export function flattenManifest(text: string): ManifestRow[] {
  const rows: ManifestRow[] = [];
  const latest = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let line: Record<string, unknown>;
    try {
      line = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const recipe = typeof line.recipe === "string" ? line.recipe : "";
    if (!recipe) continue;
    const validation = (line.validation ?? {}) as Record<string, unknown>;
    const gates = (validation.gates ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const writtenAt = typeof line.written_at === "string" ? line.written_at : null;
    rows.push({
      label_set_id: numberOrNull(line.label_set_id),
      recipe,
      generator_type: stringOrNull(line.generator_type),
      label_encoding: stringOrNull(line.label_encoding),
      symbol: stringOrNull(line.symbol),
      timeframe_minutes: numberOrNull(line.timeframe_minutes),
      rows: numberOrNull(line.rows),
      first_event: stringOrNull(line.ts_min),
      last_event: stringOrNull(line.ts_max),
      max_horizon_bars: numberOrNull(line.max_horizon_bars),
      purge_bars: numberOrNull(line.purge_bars),
      validation_passed: typeof validation.passed === "boolean" ? validation.passed : null,
      class_balance_ratio: numberOrNull(validation.classBalanceRatio),
      coverage_fraction: numberOrNull(validation.coverageFraction),
      no_lookahead: stringOrNull(gates.noLookahead?.detail),
      written_at: writtenAt,
      parameters: stableJson(line.parameters ?? null),
      current: true,
    });
    const previous = latest.get(recipe);
    if (!previous || (writtenAt ?? "") >= previous) latest.set(recipe, writtenAt ?? "");
  }
  for (const row of rows) row.current = (row.written_at ?? "") === latest.get(row.recipe);
  rows.sort((a, b) => (a.label_set_id ?? Infinity) - (b.label_set_id ?? Infinity) || (a.written_at ?? "").localeCompare(b.written_at ?? ""));
  return rows;
}

/** The gates and label distribution of one manifest line (the latest for the recipe). */
export function manifestDetail(text: string, recipe: string): { gates: ValidationGate[]; labelDistribution: CountRow[] } {
  let chosen: Record<string, unknown> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const line = JSON.parse(trimmed) as Record<string, unknown>;
      if (line.recipe === recipe && (!chosen || String(line.written_at ?? "") >= String(chosen.written_at ?? ""))) chosen = line;
    } catch {
      // A malformed line is skipped, as the notebook's json.loads would have failed on it.
    }
  }
  if (!chosen) return { gates: [], labelDistribution: [] };
  const validation = (chosen.validation ?? {}) as Record<string, unknown>;
  const gates = Object.entries((validation.gates ?? {}) as Record<string, Record<string, unknown>>).map(([gate, body]) => ({
    gate,
    passed: typeof body?.passed === "boolean" ? body.passed : null,
    value: numberOrNull(body?.value),
    detail: stringOrNull(body?.detail),
  }));
  const distribution = (chosen.label_distribution ?? {}) as Record<string, unknown>;
  const labelDistribution = Object.entries(distribution)
    .map(([key, rows]) => ({ key, rows: numberOrNull(rows) ?? 0 }))
    .sort((a, b) => Number(a.key) - Number(b.key));
  return { gates, labelDistribution };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** json.dumps(value, sort_keys=True) in Python's default separators. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(", ")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}: ${stableJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(", ")}}`;
}
