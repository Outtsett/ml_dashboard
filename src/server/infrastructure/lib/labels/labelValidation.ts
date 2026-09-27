/**
 * Validation gates a label set passes before it is landed.
 *
 * Think of it as: the inspector at the loading dock. The rows are already in
 * the crate (a local staging file); nothing goes onto the lake until every
 * gate below has looked at them. A failed gate does not throw — it is written
 * into the report so the catalog can say WHY a set never landed.
 *
 * The gates:
 *   resolutionMonotone   every resolution bar is at or after its event bar
 *   noDuplicateEvents    one row per event timestamp
 *   coverage             labelled rows against the bars in the set's span
 *   classBalance         reported with the eight-number distribution of the
 *                        realised return; a rare-event set warns, it does not fail
 *   purgeCoversHorizon   the recorded purge is at least the longest horizon
 *   noLookahead          the generator re-run on a shorter window gives the
 *                        same label to every row that resolved inside it — a
 *                        whole-series statistic (a full-range z-score, a
 *                        PERCENT_RANK over every bar) fails this, a trailing
 *                        window passes
 *   usableShare          at least some rows are usable
 */
import {
  LABEL_CONTRACT_VERSION,
  type EightNumberSummary,
  type LabelValidationGate,
  type LabelValidationReport,
} from '@shared/labels/contract';
import { queryQuestDB } from '../../database/questdb';

export interface ValidationInput {
  /** `read_parquet('<path>')` of the enriched rows. */
  rowsSource: string;
  /** `read_parquet('<path>')` of the rows the generator produced on the truncated window, or null to skip the gate. */
  truncatedSource: string | null;
  /** Epoch milliseconds of the truncation point (the last bar the truncated run saw). */
  truncationEndMilliseconds: number | null;
  /** Bars in the set's window, for coverage. */
  barCountInWindow: number | null;
  purgeBars: number;
  timeoutMs?: number;
}

const EIGHT_NUMBERS = (column: string) => `
  count(${column}) AS count,
  avg(${column}) AS mean,
  median(${column}) AS median,
  stddev_samp(${column}) AS standard_deviation,
  CASE WHEN count(${column}) >= 3 THEN skewness(${column}) END AS skewness,
  CASE WHEN count(${column}) >= 4 THEN kurtosis(${column}) END AS kurtosis,
  quantile_cont(${column}, 0.25) AS percentile25,
  quantile_cont(${column}, 0.75) AS percentile75,
  min(${column}) AS minimum,
  max(${column}) AS maximum`;

function summaryFrom(row: Record<string, unknown> | undefined): EightNumberSummary {
  const number = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    count: Number(row?.count ?? 0),
    mean: number(row?.mean),
    median: number(row?.median),
    standardDeviation: number(row?.standard_deviation),
    skewness: number(row?.skewness),
    kurtosis: number(row?.kurtosis),
    percentile25: number(row?.percentile25),
    percentile75: number(row?.percentile75),
    minimum: number(row?.minimum),
    maximum: number(row?.maximum),
  };
}

/** More distinct label values than this and the label is continuous. */
const CONTINUOUS_LABEL_DISTINCT_THRESHOLD = 64;
const HISTOGRAM_BINS = 20;

function gate(passed: boolean, value: number | null, detail: string): LabelValidationGate {
  return { passed, value, detail };
}

