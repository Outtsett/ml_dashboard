/**
 * Storage-format inventory: what physical file format holds the bytes across
 * the lake (E:\lake\warehouse) and the data-bearing repository directories.
 * Replaced datalake/notebooks/data_format_inventory.py.
 *
 * Reads two views landed by packages/ml-engine/src/studies/storage_format_inventory/build.py
 * (one measurement, 2026-09-11): `..._files` (one row per file) and
 * `..._measurement` (one row: what was measured, when, from where). Every
 * control is a filter on `files`, applied here in SQL, so each panel is one
 * aggregate over the filtered rows and only aggregates reach the browser (the
 * 400 largest files are the one row-level table, as in the notebook).
 *
 * Filters are sent as what is HIDDEN (`hiddenStores`, `hiddenZones`,
 * `hiddenFamilies`, separator "|"): nothing hidden is every value, and hiding
 * every value is an empty selection, as unticking every box was in the notebook.
 */

import { z } from "zod";
import { ident, num, text, textList } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  BREAKDOWN_DIMENSIONS,
  NO_EXTENSION_LABEL,
  emptyInventoryBody,
  gibibytesOf,
  parseList,
  type BreakdownDimension,
  type BreakdownRow,
  type ColumnBin,
  type ColumnCount,
  type ColumnProfile,
  type FamilySummaryRow,
  type InventoryBody,
  type LargestFile,
  type MeasurementRecord,
  type OptionRow,
  type SizeHistogram,
  type TimelineCell,
  type ZoneShareRow,
} from "@shared/studies/storage-format-inventory";
import type { LensEightNumberSummary } from "@shared/lens/types";

export const FILES_VIEW = "derived_study_storage_format_inventory_files";
export const MEASUREMENT_VIEW = "derived_study_storage_format_inventory_measurement";

const MEBIBYTE = 1024 * 1024;
const LARGEST_FILE_COUNT = 400;
const BREAKDOWN_LIMIT = 25;
const ZONE_LIMIT = 40;
const CATEGORY_LIMIT = 15;

export const querySchema = z.object({
  recipe: z.string().regex(/^[a-z0-9_]*$/).max(80).default(""),
  hiddenStores: z.string().max(2000).default(""),
  hiddenZones: z.string().max(6000).default(""),
  hiddenFamilies: z.string().max(2000).default(""),
  minimumKibibytes: z.coerce.number().int().min(0).max(1024).default(0),
  sizeBins: z.coerce.number().int().min(5).max(100).default(44),
  columnBins: z.coerce.number().int().min(5).max(100).default(30),
});
export type InventoryQuery = z.infer<typeof querySchema>;

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function count(value: unknown): number {
  return finite(value) ?? 0;
}

/** `WHERE` body for the filtered rows: hidden values out, small files out. */
export function filterClause(query: InventoryQuery): string {
  const parts: string[] = [];
  for (const [column, hidden] of [
    ["store_name", parseList(query.hiddenStores)],
    ["zone_name", parseList(query.hiddenZones)],
    ["format_family", parseList(query.hiddenFamilies)],
  ] as const) {
    if (hidden.length > 0) parts.push(`${ident(column)} NOT IN (${textList(hidden)})`);
  }
  parts.push(`file_bytes >= ${num(query.minimumKibibytes * 1024)}`);
  return parts.join(" AND ");
}

function withCtes(recipe: string, query: InventoryQuery, extra = ""): string {
  return (
    `WITH base AS (SELECT * EXCLUDE (recipe) FROM ${ident(FILES_VIEW)} WHERE recipe = ${text(recipe)}), ` +
    `filtered AS (SELECT * FROM base WHERE ${filterClause(query)})${extra ? `, ${extra}` : ""} `
  );
}

