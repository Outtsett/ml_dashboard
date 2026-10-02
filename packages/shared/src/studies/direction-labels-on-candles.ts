/**
 * The body of GET /api/studies/direction-labels-on-candles, plus the pure
 * geometry the page and the server test share: which bars are anchors, which
 * arrows are drawn, where the marker lanes sit, how a label is re-derived.
 *
 * Three parts are served (`?part=`):
 *   overview  table sizes, the full-table up-rate and forward-move distribution
 *             per horizon, and the ranked sessions the window presets pick from
 *   window    one window of 1-minute bars joined to its direction labels
 *   proof     the alignment proof: every stored label re-derived from the joined closes
 *
 * A direction label `dir_h{H}` is one bit per bar: 1 when the close H BARS
 * later is above this bar's close. The bars are 1-minute bars, so H = 60 is one
 * hour ahead and H = 1440 is one trading day ahead, never an H-minute candle.
 */

/** The seven stored horizons, in bars of one minute. */
export const DIRECTION_HORIZONS = [1, 5, 15, 60, 90, 240, 1440] as const;
export type DirectionHorizon = (typeof DIRECTION_HORIZONS)[number];

/** The three horizons the notebook drew as arrows and marker lanes. */
export const DEFAULT_ARROW_HORIZONS: readonly number[] = [60, 240, 1440];

