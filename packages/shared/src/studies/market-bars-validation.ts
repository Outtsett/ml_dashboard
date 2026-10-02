/**
 * The body of GET /api/studies/market-bars-validation and the pure compute the
 * handler and the page share.
 *
 * The source is the validation record of the one-time copy of Iceberg
 * market.bars into the PostgreSQL / TimescaleDB market_bars hypertable: one
 * row per comparison (tier, column, check, the value on each side, whether
 * they matched), landed from the old notebook's standalone database as
 * derived_study_market_bars_validation_{checks,measurement,table_columns}.
 * "Latest" means the most recent result per (tier, column, check), because the
 * tiers are run separately and at very different cost.
 */

export interface CheckRow {
  tier: string;
  column_name: string;
  check_name: string;
  lake_value: string | null;
  postgres_value: string | null;
  matched: boolean;
  /** Milliseconds since the epoch of the wall-clock stamp the validator wrote. */
  recorded_timestamp: number;
}

export interface MeasurementRow {
  lake_row_count: number;
  comparison_target: string;
  validator_script: string;
  recorded_check_count: number;
  latest_check_count: number;
  tier_count: number;
  table_column_count: number;
  first_recorded_timestamp: number | null;
  last_recorded_timestamp: number | null;
}

export interface TierOutcome {
  tier: string;
  passed: number;
  failed: number;
  total: number;
  lastRecordedTimestamp: number;
}

export interface CoverageCell {
  column: string;
  tier: string;
  checkCount: number;
  failedCount: number;
}

export interface FillRate {
  column: string;
  nonNullRows: number;
  fillPercent: number;
  sliceCount: number;
}

export interface InvariantRow {
  invariant: string;
  whyItMatters: string;
  lakeViolations: string | null;
  postgresViolations: string | null;
  sidesAgree: boolean;
}

export const DISTRIBUTION_STATISTICS = [
  "count", "mean", "median", "standard_deviation", "skewness", "kurtosis", "percentile_25", "percentile_75", "minimum", "maximum",
] as const;
export type DistributionStatistic = (typeof DISTRIBUTION_STATISTICS)[number];

export interface DistributionRow {
  column: string;
  statistics: Record<DistributionStatistic, number | null>;
}

export interface SumDifference {
  column: string;
  slice: string;
  lakeSum: number;
  postgresSum: number;
  /** |lake - postgres| / max(|lake|, |postgres|, 1), the validator's own scale. */
  relativeDifference: number;
  matched: boolean;
}

export interface FingerprintRow {
  column: string;
  slice: string;
  lakeBits: string | null;
  postgresBits: string | null;
  matched: boolean;
}

export interface ValidationKpis {
  checkCount: number;
  passedCount: number;
  failedCount: number;
  tierCount: number;
  columnsCovered: number;
  columnTotal: number;
  uncoveredColumns: string[];
}

export interface ValidationBody {
  /** False when the record has not been landed (the page explains). */
  available: boolean;
  /** Every check's latest result, tier then column then check. */
  checks: CheckRow[];
  measurement: MeasurementRow | null;
  tableColumns: string[];
  /** Results that a later run of the same check replaced. */
  supersededCount: number;
  /** Rows the lake held when it was validated: the fill-rate denominator. */
  lakeRowCount: number | null;
  /** The same count rebuilt from the exact tier's per-slice row counts; equal when the record is coherent. */
  lakeRowCountFromSlices: number | null;
  kpis: ValidationKpis;
  tiers: TierOutcome[];
  coverage: CoverageCell[];
  fill: FillRate[];
  invariants: InvariantRow[];
  distribution: DistributionRow[];
  sums: SumDifference[];
  fingerprints: FingerprintRow[];
}

export const EMPTY_BODY: ValidationBody = {
  available: false,
  checks: [],
  measurement: null,
  tableColumns: [],
  supersededCount: 0,
  lakeRowCount: null,
  lakeRowCountFromSlices: null,
  kpis: { checkCount: 0, passedCount: 0, failedCount: 0, tierCount: 0, columnsCovered: 0, columnTotal: 0, uncoveredColumns: [] },
  tiers: [],
  coverage: [],
  fill: [],
  invariants: [],
  distribution: [],
  sums: [],
  fingerprints: [],
};