/** The eight numbers of `expression` (scaled), as SELECT items named `statistic_*`. */
function summaryItems(expression: string, divisor = 1): string {
  const scaled = divisor === 1 ? expression : `(${expression}) / ${num(divisor)}`;
  return [
    `CAST(count(${expression}) AS DOUBLE) AS statistic_count`,
    `CAST(avg(${scaled}) AS DOUBLE) AS statistic_mean`,
    `CAST(median(${scaled}) AS DOUBLE) AS statistic_median`,
    `CAST(stddev_samp(${scaled}) AS DOUBLE) AS statistic_standard_deviation`,
    `CAST(skewness(${expression}) AS DOUBLE) AS statistic_skewness`,
    `CAST(kurtosis(${expression}) AS DOUBLE) AS statistic_kurtosis`,
    `CAST(quantile_cont(${scaled}, 0.25) AS DOUBLE) AS statistic_percentile_25`,
    `CAST(quantile_cont(${scaled}, 0.75) AS DOUBLE) AS statistic_percentile_75`,
    `CAST(min(${scaled}) AS DOUBLE) AS statistic_minimum`,
    `CAST(max(${scaled}) AS DOUBLE) AS statistic_maximum`,
  ].join(", ");
}

function summaryOf(row: Record<string, unknown> | undefined): LensEightNumberSummary {
  return {
    count: count(row?.statistic_count),
    mean: finite(row?.statistic_mean),
    median: finite(row?.statistic_median),
    standardDeviation: finite(row?.statistic_standard_deviation),
    skewness: finite(row?.statistic_skewness),
    kurtosis: finite(row?.statistic_kurtosis),
    percentile25: finite(row?.statistic_percentile_25),
    percentile75: finite(row?.statistic_percentile_75),
    minimum: finite(row?.statistic_minimum),
    maximum: finite(row?.statistic_maximum),
  };
}

/**
 * An equal-width histogram of `expression` over the filtered rows where
 * `condition` holds: one row per occupied bin. With `integerValued` and fewer
 * distinct integers than bins, each integer gets its own bin.
 */
async function histogramOf(
  context: StudyContext,
  recipe: string,
  query: InventoryQuery,
  expression: string,
  condition: string,
  bins: number,
  integerValued = false,
): Promise<ColumnBin[]> {
  const sql =
    withCtes(
      recipe,
      query,
      `values_of AS (SELECT CAST(${expression} AS DOUBLE) AS x FROM filtered WHERE ${condition}), ` +
        `span AS (SELECT min(x) AS lo, max(x) AS hi, ` +
        `${integerValued ? `LEAST(${num(bins)}, CAST(max(x) - min(x) + 1 AS INTEGER))` : num(bins)} AS n FROM values_of)`,
    ) +
    `SELECT CASE WHEN hi > lo THEN LEAST(n - 1, CAST(floor((x - lo) / (hi - lo) * n) AS INTEGER)) ELSE 0 END AS bin_index, ` +
    `count(*) AS value_count, any_value(lo) AS lower_edge, any_value(hi) AS upper_edge, any_value(n) AS bin_count ` +
    `FROM values_of, span GROUP BY 1 ORDER BY 1`;
  const rows = await context.lake.query<Record<string, unknown>>(sql);
  const first = rows[0];
  if (!first) return [];
  const lo = count(first.lower_edge);
  const hi = count(first.upper_edge);
  const binCount = Math.max(1, count(first.bin_count));
  const perInteger = integerValued && binCount === hi - lo + 1;
  const width = hi > lo ? (hi - lo) / binCount : 1;
  const out: ColumnBin[] = Array.from({ length: binCount }, (_, index) =>
    perInteger
      ? { lower: lo + index, upper: lo + index + 1, count: 0 }
      : { lower: lo + index * width, upper: lo + (index + 1) * width, count: 0 },
  );
  for (const row of rows) {
    const bin = out[count(row.bin_index)];
    if (bin) bin.count += count(row.value_count);
  }
  return out;
}

async function optionsOf(context: StudyContext, recipe: string): Promise<InventoryBody["options"]> {
  const one = (column: string) =>
    `SELECT ${ident(column)} AS value, count(*) AS file_count, CAST(sum(file_bytes) AS DOUBLE) AS total_bytes ` +
    `FROM ${ident(FILES_VIEW)} WHERE recipe = ${text(recipe)} GROUP BY 1 ORDER BY 1`;
  const read = async (column: string): Promise<OptionRow[]> =>
    (await context.lake.query<Record<string, unknown>>(one(column))).map((row) => ({
      value: String(row.value),
      fileCount: count(row.file_count),
      gibibytes: gibibytesOf(count(row.total_bytes)),
    }));
  const [stores, zones, families] = await Promise.all([read("store_name"), read("zone_name"), read("format_family")]);
  return { stores, zones, families };
}

