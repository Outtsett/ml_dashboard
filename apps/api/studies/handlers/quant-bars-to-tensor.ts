/**
 * From bars to a tensor: quantlab's transformer input, step by step. Replaced
 * Trading/quantlab/notebooks/transformer_pipeline.py.
 *
 * One DuckDB statement over the lake's `bars` view does the notebook's first
 * three stages: the volume roll (per UTC day, the contract with the most
 * volume; ties to the first symbol), the six scale-free features
 * (quant.data.vectorize) and the trailing z-score (quant.data.normalize:
 * population standard deviation, `min_periods == window` as a count guard, a
 * flat window is unknown). The rest, the windows, the 70/30 purged split, the
 * baselines and the eight numbers, is packages/shared/src/studies/quant-bars-to-tensor.ts.
 *
 * `part` picks the body: `summary` (everything but one window), `window` (the
 * window the slider sits on) and `bars` (a page of raw rows). The normalized
 * series of a (root, dates, normalization window) is kept for ten minutes, so
 * dragging the window or sequence-length slider never scans the lake again.
 */

import { z } from "zod";
import { ident, num, plainRow, text } from "../sql";
import { missingViews } from "../views";
import type { StudyContext, StudyHandler } from "../types";
import {
  FEATURE_DESCRIPTIONS, FEATURE_NAMES, RAW_BAR_COLUMNS, ROOTS, TARGET_NAME, FLAT_WINDOW_STANDARD_DEVIATION,
  distribution, fineHistogram, persistenceBaseline, splitWalkForward, trailingMoments, usableRowIndices,
  windowCountFor, windowTargets, windowsSpanningDroppedRows,
  type BarsBody, type BaselineSummary, type ColumnPanel, type ContractSpan, type QuantBarsToTensorBody,
  type SplitSummary, type SummaryBody, type TensorSummary, type TimelinePoint, type WindowBody, type WindowLastBar,
} from "@shared/studies/quant-bars-to-tensor";

const VIEW = "bars";
/** A range with more raw 1-minute rows than this (all contracts) is refused: about 1.6 years of MNQ. */
const MAX_RAW_BAR_COUNT = 1_000_000;
const CACHE_MILLISECONDS = 10 * 60_000;
const CACHE_ENTRIES = 3;
const TIMELINE_BUCKETS = 240;
const DAY_SECONDS = 86_400;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date as YYYY-MM-DD");

const query = z.object({
  part: z.enum(["summary", "window", "bars"]).default("summary"),
  root: z.enum(ROOTS).default("MNQ"),
  startDate: DATE.default("2024-06-01"),
  endDate: DATE.default("2024-09-01"),
  normalizationWindow: z.coerce.number().int().min(8).max(2048).default(256),
  sequenceLength: z.coerce.number().int().min(2).max(512).default(32),
  /** -1 = the middle window, as the notebook's slider starts. */
  windowIndex: z.coerce.number().int().min(-1).default(-1),
  barOffset: z.coerce.number().int().min(0).default(0),
  barRows: z.coerce.number().int().min(1).max(200).default(25),
});
type Query = z.infer<typeof query>;

// ── the SQL ────────────────────────────────────────────────────────────────

function dayStartSeconds(date: string): number | null {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const at = Date.UTC(year, month - 1, day);
  const back = new Date(at);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return at / 1000;
}

function rangePredicate(root: string, startSeconds: number, endSeconds: number): string {
  return `asset_class = 'futures' AND root = ${text(root)} AND timeframe = '1m'
    AND ts >= to_timestamp(${num(startSeconds)}) AND ts < to_timestamp(${num(endSeconds)})`;
}

export function rawCountSql(root: string, startSeconds: number, endSeconds: number): string {
  return `SELECT count(*) AS raw_bar_count FROM ${ident(VIEW)} WHERE ${rangePredicate(root, startSeconds, endSeconds)}`;
}

