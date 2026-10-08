/**
 * Model Cycle chart — pure functions only.
 *
 * Everything the cycle chart decides that can be decided without a canvas
 * lives here, so it can be tested without lightweight-charts or a DOM:
 *
 *  - mapping store columns to series points (candles, prediction strip,
 *    probability line, equity line), one bar range at a time;
 *  - the on-candle prediction glyph of each bar (side, colour, solid / hollow /
 *    faint) and its triangle geometry;
 *  - the price model's forecast line (points at the bar each forecast is for),
 *    built incrementally with a target-time → source-bar map for the readout;
 *  - the "what must be drawn this frame" bookkeeping (append the new tail,
 *    or reset everything when the store was replaced);
 *  - the band list (training / validation / test spans, the active block the
 *    model is working on, the test cursor) from the plan and the cursor;
 *  - trade markers from trade records;
 *  - the visible ranges follow mode asks for;
 *  - the crosshair readout for one bar (label move in points / ticks / USD,
 *    the forecast and its error, the trade opened at the next bar, the roll
 *    note);
 *  - the forecast price text beside each glyph and the hover segment, as
 *    pixel layout;
 *  - the hover → store publish throttle and click-to-pin rule.
 *
 * The drawing side is `CycleChart.tsx` (series, rAF loop) and `chartBands.ts`
 * (the canvas primitive). Wire contract: `@shared/cycle/schema`.
 */
import type { SeriesMarker, Time, UTCTimestamp } from "lightweight-charts";

import {
  findBarIndex,
  isScoredBar,
  type CycleBarColumns,
  type CycleBarSpan,
  type CycleCursor,
  type CyclePlan,
  type CycleTrade,
} from "@shared/cycle/schema";

// ─── Palette (Okabe-Ito) ────────────────────────────────────────────────────

export const CYCLE_COLORS = {
  /** Up / long / profit. */
  up: "#E69F00",
  /** Down / short / loss. */
  down: "#0072B2",
  /** Training span, probability line. */
  sky: "#56B4E9",
  /** Validation span. */
  yellow: "#F0E442",
  /** Not used for a wrong label: that is neutral grey plus ✗, so right/wrong never rests on a hue pair. */
  vermillion: "#D55E00",
  /** The block the model is working on right now. */
  active: "#CC79A7",
  /** Neutral: no direction predicted. */
  neutral: "#B8BEC8",
} as const;

/** Alpha of a bar the model has not been tested on (context). */
export const CONTEXT_ALPHA = 0.4;
/**
 * Alpha of a validation-replay bar. The replay animates on the chart on purpose, so its
 * bars are drawn — at a lower alpha than a scored test bar, and never in the equity line
 * or the run's markers, because the model was fitted and selected on those bars.
 */
export const REPLAY_ALPHA = 0.6;
/** Faintest a prediction-strip bar gets, so a coin-flip prediction is still visible. */
export const STRIP_MINIMUM_ALPHA = 0.25;