async function measurementOf(context: StudyContext, recipe: string): Promise<MeasurementRecord | null> {
  if (!(await context.lake.hasView(MEASUREMENT_VIEW))) return null;
  const rows = await context.lake.query<Record<string, unknown>>(
    `SELECT measured_on_date, source_database, measured_roots, file_count, total_file_bytes, zone_count, store_names, ` +
      `strftime(earliest_modified_timestamp, '%Y-%m-%d') AS earliest, strftime(latest_modified_timestamp, '%Y-%m-%d') AS latest ` +
      `FROM ${ident(MEASUREMENT_VIEW)} WHERE recipe = ${text(recipe)} LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    measuredOnDate: String(row.measured_on_date),
    sourceDatabase: String(row.source_database),
    measuredRoots: String(row.measured_roots),
    fileCount: count(row.file_count),
    totalFileBytes: count(row.total_file_bytes),
    zoneCount: count(row.zone_count),
    storeNames: String(row.store_names),
    earliestModifiedTimestamp: row.earliest === null ? null : String(row.earliest),
    latestModifiedTimestamp: row.latest === null ? null : String(row.latest),
  };
}

async function totalsOf(context: StudyContext, recipe: string, query: InventoryQuery): Promise<InventoryBody["totals"]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    withCtes(recipe, query) +
      `SELECT count(*) AS file_count, CAST(coalesce(sum(file_bytes), 0) AS DOUBLE) AS total_bytes, ` +
      `CAST(coalesce(sum(file_bytes) FILTER (WHERE is_parquet), 0) AS DOUBLE) AS parquet_bytes FROM filtered`,
  );
  const row = rows[0];
  const totalBytes = count(row?.total_bytes);
  const parquetBytes = count(row?.parquet_bytes);
  return {
    totalBytes,
    parquetBytes,
    nonParquetBytes: totalBytes - parquetBytes,
    parquetSharePercent: totalBytes > 0 ? (100 * parquetBytes) / totalBytes : null,
    fileCount: count(row?.file_count),
  };
}

async function breakdownOf(context: StudyContext, recipe: string, query: InventoryQuery, dimension: BreakdownDimension): Promise<BreakdownRow[]> {
  const column = ident(dimension);
  const rows = await context.lake.query<Record<string, unknown>>(
    withCtes(recipe, query) +
      `SELECT coalesce(${column}, ${text(NO_EXTENSION_LABEL)}) AS value, CAST(sum(file_bytes) AS DOUBLE) AS total_bytes, count(*) AS file_count ` +
      `FROM filtered GROUP BY 1 ORDER BY total_bytes DESC, value LIMIT ${BREAKDOWN_LIMIT}`,
  );
  return rows.map((row) => ({
    value: String(row.value),
    totalBytes: count(row.total_bytes),
    gibibytes: gibibytesOf(count(row.total_bytes)),
    fileCount: count(row.file_count),
  }));
}

async function zoneSharesOf(context: StudyContext, recipe: string, query: InventoryQuery): Promise<ZoneShareRow[]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    withCtes(recipe, query) +
      `SELECT zone_name, CAST(coalesce(sum(file_bytes) FILTER (WHERE is_parquet), 0) AS DOUBLE) AS parquet_bytes, ` +
      `CAST(coalesce(sum(file_bytes) FILTER (WHERE NOT coalesce(is_parquet, false)), 0) AS DOUBLE) AS not_parquet_bytes, count(*) AS file_count ` +
      `FROM filtered GROUP BY zone_name ORDER BY sum(file_bytes) DESC, zone_name LIMIT ${ZONE_LIMIT}`,
  );
  return rows.map((row) => ({
    zone_name: String(row.zone_name),
    parquetBytes: count(row.parquet_bytes),
    notParquetBytes: count(row.not_parquet_bytes),
    fileCount: count(row.file_count),
  }));
}

async function sizeHistogramOf(context: StudyContext, recipe: string, query: InventoryQuery): Promise<SizeHistogram> {
  const binCount = query.sizeBins;
  const [rows, zero] = await Promise.all([
    context.lake.query<Record<string, unknown>>(
      withCtes(
        recipe,
        query,
        `positive AS (SELECT log10(file_bytes) AS x, format_family FROM filtered WHERE file_bytes > 0), ` +
          `span AS (SELECT min(x) AS lo, max(x) AS hi FROM positive)`,
      ) +
        `SELECT CASE WHEN hi > lo THEN LEAST(${num(binCount - 1)}, CAST(floor((x - lo) / (hi - lo) * ${num(binCount)}) AS INTEGER)) ELSE 0 END AS bin_index, ` +
        `format_family, count(*) AS file_count, any_value(lo) AS lower_edge, any_value(hi) AS upper_edge ` +
        `FROM positive, span GROUP BY 1, 2 ORDER BY 1, 2`,
    ),
    context.lake.query<Record<string, unknown>>(withCtes(recipe, query) + `SELECT count(*) AS zero_count FROM filtered WHERE file_bytes = 0`),
  ]);
  const first = rows[0];
  const lower = count(first?.lower_edge);
  const upper = count(first?.upper_edge);
  return {
    lowerLog10: lower,
    binWidthLog10: upper > lower ? (upper - lower) / binCount : 1,
    binCount,
    zeroByteFileCount: count(zero[0]?.zero_count),
    cells: rows.map((row) => ({ binIndex: count(row.bin_index), format_family: String(row.format_family), fileCount: count(row.file_count) })),
  };
}

async function timelineOf(context: StudyContext, recipe: string, query: InventoryQuery): Promise<TimelineCell[]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    withCtes(recipe, query) +
      `SELECT strftime(date_trunc('month', modified_timestamp), '%Y-%m') AS month, format_family, CAST(sum(file_bytes) AS DOUBLE) AS total_bytes, count(*) AS file_count ` +
      `FROM filtered WHERE modified_timestamp IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  return rows.map((row) => ({
    month: String(row.month),
    format_family: String(row.format_family),
    gibibytes: gibibytesOf(count(row.total_bytes)),
    fileCount: count(row.file_count),
  }));
}

async function familySummariesOf(context: StudyContext, recipe: string, query: InventoryQuery): Promise<FamilySummaryRow[]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    withCtes(recipe, query) +
      `SELECT format_family, CAST(sum(file_bytes) AS DOUBLE) AS total_bytes, ${summaryItems("file_bytes", MEBIBYTE)} ` +
      `FROM filtered GROUP BY format_family ORDER BY total_bytes DESC, format_family`,
  );
  return rows.map((row) => ({
    format_family: String(row.format_family),
    fileCount: count(row.statistic_count),
    totalGibibytes: gibibytesOf(count(row.total_bytes)),
    mebibytes: summaryOf(row),
  }));
}

