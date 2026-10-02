/**
 * EURUSD reactivity study: the response bodies the handler
 * (apps/api/studies/handlers/eurusd-reactivity.ts) sends and the page reads,
 * plus the small pure computations both sides share.
 *
 * The study has four parts, each one request: `overview` (the daily frame the
 * brush selects from), `brush` (the detail candles, the brushed-against-rest
 * return distribution), `columns` (every column of the one-minute frame) and
 * `page` (the one-minute frame, paged on the server).
 */

/** The eighteen forex pairs in market.bars; the study is scoped to EURUSD and widens by changing the page's constant. */
export const FOREX_PAIRS = [
  "AUDJPY", "AUDUSD", "CADJPY", "CHFJPY", "EURAUD", "EURCHF", "EURGBP", "EURJPY", "EURUSD",
  "GBPAUD", "GBPCHF", "GBPJPY", "GBPUSD", "NZDJPY", "NZDUSD", "USDCAD", "USDCHF", "USDJPY",
] as const;
export type ForexPair = (typeof FOREX_PAIRS)[number];
export const DEFAULT_PAIR: ForexPair = "EURUSD";

/** Minutes in one bar of each timeframe the detail panel may draw. Order matters: a tie goes to the first. */
export const TIMEFRAME_MINUTES = {
  "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440,
} as const;
export type DetailTimeframe = keyof typeof TIMEFRAME_MINUTES;

export const DEFAULT_TARGET_BARS = 200;
export const DEFAULT_Z_WINDOW = 60;
export const DEFAULT_BRUSH_DAYS = 90;
export const DAY_MILLISECONDS = 86_400_000;

/**
 * The timeframe whose bar count over `spanMinutes` is nearest `targetBars`
 * (the notebook's `min(MINUTES, key=abs(span / minutes - TARGET_BARS))`).
 */
export function chooseTimeframe(spanMinutes: number, targetBars: number): DetailTimeframe {
  let best: DetailTimeframe = "1m";
  let bestGap = Infinity;
  for (const [timeframe, minutes] of Object.entries(TIMEFRAME_MINUTES) as Array<[DetailTimeframe, number]>) {
    const gap = Math.abs(spanMinutes / minutes - targetBars);
    if (gap < bestGap) {
      best = timeframe;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Causal trailing z-score: at index i the mean and sample standard deviation
 * (n - 1 in the denominator) of the `window` values ending at i, and null until
 * a full window exists (min_periods == window). No value after i is read.
 */
export function causalRollingZScore(values: ReadonlyArray<number | null>, window: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (window < 2) return out;
  for (let index = window - 1; index < values.length; index += 1) {
    let sum = 0;
    let complete = true;
    for (let offset = index - window + 1; offset <= index; offset += 1) {
      const value = values[offset];
      if (value === null || value === undefined || !Number.isFinite(value)) {
        complete = false;
        break;
      }
      sum += value;
    }
    if (!complete) continue;
    const mean = sum / window;
    let squares = 0;
    for (let offset = index - window + 1; offset <= index; offset += 1) squares += ((values[offset] as number) - mean) ** 2;
    const deviation = Math.sqrt(squares / (window - 1));
    const current = values[index] as number;
    out[index] = deviation > 0 ? (current - mean) / deviation : null;
  }
  return out;
}

/** One measured stage of answering a request, on the server. */
export interface StageTiming {
  stage: string;
  milliseconds: number;
  rows: number;
  detail: string;
}

/** One UTC day of one-minute bars. The z-score is computed by the page (it depends on its window control). */
export interface DailyRow {
  /** Start of the UTC day, epoch milliseconds. */
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  minute_count: number;
  /** ln(high - low) for the day. */
  log_range: number;
  /** ln(close / previous close) in basis points, over the days that have a range; null on the first. */
  log_return_basis_points: number | null;
}

export interface OverviewBody {
  part: "overview";
  pair: string;
  rows: DailyRow[];
  minuteCount: number;
  firstMinute: number | null;
  lastMinute: number | null;
  dayBoundary: string;
  overviewKilobytes: number;
  rawMegabytesEstimate: number;
  timings: StageTiming[];
  computedAt: number;
}

/** The nine statistics plus the tails for one group of one-minute log returns. */
export interface DistributionSummary {
  group: string;
  count: number;
  mean: number | null;
  median: number | null;
  standard_deviation: number | null;
  skewness: number | null;
  excess_kurtosis: number | null;
  percentile_1: number | null;
  percentile_5: number | null;
  percentile_25: number | null;
  percentile_75: number | null;
  percentile_95: number | null;
  percentile_99: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface DensityBin {
  lower: number;
  upper: number;
  brushed_count: number;
  rest_count: number;
  brushed_density: number;
  rest_density: number;
}

export interface DetailCandle {
  /** Start of the bar, epoch milliseconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  minute_count: number;
  /** ln(close / previous bar's close) in basis points; null on the first bar. */
  log_return_basis_points: number | null;
}

export interface BrushBody {
  part: "brush";
  pair: string;
  /** First and last UTC day start picked, epoch milliseconds (the last day is included whole). */
  from: number;
  to: number;
  sliceEnd: number;
  spanMinutes: number;
  targetBars: number;
  timeframe: DetailTimeframe;
  minuteBarCount: number;
  candles: DetailCandle[];
  summaries: DistributionSummary[];
  densityRange: [number, number] | null;
  density: DensityBin[];
  timings: StageTiming[];
  computedAt: number;
}

export interface ColumnHistogramBin {
  lower: number;
  upper: number;
  count: number;
}

export interface ColumnProfile {
  column: string;
  /** Full-word name shown to the reader. */
  label: string;
  unit: string;
  summary: Omit<DistributionSummary, "group">;
  /** Histogram over the 0.5th to 99.5th percentile; the tails are counted beside it. */
  rangeLow: number;
  rangeHigh: number;
  belowRange: number;
  aboveRange: number;
  histogram: ColumnHistogramBin[];
}

export interface ColumnsBody {
  part: "columns";
  pair: string;
  bins: number;
  minuteCount: number;
  columns: ColumnProfile[];
  timings: StageTiming[];
  computedAt: number;
}

export interface MinuteRow {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PageBody {
  part: "page";
  pair: string;
  page: number;
  pageSize: number;
  pageCount: number;
  totalRows: number;
  rows: MinuteRow[];
  timings: StageTiming[];
  computedAt: number;
}

export type EurusdReactivityBody = OverviewBody | BrushBody | ColumnsBody | PageBody;