/** The validator writes the string "None" for an absent value. */
export function parseNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "None" || trimmed === "nan") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The value inside the trailing "[...]" of a check name: "sum [futures 1s]" gives "futures 1s". */
export function sliceOf(checkName: string): string {
  const match = /\[([^\]]*)\]/.exec(checkName);
  return match?.[1] ?? "";
}

export function relativeDifference(left: number, right: number): number {
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / scale;
}

/** The validator's float-sum tolerance (scripts/validate_market_bars_columns.py SUM_RELATIVE_TOLERANCE). */
export const SUM_RELATIVE_TOLERANCE = 1e-9;

export function computeKpis(checks: readonly CheckRow[], tableColumns: readonly string[]): ValidationKpis {
  const failedCount = checks.filter((check) => !check.matched).length;
  const covered = new Set(checks.map((check) => check.column_name).filter((name) => tableColumns.includes(name)));
  return {
    checkCount: checks.length,
    passedCount: checks.length - failedCount,
    failedCount,
    tierCount: new Set(checks.map((check) => check.tier)).size,
    columnsCovered: covered.size,
    columnTotal: tableColumns.length,
    uncoveredColumns: tableColumns.filter((name) => !covered.has(name)).sort(),
  };
}

export function computeTiers(checks: readonly CheckRow[]): TierOutcome[] {
  const byTier = new Map<string, TierOutcome>();
  for (const check of checks) {
    const entry = byTier.get(check.tier) ?? { tier: check.tier, passed: 0, failed: 0, total: 0, lastRecordedTimestamp: 0 };
    if (check.matched) entry.passed += 1;
    else entry.failed += 1;
    entry.total += 1;
    entry.lastRecordedTimestamp = Math.max(entry.lastRecordedTimestamp, check.recorded_timestamp);
    byTier.set(check.tier, entry);
  }
  return [...byTier.values()].sort((a, b) => b.total - a.total || a.tier.localeCompare(b.tier));
}

/** Column by tier, restricted to the real columns (the invariant tier stores rule names in column_name). */
export function computeCoverage(checks: readonly CheckRow[], tableColumns: readonly string[]): CoverageCell[] {
  const real = new Set(tableColumns);
  const cells = new Map<string, CoverageCell>();
  for (const check of checks) {
    if (!real.has(check.column_name)) continue;
    const key = `${check.column_name}\u0000${check.tier}`;
    const cell = cells.get(key) ?? { column: check.column_name, tier: check.tier, checkCount: 0, failedCount: 0 };
    cell.checkCount += 1;
    if (!check.matched) cell.failedCount += 1;
    cells.set(key, cell);
  }
  return [...cells.values()].sort((a, b) => a.column.localeCompare(b.column) || a.tier.localeCompare(b.tier));
}

/**
 * Non-null rows per column: the exact tier's non_null checks, lake side, summed
 * over slices, against the lake's row count. A column both sides agree is empty
 * passes every comparison, so this has to be read as a data fact.
 */
export function computeFill(checks: readonly CheckRow[], lakeRowCount: number | null): FillRate[] {
  const byColumn = new Map<string, FillRate>();
  for (const check of checks) {
    if (check.tier !== "exact" || !check.check_name.startsWith("non_null") || check.column_name === "*") continue;
    const rows = parseNumber(check.lake_value);
    const entry = byColumn.get(check.column_name) ?? { column: check.column_name, nonNullRows: 0, fillPercent: 0, sliceCount: 0 };
    if (rows !== null) entry.nonNullRows += Math.trunc(rows);
    entry.sliceCount += 1;
    byColumn.set(check.column_name, entry);
  }
  const denominator = lakeRowCount && lakeRowCount > 0 ? lakeRowCount : null;
  for (const entry of byColumn.values()) {
    entry.fillPercent = denominator ? Math.round((entry.nonNullRows / denominator) * 100 * 1e4) / 1e4 : 0;
  }
  return [...byColumn.values()].sort((a, b) => b.nonNullRows - a.nonNullRows || a.column.localeCompare(b.column));
}

export function computeInvariants(checks: readonly CheckRow[]): InvariantRow[] {
  return checks
    .filter((check) => check.tier === "invariant")
    .map((check) => ({
      invariant: check.column_name,
      whyItMatters: check.check_name,
      lakeViolations: check.lake_value,
      postgresViolations: check.postgres_value,
      sidesAgree: check.matched,
    }));
}