async function largestFilesOf(context: StudyContext, recipe: string, query: InventoryQuery): Promise<LargestFile[]> {
  const rows = await context.lake.query<Record<string, unknown>>(
    withCtes(recipe, query) +
      `SELECT store_name, zone_name, format_family, file_extension, CAST(file_bytes AS DOUBLE) / ${num(MEBIBYTE)} AS mebibytes, ` +
      `strftime(modified_timestamp, '%Y-%m-%d %H:%M') AS modified, file_path ` +
      `FROM filtered ORDER BY file_bytes DESC, file_path LIMIT ${LARGEST_FILE_COUNT}`,
  );
  return rows.map((row) => ({
    store_name: String(row.store_name),
    zone_name: String(row.zone_name),
    format_family: String(row.format_family),
    file_extension: row.file_extension === null ? null : String(row.file_extension),
    mebibytes: count(row.mebibytes),
    modified_timestamp: row.modified === null ? null : String(row.modified),
    file_path: String(row.file_path),
  }));
}

const DAY_SECONDS = 86400;

function dateOf(epochDays: number | null): string | null {
  return epochDays === null ? null : new Date(epochDays * DAY_SECONDS * 1000).toISOString().slice(0, 10);
}

async function categoricalProfile(
  context: StudyContext, recipe: string, query: InventoryQuery, column: string, description: string,
): Promise<ColumnProfile> {
  const name = ident(column);
  const [top, totals] = await Promise.all([
    context.lake.query<Record<string, unknown>>(
      withCtes(recipe, query) +
        `SELECT CAST(${name} AS VARCHAR) AS value, count(*) AS value_count FROM filtered WHERE ${name} IS NOT NULL GROUP BY 1 ORDER BY value_count DESC, value LIMIT ${CATEGORY_LIMIT}`,
    ),
    context.lake.query<Record<string, unknown>>(
      withCtes(recipe, query) +
        `SELECT count(${name}) AS non_null, count(*) - count(${name}) AS null_count, count(DISTINCT ${name}) AS distinct_count FROM filtered`,
    ),
  ]);
  return {
    kind: "categorical",
    column,
    description,
    nonNullCount: count(totals[0]?.non_null),
    nullCount: count(totals[0]?.null_count),
    distinctCount: count(totals[0]?.distinct_count),
    top: top.map((row): ColumnCount => ({ value: String(row.value), count: count(row.value_count) })),
  };
}