export async function validateLabelRows(input: ValidationInput): Promise<LabelValidationReport> {
  const timeout = input.timeoutMs ?? 300_000;
  const rows = input.rowsSource;

  const [counts] = await queryQuestDB<Record<string, unknown>>(
    `SELECT
       count(*) AS total,
       count(DISTINCT timestamp) AS distinct_events,
       count(*) FILTER (WHERE usable) AS usable_rows,
       count(*) FILTER (WHERE resolution_bars < 0) AS negative_resolution,
       count(*) FILTER (WHERE resolution_timestamp IS NOT NULL AND resolution_timestamp < timestamp) AS resolution_before_event,
       max(resolution_bars) AS max_horizon_bars
     FROM ${rows}`,
    timeout,
  );
  const total = Number(counts?.total ?? 0);
  const distinctEvents = Number(counts?.distinct_events ?? 0);
  const usableRows = Number(counts?.usable_rows ?? 0);
  const maxHorizon = Number(counts?.max_horizon_bars ?? 0);
  const monotoneViolations = Number(counts?.negative_resolution ?? 0) + Number(counts?.resolution_before_event ?? 0);

  // A discrete label is counted per value. A continuous one (a return, a
  // volatility) would give one key per row, so it is binned into twenty
  // equal-width buckets keyed by their edges, and class balance does not apply.
  const [distinct] = await queryQuestDB<{ n: number | bigint }>(`SELECT count(DISTINCT label) AS n FROM ${rows} WHERE usable`, timeout);
  const distinctLabels = Number(distinct?.n ?? 0);
  const continuous = distinctLabels > CONTINUOUS_LABEL_DISTINCT_THRESHOLD;
  const labelDistribution: Record<string, number> = {};
  if (continuous) {
    const binRows = await queryQuestDB<{ lower: number; upper: number; cnt: number | bigint }>(
      `WITH bounds AS (SELECT min(label) AS lo, max(label) AS hi FROM ${rows} WHERE usable),
       binned AS (
         SELECT LEAST(${HISTOGRAM_BINS - 1}, GREATEST(0, CAST(floor((label - lo) / NULLIF(hi - lo, 0) * ${HISTOGRAM_BINS}) AS INTEGER))) AS bin, lo, hi
         FROM ${rows}, bounds WHERE usable
       )
       SELECT lo + bin * (hi - lo) / ${HISTOGRAM_BINS} AS lower, lo + (bin + 1) * (hi - lo) / ${HISTOGRAM_BINS} AS upper, count(*) AS cnt
       FROM binned GROUP BY bin, lo, hi ORDER BY bin`,
      timeout,
    );
    for (const row of binRows) labelDistribution[`[${Number(row.lower).toPrecision(4)}, ${Number(row.upper).toPrecision(4)})`] = Number(row.cnt);
  } else {
    const distributionRows = await queryQuestDB<{ label_key: string; cnt: number | bigint }>(
      `SELECT CAST(label AS VARCHAR) AS label_key, count(*) AS cnt FROM ${rows} WHERE usable GROUP BY 1 ORDER BY 1`,
      timeout,
    );
    for (const row of distributionRows) labelDistribution[String(row.label_key)] = Number(row.cnt);
  }
  const classCounts = continuous ? [] : Object.values(labelDistribution);
  let smallestClass = Infinity;
  let largestClass = 0;
  for (const count of classCounts) {
    if (count < smallestClass) smallestClass = count;
    if (count > largestClass) largestClass = count;
  }
  const classBalanceRatio = continuous || classCounts.length === 0 ? null : classCounts.length === 1 ? 1 : smallestClass / largestClass;

  const reasonRows = await queryQuestDB<{ usable_reason: string; cnt: number | bigint }>(
    `SELECT usable_reason, count(*) AS cnt FROM ${rows} GROUP BY 1 ORDER BY 1`,
    timeout,
  );
  const usableReasonCounts: Record<string, number> = {};
  for (const row of reasonRows) usableReasonCounts[String(row.usable_reason)] = Number(row.cnt);

  const [returnPoints] = await queryQuestDB<Record<string, unknown>>(`SELECT ${EIGHT_NUMBERS('realized_return_points')} FROM ${rows} WHERE usable`, timeout);
  const [returnUnits] = await queryQuestDB<Record<string, unknown>>(`SELECT ${EIGHT_NUMBERS('realized_return_volatility_units')} FROM ${rows} WHERE usable`, timeout);
  const [uniqueness] = await queryQuestDB<Record<string, unknown>>(`SELECT ${EIGHT_NUMBERS('sample_uniqueness_weight')} FROM ${rows} WHERE usable`, timeout);

  // The lookahead gate: every full-run row that resolved on or before the
  // truncation point must exist in the truncated run with the same label.
  let noLookahead: LabelValidationGate;
  if (input.truncatedSource && input.truncationEndMilliseconds !== null) {
    const [check] = await queryQuestDB<Record<string, unknown>>(
      `WITH full_rows AS (
         SELECT timestamp, label FROM ${rows}
         WHERE resolution_timestamp IS NOT NULL AND resolution_timestamp <= to_timestamp(${input.truncationEndMilliseconds / 1000})
       ),
       truncated_rows AS (SELECT timestamp, label FROM ${input.truncatedSource})
       SELECT
         count(*) AS compared,
         count(*) FILTER (WHERE t.timestamp IS NULL OR f.label IS DISTINCT FROM t.label) AS mismatches
       FROM full_rows f
       LEFT JOIN truncated_rows t ON t.timestamp = f.timestamp`,
      timeout,
    );
    const compared = Number(check?.compared ?? 0);
    const mismatches = Number(check?.mismatches ?? 0);
    noLookahead = gate(
      compared > 0 && mismatches === 0,
      mismatches,
      compared === 0
        ? 'no row resolved inside the truncated window, so the gate could not compare anything'
        : mismatches === 0
          ? `${compared} rows resolved inside the truncated window and every one kept its label`
          : `${mismatches} of ${compared} rows changed label when bars after their resolution were removed: the generator reads past its own horizon`,
    );
  } else {
    noLookahead = gate(true, null, 'not run (the source has too few bars to truncate)');
  }

  const coverageFraction = input.barCountInWindow && input.barCountInWindow > 0 ? total / input.barCountInWindow : null;
  const report: LabelValidationReport = {
    contractVersion: LABEL_CONTRACT_VERSION,
    checkedAtMilliseconds: Date.now(),
    passed: false,
    gates: {
      resolutionMonotone: gate(monotoneViolations === 0, monotoneViolations, monotoneViolations === 0 ? 'every label resolves at or after its event bar' : `${monotoneViolations} rows resolve before their event bar`),
      noDuplicateEvents: gate(distinctEvents === total, total - distinctEvents, distinctEvents === total ? 'one row per event bar' : `${total - distinctEvents} duplicate event bars`),
      coverage: gate(total > 0, coverageFraction, coverageFraction === null ? `${total} rows` : `${total} rows over ${input.barCountInWindow} bars (${(coverageFraction * 100).toFixed(1)}%)`),
      classBalance: gate(
        continuous ? usableRows > 0 : classCounts.length > 0,
        classBalanceRatio,
        continuous
          ? `continuous label (${distinctLabels.toLocaleString()} distinct values), binned into ${HISTOGRAM_BINS} buckets`
          : classCounts.length === 0
          ? 'no usable rows to balance'
          : classBalanceRatio !== null && classBalanceRatio < 0.1 && classCounts.length > 1
            ? `rarest class is ${(classBalanceRatio * 100).toFixed(1)}% of the commonest: stratify or weight before training`
            : `${classCounts.length} class${classCounts.length === 1 ? '' : 'es'}, rarest / commonest = ${classBalanceRatio?.toFixed(3)}`,
      ),
      purgeCoversHorizon: gate(input.purgeBars >= maxHorizon, maxHorizon, `longest horizon ${maxHorizon} bars, purge ${input.purgeBars} bars`),
      noLookahead,
      usableShare: gate(usableRows > 0, total > 0 ? usableRows / total : 0, `${usableRows} of ${total} rows usable`),
    },
    labelDistribution,
    classBalanceRatio,
    realizedReturnPoints: summaryFrom(returnPoints),
    realizedReturnVolatilityUnits: summaryFrom(returnUnits),
    sampleUniquenessWeight: summaryFrom(uniqueness),
    coverageFraction,
    usableReasonCounts,
  };
  report.passed = Object.values(report.gates).every((g) => g.passed);
  return report;
}