/** Minutes each horizon covers, in words a reader can use ("1 hour ahead"). */
export function horizonWords(horizon: number): string {
  if (horizon < 60) return `${horizon} minute${horizon === 1 ? "" : "s"} ahead`;
  if (horizon < 1440) {
    const hours = horizon / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? "" : "s"} ahead`;
  }
  return `${horizon / 1440} trading day ahead`;
}

/** Full-word name of a horizon's label column (the lake's own name is `dir_h{H}`). */
export function directionLabelName(horizon: number): string {
  return `direction_label_horizon_${horizon}_bars`;
}

/** Full-word name of a horizon's forward price change column (the lake's own name is `dir_delta_pts_h{H}`). */
export function forwardChangeName(horizon: number): string {
  return `forward_price_change_points_horizon_${horizon}_bars`;
}

export const FORWARD_CHANGE_NAME = forwardChangeName(15);

export interface DayRow {
  /** Calendar day as stamped (Pacific wall clock stored as UTC), YYYY-MM-DD. */
  day: string;
  summedRangePoints: number;
  barCount: number;
}

export interface EightNumbers {
  count: number;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  kurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface HistogramBar {
  lower: number;
  upper: number;
  count: number;
}

export interface HorizonSummary {
  horizon: number;
  labeledRows: number;
  upRate: number | null;
  /** Median absolute forward price change over the horizon, in points, over the whole table. */
  medianAbsoluteMovePoints: number | null;
  /** Eight numbers of the forward price change close[t+H] - close[t], in points. */
  move: EightNumbers;
  /** 40 bins between the 1st and 99th percentile of that change. */
  histogram: HistogramBar[];
}

export interface OverviewBody {
  ohlcvRows: number;
  labelRows: number;
  joinedRows: number;
  /** Bars with no label row: the inner join drops them. */
  droppedBars: number;
  firstDay: string | null;
  lastDay: string | null;
  horizons: HorizonSummary[];
  rankingSince: string;
  /** Sessions with at least this many bars are eligible for the calm and median presets. */
  eligibleMinimumBars: number;
  busiest: DayRow[];
  calmest: DayRow | null;
  median: DayRow | null;
  dayCount: number;
  eligibleDayCount: number;
  pointValueUsd: number;
  roundTripCostUsd: number;
}

export interface WindowBars {
  timestampSeconds: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: Array<number | null>;
  /** Keyed by horizon ("60"): 1 up, 0 down, null unlabeled. */
  directionLabels: Record<string, Array<0 | 1 | null>>;
  forwardChangePointsHorizon15: Array<number | null>;
}

export type WindowPreset = "busiest" | "calmest" | "median" | "date";

export interface WindowBody {
  preset: WindowPreset;
  /** The session the window starts at; null when it could not be resolved. */
  day: string | null;
  dayRow: DayRow | null;
  requestedBars: number;
  barCount: number;
  bars: WindowBars;
  /** Most common gap between consecutive bars, seconds (the notebook asserts 60). */
  modalSpacingSeconds: number | null;
  upRates: Array<{ horizon: number; labeledBars: number; upRate: number | null }>;
}

export interface ProofHorizon {
  horizon: number;
  /** Bars where the stored label and the close H bars later are both known. */
  compared: number;
  mismatches: number;
  deltaCompared: number;
  deltaMaxAbsoluteErrorPoints: number | null;
  /** The same comparison with the stored label shifted by one bar: it must fail. */
  negativeControlCompared: number;
  negativeControlMismatches: number;
}

export interface ProofBody {
  joinedRows: number;
  horizons: ProofHorizon[];
}

export function emptyBars(): WindowBars {
  return {
    timestampSeconds: [], open: [], high: [], low: [], close: [], volume: [],
    directionLabels: {}, forwardChangePointsHorizon15: [],
  };
}

// ── pure geometry ────────────────────────────────────────────────────────────

/** Most common gap between consecutive timestamps; the smallest wins a tie (pandas `mode()[0]`). */
export function modalSpacingSeconds(timestampSeconds: readonly number[]): number | null {
  if (timestampSeconds.length < 2) return null;
  const counts = new Map<number, number>();
  for (let i = 1; i < timestampSeconds.length; i += 1) {
    const gap = (timestampSeconds[i] as number) - (timestampSeconds[i - 1] as number);
    counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [gap, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && gap < best)) {
      best = gap;
      bestCount = count;
    }
  }
  return best;
}

/** Mean of the finite values (pandas `Series.mean()` skips missing). */
export function upRate(labels: ReadonlyArray<number | null>): { labeled: number; upRate: number | null } {
  let sum = 0;
  let count = 0;
  for (const value of labels) {
    if (value === null || !Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }
  return { labeled: count, upRate: count > 0 ? sum / count : null };
}

/**
 * Anchor bars for the fan: `numpy.linspace(0, max(usable - 1, 0), count).astype(int)`
 * with usable = barCount - maxHorizon - 1, so every anchor's longest arrow lands
 * inside the window. Duplicates (a window too short for the fan) are dropped.
 */
export function anchorIndices(barCount: number, maxHorizon: number, anchorCount: number): number[] {
  const usable = barCount - maxHorizon - 1;
  const stop = Math.max(usable - 1, 0);
  const count = Math.max(1, Math.floor(anchorCount));
  const out: number[] = [];
  for (let k = 0; k < count; k += 1) {
    const value = count === 1 ? 0 : (k * stop) / (count - 1);
    const index = Math.trunc(value);
    if (out[out.length - 1] !== index) out.push(index);
  }
  return out;
}

export interface Arrow {
  anchorIndex: number;
  targetIndex: number;
  horizon: number;
  /** The stored label at the anchor for this horizon. */
  label: 0 | 1 | null;
  fromClose: number;
  toClose: number;
  /** close[t+H] - close[t], points. */
  changePoints: number;
  /** Whether the close H bars later is above this bar's close. */
  realisedUp: boolean;
  /** Stored label equals the realised sign (false means the stored bit disagrees with the segment). */
  labelAgrees: boolean | null;
}

/** One arrow per anchor and horizon, close[t] to close[t+H]; an arrow whose target falls past the window is skipped. */
export function buildArrows(bars: WindowBars, horizons: readonly number[], anchors: readonly number[]): Arrow[] {
  const arrows: Arrow[] = [];
  const total = bars.close.length;
  for (const anchor of anchors) {
    for (const horizon of horizons) {
      const target = anchor + horizon;
      if (target >= total) continue;
      const fromClose = bars.close[anchor] as number;
      const toClose = bars.close[target] as number;
      const label = bars.directionLabels[String(horizon)]?.[anchor] ?? null;
      const realisedUp = toClose > fromClose;
      arrows.push({
        anchorIndex: anchor, targetIndex: target, horizon, label, fromClose, toClose,
        changePoints: toClose - fromClose, realisedUp,
        labelAgrees: label === null ? null : (label === 1) === realisedUp,
      });
    }
  }
  return arrows;
}

/** Price of marker lane `k` (0 is the highest): stacked below the lowest low, as the notebook did. */
export function laneLevel(lowMinimum: number, highMaximum: number, lane: number): number {
  const span = highMaximum - lowMinimum;
  return lowMinimum - span * (0.05 + 0.035 * lane);
}

/** Running sum and count of a label column over the first `upTo` bars (the up-rate Σ, stepped). */
export function runningUp(labels: ReadonlyArray<number | null>, upTo: number): { sum: number; labeled: number } {
  let sum = 0;
  let labeled = 0;
  const limit = Math.min(Math.max(0, Math.floor(upTo)), labels.length);
  for (let i = 0; i < limit; i += 1) {
    const value = labels[i];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    sum += value;
    labeled += 1;
  }
  return { sum, labeled };
}

/** Parse "60,240,1440" into the stored horizons it names, ascending and unique. */
export function parseHorizons(text: string): number[] {
  const wanted = new Set(
    text.split(",").map((part) => Number(part.trim())).filter((value) => Number.isInteger(value)),
  );
  return DIRECTION_HORIZONS.filter((horizon) => wanted.has(horizon));
}

export function horizonsText(horizons: readonly number[]): string {
  return [...horizons].sort((a, b) => a - b).join(",");
}

export const ELIGIBLE_MINIMUM_BARS = 1000;

/**
 * The sessions the presets choose among, from every ranked day: the three
 * busiest by summed realised range, and (among sessions with at least
 * ELIGIBLE_MINIMUM_BARS bars, so a half-day holiday is not "calm") the calmest
 * and the one at the median.
 */
export function pickDays(days: readonly DayRow[]): {
  busiest: DayRow[]; calmest: DayRow | null; median: DayRow | null; eligibleDayCount: number;
} {
  const byRangeDescending = [...days].sort((a, b) => b.summedRangePoints - a.summedRangePoints || a.day.localeCompare(b.day));
  const eligible = days
    .filter((row) => row.barCount >= ELIGIBLE_MINIMUM_BARS)
    .sort((a, b) => a.summedRangePoints - b.summedRangePoints || a.day.localeCompare(b.day));
  return {
    busiest: byRangeDescending.slice(0, 3),
    calmest: eligible[0] ?? null,
    median: eligible[Math.floor(eligible.length / 2)] ?? null,
    eligibleDayCount: eligible.length,
  };
}

/** `day` plus a number of calendar days, both YYYY-MM-DD, in UTC arithmetic (the stamps are UTC digits). */
export function addDays(day: string, days: number): string {
  const stamp = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) + days * 86_400_000;
  return new Date(stamp).toISOString().slice(0, 10);
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const stamp = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(stamp.getTime()) && stamp.toISOString().slice(0, 10) === text;
}