async function numericProfile(
  context: StudyContext, recipe: string, query: InventoryQuery,
  options: { column: string; expression: string; description: string; unit: string; logScaled: boolean; integerValued?: boolean; divisor?: number },
): Promise<ColumnProfile> {
  const { column, expression, description, unit, logScaled, integerValued = false, divisor = 1 } = options;
  const [bins, stats, nulls] = await Promise.all([
    histogramOf(
      context, recipe, query,
      logScaled ? `log10(${expression})` : expression,
      logScaled ? `${expression} > 0` : `${expression} IS NOT NULL`,
      query.columnBins, integerValued,
    ),
    context.lake.query<Record<string, unknown>>(withCtes(recipe, query) + `SELECT ${summaryItems(expression, divisor)} FROM filtered`),
    context.lake.query<Record<string, unknown>>(withCtes(recipe, query) + `SELECT count(*) - count(${expression}) AS null_count FROM filtered`),
  ]);
  const summary = summaryOf(stats[0]);
  return { kind: "numeric", column, description, unit, logScaled, nonNullCount: summary.count, nullCount: count(nulls[0]?.null_count), bins, summary };
}

async function timestampProfile(context: StudyContext, recipe: string, query: InventoryQuery): Promise<ColumnProfile> {
  const epochDays = `epoch(modified_timestamp) / ${num(DAY_SECONDS)}`;
  const [months, stats, nulls] = await Promise.all([
    context.lake.query<Record<string, unknown>>(
      withCtes(recipe, query) +
        `SELECT strftime(date_trunc('month', modified_timestamp), '%Y-%m') AS value, count(*) AS value_count FROM filtered WHERE modified_timestamp IS NOT NULL GROUP BY 1 ORDER BY 1`,
    ),
    context.lake.query<Record<string, unknown>>(withCtes(recipe, query) + `SELECT ${summaryItems(epochDays)} FROM filtered WHERE modified_timestamp IS NOT NULL`),
    context.lake.query<Record<string, unknown>>(withCtes(recipe, query) + `SELECT count(*) - count(modified_timestamp) AS null_count FROM filtered`),
  ]);
  const summary = summaryOf(stats[0]);
  return {
    kind: "timestamp",
    column: "modified_timestamp",
    description: "When each file was last written, counted per calendar month.",
    nonNullCount: summary.count,
    nullCount: count(nulls[0]?.null_count),
    months: months.map((row): ColumnCount => ({ value: String(row.value), count: count(row.value_count) })),
    summary,
    dates: {
      mean: dateOf(summary.mean), median: dateOf(summary.median), percentile25: dateOf(summary.percentile25),
      percentile75: dateOf(summary.percentile75), minimum: dateOf(summary.minimum), maximum: dateOf(summary.maximum),
    },
  };
}

async function booleanProfile(context: StudyContext, recipe: string, query: InventoryQuery): Promise<ColumnProfile> {
  const rows = await context.lake.query<Record<string, unknown>>(
    withCtes(recipe, query) +
      `SELECT CASE WHEN is_parquet IS NULL THEN 'unknown' WHEN is_parquet THEN 'true' ELSE 'false' END AS value, count(*) AS value_count FROM filtered GROUP BY 1 ORDER BY value_count DESC`,
  );
  const known = rows.filter((row) => row.value !== "unknown");
  return {
    kind: "categorical",
    column: "is_parquet",
    description: "Whether the file is a parquet file (true), is not (false), or was not classified (unknown).",
    nonNullCount: known.reduce((total, row) => total + count(row.value_count), 0),
    nullCount: count(rows.find((row) => row.value === "unknown")?.value_count),
    distinctCount: known.length,
    top: rows.map((row): ColumnCount => ({ value: String(row.value), count: count(row.value_count) })),
  };
}

