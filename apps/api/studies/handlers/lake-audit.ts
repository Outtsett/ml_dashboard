/**
 * Lake audit: the data-quality report on Iceberg `market.bars`. Replaced
 * datalake/notebooks/lake_audit.py, which only rendered a JSON report the
 * audit job wrote to s3://meta/audits/ and computed nothing itself.
 *
 * Reads the six tables `packages/ml-engine/src/studies/lake_audit/build.py` lands from those
 * reports (dataset `study_lake_audit`, one recipe per report, so every past
 * run stays and a run picker has something to pick). Every list is small
 * (21 checks, 8 coverage slices) except partitions, capped at 2,000 rows. The
 * audit itself (a 785M-row scan, and `apply` which rewrites Iceberg
 * partitions) stays a Python job in the datalake repo.
 */

import { z } from "zod";
import { ident, num, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  EMPTY_BODY,
  type AuditCheck,
  type AuditRun,
  type CheckHistoryPoint,
  type CheckPartition,
  type CoverageRow,
  type DuplicatePartition,
  type LakeAuditBody,
  type RemediationPartition,
} from "@shared/studies/lake-audit";

const PREFIX = "derived_study_lake_audit_";
const VIEWS = ["runs", "checks", "check_partitions", "coverage", "duplicate_partitions", "remediation_partitions"].map((name) => `${PREFIX}${name}`);
const PARTITION_CAP = 2000;
const META_BUCKET = process.env.LAKE_META_BUCKET || "meta";

/** A table name as the audit writes it (`market.bars`) or a recipe (`market_bars_20260910T170145`). */
const TABLE_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)?$/;
const RECIPE_NAME = /^[A-Za-z0-9_]+$/;

const query = z.object({
  table: z.string().regex(TABLE_NAME).optional(),
  run: z.string().regex(RECIPE_NAME).optional(),
});

function view(name: string): string {
  return ident(`${PREFIX}${name}`);
}

/** Timestamp columns go to the browser as epoch milliseconds. */
function ms(column: string): string {
  return `epoch_ms(${ident(column)}) AS ${ident(column)}`;
}

async function unlandedReportCount(context: StudyContext, landedRuns: number): Promise<number | null> {
  try {
    const rows = await context.lake.query<{ report_count: number }>(
      `SELECT count(*) AS report_count FROM glob(${text(`s3://${META_BUCKET}/audits/*.json`)}) WHERE regexp_matches(file, '_[0-9]{8}T[0-9]{6}\\.json$')`,
    );
    const reports = Number(rows[0]?.report_count ?? 0);
    return Math.max(0, reports - landedRuns);
  } catch {
    return null;
  }
}