/** The distribution tier as one row per column with the ten statistics as numbers. */
export function computeDistribution(checks: readonly CheckRow[]): DistributionRow[] {
  const byColumn = new Map<string, DistributionRow>();
  for (const check of checks) {
    if (check.tier !== "distribution") continue;
    if (!(DISTRIBUTION_STATISTICS as readonly string[]).includes(check.check_name)) continue;
    const row = byColumn.get(check.column_name) ?? {
      column: check.column_name,
      statistics: Object.fromEntries(DISTRIBUTION_STATISTICS.map((name) => [name, null])) as Record<DistributionStatistic, number | null>,
    };
    row.statistics[check.check_name as DistributionStatistic] = parseNumber(check.lake_value);
    byColumn.set(check.column_name, row);
  }
  return [...byColumn.values()].sort((a, b) => a.column.localeCompare(b.column));
}

/** Float and integer sums per slice with the relative difference the validator judged them by. */
export function computeSums(checks: readonly CheckRow[]): SumDifference[] {
  const out: SumDifference[] = [];
  for (const check of checks) {
    if (check.tier !== "sum") continue;
    const lakeSum = parseNumber(check.lake_value);
    const postgresSum = parseNumber(check.postgres_value);
    if (lakeSum === null || postgresSum === null) continue;
    out.push({
      column: check.column_name,
      slice: sliceOf(check.check_name),
      lakeSum,
      postgresSum,
      relativeDifference: relativeDifference(lakeSum, postgresSum),
      matched: check.matched,
    });
  }
  return out.sort((a, b) => b.relativeDifference - a.relativeDifference || a.column.localeCompare(b.column) || a.slice.localeCompare(b.slice));
}

export function computeFingerprints(checks: readonly CheckRow[]): FingerprintRow[] {
  return checks
    .filter((check) => check.tier === "fingerprint")
    .map((check) => ({
      column: check.column_name,
      slice: sliceOf(check.check_name),
      lakeBits: check.lake_value,
      postgresBits: check.postgres_value,
      matched: check.matched,
    }));
}

/** Rows the lake held, summed over the exact tier's per-slice row_count checks. */
export function sliceRowTotal(checks: readonly CheckRow[]): number | null {
  let total = 0;
  let seen = 0;
  for (const check of checks) {
    if (check.tier !== "exact" || check.column_name !== "*" || !check.check_name.startsWith("row_count [")) continue;
    const rows = parseNumber(check.lake_value);
    if (rows === null) continue;
    total += Math.trunc(rows);
    seen += 1;
  }
  return seen > 0 ? total : null;
}

/** Everything the page draws, from the latest result per check. */
export function summarise(
  checks: CheckRow[],
  tableColumns: string[],
  measurement: MeasurementRow | null,
  supersededCount: number,
): ValidationBody {
  const lakeRowCountFromSlices = sliceRowTotal(checks);
  const lakeRowCount = measurement?.lake_row_count ?? lakeRowCountFromSlices;
  return {
    available: checks.length > 0,
    checks,
    measurement,
    tableColumns,
    supersededCount,
    lakeRowCount,
    lakeRowCountFromSlices,
    kpis: computeKpis(checks, tableColumns),
    tiers: computeTiers(checks),
    coverage: computeCoverage(checks, tableColumns),
    fill: computeFill(checks, lakeRowCount),
    invariants: computeInvariants(checks),
    distribution: computeDistribution(checks),
    sums: computeSums(checks),
    fingerprints: computeFingerprints(checks),
  };
}

export interface SliceCount {
  slice: string;
  nonNullRows: number | null;
}

/** One column's non-null row count in each slice (the terms of the fill-rate sum), in slice-name order. */
export function nonNullBySlice(checks: readonly CheckRow[], column: string): SliceCount[] {
  return checks
    .filter((check) => check.tier === "exact" && check.column_name === column && check.check_name.startsWith("non_null ["))
    .map((check) => ({ slice: sliceOf(check.check_name), nonNullRows: parseNumber(check.lake_value) }))
    .sort((a, b) => a.slice.localeCompare(b.slice));
}
