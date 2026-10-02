/**
 * Lake audit: the response body of `GET /api/studies/lake-audit` and the pure
 * compute the page and the handler's tests share. Replaced
 * datalake/notebooks/lake_audit.py.
 *
 * The audit job (datalake `scripts/audit_lake.py`, `src/lake/audit.py`) scans
 * Iceberg `market.bars` once, counts every check's predicate per partition,
 * and writes a JSON report to s3://meta/audits/. `packages/ml-engine/src/studies/lake_audit/
 * build.py` flattens each report into six lake tables (one recipe per report),
 * served as `derived_study_lake_audit_<table>`; nothing here recomputes the
 * audit. Timestamps arrive as epoch milliseconds (UTC).
 */

export type Severity = "error" | "warning";
export type Remediation = "drop_row" | "review";

/** One audit run of one table: the notebook's headline block. */
export interface AuditRun {
  recipe: string;
  table_name: string;
  generated_at: number;
  snapshot_id: string;
  row_count: number;
  partition_count: number;
  error_row_count: number;
  warning_row_count: number;
  droppable_row_count: number;
  duplicate_key_row_count: number;
  row_pass_seconds: number;
  duplicate_pass_seconds: number;
  unique_key: string;
  check_count: number;
  scope_predicate: string | null;
  has_remediation: boolean;
  remediation_generated_at: number | null;
  remediation_dry_run: boolean | null;
  remediation_partitions_planned: number | null;
  remediation_partitions_rewritten: number | null;
  remediation_partitions_skipped: number | null;
  remediation_rows_removed: number | null;
  source_report: string;
}

export interface AuditCheck {
  check_name: string;
  severity: Severity;
  remediation: Remediation;
  description: string;
  predicate: string;
  violation_row_count: number;
  violation_share_of_table: number;
  affected_partition_count: number;
}

export interface CheckPartition {
  check_name: string;
  asset_class: string | null;
  root: string | null;
  timeframe: string | null;
  partition_start_timestamp: number | null;
  violation_row_count: number;
}

export interface CoverageRow {
  asset_class: string;
  timeframe: string;
  row_count: number;
  symbol_count: number;
  first_timestamp: number | null;
  last_timestamp: number | null;
  hours_since_last_row: number;
}

export interface DuplicatePartition {
  asset_class: string | null;
  root: string | null;
  timeframe: string | null;
  partition_start_timestamp: number | null;
  row_count: number;
  duplicate_key_row_count: number;
}

export interface RemediationPartition {
  asset_class: string | null;
  root: string | null;
  timeframe: string | null;
  partition_start_timestamp: number | null;
  row_count_before: number;
  row_count_after: number;
  rows_removed: number;
  status: string;
}

/** One check's violating-row count in one run, for the run-over-run diff. */
export interface CheckHistoryPoint {
  recipe: string;
  check_name: string;
  violation_row_count: number;
}

export interface LakeAuditBody {
  /** Tables that have an audit report, sorted (the notebook's Table dropdown). */
  tables: string[];
  table: string | null;
  /** Every run of this table, oldest first. */
  runs: AuditRun[];
  /** The run shown (the newest unless a `run` recipe was asked for). */
  selected: AuditRun | null;
  checks: AuditCheck[];
  checkPartitions: CheckPartition[];
  coverage: CoverageRow[];
  duplicatePartitions: DuplicatePartition[];
  remediationPartitions: RemediationPartition[];
  checkHistory: CheckHistoryPoint[];
  /** Audit report files in s3://meta/audits that are not landed yet (null when they could not be counted). */
  unlandedReportCount: number | null;
  /** True when a capped list (partitions) held more rows than were sent. */
  truncated: boolean;
}

export const EMPTY_BODY: LakeAuditBody = {
  tables: [], table: null, runs: [], selected: null, checks: [], checkPartitions: [], coverage: [],
  duplicatePartitions: [], remediationPartitions: [], checkHistory: [], unlandedReportCount: null, truncated: false,
};