/** The continuous series with six features and six trailing z-scores per bar. */
export function pipelineSql(root: string, startSeconds: number, endSeconds: number, window: number): string {
  const frame = `ROWS BETWEEN ${num(window - 1)} PRECEDING AND CURRENT ROW`;
  const statistics = FEATURE_NAMES.map(
    (name) => `avg(${name}) OVER w AS ${name}_mean, stddev_pop(${name}) OVER w AS ${name}_spread, count(${name}) OVER w AS ${name}_known`,
  ).join(",\n      ");
  const zscores = FEATURE_NAMES.map(
    (name) => `CASE WHEN ${name}_known = ${num(window)} AND ${name}_spread > ${FLAT_WINDOW_STANDARD_DEVIATION} THEN (${name} - ${name}_mean) / ${name}_spread END AS ${name}_zscore`,
  ).join(",\n    ");
  const features = FEATURE_NAMES.map((name) => name).join(", ");
  return `WITH raw AS (
  SELECT ts, symbol, open, high, low, close, volume, epoch_ms(ts) // ${DAY_SECONDS * 1000} AS day_number
  FROM ${ident(VIEW)}
  WHERE ${rangePredicate(root, startSeconds, endSeconds)}
),
day_volume AS (
  SELECT day_number, symbol, SUM(volume) AS total_volume FROM raw GROUP BY 1, 2
),
front AS (
  SELECT day_number, symbol FROM (
    SELECT day_number, symbol,
      row_number() OVER (PARTITION BY day_number ORDER BY total_volume DESC, symbol ASC) AS volume_rank
    FROM day_volume
  ) WHERE volume_rank = 1
),
kept AS (
  SELECT r.ts, r.symbol, r.open, r.high, r.low, r.close, r.volume
  FROM raw r JOIN front f ON r.day_number = f.day_number AND r.symbol = f.symbol
),
series AS (
  SELECT * EXCLUDE (duplicate_rank) FROM (
    SELECT *, row_number() OVER (PARTITION BY ts ORDER BY symbol) AS duplicate_rank FROM kept
  ) WHERE duplicate_rank = 1
),
ordered AS (
  SELECT row_number() OVER (ORDER BY ts) - 1 AS bar_index, *,
    lag(close) OVER (ORDER BY ts) AS previous_close, lag(volume) OVER (ORDER BY ts) AS previous_volume
  FROM series
),
vectors AS (
  SELECT bar_index, ts, symbol, open, high, low, close, volume,
    CASE WHEN previous_close > 0 AND close > 0 THEN ln(close / previous_close) END AS log_return_close,
    CASE WHEN high - low > 0 THEN (close - open) / (high - low) END AS body_fraction_of_range,
    CASE WHEN high - low > 0 THEN (high - greatest(open, close)) / (high - low) END AS upper_wick_fraction_of_range,
    CASE WHEN high - low > 0 THEN (least(open, close) - low) / (high - low) END AS lower_wick_fraction_of_range,
    CASE WHEN close > 0 THEN (high - low) / close END AS normalized_range,
    CASE WHEN previous_volume IS NOT NULL THEN ln((volume + 1.0) / (previous_volume + 1.0)) END AS log_volume_change
  FROM ordered
),
rolling_statistics AS (
  SELECT *,
      ${statistics}
  FROM vectors
  WINDOW w AS (ORDER BY bar_index ${frame})
)
SELECT bar_index, epoch_ms(ts) AS timestamp_milliseconds, symbol AS contract_symbol,
    open, high, low, close, volume,
    ${features},
    ${zscores}
FROM rolling_statistics
ORDER BY bar_index`;
}

// ── the cached series ──────────────────────────────────────────────────────

interface Tensor {
  usable: Int32Array;
  windowCount: number;
  targets: Float64Array;
  lastReturns: Float64Array;
  split: ReturnType<typeof splitWalkForward>;
  baseline: BaselineSummary | null;
}

interface Series {
  rowCount: number;
  rawBarCount: number;
  barIndex: Float64Array;
  timestampMs: Float64Array;
  contractSymbol: string[];
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  features: Float64Array[];
  zscores: Float64Array[];
  usable: Int32Array;
  tensors: Map<number, Tensor>;
}

const cache = new Map<string, { at: number; series: Series }>();

/** For tests: forget every cached series. */
export function resetPipelineCache(): void {
  cache.clear();
}

function toNumber(value: unknown): number {
  return value === null || value === undefined ? Number.NaN : Number(value);
}

function columnOf(rows: Array<Record<string, unknown>>, name: string): Float64Array {
  const out = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) out[i] = toNumber((rows[i] as Record<string, unknown>)[name]);
  return out;
}

