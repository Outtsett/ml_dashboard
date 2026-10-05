/**
 * Label catalog: every landed label set, its validation, and for one chosen
 * set the eight numbers and distribution of each contract column, the label
 * mix by month, realised return against the causal volatility scale, and a
 * window of rows for the stepped AFML sample-uniqueness formula; plus the
 * 2026-09-26 label audit record. Replaced notebooks/label_catalog.py.
 *
 * Reads:
 *   s3://meta/ingest_manifests/labels.jsonl   the registry (one line per landing)
 *   derived_labels                            every landed set, `recipe` per set
 *   derived_label_audit_{findings,generators,legacy_tables,suite}
 *
 * A 1-minute set is 2.3 million rows, so everything is aggregated here: the
 * eight numbers and histograms in DuckDB, a 20,000-row reservoir sample for
 * the scatter, and 60 rows for the stepper. The request has two parts
 * (`part=overview`, `part=window`) so moving the window slider re-reads 60
 * rows, not the whole profile.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import type { StudyContext, StudyHandler, StudyLake } from "../types";
import type { LensEightNumberSummary } from "@shared/lens/types";
import {
  MAXIMUM_CLASS_COUNT,
  PROFILED_COLUMNS,
  SCATTER_SAMPLE_ROWS,
  WINDOW_ROWS,
  flattenManifest,
  manifestDetail,
  type AuditTables,
  type ColumnProfile,
  type CountRow,
  type LabelCatalogBody,
  type LabelCatalogOverview,
  type LabelCatalogWindow,
  type LabelSetProfile,
  type ManifestRow,
  type MonthlyClassRow,
  type MonthlyMeanRow,
  type ScatterPoint,
  type WindowRow,
} from "@shared/studies/label-catalog";

export const LABELS_VIEW = "derived_labels";
export const AUDIT_VIEWS = {
  findings: "derived_label_audit_findings",
  generators: "derived_label_audit_generators",
  legacyTables: "derived_label_audit_legacy_tables",
  suite: "derived_label_audit_suite",
} as const;
const MANIFEST_OBJECT = "s3://meta/ingest_manifests/labels.jsonl";
const RECIPE_PATTERN = /^[A-Za-z0-9_.-]{1,160}$/;

const flag = z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1");

export const labelCatalogQuery = z.object({
  part: z.enum(["overview", "window"]).default("overview"),
  recipe: z.string().regex(RECIPE_PATTERN).optional(),
  bins: z.coerce.number().int().min(10).max(80).default(40),
  usable: flag.default("true"),
  windowStart: z.coerce.number().int().min(0).max(100_000_000).default(0),
});
export type LabelCatalogQuery = z.infer<typeof labelCatalogQuery>;

// ─── SQL (exported so the parity check runs exactly these strings) ──────────

/** The chosen set's rows, optionally only the usable ones. */
export function setFilter(recipe: string, usableOnly: boolean): string {
  return `FROM ${ident(LABELS_VIEW)} WHERE "recipe" = ${text(recipe)}${usableOnly ? ' AND "usable"' : ""}`;
}

/** The nine profiled columns as doubles, one row per (column, finite value). */
function longValues(recipe: string, usableOnly: boolean): string {
  const projection = PROFILED_COLUMNS.map((column) => `CAST(${ident(column)} AS DOUBLE) AS ${ident(column)}`).join(", ");
  return `base AS (SELECT ${projection} ${setFilter(recipe, usableOnly)}),
  long AS (UNPIVOT base ON COLUMNS(*) INTO NAME column_name VALUE v),
  clean AS (SELECT column_name, v FROM long WHERE isfinite(v))`;
}

/** Eight numbers (plus the count) per column. Skewness and kurtosis are DuckDB's sample-adjusted forms, as the dashboard's eightNumberSummary. */
export function summarySql(recipe: string, usableOnly: boolean): string {
  return `WITH ${longValues(recipe, usableOnly)}
SELECT column_name, count(*) AS count, avg(v) AS mean, median(v) AS median, stddev_samp(v) AS standard_deviation,
  skewness(v) AS skewness, kurtosis(v) AS kurtosis, quantile_cont(v, 0.25) AS percentile_25, quantile_cont(v, 0.75) AS percentile_75,
  min(v) AS minimum, max(v) AS maximum
FROM clean GROUP BY column_name`;
}