/** The audit job's own rule: clean means no error-severity row and no duplicate key (lake_audit.py:73). */
export function isClean(run: Pick<AuditRun, "error_row_count" | "duplicate_key_row_count">): boolean {
  return run.error_row_count === 0 && run.duplicate_key_row_count === 0;
}

export function verdict(run: Pick<AuditRun, "error_row_count" | "duplicate_key_row_count">): string {
  if (isClean(run)) return "Every check passed.";
  const parts: string[] = [];
  if (run.error_row_count > 0) parts.push(`${run.error_row_count.toLocaleString("en-US")} rows fail an error-severity check.`);
  if (run.duplicate_key_row_count > 0) parts.push(`${run.duplicate_key_row_count.toLocaleString("en-US")} rows share a uniqueness key.`);
  return parts.join(" ");
}

/** Share of the table, in percent, as the notebook's table shows it (rounded to 6 places). */
export function sharePercent(check: Pick<AuditCheck, "violation_share_of_table">): number {
  return Math.round(check.violation_share_of_table * 100 * 1e6) / 1e6;
}

export type CheckOrder = "violations" | "name" | "severity";

/** The notebook sorts by violating rows, largest first; name and severity are page additions. */
export function orderChecks(checks: readonly AuditCheck[], order: CheckOrder): AuditCheck[] {
  const copy = [...checks];
  if (order === "name") return copy.sort((a, b) => a.check_name.localeCompare(b.check_name));
  if (order === "severity") {
    const rank = (check: AuditCheck) => (check.severity === "error" ? 0 : 1);
    return copy.sort((a, b) => rank(a) - rank(b) || b.violation_row_count - a.violation_row_count || a.check_name.localeCompare(b.check_name));
  }
  return copy.sort((a, b) => b.violation_row_count - a.violation_row_count || a.check_name.localeCompare(b.check_name));
}

export interface RunDifference {
  check_name: string;
  previous: number;
  current: number;
  change: number;
}

/** Per-check change in violating rows between two runs (checks absent from a run count as 0). */
export function differenceBetweenRuns(history: readonly CheckHistoryPoint[], previousRecipe: string, currentRecipe: string): RunDifference[] {
  const previous = new Map<string, number>();
  const current = new Map<string, number>();
  for (const point of history) {
    if (point.recipe === previousRecipe) previous.set(point.check_name, point.violation_row_count);
    if (point.recipe === currentRecipe) current.set(point.check_name, point.violation_row_count);
  }
  const names = new Set([...previous.keys(), ...current.keys()]);
  return [...names]
    .map((name) => {
      const before = previous.get(name) ?? 0;
      const after = current.get(name) ?? 0;
      return { check_name: name, previous: before, current: after, change: after - before };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.check_name.localeCompare(b.check_name));
}

/** Label for a partition: asset class, root, timeframe and the year it starts. */
export function partitionLabel(partition: Pick<CheckPartition, "asset_class" | "root" | "timeframe" | "partition_start_timestamp">): string {
  const year = partition.partition_start_timestamp === null ? "?" : String(new Date(partition.partition_start_timestamp).getUTCFullYear());
  return `${partition.asset_class ?? "?"} ${partition.root ?? "?"} ${partition.timeframe ?? "?"} ${year}`;
}

/** Fractional calendar year of an epoch-millisecond stamp, so a timestamp column can be graphed on a readable axis. */
export function fractionalYear(timestamp: number | null): number | null {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const end = Date.UTC(date.getUTCFullYear() + 1, 0, 1);
  return date.getUTCFullYear() + (timestamp - start) / (end - start);
}

/** Staleness category from hours since the last row (page addition; the notebook only prints the hours). */
export function stalenessBand(hours: number): "fresh" | "days" | "weeks" | "months" {
  if (hours < 48) return "fresh";
  if (hours < 24 * 14) return "days";
  if (hours < 24 * 90) return "weeks";
  return "months";
}