async function loadSeries(q: Query, context: StudyContext): Promise<Series | null> {
  const startSeconds = dayStartSeconds(q.startDate);
  const endSeconds = dayStartSeconds(q.endDate);
  if (startSeconds === null || endSeconds === null) {
    context.notes.push("A date is not a real calendar day.");
    return null;
  }
  if (endSeconds <= startSeconds) {
    context.notes.push("The end date must come after the start date.");
    return null;
  }
  const key = [q.root, q.startDate, q.endDate, q.normalizationWindow].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MILLISECONDS) return hit.series;
  if ((await missingViews(context, [VIEW])).length > 0) return null;

  const [counted] = await context.lake.query<{ raw_bar_count: number | bigint }>(rawCountSql(q.root, startSeconds, endSeconds));
  const rawBarCount = Number(counted?.raw_bar_count ?? 0);
  if (rawBarCount === 0) {
    context.notes.push(`The lake has no 1-minute ${q.root} bars between ${q.startDate} and ${q.endDate}.`);
    return null;
  }
  if (rawBarCount > MAX_RAW_BAR_COUNT) {
    context.notes.push(
      `${rawBarCount.toLocaleString("en-US")} raw ${q.root} 1-minute rows (every contract) fall in that range; this page reads at most ${MAX_RAW_BAR_COUNT.toLocaleString("en-US")}. Shorten the range.`,
    );
    return null;
  }

  const rows = (await context.lake.query<Record<string, unknown>>(pipelineSql(q.root, startSeconds, endSeconds, q.normalizationWindow), 120_000)).map((row) => plainRow(row));
  const rowCount = rows.length;
  const features = FEATURE_NAMES.map((name) => columnOf(rows, name));
  const zscores = FEATURE_NAMES.map((name) => columnOf(rows, `${name}_zscore`));
  const series: Series = {
    rowCount,
    rawBarCount,
    barIndex: columnOf(rows, "bar_index"),
    timestampMs: columnOf(rows, "timestamp_milliseconds"),
    contractSymbol: rows.map((row) => String(row.contract_symbol)),
    open: columnOf(rows, "open"),
    high: columnOf(rows, "high"),
    low: columnOf(rows, "low"),
    close: columnOf(rows, "close"),
    volume: columnOf(rows, "volume"),
    features,
    zscores,
    usable: usableRowIndices(zscores, rowCount),
    tensors: new Map(),
  };
  cache.set(key, { at: Date.now(), series });
  while (cache.size > CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return series;
}

function tensorFor(series: Series, q: Query): Tensor {
  const existing = series.tensors.get(q.sequenceLength);
  if (existing) return existing;
  const windowCount = windowCountFor(series.usable.length, q.sequenceLength);
  const targets = windowTargets(series.usable, series.close, q.sequenceLength);
  const logReturnZscore = series.zscores[0] as Float64Array;
  const lastReturns = new Float64Array(windowCount);
  for (let i = 0; i < windowCount; i += 1) lastReturns[i] = logReturnZscore[series.usable[i + q.sequenceLength - 1] as number] as number;
  const split = splitWalkForward(windowCount, q.sequenceLength, q.normalizationWindow);
  const baseline = persistenceBaseline(lastReturns.subarray(split.validationStart), targets.subarray(split.validationStart));
  const tensor: Tensor = { usable: series.usable, windowCount, targets, lastReturns, split, baseline };
  series.tensors.set(q.sequenceLength, tensor);
  return tensor;
}

// ── the bodies ─────────────────────────────────────────────────────────────

function panel(name: string, stage: ColumnPanel["stage"], description: string, values: ArrayLike<number>): ColumnPanel {
  return { name, stage, description, summary: distribution(values), histogram: fineHistogram(values) };
}

function contractSpans(series: Series): ContractSpan[] {
  const spans = new Map<string, ContractSpan>();
  for (let i = 0; i < series.rowCount; i += 1) {
    const symbol = series.contractSymbol[i] as string;
    const at = series.timestampMs[i] as number;
    const span = spans.get(symbol);
    if (!span) spans.set(symbol, { contractSymbol: symbol, firstTimestampMs: at, lastTimestampMs: at, barCount: 1 });
    else {
      span.lastTimestampMs = at;
      span.barCount += 1;
    }
  }
  return [...spans.values()].sort((a, b) => a.firstTimestampMs - b.firstTimestampMs);
}

function timeline(series: Series): TimelinePoint[] {
  const step = Math.max(1, Math.ceil(series.rowCount / TIMELINE_BUCKETS));
  const usableFlag = new Uint8Array(series.rowCount);
  for (let i = 0; i < series.usable.length; i += 1) usableFlag[series.usable[i] as number] = 1;
  const points: TimelinePoint[] = [];
  for (let start = 0; start < series.rowCount; start += step) {
    const end = Math.min(start + step, series.rowCount);
    let usable = 0;
    for (let i = start; i < end; i += 1) usable += usableFlag[i] as number;
    const middle = Math.floor((start + end - 1) / 2);
    points.push({
      timestampMs: series.timestampMs[middle] as number,
      close: series.close[end - 1] as number,
      usableShare: usable / (end - start),
      contractSymbol: series.contractSymbol[middle] as string,
    });
  }
  return points;
}