/** Equal-width bins between each column's minimum and maximum; the maximum falls in the last bin. */
export function histogramSql(recipe: string, usableOnly: boolean, bins: number): string {
  const count = num(bins);
  return `WITH ${longValues(recipe, usableOnly)},
  bounds AS (SELECT column_name, min(v) AS lo, max(v) AS hi FROM clean GROUP BY column_name)
SELECT c.column_name, b.lo, b.hi,
  CASE WHEN b.hi > b.lo THEN LEAST(CAST(floor((c.v - b.lo) / ((b.hi - b.lo) / ${count})) AS BIGINT), ${count} - 1) ELSE 0 END AS bin,
  count(*) AS rows
FROM clean c JOIN bounds b USING (column_name)
GROUP BY ALL`;
}

export function shapeSql(recipe: string, usableOnly: boolean): string {
  return `SELECT count(*) AS rows, count(DISTINCT "label") AS distinct_labels,
  count(*) FILTER (WHERE isfinite("realized_return_points") AND isfinite("trailing_volatility_points")) AS scatter_eligible
${setFilter(recipe, usableOnly)}`;
}

export function labelClassSql(recipe: string, usableOnly: boolean): string {
  return `SELECT "label", count(*) AS rows ${setFilter(recipe, usableOnly)} GROUP BY "label" ORDER BY "label"`;
}

const MONTH = `epoch_ms(date_trunc('month', "timestamp" AT TIME ZONE 'UTC'))`;

export function monthlyClassSql(recipe: string, usableOnly: boolean): string {
  return `SELECT ${MONTH} AS month, "label", count(*) AS rows ${setFilter(recipe, usableOnly)} GROUP BY ALL ORDER BY month, "label"`;
}

export function monthlyMeanSql(recipe: string, usableOnly: boolean): string {
  return `SELECT ${MONTH} AS month, avg("label") AS mean_label, count(*) AS rows ${setFilter(recipe, usableOnly)} GROUP BY ALL ORDER BY month`;
}

export function scatterSql(recipe: string, usableOnly: boolean): string {
  return `SELECT volatility, return_points, label FROM (
  SELECT "trailing_volatility_points" AS volatility, "realized_return_points" AS return_points, "label" AS label
  ${setFilter(recipe, usableOnly)} AND isfinite("realized_return_points") AND isfinite("trailing_volatility_points")
) AS eligible USING SAMPLE reservoir(${num(SCATTER_SAMPLE_ROWS)} ROWS) REPEATABLE (0)`;
}

export function usableReasonSql(recipe: string): string {
  return `SELECT coalesce("usable_reason", 'not recorded') AS key, count(*) AS rows ${setFilter(recipe, false)} GROUP BY 1 ORDER BY rows DESC`;
}

export function clearsCostSql(recipe: string, usableOnly: boolean): string {
  return `SELECT CASE WHEN "clears_round_trip_cost" IS NULL THEN 'not known' WHEN "clears_round_trip_cost" THEN 'clears the round trip' ELSE 'does not clear it' END AS key,
  count(*) AS rows ${setFilter(recipe, usableOnly)} GROUP BY 1 ORDER BY 1`;
}

export function windowSql(recipe: string, usableOnly: boolean, start: number): string {
  return `SELECT epoch_ms("timestamp") AS timestamp, "label", "resolution_bars", epoch_ms("resolution_timestamp") AS resolution_timestamp,
  "sample_uniqueness_weight", "concurrent_label_count"
${setFilter(recipe, usableOnly)} ORDER BY "timestamp" LIMIT ${num(WINDOW_ROWS)} OFFSET ${num(start)}`;
}

export function countSql(recipe: string, usableOnly: boolean): string {
  return `SELECT count(*) AS rows ${setFilter(recipe, usableOnly)}`;
}

export const MANIFEST_SQL = `SELECT content FROM read_text(${text(MANIFEST_OBJECT)})`;

// ─── Shaping ────────────────────────────────────────────────────────────────

