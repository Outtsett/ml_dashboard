/**
 * The data lifecycle, audited. Replaced notebooks/data_lifecycle_audit.py.
 *
 * A finished record of the 2026-09-23 measured audit of how market data is
 * stored, retrieved, moved, computed on, held in memory, saved temporarily and
 * destroyed: 43 findings (each re-run by a second reader), 2 struck, 50
 * headline measurements, 28 confirmed library facts, and 36 raw measurement
 * tables. The audit's tables are already in the lake under
 * `s3://derived/data_lifecycle_audit/recipe=<name>/table=<table>/`, served as
 * `derived_data_lifecycle_audit_<table>`; this handler reads them, it computes
 * nothing. All 43 findings go to the page, which filters and groups them as its
 * controls move. One raw table (the one asked for, else the largest) goes with
 * them; its name is checked against the audit's own index before it reaches SQL.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyHandler } from "../types";
import {
  EMPTY_BODY,
  type AuditBody,
  type DocumentationRow,
  type FindingRow,
  type HeadlineRow,
  type RawColumn,
  type RawTable,
  type RawTableIndexRow,
  type RefutedRow,
} from "@shared/studies/data-lifecycle-audit";

const PREFIX = "derived_data_lifecycle_audit_";
export const FINDINGS_VIEW = `${PREFIX}findings`;
export const REFUTED_VIEW = `${PREFIX}refuted_findings`;
export const HEADLINE_VIEW = `${PREFIX}headline_measurements`;
export const DOCUMENTATION_VIEW = `${PREFIX}documentation_confirmed`;
export const INDEX_VIEW = `${PREFIX}raw_table_index`;
const CORE_VIEWS = [FINDINGS_VIEW, REFUTED_VIEW, HEADLINE_VIEW, DOCUMENTATION_VIEW, INDEX_VIEW] as const;

/** The 36 raw measurement tables of the 2026-09-23 audit (the index view lists them at run time). */
const RAW_TABLES = [
  "raw_gaps__bucket_versions", "raw_gaps__curated_bars_leaf_partitions", "raw_gaps__iceberg_metadata_objects",
  "raw_gaps__iceberg_snapshots", "raw_gaps__land_raw_read_bytes_memory", "raw_gaps__lifecycle_gap_matrix",
  "raw_gaps__log_stringify_timings", "raw_gaps__manifest_recorded_versus_actual_bytes", "raw_gaps__noncurrent_versions",
  "raw_gaps__notebook_session_peak_memory", "raw_gaps__raw_mbp1_scan_cost", "raw_gaps__raw_objects",
  "raw_gaps__repo_local_parquet_inventory", "raw_gaps__server_process_memory", "raw_gaps__writer_rglob_listing_cost",
  "raw_lake_storage__bars_data_files", "raw_lake_storage__derived_bucket_top_level_sizes",
  "raw_lake_storage__measurement_summary", "raw_lake_storage__snapshot_table_sizes",
  "raw_python_compute__compute_features_njobs", "raw_python_compute__dtype_footprint",
  "raw_python_compute__fetch_path_benchmark", "raw_python_compute__microstructure_benchmark",
  "raw_python_compute__pandas_apply_vs_numba", "raw_python_compute__quantile_benchmark",
  "raw_python_compute__rolling_kernel_benchmark", "raw_python_compute__windowing_and_e2e_memory",
  "raw_server_read_path__bars_cache_test", "raw_server_read_path__bars_coldwarm",
  "raw_server_read_path__duckdb_measurements", "raw_server_read_path__endpoint_timings",
  "raw_server_read_path__profile_and_columnar_measurements", "raw_temporary_storage__cache_inventory",
  "raw_temporary_storage__disk_temp_directories", "raw_temporary_storage__ohlcv_cache_size_measurement",
  "raw_temporary_storage_verify__verification_measurements",
] as const;

/** Raw rows sent to the browser: the largest raw table holds 1,315, so nothing is cut today. */
export const RAW_ROW_CAP = 5000;

export const querySchema = z.object({
  /** Which measurement run to read; the newest when absent. */
  recipe: z.string().regex(/^[A-Za-z0-9_.\-]{1,120}$/).optional(),
  /** A raw table's name as the audit's index lists it; the largest when absent. */
  table: z.string().regex(/^[a-z0-9_]{1,120}$/).optional(),
});

const NUMERIC_TYPE = /^(TINYINT|SMALLINT|INTEGER|BIGINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|DOUBLE|REAL)$/;
const WIDE_NUMERIC_TYPE = /^(HUGEINT|UHUGEINT|DECIMAL)/;