function emptySummary(q: Query): SummaryBody {
  return {
    part: "summary", landed: false, root: q.root, startDate: q.startDate, endDate: q.endDate,
    normalizationWindow: q.normalizationWindow, sequenceLength: q.sequenceLength,
    bars: null, normalization: null, stages: [], timeline: [], tensor: null, split: null, baseline: null,
  };
}

function summaryBody(series: Series, q: Query, context: StudyContext): SummaryBody {
  const { rowCount } = series;
  let zeroRangeBarCount = 0;
  for (let i = 0; i < rowCount; i += 1) if (!((series.high[i] as number) - (series.low[i] as number) > 0)) zeroRangeBarCount += 1;

  const stages: ColumnPanel[] = [
    ...RAW_BAR_COLUMNS.map((name) =>
      panel(name, "raw bars", name === "volume" ? "contracts traded in the minute" : `the minute's ${name}, in index points (the front month's own price, not back-adjusted)`, series[name]),
    ),
    ...FEATURE_NAMES.map((name, column) => panel(name, "feature vector", FEATURE_DESCRIPTIONS[name], series.features[column] as Float64Array)),
    ...FEATURE_NAMES.map((name, column) =>
      panel(`${name}_zscore`, "z-scored features", `${name} minus its trailing mean over ${q.normalizationWindow} bars, over its trailing standard deviation`, series.zscores[column] as Float64Array),
    ),
  ];

  const usableCount = series.usable.length;
  const warmupRowCount = Math.min(rowCount, q.normalizationWindow);
  const normalization = {
    droppedRowCount: rowCount - usableCount,
    usableRowCount: usableCount,
    warmupRowCount,
    unknownInsideWindowCount: Math.max(0, rowCount - usableCount - warmupRowCount),
  };

  let tensorSummary: TensorSummary | null = null;
  let split: SplitSummary | null = null;
  let baseline: BaselineSummary | null = null;
  const tensor = tensorFor(series, q);
  if (tensor.windowCount === 0) {
    context.notes.push(
      `${usableCount.toLocaleString("en-US")} usable rows is not enough for a ${q.sequenceLength}-bar window plus a target; widen the date range or shorten the window.`,
    );
  } else {
    stages.push(panel(TARGET_NAME, "windowed target", "log return realised on the bar right after the window's last row", tensor.targets));
    const at = (window: number): number | null => {
      const row = tensor.usable[window + q.sequenceLength - 1];
      return row === undefined ? null : (series.timestampMs[row] as number);
    };
    tensorSummary = {
      windowCount: tensor.windowCount,
      sequenceLength: q.sequenceLength,
      featureCount: FEATURE_NAMES.length,
      windowsSpanningDroppedRows: windowsSpanningDroppedRows(tensor.usable, q.sequenceLength),
      defaultWindowIndex: Math.floor(tensor.windowCount / 2),
    };
    split = {
      trainEnd: tensor.split.trainEnd,
      purgeWindowCount: tensor.split.purge,
      validationStart: tensor.split.validationStart,
      trainWindowCount: tensor.split.trainWindowCount,
      validationWindowCount: tensor.split.validationWindowCount,
      notebookPurgeWindowCount: q.sequenceLength + 256,
      trainEndTimestampMs: at(Math.max(0, tensor.split.trainEnd - 1)),
      validationStartTimestampMs: tensor.split.validationStart < tensor.windowCount ? at(tensor.split.validationStart) : null,
    };
    baseline = tensor.baseline;
  }

  return {
    part: "summary",
    landed: true,
    root: q.root,
    startDate: q.startDate,
    endDate: q.endDate,
    normalizationWindow: q.normalizationWindow,
    sequenceLength: q.sequenceLength,
    bars: {
      count: rowCount,
      firstTimestampMs: series.timestampMs[0] ?? null,
      lastTimestampMs: series.timestampMs[rowCount - 1] ?? null,
      contracts: contractSpans(series),
      zeroRangeBarCount,
      rawBarCountBeforeRoll: series.rawBarCount,
    },
    normalization,
    stages,
    timeline: timeline(series),
    tensor: tensorSummary,
    split,
    baseline,
  };
}

function orNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function windowBody(series: Series, q: Query): WindowBody | null {
  const tensor = tensorFor(series, q);
  if (tensor.windowCount === 0) return null;
  const index = q.windowIndex < 0 ? Math.floor(tensor.windowCount / 2) : Math.min(q.windowIndex, tensor.windowCount - 1);
  const rows = Array.from(tensor.usable.subarray(index, index + q.sequenceLength));
  const targetRow = tensor.usable[index + q.sequenceLength] as number;
  const lastRow = rows[rows.length - 1] as number;
  const values = rows.map((row) => series.zscores.map((column) => column[row] as number));
  const barIndexes = rows.map((row) => series.barIndex[row] as number);
  const contiguous = barIndexes.every((bar, position) => position === 0 || bar - (barIndexes[position - 1] as number) === 1) &&
    (series.barIndex[targetRow] as number) - (barIndexes[barIndexes.length - 1] as number) === 1;

  const moments = series.features.map((column) => trailingMoments(column, lastRow, q.normalizationWindow));
  const previous = lastRow > 0 ? lastRow - 1 : null;
  const lastBar: WindowLastBar = {
    timestampMs: series.timestampMs[lastRow] as number,
    contractSymbol: series.contractSymbol[lastRow] as string,
    open: series.open[lastRow] as number,
    high: series.high[lastRow] as number,
    low: series.low[lastRow] as number,
    close: series.close[lastRow] as number,
    volume: series.volume[lastRow] as number,
    previousClose: previous === null ? null : (series.close[previous] as number),
    previousVolume: previous === null ? null : (series.volume[previous] as number),
    featureValues: series.features.map((column) => orNull(column[lastRow] as number)),
    trailingMean: moments.map((moment) => (moment ? moment.mean : null)),
    trailingStandardDeviation: moments.map((moment) => (moment ? moment.standardDeviation : null)),
    trailingValues: series.features.map((column, feature) =>
      moments[feature] ? Array.from((column as Float64Array).subarray(lastRow - q.normalizationWindow + 1, lastRow + 1)) : null,
    ),
    zscores: series.zscores.map((column) => orNull(column[lastRow] as number)),
  };

  const partition: WindowBody["partition"] = index < tensor.split.trainEnd ? "train" : index < tensor.split.validationStart ? "purge" : "validation";
  const target = tensor.targets[index] as number;
  const last = tensor.lastReturns[index] as number;
  const scale = tensor.baseline?.persistenceScale ?? null;
  const errorTerms = partition === "validation" && scale !== null
    ? { lastReturnZscore: last, zeroSquaredError: target * target, persistenceSquaredError: (last * scale - target) ** 2 }
    : null;

  return {
    part: "window",
    landed: true,
    windowIndex: index,
    windowCount: tensor.windowCount,
    sequenceLength: q.sequenceLength,
    partition,
    values,
    timestampsMs: rows.map((row) => series.timestampMs[row] as number),
    barIndexes,
    contiguous,
    endTimestampMs: series.timestampMs[lastRow] as number,
    endClose: series.close[lastRow] as number,
    targetTimestampMs: series.timestampMs[targetRow] as number,
    targetClose: series.close[targetRow] as number,
    targetLogReturn: target,
    lastBar,
    errorTerms,
    baselineScale: scale,
  };
}

function barsBody(series: Series, q: Query): BarsBody {
  const offset = Math.min(q.barOffset, Math.max(0, series.rowCount - 1));
  const end = Math.min(series.rowCount, offset + q.barRows);
  const rows = [];
  for (let i = offset; i < end; i += 1) {
    rows.push({
      barIndex: series.barIndex[i] as number,
      timestampMs: series.timestampMs[i] as number,
      contractSymbol: series.contractSymbol[i] as string,
      open: series.open[i] as number,
      high: series.high[i] as number,
      low: series.low[i] as number,
      close: series.close[i] as number,
      volume: series.volume[i] as number,
    });
  }
  return { part: "bars", landed: true, offset, total: series.rowCount, rows };
}

const handler: StudyHandler<typeof query, QuantBarsToTensorBody> = {
  slug: "quant-bars-to-tensor",
  datasets: [VIEW],
  query,
  cacheSeconds: 300,
  timeoutMs: 150_000,
  async run(q, context) {
    const series = await loadSeries(q, context);
    if (series === null) {
      if (q.part === "window") return { part: "window", landed: false };
      if (q.part === "bars") return { part: "bars", landed: false, offset: 0, total: 0, rows: [] };
      return emptySummary(q);
    }
    if (q.part === "bars") return barsBody(series, q);
    if (q.part === "window") {
      const body = windowBody(series, q);
      return body ?? { part: "window", landed: false };
    }
    return summaryBody(series, q, context);
  },
};

export default handler;