function numberOrNull(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const EMPTY_SUMMARY: LensEightNumberSummary = {
  count: 0, mean: null, median: null, standardDeviation: null, skewness: null, kurtosis: null,
  percentile25: null, percentile75: null, minimum: null, maximum: null,
};

interface SummaryRow {
  column_name: string; count: unknown; mean: unknown; median: unknown; standard_deviation: unknown;
  skewness: unknown; kurtosis: unknown; percentile_25: unknown; percentile_75: unknown; minimum: unknown; maximum: unknown;
}

interface HistogramRow {
  column_name: string; lo: unknown; hi: unknown; bin: unknown; rows: unknown;
}

export function buildColumnProfiles(summaryRows: SummaryRow[], histogramRows: HistogramRow[], bins: number): ColumnProfile[] {
  const summaries = new Map(summaryRows.map((row) => [row.column_name, row]));
  const histograms = new Map<string, HistogramRow[]>();
  for (const row of histogramRows) {
    const list = histograms.get(row.column_name) ?? [];
    list.push(row);
    histograms.set(row.column_name, list);
  }
  return PROFILED_COLUMNS.map((column) => {
    const row = summaries.get(column);
    const count = numberOrNull(row?.count) ?? 0;
    // n < 3 has no skewness and n < 4 no kurtosis: NaN is reported as unknown, never omitted.
    const summary: LensEightNumberSummary = row && count > 0
      ? {
          count,
          mean: numberOrNull(row.mean),
          median: numberOrNull(row.median),
          standardDeviation: count > 1 ? numberOrNull(row.standard_deviation) : null,
          skewness: count >= 3 ? numberOrNull(row.skewness) : null,
          kurtosis: count >= 4 ? numberOrNull(row.kurtosis) : null,
          percentile25: numberOrNull(row.percentile_25),
          percentile75: numberOrNull(row.percentile_75),
          minimum: numberOrNull(row.minimum),
          maximum: numberOrNull(row.maximum),
        }
      : { ...EMPTY_SUMMARY };
    const cells = histograms.get(column) ?? [];
    const lo = numberOrNull(cells[0]?.lo);
    const hi = numberOrNull(cells[0]?.hi);
    if (lo === null || hi === null) return { column, summary, bins: [] };
    const binCount = hi > lo ? bins : 1;
    const width = hi > lo ? (hi - lo) / bins : 1;
    const counts = new Array<number>(binCount).fill(0);
    for (const cell of cells) {
      const index = numberOrNull(cell.bin) ?? 0;
      if (index >= 0 && index < binCount) counts[index] = (counts[index] ?? 0) + (numberOrNull(cell.rows) ?? 0);
    }
    return {
      column,
      summary,
      bins: counts.map((rows, index) => ({ lower: lo + index * width, upper: lo + (index + 1) * width, rows })),
    };
  });
}

export function monthlyShares(rows: Array<{ month: unknown; label: unknown; rows: unknown }>): MonthlyClassRow[] {
  const totals = new Map<number, number>();
  const parsed = rows.map((row) => ({ month: numberOrNull(row.month) ?? 0, label: numberOrNull(row.label), rows: numberOrNull(row.rows) ?? 0 }));
  for (const row of parsed) totals.set(row.month, (totals.get(row.month) ?? 0) + row.rows);
  return parsed.map((row) => ({ ...row, share: row.rows / (totals.get(row.month) || 1) }));
}

async function readManifest(context: StudyContext): Promise<string | null> {
  try {
    const rows = await context.lake.query<{ content: unknown }>(MANIFEST_SQL);
    const content = rows[0]?.content;
    return typeof content === "string" ? content : null;
  } catch (error) {
    context.notes.push(`Could not read the label manifest (${MANIFEST_OBJECT}): ${error instanceof Error ? error.message : String(error)}. The set list falls back to the recipes in ${LABELS_VIEW}.`);
    return null;
  }
}

/** Manifest rows, or (when the manifest cannot be read) one bare row per served recipe. */
async function catalog(context: StudyContext, hasLabels: boolean): Promise<{ manifest: ManifestRow[]; text: string | null }> {
  const manifestText = await readManifest(context);
  if (manifestText !== null) return { manifest: flattenManifest(manifestText), text: manifestText };
  if (!hasLabels) return { manifest: [], text: null };
  const recipes = await context.lake.query<{ recipe: string; rows: unknown }>(`SELECT "recipe", count(*) AS rows FROM ${ident(LABELS_VIEW)} GROUP BY 1 ORDER BY 1`);
  return {
    manifest: recipes.map((row) => ({
      label_set_id: null, recipe: row.recipe, generator_type: null, label_encoding: null, symbol: null, timeframe_minutes: null,
      rows: numberOrNull(row.rows), first_event: null, last_event: null, max_horizon_bars: null, purge_bars: null,
      validation_passed: null, class_balance_ratio: null, coverage_fraction: null, no_lookahead: null, written_at: null,
      parameters: "null", current: true,
    })),
    text: null,
  };
}

/** The requested recipe when the catalog has it, else the notebook's default (the first by label_set_id). */
function chooseRecipe(manifest: ManifestRow[], requested: string | undefined, context: StudyContext): string | null {
  const recipes = new Set(manifest.map((row) => row.recipe));
  if (requested && recipes.has(requested)) return requested;
  if (requested) context.notes.push(`No landed label set has the recipe ${requested}; showing the first set instead.`);
  return manifest[0]?.recipe ?? null;
}

async function readAudit(lake: StudyLake, context: StudyContext): Promise<AuditTables> {
  const audit: AuditTables = { findings: [], generators: [], legacyTables: [], suite: [] };
  const missing: string[] = [];
  await Promise.all(
    (Object.entries(AUDIT_VIEWS) as Array<[keyof AuditTables, string]>).map(async ([key, view]) => {
      if (!(await lake.hasView(view))) {
        missing.push(view);
        return;
      }
      try {
        audit[key] = await lake.query<Record<string, unknown>>(`SELECT * EXCLUDE ("recipe") FROM ${ident(view)}`);
      } catch (error) {
        // The notebook showed the error in place of the table; the page gets the same as a note.
        context.notes.push(`Could not read ${view}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  if (missing.length > 0) {
    context.notes.push(`The audit record is not landed: ${missing.sort().join(", ")} (scripts/land_label_audit.py lands it).`);
  }
  return audit;
}

async function profile(lake: StudyLake, recipe: string, query: LabelCatalogQuery, manifestText: string | null): Promise<LabelSetProfile> {
  const usableOnly = query.usable;
  const [summaryRows, histogramRows, shapeRows, reasonRows, costRows] = await Promise.all([
    lake.query<SummaryRow>(summarySql(recipe, usableOnly)),
    lake.query<HistogramRow>(histogramSql(recipe, usableOnly, query.bins)),
    lake.query<{ rows: unknown; distinct_labels: unknown; scatter_eligible: unknown }>(shapeSql(recipe, usableOnly)),
    lake.query<{ key: string; rows: unknown }>(usableReasonSql(recipe)),
    lake.query<{ key: string; rows: unknown }>(clearsCostSql(recipe, usableOnly)),
  ]);
  const shape = shapeRows[0];
  const rows = numberOrNull(shape?.rows) ?? 0;
  const distinctLabelCount = numberOrNull(shape?.distinct_labels) ?? 0;
  const asClasses = distinctLabelCount > 0 && distinctLabelCount <= MAXIMUM_CLASS_COUNT;

  const [classRows, monthlyRows, meanRows, scatterRows] = await Promise.all([
    asClasses ? lake.query<{ label: unknown; rows: unknown }>(labelClassSql(recipe, usableOnly)) : Promise.resolve([]),
    asClasses ? lake.query<{ month: unknown; label: unknown; rows: unknown }>(monthlyClassSql(recipe, usableOnly)) : Promise.resolve([]),
    asClasses ? Promise.resolve([]) : lake.query<{ month: unknown; mean_label: unknown; rows: unknown }>(monthlyMeanSql(recipe, usableOnly)),
    lake.query<{ volatility: unknown; return_points: unknown; label: unknown }>(scatterSql(recipe, usableOnly)),
  ]);

  const toCounts = (list: Array<{ key: string; rows: unknown }>): CountRow[] => list.map((row) => ({ key: String(row.key), rows: numberOrNull(row.rows) ?? 0 }));
  const detail = manifestText ? manifestDetail(manifestText, recipe) : { gates: [], labelDistribution: [] };
  const totalRows = reasonRows.reduce((sum, row) => sum + (numberOrNull(row.rows) ?? 0), 0);

  return {
    recipe,
    usableOnly,
    bins: query.bins,
    totalRows,
    rows,
    columns: buildColumnProfiles(summaryRows, histogramRows, query.bins),
    distinctLabelCount,
    labelClasses: classRows.map((row) => ({ label: numberOrNull(row.label), rows: numberOrNull(row.rows) ?? 0 })),
    monthlyClasses: monthlyShares(monthlyRows),
    monthlyMeans: meanRows.map((row): MonthlyMeanRow => ({ month: numberOrNull(row.month) ?? 0, meanLabel: numberOrNull(row.mean_label), rows: numberOrNull(row.rows) ?? 0 })),
    scatter: scatterRows
      .map((row): ScatterPoint | null => {
        const volatility = numberOrNull(row.volatility);
        const returnPoints = numberOrNull(row.return_points);
        return volatility === null || returnPoints === null ? null : { volatility, returnPoints, label: numberOrNull(row.label) };
      })
      .filter((point): point is ScatterPoint => point !== null),
    scatterEligibleRows: numberOrNull(shape?.scatter_eligible) ?? 0,
    usableReasons: toCounts(reasonRows),
    clearsRoundTripCost: toCounts(costRows),
    gates: detail.gates,
    labelDistribution: detail.labelDistribution,
  };
}

async function overview(query: LabelCatalogQuery, context: StudyContext): Promise<LabelCatalogOverview> {
  const { lake } = context;
  const hasLabels = await lake.hasView(LABELS_VIEW);
  if (!hasLabels) context.notes.push(`Not in the lake yet: ${LABELS_VIEW}. Land a label set from the Labels page, then refresh the derived views.`);
  const [{ manifest, text: manifestText }, audit] = await Promise.all([catalog(context, hasLabels), readAudit(lake, context)]);
  const recipeCount = new Set(manifest.map((row) => row.recipe)).size;
  const recipe = hasLabels ? chooseRecipe(manifest, query.recipe, context) : null;
  let setProfile: LabelSetProfile | null = null;
  if (recipe) {
    try {
      setProfile = await profile(lake, recipe, query, manifestText);
      if (setProfile.totalRows === 0) {
        context.notes.push(`${LABELS_VIEW} holds no rows for the recipe ${recipe}: the manifest lists it but the view does not serve it (refresh the derived views after a landing).`);
      }
    } catch (error) {
      context.notes.push(`Could not profile ${recipe}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    part: "overview",
    manifest,
    recipeCount,
    profile: setProfile,
    audit,
  };
}

async function windowPart(query: LabelCatalogQuery, context: StudyContext): Promise<LabelCatalogWindow> {
  const { lake } = context;
  const empty: LabelCatalogWindow = { part: "window", recipe: null, usableOnly: query.usable, rows: 0, windowStart: 0, timeframeMinutes: null, window: [] };
  if (!(await lake.hasView(LABELS_VIEW))) return empty;
  const { manifest } = await catalog(context, true);
  const recipe = chooseRecipe(manifest, query.recipe, context);
  if (!recipe) return empty;
  const timeframeMinutes = manifest.find((row) => row.recipe === recipe && row.current)?.timeframe_minutes ?? null;
  let rows = 0;
  let windowStart = 0;
  let raw: Record<string, unknown>[] = [];
  try {
    rows = numberOrNull((await lake.query<{ rows: unknown }>(countSql(recipe, query.usable)))[0]?.rows) ?? 0;
    windowStart = Math.min(query.windowStart, Math.max(0, rows - WINDOW_ROWS));
    raw = await lake.query<Record<string, unknown>>(windowSql(recipe, query.usable, windowStart));
  } catch (error) {
    context.notes.push(`Could not read a window of ${recipe}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const window: WindowRow[] = raw.map((row, index) => ({
    rowIndex: windowStart + index,
    timestamp: numberOrNull(row.timestamp) ?? 0,
    label: numberOrNull(row.label),
    resolutionBars: numberOrNull(row.resolution_bars),
    resolutionTimestamp: numberOrNull(row.resolution_timestamp),
    sampleUniquenessWeight: numberOrNull(row.sample_uniqueness_weight),
    concurrentLabelCount: numberOrNull(row.concurrent_label_count),
  }));
  return { part: "window", recipe, usableOnly: query.usable, rows, windowStart, timeframeMinutes, window };
}

const handler: StudyHandler<typeof labelCatalogQuery, LabelCatalogBody> = {
  slug: "label-catalog",
  datasets: [LABELS_VIEW, ...Object.values(AUDIT_VIEWS)],
  query: labelCatalogQuery,
  cacheSeconds: 300,
  async run(query, context) {
    return query.part === "window" ? windowPart(query, context) : overview(query, context);
  },
};

export default handler;