async function columnProfilesOf(context: StudyContext, recipe: string, query: InventoryQuery): Promise<ColumnProfile[]> {
  return Promise.all([
    categoricalProfile(context, recipe, query, "store_name", "Which store a file lives in: the lake's warehouse buckets or the repositories."),
    categoricalProfile(context, recipe, query, "zone_name", "The lake zone (bucket) or the repository directory the file sits under; the 15 largest by file count."),
    categoricalProfile(context, recipe, query, "format_family", "The physical format family the file's extension maps to."),
    categoricalProfile(context, recipe, query, "file_extension", "The file's extension; the 15 most common."),
    booleanProfile(context, recipe, query),
    numericProfile(context, recipe, query, {
      column: "file_bytes", expression: "file_bytes", description: "File size in bytes, binned on log10 because sizes span ten orders of magnitude.", unit: "bytes", logScaled: true,
    }),
    numericProfile(context, recipe, query, {
      column: "file_gibibytes", expression: "file_gibibytes", description: "File size in gibibytes (bytes / 1024^3), binned on log10.", unit: "GiB", logScaled: true,
    }),
    timestampProfile(context, recipe, query),
    numericProfile(context, recipe, query, {
      column: "file_path", expression: "len(string_split(file_path, '\\'))", description: "The path is unique per file, so it is graphed by its depth: how many segments it has.", unit: "segments", logScaled: false, integerValued: true,
    }),
  ]);
}

async function recipesOf(context: StudyContext): Promise<string[]> {
  const rows = await context.lake.query<{ recipe: string }>(`SELECT DISTINCT recipe FROM ${ident(FILES_VIEW)} ORDER BY recipe DESC`);
  return rows.map((row) => String(row.recipe));
}

const handler: StudyHandler<typeof querySchema, InventoryBody> = {
  slug: "storage-format-inventory",
  datasets: [FILES_VIEW, MEASUREMENT_VIEW],
  query: querySchema,
  cacheSeconds: 600,
  async run(query, context) {
    if ((await missingViews(context, [FILES_VIEW])).length > 0) {
      context.notes.push(
        "Land the inventory with: E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/storage_format_inventory/build.py",
      );
      return emptyInventoryBody();
    }
    const recipes = await recipesOf(context);
    const recipe = recipes.includes(query.recipe) ? query.recipe : recipes[0];
    if (!recipe) {
      context.notes.push(`${FILES_VIEW} is defined but holds no rows: land the inventory with packages/ml-engine/src/studies/storage_format_inventory/build.py.`);
      return emptyInventoryBody();
    }

    const breakdownDimensions = [...BREAKDOWN_DIMENSIONS];
    const [measurement, options, totals, breakdownRows, zoneShares, sizeHistogram, timeline, familySummaries, largestFiles, columns, inventory] =
      await Promise.all([
        measurementOf(context, recipe),
        optionsOf(context, recipe),
        totalsOf(context, recipe, query),
        Promise.all(breakdownDimensions.map((dimension) => breakdownOf(context, recipe, query, dimension))),
        zoneSharesOf(context, recipe, query),
        sizeHistogramOf(context, recipe, query),
        timelineOf(context, recipe, query),
        familySummariesOf(context, recipe, query),
        largestFilesOf(context, recipe, query),
        columnProfilesOf(context, recipe, query),
        context.lake.query<{ file_count: number }>(`SELECT count(*) AS file_count FROM ${ident(FILES_VIEW)} WHERE recipe = ${text(recipe)}`),
      ]);
    const breakdowns = Object.fromEntries(breakdownDimensions.map((dimension, index) => [dimension, breakdownRows[index] ?? []])) as Record<BreakdownDimension, BreakdownRow[]>;
    return {
      available: true,
      measurement,
      recipes,
      recipe,
      options,
      inventoryFileCount: count(inventory[0]?.file_count),
      totals,
      breakdowns,
      zoneShares,
      sizeHistogram,
      timeline,
      familySummaries,
      largestFiles,
      columns,
    };
  },
};

export default handler;