/** How one raw column is read: numbers as numbers, booleans and labels as they are, stamps in UTC, everything else as text. */
export function rawColumnSelect(name: string, dataType: string): { select: string; column: RawColumn } {
  const type = dataType.toUpperCase();
  if (NUMERIC_TYPE.test(type)) return { select: ident(name), column: { name, type: "number" } };
  if (WIDE_NUMERIC_TYPE.test(type)) return { select: `CAST(${ident(name)} AS DOUBLE) AS ${ident(name)}`, column: { name, type: "number" } };
  if (type === "VARCHAR" || type === "BOOLEAN") return { select: ident(name), column: { name, type: "text" } };
  // A zoned instant is written in UTC whatever time zone the connection carries.
  if (type === "TIMESTAMP WITH TIME ZONE") {
    return { select: `CAST(CAST(${ident(name)} AT TIME ZONE 'UTC' AS TIMESTAMP) AS VARCHAR) || ' UTC' AS ${ident(name)}`, column: { name, type: "text" } };
  }
  return { select: `CAST(${ident(name)} AS VARCHAR) AS ${ident(name)}`, column: { name, type: "text" } };
}

async function readRawTable(
  context: Parameters<StudyHandler["run"]>[1],
  recipe: string,
  entry: RawTableIndexRow,
): Promise<RawTable | null> {
  const view = `${PREFIX}${entry.raw_table_name}`;
  if ((await missingViews(context, [view])).length > 0) return null;
  const typed = await context.lake.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ${text(view)} AND column_name <> 'recipe' ORDER BY ordinal_position`,
  );
  if (typed.length === 0) return null;
  const parts = typed.map((row) => rawColumnSelect(String(row.column_name), String(row.data_type)));
  const rows = await context.lake.query<Record<string, unknown>>(
    `SELECT ${parts.map((part) => part.select).join(", ")} FROM ${ident(view)} WHERE recipe = ${text(recipe)} LIMIT ${num(RAW_ROW_CAP)}`,
  );
  const rowCount = Number(entry.row_count);
  // A BIGINT identifier past 2^53 reaches us as a string: it is a label, not a quantity, so it is drawn as one.
  const columns = parts.map((part) => {
    if (part.column.type === "number" && rows.some((row) => typeof row[part.column.name] === "string")) return { ...part.column, type: "text" as const };
    return part.column;
  });
  return { name: entry.raw_table_name, columns, rows, rowCount, truncated: rowCount > rows.length };
}

const handler: StudyHandler<typeof querySchema, AuditBody> = {
  slug: "data-lifecycle-audit",
  datasets: [...CORE_VIEWS, ...RAW_TABLES.map((name) => `${PREFIX}${name}`)],
  query: querySchema,
  cacheSeconds: 600,
  async run(query, context) {
    if ((await missingViews(context, CORE_VIEWS)).length > 0) return { ...EMPTY_BODY };

    const recipeRows = await context.lake.query<{ recipe: string }>(`SELECT DISTINCT recipe FROM ${ident(FINDINGS_VIEW)} ORDER BY recipe DESC`);
    const recipes = recipeRows.map((row) => String(row.recipe));
    if (recipes.length === 0) return { ...EMPTY_BODY };
    let recipe = recipes[0] as string;
    if (query.recipe !== undefined) {
      if (recipes.includes(query.recipe)) recipe = query.recipe;
      else context.notes.push(`No audit run named ${query.recipe}; showing ${recipe}.`);
    }
    const where = `WHERE recipe = ${text(recipe)}`;

    const [findings, refuted, headline, documentation, rawIndex] = await Promise.all([
      context.lake.query<FindingRow>(
        `SELECT * EXCLUDE (recipe, audit_date), CAST(audit_date AS VARCHAR) AS audit_date FROM ${ident(FINDINGS_VIEW)} ${where} ORDER BY identifier`,
      ),
      context.lake.query<RefutedRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(REFUTED_VIEW)} ${where} ORDER BY identifier`),
      context.lake.query<HeadlineRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(HEADLINE_VIEW)} ${where} ORDER BY strand, measurement_name`),
      context.lake.query<DocumentationRow>(`SELECT * EXCLUDE (recipe) FROM ${ident(DOCUMENTATION_VIEW)} ${where} ORDER BY strand, topic`),
      context.lake.query<RawTableIndexRow>(
        `SELECT * EXCLUDE (recipe) FROM ${ident(INDEX_VIEW)} ${where} ORDER BY row_count DESC, raw_table_name`,
      ),
    ]);

    // The table name reaches SQL only after it matches the audit's own index.
    let chosen = rawIndex[0];
    if (query.table !== undefined) {
      const asked = rawIndex.find((entry) => entry.raw_table_name === query.table);
      if (asked) chosen = asked;
      else context.notes.push(`No raw table named ${query.table} in this audit; showing ${chosen?.raw_table_name ?? "none"}.`);
    }
    const rawTable = chosen ? await readRawTable(context, recipe, chosen) : null;
    if (rawTable?.truncated) context.notes.push(`${rawTable.name} has ${rawTable.rowCount.toLocaleString("en-US")} rows; the first ${rawTable.rows.length.toLocaleString("en-US")} are shown.`);

    return { recipe, recipes, findings, refuted, headline, documentation, rawIndex, rawTable };
  },
};

export default handler;