/** `#RRGGBB` + alpha → `rgba(r, g, b, a)`. */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${red}, ${green}, ${blue}, ${Math.round(clamped * 1000) / 1000})`;
}

// Precomputed per-bar colours: the append path runs per bar, so it must not
// build strings it can look up.
const PROCESSED_UP = CYCLE_COLORS.up;
const PROCESSED_DOWN = CYCLE_COLORS.down;
const REPLAY_UP = withAlpha(CYCLE_COLORS.up, REPLAY_ALPHA);
const REPLAY_DOWN = withAlpha(CYCLE_COLORS.down, REPLAY_ALPHA);
const CONTEXT_UP = withAlpha(CYCLE_COLORS.up, CONTEXT_ALPHA);
const CONTEXT_DOWN = withAlpha(CYCLE_COLORS.down, CONTEXT_ALPHA);

/** Strip colours bucketed by alpha (0.25..1 in 0.05 steps) so none is built per bar. */
const STRIP_ALPHA_STEPS = 16;
function stripRamp(hex: string): string[] {
  const ramp: string[] = [];
  for (let step = 0; step < STRIP_ALPHA_STEPS; step += 1) {
    ramp.push(withAlpha(hex, STRIP_MINIMUM_ALPHA + ((1 - STRIP_MINIMUM_ALPHA) * step) / (STRIP_ALPHA_STEPS - 1)));
  }
  return ramp;
}
const STRIP_UP_RAMP = stripRamp(CYCLE_COLORS.up);
const STRIP_DOWN_RAMP = stripRamp(CYCLE_COLORS.down);
const STRIP_NEUTRAL_RAMP = stripRamp(CYCLE_COLORS.neutral);

// ─── Series points ──────────────────────────────────────────────────────────

export interface CycleCandlePoint {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  color: string;
  borderColor: string;
  wickColor: string;
}

export interface WhitespacePoint {
  time: UTCTimestamp;
}

export interface ValuePoint {
  time: UTCTimestamp;
  value: number;
}

export interface ColoredValuePoint extends ValuePoint {
  color: string;
}

export type StripPoint = ColoredValuePoint | WhitespacePoint;
export type LinePoint = ValuePoint | WhitespacePoint;

/**
 * Up or down for bar `index`: close against the previous close, the rule the
 * Market chart uses (`useChartSeries.ts`), so the two charts colour the same
 * bar the same way. The first bar falls back to close against open.
 */
export function isUpBar(columns: CycleBarColumns, index: number): boolean {
  const close = columns.close[index]!;
  if (index === 0) return close >= columns.open[index]!;
  return close >= columns.close[index - 1]!;
}

/** Candle for bar `index`: full colour for a scored test bar, dimmed for context and replay. */
export function candlePointAt(columns: CycleBarColumns, index: number): CycleCandlePoint {
  const up = isUpBar(columns, index);
  const role = columns.role[index];
  const color = role === "processed"
    ? (columns.span[index] === "replay"
      ? (up ? REPLAY_UP : REPLAY_DOWN)
      : (up ? PROCESSED_UP : PROCESSED_DOWN))
    : (up ? CONTEXT_UP : CONTEXT_DOWN);
  return {
    time: columns.timestamps[index]! as UTCTimestamp,
    open: columns.open[index]!,
    high: columns.high[index]!,
    low: columns.low[index]!,
    close: columns.close[index]!,
    color,
    borderColor: color,
    wickColor: color,
  };
}

/** How sure a prediction is: |P(up) − 0.5| × 2, in [0, 1]. Null probability → 0. */
export function predictionConfidence(probabilityUp: number | null): number {
  if (probabilityUp === null || !Number.isFinite(probabilityUp)) return 0;
  return Math.max(0, Math.min(1, Math.abs(probabilityUp - 0.5) * 2));
}

/** Strip colour: hue by predicted direction, alpha by confidence (never below 0.25). */
export function stripColor(direction: 1 | 0 | -1 | null, probabilityUp: number | null): string {
  const confidence = predictionConfidence(probabilityUp);
  const step = Math.round(confidence * (STRIP_ALPHA_STEPS - 1));
  const ramp = direction === 1 ? STRIP_UP_RAMP : direction === -1 ? STRIP_DOWN_RAMP : STRIP_NEUTRAL_RAMP;
  return ramp[step]!;
}

/** Strip point: constant height 1, coloured by the prediction. Context bars are whitespace. */
export function stripPointAt(columns: CycleBarColumns, index: number): StripPoint {
  const time = columns.timestamps[index]! as UTCTimestamp;
  if (columns.role[index] !== "processed") return { time };
  return { time, value: 1, color: stripColor(columns.predictedDirection[index] ?? null, columns.probabilityUp[index] ?? null) };
}

/** P(up) point; whitespace for context bars and missing predictions, which breaks the line there. */
export function probabilityPointAt(columns: CycleBarColumns, index: number): LinePoint {
  const time = columns.timestamps[index]! as UTCTimestamp;
  const value = columns.probabilityUp[index];
  if (columns.role[index] !== "processed" || value === null || value === undefined) return { time };
  return { time, value };
}

/**
 * Equity point (USD); whitespace for context bars.
 *
 * The run's equity line is the SCORED out-of-sample walk's. The validation replay runs
 * its own simulator on its own equity that nothing gates and nothing reports, so its bars
 * never contribute a point here — otherwise the line would jump back to zero at every
 * replay and the chart would show two accounts as one.
 */
export function equityPointAt(columns: CycleBarColumns, index: number): LinePoint {
  const time = columns.timestamps[index]! as UTCTimestamp;
  const value = columns.equityUsd[index];
  if (!isScoredBar(columns, index) || value === null || value === undefined) return { time };
  return { time, value };
}

export interface MappedBars {
  candles: CycleCandlePoint[];
  strip: StripPoint[];
  probability: LinePoint[];
  equity: LinePoint[];
}

/** Map bars `[from, to)` to the four series' points. Cost is proportional to `to − from` only. */
export function mapBars(columns: CycleBarColumns, from: number, to: number): MappedBars {
  const start = Math.max(0, from);
  const end = Math.min(to, columns.timestamps.length);
  const length = Math.max(0, end - start);
  const candles = new Array<CycleCandlePoint>(length);
  const strip = new Array<StripPoint>(length);
  const probability = new Array<LinePoint>(length);
  const equity = new Array<LinePoint>(length);
  for (let offset = 0; offset < length; offset += 1) {
    const index = start + offset;
    candles[offset] = candlePointAt(columns, index);
    strip[offset] = stripPointAt(columns, index);
    probability[offset] = probabilityPointAt(columns, index);
    equity[offset] = equityPointAt(columns, index);
  }
  return { candles, strip, probability, equity };
}

// ─── On-candle prediction glyphs ────────────────────────────────────────────

/** Below this bar spacing (pixels) glyphs are not drawn: too dense to read; the strip still shows. */
export const GLYPH_MINIMUM_BAR_SPACING = 3;
export const GLYPH_MINIMUM_SIZE = 4;
export const GLYPH_MAXIMUM_SIZE = 10;
/** Pixels between the candle's wick end and the glyph. */
export const GLYPH_GAP = 3;
/** Alpha of a glyph whose label is not known yet (or moved too little to score). */
export const GLYPH_FAINT_ALPHA = 0.45;
/**
 * Floor of a solid (correct) glyph's alpha. Confidence lifts it toward 1. Kept
 * well above the faint alpha: these models rarely move P(up) far from 0.5, so
 * a floor near 0.45 would make a correct glyph look like an unresolved one.
 */
export const GLYPH_SOLID_MINIMUM_ALPHA = 0.75;

/** How a glyph is filled: solid = the call was right, hollow = wrong, faint = not known yet. */
export type GlyphFill = "solid" | "hollow" | "faint";

export interface PredictionGlyph {
  /** "below": an upward triangle under the low (predicts up); "above": a downward triangle over the high (predicts down). */
  side: "below" | "above";
  color: string;
  fill: GlyphFill;
  /** Alpha to draw with (outline of a hollow glyph is drawn at this alpha too). */
  alpha: number;
}

/** Glyph size in pixels for a bar spacing, or null when bars are too dense to draw glyphs. */
export function glyphSize(barSpacing: number): number | null {
  if (!Number.isFinite(barSpacing) || barSpacing < GLYPH_MINIMUM_BAR_SPACING) return null;
  return Math.max(GLYPH_MINIMUM_SIZE, Math.min(GLYPH_MAXIMUM_SIZE, barSpacing * 0.8));
}

/**
 * The glyph for bar `index`: null for context bars, for bars with no directional call,
 * and for the validation replay's bars.
 *
 * The glyph's fill IS the run's verdict — solid right, hollow wrong — so it is drawn on
 * the scored out-of-sample walk only. A replay bar resolves its own labels, and drawing
 * that verdict on bars the model was fitted on would report an accuracy the run never
 * earned. The replay is watched on the candles, the strip, the probability line and the
 * forecast instead.
 */
export function predictionGlyphAt(columns: CycleBarColumns, index: number): PredictionGlyph | null {
  if (!isScoredBar(columns, index)) return null;
  const direction = columns.predictedDirection[index];
  if (direction !== 1 && direction !== -1) return null;
  const correct = columns.correct[index];
  let fill: GlyphFill;
  let alpha: number;
  if (correct === true) {
    fill = "solid";
    const confidence = predictionConfidence(columns.probabilityUp[index] ?? null);
    alpha = GLYPH_SOLID_MINIMUM_ALPHA + (1 - GLYPH_SOLID_MINIMUM_ALPHA) * confidence;
  } else if (correct === false) {
    fill = "hollow";
    alpha = 1;
  } else {
    // Not resolved yet, or resolved inside the threshold (not scored).
    fill = "faint";
    alpha = GLYPH_FAINT_ALPHA;
  }
  return {
    side: direction === 1 ? "below" : "above",
    color: direction === 1 ? CYCLE_COLORS.up : CYCLE_COLORS.down,
    fill,
    alpha,
  };
}

export interface TrianglePoints {
  /** The tip, pointing away from the candle's body toward the predicted move. */
  apex: { x: number; y: number };
  baseLeft: { x: number; y: number };
  baseRight: { x: number; y: number };
}

/**
 * Triangle for a glyph at bar centre `x`. `wickY` is the pixel y of the
 * candle's low (side "below") or high (side "above"). An up triangle sits
 * under the low with its apex toward the candle; a down triangle sits over
 * the high with its apex toward the candle — both point the way the model
 * expects price to go.
 */
export function glyphTriangle(side: "below" | "above", x: number, wickY: number, size: number, gap = GLYPH_GAP): TrianglePoints {
  const half = size / 2;
  const height = size * 0.9;
  if (side === "below") {
    const top = wickY + gap;
    return { apex: { x, y: top }, baseLeft: { x: x - half, y: top + height }, baseRight: { x: x + half, y: top + height } };
  }
  const bottom = wickY - gap;
  return { apex: { x, y: bottom }, baseLeft: { x: x - half, y: bottom - height }, baseRight: { x: x + half, y: bottom - height } };
}

// ─── Predicted-price (forecast) line ────────────────────────────────────────

/**
 * The forecast line's bookkeeping, built incrementally as bars append (never
 * rescanned per hover or per frame).
 *
 * A point is plotted at the time of the bar it FORECASTS (`forecastTimestamp`),
 * not the bar that made it, so the line leads price by `labelHorizonBars` and
 * each point lands on the candle it predicts. `sourceByTime` maps that target
 * time back to the index of the bar that made the forecast.
 */
export interface ForecastTrack {
  /** Target times plotted so far, strictly increasing. */
  times: number[];
  /** Target time (epoch seconds) → index of the bar that made the forecast. */
  sourceByTime: Map<number, number>;
}

export function emptyForecastTrack(): ForecastTrack {
  return { times: [], sourceByTime: new Map() };
}

/**
 * Add the forecasts made by bars `[from, to)` to `track` IN PLACE and return
 * the new line points, in order. Skipped: context bars, a null forecast or
 * target time, and a target time not after the last one plotted (the line
 * series only accepts increasing times). Cost is proportional to `to − from`.
 */
export function appendForecast(track: ForecastTrack, columns: CycleBarColumns, from: number, to: number): ValuePoint[] {
  const points: ValuePoint[] = [];
  const end = Math.min(to, columns.timestamps.length);
  let last = track.times.length > 0 ? track.times[track.times.length - 1]! : -Infinity;
  for (let index = Math.max(0, from); index < end; index += 1) {
    if (columns.role[index] !== "processed") continue;
    const time = columns.forecastTimestamp[index];
    const value = columns.predictedClose[index];
    if (time === null || time === undefined || value === null || value === undefined || !Number.isFinite(value)) continue;
    if (time <= last) continue;
    last = time;
    track.times.push(time);
    track.sourceByTime.set(time, index);
    points.push({ time: time as UTCTimestamp, value });
  }
  return points;
}

/**
 * Logical index of the newest forecast point, or null when there is none.
 *
 * The time scale is the union of every series' times. The engine emits bars
 * contiguously, so every forecast target at or before the newest candle is a
 * candle time, and each target after it adds exactly one time point to the
 * right of the candles. Candle `i` therefore keeps logical index `i`, and the
 * forecast head sits `lead` points past the last candle.
 */
export function forecastHeadIndex(track: ForecastTrack, candleCount: number, lastCandleTimestamp: number | null): number | null {
  if (track.times.length === 0 || candleCount === 0 || lastCandleTimestamp === null) return null;
  const lead = track.times.length - upperBound(track.times, lastCandleTimestamp);
  return candleCount - 1 + lead;
}

// ─── Incremental render bookkeeping ─────────────────────────────────────────

/** What the chart has drawn so far. */
export interface RenderedBars {
  /** `barsEpoch` the series were last reset for. */
  epoch: number;
  /** Bars drawn: `[0, count)` of the store's columns. */
  count: number;
  /** `barsVersion` last seen. */
  version: number;
  /** Timestamp of bar `count − 1` as drawn, or null when nothing is drawn. */
  lastTimestamp: number | null;
}

/** What the store holds now. */
export interface StoreBars {
  epoch: number;
  version: number;
  count: number;
  /** The store's timestamp at index `rendered.count − 1` (null if out of range). */
  timestampAtRenderedEnd: number | null;
}

export type RenderPlan =
  | { kind: "none" }
  /** setData from scratch with bars `[0, count)`. */
  | { kind: "reset"; count: number }
  /** series.update() for bars `[from, to)`. */
  | { kind: "append"; from: number; to: number }
  /** Nothing new to append, but labels resolved on drawn bars: redraw the prediction glyphs. */
  | { kind: "refresh" };

/**
 * Decide this frame's work. A different epoch, a count that went backwards,
 * or a drawn bar whose timestamp no longer matches the store means the store
 * was replaced under us: reset. Otherwise append the new tail, or refresh when
 * only the version moved (resolved labels).
 */
export function planRender(rendered: RenderedBars | null, store: StoreBars): RenderPlan {
  if (rendered === null || rendered.epoch !== store.epoch || store.count < rendered.count) {
    return { kind: "reset", count: store.count };
  }
  if (rendered.count > 0 && store.timestampAtRenderedEnd !== rendered.lastTimestamp) {
    return { kind: "reset", count: store.count };
  }
  if (store.count > rendered.count) return { kind: "append", from: rendered.count, to: store.count };
  if (store.version !== rendered.version) return { kind: "refresh" };
  return { kind: "none" };
}

/** Bookkeeping after carrying out `plan`. */
export function advanceRendered(
  rendered: RenderedBars | null,
  store: StoreBars,
  plan: RenderPlan,
  timestamps: readonly number[],
): RenderedBars {
  const countAfter = plan.kind === "reset" ? plan.count : plan.kind === "append" ? plan.to : (rendered?.count ?? 0);
  return {
    epoch: store.epoch,
    version: store.version,
    count: countAfter,
    lastTimestamp: countAfter > 0 ? (timestamps[countAfter - 1] ?? null) : null,
  };
}

// ─── Index search ───────────────────────────────────────────────────────────

/** First index whose timestamp is ≥ `target` (= length when none). */
export function lowerBound(timestamps: readonly number[], target: number): number {
  let low = 0;
  let high = timestamps.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timestamps[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** First index whose timestamp is > `target` (= length when none). */
export function upperBound(timestamps: readonly number[], target: number): number {
  let low = 0;
  let high = timestamps.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timestamps[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Index of the bar at `target`, or of the last bar before it; -1 when `target` precedes every bar. */
export function barIndexAtOrBefore(timestamps: readonly number[], target: number): number {
  const exact = findBarIndex(timestamps, target);
  if (exact >= 0) return exact;
  return upperBound(timestamps, target) - 1;
}

/**
 * A time span as a logical range over the drawn bars: the first bar at or
 * after `start` to the last bar at or before `end`, widened by half a bar each
 * side so the band covers whole candles. Null when no drawn bar falls inside.
 * A span that runs past the last drawn bar is clamped to it — bars the model
 * has not emitted are never painted.
 */
export function spanToLogical(
  timestamps: readonly number[],
  start: number,
  end: number,
): { from: number; to: number } | null {
  if (timestamps.length === 0 || end < start) return null;
  const first = lowerBound(timestamps, start);
  const last = upperBound(timestamps, end) - 1;
  if (first > last || first >= timestamps.length || last < 0) return null;
  return { from: first - 0.5, to: last + 0.5 };
}

// ─── Bands (fold spans, active block, test cursor) ──────────────────────────

export type BandKind = "training" | "validation" | "test" | "previous_test" | "tuning" | "active";

export interface Band {
  kind: BandKind;
  /** Epoch seconds, inclusive. */
  start: number;
  end: number;
  fill: string;
  /** Solid colour for the label text and swatch. */
  edge: string;
  /** Null draws the fill with no label. */
  label: string | null;
  foldIndex: number | null;
}

export interface CursorMark {
  /** The bar just predicted (epoch seconds). */
  time: number;
  label: string;
  paused: boolean;
}

export interface BandLayout {
  bands: Band[];
  cursor: CursorMark | null;
}

// Measured against the chart's near-black background (2026-09-25): at 6% the
// test tint differed from the background by a few RGB steps and read as no
// band at all. These are the lowest values that show on that background
// without washing out the candles drawn over them.
export const BAND_FILLS: Record<BandKind, string> = {
  training: withAlpha(CYCLE_COLORS.sky, 0.16),
  validation: withAlpha(CYCLE_COLORS.yellow, 0.2),
  test: withAlpha(CYCLE_COLORS.up, 0.11),
  previous_test: withAlpha(CYCLE_COLORS.up, 0.05),
  tuning: withAlpha(CYCLE_COLORS.active, 0.18),
  active: withAlpha(CYCLE_COLORS.active, 0.32),
};

export const BAND_EDGES: Record<BandKind, string> = {
  training: CYCLE_COLORS.sky,
  validation: CYCLE_COLORS.yellow,
  test: CYCLE_COLORS.up,
  previous_test: CYCLE_COLORS.up,
  tuning: CYCLE_COLORS.active,
  active: CYCLE_COLORS.active,
};

/** Folds are 0-based on the wire and 1-based on screen ("fold 2/3", as the terminal writes them). */
export function foldNumber(foldIndex: number): number {
  return foldIndex + 1;
}

/**
 * Optuna trial numbers are 0-based on the wire (`trial.number`); the screen
 * counts from 1 like the terminal's "[tune trial 3/20]".
 */
export function trialNumber(trial: number): number {
  return trial + 1;
}

function fraction(current: number | null, total: number | null): string {
  if (current === null && total === null) return "";
  return `${current ?? "?"}/${total ?? "?"}`;
}

/** Label for the block the model is working on, by phase and step unit. */
export function activeSpanLabel(cursor: CycleCursor): string {
  if (cursor.phase === "replaying") return "Validation replay — in sample, not scored";
  if (cursor.phase === "validating") return "Validating";
  if (cursor.phase === "tuning") {
    const trial = cursor.trial === null ? null : trialNumber(cursor.trial);
    return `Tuning block — trial ${fraction(trial, cursor.trialCount)}`;
  }
  if (cursor.phase === "training") {
    const steps = fraction(cursor.epoch, cursor.epochCount);
    switch (cursor.stepUnit) {
      case "boosting_round":
        return `Boosting round ${steps} — every round sees the whole window`;
      case "tree_batch":
        return `Growing trees ${steps} — every tree sees the whole window`;
      case "solver_pass":
        return `Solver pass ${steps} — every pass sees the whole window`;
      case "single_fit":
        return "Fitting in one pass — the library fits the whole window at once";
      default: {
        const batch = cursor.batch !== null || cursor.batchCount !== null ? ` batch ${fraction(cursor.batch, cursor.batchCount)}` : "";
        return `Fitting this block — epoch ${steps}${batch}`;
      }
    }
  }
  return "";
}

/**
 * Bands from the plan and the cursor.
 *
 * The current fold is the cursor's fold, or the last fold once the run has
 * ended. Its training and validation spans are drawn in full; its test span
 * only as far as the model has walked (`cursor.barTimestamp` while testing,
 * the last drawn bar afterwards). Earlier folds keep a very faint test span.
 * The active block (what is being fitted, validated or tuned right now) comes
 * from `cursor.spanStart..spanEnd`, drawn over the fold spans.
 */
export function buildBands(plan: CyclePlan | null, cursor: CycleCursor | null, lastBarTimestamp: number | null): BandLayout {
  const bands: Band[] = [];
  if (!plan) return { bands, cursor: null };

  const ended = cursor === null || cursor.phase === "complete" || cursor.phase === "stopped" || cursor.phase === "failed";
  let currentFold: number | null = cursor?.foldIndex ?? null;
  if (currentFold === null && ended && lastBarTimestamp !== null) {
    // The last fold whose test span has started on the drawn bars.
    for (const fold of plan.folds) {
      if (fold.testStart <= lastBarTimestamp) currentFold = fold.foldIndex;
    }
  }

  const make = (kind: BandKind, start: number, end: number, label: string | null, foldIndex: number | null): Band => ({
    kind,
    start,
    end,
    fill: BAND_FILLS[kind],
    edge: BAND_EDGES[kind],
    label,
    foldIndex,
  });

  for (const fold of plan.folds) {
    if (currentFold === null || fold.foldIndex >= currentFold) continue;
    const end = lastBarTimestamp === null ? fold.testEnd : Math.min(fold.testEnd, lastBarTimestamp);
    if (end >= fold.testStart) bands.push(make("previous_test", fold.testStart, end, null, fold.foldIndex));
  }

  const fold = currentFold === null ? undefined : plan.folds.find((candidate) => candidate.foldIndex === currentFold);
  if (fold) {
    const k = foldNumber(fold.foldIndex);
    bands.push(make("training", fold.trainStart, fold.trainEnd, `Training window · fold ${k}`, fold.foldIndex));
    if (fold.validationEnd >= fold.validationStart && fold.validationBarCount > 0) {
      bands.push(make("validation", fold.validationStart, fold.validationEnd, "Validation", fold.foldIndex));
    }
    let testEnd: number | null = null;
    if (cursor?.phase === "testing" && cursor.barTimestamp !== null) testEnd = Math.min(cursor.barTimestamp, fold.testEnd);
    else if (ended && lastBarTimestamp !== null) testEnd = Math.min(fold.testEnd, lastBarTimestamp);
    if (testEnd !== null && testEnd >= fold.testStart) {
      bands.push(make("test", fold.testStart, testEnd, "Test walk", fold.foldIndex));
    }
  }

  if (cursor && (cursor.phase === "training" || cursor.phase === "validating" || cursor.phase === "tuning"
      || cursor.phase === "replaying")) {
    let start = cursor.spanStart;
    let end = cursor.spanEnd;
    if ((start === null || end === null) && cursor.phase === "tuning" && plan.tuning) {
      start = plan.tuning.start ?? null;
      end = plan.tuning.end ?? null;
    }
    if (start !== null && end !== null && end >= start) {
      bands.push(make("active", start, end, activeSpanLabel(cursor), cursor.foldIndex));
    }
  }

  let mark: CursorMark | null = null;
  // the replay walks bars too, so the "model is here" mark follows it — otherwise the
  // mark sits on the test span while the model is actually trading the validation one
  if (cursor && (cursor.phase === "testing" || cursor.phase === "replaying") && cursor.barTimestamp !== null) {
    mark = {
      time: cursor.barTimestamp,
      label: cursor.paused
        ? "model is here · paused"
        : cursor.phase === "replaying" ? "replay is here · in sample" : "model is here",
      paused: cursor.paused,
    };
  }
  return { bands, cursor: mark };
}

// ─── Trade markers ──────────────────────────────────────────────────────────

const MINUS = "−";

/** "+$26.20" / "−$14.30" (true minus sign). */
export function formatSignedUsd(value: number): string {
  const sign = value < 0 ? MINUS : "+";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export interface TradeMarkerSet {
  /** Sorted by time; entries and exits for trades whose bar is drawn. */
  markers: SeriesMarker<Time>[];
  /** Earliest marker time not drawn yet because its bar has not arrived; null when none is waiting. */
  pendingTimestamp: number | null;
}

/** An invisible marker: it only reserves the slot a prediction glyph occupies. */
export const GLYPH_SPACER_COLOR = "rgba(0, 0, 0, 0)";

interface MarkerWithOrder {
  marker: SeriesMarker<Time>;
  order: number;
}

/**
 * Markers for every trade: entry — long ▲ below the bar in orange "L<n>",
 * short ▼ above in blue "S<n>"; exit — ● orange for a profit, blue for a loss,
 * with the net result as text, above the bar for a long and below for a short.
 * A marker whose bar has not been drawn yet (`lastDrawnTimestamp`) is held
 * back and reported as pending, so the chart can rebuild once the bar lands.
 *
 * With `columns`, a marker on the same side of its bar as that bar's
 * prediction glyph (▲ below / ▼ above, drawn by the bands primitive) is pushed
 * outward by an invisible spacer marker placed first: the markers plugin
 * stacks same-side markers of one bar, so the spacer takes the slot next to
 * the candle and the trade arrow lands beyond the glyph instead of on it.
 */
export function buildTradeMarkers(
  trades: readonly CycleTrade[],
  lastDrawnTimestamp: number | null,
  columns: CycleBarColumns | null = null,
): TradeMarkerSet {
  const collected: MarkerWithOrder[] = [];
  const spaced = new Set<string>();
  let pending: number | null = null;
  const consider = (time: number, marker: SeriesMarker<Time>, order: number) => {
    if (lastDrawnTimestamp === null || time > lastDrawnTimestamp) {
      pending = pending === null ? time : Math.min(pending, time);
      return;
    }
    if (columns && (marker.position === "belowBar" || marker.position === "aboveBar")) {
      const key = `${marker.position}-${time}`;
      if (!spaced.has(key)) {
        const index = findBarIndex(columns.timestamps, time);
        const glyph = index >= 0 ? predictionGlyphAt(columns, index) : null;
        if (glyph && (glyph.side === "below") === (marker.position === "belowBar")) {
          spaced.add(key);
          collected.push({ marker: { id: `glyph-space-${key}`, time: time as UTCTimestamp, position: marker.position, shape: "circle", color: GLYPH_SPACER_COLOR, size: 1 }, order: -1 });
        }
      }
    }
    collected.push({ marker, order });
  };

  for (const trade of trades) {
    const long = trade.side === "long";
    consider(
      trade.entryTimestamp,
      {
        id: `entry-${trade.tradeNumber}`,
        time: trade.entryTimestamp as UTCTimestamp,
        position: long ? "belowBar" : "aboveBar",
        shape: long ? "arrowUp" : "arrowDown",
        color: long ? CYCLE_COLORS.up : CYCLE_COLORS.down,
        text: `${long ? "L" : "S"}${trade.tradeNumber}`,
      },
      1,
    );
    if (trade.status === "closed" && trade.exitTimestamp !== null) {
      const net = trade.netProfitUsd;
      consider(
        trade.exitTimestamp,
        {
          id: `exit-${trade.tradeNumber}`,
          time: trade.exitTimestamp as UTCTimestamp,
          position: long ? "aboveBar" : "belowBar",
          shape: "circle",
          color: net === null ? CYCLE_COLORS.neutral : net >= 0 ? CYCLE_COLORS.up : CYCLE_COLORS.down,
          text: net === null ? "exit" : formatSignedUsd(net),
        },
        0,
      );
    }
  }

  // Time order is required by the markers plugin; on a shared bar an exit
  // precedes the next entry, which is the order they happened in.
  collected.sort((a, b) => (a.marker.time as number) - (b.marker.time as number) || a.order - b.order);
  return { markers: collected.map((entry) => entry.marker), pendingTimestamp: pending };
}

// ─── Follow ranges ──────────────────────────────────────────────────────────

export const FOLLOW_MINIMUM_BARS = 150;
export const FOLLOW_MAXIMUM_BARS = 400;
export const FOLLOW_DEFAULT_BARS = 250;
/** Empty logical space kept right of the cursor bar while testing. */
export const FOLLOW_RIGHT_PADDING_BARS = 12;

export interface LogicalSpan {
  from: number;
  to: number;
}

/** Visible width to keep while following: the current width clamped to 150..400 bars. */
export function followWidth(currentWidth: number | null): number {
  if (currentWidth === null || !Number.isFinite(currentWidth) || currentWidth <= 0) return FOLLOW_DEFAULT_BARS;
  return Math.max(FOLLOW_MINIMUM_BARS, Math.min(FOLLOW_MAXIMUM_BARS, currentWidth));
}

/** Empty logical space kept right of the newest forecast point. */
export const FOLLOW_FORECAST_PADDING_BARS = 2;
/** Bars kept left of the cursor when a long forecast horizon pushes the right edge out. */
const FOLLOW_CURSOR_LEFT_MARGIN_BARS = 10;

/**
 * Testing: the cursor bar near the right edge, `width` bars in view. With a
 * forecast head (the logical index of the newest forecast point, which leads
 * the cursor by the label horizon), the right edge moves out to keep that
 * point in view too; the range widens rather than drop the cursor off the left.
 */
export function followTestRange(cursorIndex: number, width: number, forecastHead: number | null = null): LogicalSpan {
  let to = cursorIndex + FOLLOW_RIGHT_PADDING_BARS;
  if (forecastHead !== null && Number.isFinite(forecastHead)) to = Math.max(to, forecastHead + FOLLOW_FORECAST_PADDING_BARS);
  return { from: Math.min(to - width, cursorIndex - FOLLOW_CURSOR_LEFT_MARGIN_BARS), to };
}

/** Training / validating / tuning: the whole active span plus 5% (at least 5 bars) each side. */
export function followSpanRange(fromIndex: number, toIndex: number): LogicalSpan {
  const length = Math.max(1, toIndex - fromIndex);
  const padding = Math.max(5, length * 0.05);
  return { from: fromIndex - padding, to: toIndex + padding };
}

/** A range of `width` bars centred on `index`. */
export function centreRange(index: number, width: number): LogicalSpan {
  return { from: index - width / 2, to: index + width / 2 };
}

/** True when two logical ranges differ by more than a tenth of a bar at either edge. */
export function rangesDiffer(a: LogicalSpan | null, b: LogicalSpan): boolean {
  if (a === null) return true;
  return Math.abs(a.from - b.from) > 0.1 || Math.abs(a.to - b.to) > 0.1;
}

// ─── What the chart is actually holding ──────────────────────────────────────

/** What a series holds: how many bars, and its first and last bar's time (epoch seconds). */
export interface DrawnShape {
  count: number;
  first: number | null;
  last: number | null;
}

/**
 * How many of the RUN's bars the chart is actually holding.
 *
 * The market chart is already on screen when a run's bars land, and it applies
 * the new `data` prop on its own animation frame — one store notification after
 * the store knew, and one pass of the overlay before the candles are really
 * there. Reading the market series' length as "the run's bars drawn" spends the
 * one framing pass on the wrong series, and no later pass repeats it, because by
 * then the drawn count already matches the store: the view stays parked on the
 * market's own newest bar while the run's bars are off to its left.
 *
 * The run's series is identified by its FIRST bar (the market's window starts
 * elsewhere), and its last bar must be the one its count implies, so a chart
 * trailing the store by a batch reports exactly what it holds.
 */
export function drawnRunBars(drawn: DrawnShape | null, timestamps: readonly number[]): number {
  if (!drawn || drawn.count <= 0 || timestamps.length === 0) return 0;
  if (drawn.first !== timestamps[0]) return 0;
  const count = Math.min(drawn.count, timestamps.length);
  if (count <= 0 || drawn.last !== timestamps[count - 1]) return 0;
  return count;
}

// ─── Crosshair readout ──────────────────────────────────────────────────────

export interface BarReadout {
  index: number;
  /** Epoch seconds of the bar. */
  timestamp: number;
  timeText: string;
  role: "context" | "processed";
  /** Which walk walked this bar. `test` is the scored out-of-sample walk, `replay` the validation replay. */
  span: CycleBarSpan;
  open: number;
  high: number;
  low: number;
  close: number;
  probabilityUp: number | null;
  predictedDirectionWord: string;
  positionWord: string;
  equityUsd: number | null;
  /** "correct", "wrong", "not scored (inside threshold)", "not resolved yet", or "not tested". */
  labelWord: string;
  /** ✓ / ✗ / – / … so the label reads without colour. */
  labelGlyph: string;
  actualDirectionWord: string | null;
  /** The price model's forecast that TARGETS this bar (made `labelHorizonBars` earlier); null when none does. */
  forecastForThisBar: TargetForecast | null;
  /** The forecast this bar MADE, of the close `labelHorizonBars` later; null when it made none. */
  forecastMadeHere: MadeForecast | null;
  /** The label's price move; null for context bars or without a plan. */
  labelMove: LabelMoveReadout | null;
  /** The trade entered at the next bar's open on this bar's call; null when none was. */
  tradeAtNextOpen: TradeReadout | null;
  /** Set when later contract rolls shifted this bar's prices; null when none did. */
  rollAdjustment: RollAdjustmentReadout | null;
  /** False when the model has no price model (so no forecast); null without a plan. */
  hasPriceModel: boolean | null;
}

export interface TargetForecast {
  /** When the forecast was made (the bar `labelHorizonBars` earlier). */
  madeAtText: string;
  predictedClose: number;
  actualClose: number;
  /** Forecast close − actual close, in price points (positive: the forecast was too high). */
  errorPoints: number;
}

export interface MadeForecast {
  predictedClose: number;
  /** The bar the forecast is for. */
  targetTimeText: string;
  /** Forecast close − this bar's close, in price points: the move the price model expected. */
  predictedMovePoints: number;
  /** The close of the bar the forecast is for, once that bar is in the store; null until then. */
  actualClose: number | null;
  /** Forecast close − actual close, points (positive: too high); null until the bar is known. */
  errorPoints: number | null;
  /** The same error in ticks; null until known or without a tick size. */
  errorTicks: number | null;
}

/**
 * The move the direction label is scored on: this bar's close to the close
 * `labelHorizonBars` later. It is the LABEL, not a trade's profit — the trade
 * (entered at the next bar's open, with costs and exits) is `tradeAtNextOpen`.
 */
export type LabelMoveReadout =
  | {
      state: "resolved";
      horizonBars: number;
      startClose: number;
      resolutionClose: number;
      resolutionTimeText: string;
      /** Resolution close − this close, price points. */
      movePoints: number;
      moveTicks: number;
      /** The move in USD for ONE contract (points × point value). */
      moveUsdPerContract: number;
      /** Contracts the run trades (`plan.trading.contracts`). */
      contracts: number;
      /** `moveUsdPerContract × contracts`. */
      moveUsdAllContracts: number;
      /** A move inside ± this many ticks is not scored. */
      thresholdTicks: number;
    }
  | {
      state: "pending";
      horizonBars: number;
      /** When the label resolves (the bar the forecast is for); null when that time is not known yet. */
      resolutionTimeText: string | null;
      thresholdTicks: number;
    };

/** The trade the model opened at the NEXT bar's open, acting on this bar's call. */
export interface TradeReadout {
  tradeNumber: number;
  side: "long" | "short";
  contracts: number;
  entryTimeText: string;
  /** The entry fill (the next bar's open, in the chart's price space). */
  fillPrice: number;
  status: "open" | "closed";
  /** Net of costs, all contracts; null while the trade is open. */
  netProfitUsd: number | null;
  exitTimeText: string | null;
  exitPrice: number | null;
}

/** Why this bar's prices differ from what traded: later contract rolls shifted them (additive back-adjustment). */
export interface RollAdjustmentReadout {
  /** Points added to this bar's traded prices: the sum of the gaps of every roll after it. */
  shiftPoints: number;
  /** Rolls after this bar. */
  rollCount: number;
  /** The first roll after this bar. */
  nextRollTimeText: string;
  nextRollFromContract: string;
  nextRollToContract: string;
}

/** A forecast point past the newest candle: its bar has not arrived yet. */
export interface ForecastOnlyReadout {
  timeText: string;
  madeAtText: string;
  predictedClose: number;
}

/** "2025-11-04 09:35 UTC" — the chart's axis is UTC, so the readout says so. */
export function formatBarTime(epochSeconds: number): string {
  return `${new Date(epochSeconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function directionWord(direction: 1 | 0 | -1 | null | undefined, up: string, down: string, flat: string): string {
  if (direction === 1) return up;
  if (direction === -1) return down;
  if (direction === 0) return flat;
  return "none";
}

/** The forecast targeting bar `index`, looked up through the forecast track's map (no scan). */
export function targetForecastAt(
  columns: CycleBarColumns,
  index: number,
  sourceByTime: ReadonlyMap<number, number> | null,
): TargetForecast | null {
  if (!sourceByTime || index < 0 || index >= columns.timestamps.length) return null;
  const source = sourceByTime.get(columns.timestamps[index]!);
  if (source === undefined) return null;
  const predictedClose = columns.predictedClose[source];
  if (predictedClose === null || predictedClose === undefined) return null;
  const actualClose = columns.close[index]!;
  return {
    madeAtText: formatBarTime(columns.timestamps[source]!),
    predictedClose,
    actualClose,
    errorPoints: predictedClose - actualClose,
  };
}

/**
 * The forecast bar `index` made, or null when it made none. Once the bar it is
 * for is in the store, the actual close and the error come with it.
 */
export function madeForecastAt(columns: CycleBarColumns, index: number, tickSize: number | null = null): MadeForecast | null {
  if (index < 0 || index >= columns.timestamps.length || columns.role[index] !== "processed") return null;
  const predictedClose = columns.predictedClose[index];
  const target = columns.forecastTimestamp[index];
  if (predictedClose === null || predictedClose === undefined || target === null || target === undefined) return null;
  const targetIndex = findBarIndex(columns.timestamps, target);
  const actualClose = targetIndex >= 0 ? columns.close[targetIndex]! : null;
  const errorPoints = actualClose === null ? null : predictedClose - actualClose;
  return {
    predictedClose,
    targetTimeText: formatBarTime(target),
    predictedMovePoints: predictedClose - columns.close[index]!,
    actualClose,
    errorPoints,
    errorTicks: errorPoints === null || tickSize === null || !(tickSize > 0) ? null : errorPoints / tickSize,
  };
}

/**
 * The label move of bar `index`: close[i] → close[i + h], h = `labelHorizonBars`.
 *
 * Resolved once the label is known (`actualDirection[i]` set). Bars arrive in
 * time order without gaps and a label resolves in the frame that carries bar
 * i + h, so close[i + h] is in the store whenever the label is; if it somehow
 * is not, the move is reported as pending rather than guessed. Pending carries
 * the resolution time from `forecastTimestamp[i]` (the bar i + h), or from the
 * store when bar i + h is already there. Null for context bars.
 */
export function labelMoveAt(columns: CycleBarColumns, index: number, plan: CyclePlan): LabelMoveReadout | null {
  if (index < 0 || index >= columns.timestamps.length || columns.role[index] !== "processed") return null;
  const horizonBars = plan.labelHorizonBars;
  const thresholdTicks = plan.labelThresholdTicks;
  const resolutionIndex = index + horizonBars;
  const known = columns.actualDirection[index] !== null && columns.actualDirection[index] !== undefined;
  if (known && resolutionIndex < columns.timestamps.length) {
    const startClose = columns.close[index]!;
    const resolutionClose = columns.close[resolutionIndex]!;
    const movePoints = resolutionClose - startClose;
    const contracts = plan.trading.contracts;
    const moveUsdPerContract = movePoints * plan.costModel.pointValueUsd;
    return {
      state: "resolved",
      horizonBars,
      startClose,
      resolutionClose,
      resolutionTimeText: formatBarTime(columns.timestamps[resolutionIndex]!),
      movePoints,
      moveTicks: movePoints / plan.costModel.tickSize,
      moveUsdPerContract,
      contracts,
      moveUsdAllContracts: moveUsdPerContract * contracts,
      thresholdTicks,
    };
  }
  const forecastTime = columns.forecastTimestamp[index];
  const resolutionTime =
    forecastTime !== null && forecastTime !== undefined
      ? forecastTime
      : resolutionIndex < columns.timestamps.length
        ? columns.timestamps[resolutionIndex]!
        : null;
  return { state: "pending", horizonBars, resolutionTimeText: resolutionTime === null ? null : formatBarTime(resolutionTime), thresholdTicks };
}

/**
 * The trade whose entry is at `entryTimestamp`, or null. Trades are numbered in
 * entry order and one bar opens at most one trade, so entry times increase with
 * the trade number: a binary search, not a scan.
 */
export function tradeEnteredAt(trades: readonly CycleTrade[], entryTimestamp: number): CycleTrade | null {
  let low = 0;
  let high = trades.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const value = trades[middle]!.entryTimestamp;
    if (value === entryTimestamp) return trades[middle]!;
    if (value < entryTimestamp) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

/** The trade entered at bar `index + 1`'s open (acting on bar `index`'s call), or null. */
export function tradeAtNextOpen(columns: CycleBarColumns, index: number, trades: readonly CycleTrade[]): TradeReadout | null {
  if (index < 0 || index + 1 >= columns.timestamps.length || columns.role[index] !== "processed") return null;
  const trade = tradeEnteredAt(trades, columns.timestamps[index + 1]!);
  if (!trade) return null;
  return {
    tradeNumber: trade.tradeNumber,
    side: trade.side,
    contracts: trade.contracts,
    entryTimeText: formatBarTime(trade.entryTimestamp),
    fillPrice: trade.entryPrice,
    status: trade.status,
    netProfitUsd: trade.status === "closed" ? trade.netProfitUsd : null,
    exitTimeText: trade.exitTimestamp === null ? null : formatBarTime(trade.exitTimestamp),
    exitPrice: trade.exitPrice,
  };
}

/**
 * The roll shift of a bar at `timestamp`: with additive back-adjustment every
 * bar before a roll is moved by that roll's gap (`packages/ml-engine/src/cycle/rolls.py`), so
 * a bar's shift is the sum of the gaps of the rolls after it. Null when no roll
 * follows it (its prices are as traded) or the series is not adjusted.
 */
export function rollAdjustmentAt(plan: CyclePlan, timestamp: number): RollAdjustmentReadout | null {
  const adjustment = plan.priceAdjustment;
  if (!adjustment || adjustment.method === "none") return null;
  let shiftPoints = 0;
  let rollCount = 0;
  let next: (typeof adjustment.rolls)[number] | null = null;
  for (const roll of adjustment.rolls) {
    if (roll.timestamp <= timestamp) continue;
    shiftPoints += roll.gapPoints;
    rollCount += 1;
    if (next === null || roll.timestamp < next.timestamp) next = roll;
  }
  if (next === null) return null;
  return {
    shiftPoints,
    rollCount,
    nextRollTimeText: formatBarTime(next.timestamp),
    nextRollFromContract: next.fromContract,
    nextRollToContract: next.toContract,
  };
}

/** Readout for a forecast point whose bar has not been drawn yet (the part of the line ahead of the candles). */
export function forecastOnlyReadout(
  columns: CycleBarColumns,
  time: number,
  sourceByTime: ReadonlyMap<number, number> | null,
): ForecastOnlyReadout | null {
  const source = sourceByTime?.get(time);
  if (source === undefined) return null;
  const predictedClose = columns.predictedClose[source];
  if (predictedClose === null || predictedClose === undefined) return null;
  return { timeText: formatBarTime(time), madeAtText: formatBarTime(columns.timestamps[source]!), predictedClose };
}

/**
 * Colour of the readout's label word: sky for "correct", neutral grey for
 * "wrong" (the ✓ / ✗ glyph carries the meaning, so right and wrong never rest
 * on a hue pair), none otherwise.
 */
export function readoutLabelTone(labelWord: string): string | undefined {
  if (labelWord === "correct") return CYCLE_COLORS.sky;
  if (labelWord === "wrong") return CYCLE_COLORS.neutral;
  return undefined;
}

/**
 * The crosshair readout for bar `index`. With the run's `plan` it adds the
 * label move in points / ticks / USD, the forecast's error and the roll note;
 * with `trades`, the trade entered at the next bar's open.
 */
export function readoutAt(
  columns: CycleBarColumns,
  index: number,
  forecastSourceByTime: ReadonlyMap<number, number> | null = null,
  plan: CyclePlan | null = null,
  trades: readonly CycleTrade[] | null = null,
): BarReadout | null {
  if (index < 0 || index >= columns.timestamps.length) return null;
  const processed = columns.role[index] === "processed";
  const span: CycleBarSpan = processed ? (columns.span[index] ?? "test") : "test";
  // the run's position and equity come from the scored walk only; the replay runs its own
  // simulator on its own equity, so quoting it here would read as the run's account
  const scored = processed && span === "test";
  const correct = columns.correct[index];
  const actual = columns.actualDirection[index];
  let labelWord: string;
  let labelGlyph: string;
  if (!processed) {
    labelWord = "not tested";
    labelGlyph = "·";
  } else if (span === "replay") {
    // in sample: the model was fitted and selected on these bars, so no verdict is claimed
    labelWord = "validation replay — in sample, not scored";
    labelGlyph = "~";
  } else if (correct === true) {
    labelWord = "correct";
    labelGlyph = "✓";
  } else if (correct === false) {
    labelWord = "wrong";
    labelGlyph = "✗";
  } else if (actual !== null && actual !== undefined) {
    labelWord = "not scored (move inside threshold)";
    labelGlyph = "–";
  } else {
    labelWord = "not resolved yet";
    labelGlyph = "…";
  }
  return {
    index,
    timestamp: columns.timestamps[index]!,
    timeText: formatBarTime(columns.timestamps[index]!),
    role: processed ? "processed" : "context",
    span,
    open: columns.open[index]!,
    high: columns.high[index]!,
    low: columns.low[index]!,
    close: columns.close[index]!,
    probabilityUp: processed ? (columns.probabilityUp[index] ?? null) : null,
    predictedDirectionWord: processed ? directionWord(columns.predictedDirection[index], "up", "down", "no call") : "none",
    positionWord: scored ? directionWord(columns.position[index], "long", "short", "flat") : "none",
    equityUsd: scored ? (columns.equityUsd[index] ?? null) : null,
    labelWord,
    labelGlyph,
    actualDirectionWord: actual === null || actual === undefined ? null : directionWord(actual, "up", "down", "flat"),
    forecastForThisBar: targetForecastAt(columns, index, forecastSourceByTime),
    forecastMadeHere: madeForecastAt(columns, index, plan ? plan.costModel.tickSize : null),
    labelMove: plan ? labelMoveAt(columns, index, plan) : null,
    tradeAtNextOpen: trades ? tradeAtNextOpen(columns, index, trades) : null,
    rollAdjustment: plan ? rollAdjustmentAt(plan, columns.timestamps[index]!) : null,
    hasPriceModel: plan ? plan.hasPriceModel !== false : null,
  };
}

// ─── Price text and hover geometry (drawn by chartBands.ts) ──────────────────

/** Forecast price text is printed beside the glyphs only at this bar spacing (pixels) or wider. */
export const PRICE_TEXT_MINIMUM_BAR_SPACING = 14;
/** Pixels between a glyph and its price text. */
export const PRICE_TEXT_GAP = 2;
/** Price text rows tried beyond a glyph before the text is left out (so neighbours do not overprint). */
export const PRICE_TEXT_MAXIMUM_ROWS = 2;
/** Minimum clear pixels between two price texts. */
export const PRICE_TEXT_CLEARANCE = 2;

/** A price rounded to the nearest tick, printed with the tick's decimals ("21234.25" for 0.25). */
export function formatTickPrice(value: number, tickSize: number): string {
  if (!(tickSize > 0) || !Number.isFinite(value)) return value.toFixed(2);
  const decimals = tickDecimals(tickSize);
  return (Math.round(value / tickSize) * tickSize).toFixed(decimals);
}

export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function boxesOverlap(a: PixelBox, b: PixelBox, clearance = 0): boolean {
  return (
    a.left < b.left + b.width + clearance &&
    b.left < a.left + a.width + clearance &&
    a.top < b.top + b.height + clearance &&
    b.top < a.top + a.height + clearance
  );
}

/** The bounding box of a glyph's triangle (`glyphTriangle`). */
export function glyphBox(side: "below" | "above", x: number, wickY: number, size: number, gap = GLYPH_GAP): PixelBox {
  const triangle = glyphTriangle(side, x, wickY, size, gap);
  const ys = [triangle.apex.y, triangle.baseLeft.y, triangle.baseRight.y];
  const top = Math.min(...ys);
  return { left: x - size / 2, top, width: size, height: Math.max(...ys) - top };
}

/**
 * Where the price text of a glyph goes: centred on the bar, beyond the glyph —
 * under a ▲ (which sits under the low), over a ▼ (which sits over the high) —
 * so it never covers the glyph or the candle. `row` moves it one text height
 * further out, for when the first row is taken by a neighbour's text.
 */
export function priceTextBox(
  side: "below" | "above",
  x: number,
  wickY: number,
  glyphSizePixels: number,
  textWidth: number,
  textHeight: number,
  row = 0,
): PixelBox {
  const glyph = glyphBox(side, x, wickY, glyphSizePixels);
  const offset = PRICE_TEXT_GAP + row * (textHeight + PRICE_TEXT_CLEARANCE);
  const top = side === "below" ? glyph.top + glyph.height + offset : glyph.top - offset - textHeight;
  return { left: x - textWidth / 2, top, width: textWidth, height: textHeight };
}

export interface PriceTextCandidate {
  index: number;
  side: "below" | "above";
  x: number;
  wickY: number;
  text: string;
  textWidth: number;
}

export interface PlacedPriceText {
  index: number;
  text: string;
  box: PixelBox;
}

/**
 * Lay out the forecast price texts of the visible glyphs, left to right: each
 * takes the first of `PRICE_TEXT_MAXIMUM_ROWS` rows beyond its glyph that
 * overlaps no glyph and no text already placed, or is left out (the hover
 * readout still has it). At wide spacing every text fits in row 0.
 */
export function placePriceTexts(
  candidates: readonly PriceTextCandidate[],
  glyphSizePixels: number,
  textHeight: number,
): PlacedPriceText[] {
  const sorted = [...candidates].sort((a, b) => a.x - b.x);
  const glyphs = sorted.map((candidate) => glyphBox(candidate.side, candidate.x, candidate.wickY, glyphSizePixels));
  const placed: PlacedPriceText[] = [];
  for (const candidate of sorted) {
    for (let row = 0; row < PRICE_TEXT_MAXIMUM_ROWS; row += 1) {
      const box = priceTextBox(candidate.side, candidate.x, candidate.wickY, glyphSizePixels, candidate.textWidth, textHeight, row);
      if (glyphs.some((glyph) => boxesOverlap(glyph, box))) continue;
      if (placed.some((other) => boxesOverlap(other.box, box, PRICE_TEXT_CLEARANCE))) continue;
      placed.push({ index: candidate.index, text: candidate.text, box });
      break;
    }
  }
  return placed;
}

/**
 * Logical index of `time` on the chart's time scale: a drawn candle's own
 * index, or — past the newest candle — the forecast line's point there (see
 * `forecastHeadIndex`). Null when nothing is drawn at that time.
 */
export function logicalIndexOfTime(
  timestamps: readonly number[],
  renderedCount: number,
  forecastTimes: readonly number[] | null,
  time: number,
): number | null {
  if (renderedCount <= 0) return null;
  const lastCandle = timestamps[renderedCount - 1]!;
  if (time <= lastCandle) {
    const index = findBarIndex(timestamps, time);
    return index >= 0 && index < renderedCount ? index : null;
  }
  if (!forecastTimes) return null;
  const position = findBarIndex(forecastTimes, time);
  if (position < 0) return null;
  return renderedCount - 1 + (position - upperBound(forecastTimes, lastCandle) + 1);
}

/** What the hover draws for one bar: the label move's segment and the forecast point. */
export interface HoverPriceGeometry {
  index: number;
  startClose: number;
  /** Bar i + h, once its label is known and the bar is drawn; null before. */
  resolutionIndex: number | null;
  resolutionClose: number | null;
  /** 1 up, -1 down, 0 unchanged; null while unresolved. */
  moveSign: 1 | -1 | 0 | null;
  /** Logical index of the bar the forecast is for (may be ahead of the newest candle). */
  forecastLogical: number | null;
  forecastClose: number | null;
}

export function hoverPriceGeometry(
  columns: CycleBarColumns,
  index: number,
  renderedCount: number,
  labelHorizonBars: number,
  forecastTimes: readonly number[] | null,
): HoverPriceGeometry | null {
  if (index < 0 || index >= renderedCount || index >= columns.timestamps.length || columns.role[index] !== "processed") return null;
  const startClose = columns.close[index]!;
  const known = columns.actualDirection[index] !== null && columns.actualDirection[index] !== undefined;
  const resolution = index + labelHorizonBars;
  const resolved = known && resolution < renderedCount;
  const resolutionClose = resolved ? columns.close[resolution]! : null;
  const forecastTime = columns.forecastTimestamp[index];
  const forecastClose = columns.predictedClose[index];
  const hasForecast = forecastTime !== null && forecastTime !== undefined && forecastClose !== null && forecastClose !== undefined;
  return {
    index,
    startClose,
    resolutionIndex: resolved ? resolution : null,
    resolutionClose,
    moveSign: resolutionClose === null ? null : resolutionClose > startClose ? 1 : resolutionClose < startClose ? -1 : 0,
    forecastLogical: hasForecast ? logicalIndexOfTime(columns.timestamps, renderedCount, forecastTimes, forecastTime) : null,
    forecastClose: hasForecast ? forecastClose : null,
  };
}

// ─── Inspection (hover publish, click to pin) ───────────────────────────────

/** The crosshair publishes the hovered bar to the store at most this often (10 per second). */
export const INSPECT_PUBLISH_INTERVAL_MILLISECONDS = 100;

/**
 * Leading + trailing throttle: the first value goes out at once, later ones at
 * most every `intervalMilliseconds`, and the newest value pushed during a wait
 * goes out when it ends — so the last bar hovered is always the one published.
 * Clock and timer are injectable for tests.
 */
export class TrailingThrottle<T> {
  private lastAt = -Infinity;
  private hasLast = false;
  private last: T | undefined;
  private pending: { value: T } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  public constructor(
    private readonly intervalMilliseconds: number,
    private readonly publish: (value: T) => void,
    private readonly now: () => number = () => performance.now(),
    private readonly setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = (callback, delay) => setTimeout(callback, delay),
    private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void = (timer) => clearTimeout(timer),
  ) {}

  public push(value: T): void {
    if (this.timer !== null) {
      this.pending = { value };
      return;
    }
    if (this.hasLast && Object.is(this.last, value)) return;
    const wait = this.lastAt + this.intervalMilliseconds - this.now();
    if (wait <= 0) {
      this.emit(value);
      return;
    }
    this.pending = { value };
    this.timer = this.setTimer(this.flush, wait);
  }

  public cancel(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private readonly flush = () => {
    this.timer = null;
    const pending = this.pending;
    this.pending = null;
    if (pending && !(this.hasLast && Object.is(this.last, pending.value))) this.emit(pending.value);
  };

  private emit(value: T): void {
    this.lastAt = this.now();
    this.last = value;
    this.hasLast = true;
    this.publish(value);
  }
}

/** What a click on bar `clicked` pins: that bar, or nothing (unpin) when it is already the pinned bar. */
export function nextPinnedTimestamp(inspectSource: "hover" | "cursor" | "pinned", inspectTimestamp: number | null, clicked: number): number | null {
  return inspectSource === "pinned" && inspectTimestamp === clicked ? null : clicked;
}

// ─── Legend words ───────────────────────────────────────────────────────────

const PHASE_WORDS: Record<CycleCursor["phase"], string> = {
  loading: "loading bars",
  tuning: "tuning",
  training: "training",
  validating: "validating",
  replaying: "replaying the validation span",
  testing: "testing bar by bar",
  complete: "complete",
  stopped: "stopped",
  failed: "failed",
};

export function phaseWord(cursor: CycleCursor | null): string {
  if (!cursor) return "waiting for the model";
  const base = PHASE_WORDS[cursor.phase];
  const fold = cursor.foldIndex !== null && cursor.foldCount > 0 ? ` · fold ${foldNumber(cursor.foldIndex)}/${cursor.foldCount}` : "";
  return `${base}${fold}${cursor.paused ? " · paused" : ""}`;
}

/** Decimal places of a tick size (0.25 → 2, 1 → 0, 0.0001 → 4). */
export function tickDecimals(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  let decimals = 0;
  let scaled = tickSize;
  while (decimals < 8 && Math.abs(Math.round(scaled) - scaled) > 1e-9) {
    scaled *= 10;
    decimals += 1;
  }
  return decimals;
}