const handler: StudyHandler<typeof query, LakeAuditBody> = {
  slug: "lake-audit",
  datasets: VIEWS,
  query,
  cacheSeconds: 120,
  async run(parsed, context) {
    if ((await missingViews(context, VIEWS)).length > 0) return EMPTY_BODY;

    const tableRows = await context.lake.query<{ table_name: string; run_count: number }>(
      `SELECT table_name, count(*) AS run_count FROM ${view("runs")} GROUP BY table_name ORDER BY table_name`,
    );
    const tables = tableRows.map((row) => String(row.table_name));
    const landedRuns = tableRows.reduce((total, row) => total + Number(row.run_count), 0);
    const unlanded = await unlandedReportCount(context, landedRuns);
    if (unlanded !== null && unlanded > 0) {
      context.notes.push(
        `${unlanded} audit report${unlanded === 1 ? "" : "s"} in s3://${META_BUCKET}/audits ${unlanded === 1 ? "is" : "are"} not landed yet: run packages/ml-engine/src/studies/lake_audit/build.py, then refresh the derived views.`,
      );
    }
    if (tables.length === 0) {
      context.notes.push("No audit report has been landed. Run `python scripts/audit_lake.py --table bars` in the datalake repo, then packages/ml-engine/src/studies/lake_audit/build.py.");
      return { ...EMPTY_BODY, unlandedReportCount: unlanded };
    }

    const table = parsed.table && tables.includes(parsed.table) ? parsed.table : tables.includes("market.bars") ? "market.bars" : (tables[0] as string);
    if (parsed.table && table !== parsed.table) context.notes.push(`No audit report exists for ${parsed.table}; showing ${table}.`);

    const runs = await context.lake.query<AuditRun>(
      `SELECT recipe, table_name, ${ms("generated_at")}, snapshot_id, row_count, partition_count, error_row_count,
              warning_row_count, droppable_row_count, duplicate_key_row_count, row_pass_seconds, duplicate_pass_seconds,
              unique_key, check_count, scope_predicate, has_remediation, ${ms("remediation_generated_at")},
              remediation_dry_run, remediation_partitions_planned, remediation_partitions_rewritten,
              remediation_partitions_skipped, remediation_rows_removed, source_report
       FROM ${view("runs")} WHERE table_name = ${text(table)} ORDER BY generated_at`,
    );
    const newest = runs[runs.length - 1] as AuditRun;
    const asked = parsed.run ? runs.find((run) => run.recipe === parsed.run) : undefined;
    if (parsed.run && !asked) context.notes.push(`No run ${parsed.run} for ${table}; showing the newest.`);
    const selected = asked ?? newest;
    const recipe = text(selected.recipe);

    const [checks, checkPartitions, coverage, duplicatePartitions, remediationPartitions, checkHistory] = await Promise.all([
      context.lake.query<AuditCheck>(
        `SELECT check_name, severity, remediation, description, predicate, violation_row_count, violation_share_of_table, affected_partition_count
         FROM ${view("checks")} WHERE recipe = ${recipe} ORDER BY violation_row_count DESC, check_name`,
      ),
      context.lake.query<CheckPartition>(
        `SELECT check_name, asset_class, root, timeframe, ${ms("partition_start_timestamp")}, violation_row_count
         FROM ${view("check_partitions")} WHERE recipe = ${recipe} ORDER BY violation_row_count DESC, check_name LIMIT ${num(PARTITION_CAP + 1)}`,
      ),
      context.lake.query<CoverageRow>(
        `SELECT asset_class, timeframe, row_count, symbol_count, ${ms("first_timestamp")}, ${ms("last_timestamp")}, hours_since_last_row
         FROM ${view("coverage")} WHERE recipe = ${recipe} ORDER BY row_count DESC`,
      ),
      context.lake.query<DuplicatePartition>(
        `SELECT asset_class, root, timeframe, ${ms("partition_start_timestamp")}, row_count, duplicate_key_row_count
         FROM ${view("duplicate_partitions")} WHERE recipe = ${recipe} ORDER BY duplicate_key_row_count DESC LIMIT ${num(PARTITION_CAP + 1)}`,
      ),
      context.lake.query<RemediationPartition>(
        `SELECT asset_class, root, timeframe, ${ms("partition_start_timestamp")}, row_count_before, row_count_after, rows_removed, status
         FROM ${view("remediation_partitions")} WHERE recipe = ${recipe} ORDER BY rows_removed DESC LIMIT ${num(PARTITION_CAP + 1)}`,
      ),
      context.lake.query<CheckHistoryPoint>(
        `SELECT c.recipe, c.check_name, c.violation_row_count
         FROM ${view("checks")} c JOIN ${view("runs")} r ON r.recipe = c.recipe
         WHERE r.table_name = ${text(table)} ORDER BY c.recipe, c.check_name`,
      ),
    ]);

    const truncated = checkPartitions.length > PARTITION_CAP || duplicatePartitions.length > PARTITION_CAP || remediationPartitions.length > PARTITION_CAP;
    if (truncated) context.notes.push(`A partition list held more than ${PARTITION_CAP} rows; the largest ${PARTITION_CAP} of each are shown.`);

    return {
      tables,
      table,
      runs,
      selected,
      checks,
      checkPartitions: checkPartitions.slice(0, PARTITION_CAP),
      coverage,
      duplicatePartitions: duplicatePartitions.slice(0, PARTITION_CAP),
      remediationPartitions: remediationPartitions.slice(0, PARTITION_CAP),
      checkHistory,
      unlandedReportCount: unlanded,
      truncated,
    };
  },
};

export default handler;
